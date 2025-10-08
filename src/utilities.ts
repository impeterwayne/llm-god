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
    //  view.webContents.openDevTools({ mode: "detach" });
    view.webContents.executeJavaScript(`
      ((prompt) => {
        const editorElement = document.getElementById('ask-input');

        if (editorElement && editorElement.__lexicalEditor) {
          const editor = editorElement.__lexicalEditor;
          console.log('Lexical editor found. Setting state directly based on provided structure.');

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
          // This fallback for a standard textarea looks correct.
          const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            'value',
          )?.set;
          nativeTextAreaValueSetter?.call(editorElement, prompt);
          const event = new Event('input', { bubbles: true });
          editorElement.dispatchEvent(event);
        }
      })(${JSON.stringify(prompt)});
    `);
  } else if (view.id && view.id.match("claude")) {
    view.webContents.executeJavaScript(`
      ((prompt) => {
        const inputElement = document.querySelector('div.ProseMirror');
        if (inputElement) {
          inputElement.innerHTML = prompt;
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
          const length = binary.length;
          const bytes = new Uint8Array(length);
          for (let i = 0; i < length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          return bytes;
        };

        const createFile = (file) => {
          const bytes = decodeBase64(file.data);
          const blobParts = [bytes];
          const options = {
            type: file.type || "application/octet-stream",
            lastModified: file.lastModified || Date.now(),
          };
          return new File(blobParts, file.name || "dropped-file", options);
        };

        const generatedFiles = files.map(createFile);

        const buildDataTransfer = () => {
          const transfer = new DataTransfer();
          generatedFiles.forEach((file) => transfer.items.add(file));
          try {
            transfer.effectAllowed = "copy";
            transfer.dropEffect = "copy";
          } catch (error) {
            // Some browsers restrict assigning these properties
          }
          return transfer;
        };

        const createDataTransfer = () => buildDataTransfer();
        const cloneFileList = () => buildDataTransfer().files;

        const siteSelectors = {
          "chatgpt.com": [
            '[data-testid="attachment-dropzone"]',
            '[data-testid="drag-drop-container"]',
            '[data-testid="file-upload"]',
            '[data-testid="composer"] textarea',
            'form textarea',
            'textarea[data-id="prompt-textarea"]',
          ],
          "claude.ai": [
            '.MessageComposerDropzone',
            '[data-testid="chat-input-textarea"]',
            'textarea',
          ],
          "gemini.google.com": [
            '[aria-label="Drop files here"]',
            'form [role="presentation"]',
            '[contenteditable="true"][role="textbox"]',
            '[contenteditable="true"][aria-label]',
            '[contenteditable="true"]',
            'textarea',
          ],
          "perplexity.ai": [
            '#ask-input',
            '[data-testid="dropzone"]',
            '[data-testid="upload-dropzone"]',
            '[data-testid="prompt-input"]',
            'textarea',
            '[contenteditable="true"]',
          ],
          "www.perplexity.ai": [
            '#ask-input',
            '[data-testid="dropzone"]',
            '[data-testid="upload-dropzone"]',
            '[data-testid="prompt-input"]',
            'textarea',
            '[contenteditable="true"]',
          ],
          "grok.com": [
            'textarea',
            '[contenteditable="true"]',
          ],
          "chat.deepseek.com": [
            'textarea',
            '[contenteditable="true"]',
          ],
          "deepseek.com": [
            'textarea',
            '[contenteditable="true"]',
          ],
          "lmarena.ai": [
            'textarea',
            '[contenteditable="true"]',
          ],
        };

        const normalizedHost = location.hostname.replace(/^www\./, "");
        const hostSelectors =
          siteSelectors[location.hostname] ||
          siteSelectors[normalizedHost] ||
          [];

        const hostsRequiringInputSync = new Set([
          'perplexity.ai',
          'www.perplexity.ai',
          'gemini.google.com',
        ]);

        const shouldForceInputSync =
          hostsRequiringInputSync.has(location.hostname) ||
          hostsRequiringInputSync.has(normalizedHost);

        const fallbackSelectors = [
          '[data-testid="prompt-input"]',
          '.composer',
          '[role="textbox"]',
          'form',
          'main',
          'body',
        ];

        const selectors = [...hostSelectors, ...fallbackSelectors];

        const candidateTargets = [];
        const seen = new Set();

        const addCandidate = (element) => {
          if (element && element instanceof Element && !seen.has(element)) {
            seen.add(element);
            candidateTargets.push(element);
          }
        };

        selectors.forEach((selector) => {
          if (selector === 'body') {
            addCandidate(document.body);
            return;
          }

          const matches = Array.from(document.querySelectorAll(selector));
          matches.forEach(addCandidate);
        });

        if (!candidateTargets.length) {
          addCandidate(document.body);
        }

        const prioritizedTargets = candidateTargets
          .map((element) => {
            const rect = element.getBoundingClientRect();
            const area = rect.width * rect.height;
            let weight = Number.isFinite(rect.bottom) ? rect.bottom : 0;

            if (area <= 0) {
              weight -= 5000;
            } else {
              weight += Math.min(area, 400000) / 100;
            }

            if (element.matches?.('textarea, [contenteditable="true"], input[type="file"]')) {
              weight += 6000;
            }

            const testId = (element.getAttribute?.('data-testid') || '').toLowerCase();
            if (testId.includes('drop') || testId.includes('upload')) {
              weight += 5000;
            }

            const ariaLabel = (element.getAttribute?.('aria-label') || '').toLowerCase();
            if (ariaLabel.includes('drop') || ariaLabel.includes('upload')) {
              weight += 3000;
            }

            return { element, weight };
          })
          .sort((a, b) => b.weight - a.weight)
          .map((entry) => entry.element);

        const targetsToTry = prioritizedTargets.length
          ? prioritizedTargets
          : [document.body, document.documentElement].filter(
              (el) => el instanceof Element
            );

        const computeCoordinates = (target) => {
          const fallbackX = window.innerWidth / 2;
          const fallbackY = window.innerHeight / 2;

          if (!(target instanceof Element)) {
            return {
              clientX: fallbackX,
              clientY: fallbackY,
              pageX: fallbackX + window.scrollX,
              pageY: fallbackY + window.scrollY,
              screenX: window.screenX + fallbackX,
              screenY: window.screenY + fallbackY,
            };
          }

          const rect = target.getBoundingClientRect();
          const rectWidth = rect.width || 0;
          const rectHeight = rect.height || 0;
          const clientX = Number.isFinite(rect.left)
            ? rect.left + Math.min(rectWidth / 2, 200)
            : fallbackX;
          const clientY = Number.isFinite(rect.top)
            ? rect.top + Math.min(rectHeight / 2, 200)
            : fallbackY;
          return {
            clientX,
            clientY,
            pageX: clientX + window.scrollX,
            pageY: clientY + window.scrollY,
            screenX: window.screenX + clientX,
            screenY: window.screenY + clientY,
          };
        };

        const waitForNextFrame = () =>
          new Promise((resolve) => {
            const raf = window.requestAnimationFrame || ((cb) => setTimeout(cb, 16));
            raf(() => resolve());
          });

        const dispatchDragEvent = (type, target, dataTransfer, overrides = {}) => {
          if (!target || typeof target.dispatchEvent !== 'function') {
            return false;
          }

          try {
            if (dataTransfer) {
              dataTransfer.effectAllowed = 'copy';
              if (type === 'dragover' || type === 'drop') {
                dataTransfer.dropEffect = overrides.dropEffect || 'copy';
              }
            }
          } catch (error) {
            // Ignore assignment restrictions
          }

          const coordinates = computeCoordinates(target);
          const isCancelable =
            type === 'dragenter' || type === 'dragover' || type === 'drop';

          const event = new DragEvent(type, {
            dataTransfer,
            bubbles: true,
            cancelable: overrides.cancelable ?? isCancelable,
            composed: true,
            buttons: 1,
            button: 0,
            ...coordinates,
            ...overrides,
          });

          if (dataTransfer && (!event.dataTransfer || event.dataTransfer !== dataTransfer)) {
            try {
              Object.defineProperty(event, 'dataTransfer', {
                configurable: true,
                enumerable: true,
                get: () => dataTransfer,
              });
            } catch (error) {
              // Fallback for browsers that disallow redefining the property
              if (!event.dataTransfer) {
                try {
                  Reflect.set(event, 'dataTransfer', dataTransfer);
                } catch (setError) {
                  // Unable to force the property; continue without throwing.
                }
              }
            }
          }

          target.dispatchEvent(event);
          return event.defaultPrevented;
        };

        const runDragSequence = async (target, dataTransfer) => {
          const ancestors = [];
          let current = target instanceof Element ? target : null;

          while (current) {
            ancestors.push(current);
            current = current.parentElement;
          }

          const path = ancestors.slice().reverse();

          const globalTargets = [document, document.documentElement, document.body].filter(
            (element) => element && typeof element.dispatchEvent === 'function',
          );

          for (const globalTarget of globalTargets) {
            dispatchDragEvent('dragenter', globalTarget, dataTransfer);
            await waitForNextFrame();
            for (let i = 0; i < 3; i++) {
              dispatchDragEvent('dragover', globalTarget, dataTransfer);
              await waitForNextFrame();
            }
          }

          for (const element of path) {
            dispatchDragEvent('dragenter', element, dataTransfer);
            await waitForNextFrame();
            for (let i = 0; i < 5; i++) {
              dispatchDragEvent('dragover', element, dataTransfer);
              await waitForNextFrame();
            }
          }

          const dropPrevented = dispatchDragEvent('drop', target, dataTransfer);
          await waitForNextFrame();

          for (let i = ancestors.length - 1; i >= 0; i--) {
            dispatchDragEvent('dragleave', ancestors[i], dataTransfer, { cancelable: false });
            await waitForNextFrame();
          }

          for (const globalTarget of globalTargets) {
            dispatchDragEvent('dragleave', globalTarget, dataTransfer, { cancelable: false });
            await waitForNextFrame();
          }

          dispatchDragEvent('dragend', target, dataTransfer, { cancelable: false });

          return dropPrevented;
        };

        const syncFileInputs = (target) => {
          const inputElements = new Set();
          if (target instanceof HTMLElement) {
            target
              .querySelectorAll('input[type="file"]')
              .forEach((element) => inputElements.add(element));
          }

          document
            .querySelectorAll('input[type="file"]')
            .forEach((element) => inputElements.add(element));

          if (!inputElements.size) {
            return false;
          }

          const filesDescriptor = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'files',
          );

          let updated = false;

          inputElements.forEach((input) => {
            if (!(input instanceof HTMLInputElement)) {
              return;
            }

            const fileList = cloneFileList();

            if (filesDescriptor?.set) {
              filesDescriptor.set.call(input, fileList);
            } else {
              Object.defineProperty(input, 'files', {
                configurable: true,
                get: () => fileList,
              });
            }

            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            updated = true;
          });

          return updated;
        };

        const attemptDrop = async (target) => {
          const dataTransfer = createDataTransfer();
          const dropPrevented = await runDragSequence(target, dataTransfer);
          let synced = false;

          if (!dropPrevented || shouldForceInputSync) {
            synced = syncFileInputs(target);
            if (synced) {
              return { success: true, dropPrevented, synced };
            }
          }

          if (dropPrevented && !shouldForceInputSync) {
            return { success: true, dropPrevented, synced };
          }

          return { success: synced, dropPrevented, synced };
        };

        for (const target of targetsToTry) {
          try {
            const { success } = await attemptDrop(target);
            if (success) {
              return true;
            }
          } catch (error) {
            console.warn('Drop attempt failed on target', target, error);
          }
        }

        return false;
      } catch (error) {
        console.error('Failed to simulate drag-and-drop', error);
        return false;
      }
    })(%files%);
  `;

  const scriptWithFiles = script.replace(
    "%files%",
    JSON.stringify(files),
  );

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
