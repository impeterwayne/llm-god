const ipcRenderer = window.electron.ipcRenderer;

type SessionId = string;

interface SessionMeta {
  id: SessionId;
  title: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

interface SessionsListResponse { items: SessionMeta[] }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function renderList(container: HTMLElement, items: SessionMeta[]) {
  container.innerHTML = "";
  items.forEach((s) => {
    const row = el("div", "session-item", s.title || "Untitled");
    row.dataset.id = s.id;
    row.title = new Date(s.updatedAt).toLocaleString();
    row.addEventListener("click", async () => {
      try {
        await ipcRenderer.invoke("sessions:open", { id: s.id });
      } catch (err) {
        console.error("open session failed", err);
      }
    });
    // Right-click context menu for Rename/Delete
    row.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      showSessionContextMenu(ev.clientX, ev.clientY, s);
    });
    container.appendChild(row);
  });
}

async function refresh() {
  const list = document.getElementById("sessions-list");
  if (!list) return;
  try {
    const res = (await ipcRenderer.invoke("sessions:list")) as SessionsListResponse;
    renderList(list, res?.items ?? []);
  } catch (err) {
    console.error("load sessions failed", err);
  }
}

function wireUi() {
  // No "Save Current" action anymore. Only list/open existing sessions.

  ipcRenderer.on("sessions:changed", () => { void refresh(); });
  ipcRenderer.on("sessions:active-changed", () => { void refresh(); });

  void refresh();
}

document.addEventListener("DOMContentLoaded", wireUi, { once: true });

export {};

// Minimal context menu implementation for this window
let ctxMenuEl: HTMLDivElement | null = null;
function ensureCtxMenu(): HTMLDivElement {
  if (ctxMenuEl && document.body.contains(ctxMenuEl)) return ctxMenuEl;
  const menu = document.createElement("div");
  menu.style.position = "fixed";
  menu.style.zIndex = "9999";
  menu.style.minWidth = "160px";
  menu.style.background = "#272727";
  menu.style.border = "1px solid #3d3d3d";
  menu.style.borderRadius = "8px";
  menu.style.boxShadow = "0 12px 28px rgba(0,0,0,0.45)";
  menu.style.padding = "4px";
  menu.style.display = "none";
  const mk = (label: string) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.display = "block";
    b.style.width = "100%";
    b.style.textAlign = "left";
    b.style.padding = "8px 10px";
    b.style.border = "none";
    b.style.background = "transparent";
    b.style.color = "#c7c7c7";
    b.style.borderRadius = "6px";
    b.style.cursor = "pointer";
    b.onmouseenter = () => { b.style.background = "rgba(138,180,248,0.12)"; b.style.color = "#fff"; };
    b.onmouseleave = () => { b.style.background = "transparent"; b.style.color = "#c7c7c7"; };
    return b;
  };
  menu.appendChild(mk("Rename"));
  menu.appendChild(mk("Delete"));
  document.body.appendChild(menu);
  const dismiss = () => hideCtxMenu();
  window.addEventListener("resize", dismiss);
  window.addEventListener("scroll", dismiss, true);
  window.addEventListener("blur", dismiss);
  document.addEventListener("click", (e) => { if (!menu.contains(e.target as Node)) hideCtxMenu(); });
  document.addEventListener("contextmenu", (e) => { if (!menu.contains(e.target as Node)) hideCtxMenu(); });
  ctxMenuEl = menu;
  return menu;
}
function hideCtxMenu() { if (ctxMenuEl) ctxMenuEl.style.display = "none"; }
function showSessionContextMenu(x: number, y: number, s: SessionMeta) {
  const menu = ensureCtxMenu();
  const [renameBtn, deleteBtn] = Array.from(menu.querySelectorAll("button"));
  if (renameBtn) {
    (renameBtn as HTMLButtonElement).onclick = async () => {
      hideCtxMenu();
      const current = s.title || "Untitled";
      const next = prompt("Rename session to:", current);
      const title = (next ?? "").trim();
      if (!title || title === current) return;
      try {
        await ipcRenderer.invoke("sessions:rename", { id: s.id, title });
      } finally {
        void refresh();
      }
    };
  }
  if (deleteBtn) {
    (deleteBtn as HTMLButtonElement).onclick = async () => {
      hideCtxMenu();
      const ok = confirm(`Delete session "${s.title || "Untitled"}"?`);
      if (!ok) return;
      try {
        await ipcRenderer.invoke("sessions:delete", { id: s.id });
      } finally {
        void refresh();
      }
    };
  }
  const vw = window.innerWidth, vh = window.innerHeight;
  menu.style.display = "block";
  menu.style.left = "0px";
  menu.style.top = "0px";
  const r = menu.getBoundingClientRect();
  let mx = x, my = y;
  if (mx + r.width > vw) mx = Math.max(0, vw - r.width - 4);
  if (my + r.height > vh) my = Math.max(0, vh - r.height - 4);
  menu.style.left = `${mx}px`;
  menu.style.top = `${my}px`;
}
