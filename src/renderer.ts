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
  } catch {}
  ipcRenderer.send("prompt-area-size", rect.height);
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

export function openLMArena(message: string): void {
  ipcRenderer.send("open-lm-arena", message);
}

export function closeLMArena(message: string): void {
  ipcRenderer.send("close-lm-arena", message);
}

const textArea = document.getElementById(
  "prompt-input",
) as HTMLTextAreaElement | null;
const openClaudeButton = document.getElementById(
  "showClaude",
) as HTMLButtonElement | null;
const openGrokButton = document.getElementById(
  "showGrok",
) as HTMLButtonElement | null;
const openDeepSeekButton = document.getElementById(
  "showDeepSeek",
) as HTMLButtonElement | null;

const openLMArenaButton = document.getElementById(
  "showLMArena",
) as HTMLButtonElement | null;

const promptDropdownButton = document.querySelector(
  ".prompt-select",
) as HTMLButtonElement | null;
const copyAgentPromptButton = document.getElementById(
  "copy-agent-prompt",
) as HTMLButtonElement | null;

if (openClaudeButton) {
  openClaudeButton.addEventListener("click", (event: MouseEvent) => {
    if (openClaudeButton.textContent === "Show Claude") {
      openClaudeMessage("open claude now");
      openClaudeButton.textContent = "Hide Claude";
    } else {
      closeClaudeMessage("close claude now");
      openClaudeButton.textContent = "Show Claude";
    }
  });
}

if (openGrokButton) {
  openGrokButton.addEventListener("click", (event: MouseEvent) => {
    if (openGrokButton.textContent === "Show Grok") {
      openGrokMessage("open grok now");
      openGrokButton.textContent = "Hide Grok";
    } else {
      closeGrokMessage("close grok now");
      openGrokButton.textContent = "Show Grok";
    }
  });
}

if (openDeepSeekButton) {
  openDeepSeekButton.addEventListener("click", (event: MouseEvent) => {
    if (openDeepSeekButton.textContent === "Show DeepSeek") {
      openDeepSeekMessage("open deepseek now");
      openDeepSeekButton.textContent = "Hide DeepSeek";
    } else {
      closeDeepSeekMessage("close deepseek now");
      openDeepSeekButton.textContent = "Show DeepSeek";
    }
  });
}

if (openLMArenaButton) {
  openLMArenaButton.addEventListener("click", (event: MouseEvent) => {
    if (openLMArenaButton.textContent === "Show LMArena") {
      openLMArena("open lm arena now");
      openLMArenaButton.textContent = "Hide LMArena";
    } else {
      closeLMArena("close lm arena now");
      openLMArenaButton.textContent = "Show LMArena";
    }
  });
}

if (textArea) {
  textArea.addEventListener("input", (event: Event) => {
    logToWebPage((event.target as HTMLTextAreaElement).value);
  });

  textArea.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.ctrlKey) {
      if (event.key === "Enter") {
        event.preventDefault();
        ipcRenderer.send("send-prompt");
        console.log("Ctrl + Enter pressed");
        textArea.value = "";
      }
    }
  });
}

if (promptDropdownButton) {
  promptDropdownButton.addEventListener("click", (event: MouseEvent) => {
    console.log("Prompt dropdown button clicked");
    event.stopPropagation();
    ipcRenderer.send("open-form-window");
  });
}

if (copyAgentPromptButton) {
  copyAgentPromptButton.addEventListener("click", async () => {
    try {
      const urls = ((await ipcRenderer.invoke(
        "get-current-urls",
      )) ?? []) as string[];

      const filteredUrls = urls
        .map((url) => url.trim())
        .filter((url) => url.length > 0);

      if (filteredUrls.length === 0) {
        copyAgentPromptButton.textContent = "No Tabs Found";
        setTimeout(() => {
          copyAgentPromptButton.textContent = "Copy Agent Prompt";
        }, 1500);
        return;
      }

      const userPrompt = textArea?.value.trim();

      const promptSections = [
        "You are operating inside Comet Browser. For each link below, open it in Comet, read the page thoroughly, and craft the best possible answer for the user based only on these pages. Do not use any tools or sources outside Comet or the provided links.",
      ];

      if (userPrompt && userPrompt.length > 0) {
        promptSections.push("\nUser request:\n" + userPrompt);
      } else {
        promptSections.push("\nUser request: (not provided)");
      }

      const urlList = filteredUrls
        .map((url, index) => `${index + 1}. ${url}`)
        .join("\n");

      promptSections.push(
        "\nLinks to open in Comet (visit all before responding):\n" + urlList,
      );

      promptSections.push(
        "\nAfter visiting the pages in Comet, synthesize the insights into a comprehensive answer. Reference the sources you used with their URLs.",
      );

      const agentPrompt = promptSections.join("\n");

      ipcRenderer.send("copy-to-clipboard", agentPrompt);

      const originalLabel = copyAgentPromptButton.textContent;
      copyAgentPromptButton.textContent = "Copied!";
      setTimeout(() => {
        copyAgentPromptButton.textContent =
          originalLabel ?? "Copy Agent Prompt";
      }, 1500);
    } catch (error) {
      console.error("Failed to build agent prompt", error);
      const originalLabel = copyAgentPromptButton.textContent;
      copyAgentPromptButton.textContent = "Copy Failed";
      setTimeout(() => {
        copyAgentPromptButton.textContent =
          originalLabel ?? "Copy Agent Prompt";
      }, 1500);
    }
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
