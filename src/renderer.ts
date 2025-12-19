const ipcRenderer = window.electron.ipcRenderer;
import { initSessionSidebar } from "./sessionSidebar.js";

let promptArea: HTMLElement | null = null;

interface SerializedFile {
  name: string;
  type: string;
  size: number;
  lastModified: number;
  data: string;
}

interface ViewLayout {
  id: string;
  url: string;
  bounds: Electron.Rectangle;
  headerBounds: Electron.Rectangle;
}

let currentViewLayouts: ViewLayout[] = [];
let viewHeadersContainer: HTMLElement | null = null;

const removeDragActiveState = (): void => {
  promptArea?.classList.remove("drag-active");
};

const serializeFileForTransfer = (file: File): Promise<SerializedFile> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = reader.result;

      if (result instanceof ArrayBuffer) {
        const bytes = new Uint8Array(result);
        let binary = "";

        bytes.forEach((byte) => {
          binary += String.fromCharCode(byte);
        });

        const base64 = btoa(binary);

        resolve({
          name: file.name,
          type: file.type,
          size: file.size,
          lastModified: file.lastModified,
          data: base64,
        });
        return;
      }

      reject(new Error("Unexpected result while reading file"));
    };

    reader.onerror = () => {
      reject(reader.error ?? new Error("Failed to read file"));
    };

    reader.readAsArrayBuffer(file);
  });
};

const handleFileDrop = async (event: DragEvent): Promise<void> => {
  event.preventDefault();
  removeDragActiveState();

  const droppedFiles = event.dataTransfer?.files;

  if (!droppedFiles || droppedFiles.length === 0) {
    return;
  }

  try {
    const fileList = Array.from(droppedFiles);
    const serializedFiles = await Promise.all(
      fileList.map((file) => serializeFileForTransfer(file)),
    );

    await ipcRenderer.invoke("broadcast-file-drop", serializedFiles);
  } catch (error) {
    console.error("Error processing dropped files", error);
  }
};

const notifyPromptAreaSize = (): void => {
  if (!promptArea) {
    return;
  }

  const rect = promptArea.getBoundingClientRect();
  // Expose prompt area height as CSS variable for layout (e.g., sidebar bottom)
  try {
    document.documentElement.style.setProperty(
      "--prompt-area-height",
      `${Math.max(0, Math.round(rect.height))}px`,
    );
  } catch { }
  ipcRenderer.send("prompt-area-size", rect.height);
  // New unified measurement so main can also reserve right dock in future
  ipcRenderer.send("ui-chrome-size", { bottom: Math.max(0, Math.round(rect.height)), right: 0 });
};

const initializePromptAreaObserver = (): void => {
  promptArea = document.getElementById("prompt-area");

  if (!promptArea) {
    return;
  }

  promptArea.addEventListener("dragover", (event: DragEvent) => {
    event.preventDefault();
    if (!event.dataTransfer) {
      return;
    }

    event.dataTransfer.dropEffect = "copy";
    promptArea?.classList.add("drag-active");
  });

  promptArea.addEventListener("dragenter", (event: DragEvent) => {
    event.preventDefault();
    promptArea?.classList.add("drag-active");
  });

  promptArea.addEventListener("dragleave", () => {
    removeDragActiveState();
  });

  promptArea.addEventListener("dragend", () => {
    removeDragActiveState();
  });

  promptArea.addEventListener("drop", handleFileDrop);

  window.addEventListener(
    "drop",
    (event: DragEvent) => {
      if (!promptArea?.contains(event.target as Node)) {
        event.preventDefault();
        removeDragActiveState();
      }
    },
    true,
  );

  window.addEventListener(
    "dragover",
    (event: DragEvent) => {
      event.preventDefault();
      if (!promptArea?.classList.contains("drag-active")) {
        event.dataTransfer && (event.dataTransfer.dropEffect = "none");
      }
    },
    true,
  );

  const promptAreaObserver = new ResizeObserver(() => {
    notifyPromptAreaSize();
  });

  promptAreaObserver.observe(promptArea);
  window.addEventListener("resize", notifyPromptAreaSize);
  window.addEventListener("orientationchange", notifyPromptAreaSize);

  notifyPromptAreaSize();
};

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", initializePromptAreaObserver, {
    once: true,
  });
} else {
  initializePromptAreaObserver();
}

export function logToWebPage(message: string): void {
  ipcRenderer.send("enter-prompt", message);
}

export function openClaudeMessage(message: string): void {
  ipcRenderer.send("open-claude", message);
}

export function closeClaudeMessage(message: string): void {
  ipcRenderer.send("close-claude", message);
}

export function openDeepSeekMessage(message: string): void {
  ipcRenderer.send("open-deepseek", message);
}

export function closeDeepSeekMessage(message: string): void {
  ipcRenderer.send("close-deepseek", message);
}

export function openGrokMessage(message: string): void {
  ipcRenderer.send("open-grok", message);
}

export function closeGrokMessage(message: string): void {
  ipcRenderer.send("close-grok", message);
}

const textArea = document.getElementById(
  "prompt-input",
) as HTMLTextAreaElement | null;


// Provider toggle functionality
const providerToggles = document.querySelectorAll<HTMLButtonElement>('.provider-toggle');

const updateProviderToggles = async (): Promise<void> => {
  try {
    const urls = ((await ipcRenderer.invoke("get-current-urls")) ?? []) as string[];
    const activeProviders = urls.map(url => inferProviderFromUrl(url));

    providerToggles.forEach(toggle => {
      const provider = toggle.dataset.provider;
      if (provider && activeProviders.includes(provider)) {
        toggle.classList.add('active');
      } else {
        toggle.classList.remove('active');
      }
    });
  } catch (error) {
    console.error("Failed to update provider toggles", error);
  }
};

const inferProviderFromUrl = (url: string): string => {
  try {
    const u = new URL(url);
    const host = u.hostname;
    if (/chatgpt\.com|chat\.openai\.com/i.test(host)) return "chatgpt";
    if (/gemini\.google\.com/i.test(host)) return "gemini";
    if (/perplexity\.ai/i.test(host)) return "perplexity";
    if (/claude\.ai/i.test(host)) return "claude";
    if (/grok\.com/i.test(host)) return "grok";
    if (/deepseek\.com/i.test(host)) return "deepseek";
    return host;
  } catch {
    return url;
  }
};

providerToggles.forEach(toggle => {
  toggle.addEventListener('click', async () => {
    const provider = toggle.dataset.provider;
    if (!provider) return;

    try {
      const urls = ((await ipcRenderer.invoke("get-current-urls")) ?? []) as string[];
      const activeProviders = urls.map(url => inferProviderFromUrl(url));
      const isActive = activeProviders.includes(provider);

      if (isActive) {
        // Close provider
        ipcRenderer.send(`close-${provider}`, `close ${provider} now`);
      } else {
        // Open provider
        ipcRenderer.send(`open-${provider}`, `open ${provider} now`);
      }

      // Update toggles after a short delay to allow IPC to process
      setTimeout(updateProviderToggles, 100);
    } catch (error) {
      console.error(`Failed to toggle ${provider}`, error);
    }
  });
});

// Initial update
updateProviderToggles();

if (textArea) {
  textArea.addEventListener("input", (event: Event) => {
    logToWebPage((event.target as HTMLTextAreaElement).value);
  });

  textArea.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.ctrlKey) {
      if (event.key === "Enter") {
        event.preventDefault();
        ipcRenderer.send("send-prompt", textArea.value.trim());
        console.log("Ctrl + Enter pressed");
        textArea.value = "";
      }
    }
  });
}



// Copy All Answers button handler
const copyAllAnswersButton = document.getElementById(
  "copy-all-answers",
) as HTMLButtonElement | null;

if (copyAllAnswersButton) {
  copyAllAnswersButton.addEventListener("click", async () => {
    const originalLabel = copyAllAnswersButton.textContent;
    copyAllAnswersButton.textContent = "Copying...";
    copyAllAnswersButton.disabled = true;

    try {
      const result = await ipcRenderer.invoke("copy-all-answers");

      if (result.success) {
        copyAllAnswersButton.textContent = `Copied ${result.count} answer(s)!`;
      } else {
        copyAllAnswersButton.textContent = result.message || "No Answers Found";
      }
    } catch (error) {
      console.error("Failed to copy all answers", error);
      copyAllAnswersButton.textContent = "Copy Failed";
    }

    setTimeout(() => {
      copyAllAnswersButton.textContent = originalLabel ?? "Copy All Answers";
      copyAllAnswersButton.disabled = false;
    }, 1500);
  });
}

ipcRenderer.on("inject-prompt", (event, selectedPrompt: string) => {
  console.log("Injecting prompt into textarea:", selectedPrompt);

  const promptInput = document.getElementById(
    "prompt-input",
  ) as HTMLTextAreaElement;
  if (promptInput) {
    promptInput.value = selectedPrompt; // Inject the selected prompt into the textarea
  } else {
    console.error("Textarea not found");
  }
});

// Initialize sessions sidebar after DOM is ready
// Initialize embedded sessions sidebar (left, visible by default)
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", () => {
    try { initSessionSidebar(); } catch (err) { console.error(err); }
  }, { once: true });
} else {
  try { initSessionSidebar(); } catch (err) { console.error(err); }
}

// ----- View Headers Implementation -----

function updateViewHeaders(layouts: ViewLayout[]) {
  if (!viewHeadersContainer) {
    viewHeadersContainer = document.getElementById('view-headers-container');
    if (!viewHeadersContainer) return;
  }

  currentViewLayouts = layouts;

  // Clear existing (simple approach; optimization possible if thrashing)
  viewHeadersContainer.innerHTML = '';

  layouts.forEach(layout => {
    const header = document.createElement('div');
    header.className = 'view-header';
    header.style.left = `${layout.headerBounds.x}px`;
    header.style.top = `${layout.headerBounds.y}px`;
    header.style.width = `${layout.headerBounds.width}px`;
    header.style.height = `${layout.headerBounds.height}px`;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = layout.url || '';
    input.placeholder = 'Enter URL...';

    // Prevent keydown from bubbling to global handlers (like Ctrl+Enter sender)
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const url = input.value.trim();
        if (url) {
          ipcRenderer.send('view-navigate', { id: layout.id, url });
        }
      }
    });

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.title = 'Copy URL to clipboard';
    copyBtn.addEventListener('click', () => {
      if (layout.url) {
        ipcRenderer.send('copy-to-clipboard', layout.url);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      }
    });

    header.appendChild(input);
    header.appendChild(copyBtn);
    viewHeadersContainer?.appendChild(header);
  });
}

// Listen for layout updates from main process
ipcRenderer.on('view-layout-updated', (_event, layouts: ViewLayout[]) => {
  updateViewHeaders(layouts);
});

// Ensure container reference on load
window.addEventListener('DOMContentLoaded', () => {
  viewHeadersContainer = document.getElementById('view-headers-container');
});
