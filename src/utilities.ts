import { BrowserWindow, WebPreferences, WebContentsView } from "electron"; // Added WebPreferences type
import { applyCustomStyles } from "./customStyles.js";

interface CustomBrowserView extends WebContentsView {
  id?: string; // Make id optional as it's assigned after creation
}

export function ensureDetachedDevTools(view: CustomBrowserView): void {
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
  options: { webPreferences?: WebPreferences; promptAreaHeight?: number } = {},
): CustomBrowserView {
  const { webPreferences = {}, promptAreaHeight = 0 } = options;

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

  websites.push(url);
  const viewWidth = Math.floor(width / websites.length);

  views.forEach((v, index) => {
    v.setBounds({
      x: index * viewWidth,
      y: 0,
      width: viewWidth,
      height: availableHeight,
    });
  });

  view.setBounds({
    x: (websites.length - 1) * viewWidth,
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
  options: { promptAreaHeight?: number } = {},
): void {
  const { promptAreaHeight = 0 } = options;

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
  const viewWidth = Math.floor(width / views.length);

  views.forEach((v, index) => {
    v.setBounds({
      x: index * viewWidth,
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
  if (!files.length) {
    return;
  }

  const script = `
    (async (files) => {
      try {
        const decodeBase64 = (base64) => {
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
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
        console.log('[LLM-God] Processing', generatedFiles.length, 'files for', hostname);
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

        const buildDataTransfer = () => {
          const dt = new DataTransfer();
          generatedFiles.forEach(file => dt.items.add(file));
          return dt;
        };

        /**
         * ---------------------------------------------------------------------
         * GENERIC DRAG AND DROP SIMULATION HELPER
         * ---------------------------------------------------------------------
         */
        const simulateDragAndDrop = async (target) => {
          if (!target) {
            console.error('[LLM-God] No drop target found for simulation');
            return false;
          }
          console.log('[LLM-God] Using generic drop simulation for target:', target.tagName, target.className);
          
          const rect = target.getBoundingClientRect();
          const coords = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
          };
          const isGemini = hostname.includes('gemini.google.com');
          const handlers = new Map();

          // Add temporary event listeners to prevent default browser behavior
          if (!isGemini) {
            const createPreventHandler = () => (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.dataTransfer) {
                try { e.dataTransfer.dropEffect = 'copy'; } catch (err) {}
              }
            };
            const captureEvents = ['dragenter', 'dragover'];
            captureEvents.forEach(eventType => {
              const handler = createPreventHandler();
              handlers.set(eventType, handler);
              target.addEventListener(eventType, handler, { capture: true });
              document.addEventListener(eventType, handler, { capture: true });
            });
          }

          // Create a synthetic DragEvent
          const createDragEvent = (type) => {
            const dt = buildDataTransfer();
            try { Object.defineProperty(dt, 'types', { value: ['Files'] }); } catch (e) {}
            try { dt.effectAllowed = 'all'; } catch (e) {}
            if (type === 'dragover' || type === 'drop') {
              try { dt.dropEffect = 'copy'; } catch (e) {}
            }
            const event = new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              composed: true,
              dataTransfer: dt,
              clientX: coords.x,
              clientY: coords.y,
              view: window,
            });
            try { Object.defineProperty(event, 'dataTransfer', { value: dt }); } catch (e) {}
            return event;
          };

          // Execute drag-and-drop sequence
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
          target.dispatchEvent(createDragEvent('dragleave'));
          document.dispatchEvent(createDragEvent('dragleave'));
          await wait(50);

          // Cleanup handlers
          if (!isGemini) {
            handlers.forEach((handler, eventType) => {
              target.removeEventListener(eventType, handler, { capture: true });
              document.removeEventListener(eventType, handler, { capture: true });
            });
          }
          return true;
        };


        // CLAUDE-SPECIFIC IMPLEMENTATION
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
                return inputs[inputs.length - 1]; // fallback
              };
              const existing = findBestInput();
              if (existing) {
                resolve(existing);
                return;
              }
              const observer = new MutationObserver((mutations, obs) => {
                const element = findBestInput();
                if (element) {
                  obs.disconnect();
                  resolve(element);
                }
              });
              observer.observe(document.body, { childList: true, subtree: true, attributes: true });
              setTimeout(() => {
                observer.disconnect();
                const lastChance = findBestInput();
                if (lastChance) { resolve(lastChance); } 
                else { reject(new Error('File input not found for Claude')); }
              }, timeout);
            });
          };
          
          try {
            const targetInput = await waitForFileInput();
            console.log('[LLM-God] Claude file input found, assigning files...');
            const dt = buildDataTransfer();
            try {
              Object.defineProperty(targetInput, 'files', { value: dt.files, configurable: true });
            } catch (e) {
              const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
              if (descriptor?.set) { descriptor.set.call(targetInput, dt.files); }
            }
            targetInput.dispatchEvent(new Event('change', { bubbles: true }));
            targetInput.dispatchEvent(new Event('input', { bubbles: true }));
            await wait(100);
            console.log('[LLM-God] ✓ Claude file upload complete via input');
            return true;
          } catch (error) {
            console.log('[LLM-God] Claude file input failed:', error.message, 'Trying drop zone fallback...');
            const dropZone = document.querySelector('[data-testid="chat-input-dropzone"]') ||
                             document.querySelector('.MessageComposerDropzone') ||
                             document.querySelector('fieldset') ||
                             document.querySelector('[role="textbox"]');
            
            const success = await simulateDragAndDrop(dropZone);
            if (success) {
                console.log('[LLM-God] ✓ Claude drop fallback complete');
            } else {
                console.error('[LLM-God] ❌ Claude drop fallback failed');
            }
            return success;
          }
        }

        // PERPLEXITY-SPECIFIC IMPLEMENTATION
        if (hostname.includes('perplexity.ai')) {
          console.log('[LLM-God] Using Perplexity-specific file upload');
          const waitForFileInput = (timeout = 10000) => {
            return new Promise((resolve, reject) => {
              const existing = document.querySelector('input[type="file"]');
              if (existing) {
                resolve(existing);
                return;
              }
              const observer = new MutationObserver((mutations, obs) => {
                const element = document.querySelector('input[type="file"]');
                if (element) {
                  obs.disconnect();
                  resolve(element);
                }
              });
              observer.observe(document.body, { childList: true, subtree: true, attributes: true });
              setTimeout(() => {
                observer.disconnect();
                reject(new Error('File input not found for Perplexity'));
              }, timeout);
            });
          };
          
          try {
            const fileInput = await waitForFileInput();
            console.log('[LLM-God] Perplexity file input ready!');
            const dt = buildDataTransfer();
            try {
              Object.defineProperty(fileInput, 'files', { value: dt.files, configurable: true });
            } catch (e) {
              const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
              if (descriptor?.set) { descriptor.set.call(fileInput, dt.files); }
            }
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
            fileInput.dispatchEvent(new Event('input', { bubbles: true }));
            await wait(200);
            console.log('[LLM-God] ✓ Perplexity file upload complete');
            return true;
          } catch (error) {
            console.error('[LLM-God] ❌ Perplexity file upload failed:', error);
            return false;
          }
        }

        // GENERIC IMPLEMENTATION FOR OTHER SITES
        const findTarget = () => {
          if (hostname.includes('chatgpt.com')) {
            return document.querySelector('[data-testid="attachment-dropzone"]') ||
                   document.querySelector('[data-testid="composer-background"]') ||
                   document.querySelector('form');
          }
          if (hostname.includes('gemini.google.com')) {
            return document.querySelector('form') ||
                   document.querySelector('[contenteditable="true"]') ||
                   document.querySelector('.ql-editor.textarea') ||
                   document.body;
          }
          return document.querySelector('form') || document.body;
        };

        const target = findTarget();
        const success = await simulateDragAndDrop(target);

        if (success) {
            console.log('[LLM-God] ✓ Generic file drop simulation complete');
        } else {
            console.error('[LLM-God] ❌ Generic file drop simulation failed');
        }
        return success;

      } catch (error) {
        console.error('[LLM-God] Fatal error:', error);
        return false;
      }
    })(%files%);
  `;

  const scriptWithFiles = script.replace("%files%", JSON.stringify(files));

  await view.webContents
    .executeJavaScript(scriptWithFiles, true)
    .catch((error) => {
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
        var buttons = Array.from(document.querySelectorAll('button.bg-super'));
        if (buttons[0]) {
          var buttonsWithSvgPath = buttons.filter(button => button.querySelector('svg path'));
          var button = buttonsWithSvgPath[buttonsWithSvgPath.length - 1];
          button.click();
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
        var btn = document.querySelector('button[aria-label*="Submit"]');
        if (btn) {
            btn.focus();
            btn.disabled = false;
            btn.click();
          } else {
            console.log("Element not found");
          }
      }`);
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