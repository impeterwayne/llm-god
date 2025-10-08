import { app, WebContents } from "electron";
import fs from "node:fs";
import path from "node:path";

interface RawStyleDefinition {
  /**
   * A string that will be converted into a regular expression and matched
   * against the full URL loaded inside the BrowserView.
   */
  match: string;
  /**
   * CSS that will be injected via `webContents.insertCSS` when the `match`
   * expression succeeds.
   */
  css: string;
}

interface CompiledStyleDefinition {
  pattern: RegExp;
  css: string;
}

const LLM_HOST_PATTERNS = {
  chatgpt: /^https?:\/\/(?:www\.)?(?:chat\.openai\.com|chatgpt\.com)(?:[\/?#].*|$)/i,
  gemini: /^https?:\/\/gemini\.google\.com(?:[\/?#].*|$)/i,
  perplexity: /^https?:\/\/(?:www\.)?perplexity\.ai(?:[\/?#].*|$)/i,
  lmarena: /^https?:\/\/(?:www\.)?lmarena\.ai(?:[\/?#].*|$)/i,
  claude: /^https?:\/\/claude\.ai(?:[\/?#].*|$)/i,
  grok: /^https?:\/\/(?:www\.)?grok\.com(?:[\/?#].*|$)/i,
  deepseek: /^https?:\/\/chat\.deepseek\.com(?:[\/?#].*|$)/i,
} as const satisfies Record<string, RegExp>;

const BUILT_IN_MATCH_GROUPS: Record<string, RegExp[]> = {
  "@llms": Object.values(LLM_HOST_PATTERNS),
  "@chatgpt": [LLM_HOST_PATTERNS.chatgpt],
  "@gemini": [LLM_HOST_PATTERNS.gemini],
  "@perplexity": [LLM_HOST_PATTERNS.perplexity],
  "@lmarena": [LLM_HOST_PATTERNS.lmarena],
  "@claude": [LLM_HOST_PATTERNS.claude],
  "@grok": [LLM_HOST_PATTERNS.grok],
  "@deepseek": [LLM_HOST_PATTERNS.deepseek],
};

let cachedStyles: CompiledStyleDefinition[] = [];
const appliedStyles = new WeakMap<WebContents, Map<string, string>>();
const darkModeApplied = new WeakSet<WebContents>();

const HEADING_TINT_COMMENT = "Example: tint headings on all bundled LLM tabs";

function getDefaultStyles(): RawStyleDefinition[] {
  const headingSelectors = `h1,
h2,
h3,
h4,
h5,
h6,
strong,
b,
.font-semibold,
[class*="font-bold"] { color: #58aefd !important; }`;

  return [
    {
      match: "@llms",
      css: `/* ${HEADING_TINT_COMMENT} */
${headingSelectors}
`,
    },
  ];
}

function expandMatchers(match: string): RegExp[] {
  const trimmed = match.trim();
  if (trimmed.startsWith("@")) {
    const group = BUILT_IN_MATCH_GROUPS[trimmed.toLowerCase()];
    if (group) {
      return group.map((pattern) => new RegExp(pattern.source, pattern.flags));
    }

    console.warn(`Unknown custom style alias: ${match}. Falling back to regex interpretation.`);
  }

  try {
    return [new RegExp(match)];
  } catch (error) {
    console.warn(`Ignoring invalid custom style matcher: ${match}`, error);
    return [];
  }
}

function compileStyles(definitions: RawStyleDefinition[]): CompiledStyleDefinition[] {
  const compiled: CompiledStyleDefinition[] = [];

  definitions.forEach(({ match, css }) => {
    const patterns = expandMatchers(match);
    patterns.forEach((pattern) => {
      compiled.push({ pattern, css });
    });
  });

  return compiled;
}

function getCompiledStyles(): CompiledStyleDefinition[] {
  if (cachedStyles.length === 0) {
    cachedStyles = compileStyles(getDefaultStyles());
  }
  return cachedStyles;
}

function ensureDarkColorScheme(webContents: WebContents) {
  const emulate = (
    webContents as WebContents & {
      emulateMediaFeatures?: (features: Array<{ name: string; value: string }>) => void;
    }
  ).emulateMediaFeatures;

  if (typeof emulate === "function") {
    try {
      emulate.call(webContents, [{ name: "prefers-color-scheme", value: "dark" }]);
      return;
    } catch (error) {
      console.warn("Unable to emulate dark color scheme", error);
    }
  }

  if (darkModeApplied.has(webContents)) {
    return;
  }

  darkModeApplied.add(webContents);
  Promise.resolve(webContents.insertCSS(":root { color-scheme: dark !important; }"))
    .catch((error: unknown) =>
      console.warn("Unable to inject dark color scheme fallback", error),
    );
}

function toBase64Url(input: string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function injectStyles(webContents: WebContents) {
  const url = webContents.getURL();
  const stylesForUrl = getCompiledStyles().filter(({ pattern }) => pattern.test(url));

  if (stylesForUrl.length === 0) {
    const existing = appliedStyles.get(webContents);
    if (existing?.size) {
      appliedStyles.set(webContents, new Map());
      void webContents.executeJavaScript(`(() => {
        const registry = window.__llmGodStyles;
        if (!registry) {
          return;
        }

        const doc = document;
        if (!doc) {
          return;
        }

        Object.keys(registry).forEach((identifier) => {
          delete registry[identifier];
        });

        doc
          .querySelectorAll('style[data-llmgod-style]')
          .forEach((node) => node.remove());
      })();`);
    }
    return;
  }

  const duplicateCounts = new Map<string, number>();
  const stylesWithIds = stylesForUrl.map(({ pattern, css }) => {
    const patternKey = `${pattern.source}\u0000${pattern.flags}`;
    const occurrence = duplicateCounts.get(patternKey) ?? 0;
    duplicateCounts.set(patternKey, occurrence + 1);

    return {
      identifier: toBase64Url(`${patternKey}\u0000${occurrence}`),
      css,
    };
  });

  const appliedForView = appliedStyles.get(webContents) ?? new Map<string, string>();
  const desiredMap = new Map<string, string>();
  const additions: Array<{ identifier: string; css: string }> = [];
  const removals: string[] = [];

  stylesWithIds.forEach(({ identifier, css }) => {
    desiredMap.set(identifier, css);
    if (appliedForView.get(identifier) !== css) {
      additions.push({ identifier, css });
    }
  });

  appliedForView.forEach((_, identifier) => {
    if (!desiredMap.has(identifier)) {
      removals.push(identifier);
    }
  });

  if (additions.length === 0 && removals.length === 0) {
    return;
  }

  appliedStyles.set(webContents, desiredMap);

  const additionsPayload = JSON.stringify(additions);
  const removalsPayload = JSON.stringify(removals);

  void webContents.executeJavaScript(`(() => {
    const additions = ${additionsPayload};
    const removals = ${removalsPayload};
    const globalObj = window;
    globalObj.__llmGodStyles = globalObj.__llmGodStyles || {};

    additions.forEach(function (entry) {
      globalObj.__llmGodStyles[entry.identifier] = entry.css;
    });

    removals.forEach(function (identifier) {
      delete globalObj.__llmGodStyles[identifier];
    });

    const doc = document;
    if (!doc) {
      return;
    }

    const apply = function () {
      const registry = globalObj.__llmGodStyles || {};
      const target = doc.head || doc.documentElement;
      if (!target) {
        return;
      }

      const desiredIds = new Set(Object.keys(registry));
      doc
        .querySelectorAll('style[data-llmgod-style]')
        .forEach(function (node) {
          const identifier = node.getAttribute('data-llmgod-style');
          if (!identifier || !desiredIds.has(identifier)) {
            node.remove();
            return;
          }

          const css = registry[identifier];
          if (typeof css === 'string' && node.textContent !== css) {
            node.textContent = css;
          }

          desiredIds.delete(identifier);
        });

      desiredIds.forEach(function (identifier) {
        const css = registry[identifier];
        if (typeof css !== 'string') {
          return;
        }

        const styleEl = doc.createElement('style');
        styleEl.type = 'text/css';
        styleEl.setAttribute('data-llmgod-style', identifier);
        styleEl.appendChild(doc.createTextNode(css));
        (doc.head || doc.documentElement).appendChild(styleEl);
      });
    };

    globalObj.__llmGodApplyStyles = apply;
    apply();

    if (!globalObj.__llmGodStyleObserver) {
      try {
        const observer = new MutationObserver(function () {
          try {
            if (typeof globalObj.__llmGodApplyStyles === 'function') {
              globalObj.__llmGodApplyStyles();
            }
          } catch (error) {
            console.warn('LLM-God style observer failed to reapply styles', error);
          }
        });
        observer.observe(doc.documentElement, { childList: true, subtree: true });
        globalObj.__llmGodStyleObserver = observer;
      } catch (error) {
        console.warn('LLM-God failed to initialise style observer', error);
      }
    }
  })();`);
}

export function applyCustomStyles(webContents: WebContents): void {
  const applyStyles = () => {
    ensureDarkColorScheme(webContents);
    injectStyles(webContents);
  };

  webContents.on("did-finish-load", applyStyles);
  webContents.on("did-navigate", applyStyles);
  webContents.on("did-navigate-in-page", applyStyles);

  if (!webContents.isLoadingMainFrame()) {
    applyStyles();
  }
}

export function registerSiteStyle(style: { match: string | RegExp; css: string }): void {
  const patterns =
    typeof style.match === "string" ? expandMatchers(style.match) : [style.match];

  cachedStyles = [
    ...getCompiledStyles(),
    ...patterns.map((pattern) => ({ pattern, css: style.css })),
  ];
}
