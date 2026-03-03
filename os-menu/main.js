const { app, Tray, BrowserWindow, ipcMain, nativeImage, screen } = require('electron');
const { spawn, exec } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const LOG_FILE = path.join(os.homedir(), 'claude-tray-debug.log');
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

let tray = null;
let popupWindow = null;
let usageData = { session: null, weekly: null, sessionReset: null, weeklyReset: null, error: null };
let pollInterval = null;
let isPolling = false;

// ─── Parse /usage output ────────────────────────────────────────────────────

function parseUsageOutput(raw) {
  const result = {
    session: null,
    weekly: null,
    sessionReset: null,
    weeklyReset: null,
  };

  // 1. Heavy cleaning: Remove ANSI/VT100 escape sequences
  const clean = raw
    // Replace cursor-right (e.g. \x1b[1C) with spaces to preserve word boundaries
    // Without this, "Current\x1b[1Csession" becomes "Currentsession" and mode detection fails
    .replace(/\x1b\[(\d*)C/g, (_, n) => ' '.repeat(Math.max(1, parseInt(n) || 1)))
    // Strip all remaining CSI sequences, including DEC private (?-prefixed) like \x1b[?2026h
    .replace(/\x1b\[[\x20-\x3f]*[\x40-\x7e]/g, '')
    // Strip OSC sequences like \x1b]0;title\x07
    .replace(/\x1b\][^\x07\x1b]*[\x07]?/g, '')
    // Strip any leftover two-char ESC sequences
    .replace(/\x1b./g, '')
    // Strip box-drawing and block characters
    .replace(/[─│╭╰╮╯━┃┏┗┓┛█▌▛▜▝▞▟▐▙▚]/g, '')
    .replace(/\r/g, '\n');

  log('cleaned text sample:', JSON.stringify(clean.slice(0, 500)));

  // 2. Split into blocks to avoid session data bleeding into weekly data
  const lines = clean
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let currentBlock = null;

  for (const line of lines) {
    // Identify which section we are in
    if (/current session/i.test(line)) {
      currentBlock = "session";
      continue;
    } else if (/current week/i.test(line)) {
      currentBlock = "weekly";
      continue;
    } else if (/extra usage/i.test(line)) {
      currentBlock = null;
    }

    if (currentBlock === "session") {
      // Look for percentage (e.g., "18%")
      const pctMatch = line.match(/(\d+)%\s*used/i);
      if (pctMatch) result.session = parseInt(pctMatch[1]);

      // Look for reset time
      const resetMatch = line.match(/Resets\s+(.+)/i);
      if (resetMatch) result.sessionReset = "Resets " + resetMatch[1].trim();
    }

    if (currentBlock === "weekly") {
      const pctMatch = line.match(/(\d+)%\s*used/i);
      if (pctMatch) result.weekly = parseInt(pctMatch[1]);

      const resetMatch = line.match(/Resets\s+(.+)/i);
      if (resetMatch) result.weeklyReset = "Resets " + resetMatch[1].trim();
    }
  }

  // Positional fallback: if section-based detection missed anything,
  // treat the 1st "X% used" as session and 2nd as weekly
  if (result.session === null || result.weekly === null) {
    const allMatches = [...clean.matchAll(/(\d+)%\s*used/gi)];
    if (allMatches.length >= 1 && result.session === null)
      result.session = parseInt(allMatches[0][1]);
    if (allMatches.length >= 2 && result.weekly === null)
      result.weekly = parseInt(allMatches[1][1]);
  }

  // "Under X%" / "Under 5%" case
  if (result.session === null && /under\s*\d*%/i.test(clean)) result.session = 0;
  if (result.weekly === null && /under\s*\d*%/i.test(clean)) result.weekly = 0;

  log('parseUsageOutput result:', JSON.stringify(result));
  return result;
}

// ─── Run claude /usage ───────────────────────────────────────────────────────

function findClaudePath() {
  // Common install locations
  const candidates = [
    '/usr/local/bin/claude',
    '/usr/bin/claude',
    path.join(os.homedir(), '.local/bin/claude'),
    path.join(os.homedir(), '.npm-global/bin/claude'),
    '/opt/homebrew/bin/claude',
  ];

  // On Windows
  if (process.platform === 'win32') {
    candidates.push(
      path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'claude.cmd'),
      'claude'
    );
  }

  return candidates;
}

function runClaudeUsage() {
  return new Promise((resolve) => {
    if (isPolling) return resolve(null);
    isPolling = true;

    // Safety timeout - if nothing happens in 15s, fail gracefully
    const timeout = setTimeout(() => {
      isPolling = false;
      resolve({
        session: null,
        weekly: null,
        error: "Timed out. Is Claude Code authenticated?",
      });
    }, 15000);

    const extraPaths = [
      "/opt/homebrew/bin",
      "/usr/local/bin",
      path.join(os.homedir(), ".npm-global/bin"),
      path.join(os.homedir(), ".local/bin"),
    ].join(":");

    const augmentedEnv = {
      ...process.env,
      PATH: `${extraPaths}:${process.env.PATH || ""}`,
    };

    // 1. Resolve the path to Claude
    exec(
      "which claude || where claude",
      { env: augmentedEnv },
      (err, stdout) => {
        const fromWhich = (stdout || "").trim().split("\n")[0];
        const candidates = findClaudePath();
        const claudePath =
          fromWhich ||
          candidates.find((p) => {
            try {
              fs.accessSync(p);
              return true;
            } catch {
              return false;
            }
          }) ||
          "claude";

        log("claudePath resolved:", claudePath);

        const ptyWrapper = path.join(__dirname, "pty-wrapper.py");
        let spawnExe, spawnArgs;

        if (process.platform === "win32") {
          spawnExe = claudePath;
          spawnArgs = ["/usage"]; // Direct argument for Windows
        } else {
          spawnExe = "python3";
          spawnArgs = [ptyWrapper, claudePath];
        }

        // 2. Spawn the PTY wrapper
        const child = spawn(spawnExe, spawnArgs, {
          env: {
            ...augmentedEnv,
            TERM: "dumb", // Essential for consistent parsing
            FORCE_COLOR: "0",
            CLAUDE_CODE_DISABLE_ANIMATIONS: "true", // Strips TUI fluff
          },
          shell: false,
        });

        let output = "";
        let gotUsage = false;

        const doneTimeout = setTimeout(() => {
          if (child) child.kill();
        }, 16000);

        // 3. Process data chunks as they arrive
        child.stdout.on("data", (data) => {
          output += data.toString();

          // Attempt to parse every time we get new data
          const parsed = parseUsageOutput(output);

          // If we found actual numbers, we consider it a success
          if (
            (parsed.session !== null || parsed.weekly !== null) &&
            !gotUsage
          ) {
            gotUsage = true;
            log("Usage data captured successfully via stdout.");
            clearTimeout(timeout);
            clearTimeout(doneTimeout);
            isPolling = false;

            // Resolve immediately for a snappy UI
            resolve(parsed);

            // Clean up the process shortly after
            setTimeout(() => {
              try {
                child.kill();
              } catch (e) {}
            }, 500);
          }
        });

        child.stderr.on("data", (data) => {
          output += data.toString();
          log("stderr chunk:", data.toString().slice(0, 100));
        });

        // 4. Fallback: Parse one last time when the process closes
        child.on("close", (code) => {
          clearTimeout(timeout);
          clearTimeout(doneTimeout);
          isPolling = false;
          log("child closed, code:", code, "gotUsage:", gotUsage);

          if (!gotUsage) {
            const finalParsed = parseUsageOutput(output);
            if (finalParsed.session !== null || finalParsed.weekly !== null) {
              resolve(finalParsed);
            } else {
              // Check if user needs to log in
              const isAuthError =
                output.includes("login") || output.includes("authenticated");
              const errorMsg = isAuthError
                ? 'Please run "claude" in terminal to login.'
                : "Could not find usage numbers in output.";
              resolve({ session: null, weekly: null, error: errorMsg });
            }
          }
        });

        child.on("error", (err) => {
          clearTimeout(timeout);
          isPolling = false;
          resolve({
            session: null,
            weekly: null,
            error: `Process error: ${err.message}`,
          });
        });
      }
    );
  });
}

// ─── Tray icon ───────────────────────────────────────────────────────────────

function makeTrayIcon(pct, type) {
  // Create a small canvas-like icon using nativeImage
  // We'll use a simple template image approach - show text in title on mac
  return nativeImage.createEmpty();
}

function updateTrayTitle() {
  if (!tray) return;

  const { session, weekly, error } = usageData;

  if (error) {
    tray.setTitle('C !');
    tray.setToolTip('Claude Tray: ' + error);
    return;
  }

  if (session == null && weekly == null) {
    tray.setTitle('C ...');
    tray.setToolTip('Claude Tray: fetching usage...');
    return;
  }

  // Show weekly by default in title (most important)
  const wPct = weekly != null ? weekly : '?';
  const sPct = session != null ? session : '?';

  tray.setTitle(`${sPct}s  ${wPct}w`);
  tray.setToolTip(`Claude Usage — Session: ${sPct}%  Weekly: ${wPct}%`);
}

// ─── Popup window ─────────────────────────────────────────────────────────────

function createPopupWindow() {
  popupWindow = new BrowserWindow({
    width: 320,
    height: 370,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  popupWindow.loadFile('popup.html');

  popupWindow.on('blur', () => {
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.hide();
    }
  });

  popupWindow.on('closed', () => {
    popupWindow = null;
  });
}

function togglePopup() {
  if (!popupWindow || popupWindow.isDestroyed()) {
    createPopupWindow();
  }

  if (popupWindow.isVisible()) {
    popupWindow.hide();
    return;
  }

  // Position near tray icon
  const trayBounds = tray.getBounds();
  const windowBounds = popupWindow.getBounds();
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2);
  let y;

  if (process.platform === 'win32' || trayBounds.y > display.bounds.height / 2) {
    // Taskbar at bottom - show above
    y = Math.round(trayBounds.y - windowBounds.height - 8);
  } else {
    // Menu bar at top - show below
    y = Math.round(trayBounds.y + trayBounds.height + 4);
  }

  // Keep within screen bounds
  x = Math.max(display.bounds.x + 8, Math.min(x, display.bounds.x + display.bounds.width - windowBounds.width - 8));

  popupWindow.setPosition(x, y);
  popupWindow.show();
  popupWindow.focus();
  popupWindow.webContents.send('usage-update', usageData);
}

// ─── IPC handlers ────────────────────────────────────────────────────────────

ipcMain.handle('get-usage', () => usageData);

ipcMain.handle('refresh', async () => {
  const data = await runClaudeUsage();
  if (data) {
    usageData = { session: null, weekly: null, ...data, lastUpdated: Date.now() };
    updateTrayTitle();
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.webContents.send('usage-update', usageData);
    }
  }
  return usageData;
});

ipcMain.handle('close-popup', () => {
  if (popupWindow) popupWindow.hide();
});

// ─── App lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  app.dock?.hide(); // Hide from macOS dock

  // Create tray with empty icon (title will show text)
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setTitle('C …');
  tray.setToolTip('Claude Tray');

  tray.on('click', togglePopup);
  tray.on('right-click', togglePopup);

  createPopupWindow();

  // Initial fetch
  const data = await runClaudeUsage();
  if (data) {
    usageData = { session: null, weekly: null, ...data, lastUpdated: Date.now() };
    updateTrayTitle();
  }

  // Poll every 5 minutes
  pollInterval = setInterval(async () => {
    const data = await runClaudeUsage();
    if (data) {
      usageData = { session: null, weekly: null, ...data, lastUpdated: Date.now() };
      updateTrayTitle();
      if (popupWindow && popupWindow.isVisible()) {
        popupWindow.webContents.send('usage-update', usageData);
      }
    }
  }, 5 * 60 * 1000);
});

app.on('window-all-closed', (e) => {
  e.preventDefault(); // Keep running when window closed
});

app.on('before-quit', () => {
  if (pollInterval) clearInterval(pollInterval);
});
