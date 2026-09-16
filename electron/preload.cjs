const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("makale", {
  call: (method, args) => ipcRenderer.invoke("makale", method, args),
  onProgress: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on("progress", listener);
    return () => ipcRenderer.removeListener("progress", listener);
  },
});
