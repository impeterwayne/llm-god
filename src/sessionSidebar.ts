const ipcRenderer = window.electron.ipcRenderer;

type SessionId = string;

interface SessionMeta {
  id: SessionId;
  title: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  lastMessageSummary?: string;
}

interface SessionsListResponse {
  items: SessionMeta[];
}

function getStoredWidth(): number {
  const raw = localStorage.getItem("sessionsSidebar.width");
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 280;
}

function setStoredWidth(px: number) {
  try {
    localStorage.setItem("sessionsSidebar.width", String(Math.max(180, Math.round(px))));
  } catch {}
}

function setCssSidebarWidth(px: number) {
  try {
    document.documentElement.style.setProperty("--sidebar-width", `${Math.max(0, Math.round(px))}px`);
  } catch {}
}

function getRailWidth(): number {
  try {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue("--sidebar-rail")
      .trim()
      .replace("px", "");
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 40;
  } catch {
    return 40;
  }
}

function measureSidebarWidth(el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  return Math.max(0, Math.round(rect.width));
}

function notifySidebarSize(width: number) {
  ipcRenderer.send("sidebar-size", Math.max(0, Math.round(width)));
}

function syncSidebarSize(el: HTMLElement) {
  if (el.classList.contains("collapsed")) {
    // Use actual measured width of the collapsed rail to avoid DPI rounding drift
    const measured = measureSidebarWidth(el);
    const width = measured > 0 ? measured : getRailWidth();
    notifySidebarSize(width);
    return;
  }
  const width = measureSidebarWidth(el) || getStoredWidth();
  setCssSidebarWidth(width);
  setStoredWidth(width);
  notifySidebarSize(width);
}

function withNoTransition(el: HTMLElement, fn: () => void) {
  el.classList.add("no-transition");
  try { fn(); } finally {
    // remove on next frame to avoid flicker
    requestAnimationFrame(() => el.classList.remove("no-transition"));
  }
}

function toggleSidebar(el: HTMLElement) {
  const goingToCollapsed = !el.classList.contains("collapsed");

  if (goingToCollapsed) {
    // Collapse immediately without CSS width animation
    withNoTransition(el, () => {
      el.classList.add("collapsed");
      document.body.classList.add("sidebar-collapsed");
    });
    try { localStorage.setItem("sessionsSidebar.collapsed", "true"); } catch {}
    // First notify quickly, then re-measure next frame for exact pixels
    syncSidebarSize(el);
    requestAnimationFrame(() => syncSidebarSize(el));
    return;
  }

  // Expand: restore CSS width from storage first, notify immediately, then refine after layout
  withNoTransition(el, () => {
    el.classList.remove("collapsed");
    document.body.classList.remove("sidebar-collapsed");
  });
  try { localStorage.setItem("sessionsSidebar.collapsed", "false"); } catch {}
  const restored = getStoredWidth();
  setCssSidebarWidth(restored);
  notifySidebarSize(restored);
  requestAnimationFrame(() => {
    const width = measureSidebarWidth(el) || restored;
    setCssSidebarWidth(width);
    setStoredWidth(width);
    notifySidebarSize(width);
  });
}

function programmaticCollapseSidebar(el: HTMLElement) {
  if (el.classList.contains("collapsed")) return;
  el.classList.add("collapsed");
  document.body.classList.add("sidebar-collapsed");
  syncSidebarSize(el);
  requestAnimationFrame(() => syncSidebarSize(el));
}

function programmaticExpandSidebar(el: HTMLElement) {
  if (!el.classList.contains("collapsed")) return;
  el.classList.remove("collapsed");
  document.body.classList.remove("sidebar-collapsed");
  const width = getStoredWidth();
  setCssSidebarWidth(width);
  notifySidebarSize(width);
}

function renderSessions(listEl: HTMLElement, sessions: SessionMeta[]) {
  listEl.innerHTML = "";
  sessions.forEach((s) => {
    const item = document.createElement("div");
    item.className = "session-item";
    item.setAttribute("role", "option");
    item.dataset.id = s.id;
    item.textContent = s.title || "Untitled";
    item.addEventListener("click", async () => {
      try {
        await ipcRenderer.invoke("sessions:open", { id: s.id });
      } catch (err) {
        console.error("Failed to open session", err);
      }
    });
    listEl.appendChild(item);
  });
}

async function refreshSessions() {
  const list = document.getElementById("sessions-list");
  if (!list) return;
  try {
    const res = (await ipcRenderer.invoke("sessions:list")) as SessionsListResponse;
    renderSessions(list, Array.isArray(res?.items) ? res.items : []);
  } catch (err) {
    console.error("Failed to load sessions", err);
  }
}

export function initSessionSidebar() {
  const sidebar = document.getElementById("sessions-sidebar");
  const list = document.getElementById("sessions-list");
  const saveBtn = document.getElementById("save-session");
  const toggleBtn = document.getElementById("toggle-sessions");
  if (!sidebar || !list || !saveBtn || !toggleBtn) return;

  // Restore collapsed state
  try {
    const persisted = localStorage.getItem("sessionsSidebar.collapsed");
    const collapsed = persisted === "true";
    if (collapsed) {
      sidebar.classList.add("collapsed");
      document.body.classList.add("sidebar-collapsed");
      toggleBtn.textContent = "»"; // point right to expand
    } else {
      sidebar.classList.remove("collapsed");
      document.body.classList.remove("sidebar-collapsed");
      toggleBtn.textContent = "«"; // point left to collapse
    }
  } catch {}

  // Initial width and size sync
  if (sidebar.classList.contains("collapsed")) {
    // Keep last width in CSS var for next expand, but notify measured rail width
    setCssSidebarWidth(getStoredWidth());
    syncSidebarSize(sidebar);
    requestAnimationFrame(() => syncSidebarSize(sidebar));
  } else {
    setCssSidebarWidth(getStoredWidth());
    requestAnimationFrame(() => {
      const width = measureSidebarWidth(sidebar) || getStoredWidth();
      setCssSidebarWidth(width);
      setStoredWidth(width);
      notifySidebarSize(width);
    });
  }
  void refreshSessions();

  // Events
  toggleBtn.addEventListener("click", () => {
    const wasCollapsed = sidebar.classList.contains("collapsed");
    toggleSidebar(sidebar);
    const nowCollapsed = sidebar.classList.contains("collapsed");
    toggleBtn.textContent = nowCollapsed ? "»" : "«";
  });
  saveBtn.addEventListener("click", async () => {
    try {
      await ipcRenderer.invoke("sessions:create");
      await refreshSessions();
    } catch (err) {
      console.error("Failed to create session", err);
    }
  });

  window.addEventListener("resize", () => syncSidebarSize(sidebar));

  // Keyboard shortcut Ctrl+Shift+S
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "S" || e.key === "s")) {
      e.preventDefault();
      toggleSidebar(sidebar);
    }
  });

  // Listen for store changes
  ipcRenderer.on("sessions:changed", () => void refreshSessions());
  ipcRenderer.on("sessions:active-changed", () => void refreshSessions());

  // Listen for window state changes to adjust sidebar
  ipcRenderer.on("window-state-changed", (event, data) => {
    if (data.state === "fullscreen" || data.state === "maximized") {
      programmaticCollapseSidebar(sidebar);
    } else if (data.state === "restored") {
      programmaticExpandSidebar(sidebar);
    }
  });
}
