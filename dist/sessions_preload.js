const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("electron", {
    ipcRenderer: {
        send: (channel, data) => {
            const valid = ["toggle-sessions-window"]; // send-only for window control
            if (valid.includes(channel)) {
                ipcRenderer.send(channel, data);
            }
        },
        invoke: (channel, data) => {
            const valid = [
                "sessions:list",
                "sessions:open",
                "sessions:rename",
                "sessions:delete",
                "sessions:get-layout",
                "sessions:save-layout",
            ];
            if (valid.includes(channel)) {
                return ipcRenderer.invoke(channel, data);
            }
        },
        on: (channel, func) => {
            const valid = ["sessions:changed", "sessions:active-changed"];
            if (valid.includes(channel)) {
                ipcRenderer.on(channel, (_, ...args) => func(...args));
            }
        },
    },
});
export {};
