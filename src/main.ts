import {
  app,
  BrowserWindow,
  ipcMain,
  IpcMainEvent,
  WebContentsView,
  nativeTheme,
  clipboard,
} from "electron";
import * as remote from "@electron/remote/main/index.js";
import path from "path";
import electronLocalShortcut from "electron-localshortcut";
import {
  addBrowserView,
  removeBrowserView,
  injectPromptIntoView,
  sendPromptInView,
} from "./utilities.js"; // Adjusted path
import { applyCustomStyles } from "./customStyles.js";
import { createRequire } from "node:module"; // Import createRequire
import { fileURLToPath } from "node:url"; // Import fileURLToPath
import Store from "electron-store"; // Import electron-store

const require = createRequire(import.meta.url);
const store = new Store(); // Create an instance of electron-store

interface CustomBrowserView extends WebContentsView {
  id: string; // Make id optional as it's assigned after creation
}

if (require("electron-squirrel-startup")) app.quit();

remote.initialize();

let mainWindow: BrowserWindow;
let formWindow: BrowserWindow | null; // Allow formWindow to be null
let pendingRowSelectedKey: string | null = null; // Store the key of the selected row for later use

const views: CustomBrowserView[] = [];
let promptAreaHeight = 0;
let browserViewsInitialized = false;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// require("electron-reload")(path.join(__dirname, "."));

const websites: string[] = [
  "https://chatgpt.com/",
  "https://gemini.google.com/",
  "https://www.perplexity.ai/",
];

async function adjustBrowserViewBounds(): Promise<void> {
  if (!mainWindow) {
    return;
  }

  const { width, height } = mainWindow.getContentBounds();
  const availableHeight = Math.max(height - promptAreaHeight, 0);
  const viewWidth = websites.length > 0 ? Math.floor(width / websites.length) : width;

  views.forEach((view, index) => {
    view.setBounds({
      x: index * viewWidth,
      y: 0,
      width: viewWidth,
      height: availableHeight,
    });
  });
}

async function initializeBrowserViews(): Promise<void> {
  if (!mainWindow || browserViewsInitialized) {
    await adjustBrowserViewBounds();
    return;
  }

  const { width, height } = mainWindow.getContentBounds();
  const viewWidth = websites.length > 0 ? Math.floor(width / websites.length) : width;
  const availableHeight = Math.max(height - promptAreaHeight, 0);

  browserViewsInitialized = true;

  websites.forEach((url: string, index: number) => {
    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    }) as CustomBrowserView; // Cast to CustomBrowserView

    view.id = `${url}`;
    mainWindow.contentView.addChildView(view);
    view.setBounds({
      x: index * viewWidth,
      y: 0,
      width: viewWidth,
      height: availableHeight,
    });
    view.webContents.setZoomFactor(1);
    applyCustomStyles(view.webContents);
    view.webContents.loadURL(url);

    views.push(view);
  });

  await adjustBrowserViewBounds();
  updateZoomFactor();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 2000,
    height: 1100,
    center: true,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"), // This will point to dist/preload.js at runtime
      nodeIntegration: true,
      contextIsolation: false,
      offscreen: false,
    },
  });
  remote.enable(mainWindow.webContents);

  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();

  mainWindow.loadFile(path.join(__dirname, "..", "index.html")); // Changed to point to root index.html

  // mainWindow.webContents.openDevTools({ mode: "detach" });
  mainWindow.on("enter-full-screen", () => {
    void adjustBrowserViewBounds();
    updateZoomFactor();
  });

  mainWindow.on("leave-full-screen", () => {
    void adjustBrowserViewBounds();
    updateZoomFactor();
  });

  mainWindow.on("focus", () => {
    mainWindow.webContents.invalidate();
  });

  let resizeTimeout: NodeJS.Timeout;

  mainWindow.on("resize", () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      void adjustBrowserViewBounds();
      updateZoomFactor();
    }, 200);
  });

  mainWindow.webContents.once("did-finish-load", () => {
    void initializeBrowserViews();
  });
}

function createFormWindow() {
  formWindow = new BrowserWindow({
    width: 900,
    height: 900,
    parent: mainWindow,
    modal: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "dist", "form_preload.js"), // Use the same preload script
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  formWindow.loadFile(path.join(__dirname, "..", "src", "form.html"));
}

function updateZoomFactor(): void {
  views.forEach((view) => {
    view.webContents.setZoomFactor(1);
  });
}

app.whenReady().then(() => {
  nativeTheme.themeSource = "dark";
  createWindow();

  electronLocalShortcut.register(mainWindow, "Ctrl+W", () => {
    app.quit();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.on("prompt-area-size", (_, height: number) => {
  const normalizedHeight = Math.max(0, Math.round(height));

  if (normalizedHeight === promptAreaHeight) {
    return;
  }

  promptAreaHeight = normalizedHeight;

  if (browserViewsInitialized) {
    void adjustBrowserViewBounds();
    updateZoomFactor();
  } else {
    void initializeBrowserViews();
  }
});

ipcMain.on("open-form-window", () => {
  createFormWindow();
});

ipcMain.on("close-form-window", () => {
  if (formWindow) {
    formWindow.close();
    formWindow = null; // Clear the reference
  }
});

ipcMain.handle("get-current-urls", () => {
  return views.map((view) => {
    const currentUrl = view.webContents.getURL();
    if (currentUrl && currentUrl.length > 0) {
      return currentUrl;
    }

    return view.id ?? "";
  });
});

ipcMain.on("copy-to-clipboard", (_, text: string) => {
  clipboard.writeText(text ?? "");
});

ipcMain.on("save-prompt", (event, promptValue: string) => {
  const timestamp = new Date().getTime().toString();
  store.set(timestamp, promptValue);

  console.log("Prompt saved with key:", timestamp);
});

// Add handler to get stored prompts
ipcMain.handle("get-prompts", () => {
  return store.store; // Returns all stored data
});

ipcMain.on("paste-prompt", (_: IpcMainEvent, prompt: string) => {
  mainWindow.webContents.send("inject-prompt", prompt);

  views.forEach((view: CustomBrowserView) => {
    injectPromptIntoView(view, prompt);
  });
});

ipcMain.on("enter-prompt", (_: IpcMainEvent, prompt: string) => {
  // Added type for prompt
  views.forEach((view: CustomBrowserView) => {
    injectPromptIntoView(view, prompt);
  });
});

ipcMain.on("send-prompt", (_, prompt: string) => {
  // Added type for prompt (though unused here)
  views.forEach((view) => {
    sendPromptInView(view);
  });
});

ipcMain.on("delete-prompt-by-value", (event, value: string) => {
  value = value.normalize("NFKC");
  // Get all key-value pairs from the store
  const allEntries = store.store; // `store.store` gives the entire object

  // Find the key that matches the given value
  const matchingKey = Object.keys(allEntries).find(
    (key) => allEntries[key] === value,
  );

  if (matchingKey) {
    store.delete(matchingKey);
    console.log(`Deleted entry with key: ${matchingKey} and value: ${value}`);
  } else {
    console.error(`No matching entry found for value: ${value}`);
  }
});

ipcMain.on("open-lm-arena", (_, prompt: string) => {
  if (prompt === "open lm arena now") {
    console.log("Opening LMArena");
    let url = "https://lmarena.ai/?mode=direct";
    addBrowserView(mainWindow, url, websites, views, { promptAreaHeight });
    void adjustBrowserViewBounds();
  }
});

ipcMain.on("close-lm-arena", (_, prompt: string) => {
  if (prompt === "close lm arena now") {
    console.log("Closing LMArena");
    const lmArenaView = views.find((view) => view.id.match("lmarena"));
    if (lmArenaView) {
      removeBrowserView(mainWindow, lmArenaView, websites, views, { promptAreaHeight });
      void adjustBrowserViewBounds();
    }
  }
});

ipcMain.on("open-claude", (_, prompt: string) => {
  if (prompt === "open claude now") {
    console.log("Opening Claude");
    let url = "https://claude.ai/chats/";
    addBrowserView(mainWindow, url, websites, views, { promptAreaHeight });
    void adjustBrowserViewBounds();
  }
});

ipcMain.on("close-claude", (_, prompt: string) => {
  if (prompt === "close claude now") {
    console.log("Closing Claude");
    const claudeView = views.find((view) => view.id.match("claude"));
    if (claudeView) {
      removeBrowserView(mainWindow, claudeView, websites, views, { promptAreaHeight });
      void adjustBrowserViewBounds();
    }
  }
});

ipcMain.on("open-grok", (_, prompt: string) => {
  if (prompt === "open grok now") {
    console.log("Opening Grok");
    let url = "https://grok.com/";
    addBrowserView(mainWindow, url, websites, views, { promptAreaHeight });
    void adjustBrowserViewBounds();
  }
});

ipcMain.on("close-grok", (_, prompt: string) => {
  if (prompt === "close grok now") {
    console.log("Closing Grok");
    const grokView = views.find((view) => view.id.match("grok"));
    if (grokView) {
      removeBrowserView(mainWindow, grokView, websites, views, { promptAreaHeight });
      void adjustBrowserViewBounds();
    }
  }
});

ipcMain.on("open-deepseek", (_, prompt: string) => {
  if (prompt === "open deepseek now") {
    console.log("Opening DeepSeek");
    let url = "https://chat.deepseek.com/";
    addBrowserView(mainWindow, url, websites, views, { promptAreaHeight });
    void adjustBrowserViewBounds();
  }
});

ipcMain.on("close-deepseek", (_, prompt: string) => {
  if (prompt === "close deepseek now") {
    console.log("Closing Deepseek");
    const deepseekView = views.find((view) => view.id.match("deepseek"));
    if (deepseekView) {
      removeBrowserView(mainWindow, deepseekView, websites, views, { promptAreaHeight });
      void adjustBrowserViewBounds();
    }
  }
});

ipcMain.on("open-edit-view", (_, prompt: string) => {
  console.log("Opening edit view for prompt:", prompt);
  prompt = prompt.normalize("NFKC");

  const editWindow = new BrowserWindow({
    width: 500,
    height: 600,
    parent: formWindow || mainWindow, // Use mainWindow as a fallback if formWindow is null
    modal: true, // Make it a modal window
    webPreferences: {
      preload: path.join(__dirname, "..", "dist", "form_preload.js"), // Use the same preload script
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  editWindow.loadFile(path.join(__dirname, "..", "src", "edit_prompt.html"));
  // Optionally, inject the prompt into the textarea
  editWindow.webContents.once("did-finish-load", () => {
    editWindow.webContents.executeJavaScript(`
      const textarea = document.getElementById('template-content');
      if (textarea) {
        textarea.value = \`${prompt}\`;
      }
    `);
  });

  console.log("Edit window created.");
});

ipcMain.on("edit-prompt-ready", (event) => {
  if (pendingRowSelectedKey) {
    event.sender.send("row-selected", pendingRowSelectedKey);
    console.log(
      `Sent row-selected message to edit_prompt.html with key: ${pendingRowSelectedKey} (on renderer ready)`,
    );
    pendingRowSelectedKey = null;
  } else {
    console.log("edit-prompt-ready received, but no pending key to send.");
  }
});

ipcMain.on(
  "update-prompt",
  (_, { key, value }: { key: string; value: string }) => {
    if (store.has(key)) {
      store.set(key, value);
      console.log(`Updated prompt with key "${key}" to: "${value}"`);
    } else {
      console.error(`No entry found for key: "${key}"`);
    }
  },
);

ipcMain.on("row-selected", (_, key: string) => {
  console.log(`Row selected with key: ${key}`);
  pendingRowSelectedKey = key;
});

// Add handler to fetch the key from the store based on the value.
ipcMain.handle("get-key-by-value", (_, value: string) => {
  value = value.normalize("NFKC"); // Normalize the value for consistency
  const allEntries = store.store; // Get all key-value pairs from the store

  console.log("Store contents:", allEntries); // Log the store contents

  // Find the key that matches the given value
  const matchingKey = Object.keys(allEntries).find(
    (key) => allEntries[key] === value,
  );

  if (matchingKey) {
    console.log(`Found key "${matchingKey}" for value: "${value}"`);
    return matchingKey;
  } else {
    console.error(`No matching key found for value: "${value}"`);
    return null;
  }
});

ipcMain.on("close-edit-window", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.close();
  }
});

ipcMain.on("close-edit-window", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.close();

    // Notify the form window to refresh the table
    if (formWindow && !formWindow.isDestroyed()) {
      formWindow.webContents.send("refresh-prompt-table");
    }
  }
});
