import { app, BrowserWindow, ipcMain, WebContentsView, nativeTheme, clipboard, screen, globalShortcut, Menu, nativeImage, } from "electron";
import { exec } from "child_process";
import util from "util";
import * as remote from "@electron/remote/main/index.js";
import path from "path";
import fs from "fs";
import electronLocalShortcut from "electron-localshortcut";
import { addBrowserView, removeBrowserView, injectPromptIntoView, sendPromptInView, simulateFileDropInView, ensureDetachedDevTools, copyAnswerFromView, } from "./utilities.js"; // Adjusted path
import { applyCustomStyles } from "./customStyles.js";
import { createRequire } from "node:module"; // Import createRequire
import { fileURLToPath } from "node:url"; // Import fileURLToPath
import Store from "electron-store"; // Import electron-store
const require = createRequire(import.meta.url);
const store = new Store(); // Create an instance of electron-store (prompts)
const sessionStore = new Store({ name: "sessions" }); // Separate store for sessions
if (require("electron-squirrel-startup"))
    app.quit();
remote.initialize();
let mainWindow;
let formWindow; // Allow formWindow to be null
let sessionsWindow = null;
let linkSessionsToMain = true; // keep sessions window docked to main
let pendingRowSelectedKey = null; // Store the key of the selected row for later use
const views = [];
let promptAreaHeight = 0; // reserved bottom space for chat pane
let reservedRight = 0; // reserved right space when chat pane is docked right (future)
let sidebarWidth = 280; // default reserve for left sidebar; renderer will update
let browserViewsInitialized = false;
let postSendLayoutTimer = null; // delay snapshot after prompt send
let sessionLayoutTimer = null; // debounced saver for session layout
function scheduleSaveActiveLayoutSnapshot(reason, delayMs = 800) {
    try {
        if (sessionLayoutTimer)
            clearTimeout(sessionLayoutTimer);
        sessionLayoutTimer = setTimeout(() => {
            saveActiveLayoutSnapshot(reason);
        }, Math.max(0, delayMs));
    }
    catch { }
}
const HEADER_HEIGHT = 44; // Height for URL bar headers
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// require("electron-reload")(path.join(__dirname, "."));
const websites = [
    "https://chatgpt.com/",
    "https://gemini.google.com/",
    "https://www.perplexity.ai/",
];
async function adjustBrowserViewBounds() {
    if (!mainWindow) {
        return;
    }
    const { width, height } = mainWindow.getContentBounds();
    const availableHeight = Math.max(height - promptAreaHeight, 0);
    const offset = Math.ceil(Math.max(0, sidebarWidth));
    const availableWidth = Math.max(width - offset - Math.max(0, Math.ceil(reservedRight)), 0);
    const viewWidth = websites.length > 0 ? Math.floor(availableWidth / websites.length) : availableWidth;
    views.forEach((view, index) => {
        const x = offset + index * viewWidth;
        const y = HEADER_HEIGHT;
        const h = Math.max(availableHeight - HEADER_HEIGHT, 0);
        view.setBounds({
            x: x,
            y: y,
            width: viewWidth,
            height: h,
        });
    });
    sendViewLayout();
}
function sendViewLayout() {
    if (!mainWindow || mainWindow.isDestroyed())
        return;
    const layout = views.map(v => {
        const b = v.getBounds();
        return {
            id: v.id,
            url: v.webContents.getURL(),
            bounds: b,
            headerBounds: {
                x: b.x,
                y: 0,
                width: b.width,
                height: HEADER_HEIGHT
            }
        };
    });
    mainWindow.webContents.send('view-layout-updated', layout);
}
// Setup context menu for browser views with copy image functionality
function setupViewContextMenu(view) {
    view.webContents.on('context-menu', async (event, params) => {
        const menuItems = [];
        // Add "Copy image to clipboard" if right-clicked on an image
        if (params.mediaType === 'image' && params.srcURL) {
            menuItems.push({
                label: 'Copy image to clipboard',
                click: async () => {
                    try {
                        // Fetch the image and copy to clipboard
                        const response = await fetch(params.srcURL);
                        const buffer = await response.arrayBuffer();
                        const image = nativeImage.createFromBuffer(Buffer.from(buffer));
                        clipboard.writeImage(image);
                    }
                    catch (err) {
                        console.error('Failed to copy image to clipboard:', err);
                    }
                },
            });
            menuItems.push({
                label: 'Copy image URL',
                click: () => {
                    clipboard.writeText(params.srcURL);
                },
            });
            menuItems.push({ type: 'separator' });
        }
        // Add standard text actions if text is selected
        if (params.selectionText) {
            menuItems.push({
                label: 'Copy',
                role: 'copy',
            });
            menuItems.push({ type: 'separator' });
        }
        // Add link actions if right-clicked on a link
        if (params.linkURL) {
            menuItems.push({
                label: 'Copy link address',
                click: () => {
                    clipboard.writeText(params.linkURL);
                },
            });
            menuItems.push({ type: 'separator' });
        }
        // Standard navigation actions
        menuItems.push({
            label: 'Back',
            enabled: view.webContents.canGoBack(),
            click: () => view.webContents.goBack(),
        });
        menuItems.push({
            label: 'Forward',
            enabled: view.webContents.canGoForward(),
            click: () => view.webContents.goForward(),
        });
        menuItems.push({
            label: 'Reload',
            click: () => view.webContents.reload(),
        });
        if (menuItems.length > 0) {
            const menu = Menu.buildFromTemplate(menuItems);
            menu.popup();
        }
    });
}
async function initializeBrowserViews() {
    if (!mainWindow || browserViewsInitialized) {
        await adjustBrowserViewBounds();
        return;
    }
    const { width, height } = mainWindow.getContentBounds();
    const offset = Math.ceil(Math.max(0, sidebarWidth));
    const availableWidth = Math.max(width - offset - Math.max(0, Math.ceil(reservedRight)), 0);
    const viewWidth = websites.length > 0 ? Math.floor(availableWidth / websites.length) : availableWidth;
    const availableHeight = Math.max(height - promptAreaHeight, 0);
    browserViewsInitialized = true;
    websites.forEach((url, index) => {
        const view = new WebContentsView({
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
            },
        }); // Cast to CustomBrowserView
        view.id = `${url}`;
        mainWindow.contentView.addChildView(view);
        view.setBounds({
            x: offset + index * viewWidth,
            y: HEADER_HEIGHT,
            width: viewWidth,
            height: Math.max(availableHeight - HEADER_HEIGHT, 0),
        });
        view.webContents.setZoomFactor(1);
        applyCustomStyles(view.webContents);
        view.webContents.loadURL(url);
        ensureDetachedDevTools(view);
        // Keep last URL persistence updated for the active session
        wireViewUrlPersistence(view);
        // Setup context menu for copy image functionality
        setupViewContextMenu(view);
        views.push(view);
    });
    await adjustBrowserViewBounds();
    updateZoomFactor();
}
function getDefaultSessionState() {
    return {
        activeId: null,
        order: [],
        pinned: [],
        items: {},
        layouts: {},
    };
}
function getSessionState() {
    const state = sessionStore.get("state");
    if (!state)
        return getDefaultSessionState();
    // ensure shape
    return {
        activeId: state.activeId ?? null,
        order: Array.isArray(state.order) ? state.order : [],
        pinned: Array.isArray(state.pinned) ? state.pinned : [],
        items: state.items ?? {},
        layouts: state.layouts ?? {},
    };
}
function setSessionState(next) {
    sessionStore.set("state", next);
}
function ensureDefaultSession() {
    const state = getSessionState();
    const hasAny = Object.keys(state.items).length > 0;
    if (hasAny)
        return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const tabs = getCurrentTabsSnapshot();
    const defaultTitle = `Session ${new Date(now).toLocaleString('sv-SE').slice(0, 16)}`;
    const meta = {
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
function inferProviderFromUrl(url) {
    try {
        const u = new URL(url);
        const host = u.hostname;
        if (/chatgpt\.com|chat\.openai\.com/i.test(host))
            return "chatgpt";
        if (/gemini\.google\.com/i.test(host))
            return "gemini";
        if (/perplexity\.ai/i.test(host))
            return "perplexity";
        if (/claude\.ai/i.test(host))
            return "claude";
        if (/grok\.com/i.test(host))
            return "grok";
        if (/deepseek\.com/i.test(host))
            return "deepseek";
        return host;
    }
    catch {
        return url;
    }
}
const PROVIDER_BASE_URL = {
    chatgpt: "https://chatgpt.com/",
    gemini: "https://gemini.google.com/",
    perplexity: "https://www.perplexity.ai/",
    claude: "https://claude.ai/chats/",
    grok: "https://grok.com/",
    deepseek: "https://chat.deepseek.com/",
};
function getCurrentTabsSnapshot() {
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
// Persist current views to the active session (tabs + last URLs)
function saveActiveLayoutSnapshot(reason) {
    try {
        const state = getSessionState();
        if (!state.activeId)
            return;
        const current = getCurrentTabsSnapshot();
        const layout = state.layouts[state.activeId] ?? { tabs: [] };
        const prevTabs = Array.isArray(layout.tabs) ? layout.tabs : [];
        const prevByProvider = new Map(prevTabs.map((t) => [t.provider, t]));
        // Build next tabs to reflect current membership, but preserve saved URLs for existing providers
        const nextTabs = current.map((t) => {
            const prev = prevByProvider.get(t.provider);
            return {
                provider: t.provider,
                url: prev?.url ?? (PROVIDER_BASE_URL[t.provider] || t.url),
                zoom: prev?.zoom ?? t.zoom,
            };
        });
        // Update lastUrlByProvider based on actual current URLs
        const last = { ...(layout.lastUrlByProvider || {}) };
        for (const t of current) {
            if (t.provider)
                last[t.provider] = t.url;
        }
        state.layouts[state.activeId] = { tabs: nextTabs, lastUrlByProvider: last };
        const meta = state.items[state.activeId];
        if (meta)
            meta.updatedAt = Date.now();
        setSessionState(state);
        mainWindow?.webContents.send("sessions:changed", { reason, updatedIds: [state.activeId] });
    }
    catch (err) {
        console.warn("Failed to save active layout", reason, err);
    }
}
// Attach listeners to keep last URL up-to-date for active session
function wireViewUrlPersistence(view) {
    const update = () => {
        try {
            sendViewLayout(); // Notify renderer of URL change
            const state = getSessionState();
            if (!state.activeId)
                return;
            const url = view.webContents.getURL() || view.id || "";
            const provider = inferProviderFromUrl(url);
            const layout = state.layouts[state.activeId] ?? { tabs: [] };
            const last = { ...(layout.lastUrlByProvider || {}) };
            last[provider] = url;
            state.layouts[state.activeId] = { tabs: layout.tabs ?? [], lastUrlByProvider: last };
            const meta = state.items[state.activeId];
            if (meta)
                meta.updatedAt = Date.now();
            setSessionState(state);
        }
        catch { }
    };
    const wc = view.webContents;
    wc.on("did-navigate", update);
    wc.on("did-navigate-in-page", update);
    wc.on("did-redirect-navigation", update);
    wc.on("page-title-updated", update);
}
function restoreLayout(tabs, lastUrlByProvider) {
    // Close all existing views
    const toRemove = [...views];
    toRemove.forEach((v) => {
        removeBrowserView(mainWindow, v, websites, views, { promptAreaHeight, sidebarWidth });
    });
    // Clear websites list
    websites.splice(0, websites.length);
    // Recreate views based on tabs; prefer last-url snapshot if available
    tabs.forEach((tab) => {
        const last = lastUrlByProvider?.[tab.provider];
        const url = (last && last.length > 0)
            ? last
            : ((tab.url && tab.url.length > 0)
                ? tab.url
                : (PROVIDER_BASE_URL[tab.provider] || tab.url));
        const v = addBrowserView(mainWindow, url, websites, views, { promptAreaHeight, sidebarWidth });
        wireViewUrlPersistence(v);
        setupViewContextMenu(v);
    });
    void adjustBrowserViewBounds();
    // After restore, persist snapshot so state stores last URLs too
    scheduleSaveActiveLayoutSnapshot("restoreLayout", 300);
}
// Restore the last active session (or a reasonable default) when the app starts
function restoreLastActiveSessionAtStartup() {
    try {
        ensureDefaultSession();
        const state = getSessionState();
        let id = state.activeId ?? null;
        if (!id) {
            id = (state.pinned && state.pinned[0]) || (state.order && state.order[0]) || null;
            if (id) {
                state.activeId = id;
                setSessionState(state);
            }
        }
        if (!id)
            return;
        const layout = state.layouts[id];
        if (!layout)
            return;
        // Prevent default initializer from creating extra views
        browserViewsInitialized = true;
        restoreLayout(layout.tabs, layout.lastUrlByProvider);
        // Inform renderer of active selection
        mainWindow.webContents.once("did-finish-load", () => {
            mainWindow.webContents.send("sessions:active-changed", { id });
        });
    }
    catch (err) {
        console.warn("Failed to restore last active session on startup", err);
    }
}
function createWindow() {
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
        mainWindow.webContents.send("window-state-changed", { state: "fullscreen" });
    });
    mainWindow.on("leave-full-screen", () => {
        void adjustBrowserViewBounds();
        updateZoomFactor();
        mainWindow.webContents.send("window-state-changed", { state: "restored" });
    });
    mainWindow.on("maximize", () => {
        void adjustBrowserViewBounds();
        updateZoomFactor();
        mainWindow.webContents.send("window-state-changed", { state: "maximized" });
    });
    mainWindow.on("unmaximize", () => {
        void adjustBrowserViewBounds();
        updateZoomFactor();
        mainWindow.webContents.send("window-state-changed", { state: "restored" });
    });
    mainWindow.on("focus", () => {
        mainWindow.webContents.invalidate();
    });
    let resizeTimeout;
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
function updateZoomFactor() {
    views.forEach((view) => {
        view.webContents.setZoomFactor(1);
    });
}
app.whenReady().then(() => {
    nativeTheme.themeSource = "dark";
    createWindow();
    restoreLastActiveSessionAtStartup();
    electronLocalShortcut.register(mainWindow, "Ctrl+W", () => {
        app.quit();
    });
    globalShortcut.register("CommandOrControl+Q", async () => {
        console.log("Global Control+Q pressed");
        // workaround for windows to copy text from other apps
        const execPromise = util.promisify(exec);
        try {
            if (process.platform === "win32") {
                await execPromise(`powershell.exe -c "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^c')"`);
            }
            else {
                // macOS/Linux usually support cmd+c / ctrl+c standard via robotjs or similar, 
                // but for now we only strictly support the requested Windows flow or fallback to current clipboard
            }
        }
        catch (e) {
            console.error("Failed to simulate copy", e);
        }
        // Wait a bit for clipboard to update
        setTimeout(() => {
            const text = clipboard.readText();
            createNewSession(text, true); // Use default layout (fresh tabs)
            if (mainWindow) {
                if (mainWindow.isMinimized())
                    mainWindow.restore();
                mainWindow.show();
                mainWindow.focus();
                // Send the text to the prompt area
                mainWindow.webContents.send("inject-prompt", text);
                // Inject into all views after a short delay to allow loading
                // 2.5s delay usually enough for base DOM to be ready for injection
                setTimeout(() => {
                    views.forEach((view) => {
                        injectPromptIntoView(view, text);
                    });
                }, 2500);
            }
        }, 150);
    });
});
app.on("window-all-closed", () => {
    if (process.platform !== "darwin")
        app.quit();
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
    if (!sessionsWindow || sessionsWindow.isDestroyed() || !linkSessionsToMain)
        return;
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
        let mx, sx;
        const my = Math.max(area.y, Math.min(m.y, area.y + area.height - mainHeight));
        const sy = my;
        if (dockLeft) {
            sx = area.x;
            mx = area.x + sw;
        }
        else {
            mx = area.x;
            sx = area.x + mainWidth;
        }
        // Apply bounds in order to avoid overlap
        mainWindow.setBounds({ x: mx, y: my, width: mainWidth, height: mainHeight });
        sessionsWindow.setBounds({ x: sx, y: sy, width: sw, height: mainHeight });
    }
    catch (err) {
        console.warn("Failed to layout windows", err);
    }
}
// Sidebar size updates from renderer
ipcMain.on("sidebar-size", (_, width) => {
    const normalized = Math.max(0, Math.round(width || 0));
    if (normalized !== sidebarWidth) {
        sidebarWidth = normalized;
        void adjustBrowserViewBounds();
        // Run a second pass shortly after to handle layout thrash on expand
        setTimeout(() => {
            void adjustBrowserViewBounds();
        }, 80);
    }
});
ipcMain.on("prompt-area-size", (_, height) => {
    const normalizedHeight = Math.max(0, Math.round(height));
    if (normalizedHeight === promptAreaHeight) {
        return;
    }
    promptAreaHeight = normalizedHeight;
    if (browserViewsInitialized) {
        void adjustBrowserViewBounds();
        updateZoomFactor();
    }
    else {
        void initializeBrowserViews();
    }
});
// Unified UI chrome reservation (bottom/right). Renderer may send this
// in addition to or instead of `prompt-area-size`.
ipcMain.on("ui-chrome-size", (_evt, payload) => {
    const bottom = Math.max(0, Math.round(payload?.bottom ?? 0));
    const right = Math.max(0, Math.round(payload?.right ?? 0));
    let changed = false;
    if (bottom !== promptAreaHeight) {
        promptAreaHeight = bottom;
        changed = true;
    }
    if (right !== reservedRight) {
        reservedRight = right;
        changed = true;
    }
    if (changed) {
        if (browserViewsInitialized) {
            void adjustBrowserViewBounds();
            updateZoomFactor();
        }
        else {
            void initializeBrowserViews();
        }
    }
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
ipcMain.handle("get-current-prompt", async () => {
    try {
        const prompt = await mainWindow.webContents.executeJavaScript(`document.getElementById('prompt-input')?.value || ''`);
        return prompt;
    }
    catch {
        return '';
    }
});
ipcMain.on("copy-to-clipboard", (_, text) => {
    clipboard.writeText(text ?? "");
});
// Copy all answers from ChatGPT, Gemini, and Perplexity
ipcMain.handle("copy-all-answers", async () => {
    const tempDir = app.getPath("temp");
    const tempFiles = [];
    // Filter to only ChatGPT, Gemini, and Perplexity views
    const targetViews = views.filter((v) => {
        const id = v.id?.toLowerCase() || "";
        return id.includes("chatgpt") || id.includes("gemini") || id.includes("perplexity");
    });
    for (const view of targetViews) {
        try {
            // Determine provider name
            let provider = "Unknown";
            if (view.id?.match("chatgpt"))
                provider = "ChatGPT";
            else if (view.id?.match("gemini"))
                provider = "Gemini";
            else if (view.id?.match("perplexity"))
                provider = "Perplexity";
            // Clear clipboard before copying
            clipboard.writeText("");
            // Focus the view so clipboard API works (requires document focus)
            view.webContents.focus();
            await new Promise((r) => setTimeout(r, 100));
            // Simulate clicking the copy button - may return text directly or "__COPIED__"
            const result = await copyAnswerFromView(view);
            let copiedText = "";
            if (result && result !== "__COPIED__") {
                // Text was returned directly from page context
                copiedText = result;
            }
            else if (result === "__COPIED__") {
                // Button clicked, need to read from system clipboard
                await new Promise((r) => setTimeout(r, 300));
                copiedText = clipboard.readText();
            }
            if (copiedText && copiedText.trim().length > 0) {
                // Save to temp file
                const tempFilePath = path.join(tempDir, `llm-god-${provider.toLowerCase()}-${Date.now()}.txt`);
                fs.writeFileSync(tempFilePath, copiedText.trim(), "utf8");
                tempFiles.push({ provider, filePath: tempFilePath });
            }
        }
        catch (err) {
            console.error("Failed to copy from view:", view.id, err);
        }
    }
    if (tempFiles.length === 0) {
        return { success: false, message: "No answers found to copy" };
    }
    // Read all temp files and combine
    const results = [];
    for (const { provider, filePath } of tempFiles) {
        try {
            const text = fs.readFileSync(filePath, "utf8");
            results.push({ provider, text });
            // Clean up temp file
            fs.unlinkSync(filePath);
        }
        catch (err) {
            console.error("Failed to read temp file:", filePath, err);
        }
    }
    // Combine all answers with provider labels
    const combined = results
        .map((r) => `=== ${r.provider} ===\n\n${r.text}`)
        .join("\n\n" + "=".repeat(50) + "\n\n");
    clipboard.writeText(combined);
    return { success: true, count: results.length };
});
ipcMain.on("save-prompt", (event, promptValue) => {
    const timestamp = new Date().getTime().toString();
    store.set(timestamp, promptValue);
    console.log("Prompt saved with key:", timestamp);
});
// Add handler to get stored prompts
ipcMain.handle("get-prompts", () => {
    return store.store; // Returns all stored data
});
ipcMain.on("paste-prompt", (_, prompt) => {
    mainWindow.webContents.send("inject-prompt", prompt);
    views.forEach((view) => {
        injectPromptIntoView(view, prompt);
    });
});
ipcMain.on("enter-prompt", (_, prompt) => {
    // Added type for prompt
    views.forEach((view) => {
        injectPromptIntoView(view, prompt);
    });
});
ipcMain.handle("broadcast-file-drop", async (_, files) => {
    if (!Array.isArray(files) || files.length === 0) {
        return;
    }
    await Promise.all(views.map((view) => simulateFileDropInView(view, files).catch((error) => {
        console.error("Failed to deliver dropped files to view", view.id, error);
    })));
});
ipcMain.on('view-navigate', (_evt, { id, url }) => {
    const view = views.find(v => v.id === id);
    if (view) {
        let target = url;
        if (!/^https?:\/\//i.test(target)) {
            target = 'https://' + target;
        }
        view.webContents.loadURL(target);
    }
});
ipcMain.on("send-prompt", async (_evt, prompt) => {
    try {
        let firstPrompt = typeof prompt === "string" ? prompt : "";
        if (!firstPrompt) {
            try {
                firstPrompt = await mainWindow.webContents.executeJavaScript(`document.getElementById('prompt-input')?.value || ''`);
            }
            catch { }
        }
        const state = getSessionState();
        if (!state.activeId) {
            createNewSession(firstPrompt);
        }
    }
    catch (err) {
        console.error("Failed to auto-create session on first message", err);
    }
    views.forEach((view) => {
        sendPromptInView(view);
    });
    // Delay snapshotting the layout so navigations can settle
    try {
        if (postSendLayoutTimer)
            clearTimeout(postSendLayoutTimer);
        postSendLayoutTimer = setTimeout(() => {
            saveActiveLayoutSnapshot("post-send");
        }, 2000);
    }
    catch { }
});
// ----- Sessions IPC -----
ipcMain.handle("sessions:list", () => {
    const state = getSessionState();
    const items = [];
    const pushIf = (id) => {
        const meta = state.items[id];
        if (meta)
            items.push(meta);
    };
    state.pinned.forEach(pushIf);
    state.order.forEach(pushIf);
    return { items, activeId: state.activeId ?? null };
});
function createNewSession(initialTitlePrompt, useDefaultLayout = false) {
    const state = getSessionState();
    const now = Date.now();
    const id = `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
    let tabs;
    if (useDefaultLayout) {
        // Reset to base URLs but keep current providers (Add Button behavior)
        tabs = getCurrentTabsSnapshot().map((t) => ({
            provider: t.provider,
            url: "", // Force usage of PROVIDER_BASE_URL in restoreLayout
            zoom: t.zoom,
        }));
    }
    else {
        tabs = getCurrentTabsSnapshot();
    }
    const clean = (initialTitlePrompt ?? "").trim().replace(/\s+/g, " ");
    const title = clean.length > 0
        ? clean.slice(0, 80)
        : `Session ${new Date(now).toLocaleString('sv-SE').slice(0, 16)}`;
    const meta = {
        id,
        title,
        pinned: false,
        createdAt: now,
        updatedAt: now,
    };
    state.items[id] = meta;
    state.layouts[id] = { tabs };
    // Add new session to the top of the order
    state.order = [
        id,
        ...state.order.filter((x) => x !== id && !state.pinned.includes(x)),
    ];
    state.activeId = id;
    setSessionState(state);
    // If we are creating a fresh session (not snapshot), we need to actually RESTORE that layout now
    // because the current views define the "active" state.
    // If we just set state.activeId but don't restoreLayout, the view remains on old tabs.
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (useDefaultLayout) {
            restoreLayout(tabs);
        }
        mainWindow.webContents.send("sessions:changed", { updatedIds: [id] });
        mainWindow.webContents.send("sessions:active-changed", { id });
    }
    return id;
}
// Start a fresh temporary context (unsaved)
ipcMain.handle("context:new", (_evt, payload) => {
    const mode = payload?.layout === "empty" ? "empty" : "default";
    // For a new context, open provider base URLs rather than current pages
    const tabs = mode === "empty"
        ? []
        : getCurrentTabsSnapshot().map((t) => ({
            provider: t.provider,
            // Force base URL selection during restore by providing empty url
            url: "",
            zoom: 1,
        }));
    const state = getSessionState();
    state.activeId = null;
    setSessionState(state);
    restoreLayout(tabs);
    mainWindow.webContents.send("sessions:active-changed", { id: null });
});
ipcMain.handle("sessions:create", (_evt, { title }) => {
    const state = getSessionState();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const tabs = getCurrentTabsSnapshot();
    const promptTitle = title?.trim();
    const defaultTitle = `Session ${new Date(now).toLocaleString('sv-SE').slice(0, 16)}`;
    const meta = {
        id,
        title: promptTitle || defaultTitle,
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
ipcMain.handle("sessions:get-layout", (_evt, { id }) => {
    const state = getSessionState();
    return state.layouts[id] ?? { tabs: [] };
});
ipcMain.handle("sessions:save-layout", (_evt, { id, tabs }) => {
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
ipcMain.handle("sessions:open", (_evt, { id }) => {
    const state = getSessionState();
    const layout = state.layouts[id];
    if (!layout) {
        throw new Error("No layout saved for session");
    }
    state.activeId = id;
    setSessionState(state);
    restoreLayout(layout.tabs, layout.lastUrlByProvider);
    mainWindow.webContents.send("sessions:active-changed", { id });
});
ipcMain.handle("sessions:rename", (_evt, { id, title }) => {
    const state = getSessionState();
    const meta = state.items[id];
    if (!meta)
        throw new Error("Unknown session id");
    meta.title = (title ?? "").trim() || meta.title;
    meta.updatedAt = Date.now();
    setSessionState(state);
    mainWindow.webContents.send("sessions:changed", { updatedIds: [id] });
});
ipcMain.handle("sessions:delete", (_evt, { id }) => {
    const state = getSessionState();
    delete state.items[id];
    delete state.layouts[id];
    state.order = state.order.filter((x) => x !== id);
    state.pinned = state.pinned.filter((x) => x !== id);
    if (state.activeId === id)
        state.activeId = null;
    setSessionState(state);
    mainWindow.webContents.send("sessions:changed", { updatedIds: [id] });
});
ipcMain.on("delete-prompt-by-value", (event, value) => {
    value = value.normalize("NFKC");
    // Get all key-value pairs from the store
    const allEntries = store.store; // `store.store` gives the entire object
    // Find the key that matches the given value
    const matchingKey = Object.keys(allEntries).find((key) => allEntries[key] === value);
    if (matchingKey) {
        store.delete(matchingKey);
        console.log(`Deleted entry with key: ${matchingKey} and value: ${value}`);
    }
    else {
        console.error(`No matching entry found for value: ${value}`);
    }
});
ipcMain.on("open-claude", (_, prompt) => {
    if (prompt === "open claude now") {
        console.log("Opening Claude");
        const state = getSessionState();
        const layout = state.activeId ? state.layouts[state.activeId] : null;
        const tab = layout?.tabs.find(t => t.provider === "claude");
        const last = layout?.lastUrlByProvider?.["claude"];
        let url = (last && last.length > 0)
            ? last
            : ((tab?.url && tab.url.length > 0) ? tab.url : PROVIDER_BASE_URL["claude"]);
        const v = addBrowserView(mainWindow, url, websites, views, { promptAreaHeight, sidebarWidth });
        wireViewUrlPersistence(v);
        setupViewContextMenu(v);
        void adjustBrowserViewBounds();
        scheduleSaveActiveLayoutSnapshot("open-claude", 800);
    }
});
ipcMain.on("close-claude", (_, prompt) => {
    if (prompt === "close claude now") {
        console.log("Closing Claude");
        const claudeView = views.find((view) => view.id.match("claude"));
        if (claudeView) {
            // Persist latest URL for provider before closing
            try {
                const url = claudeView.webContents.getURL() || claudeView.id;
                const state = getSessionState();
                if (state.activeId) {
                    const layout = state.layouts[state.activeId] ?? { tabs: [] };
                    const last = { ...(layout.lastUrlByProvider || {}) };
                    last["claude"] = url;
                    state.layouts[state.activeId] = { tabs: layout.tabs ?? [], lastUrlByProvider: last };
                    setSessionState(state);
                }
            }
            catch { }
            removeBrowserView(mainWindow, claudeView, websites, views, { promptAreaHeight, sidebarWidth });
            void adjustBrowserViewBounds();
            scheduleSaveActiveLayoutSnapshot("close-claude", 800);
        }
    }
});
ipcMain.on("open-grok", (_, prompt) => {
    if (prompt === "open grok now") {
        console.log("Opening Grok");
        const state = getSessionState();
        const layout = state.activeId ? state.layouts[state.activeId] : null;
        const tab = layout?.tabs.find(t => t.provider === "grok");
        const last = layout?.lastUrlByProvider?.["grok"];
        let url = (last && last.length > 0)
            ? last
            : ((tab?.url && tab.url.length > 0) ? tab.url : PROVIDER_BASE_URL["grok"]);
        const v = addBrowserView(mainWindow, url, websites, views, { promptAreaHeight, sidebarWidth });
        wireViewUrlPersistence(v);
        setupViewContextMenu(v);
        void adjustBrowserViewBounds();
        scheduleSaveActiveLayoutSnapshot("open-grok", 800);
    }
});
ipcMain.on("close-grok", (_, prompt) => {
    if (prompt === "close grok now") {
        console.log("Closing Grok");
        const grokView = views.find((view) => view.id.match("grok"));
        if (grokView) {
            try {
                const url = grokView.webContents.getURL() || grokView.id;
                const state = getSessionState();
                if (state.activeId) {
                    const layout = state.layouts[state.activeId] ?? { tabs: [] };
                    const last = { ...(layout.lastUrlByProvider || {}) };
                    last["grok"] = url;
                    state.layouts[state.activeId] = { tabs: layout.tabs ?? [], lastUrlByProvider: last };
                    setSessionState(state);
                }
            }
            catch { }
            removeBrowserView(mainWindow, grokView, websites, views, { promptAreaHeight, sidebarWidth });
            void adjustBrowserViewBounds();
            scheduleSaveActiveLayoutSnapshot("close-grok", 800);
        }
    }
});
ipcMain.on("open-deepseek", (_, prompt) => {
    if (prompt === "open deepseek now") {
        console.log("Opening DeepSeek");
        const state = getSessionState();
        const layout = state.activeId ? state.layouts[state.activeId] : null;
        const tab = layout?.tabs.find(t => t.provider === "deepseek");
        const last = layout?.lastUrlByProvider?.["deepseek"];
        let url = (last && last.length > 0)
            ? last
            : ((tab?.url && tab.url.length > 0) ? tab.url : PROVIDER_BASE_URL["deepseek"]);
        const v = addBrowserView(mainWindow, url, websites, views, { promptAreaHeight, sidebarWidth });
        wireViewUrlPersistence(v);
        setupViewContextMenu(v);
        void adjustBrowserViewBounds();
        scheduleSaveActiveLayoutSnapshot("open-deepseek", 800);
    }
});
ipcMain.on("close-deepseek", (_, prompt) => {
    if (prompt === "close deepseek now") {
        console.log("Closing Deepseek");
        const deepseekView = views.find((view) => view.id.match("deepseek"));
        if (deepseekView) {
            try {
                const url = deepseekView.webContents.getURL() || deepseekView.id;
                const state = getSessionState();
                if (state.activeId) {
                    const layout = state.layouts[state.activeId] ?? { tabs: [] };
                    const last = { ...(layout.lastUrlByProvider || {}) };
                    last["deepseek"] = url;
                    state.layouts[state.activeId] = { tabs: layout.tabs ?? [], lastUrlByProvider: last };
                    setSessionState(state);
                }
            }
            catch { }
            removeBrowserView(mainWindow, deepseekView, websites, views, { promptAreaHeight, sidebarWidth });
            void adjustBrowserViewBounds();
            scheduleSaveActiveLayoutSnapshot("close-deepseek", 800);
        }
    }
});
ipcMain.on("open-chatgpt", (_, prompt) => {
    if (prompt === "open chatgpt now") {
        console.log("Opening ChatGPT");
        const state = getSessionState();
        const layout = state.activeId ? state.layouts[state.activeId] : null;
        const tab = layout?.tabs.find(t => t.provider === "chatgpt");
        const last = layout?.lastUrlByProvider?.["chatgpt"];
        let url = (last && last.length > 0)
            ? last
            : ((tab?.url && tab.url.length > 0) ? tab.url : PROVIDER_BASE_URL["chatgpt"]);
        const v = addBrowserView(mainWindow, url, websites, views, { promptAreaHeight, sidebarWidth });
        wireViewUrlPersistence(v);
        setupViewContextMenu(v);
        void adjustBrowserViewBounds();
        scheduleSaveActiveLayoutSnapshot("open-chatgpt", 800);
    }
});
ipcMain.on("close-chatgpt", (_, prompt) => {
    if (prompt === "close chatgpt now") {
        console.log("Closing ChatGPT");
        const chatgptView = views.find((view) => view.id.match("chatgpt"));
        if (chatgptView) {
            try {
                const url = chatgptView.webContents.getURL() || chatgptView.id;
                const state = getSessionState();
                if (state.activeId) {
                    const layout = state.layouts[state.activeId] ?? { tabs: [] };
                    const last = { ...(layout.lastUrlByProvider || {}) };
                    last["chatgpt"] = url;
                    state.layouts[state.activeId] = { tabs: layout.tabs ?? [], lastUrlByProvider: last };
                    setSessionState(state);
                }
            }
            catch { }
            removeBrowserView(mainWindow, chatgptView, websites, views, { promptAreaHeight, sidebarWidth });
            void adjustBrowserViewBounds();
            scheduleSaveActiveLayoutSnapshot("close-chatgpt", 800);
        }
    }
});
ipcMain.on("open-gemini", (_, prompt) => {
    if (prompt === "open gemini now") {
        console.log("Opening Gemini");
        const state = getSessionState();
        const layout = state.activeId ? state.layouts[state.activeId] : null;
        const tab = layout?.tabs.find(t => t.provider === "gemini");
        const last = layout?.lastUrlByProvider?.["gemini"];
        let url = (last && last.length > 0)
            ? last
            : ((tab?.url && tab.url.length > 0) ? tab.url : PROVIDER_BASE_URL["gemini"]);
        const v = addBrowserView(mainWindow, url, websites, views, { promptAreaHeight, sidebarWidth });
        wireViewUrlPersistence(v);
        setupViewContextMenu(v);
        void adjustBrowserViewBounds();
        scheduleSaveActiveLayoutSnapshot("open-gemini", 800);
    }
});
ipcMain.on("close-gemini", (_, prompt) => {
    if (prompt === "close gemini now") {
        console.log("Closing Gemini");
        const geminiView = views.find((view) => view.id.match("gemini"));
        if (geminiView) {
            try {
                const url = geminiView.webContents.getURL() || geminiView.id;
                const state = getSessionState();
                if (state.activeId) {
                    const layout = state.layouts[state.activeId] ?? { tabs: [] };
                    const last = { ...(layout.lastUrlByProvider || {}) };
                    last["gemini"] = url;
                    state.layouts[state.activeId] = { tabs: layout.tabs ?? [], lastUrlByProvider: last };
                    setSessionState(state);
                }
            }
            catch { }
            removeBrowserView(mainWindow, geminiView, websites, views, { promptAreaHeight, sidebarWidth });
            void adjustBrowserViewBounds();
            scheduleSaveActiveLayoutSnapshot("close-gemini", 800);
        }
    }
});
ipcMain.on("open-perplexity", (_, prompt) => {
    if (prompt === "open perplexity now") {
        console.log("Opening Perplexity");
        const state = getSessionState();
        const layout = state.activeId ? state.layouts[state.activeId] : null;
        const tab = layout?.tabs.find(t => t.provider === "perplexity");
        const last = layout?.lastUrlByProvider?.["perplexity"];
        let url = (last && last.length > 0)
            ? last
            : ((tab?.url && tab.url.length > 0) ? tab.url : PROVIDER_BASE_URL["perplexity"]);
        const v = addBrowserView(mainWindow, url, websites, views, { promptAreaHeight, sidebarWidth });
        wireViewUrlPersistence(v);
        setupViewContextMenu(v);
        void adjustBrowserViewBounds();
        scheduleSaveActiveLayoutSnapshot("open-perplexity", 800);
    }
});
ipcMain.on("close-perplexity", (_, prompt) => {
    if (prompt === "close perplexity now") {
        console.log("Closing Perplexity");
        const perplexityView = views.find((view) => view.id.match("perplexity"));
        if (perplexityView) {
            try {
                const url = perplexityView.webContents.getURL() || perplexityView.id;
                const state = getSessionState();
                if (state.activeId) {
                    const layout = state.layouts[state.activeId] ?? { tabs: [] };
                    const last = { ...(layout.lastUrlByProvider || {}) };
                    last["perplexity"] = url;
                    state.layouts[state.activeId] = { tabs: layout.tabs ?? [], lastUrlByProvider: last };
                    setSessionState(state);
                }
            }
            catch { }
            removeBrowserView(mainWindow, perplexityView, websites, views, { promptAreaHeight, sidebarWidth });
            void adjustBrowserViewBounds();
            scheduleSaveActiveLayoutSnapshot("close-perplexity", 800);
        }
    }
});
ipcMain.on("open-edit-view", (_, prompt) => {
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
        console.log(`Sent row-selected message to edit_prompt.html with key: ${pendingRowSelectedKey} (on renderer ready)`);
        pendingRowSelectedKey = null;
    }
    else {
        console.log("edit-prompt-ready received, but no pending key to send.");
    }
});
ipcMain.on("update-prompt", (_, { key, value }) => {
    if (store.has(key)) {
        store.set(key, value);
        console.log(`Updated prompt with key "${key}" to: "${value}"`);
    }
    else {
        console.error(`No entry found for key: "${key}"`);
    }
});
ipcMain.on("row-selected", (_, key) => {
    console.log(`Row selected with key: ${key}`);
    pendingRowSelectedKey = key;
});
// Add handler to fetch the key from the store based on the value.
ipcMain.handle("get-key-by-value", (_, value) => {
    value = value.normalize("NFKC"); // Normalize the value for consistency
    const allEntries = store.store; // Get all key-value pairs from the store
    console.log("Store contents:", allEntries); // Log the store contents
    // Find the key that matches the given value
    const matchingKey = Object.keys(allEntries).find((key) => allEntries[key] === value);
    if (matchingKey) {
        console.log(`Found key "${matchingKey}" for value: "${value}"`);
        return matchingKey;
    }
    else {
        console.error(`No matching key found for value: "${value}"`);
        return null;
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
