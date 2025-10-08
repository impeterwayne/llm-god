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

// Proper drag-and-drop simulation for all sites including Gemini

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

        // Build DataTransfer with files
        const buildDataTransfer = () => {
          const dt = new DataTransfer();
          generatedFiles.forEach(file => dt.items.add(file));
          return dt;
        };

        // Site-specific target selection
        const findTarget = () => {
          if (hostname.includes('chatgpt.com')) {
            return document.querySelector('[data-testid="attachment-dropzone"]') ||
                   document.querySelector('[data-testid="composer-background"]') ||
                   document.querySelector('form');
          }
          if (hostname.includes('gemini.google.com')) {
            // Try multiple selectors for Gemini
            return document.querySelector('form') ||
                   document.querySelector('[contenteditable="true"]') ||
                   document.querySelector('.ql-editor.textarea') ||
                   document.body;
          }
          if (hostname.includes('claude.ai')) {
            return document.querySelector('.MessageComposerDropzone') ||
                   document.querySelector('[data-testid="chat-input-textarea"]');
          }
          if (hostname.includes('perplexity.ai')) {
            return document.querySelector('#ask-input');
          }
          return document.querySelector('form') || document.body;
        };

        const target = findTarget();
        if (!target) {
          console.error('[LLM-God] No drop target found');
          return false;
        }

        console.log('[LLM-God] Drop target:', target.tagName, target.className);

        // Get coordinates for the target
        const rect = target.getBoundingClientRect();
        const coords = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        };

        const isGemini = hostname.includes('gemini.google.com');
        const isPerplexity = hostname.includes('perplexity.ai');
        const isChatGPT = hostname.includes('chatgpt.com');
        const legacyDropMode = !isGemini && !isChatGPT; // restore original behavior for non-Gemini/ChatGPT

        // For Gemini: Don't install any preventDefault handlers
        // Let their native handlers process everything
        const handlers = new Map();
        
        if (!isGemini) {
          // For non-Gemini sites: Install preventDefault handlers
          const createPreventHandler = () => (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer) {
              try {
                e.dataTransfer.dropEffect = 'copy';
              } catch (err) {
                // Read-only in some phases
              }
            }
          };

          const captureEvents = (isPerplexity || legacyDropMode)
            ? ['dragenter', 'dragover', 'drop']
            : ['dragenter', 'dragover'];
          captureEvents.forEach(eventType => {
            const handler = createPreventHandler();
            handlers.set(eventType, handler);
            target.addEventListener(eventType, handler, { capture: true });
            document.addEventListener(eventType, handler, { capture: true });
          });
          console.log('[LLM-God] Event handlers installed (' + (captureEvents.includes('drop')
            ? 'includes drop'
            : 'dragenter/dragover only') + ')');
        } else {
          console.log('[LLM-God] Skipping event handlers for Gemini - letting native handlers work');
        }

        // Create a fresh DataTransfer for each event
        const createDragEvent = (type) => {
          const dt = buildDataTransfer();
          
          // Ensure types array is set correctly
          try {
            Object.defineProperty(dt, 'types', {
              value: ['Files'],
              writable: false,
              configurable: true
            });
          } catch (e) {
            // Already set by browser
          }
          
          // Force effectAllowed
          try {
            Object.defineProperty(dt, 'effectAllowed', {
              value: 'all',
              writable: true,
              configurable: true
            });
            dt.effectAllowed = 'all';
          } catch (e) {
            // Ignore
          }

          // Force dropEffect for dragover/drop
          if (type === 'dragover' || type === 'drop') {
            try {
              Object.defineProperty(dt, 'dropEffect', {
                value: 'copy',
                writable: true,
                configurable: true
              });
              dt.dropEffect = 'copy';
            } catch (e) {
              // Ignore
            }
          }

          const event = new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            dataTransfer: dt,
            clientX: coords.x,
            clientY: coords.y,
            pageX: coords.x,
            pageY: coords.y,
            screenX: coords.x,
            screenY: coords.y,
            view: window,
            relatedTarget: null,
          });

          // Force dataTransfer on the event
          try {
            Object.defineProperty(event, 'dataTransfer', {
              value: dt,
              writable: false,
              configurable: true
            });
          } catch (e) {
            // Already set
          }

          // Debug logging for drop events
          if (type === 'drop' && hostname.includes('gemini.google.com')) {
            console.log('[LLM-God] Gemini drop event dataTransfer:', {
              files: dt.files.length,
              items: dt.items.length,
              types: Array.from(dt.types),
              effectAllowed: dt.effectAllowed,
              dropEffect: dt.dropEffect,
              'files[0]': dt.files[0] ? {
                name: dt.files[0].name,
                size: dt.files[0].size,
                type: dt.files[0].type
              } : null
            });
          }

          return event;
        };

        // Execute comprehensive drag sequence
        console.log('[LLM-God] Starting drag sequence');

        // Phase 1: Dragenter on document and target
        document.dispatchEvent(createDragEvent('dragenter'));
        await wait(30);
        target.dispatchEvent(createDragEvent('dragenter'));
        await wait(30);

        // Phase 2: Multiple dragovers to ensure acceptance
        for (let i = 0; i < 5; i++) {
          document.dispatchEvent(createDragEvent('dragover'));
          await wait(20);
          target.dispatchEvent(createDragEvent('dragover'));
          await wait(20);
        }

        // Phase 3: Drop event
        console.log('[LLM-God] Dispatching drop event');
        const dropEvent = createDragEvent('drop');
        target.dispatchEvent(dropEvent);
        const dropAccepted = !!(dropEvent.defaultPrevented || dropEvent.returnValue === false);
        console.log('[LLM-God] Drop prevented?', dropEvent.defaultPrevented, '→ treated as accepted =', dropAccepted);
        
        // For Gemini: Only try alternate targets if initial drop was NOT accepted
        if (isGemini && !dropAccepted) {
          await wait(50);
          const form = document.querySelector('form');
          if (form && form !== target) {
            console.log('[LLM-God] Also dropping on form element');
            const altDrop = createDragEvent('drop');
            form.dispatchEvent(altDrop);
            if (altDrop.defaultPrevented || altDrop.returnValue === false) {
              console.log('[LLM-God] Alternate form drop accepted');
            }
          }
          
          // Try document.body as well
          await wait(50);
          console.log('[LLM-God] Also dropping on body');
          const bodyDrop = createDragEvent('drop');
          document.body.dispatchEvent(bodyDrop);
          if (bodyDrop.defaultPrevented || bodyDrop.returnValue === false) {
            console.log('[LLM-God] Body drop accepted');
          }
        } else if (isGemini) {
          console.log('[LLM-God] Initial drop accepted by Gemini, skipping alternates');
        }
        
        await wait(100);

        // Phase 4: Important - dragend to signal completion
        console.log('[LLM-God] Dispatching dragend event');
        const dragEndEvent = createDragEvent('dragend');
        target.dispatchEvent(dragEndEvent);
        document.dispatchEvent(createDragEvent('dragend'));
        await wait(100);

        // Phase 5: Cleanup - dragleave
        target.dispatchEvent(createDragEvent('dragleave'));
        document.dispatchEvent(createDragEvent('dragleave'));
        await wait(50);

        // Remove event handlers (only for non-Gemini)
        if (!isGemini) {
          handlers.forEach((handler, eventType) => {
            target.removeEventListener(eventType, handler, { capture: true });
            document.removeEventListener(eventType, handler, { capture: true });
          });
          console.log('[LLM-God] Event handlers removed');
        }

        // BACKUP: Also sync file inputs if they exist (always for legacy providers; conditional for Gemini/ChatGPT)
        await wait(100);
        const inputs = document.querySelectorAll('input[type="file"]');
        console.log('[LLM-God] Searching for file inputs, found:', inputs.length);
        
        if (dropAccepted && !isPerplexity && !legacyDropMode) {
          console.log('[LLM-God] Drop accepted by page; skipping input sync backup');
        } else if (inputs.length > 0) {
          console.log('[LLM-God] Found', inputs.length, 'file inputs, syncing as backup');
          const dt = buildDataTransfer();
          
          inputs.forEach((input, idx) => {
            try {
              const descriptor = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                'files'
              );
              
              if (descriptor && descriptor.set) {
                descriptor.set.call(input, dt.files);
                console.log('[LLM-God] Synced input', idx, 'via descriptor');
              } else {
                Object.defineProperty(input, 'files', {
                  value: dt.files,
                  writable: false,
                  configurable: true
                });
                console.log('[LLM-God] Synced input', idx, 'via defineProperty');
              }
              
              console.log('[LLM-God] Input', idx, 'now has', input.files.length, 'files');
              
              // Dispatch multiple event types
              input.dispatchEvent(new Event('change', { bubbles: true }));
              input.dispatchEvent(new Event('input', { bubbles: true }));
              
              // Try additional triggers
              if (hostname.includes('gemini.google.com')) {
                // Try to trigger Angular change detection
                const ngEvent = new Event('change', { bubbles: true });
                Object.defineProperty(ngEvent, 'target', { value: input, writable: false });
                input.dispatchEvent(ngEvent);
                
                // Try clicking any nearby buttons
                const parent = input.closest('form') || input.parentElement;
                if (parent) {
                  const buttons = parent.querySelectorAll('button');
                  buttons.forEach((btn, bidx) => {
                    const text = btn.textContent.toLowerCase();
                    const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
                    if (text.includes('add') || aria.includes('add') || 
                        text.includes('upload') || aria.includes('upload')) {
                      console.log('[LLM-God] Clicking button', bidx, ':', text || aria);
                      btn.click();
                    }
                  });
                }
              } else if (legacyDropMode) {
                // For other providers, also try clicking nearby action buttons
                const parent = input.closest('form') || input.parentElement;
                if (parent) {
                  const buttons = parent.querySelectorAll('button');
                  buttons.forEach((btn, bidx) => {
                    const text = (btn.textContent || '').toLowerCase();
                    const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
                    if (text.includes('add') || aria.includes('add') ||
                        text.includes('upload') || aria.includes('upload') ||
                        text.includes('attach') || aria.includes('attach')) {
                      console.log('[LLM-God] Clicking button', bidx, ':', text || aria);
                      btn.click();
                    }
                  });
                }
              }
            } catch (e) {
              console.warn('[LLM-God] Could not sync input', idx, ':', e.message);
            }
          });
        } else if (!dropAccepted || isPerplexity || legacyDropMode) {
          console.log('[LLM-God] No file inputs found, trying alternative methods');
          
          // For Gemini: The drop event should have been processed
          // Let's wait a bit and check if file input appears
          await wait(500);
          const delayedInputs = document.querySelectorAll('input[type="file"]');
          console.log('[LLM-God] After waiting, found', delayedInputs.length, 'file inputs');
          
          if (delayedInputs.length > 0) {
            // Sync the newly appeared input
            const dt = buildDataTransfer();
            delayedInputs.forEach((input, idx) => {
              try {
                const descriptor = Object.getOwnPropertyDescriptor(
                  HTMLInputElement.prototype,
                  'files'
                );
                
                if (descriptor && descriptor.set) {
                  descriptor.set.call(input, dt.files);
                }
                
                console.log('[LLM-God] Delayed sync: input', idx, 'now has', input.files.length, 'files');
                input.dispatchEvent(new Event('change', { bubbles: true }));
              } catch (e) {
                console.warn('[LLM-God] Delayed sync failed:', e.message);
              }
            });
          } else {
            // Last resort: check if Gemini processed the drop directly
            console.log('[LLM-God] No file inputs at all. Drop may have been processed directly by Gemini.');
            console.log('[LLM-God] Check if files appear in Gemini UI.');
          }
        } else {
          console.log('[LLM-God] Skipping backup path entirely (drop accepted)');
        }

        console.log('[LLM-God] ✓ Complete');
        return true;

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

