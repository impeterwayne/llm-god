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
  activeId?: SessionId | null;
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

function renderSessions(listEl: HTMLElement, sessions: SessionMeta[], activeId?: SessionId | null) {
  listEl.innerHTML = "";
  sessions.forEach((s) => {
    const item = document.createElement("div");
    item.className = "session-item";
    item.setAttribute("role", "option");
    item.dataset.id = s.id;
    item.textContent = s.title || "Untitled";
    if (s.id && activeId && s.id === activeId) {
      item.classList.add("active");
      item.setAttribute("aria-selected", "true");
    }
    item.addEventListener("click", async () => {
      try {
        await ipcRenderer.invoke("sessions:open", { id: s.id });
      } catch (err) {
        console.error("Failed to open session", err);
      }
    });
    // Right-click context menu for Rename/Delete
    item.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      showSessionContextMenu(ev.clientX, ev.clientY, s);
    });
    listEl.appendChild(item);
  });
}

async function refreshSessions() {
  const list = document.getElementById("sessions-list");
  if (!list) return;
  try {
    const res = (await ipcRenderer.invoke("sessions:list")) as SessionsListResponse;
    const items = Array.isArray(res?.items) ? res.items : [];
    renderSessions(list, items, res?.activeId ?? null);
  } catch (err) {
    console.error("Failed to load sessions", err);
  }
}

export function initSessionSidebar() {
  const sidebar = document.getElementById("sessions-sidebar");
  const list = document.getElementById("sessions-list");
  const newBtn = document.getElementById("new-session");
  const toggleBtn = document.getElementById("toggle-sessions");
  if (!sidebar || !list || !newBtn || !toggleBtn) return;

  // Restore collapsed state
  try {
    const persisted = localStorage.getItem("sessionsSidebar.collapsed");
    const collapsed = persisted === "true" || persisted === null; // default to collapsed if not set
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
  newBtn.addEventListener("click", async () => {
    try {
      // Start a new temporary session with base tabs
      await ipcRenderer.invoke("context:new", { layout: "default" });
      await refreshSessions();
    } catch (err) {
      console.error("Failed to start new context", err);
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
  ipcRenderer.on("sessions:active-changed", (_event, payload: { id: string | null }) => {
    const listEl = document.getElementById("sessions-list");
    if (!listEl) return;
    const items = listEl.querySelectorAll<HTMLElement>(".session-item");
    items.forEach((el) => {
      const isActive = !!payload?.id && el.dataset.id === payload.id;
      el.classList.toggle("active", isActive);
      if (isActive) el.setAttribute("aria-selected", "true");
      else el.removeAttribute("aria-selected");
    });
  });

  // Listen for window state changes to adjust sidebar
  ipcRenderer.on("window-state-changed", (event, data) => {
    if (data.state === "fullscreen" || data.state === "maximized") {
      programmaticCollapseSidebar(sidebar);
    } else if (data.state === "restored") {
      programmaticExpandSidebar(sidebar);
    }
  });
}

// --- Simple in-renderer context menu for session items ---
let sessionMenuEl: HTMLDivElement | null = null;
function ensureSessionMenu(): HTMLDivElement {
  if (sessionMenuEl && document.body.contains(sessionMenuEl)) return sessionMenuEl;
  const menu = document.createElement("div");
  menu.style.position = "fixed";
  menu.style.zIndex = "9999";
  menu.style.minWidth = "160px";
  menu.style.background = "var(--surface-high, #272727)";
  menu.style.border = "1px solid var(--outline, #3d3d3d)";
  menu.style.borderRadius = "8px";
  menu.style.boxShadow = "0 12px 28px rgba(0,0,0,0.45)";
  menu.style.padding = "4px";
  menu.style.display = "none";

  const mkItem = (label: string) => {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.style.display = "block";
    btn.style.width = "100%";
    btn.style.textAlign = "left";
    btn.style.padding = "8px 10px";
    btn.style.border = "none";
    btn.style.background = "transparent";
    btn.style.color = "var(--text-secondary, #c7c7c7)";
    btn.style.borderRadius = "6px";
    btn.style.cursor = "pointer";
    btn.onmouseenter = () => { btn.style.background = "rgba(138,180,248,0.12)"; btn.style.color = "var(--text-primary, #fff)"; };
    btn.onmouseleave = () => { btn.style.background = "transparent"; btn.style.color = "var(--text-secondary, #c7c7c7)"; };
    return btn;
  };

  const renameBtn = mkItem("Rename");
  renameBtn.dataset.action = "rename";
  const deleteBtn = mkItem("Delete");
  deleteBtn.dataset.action = "delete";

  menu.appendChild(renameBtn);
  menu.appendChild(deleteBtn);

  document.body.appendChild(menu);

  // Dismiss on global interactions
  const dismiss = () => hideSessionMenu();
  window.addEventListener("resize", dismiss);
  window.addEventListener("scroll", dismiss, true);
  window.addEventListener("blur", dismiss);
  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target as Node)) hideSessionMenu();
  });
  document.addEventListener("contextmenu", (e) => {
    if (!menu.contains(e.target as Node)) hideSessionMenu();
  });

  sessionMenuEl = menu;
  return menu;
}

function hideSessionMenu() {
  if (sessionMenuEl) sessionMenuEl.style.display = "none";
}

function showSessionContextMenu(x: number, y: number, session: SessionMeta) {
  const menu = ensureSessionMenu();
  // Wire actions per-open so we capture the session id/title
  const [renameBtn, deleteBtn] = Array.from(menu.querySelectorAll("button"));
  if (renameBtn) {
    (renameBtn as HTMLButtonElement).onclick = async () => {
      hideSessionMenu();
      const current = session.title || "Untitled";
      const next = prompt("Rename session to:", current);
      const title = (next ?? "").trim();
      if (!title || title === current) return;
      try {
        await ipcRenderer.invoke("sessions:rename", { id: session.id, title });
        await refreshSessions();
      } catch (err) {
        console.error("Rename failed", err);
      }
    };
  }
  if (deleteBtn) {
    (deleteBtn as HTMLButtonElement).onclick = async () => {
      hideSessionMenu();
      const ok = confirm(`Delete session "${session.title || "Untitled"}"?`);
      if (!ok) return;
      try {
        await ipcRenderer.invoke("sessions:delete", { id: session.id });
        await refreshSessions();
      } catch (err) {
        console.error("Delete failed", err);
      }
    };
  }

  // Position within viewport
  const vw = window.innerWidth, vh = window.innerHeight;
  menu.style.display = "block";
  menu.style.left = "0px";
  menu.style.top = "0px";
  const rect = menu.getBoundingClientRect();
  let mx = x, my = y;
  if (mx + rect.width > vw) mx = Math.max(0, vw - rect.width - 4);
  if (my + rect.height > vh) my = Math.max(0, vh - rect.height - 4);
  menu.style.left = `${mx}px`;
  menu.style.top = `${my}px`;
}
