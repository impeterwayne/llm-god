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
  const saveBtn = document.getElementById("save-session");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      try {
        await ipcRenderer.invoke("sessions:create");
        await refresh();
      } catch (err) {
        console.error("create session failed", err);
      }
    });
  }

  ipcRenderer.on("sessions:changed", () => { void refresh(); });
  ipcRenderer.on("sessions:active-changed", () => { void refresh(); });

  void refresh();
}

document.addEventListener("DOMContentLoaded", wireUi, { once: true });

export {};
