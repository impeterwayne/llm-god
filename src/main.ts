import {
  app,
  BrowserWindow,
  ipcMain,
  IpcMainEvent,
  IpcMainInvokeEvent,
  WebContentsView,
  nativeTheme,
  clipboard,
  screen,
} from "electron";
import * as remote from "@electron/remote/main/index.js";
import path from "path";
import electronLocalShortcut from "electron-localshortcut";
import {
  addBrowserView,
  removeBrowserView,
  injectPromptIntoView,
  sendPromptInView,
  simulateFileDropInView,
  ensureDetachedDevTools,
} from "./utilities.js"; // Adjusted path
import type { SerializedFile } from "./utilities.js";
import { applyCustomStyles } from "./customStyles.js";
import { createRequire } from "node:module"; // Import createRequire
import { fileURLToPath } from "node:url"; // Import fileURLToPath
import Store from "electron-store"; // Import electron-store

const require = createRequire(import.meta.url);
const store = new Store(); // Create an instance of electron-store (prompts)
const sessionStore = new Store({ name: "sessions" }); // Separate store for sessions

interface CustomBrowserView extends WebContentsView {
  id: string; // Make id optional as it's assigned after creation
}

if (require("electron-squirrel-startup")) app.quit();

remote.initialize();

let mainWindow: BrowserWindow;
let formWindow: BrowserWindow | null; // Allow formWindow to be null
let sessionsWindow: BrowserWindow | null = null;
let linkSessionsToMain = true; // keep sessions window docked to main
let pendingRowSelectedKey: string | null = null; // Store the key of the selected row for later use

const views: CustomBrowserView[] = [];
let promptAreaHeight = 0;
let sidebarWidth = 280; // default reserve for left sidebar; renderer will update
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
  const availableWidth = Math.max(width - sidebarWidth, 0);
  const viewWidth = websites.length > 0 ? Math.floor(availableWidth / websites.length) : availableWidth;

  views.forEach((view, index) => {
    view.setBounds({
      x: sidebarWidth + index * viewWidth,
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
  const availableWidth = Math.max(width - sidebarWidth, 0);
  const viewWidth = websites.length > 0 ? Math.floor(availableWidth / websites.length) : availableWidth;
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
      x: sidebarWidth + index * viewWidth,
      y: 0,
      width: viewWidth,
      height: availableHeight,
    });
    view.webContents.setZoomFactor(1);
    applyCustomStyles(view.webContents);
    view.webContents.loadURL(url);

    ensureDetachedDevTools(view);

    views.push(view);
  });

  await adjustBrowserViewBounds();
  updateZoomFactor();
}

// ----- Sessions storage/types -----
type SessionId = string;
type ProviderId =
  | "chatgpt"
  | "gemini"
  | "claude"
  | "perplexity"
  | "grok"
  | "deepseek"
  | "lmarena"
  | string;

interface TabState {
  provider: ProviderId;
  url: string;
  zoom?: number;
}

interface SessionMeta {
  id: SessionId;
  title: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  lastMessageSummary?: string;
}

interface SessionState {
  activeId: SessionId | null;
  order: SessionId[];
  pinned: SessionId[];
  items: Record<SessionId, SessionMeta>;
  layouts: Record<SessionId, { tabs: TabState[] } >;
}

function getDefaultSessionState(): SessionState {
  return {
    activeId: null,
    order: [],
    pinned: [],
    items: {},
    layouts: {},
  };
}

function getSessionState(): SessionState {
  const state = sessionStore.get("state") as SessionState | undefined;
  if (!state) return getDefaultSessionState();
  // ensure shape
  return {
    activeId: state.activeId ?? null,
    order: Array.isArray(state.order) ? state.order : [],
    pinned: Array.isArray(state.pinned) ? state.pinned : [],
    items: state.items ?? {},
    layouts: state.layouts ?? {},
  };
}

function setSessionState(next: SessionState) {
  sessionStore.set("state", next);
}

function ensureDefaultSession(): void {
  const state = getSessionState();
  const hasAny = Object.keys(state.items).length > 0;
  if (hasAny) return;
  const id: SessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const tabs = getCurrentTabsSnapshot();
  const defaultTitle = `Session ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')}`;
  const meta: SessionMeta = {
    id,
    title: defaultTitle,
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
  state.items[id] = meta;
  state.layouts[id] = { tabs };
  state.order = [id];
  state.activeId = id;
  setSessionState(state);
}

function inferProviderFromUrl(url: string): ProviderId {
  try {
    const u = new URL(url);
    const host = u.hostname;
    if (/chatgpt\.com|chat\.openai\.com/i.test(host)) return "chatgpt";
    if (/gemini\.google\.com/i.test(host)) return "gemini";
    if (/perplexity\.ai/i.test(host)) return "perplexity";
    if (/claude\.ai/i.test(host)) return "claude";
    if (/grok\.com/i.test(host)) return "grok";
    if (/deepseek\.com/i.test(host)) return "deepseek";
    if (/lmarena\.ai/i.test(host)) return "lmarena";
    return host;
  } catch {
    return url;
  }
}

const PROVIDER_BASE_URL: Record<string, string> = {
  chatgpt: "https://chatgpt.com/",
  gemini: "https://gemini.google.com/",
  perplexity: "https://www.perplexity.ai/",
  claude: "https://claude.ai/chats/",
  grok: "https://grok.com/",
  deepseek: "https://chat.deepseek.com/",
  lmarena: "https://lmarena.ai/?mode=direct",
};

function getCurrentTabsSnapshot(): TabState[] {
  return views.map((view) => {
    const url = view.webContents.getURL() || view.id;
    const zoom = 1; // currently fixed; could be read if varied per view
    return {
      provider: inferProviderFromUrl(url),
      url,
      zoom,
    };
  });
}

function restoreLayout(tabs: TabState[]): void {
  // Close all existing views
  const toRemove = [...views];
  toRemove.forEach((v) => {
    removeBrowserView(mainWindow, v, websites, views, { promptAreaHeight, sidebarWidth });
  });

  // Clear websites list
  websites.splice(0, websites.length);

  // Recreate views based on tabs
  tabs.forEach((tab) => {
    const url = tab.url && tab.url.length > 0 ? tab.url : PROVIDER_BASE_URL[tab.provider] || tab.url;
    addBrowserView(mainWindow, url, websites, views, { promptAreaHeight, sidebarWidth });
  });

  void adjustBrowserViewBounds();
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
      layoutWindows();
    }, 200);
  });

  mainWindow.webContents.once("did-finish-load", () => {
    void initializeBrowserViews();
  });

  // Keep sessions window docked on move as well
  mainWindow.on("move", () => {
    // Throttle slightly using same timer
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      layoutWindows();
    }, 50);
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

function createSessionsWindow() {
  if (sessionsWindow && !sessionsWindow.isDestroyed()) {
    sessionsWindow.focus();
    return;
  }
  const bounds = mainWindow.getBounds();
  sessionsWindow = new BrowserWindow({
    width: 320,
    height: bounds.height,
    x: bounds.x - 320,
    y: bounds.y,
    titleBarStyle: "default",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "dist", "sessions_preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  sessionsWindow.on("closed", () => { sessionsWindow = null; });
  sessionsWindow.loadFile(path.join(__dirname, "..", "src", "sessions.html"));
  // position after load to ensure proper bounds
  ensureDefaultSession();
  layoutWindows();
}

ipcMain.on("toggle-sessions-window", () => {
  if (sessionsWindow && !sessionsWindow.isDestroyed()) {
    sessionsWindow.close();
    sessionsWindow = null;
    return;
  }
  createSessionsWindow();
});

function layoutWindows() {
  if (!sessionsWindow || sessionsWindow.isDestroyed() || !linkSessionsToMain) return;
  try {
    const m = mainWindow.getBounds();
    const display = screen.getDisplayMatching(m);
    const area = display.workArea;
    const sw = Math.max(280, Math.min(420, sessionsWindow.getBounds().width || 320));
    const minMainWidth = 800;
    const maxMainWidth = area.width - sw;
    const mainWidth = Math.max(Math.min(m.width, maxMainWidth), Math.min(minMainWidth, maxMainWidth));
    const mainHeight = Math.min(m.height, area.height);

    // Prefer left docking
    const dockLeft = (m.x - sw) >= area.x;
    let mx: number, sx: number;
    const my = Math.max(area.y, Math.min(m.y, area.y + area.height - mainHeight));
    const sy = my;

    if (dockLeft) {
      sx = area.x;
      mx = area.x + sw;
    } else {
      mx = area.x;
      sx = area.x + mainWidth;
    }

    // Apply bounds in order to avoid overlap
    mainWindow.setBounds({ x: mx, y: my, width: mainWidth, height: mainHeight });
    sessionsWindow.setBounds({ x: sx, y: sy, width: sw, height: mainHeight });
  } catch (err) {
    console.warn("Failed to layout windows", err);
  }
}

// Sidebar size updates from renderer
ipcMain.on("sidebar-size", (_, width: number) => {
  const normalized = Math.max(0, Math.round(width || 0));
  if (normalized !== sidebarWidth) {
    sidebarWidth = normalized;
    void adjustBrowserViewBounds();
    // Run a second pass shortly after to handle layout thrash on expand
    setTimeout(() => {
      void adjustBrowserViewBounds();
    }, 50);
  }
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

ipcMain.handle(
  "broadcast-file-drop",
  async (_: IpcMainInvokeEvent, files: SerializedFile[]) => {
    if (!Array.isArray(files) || files.length === 0) {
      return;
    }

    await Promise.all(
      views.map((view: CustomBrowserView) =>
        simulateFileDropInView(view, files).catch((error) => {
          console.error("Failed to deliver dropped files to view", view.id, error);
        }),
      ),
    );
  },
);

ipcMain.on("send-prompt", (_, prompt: string) => {
  // Added type for prompt (though unused here)
  views.forEach((view) => {
    sendPromptInView(view);
  });
});

// ----- Sessions IPC -----
ipcMain.handle("sessions:list", () => {
  ensureDefaultSession();
  const state = getSessionState();
  const items: SessionMeta[] = [];
  const pushIf = (id: string) => {
    const meta = state.items[id];
    if (meta) items.push(meta);
  };
  state.pinned.forEach(pushIf);
  state.order.forEach(pushIf);
  return { items };
});

ipcMain.handle("sessions:create", () => {
  const state = getSessionState();
  const id: SessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const tabs = getCurrentTabsSnapshot();
  const defaultTitle = `Session ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')}`;
  const meta: SessionMeta = {
    id,
    title: defaultTitle,
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };

  state.items[id] = meta;
  state.layouts[id] = { tabs };
  state.order = [id, ...state.order.filter((x) => x !== id && !state.pinned.includes(x))];
  state.activeId = id;
  setSessionState(state);
  mainWindow.webContents.send("sessions:changed", { updatedIds: [id] });
  return { id };
});

ipcMain.handle("sessions:get-layout", (_evt, { id }: { id: SessionId }) => {
  const state = getSessionState();
  return state.layouts[id] ?? { tabs: [] };
});

ipcMain.handle("sessions:save-layout", (_evt, { id, tabs }: { id: SessionId; tabs: TabState[] }) => {
  const state = getSessionState();
  if (!state.items[id]) {
    throw new Error("Unknown session id");
  }
  state.layouts[id] = { tabs: Array.isArray(tabs) ? tabs : [] };
  const meta = state.items[id];
  meta.updatedAt = Date.now();
  setSessionState(state);
  mainWindow.webContents.send("sessions:changed", { updatedIds: [id] });
});

ipcMain.handle("sessions:open", (_evt, { id }: { id: SessionId }) => {
  const state = getSessionState();
  const layout = state.layouts[id];
  if (!layout) {
    throw new Error("No layout saved for session");
  }
  state.activeId = id;
  setSessionState(state);
  restoreLayout(layout.tabs);
  mainWindow.webContents.send("sessions:active-changed", { id });
});

ipcMain.handle("sessions:rename", (_evt, { id, title }: { id: SessionId; title: string }) => {
  const state = getSessionState();
  const meta = state.items[id];
  if (!meta) throw new Error("Unknown session id");
  meta.title = (title ?? "").trim() || meta.title;
  meta.updatedAt = Date.now();
  setSessionState(state);
  mainWindow.webContents.send("sessions:changed", { updatedIds: [id] });
});

ipcMain.handle("sessions:delete", (_evt, { id }: { id: SessionId }) => {
  const state = getSessionState();
  delete state.items[id];
  delete state.layouts[id];
  state.order = state.order.filter((x) => x !== id);
  state.pinned = state.pinned.filter((x) => x !== id);
  if (state.activeId === id) state.activeId = null;
  setSessionState(state);
  mainWindow.webContents.send("sessions:changed", { updatedIds: [id] });
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
    addBrowserView(mainWindow, url, websites, views, { promptAreaHeight, sidebarWidth });
    void adjustBrowserViewBounds();
  }
});

ipcMain.on("close-lm-arena", (_, prompt: string) => {
  if (prompt === "close lm arena now") {
    console.log("Closing LMArena");
    const lmArenaView = views.find((view) => view.id.match("lmarena"));
    if (lmArenaView) {
      removeBrowserView(mainWindow, lmArenaView, websites, views, { promptAreaHeight, sidebarWidth });
      void adjustBrowserViewBounds();
    }
  }
});

ipcMain.on("open-claude", (_, prompt: string) => {
  if (prompt === "open claude now") {
    console.log("Opening Claude");
    let url = "https://claude.ai/chats/";
    addBrowserView(mainWindow, url, websites, views, { promptAreaHeight, sidebarWidth });
    void adjustBrowserViewBounds();
  }
});

ipcMain.on("close-claude", (_, prompt: string) => {
  if (prompt === "close claude now") {
    console.log("Closing Claude");
    const claudeView = views.find((view) => view.id.match("claude"));
    if (claudeView) {
      removeBrowserView(mainWindow, claudeView, websites, views, { promptAreaHeight, sidebarWidth });
      void adjustBrowserViewBounds();
    }
  }
});

ipcMain.on("open-grok", (_, prompt: string) => {
  if (prompt === "open grok now") {
    console.log("Opening Grok");
    let url = "https://grok.com/";
    addBrowserView(mainWindow, url, websites, views, { promptAreaHeight, sidebarWidth });
    void adjustBrowserViewBounds();
  }
});

ipcMain.on("close-grok", (_, prompt: string) => {
  if (prompt === "close grok now") {
    console.log("Closing Grok");
    const grokView = views.find((view) => view.id.match("grok"));
    if (grokView) {
      removeBrowserView(mainWindow, grokView, websites, views, { promptAreaHeight, sidebarWidth });
      void adjustBrowserViewBounds();
    }
  }
});

ipcMain.on("open-deepseek", (_, prompt: string) => {
  if (prompt === "open deepseek now") {
    console.log("Opening DeepSeek");
    let url = "https://chat.deepseek.com/";
    addBrowserView(mainWindow, url, websites, views, { promptAreaHeight, sidebarWidth });
    void adjustBrowserViewBounds();
  }
});

ipcMain.on("close-deepseek", (_, prompt: string) => {
  if (prompt === "close deepseek now") {
    console.log("Closing Deepseek");
    const deepseekView = views.find((view) => view.id.match("deepseek"));
    if (deepseekView) {
      removeBrowserView(mainWindow, deepseekView, websites, views, { promptAreaHeight, sidebarWidth });
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
