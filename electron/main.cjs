/* eslint-disable @typescript-eslint/no-require-imports */

const path = require("node:path");
const fs = require("node:fs/promises");
const { app, BrowserWindow, shell, ipcMain, dialog } = require("electron");

const appUrl = process.env.ELECTRON_START_URL || "http://localhost:3006";
const isDev = !app.isPackaged;

function createWindow() {
  const window = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    titleBarStyle: "hiddenInset", // Better on macOS
    trafficLightPosition: { x: 20, y: 20 },
    autoHideMenuBar: true,
    backgroundColor: "#111820",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  void window.loadURL(appUrl);

  if (isDev) {
    window.webContents.openDevTools({ mode: "detach" });
  }

  return window;
}

app.whenReady().then(() => {
  const mainWindow = createWindow();

  // IPC Handlers
  ipcMain.handle("dialog:openFile", async (event, options) => {
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result;
  });

  ipcMain.handle("app:getVersion", () => {
    return app.getVersion();
  });

  ipcMain.handle("fs:readFile", async (event, filePath) => {
    const buffer = await fs.readFile(filePath);
    return buffer;
  });

  ipcMain.handle("fs:writeFile", async (event, filePath, data) => {
    await fs.writeFile(filePath, Buffer.from(data));
    return true;
  });

  ipcMain.handle("dialog:saveFile", async (event, options) => {
    const result = await dialog.showSaveDialog(mainWindow, options);
    return result;
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
