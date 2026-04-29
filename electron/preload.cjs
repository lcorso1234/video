/* eslint-disable @typescript-eslint/no-require-imports */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  showOpenDialog: (options) => ipcRenderer.invoke("dialog:openFile", options),
  showSaveDialog: (options) => ipcRenderer.invoke("dialog:saveFile", options),
  getAppVersion: () => ipcRenderer.invoke("app:getVersion"),
  onRenderProgress: (callback) => ipcRenderer.on("render-progress", (_event, value) => callback(value)),
  readFile: (path) => ipcRenderer.invoke("fs:readFile", path),
  writeFile: (path, data) => ipcRenderer.invoke("fs:writeFile", path, data),
});
