import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/adapters", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), trace: vi.fn(), warn: vi.fn() },
}));

vi.mock("@/addons/addons-runtime-context", () => ({
  clearAddonRegistrations: vi.fn(),
  createAddonHostAPI: vi.fn(),
  registerAddonNavItem: vi.fn(),
  registerAddonRoute: vi.fn(),
  removeAddonNavItem: vi.fn(),
  removeAddonRoute: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { AddonIframeManager } from "./addon-iframe-manager";
import { resetAddonSandboxRuntimeAssetsForTest } from "./addon-sandbox-assets";

const input = {
  addonId: "test-addon",
  code: "export default () => undefined",
  manifest: { id: "test-addon", name: "Test Addon", version: "1.0.0" },
};

const CHANNEL = "wealthfolio:addon-sandbox:v1";

function getSandboxFrame(addonId = input.addonId) {
  const iframe = Array.from(document.querySelectorAll("iframe")).find(
    (candidate) => new URLSearchParams(candidate.name).get("addonId") === addonId,
  );
  if (!iframe?.contentWindow) {
    throw new Error(`Sandbox iframe for ${addonId} was not created`);
  }
  return iframe;
}

function getNonce(iframe: HTMLIFrameElement) {
  return new URLSearchParams(iframe.name).get("nonce") ?? "";
}

function dispatchFromSandbox(
  iframe: HTMLIFrameElement,
  type: string,
  payload: Record<string, unknown> = {},
  source: MessageEventSource | null = iframe.contentWindow,
) {
  const addonId = new URLSearchParams(iframe.name).get("addonId") ?? "";
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        addonId,
        channel: CHANNEL,
        nonce: getNonce(iframe),
        type,
        ...payload,
      },
      source,
    }),
  );
}

function successfulRuntimeFetch() {
  return vi.fn((request: RequestInfo | URL) => {
    const url =
      typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
    return Promise.resolve(
      new Response(url.endsWith(".js") ? "runtime" : "styles", { status: 200 }),
    );
  });
}

describe("AddonIframeManager", () => {
  beforeEach(() => {
    resetAddonSandboxRuntimeAssetsForTest();
  });

  afterEach(() => {
    document.getElementById("addon-sandbox-parking")?.remove();
    vi.unstubAllGlobals();
  });

  it("rejects a stale boot before it can touch the current runtime", async () => {
    const manager = new AddonIframeManager();
    const isCurrent = vi.fn(() => false);

    await expect(manager.startAddon({ ...input, isCurrent })).rejects.toMatchObject({
      name: "AddonLoadCancelled",
    });
    expect(isCurrent).toHaveBeenCalledTimes(1);
  });

  it("checks the generation again after awaiting runtime teardown", async () => {
    const manager = new AddonIframeManager();
    const isCurrent = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);

    await expect(manager.startAddon({ ...input, isCurrent })).rejects.toMatchObject({
      name: "AddonLoadCancelled",
    });
    expect(isCurrent).toHaveBeenCalledTimes(2);
  });

  it("hides stale warm content when the next route render fails", () => {
    const manager = new AddonIframeManager();
    const routeStatusListener = vi.fn();
    const iframeStyle = {
      height: "600px",
      pointerEvents: "auto",
      visibility: "visible",
      width: "800px",
    };
    const runtime = {
      activeRoute: {
        location: { hash: "", params: {}, pathname: "/addons/test-addon/next", search: "" },
        routeId: "next",
      },
      activeRouteRequestId: "request-1",
      addonId: "test-addon",
      iframe: { style: iframeStyle },
      lastRenderedRouteKey: "previous-route",
      routeStatusListeners: new Set([routeStatusListener]),
    };

    const internals = manager as unknown as {
      handleRouteRenderError: (runtime: unknown, message: unknown) => void;
    };
    internals.handleRouteRenderError(runtime, {
      error: "Route component failed",
      requestId: "request-1",
    });

    expect(runtime.lastRenderedRouteKey).toBeUndefined();
    expect(iframeStyle).toMatchObject({
      height: "0",
      pointerEvents: "none",
      visibility: "hidden",
      width: "0",
    });
    expect(routeStatusListener).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Route component failed", status: "error" }),
    );
  });

  it("loads runtime Blobs before sending addon code and requires protocol version 1", async () => {
    const fetchMock = successfulRuntimeFetch();
    vi.stubGlobal("fetch", fetchMock);
    const manager = new AddonIframeManager();
    const starting = manager.startAddon(input);
    await vi.waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
    const iframe = getSandboxFrame();
    const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation(() => {});
    expect(iframe.getAttribute("src")).toBeNull();
    expect(iframe.srcdoc).toContain('id="addon-root"');
    expect(new URLSearchParams(iframe.name).get("hostBaseUrl")).toBeTruthy();

    dispatchFromSandbox(iframe, "bootstrapReady");
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          protocolVersion: 1,
          script: expect.any(Blob),
          stylesheet: expect.any(Blob),
          type: "loadRuntime",
        }),
        "*",
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);

    dispatchFromSandbox(iframe, "ready", { runtimeProtocolVersion: 1 });
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ code: input.code, type: "loadAddon" }),
        "*",
      ),
    );
    dispatchFromSandbox(iframe, "loaded");
    await expect(starting).resolves.toBeDefined();
    await manager.stopAllAddons();

    const postedTypes = postMessage.mock.calls.map(([message]) => message.type);
    expect(postedTypes.indexOf("loadRuntime")).toBeLessThan(postedTypes.indexOf("loadAddon"));
  });

  it("posts the same cached Blob instances to simultaneous addon frames", async () => {
    const fetchMock = successfulRuntimeFetch();
    vi.stubGlobal("fetch", fetchMock);
    const manager = new AddonIframeManager();
    const firstStart = manager.startAddon(input);
    const secondInput = {
      ...input,
      addonId: "second-addon",
      manifest: { ...input.manifest, id: "second-addon", name: "Second Addon" },
    };
    const secondStart = manager.startAddon(secondInput);
    await vi.waitFor(() => expect(document.querySelectorAll("iframe")).toHaveLength(2));
    const firstFrame = getSandboxFrame();
    const secondFrame = getSandboxFrame(secondInput.addonId);
    const firstPost = vi
      .spyOn(firstFrame.contentWindow!, "postMessage")
      .mockImplementation(() => {});
    const secondPost = vi
      .spyOn(secondFrame.contentWindow!, "postMessage")
      .mockImplementation(() => {});

    dispatchFromSandbox(firstFrame, "bootstrapReady");
    dispatchFromSandbox(secondFrame, "bootstrapReady");
    await vi.waitFor(() => {
      expect(firstPost).toHaveBeenCalledWith(expect.objectContaining({ type: "loadRuntime" }), "*");
      expect(secondPost).toHaveBeenCalledWith(
        expect.objectContaining({ type: "loadRuntime" }),
        "*",
      );
    });

    const firstPayload = firstPost.mock.calls.find(
      ([message]) => message.type === "loadRuntime",
    )?.[0];
    const secondPayload = secondPost.mock.calls.find(
      ([message]) => message.type === "loadRuntime",
    )?.[0];
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(firstPayload?.script).toBe(secondPayload?.script);
    expect(firstPayload?.stylesheet).toBe(secondPayload?.stylesheet);

    await manager.stopAllAddons();
    await expect(firstStart).rejects.toMatchObject({ name: "AddonLoadCancelled" });
    await expect(secondStart).rejects.toMatchObject({ name: "AddonLoadCancelled" });
  });

  it("rejects an incompatible runtime protocol and tears down the iframe", async () => {
    vi.stubGlobal("fetch", successfulRuntimeFetch());
    const manager = new AddonIframeManager();
    const starting = manager.startAddon(input);
    await vi.waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
    const iframe = getSandboxFrame();
    vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation(() => {});

    dispatchFromSandbox(iframe, "bootstrapReady");
    await Promise.resolve();
    dispatchFromSandbox(iframe, "ready", { runtimeProtocolVersion: 2 });

    await expect(starting).rejects.toThrow("expected 1, received 2");
    await vi.waitFor(() => expect(document.querySelector("iframe")).toBeNull());
  });

  it("ignores bootstrap messages with a wrong nonce or source", async () => {
    const fetchMock = successfulRuntimeFetch();
    vi.stubGlobal("fetch", fetchMock);
    const manager = new AddonIframeManager();
    const starting = manager.startAddon(input);
    await vi.waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
    const iframe = getSandboxFrame();
    const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation(() => {});

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { addonId: input.addonId, channel: CHANNEL, nonce: "wrong", type: "bootstrapReady" },
        source: iframe.contentWindow,
      }),
    );
    dispatchFromSandbox(iframe, "bootstrapReady", {}, window);
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
    await manager.stopAllAddons();
    await expect(starting).rejects.toMatchObject({ name: "AddonLoadCancelled" });
  });

  it("fails immediately when the shared runtime is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const manager = new AddonIframeManager();
    const starting = manager.startAddon(input);
    await vi.waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
    const iframe = getSandboxFrame();
    vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation(() => {});

    dispatchFromSandbox(iframe, "bootstrapReady");

    await expect(starting).rejects.toThrow("Sandbox runtime unavailable");
    await vi.waitFor(() => expect(document.querySelector("iframe")).toBeNull());
  });

  it("surfaces phase-specific bootstrap errors and removes the runtime", async () => {
    const manager = new AddonIframeManager();
    const starting = manager.startAddon(input);
    await vi.waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
    const iframe = getSandboxFrame();
    vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation(() => {});

    dispatchFromSandbox(iframe, "loadError", {
      error: "Sandbox runtime stylesheet failed to load",
      phase: "loading runtime stylesheet",
    });

    await expect(starting).rejects.toThrow(
      "Sandbox failed during loading runtime stylesheet: Sandbox runtime stylesheet failed to load",
    );
    await vi.waitFor(() => expect(document.querySelector("iframe")).toBeNull());
  });
});
