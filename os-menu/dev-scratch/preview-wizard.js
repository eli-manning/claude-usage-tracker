// Dev-only: renders wizard.html with a mocked wizardAPI and screenshots each
// step, so the wizard flow can be checked visually without running the app.
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

const preloadPath = path.join(__dirname, "preview-preload.js");
fs.writeFileSync(
  preloadPath,
  `
  const { contextBridge, ipcRenderer } = require('electron');
  contextBridge.exposeInMainWorld('wizardAPI', {
    platform: '${process.platform}',
    getUsage: () => ipcRenderer.invoke('get-usage'),
    refresh: () => ipcRenderer.invoke('get-usage'),
    onUsageUpdate: () => {},
    getLoginItem: () => Promise.resolve(true),
    setLoginItem: () => Promise.resolve(),
    finish: () => {},
  });
  `
);

let usageState = { session: null, weekly: null, error: null }; // "checking..."
ipcMain.handle("get-usage", () => usageState);

app.whenReady().then(async () => {
  const outDir = path.join(__dirname, "out");
  fs.mkdirSync(outDir, { recursive: true });

  const win = new BrowserWindow({
    width: 400,
    height: 400,
    show: false,
    frame: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: preloadPath },
  });
  await win.loadFile(path.join(__dirname, "..", "wizard.html"));
  await new Promise((r) => setTimeout(r, 300));

  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `wizard-${name}.png`), img.toPNG());
  };

  // Step 0: welcome
  await shot("0-welcome");

  // Step 1: checking (still no data)
  await win.webContents.executeJavaScript(`goto(1)`);
  await new Promise((r) => setTimeout(r, 200));
  await shot("1-checking");

  // Step 1: success
  usageState = { session: 42, weekly: 61, error: null };
  await win.webContents.executeJavaScript(`renderStatus(${JSON.stringify(usageState)})`);
  await new Promise((r) => setTimeout(r, 200));
  await shot("1-success");

  // Step 1: auth failure
  usageState = { session: null, weekly: null, error: "Not logged in", errorType: "auth" };
  await win.webContents.executeJavaScript(`renderStatus(${JSON.stringify(usageState)})`);
  await new Promise((r) => setTimeout(r, 200));
  await shot("1-auth-fail");

  // Step 2: login item toggle
  await win.webContents.executeJavaScript(`goto(2)`);
  await new Promise((r) => setTimeout(r, 200));
  await shot("2-login-item");

  // Step 3: done
  await win.webContents.executeJavaScript(`goto(3)`);
  await new Promise((r) => setTimeout(r, 200));
  await shot("3-done");

  console.log("wrote wizard screenshots");
  app.quit();
});
