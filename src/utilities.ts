import { BrowserWindow, WebPreferences, WebContentsView } from "electron"; // Added WebPreferences type
import { applyCustomStyles } from "./customStyles.js";
import { DEVTOOLS_AUTO_OPEN } from "./config.js";

interface CustomBrowserView extends WebContentsView {
  id?: string; // Make id optional as it's assigned after creation
}

// Control whether to auto-open DevTools on startup.
// Edit src/config.ts (DEVTOOLS_AUTO_OPEN) for build-time control.
// Or set env var ELECTRON_OPEN_DEVTOOLS_ON_STARTUP=true (runtime override).
const OPEN_DEVTOOLS_ON_STARTUP =
  DEVTOOLS_AUTO_OPEN ||
  (process.env.ELECTRON_OPEN_DEVTOOLS_ON_STARTUP ?? "").toLowerCase() ===
    "true" ||
  (process.env.SHOW_DEVTOOLS ?? "").toLowerCase() === "true";

export function ensureDetachedDevTools(view: CustomBrowserView): void {
  // If disabled, do nothing so DevTools can be opened manually later.
  if (!OPEN_DEVTOOLS_ON_STARTUP) return;

  const devToolsEvents = [
    "did-finish-load",
    "dom-ready",
    "did-frame-finish-load",
  ] as const;

  let devToolsRetryInterval: NodeJS.Timeout | undefined;

  const startDevToolsRetryInterval = () => {
    if (!devToolsRetryInterval) {
      devToolsRetryInterval = setInterval(() => {
        attemptOpenDevTools();
      }, 1000);
    }
  };

  const stopDevToolsRetryInterval = () => {
    if (devToolsRetryInterval) {
      clearInterval(devToolsRetryInterval);
      devToolsRetryInterval = undefined;
    }
  };

  const attemptOpenDevTools = () => {
    if (view.webContents.isDestroyed()) {
      stopDevToolsRetryInterval();
      return;
    }

    if (view.webContents.isDevToolsOpened()) {
      stopDevToolsRetryInterval();
      return;
    }

    startDevToolsRetryInterval();

    try {
      view.webContents.openDevTools({ mode: "detach" });
    } catch (error) {
      console.warn("Failed to open devtools for view", view.id, error);
    }
  };

  const handleLifecycleEvent = () => {
    attemptOpenDevTools();
  };

  const handleDevToolsOpened = () => {
    stopDevToolsRetryInterval();
  };

  const handleDevToolsClosed = () => {
    startDevToolsRetryInterval();
    attemptOpenDevTools();
  };

  devToolsEvents.forEach((event) => {
    view.webContents.on(event as unknown as any, handleLifecycleEvent);
  });

  view.webContents.on("devtools-opened", handleDevToolsOpened);
  view.webContents.on("devtools-closed", handleDevToolsClosed);

  view.webContents.once("destroyed", () => {
    devToolsEvents.forEach((event) => {
      view.webContents.removeListener(
        event as unknown as any,
        handleLifecycleEvent as unknown as (...args: unknown[]) => void,
      );
    });
    view.webContents.removeListener("devtools-opened", handleDevToolsOpened);
    view.webContents.removeListener("devtools-closed", handleDevToolsClosed);
    stopDevToolsRetryInterval();
  });

  attemptOpenDevTools();
}

export interface SerializedFile {
  name: string;
  type: string;
  size: number;
  lastModified: number;
  data: string;
}

/**
 * Creates and configures a new BrowserView for the main window
 * @param mainWindow - The main Electron window
 * @param url - The URL to load in the browser view
 * @param websites - Array of currently open website URLs
 * @param views - Array of currently open BrowserViews
 * @param webPreferences - Optional web preferences for the BrowserView
 * @returns The newly created BrowserView
 */
export function addBrowserView(
  mainWindow: BrowserWindow,
  url: string,
  websites: string[],
  views: CustomBrowserView[],
  options: { webPreferences?: WebPreferences; promptAreaHeight?: number; sidebarWidth?: number } = {},
): CustomBrowserView {
  const { webPreferences = {}, promptAreaHeight = 0, sidebarWidth = 0 } = options;

  const view: CustomBrowserView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devTools: true,
      ...webPreferences,
    },
  });

  view.id = url;
  mainWindow.contentView.addChildView(view);

  const { width, height } = mainWindow.getContentBounds();
  const availableHeight = Math.max(height - promptAreaHeight, 0);
  const offset = Math.ceil(Math.max(0, sidebarWidth));

  websites.push(url);
  const availableWidth = Math.max(width - offset, 0);
  const viewWidth = Math.floor(availableWidth / websites.length);

  views.forEach((v, index) => {
    v.setBounds({
      x: offset + index * viewWidth,
      y: 0,
      width: viewWidth,
      height: availableHeight,
    });
  });

  view.setBounds({
    x: offset + (websites.length - 1) * viewWidth,
    y: 0,
    width: viewWidth,
    height: availableHeight,
  });

  view.webContents.setZoomFactor(1.5);
  applyCustomStyles(view.webContents);
  view.webContents.loadURL(url);

  ensureDetachedDevTools(view);

  views.push(view);
  return view;
}

export function removeBrowserView(
  mainWindow: BrowserWindow,
  viewToRemove: CustomBrowserView, // Changed to viewToRemove for clarity
  websites: string[],
  views: CustomBrowserView[],
  options: { promptAreaHeight?: number; sidebarWidth?: number } = {},
): void {
  const { promptAreaHeight = 0, sidebarWidth = 0 } = options;

  const viewIndex = views.indexOf(viewToRemove);
  if (viewIndex === -1) return;

  mainWindow.contentView.removeChildView(viewToRemove);

  const urlIndex = websites.findIndex((url) => url === viewToRemove.id);
  if (urlIndex !== -1) {
    websites.splice(urlIndex, 1);
  }

  views.splice(viewIndex, 1);

  if (views.length === 0) return;

  const { width, height } = mainWindow.getContentBounds();
  const availableHeight = Math.max(height - promptAreaHeight, 0);
  const offset = Math.ceil(Math.max(0, sidebarWidth));
  const availableWidth = Math.max(width - offset, 0);
  const viewWidth = Math.floor(availableWidth / views.length);

  views.forEach((v, index) => {
    v.setBounds({
      x: offset + index * viewWidth,
      y: 0,
      width: viewWidth,
      height: availableHeight,
    });
  });
}

export function injectPromptIntoView(
  view: CustomBrowserView,
  prompt: string,
): void {
  if (view.id && view.id.match("chatgpt")) {
    view.webContents.executeJavaScript(`
      ((prompt) => {
        const inputElement = document.querySelector('#prompt-textarea > p');
        if (inputElement) {
          const inputEvent = new Event('input', { bubbles: true });
          inputElement.innerText = prompt;
          inputElement.dispatchEvent(inputEvent);
        }
      })(${JSON.stringify(prompt)});
    `);
  } else if (view.id && view.id.match("gemini")) {
    view.webContents.executeJavaScript(`
      ((prompt) => {
        const inputElement = document.querySelector('.ql-editor.textarea');
        if (inputElement) {
          const inputEvent = new Event('input', { bubbles: true });
          inputElement.value = prompt;
          inputElement.dispatchEvent(inputEvent);
          const paragraph = inputElement.querySelector('p');
          if (paragraph) {
            paragraph.textContent = prompt;
          }
        }
      })(${JSON.stringify(prompt)});
    `);
  } else if (view.id && view.id.match("perplexity")) {
    view.webContents.executeJavaScript(`
      (async (prompt) => {
        const waitForElement = (selector, checkFn = null, timeout = 10000) => {
          return new Promise((resolve, reject) => {
            // Check if already exists
            const existing = document.getElementById(selector) || document.querySelector(selector);
            if (existing && (!checkFn || checkFn(existing))) {
              resolve(existing);
              return;
            }

            // Use MutationObserver to watch for changes
            const observer = new MutationObserver((mutations, obs) => {
              const element = document.getElementById(selector) || document.querySelector(selector);
              if (element && (!checkFn || checkFn(element))) {
                obs.disconnect();
                resolve(element);
              }
            });

            observer.observe(document.body, {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: ['class', 'id']
            });

            // Timeout fallback
            setTimeout(() => {
              observer.disconnect();
              reject(new Error('Element not found within timeout'));
            }, timeout);
          });
        };

        try {
          console.log('[Perplexity] Waiting for editor...');
          
          // Wait for editor with Lexical check
          const editorElement = await waitForElement(
            'ask-input',
            (el) => el.__lexicalEditor || el.tagName === 'TEXTAREA'
          );

          console.log('[Perplexity] Editor ready!');

          if (editorElement && editorElement.__lexicalEditor) {
            const editor = editorElement.__lexicalEditor;
            console.log('[Perplexity] Using Lexical editor');

            editor.focus();
            const newState = {
              root: {
                children: [
                  {
                    children: [
                      {
                        detail: 0,
                        format: 0,
                        mode: 'normal',
                        style: '',
                        text: prompt,
                        type: 'text',
                        version: 1,
                      },
                    ],
                    direction: 'ltr',
                    format: '',
                    indent: 0,
                    type: 'paragraph',
                    version: 1,
                  },
                ],
                direction: 'ltr',
                format: '',
                indent: 0,
                type: 'root',
                version: 1,
              },
            };
            const editorState = editor.parseEditorState(JSON.stringify(newState));
            editor.setEditorState(editorState);
            const dataTransfer = new DataTransfer();
            dataTransfer.setData('text/plain', '');
            const targetElement = editorElement.querySelector('[role="textbox"]') || editorElement;
            const pasteEvent = new ClipboardEvent('paste', {
              clipboardData: dataTransfer,
              bubbles: true,
              cancelable: true,
              composed: true,
            });
            targetElement.dispatchEvent(pasteEvent);
          } else if (editorElement) {
            console.log('[Perplexity] Using textarea fallback');
            const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
              window.HTMLTextAreaElement.prototype,
              'value',
            )?.set;
            nativeTextAreaValueSetter?.call(editorElement, prompt);
            const event = new Event('input', { bubbles: true });
            editorElement.dispatchEvent(event);
          }
        } catch (error) {
          console.error('[Perplexity] Failed to inject prompt:', error);
        }
      })(${JSON.stringify(prompt)});
    `);
  } else if (view.id && view.id.match("claude")) {
    view.webContents.executeJavaScript(`
      (async (prompt) => {
        const waitForElement = (selector, timeout = 10000) => {
          return new Promise((resolve, reject) => {
            const existing = document.querySelector(selector);
            if (existing) {
              resolve(existing);
              return;
            }

            const observer = new MutationObserver((mutations, obs) => {
              const element = document.querySelector(selector);
              if (element) {
                obs.disconnect();
                resolve(element);
              }
            });

            observer.observe(document.body, {
              childList: true,
              subtree: true
            });

            setTimeout(() => {
              observer.disconnect();
              reject(new Error('Element not found within timeout'));
            }, timeout);
          });
        };

        try {
          console.log('[Claude] Waiting for editor...');
          const inputElement = await waitForElement('div.ProseMirror');
          console.log('[Claude] Editor ready!');
          
          inputElement.innerHTML = prompt;
          inputElement.dispatchEvent(new Event('input', { bubbles: true }));
          inputElement.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (error) {
          console.error('[Claude] Failed to inject prompt:', error);
        }
      })(${JSON.stringify(prompt)});
    `);
  } else if (view.id && view.id.match("grok")) {
    view.webContents.executeJavaScript(`
      ((prompt) => {
        const inputElement = document.querySelector('textarea');
        if (inputElement) {
          const span = inputElement.previousElementSibling;
          if (span) {
            span.classList.add('hidden');
          }
          const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            'value',
          )?.set;
          nativeTextAreaValueSetter?.call(inputElement, prompt);
          const inputEvent = new Event('input', { bubbles: true });
          inputElement.dispatchEvent(inputEvent);
        }
      })(${JSON.stringify(prompt)});
    `);
  } else if (view.id && view.id.match("deepseek")) {
    view.webContents.executeJavaScript(`
      ((prompt) => {
        const inputElement = document.querySelector('textarea');
        if (inputElement) {
          const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            'value',
          )?.set;
          nativeTextAreaValueSetter?.call(inputElement, prompt);
          const inputEvent = new Event('input', { bubbles: true });
          inputElement.dispatchEvent(inputEvent);
        }
      })(${JSON.stringify(prompt)});
    `);
  } else if (view.id && view.id.match("lmarena")) {
    view.webContents.executeJavaScript(`
      ((prompt) => {
        const inputElement = document.querySelector('textarea');
        if (inputElement) {
          const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            'value',
          )?.set;
          nativeTextAreaValueSetter?.call(inputElement, prompt);
          const inputEvent = new Event('input', { bubbles: true });
          inputElement.dispatchEvent(inputEvent);
        }
      })(${JSON.stringify(prompt)});
    `);
  }
}

export async function simulateFileDropInView(
  view: CustomBrowserView,
  files: SerializedFile[],
): Promise<void> {
  if (!files.length) return;

  const script = `
    (async (files) => {
      try {
        const decodeBase64 = (base64) => {
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          return bytes;
        };

        const createFile = (file) => {
          const bytes = decodeBase64(file.data);
          return new File([bytes], file.name || "dropped-file", {
            type: file.type || "application/octet-stream",
            lastModified: file.lastModified || Date.now(),
          });
        };

        const generatedFiles = files.map(createFile);
        const hostname = location.hostname;
        const wait = (ms) => new Promise(r => setTimeout(r, ms));

        // ---------------------------
        // GEMINI-ONLY (de-duped + single-dispatch)
        // ---------------------------
        if (hostname.includes('gemini.google.com')) {
          const sig = generatedFiles.map(f => \`\${f.name}:\${f.size}:\${f.lastModified}\`).join('|');
          const now = Date.now();
          const lockKey = '__LLM_GOD_GEMINI_LOCK__';

          // simple in-tab de-dupe (5s window)
          try {
            const lock = window[lockKey];
            if (lock && lock.sig === sig && (now - lock.ts) < 5000) {
              console.log('[LLM-God] Gemini: duplicate attempt suppressed');
              return true;
            }
            window[lockKey] = { sig, ts: now };
            setTimeout(() => {
              const l = window[lockKey];
              if (l && l.sig === sig) l.ts = 0;
            }, 6000);
          } catch {}

          console.log('[LLM-God] Gemini path: input -> paste -> DnD');

          // Build one DataTransfer reused across strategies.
          const dt = new DataTransfer();
          generatedFiles.forEach(f => dt.items.add(f));

          // Many Google uploaders call webkitGetAsEntry()
          for (const item of dt.items) {
            if (!('webkitGetAsEntry' in item)) {
              try {
                Object.defineProperty(item, 'webkitGetAsEntry', {
                  value: () => ({
                    isFile: true,
                    isDirectory: false,
                    file: (cb) => cb(item.getAsFile()),
                    name: item.getAsFile()?.name || 'file',
                  }),
                  configurable: true,
                });
              } catch {}
            }
          }

          // Deep/shadow/iframe search for <input type="file">
          const enumerateRoots = () => {
            const roots = [document];
            const seen = new Set();
            const push = (root) => {
              if (!root || seen.has(root)) return;
              seen.add(root);
              roots.push(root);
              const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
              let n;
              while ((n = walker.nextNode())) {
                const el = n;
                if (el.shadowRoot) push(el.shadowRoot);
                if (el.tagName === 'IFRAME') {
                  try { if (el.contentDocument) push(el.contentDocument); } catch {}
                }
              }
            };
            push(document);
            return roots;
          };

          const findAnyFileInput = () => {
            for (const root of enumerateRoots()) {
              const q = root.querySelector?.('input[type="file"]');
              if (q) return q;
            }
            return null;
          };

          // 1) Prefer file input assignment (dispatch ONLY 'change')
          const deadline = Date.now() + 5000;
          let input = findAnyFileInput();
          while (!input && Date.now() < deadline) {
            await wait(120);
            input = findAnyFileInput();
          }
          if (input) {
            console.log('[LLM-God] Gemini: file input found, assigning files (change only)');
            try {
              const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
              if (desc?.set) desc.set.call(input, dt.files);
              else Object.defineProperty(input, 'files', { configurable: true, value: dt.files });

              // IMPORTANT: trigger only 'change' to avoid double handlers
              input.dispatchEvent(new Event('change', { bubbles: true }));
              await wait(150);
              console.log('[LLM-God] ✓ Gemini upload via input (single change)');
              return true;
            } catch (e) {
              console.warn('[LLM-God] Gemini input assignment failed, trying paste:', e);
            }
          }

          // 2) Paste fallback (dispatch to a single deepest target)
          const pasteTargets = [
            document.querySelector('[contenteditable="true"]'),
            document.querySelector('.ql-editor.textarea'),
            document.querySelector('[role="textbox"]'),
          ].filter(Boolean);
          const targetForPaste = pasteTargets[0] || document.activeElement || document.querySelector('form') || document.body;

          const dispatchPaste = (el) => {
            if (!el) return false;
            try { el.focus?.(); } catch {}
            let ev;
            try {
              ev = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: dt,
              });
            } catch {
              ev = new Event('paste', { bubbles: true, cancelable: true });
            }
            try { Object.defineProperty(ev, 'clipboardData', { value: dt }); } catch {}
            return el.dispatchEvent(ev);
          };

          if (dispatchPaste(targetForPaste)) {
            console.log('[LLM-God] ✓ Gemini paste dispatched (single target)');
            return true;
          }

          // 3) Last resort: DnD with dragover cancellation
          const pickGeminiDropTarget = () =>
            document.querySelector('form')
            || document.querySelector('[contenteditable="true"]')
            || document.querySelector('.ql-editor.textarea')
            || document.body;

          const target = pickGeminiDropTarget();
          if (!target) {
            console.error('[LLM-God] Gemini: no drop target found');
            return false;
          }

          const preventDragover = (e) => {
            e.preventDefault();
            if (e.dataTransfer) { try { e.dataTransfer.dropEffect = 'copy'; } catch {} }
          };
          document.addEventListener('dragover', preventDragover, { capture: true });
          target.addEventListener('dragover', preventDragover, { capture: true });

          const rect = target.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;

          const mk = (type) => {
            const ev = new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              composed: true,
              clientX: x,
              clientY: y,
              dataTransfer: dt,
              view: window,
            });
            try { Object.defineProperty(ev, 'dataTransfer', { value: dt }); } catch {}
            try {
              dt.effectAllowed = 'all';
              if (type === 'dragover' || type === 'drop') dt.dropEffect = 'copy';
            } catch {}
            return ev;
          };

          document.dispatchEvent(mk('dragenter'));
          await wait(25);
          target.dispatchEvent(mk('dragenter'));
          await wait(25);
          for (let i = 0; i < 4; i++) {
            document.dispatchEvent(mk('dragover'));
            await wait(18);
            target.dispatchEvent(mk('dragover'));
            await wait(18);
          }
          target.dispatchEvent(mk('drop'));
          await wait(100);
          document.dispatchEvent(mk('dragend'));

          document.removeEventListener('dragover', preventDragover, { capture: true });
          target.removeEventListener('dragover', preventDragover, { capture: true });

          console.log('[LLM-God] ✓ Gemini DnD fallback completed (single sequence)');
          return true;
        }
        // ---------------------------
        // END GEMINI-ONLY
        // ---------------------------

        // ----- PERPLEXITY (unchanged) -----
        if (hostname.includes('perplexity.ai')) {
          console.log('[LLM-God] Using Perplexity-specific file upload');
          const waitForFileInput = (timeout = 10000) => {
            return new Promise((resolve, reject) => {
              const existing = document.querySelector('input[type="file"]');
              if (existing) { resolve(existing); return; }
              const observer = new MutationObserver((mutations, obs) => {
                const element = document.querySelector('input[type="file"]');
                if (element) { obs.disconnect(); resolve(element); }
              });
              observer.observe(document.body, { childList: true, subtree: true, attributes: true });
              setTimeout(() => { observer.disconnect(); reject(new Error('File input not found for Perplexity')); }, timeout);
            });
          };
          try {
            const fileInput = await waitForFileInput();
            console.log('[LLM-God] Perplexity file input ready!');
            const dtLocal = new DataTransfer();
            generatedFiles.forEach(f => dtLocal.items.add(f));
            try {
              Object.defineProperty(fileInput, 'files', { value: dtLocal.files, configurable: true });
            } catch (e) {
              const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
              if (descriptor?.set) { descriptor.set.call(fileInput, dtLocal.files); }
            }
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
            await wait(200);
            console.log('[LLM-God] ✓ Perplexity file upload complete');
            return true;
          } catch (error) {
            console.error('[LLM-God] ❌ Perplexity file upload failed:', error);
            return false;
          }
        }

        // ----- CLAUDE (unchanged) -----
        if (hostname.includes('claude.ai')) {
          console.log('[LLM-God] Using Claude-specific file upload');
          const waitForFileInput = (timeout = 10000) => {
            return new Promise((resolve, reject) => {
              const findBestInput = () => {
                const inputs = document.querySelectorAll('input[type="file"]');
                if (inputs.length === 0) return null;
                for (let i = inputs.length - 1; i >= 0; i--) {
                  const input = inputs[i];
                  if (!input.disabled) return input;
                }
                return inputs[inputs.length - 1];
              };
              const existing = findBestInput();
              if (existing) { resolve(existing); return; }
              const observer = new MutationObserver((mutations, obs) => {
                const element = findBestInput();
                if (element) { obs.disconnect(); resolve(element); }
              });
              observer.observe(document.body, { childList: true, subtree: true, attributes: true });
              setTimeout(() => {
                observer.disconnect();
                const lastChance = findBestInput();
                if (lastChance) resolve(lastChance); else reject(new Error('File input not found for Claude'));
              }, timeout);
            });
          };
          try {
            const targetInput = await waitForFileInput();
            console.log('[LLM-God] Claude file input found, assigning files...');
            const dtLocal = new DataTransfer();
            generatedFiles.forEach(f => dtLocal.items.add(f));
            try {
              Object.defineProperty(targetInput, 'files', { value: dtLocal.files, configurable: true });
            } catch (e) {
              const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
              if (descriptor?.set) descriptor.set.call(targetInput, dtLocal.files);
            }
            targetInput.dispatchEvent(new Event('change', { bubbles: true }));
            await wait(100);
            console.log('[LLM-God] ✓ Claude file upload complete via input');
            return true;
          } catch (error) {
            console.log('[LLM-God] Claude file input failed:', error.message, 'Trying drop zone fallback...');
            const simulateDragAndDrop = async (target) => {
              if (!target) return false;
              const dtLocal = new DataTransfer();
              generatedFiles.forEach(f => dtLocal.items.add(f));
              const createDragEvent = (type) => new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: dtLocal, view: window });
              document.dispatchEvent(createDragEvent('dragenter'));
              target.dispatchEvent(createDragEvent('dragenter'));
              target.dispatchEvent(createDragEvent('dragover'));
              target.dispatchEvent(createDragEvent('drop'));
              target.dispatchEvent(createDragEvent('dragend'));
              document.dispatchEvent(createDragEvent('dragend'));
              target.dispatchEvent(new Event('dragleave', { bubbles: true }));
              document.dispatchEvent(new Event('dragleave', { bubbles: true }));
              return true;
            };
            const dropZone = document.querySelector('[data-testid="chat-input-dropzone"]')
                           || document.querySelector('.MessageComposerDropzone')
                           || document.querySelector('fieldset')
                           || document.querySelector('[role="textbox"]');
            const ok = await simulateDragAndDrop(dropZone);
            return ok;
          }
        }

        // ----- GENERIC (unchanged) -----
        const buildDataTransfer = () => {
          const dtLocal = new DataTransfer();
          generatedFiles.forEach(file => dtLocal.items.add(file));
          return dtLocal;
        };

        const simulateDragAndDrop = async (target) => {
          if (!target) {
            console.error('[LLM-God] No drop target found for simulation');
            return false;
          }
          const rect = target.getBoundingClientRect();
          const coords = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          const isGemini = hostname.includes('gemini.google.com');
          const handlers = new Map();

          if (!isGemini) {
            const createPreventHandler = () => (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.dataTransfer) { try { e.dataTransfer.dropEffect = 'copy'; } catch (err) {} }
            };
            ['dragenter', 'dragover'].forEach(type => {
              const h = createPreventHandler();
              handlers.set(type, h);
              target.addEventListener(type, h, { capture: true });
              document.addEventListener(type, h, { capture: true });
            });
          }

          const createDragEvent = (type) => {
            const dtLocal = buildDataTransfer();
            try { Object.defineProperty(dtLocal, 'types', { value: ['Files'] }); } catch {}
            try { dtLocal.effectAllowed = 'all'; } catch {}
            if (type === 'dragover' || type === 'drop') { try { dtLocal.dropEffect = 'copy'; } catch {} }
            const ev = new DragEvent(type, {
              bubbles: true, cancelable: true, composed: true, dataTransfer: dtLocal,
              clientX: coords.x, clientY: coords.y, view: window
            });
            try { Object.defineProperty(ev, 'dataTransfer', { value: dtLocal }); } catch {}
            return ev;
          };

          document.dispatchEvent(createDragEvent('dragenter'));
          await wait(30);
          target.dispatchEvent(createDragEvent('dragenter'));
          await wait(30);
          for (let i = 0; i < 5; i++) {
            document.dispatchEvent(createDragEvent('dragover'));
            await wait(20);
            target.dispatchEvent(createDragEvent('dragover'));
            await wait(20);
          }
          target.dispatchEvent(createDragEvent('drop'));
          await wait(100);
          target.dispatchEvent(createDragEvent('dragend'));
          document.dispatchEvent(createDragEvent('dragend'));
          await wait(100);
          target.dispatchEvent(new Event('dragleave', { bubbles: true }));
          document.dispatchEvent(new Event('dragleave', { bubbles: true }));

          if (!isGemini) {
            handlers.forEach((h, type) => {
              target.removeEventListener(type, h, { capture: true });
              document.removeEventListener(type, h, { capture: true });
            });
          }
          return true;
        };

        const findTarget = () => {
          if (hostname.includes('chatgpt.com')) {
            return document.querySelector('[data-testid="attachment-dropzone"]')
                || document.querySelector('[data-testid="composer-background"]')
                || document.querySelector('form');
          }
          if (hostname.includes('gemini.google.com')) {
            // Gemini handled earlier; left for parity
            return document.querySelector('form')
                || document.querySelector('[contenteditable="true"]')
                || document.querySelector('.ql-editor.textarea')
                || document.body;
          }
          if (hostname.includes('perplexity.ai')) {
            return document.querySelector('form') || document.querySelector('[role="textbox"]') || document.body;
          }
          return document.querySelector('form') || document.body;
        };

        const target = findTarget();
        const success = await simulateDragAndDrop(target);
        if (success) console.log('[LLM-God] ✓ Generic file drop simulation complete');
        else console.error('[LLM-God] ❌ Generic file drop simulation failed');
        return success;

      } catch (error) {
        console.error('[LLM-God] Fatal error:', error);
        return false;
      }
    })(%files%);
  `;

  const scriptWithFiles = script.replace("%files%", JSON.stringify(files));
  await view.webContents.executeJavaScript(scriptWithFiles, true).catch((error) => {
    console.error("Failed to execute drag-and-drop simulation", error);
  });
}




export function sendPromptInView(view: CustomBrowserView) {
  if (view.id && view.id.match("chatgpt")) {
    view.webContents.executeJavaScript(`
            var btn = document.querySelector('button[aria-label*="Send prompt"]');
            if (btn) {
                btn.focus();
                btn.disabled = false;
                btn.click();
            }
        `);
  } else if (view.id && view.id.match("gemini")) {
    view.webContents.executeJavaScript(`{
      var btn = document.querySelector("button[aria-label*='Send message']");
      if (btn) {
        btn.setAttribute("aria-disabled", "false");
        btn.focus();
        btn.click();
      }
    }`);
  } else if (view.id && view.id.match("perplexity")) {
    view.webContents.executeJavaScript(`
      {
        console.log('[Perplexity] Looking for submit button...');
        
        // Try the reliable data-testid selector first
        var button = document.querySelector('[data-testid="submit-button"]');
        
        // Fallback to the previous method if data-testid is not found
        if (!button) {
          console.log('[Perplexity] data-testid not found, falling back to previous selector');
          var buttons = Array.from(document.querySelectorAll('button.bg-super'));
          if (buttons[0]) {
            var buttonsWithSvgPath = buttons.filter(button => button.querySelector('svg path'));
            button = buttonsWithSvgPath[buttonsWithSvgPath.length - 1];
          }
        }
        
        if (button) {
          console.log('[Perplexity] Submit button found, clicking...');
          button.focus();
          button.click();
          console.log('[Perplexity] Submit button clicked successfully');
        } else {
          console.error('[Perplexity] Submit button not found');
        }
      }
                `);
  } else if (view.id && view.id.match("claude")) {
    view.webContents.executeJavaScript(`{
    var btn = document.querySelector("button[aria-label*='Send message']");
    if (!btn) var btn = document.querySelector('button:has(div svg)');
    if (!btn) var btn = document.querySelector('button:has(svg)');
    if (btn) {
      btn.focus();
      btn.disabled = false;
      btn.click();
    }
  }`);
  } else if (view.id && view.id.match("grok")) {
  view.webContents.executeJavaScript(`
    {
      // Try button click first
      var btn = document.querySelector('button[aria-label*="Submit"]')
             || document.querySelector('button[aria-label*="Send"]')
             || document.querySelector('button[type="submit"]');
      
      if (btn) {
        btn.focus();
        btn.disabled = false;
        btn.click();
        console.log('[Grok] Send button clicked');
      } else {
        // Fallback to keyboard simulation
        var textarea = document.querySelector('textarea');
        if (textarea) {
          textarea.focus();
          var event = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            metaKey: true,
            ctrlKey: true,
            bubbles: true,
            cancelable: true
          });
          textarea.dispatchEvent(event);
          console.log('[Grok] Enter key simulated as fallback');
        } else {
          console.log('[Grok] No send method found');
        }
      }
    }
  `);
} else if (view.id && view.id.match("deepseek")) {
    view.webContents.executeJavaScript(`
        {
        var buttons = Array.from(document.querySelectorAll('div[role="button"]'));
        var btn = buttons[2]
        if (btn) {
            btn.focus();
            btn.click();
          } else {
            console.log("Element not found");
          }
    }`);
  } else if (view.id && view.id.match("lmarena")) {
    view.webContents.executeJavaScript(`
        {
        var btn = document.querySelector('button[type="submit"]');
        if (btn) {
            btn.focus();
            btn.disabled = false;
            btn.click();
          } else {
            console.log("Element not found");
          }
    }`);
  }
}
