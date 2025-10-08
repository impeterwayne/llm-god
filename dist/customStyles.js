import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
const CONFIG_FILENAME = "custom-styles.json";
const LLM_HOST_PATTERNS = {
    chatgpt: /^https?:\/\/(?:www\.)?(?:chat\.openai\.com|chatgpt\.com)(?:[\/?#].*|$)/i,
    gemini: /^https?:\/\/gemini\.google\.com(?:[\/?#].*|$)/i,
    perplexity: /^https?:\/\/(?:www\.)?perplexity\.ai(?:[\/?#].*|$)/i,
    lmarena: /^https?:\/\/(?:www\.)?lmarena\.ai(?:[\/?#].*|$)/i,
    claude: /^https?:\/\/claude\.ai(?:[\/?#].*|$)/i,
    grok: /^https?:\/\/(?:www\.)?grok\.com(?:[\/?#].*|$)/i,
    deepseek: /^https?:\/\/chat\.deepseek\.com(?:[\/?#].*|$)/i,
};
const BUILT_IN_MATCH_GROUPS = {
    "@llms": Object.values(LLM_HOST_PATTERNS),
    "@chatgpt": [LLM_HOST_PATTERNS.chatgpt],
    "@gemini": [LLM_HOST_PATTERNS.gemini],
    "@perplexity": [LLM_HOST_PATTERNS.perplexity],
    "@lmarena": [LLM_HOST_PATTERNS.lmarena],
    "@claude": [LLM_HOST_PATTERNS.claude],
    "@grok": [LLM_HOST_PATTERNS.grok],
    "@deepseek": [LLM_HOST_PATTERNS.deepseek],
};
let configPath;
let cachedStyles = [];
let cachedConfigMTime = 0;
const appliedStyles = new WeakMap();
const darkModeApplied = new WeakSet();
function getConfigPath() {
    if (!configPath) {
        configPath = path.join(app.getPath("userData"), CONFIG_FILENAME);
    }
    return configPath;
}
const HEADING_TINT_COMMENT = "Example: tint headings on all bundled LLM tabs";
function getDefaultStyles() {
    const sharedHeadingSelectors = `h1,
h2,
h3,
h4,
h5,
h6,
strong,
b { color: #58aefd !important; }`;
    return [
        {
            match: "@chatgpt",
            css: `/* ${HEADING_TINT_COMMENT} */
h1,
h2,
h3,
h4,
h5,
h6,
strong,
b,
.font-semibold,
[class*="font-bold"] { color: #58aefd !important; }
`,
        },
        {
            match: "@gemini",
            css: `/* ${HEADING_TINT_COMMENT} */
${sharedHeadingSelectors}
`,
        },
        {
            match: "@perplexity",
            css: `/* ${HEADING_TINT_COMMENT} */
${sharedHeadingSelectors}
`,
        },
        {
            match: "@claude",
            css: `/* ${HEADING_TINT_COMMENT} */
${sharedHeadingSelectors}
`,
        },
        {
            match: "@grok",
            css: `/* ${HEADING_TINT_COMMENT} */
${sharedHeadingSelectors}
`,
        },
        {
            match: "@deepseek",
            css: `/* ${HEADING_TINT_COMMENT} */
${sharedHeadingSelectors}
`,
        },
        {
            match: "@lmarena",
            css: `/* ${HEADING_TINT_COMMENT} */
${sharedHeadingSelectors}
`,
        },
    ];
}
function ensureConfigFile(filePath) {
    if (fs.existsSync(filePath)) {
        return;
    }
    const defaults = getDefaultStyles();
    const payload = { styles: defaults };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}
function readRawConfig(filePath) {
    ensureConfigFile(filePath);
    const fileContents = fs.readFileSync(filePath, "utf8");
    try {
        const parsed = JSON.parse(fileContents);
        if (!Array.isArray(parsed.styles)) {
            return [];
        }
        return upgradeLegacyConfig(filePath, parsed.styles).filter((entry) => typeof entry?.match === "string" && typeof entry?.css === "string");
    }
    catch (error) {
        console.warn("Failed to parse custom style configuration", error);
        return [];
    }
}
function upgradeLegacyConfig(filePath, styles) {
    const legacyGeminiMatcher = "^https?:\\/\\/gemini\\.google\\.com\\/";
    let requiresRewrite = false;
    const migrated = styles.map((style) => {
        if (style.match === legacyGeminiMatcher &&
            /Example:\s*tint headings/i.test(style.css)) {
            requiresRewrite = true;
            return { ...style, match: "@llms" };
        }
        return style;
    });
    if (migrated.length === 1 &&
        migrated[0]?.match === "@llms" &&
        typeof migrated[0]?.css === "string" &&
        new RegExp(HEADING_TINT_COMMENT, "i").test(migrated[0].css) &&
        /color:\s*#58aefd/i.test(migrated[0].css)) {
        requiresRewrite = true;
        migrated.splice(0, migrated.length, ...getDefaultStyles());
    }
    if (requiresRewrite) {
        try {
            fs.writeFileSync(filePath, JSON.stringify({ styles: migrated }, null, 2), "utf8");
        }
        catch (error) {
            console.warn("Unable to upgrade custom style configuration", error);
        }
    }
    return migrated;
}
function expandMatchers(match) {
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
    }
    catch (error) {
        console.warn(`Ignoring invalid custom style matcher: ${match}`, error);
        return [];
    }
}
function compileStyles(definitions) {
    const compiled = [];
    definitions.forEach(({ match, css }) => {
        const patterns = expandMatchers(match);
        patterns.forEach((pattern) => {
            compiled.push({ pattern, css });
        });
    });
    return compiled;
}
function getCompiledStyles() {
    const filePath = getConfigPath();
    try {
        const stats = fs.statSync(filePath);
        if (stats.mtimeMs !== cachedConfigMTime) {
            cachedStyles = compileStyles(readRawConfig(filePath));
            cachedConfigMTime = stats.mtimeMs;
        }
    }
    catch (error) {
        if (error.code === "ENOENT") {
            ensureConfigFile(filePath);
            cachedStyles = compileStyles(getDefaultStyles());
            cachedConfigMTime = Date.now();
        }
        else {
            console.warn("Unable to load custom style configuration", error);
        }
    }
    return cachedStyles;
}
function ensureDarkColorScheme(webContents) {
    const emulate = webContents.emulateMediaFeatures;
    if (typeof emulate === "function") {
        try {
            emulate.call(webContents, [{ name: "prefers-color-scheme", value: "dark" }]);
            return;
        }
        catch (error) {
            console.warn("Unable to emulate dark color scheme", error);
        }
    }
    if (darkModeApplied.has(webContents)) {
        return;
    }
    darkModeApplied.add(webContents);
    Promise.resolve(webContents.insertCSS(":root { color-scheme: dark !important; }"))
        .catch((error) => console.warn("Unable to inject dark color scheme fallback", error));
}
function toBase64Url(input) {
    return Buffer.from(input)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}
function injectStyles(webContents) {
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
    const duplicateCounts = new Map();
    const stylesWithIds = stylesForUrl.map(({ pattern, css }) => {
        const patternKey = `${pattern.source}\u0000${pattern.flags}`;
        const occurrence = duplicateCounts.get(patternKey) ?? 0;
        duplicateCounts.set(patternKey, occurrence + 1);
        return {
            identifier: toBase64Url(`${patternKey}\u0000${occurrence}`),
            css,
        };
    });
    const appliedForView = appliedStyles.get(webContents) ?? new Map();
    const desiredMap = new Map();
    const additions = [];
    const removals = [];
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
export function applyCustomStyles(webContents) {
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
export function registerSiteStyle(style) {
    const patterns = typeof style.match === "string" ? expandMatchers(style.match) : [style.match];
    cachedStyles = [
        ...getCompiledStyles(),
        ...patterns.map((pattern) => ({ pattern, css: style.css })),
    ];
}
