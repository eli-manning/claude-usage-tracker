const {
  app,
  Tray,
  BrowserWindow,
  ipcMain,
  nativeImage,
  screen,
} = require("electron");
const { spawn, exec } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");

const LOG_FILE = path.join(os.homedir(), "claude-tray-debug.log");
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(" ")}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

let tray = null;
let popupWindow = null;
let usageData = {
  session: null,
  weekly: null,
  sessionReset: null,
  weeklyReset: null,
  error: null,
};
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

  // On Windows (ConPTY), the TUI positions each row with \x1b[N;MH instead of \r\n.
  // Insert a newline before each absolute cursor-position sequence so the
  // line-based parser below can find session and weekly values on separate lines.
  raw = raw.replace(/\x1b\[\d+;\d*[Hf]/g, "\n");

  // Repair mid-word cursor moves that corrupt words.
  // \x1b[1C (cursor forward) splits words like "Resets" → "Rese s"; strip it.
  // \x1b[Na (cursor up) ends in 'a', which the general ANSI strip eats, turning "9am" → "9m"; preserve the 'a'.
  let clean = raw
    .replace(/\x1b\[1C/g, "")
    .replace(/\x1b\[[0-9;?]*a/g, "a");

  // Strip remaining ANSI fluff
  clean = clean
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/[─│╭╰╮╯━┃┏┗┓┛█▌▛▜▝▞▟▐▙▚]/g, "")
    .replace(/\r/g, "\n");

  const lines = clean
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const pcts = [];
  const resetLines = [];

  lines.forEach((line, index) => {
    const pctMatch = line.match(/(\d+)%\s*used/i);
    if (pctMatch) pcts.push({ val: parseInt(pctMatch[1]), idx: index });

    // Look for "Resets" or time markers like "pm"
    if (/rese[st]s?|am|pm/i.test(line)) {
      resetLines.push({ text: line, idx: index });
    }
  });

  // Assign the first percentage to the first reset line found after it
  if (pcts.length >= 1) {
    result.session = pcts[0].val;
    const sR = resetLines.find((r) => r.idx > pcts[0].idx);
    if (sR) result.sessionReset = sR.text.replace(/^rese[st]s?\s*/i, "").trim();
  }

  // Assign the second percentage to the reset line after that
  if (pcts.length >= 2) {
    result.weekly = pcts[1].val;
    const wR = resetLines.find((r) => r.idx > pcts[1].idx);
    if (wR) result.weeklyReset = wR.text.replace(/^rese[st]s?\s*/i, "").trim();
  }

  return result;
}

// ─── Run claude /usage ───────────────────────────────────────────────────────

function findClaudePath() {
  // Common install locations
  const candidates = [
    "/usr/local/bin/claude",
    "/usr/bin/claude",
    path.join(os.homedir(), ".local/bin/claude"),
    path.join(os.homedir(), ".npm-global/bin/claude"),
    "/opt/homebrew/bin/claude",
  ];

  // On Windows
  if (process.platform === "win32") {
    candidates.push(
      path.join(os.homedir(), "AppData", "Roaming", "npm", "claude.cmd"),
      "claude"
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

    const isWin = process.platform === "win32";
    const pathSep = isWin ? ";" : ":";
    const extraPaths = isWin
      ? [
          path.join(os.homedir(), "AppData", "Roaming", "npm"),
        ]
      : [
          "/opt/homebrew/bin",
          "/usr/local/bin",
          path.join(os.homedir(), ".npm-global/bin"),
          path.join(os.homedir(), ".local/bin"),
        ];

    const augmentedEnv = {
      ...process.env,
      PATH: `${extraPaths.join(pathSep)}${pathSep}${process.env.PATH || ""}`,
    };

    // 1. Resolve the path to Claude
    const whichCmd = isWin ? "where claude" : "which claude";
    exec(
      whichCmd,
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

        // ── Windows: use node-pty (ConPTY) ───────────────────────────────────
        if (isWin) {
          // node-pty gives Claude a real Windows console (ConPTY) so the TUI
          // starts up and /usage is processed as a built-in command instead of
          // being treated as an unknown skill.
          let nodePty;
          try {
            nodePty = require("node-pty");
          } catch (e) {
            log("node-pty load failed:", e.message);
            clearTimeout(timeout);
            isPolling = false;
            return resolve({
              session: null,
              weekly: null,
              error: "node-pty unavailable. Run: npm install",
            });
          }

          // where claude returns the POSIX shell-script variant first on Windows;
          // node-pty needs the .cmd batch file to actually launch claude.
          // Also strip any trailing \r that exec() may leave on Windows line endings.
          const cleanPath = claudePath.replace(/[\r\n]+$/, "");
          const claudeCmd =
            !cleanPath.toLowerCase().endsWith(".cmd") &&
            !cleanPath.toLowerCase().endsWith(".exe") &&
            fs.existsSync(cleanPath + ".cmd")
              ? cleanPath + ".cmd"
              : cleanPath;

          log("Windows ConPTY spawning:", claudeCmd);

          const ptyProc = nodePty.spawn(claudeCmd, ["/usage"], {
            name: "xterm",
            cols: 120,
            rows: 30,
            env: {
              ...augmentedEnv,
              TERM: "xterm",
              FORCE_COLOR: "0",
              CLAUDE_CODE_DISABLE_ANIMATIONS: "true",
            },
          });

          let accumulatedOutput = "";
          let gotUsage = false;
          const doneTimeout = setTimeout(() => {
            try { ptyProc.kill(); } catch (e) {}
          }, 16000);

          ptyProc.onData((data) => {
            accumulatedOutput += data;
            log("PTY accumulated length:", accumulatedOutput.length);
            const parsed = parseUsageOutput(accumulatedOutput);
            if (parsed.session !== null && parsed.weekly !== null && !gotUsage) {
              gotUsage = true;
              log("PTY: full usage data captured");
              clearTimeout(timeout);
              clearTimeout(doneTimeout);
              isPolling = false;
              resolve(parsed);
              setTimeout(() => { try { ptyProc.kill(); } catch (e) {} }, 200);
            }
          });

          ptyProc.onExit(() => {
            clearTimeout(timeout);
            clearTimeout(doneTimeout);
            isPolling = false;
            log("PTY closed, gotUsage:", gotUsage);
            log("PTY raw output:", JSON.stringify(accumulatedOutput.slice(0, 3000)));
            log("PTY parsed:", JSON.stringify(parseUsageOutput(accumulatedOutput)));
            if (!gotUsage) {
              const finalParsed = parseUsageOutput(accumulatedOutput);
              if (finalParsed.session !== null || finalParsed.weekly !== null) {
                resolve(finalParsed);
              } else {
                const isAuthError =
                  accumulatedOutput.includes("login") ||
                  accumulatedOutput.includes("authenticated");
                resolve({
                  session: null,
                  weekly: null,
                  error: isAuthError
                    ? 'Please run "claude" in terminal to login.'
                    : "Could not find usage numbers in output.",
                });
              }
            }
          });

          return; // Resolution handled by pty callbacks above
        }
        // ── End Windows ConPTY path ───────────────────────────────────────────

        // 2. Mac/Linux: spawn via python3 pty-wrapper
        const ptyWrapper = app.isPackaged
          ? path.join(process.resourcesPath, "pty-wrapper.py")
          : path.join(__dirname, "pty-wrapper.py");

        const child = spawn("python3", [ptyWrapper, claudePath], {
          env: {
            ...augmentedEnv,
            TERM: "dumb", // Essential for consistent parsing
            FORCE_COLOR: "0",
            CLAUDE_CODE_DISABLE_ANIMATIONS: "true", // Strips TUI fluff
          },
        });

        let output = "";
        let gotUsage = false;

        const doneTimeout = setTimeout(() => {
          if (child) child.kill();
        }, 16000);

        let accumulatedOutput = ""; // This must persist across "data" events

        child.stdout.on("data", (data) => {
          accumulatedOutput += data.toString();
          log("Accumulated length:", accumulatedOutput.length);

          const parsed = parseUsageOutput(accumulatedOutput);

          // Robust check: Only resolve early if we have BOTH session AND weekly data
          // Otherwise, let the 'close' event handle the final fallback
          if (parsed.session !== null && parsed.weekly !== null && !gotUsage) {
            gotUsage = true;
            log("Full usage data (Session + Weekly) captured.");

            clearTimeout(timeout);
            clearTimeout(doneTimeout);
            isPolling = false;
            resolve(parsed);

            setTimeout(() => {
              try {
                child.kill();
              } catch (e) {}
            }, 200);
          }
        });

        child.stderr.on("data", (data) => {
          output += data.toString();
          log("stderr chunk:", data.toString().slice(0, 100));
        });

        // 3. Fallback: Parse one last time when the process closes
        child.on("close", (code) => {
          clearTimeout(timeout);
          clearTimeout(doneTimeout);
          isPolling = false;
          log("child closed, code:", code, "gotUsage:", gotUsage);
          log("raw accumulated output:", JSON.stringify(accumulatedOutput.slice(0, 3000)));
          log("parsed result:", JSON.stringify(parseUsageOutput(accumulatedOutput)));

          if (!gotUsage) {
            const finalParsed = parseUsageOutput(accumulatedOutput);
            if (finalParsed.session !== null || finalParsed.weekly !== null) {
              resolve(finalParsed);
            } else {
              // Check if user needs to log in
              const isAuthError =
                accumulatedOutput.includes("login") || accumulatedOutput.includes("authenticated");
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

// Generate the orange Claude-style icon with the session % drawn on it.
// Uses the popup window's renderer canvas (no extra deps needed).
async function generateTrayIcon(pct) {
  if (
    !popupWindow ||
    popupWindow.isDestroyed() ||
    popupWindow.webContents.isLoading()
  ) {
    return null;
  }
  try {
    const label = JSON.stringify(pct != null ? String(pct) + "%" : "?");
    const dataURL = await popupWindow.webContents.executeJavaScript(`
      (() => {
        const c = document.createElement('canvas');
        c.width = c.height = 56;
        const ctx = c.getContext('2d');
        // Orange rounded-rect background (Claude brand color)
        const r = 11;
        ctx.beginPath();
        ctx.moveTo(r, 0); ctx.lineTo(56-r, 0);
        ctx.arcTo(56, 0, 56, r, r); ctx.lineTo(56, 56-r);
        ctx.arcTo(56, 56, 56-r, 56, r); ctx.lineTo(r, 56);
        ctx.arcTo(0, 56, 0, 56-r, r); ctx.lineTo(0, r);
        ctx.arcTo(0, 0, r, 0, r); ctx.closePath();
        ctx.fillStyle = '#CC785C';
        ctx.fill();
        // White session % number
        const text = ${label};
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold ' + (text.length > 2 ? '19' : '24') + 'px -apple-system, sans-serif';
        ctx.fillText(text, 28, 29);
        return c.toDataURL();
      })()
    `);
    // On Windows the notification-area slot is 16 logical px; multiply by
    // scaleFactor to get the physical pixel size that fills it exactly.
    // On Mac, 28px (14pt @2x Retina) matches the menu bar height.
    const targetSize =
      process.platform === "win32"
        ? Math.round(16 * screen.getPrimaryDisplay().scaleFactor)
        : 28;
    return nativeImage
      .createFromDataURL(dataURL)
      .resize({ width: targetSize, height: targetSize });
  } catch (e) {
    log("icon gen failed:", e.message);
    return null;
  }
}

async function updateTrayTitle() {
  if (!tray) return;

  const { session, weekly, error } = usageData;
  const sPct = session != null ? session : null;
  const wPct = weekly != null ? weekly : null;

  if (error) {
    tray.setImage(nativeImage.createEmpty());
    tray.setTitle("C !");
    tray.setToolTip("Claude Tray: " + error);
    return;
  }

  if (sPct == null && wPct == null) {
    tray.setImage(nativeImage.createEmpty());
    tray.setTitle("C ...");
    tray.setToolTip("Claude Tray: fetching usage...");
    return;
  }

  tray.setToolTip(
    `Claude Usage — Session: ${sPct ?? "?"}%  Weekly: ${wPct ?? "?"}%`
  );

  const icon = await generateTrayIcon(sPct);
  if (icon) {
    tray.setImage(icon);
    tray.setTitle("");
  } else {
    tray.setImage(nativeImage.createEmpty());
    tray.setTitle(`${sPct ?? "?"}s  ${wPct ?? "?"}w`);
  }
}

// ─── Popup window ─────────────────────────────────────────────────────────────

function createPopupWindow() {
  popupWindow = new BrowserWindow({
    width: 315,
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
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Keep popup on the active Space so clicking the tray icon never switches desktops
  popupWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  popupWindow.setAlwaysOnTop(true, "floating");

  popupWindow.loadFile("popup.html");

  popupWindow.on("blur", () => {
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.hide();
    }
  });

  popupWindow.on("closed", () => {
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
  const display = screen.getDisplayNearestPoint({
    x: trayBounds.x,
    y: trayBounds.y,
  });

  let x = Math.round(
    trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2
  );
  let y;

  if (
    process.platform === "win32" ||
    trayBounds.y > display.bounds.height / 2
  ) {
    // Taskbar at bottom - show above
    y = Math.round(trayBounds.y - windowBounds.height - 8);
  } else {
    // Menu bar at top - show below
    y = Math.round(trayBounds.y + trayBounds.height + 4);
  }

  // Keep within screen bounds
  x = Math.max(
    display.bounds.x + 8,
    Math.min(
      x,
      display.bounds.x + display.bounds.width - windowBounds.width - 8
    )
  );

  popupWindow.setPosition(x, y);
  popupWindow.show();
  popupWindow.focus();
  popupWindow.webContents.send("usage-update", usageData);
}

// ─── IPC handlers ────────────────────────────────────────────────────────────

ipcMain.handle("get-usage", () => usageData);

ipcMain.handle("set-window-width", (_, width) => {
  if (!popupWindow || popupWindow.isDestroyed()) return;
  const [, height] = popupWindow.getSize();
  popupWindow.setSize(width, height);
  // Recenter over tray icon after resize
  if (tray) {
    const trayBounds = tray.getBounds();
    const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
    let x = Math.round(trayBounds.x + trayBounds.width / 2 - width / 2);
    x = Math.max(display.bounds.x + 8, Math.min(x, display.bounds.x + display.bounds.width - width - 8));
    popupWindow.setPosition(x, popupWindow.getPosition()[1]);
  }
});

ipcMain.handle("refresh", async () => {
  const data = await runClaudeUsage();
  if (data) {
    usageData = {
      session: null,
      weekly: null,
      ...data,
      lastUpdated: Date.now(),
    };
    await updateTrayTitle();
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.webContents.send("usage-update", usageData);
    }
  }
  return usageData;
});

ipcMain.handle("close-popup", () => {
  if (popupWindow) popupWindow.hide();
});

// ─── App lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  app.dock?.hide(); // Hide from macOS dock

  // Create tray with empty icon (title will show text)
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setTitle("C …");
  tray.setToolTip("Claude Tray");

  tray.on("click", togglePopup);
  tray.on("right-click", togglePopup);

  createPopupWindow();

  // Wait for the popup page to load so canvas icon generation works
  await new Promise((resolve) => {
    if (!popupWindow.webContents.isLoading()) return resolve();
    popupWindow.webContents.once("did-finish-load", resolve);
  });

  // Initial fetch
  const data = await runClaudeUsage();
  if (data) {
    usageData = {
      session: null,
      weekly: null,
      ...data,
      lastUpdated: Date.now(),
    };
    await updateTrayTitle();
  }

  // Poll every 5 minutes
  pollInterval = setInterval(async () => {
    const data = await runClaudeUsage();
    if (data) {
      usageData = {
        session: null,
        weekly: null,
        ...data,
        lastUpdated: Date.now(),
      };
      await updateTrayTitle();
      if (popupWindow && popupWindow.isVisible()) {
        popupWindow.webContents.send("usage-update", usageData);
      }
    }
  }, 5 * 60 * 1000);
});

app.on("window-all-closed", (e) => {
  e.preventDefault(); // Keep running when window closed
});

app.on("before-quit", () => {
  if (pollInterval) clearInterval(pollInterval);
});
