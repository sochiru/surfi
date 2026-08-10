import { resolveAddonAssetPath } from "./addon-sandbox-asset-registry";

export interface SandboxAddonFile {
  name: string;
  content: string;
  isMain?: boolean;
}

const ADDON_STYLE_ATTRIBUTE = "data-wealthfolio-addon-style";

export function isCssFile(path: string) {
  return path.toLowerCase().endsWith(".css");
}

function findAddonStyleElement(path: string) {
  return Array.from(
    document.head.querySelectorAll<HTMLStyleElement>(`style[${ADDON_STYLE_ATTRIBUTE}]`),
  ).find((element) => element.getAttribute(ADDON_STYLE_ATTRIBUTE) === path);
}

export function installAddonStyle(path: string, css: string) {
  let styleElement = findAddonStyleElement(path);
  if (!styleElement) {
    styleElement = document.createElement("style");
    styleElement.setAttribute(ADDON_STYLE_ATTRIBUTE, path);
    document.head.appendChild(styleElement);
  }
  styleElement.textContent = css;
}

interface CssUrlToken {
  end: number;
  start: number;
  value: string;
}

function findCssUrlTokens(css: string) {
  const tokens: CssUrlToken[] = [];
  let index = 0;

  while (index < css.length) {
    if (css.startsWith("/*", index)) {
      const commentEnd = css.indexOf("*/", index + 2);
      index = commentEnd === -1 ? css.length : commentEnd + 2;
      continue;
    }
    const character = css[index];
    if (character === '"' || character === "'") {
      const quote = character;
      index += 1;
      while (index < css.length) {
        if (css[index] === "\\") {
          index += 2;
        } else if (css[index] === quote) {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
      continue;
    }
    if (
      css.slice(index, index + 7).toLowerCase() === "@import" &&
      !/[\w-]/.test(css[index + 7] ?? "")
    ) {
      throw new Error("Addon CSS @import rules are not supported; bundle or package the CSS file");
    }

    const candidate = css.slice(index, index + 3);
    const previous = index > 0 ? css[index - 1] : "";
    if (candidate.toLowerCase() !== "url" || /[\w-]/.test(previous)) {
      index += 1;
      continue;
    }

    let cursor = index + 3;
    while (/\s/.test(css[cursor] ?? "")) cursor += 1;
    if (css[cursor] !== "(") {
      index += 1;
      continue;
    }
    cursor += 1;
    while (/\s/.test(css[cursor] ?? "")) cursor += 1;

    const quote = css[cursor] === '"' || css[cursor] === "'" ? css[cursor] : undefined;
    if (quote) cursor += 1;
    const valueStart = cursor;
    let valueEnd = cursor;
    while (cursor < css.length) {
      if (css[cursor] === "\\") {
        cursor += 2;
        valueEnd = cursor;
        continue;
      }
      if ((quote && css[cursor] === quote) || (!quote && css[cursor] === ")")) {
        valueEnd = cursor;
        break;
      }
      cursor += 1;
      valueEnd = cursor;
    }
    if (quote && css[cursor] === quote) cursor += 1;
    while (/\s/.test(css[cursor] ?? "")) cursor += 1;
    if (css[cursor] !== ")") {
      index += 3;
      continue;
    }

    tokens.push({
      end: cursor + 1,
      start: index,
      value: css.slice(valueStart, valueEnd).trim(),
    });
    index = cursor + 1;
  }

  return tokens;
}

export async function resolveAddonCssAssetUrls(
  stylesheetPath: string,
  css: string,
  getAssetUrl: (path: string) => Promise<string>,
) {
  const tokens = findCssUrlTokens(css);
  const replacements = await Promise.all(
    tokens.map(async (token) => {
      const rawUrl = token.value;
      const lowerUrl = rawUrl.toLowerCase();
      if (
        !rawUrl ||
        rawUrl.startsWith("#") ||
        lowerUrl.startsWith("data:") ||
        lowerUrl.startsWith("blob:")
      ) {
        return { ...token, replacement: css.slice(token.start, token.end) };
      }
      if (rawUrl.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(rawUrl)) {
        throw new Error(
          `Remote CSS URL '${rawUrl}' in '${stylesheetPath}' is not a packaged addon asset`,
        );
      }

      const queryIndex = rawUrl.indexOf("?");
      const fragmentIndex = rawUrl.indexOf("#");
      const pathEnd = [queryIndex, fragmentIndex]
        .filter((index) => index !== -1)
        .reduce((earliest, index) => Math.min(earliest, index), rawUrl.length);
      const path = rawUrl.slice(0, pathEnd);
      const fragment = fragmentIndex === -1 ? "" : rawUrl.slice(fragmentIndex);
      const resolvedPath = resolveAddonAssetPath(path, stylesheetPath);
      const objectUrl = await getAssetUrl(resolvedPath);
      return { ...token, replacement: `url(${JSON.stringify(`${objectUrl}${fragment}`)})` };
    }),
  );

  let result = "";
  let cursor = 0;
  for (const replacement of replacements) {
    result += css.slice(cursor, replacement.start);
    result += replacement.replacement;
    cursor = replacement.end;
  }
  return result + css.slice(cursor);
}

export async function installAddonCssFiles(
  files: SandboxAddonFile[] = [],
  getAssetUrl?: (path: string) => Promise<string>,
) {
  clearAddonStyles();
  for (const file of files) {
    if (isCssFile(file.name) && file.content.trim()) {
      const css = getAssetUrl
        ? await resolveAddonCssAssetUrls(file.name, file.content, getAssetUrl)
        : file.content;
      installAddonStyle(file.name, css);
    }
  }
}

export function clearAddonStyles() {
  for (const styleElement of document.head.querySelectorAll<HTMLStyleElement>(
    `style[${ADDON_STYLE_ATTRIBUTE}]`,
  )) {
    styleElement.remove();
  }
}

export function createCssModuleSource(css: string) {
  return `
const css = ${JSON.stringify(css)};
export default css;
`;
}
