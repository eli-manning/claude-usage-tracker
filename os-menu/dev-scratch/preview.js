// Dev-only: renders popup.html with mocked usageData and screenshots it,
// so UI changes can be checked visually without running the full tray app.
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

const MOCK_DATA = {
  session: 47,
  weekly: 66,
  sessionReset: "9:19pm (America/Los_Angeles)",
  weeklyReset: "Jul 30 at 9:59pm (America/Los_Angeles)",
  weeklyPromo: "+50% weekly limits promo through Aug 19 · clau.de/cc-50-promo",
  credits: { pct: 93, spent: 37.27, total: 40, reset: "Aug 1 (America/Los_Angeles)" },
  skills: [
    { name: "/wiss", pct: 3 },
    { name: "/ui-ux-pro-max", pct: 1 },
  ],
  mcpServers: [{ name: "claude-in-chrome", pct: 1 }],
  stats: {
    favoriteModel: "Sonnet 5",
    totalTokens: "23.8m",
    sessions: 143,
    longestSession: "11d 5h 55m",
    activeDays: 58,
    totalDays: 175,
    longestStreak: "24 days",
    currentStreak: "24 days",
    mostActiveDay: "Jul 10",
    funFact: "You've used ~193x more tokens than 1984",
  },
  lastUpdated: Date.now(),
  error: null,
};

const preloadPath = path.join(__dirname, "preview-preload.js");
fs.writeFileSync(
  preloadPath,
  `
  const { contextBridge, ipcRenderer } = require('electron');
  contextBridge.exposeInMainWorld('claudeAPI', {
    getUsage: () => ipcRenderer.invoke('get-usage'),
    refresh: () => ipcRenderer.invoke('get-usage'),
    closePopup: () => {},
    setWindowSize: (w, h) => ipcRenderer.invoke('set-window-size', w, h),
    onUsageUpdate: (cb) => {},
  });
  `
);

ipcMain.handle("get-usage", () => MOCK_DATA);

let win;
let lastSize = [315, 370];
ipcMain.handle("set-window-size", (_, w, h) => {
  lastSize = [w, h];
  if (win) win.setSize(w, h);
});

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 315,
    height: 370,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
    },
  });
  await win.loadFile(path.join(__dirname, "..", "popup.html"));
  // Let the renderer's initial getUsage()/render/applySize cycle settle,
  // and let the details-open click below settle too.
  await new Promise((r) => setTimeout(r, 400));

  const outDir = path.join(__dirname, "out");
  fs.mkdirSync(outDir, { recursive: true });

  let img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, "popup-collapsed.png"), img.toPNG());

  // Click "Show details"
  await win.webContents.executeJavaScript(`document.getElementById('detailsToggleBtn')?.click()`);
  await new Promise((r) => setTimeout(r, 300));
  img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, "popup-expanded.png"), img.toPNG());

  console.log("wrote screenshots, final size:", lastSize);
  app.quit();
});
