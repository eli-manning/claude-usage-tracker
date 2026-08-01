const {
  app,
  Tray,
  Menu,
  BrowserWindow,
  ipcMain,
  nativeImage,
  screen,
} = require("electron");
const { spawn, exec } = require("child_process");
const dns = require("dns");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { parseUsageOutput, parseStatsOutput, toCleanLines } = require("./usage-parser.js");
const { ansiToLines, stripBoxChars } = require("./ansi-grid.js");

const LOG_FILE = path.join(os.homedir(), "claude-tray-debug.log");
function log(...args) {
  if (app.isPackaged) return;
  const line = `[${new Date().toISOString()}] ${args.join(" ")}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

let tray = null;
let popupWindow = null;
let wizardWindow = null;
let usageData = {
  session: null,
  weekly: null,
  sessionReset: null,
  weeklyReset: null,
  weeklyPromo: null,
  credits: null,
  skills: null,
  mcpServers: null,
  stats: null,
  error: null,
  errorType: null, // 'offline' | 'auth' | null (unclassified)
  lastAttempt: null,
};
let pollInterval = null;
let isPolling = false;
// Whole-refresh-cycle flag (Claude + every other provider fetch together
// each cycle) — broadcast to the popup so each provider tab's dot can pulse
// while a fetch is in flight, distinct from that dot's resting usage/status color.
let isRefreshing = false;

// ─── Other providers (Antigravity, Codex, Cursor) ────────────────────────────
// Only Antigravity (the `agy` CLI) has a real quota panel we know how to
// drive and parse today — Codex/Cursor are detected (installed or not) but
// otherwise just show a "run this to check" hint, same as the native app's
// provider-picker wedges for those two.
const OTHER_PROVIDERS = [
  { id: "antigravity", binary: "agy", hint: "Run `agy`, then sign in with Google." },
  { id: "codex", binary: "codex", hint: "Run `codex`, then `/status` for usage." },
  { id: "cursor", binary: "cursor-agent", hint: "Run `cursor-agent`, then `/usage` for usage." },
];

// providerStatus[id] = { state: 'notInstalled' | 'installed' | 'loggedIn' | 'error', message }
let providerStatus = {};
let antigravityData = { fiveHourPct: null, weeklyPct: null, fiveHourReset: null, weeklyReset: null, error: null, lastUpdated: null };

function whichBinary(bin) {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    exec(isWin ? `where ${bin}` : `which ${bin}`, (err, stdout) => {
      resolve(!err && !!(stdout || "").trim());
    });
  });
}

// Detection only proves the binary exists — it says nothing about whether
// the user is actually signed in, so `installed` (not `loggedIn`) is the
// most any of these can claim without actually driving the CLI.
async function detectOtherProviders() {
  const result = {};
  for (const p of OTHER_PROVIDERS) {
    const installed = await whichBinary(p.binary);
    result[p.id] = { state: installed ? "installed" : "notInstalled", message: installed ? null : p.hint };
  }
  return result;
}

function findAgyPath() {
  return [
    "/opt/homebrew/bin/agy",
    "/usr/local/bin/agy",
    "/usr/bin/agy",
    path.join(os.homedir(), ".local/bin/agy"),
  ];
}

// The quota panel's bar/percentage is how much is *remaining*, not used —
// e.g. "98.68%" full means almost nothing has been used. Every other
// provider's pct in this app means percent USED, so this inverts it.
function usedPctFromRemaining(remainingStr) {
  const remaining = parseFloat(remainingStr);
  if (Number.isNaN(remaining)) return null;
  return Math.round(100 - remaining);
}

// agy's own duration text is always "<N>h <M>m" (e.g. "157h 4m") — never
// days, and never correctly pluralized. Re-express in days/hours (falling
// back to minutes for anything under an hour), singular/plural picked per unit.
function formatAgyDuration(str) {
  const hMatch = str.match(/(\d+)\s*h/);
  const mMatch = str.match(/(\d+)\s*m/);
  const totalMinutes = (hMatch ? parseInt(hMatch[1], 10) : 0) * 60 + (mMatch ? parseInt(mMatch[1], 10) : 0);
  if (totalMinutes <= 0) return str;

  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const unit = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  const parts = [];
  if (days > 0) parts.push(unit(days, "day"));
  if (hours > 0) parts.push(unit(hours, "hour"));
  if (days === 0 && hours === 0 && minutes > 0) parts.push(unit(minutes, "minute"));
  return parts.join(" ") || str;
}

function parseAgyOutput(raw) {
  const lines = ansiToLines(raw)
    .map((l) => stripBoxChars(l).trim())
    .filter(Boolean);
  const text = lines.join("\n");

  const geminiSectionMatch = text.match(/GEMINI MODELS([\s\S]*?)(?:CLAUDE AND GPT MODELS|$)/);
  if (!geminiSectionMatch) {
    // "not signed in" also flashes during the normal startup handshake
    // (banner shows it, then silently signs in from a cached token), so
    // only trust it once we know the quota panel never showed up at all —
    // if an account email did show, sign-in actually succeeded and the
    // panel parse itself just failed.
    const sawAccount = /[\w.+-]+@[\w-]+\.[\w.-]+/.test(text);
    if (!sawAccount && /currently not signed in/.test(raw)) {
      return { signedIn: false, weeklyPct: null, fiveHourPct: null, error: null };
    }
    return { signedIn: true, weeklyPct: null, fiveHourPct: null, error: "Could not find quota panel." };
  }
  const section = geminiSectionMatch[1];

  // "100% remaining · Refreshes in 157h 4m" — the "Refreshes in …" clause is
  // only present once some quota has actually been consumed; a completely
  // untouched limit just reads "Quota available" with nothing to count down.
  const weeklyMatch = section.match(/Weekly Limit[\s\S]*?([\d.]+)%\s*\n\s*(?:([\d.]+)% remaining(?:\s*·\s*Refreshes in ([^\n]+))?|Quota available)/);
  const fiveHourMatch = section.match(/Five Hour Limit[\s\S]*?([\d.]+)%\s*\n\s*(?:([\d.]+)% remaining(?:\s*·\s*Refreshes in ([^\n]+))?|Quota available)/);

  const weeklyPct = weeklyMatch ? usedPctFromRemaining(weeklyMatch[2] ?? weeklyMatch[1]) : null;
  const fiveHourPct = fiveHourMatch ? usedPctFromRemaining(fiveHourMatch[2] ?? fiveHourMatch[1]) : null;
  const weeklyReset = weeklyMatch?.[3] ? `Refreshes in ${formatAgyDuration(weeklyMatch[3].trim())}` : null;
  const fiveHourReset = fiveHourMatch?.[3] ? `Refreshes in ${formatAgyDuration(fiveHourMatch[3].trim())}` : null;

  return {
    signedIn: true,
    weeklyPct,
    fiveHourPct,
    weeklyReset,
    fiveHourReset,
    error: weeklyPct == null && fiveHourPct == null ? "Could not parse quota." : null,
  };
}

function runAgyCommand(agyPath, augmentedEnv) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ error: "Timed out." }), 60000);
    const ptyWrapper = app.isPackaged
      ? path.join(process.resourcesPath, "agy-pty-wrapper.py")
      : path.join(__dirname, "agy-pty-wrapper.py");
    const child = spawn("python3", [ptyWrapper, agyPath], {
      env: { ...augmentedEnv, TERM: "dumb", FORCE_COLOR: "0" },
    });
    const doneTimeout = setTimeout(() => child.kill(), 58000);
    let accumulated = "";
    child.stdout.on("data", (d) => (accumulated += d.toString()));
    child.on("close", () => {
      clearTimeout(timeout);
      clearTimeout(doneTimeout);
      resolve(parseAgyOutput(accumulated));
    });
    child.on("error", (e) => {
      clearTimeout(timeout);
      resolve({ error: `Process error: ${e.message}` });
    });
  });
}

async function fetchAntigravityUsage() {
  const extraPaths = ["/opt/homebrew/bin", "/usr/local/bin", path.join(os.homedir(), ".local/bin")];
  const augmentedEnv = { ...process.env, PATH: `${extraPaths.join(":")}:${process.env.PATH || ""}` };
  const agyPath = await new Promise((resolve) => {
    exec("which agy", { env: augmentedEnv }, (err, stdout) => {
      const fromWhich = (stdout || "").trim().split("\n")[0];
      resolve(
        fromWhich ||
          findAgyPath().find((p) => {
            try { fs.accessSync(p); return true; } catch { return false; }
          }) ||
          "agy"
      );
    });
  });
  return runAgyCommand(agyPath, augmentedEnv);
}

// Runs after Claude's own fetch, mirroring UsageService.refresh() in the
// native app: detection first (cheap, just `which`), then only actually
// drive Antigravity's PTY if detection found it installed — Codex/Cursor
// have no driver yet, so detection alone is all their status will ever show.
//
// `isAgyPolling` mirrors Claude's own `isPolling` guard — a manual refresh
// click landing while the 5-minute auto-poll (or another manual click) is
// already mid-flight would otherwise spawn a second concurrent `agy`
// process contending over the same CLI session/auth state, which was a
// contributor to the intermittent "Could not find quota panel" failures.
let isAgyPolling = false;
async function refreshOtherProviders() {
  if (isAgyPolling) return;
  isAgyPolling = true;
  try {
    const detected = await detectOtherProviders();
    if (detected.antigravity?.state === "installed") {
      const result = await fetchAntigravityUsage();
      if (result.error) {
        // Same rule applyUsageData() uses for Claude: a transient failure
        // (agy hiccuped, the PTY drive timed out) shouldn't blank the tab back
        // to an error screen if we already have real cached percentages —
        // keep showing them, with the error surfaced alongside as a hint.
        const hasCachedData = antigravityData.fiveHourPct != null || antigravityData.weeklyPct != null;
        detected.antigravity = hasCachedData
          ? { state: "loggedIn", message: result.error }
          : { state: "error", message: result.error };
      } else if (result.signedIn === false) {
        detected.antigravity = { state: "installed", message: null };
      } else {
        antigravityData = {
          fiveHourPct: result.fiveHourPct,
          weeklyPct: result.weeklyPct,
          fiveHourReset: result.fiveHourReset,
          weeklyReset: result.weeklyReset,
          error: null,
          lastUpdated: Date.now(),
        };
        detected.antigravity = { state: "loggedIn", message: null };
      }
    }
    providerStatus = detected;
  } finally {
    isAgyPolling = false;
  }
}

// Checked before spawning `claude` at all — a DNS lookup is faster than
// waiting out a doomed PTY call, and (unlike parsing claude's own error
// text) doesn't depend on guessing what wording a given failure mode prints.
function isOnline() {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 3000);
    dns.lookup("anthropic.com", (err) => {
      clearTimeout(timer);
      resolve(!err);
    });
  });
}

// ─── Run claude commands ─────────────────────────────────────────────────────

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

// Runs `claude <command>` in a PTY and resolves with parseFn(accumulatedOutput).
// Unlike the old single-shot /usage-only version, this doesn't resolve as soon
// as a couple of fields show up — /usage's later sections (skills, MCP
// servers, usage credits) render after session/weekly, so resolving early
// would kill the process before they arrive. Both platforms instead wait for
// the screen to go idle (pty-wrapper.py does this itself on Mac/Linux; the
// Windows ConPTY path below replicates it with an idle timer) and parse once.
// Called when a PTY run produced no parseable session/weekly/stats data at
// all. A logged-out `claude` doesn't jump straight to a "please log in"
// message — it shows the first-run onboarding wizard (theme picker, "Let's
// get started") first, and our idle-based capture gets stuck there (it's an
// interactive menu, nothing advances without a keypress we don't send) well
// before reaching a screen whose text actually contains "login". So the
// wizard screen itself is the signal: legitimately-authenticated sessions
// never see it, since Claude Code only shows onboarding once.
function classifyNoDataError(accumulatedOutput) {
  // Must check the reconstructed (grid-rendered) text, not the raw ANSI —
  // the raw string still has escape codes sitting between letters
  // ("Welcome\x1b[9Gto\x1b[12GClaude..."), so a substring search against it
  // never matches even when the rendered text is perfectly readable.
  // Also strip all punctuation, not just whitespace: the wizard's "Let's
  // get started" keeps its apostrophe after whitespace-only stripping,
  // which alone is enough to break a naive "letsgetstarted" match.
  const clean = toCleanLines(accumulatedOutput).join(" ");
  const normalized = clean.toLowerCase().replace(/[^a-z0-9]/g, "");
  const needsSetup =
    normalized.includes("letsgetstarted") ||
    normalized.includes("welcometoclaudecode") ||
    normalized.includes("choosethetextstyle") ||
    normalized.includes("selectloginmethod");
  const isAuthError =
    needsSetup || /\blogin\b/i.test(clean) || /authenticated/i.test(clean);
  if (isAuthError) {
    return {
      error: 'Not logged in — run "claude" in a terminal to log in.',
      errorType: "auth",
    };
  }
  return { error: "Could not find usage data in output.", errorType: null };
}

function runClaudeCommand(command, parseFn) {
  return new Promise((resolve) => {
    if (isPolling) return resolve(null);
    isPolling = true;

    // Safety timeout - if nothing happens in 20s, fail gracefully
    const timeout = setTimeout(() => {
      isPolling = false;
      resolve({
        error: "Timed out. Is Claude Code authenticated?",
      });
    }, 20000);

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

          const ptyProc = nodePty.spawn(claudeCmd, [command], {
            name: "xterm",
            // Default 30 rows truncates /stats' bottom section; grow it so
            // the TUI renders everything in one frame (mirrors pty-wrapper.py).
            cols: 200,
            rows: 60,
            cwd: os.homedir(),
            env: {
              ...augmentedEnv,
              TERM: "xterm",
              FORCE_COLOR: "0",
              CLAUDE_CODE_DISABLE_ANIMATIONS: "true",
            },
          });

          let accumulatedOutput = "";
          let settled = false;
          let trustAccepted = false;
          const IDLE_QUIET_MS = 900;
          let idleTimer = null;

          const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (idleTimer) clearTimeout(idleTimer);
            isPolling = false;
            const finalParsed = parseFn(accumulatedOutput);
            log("PTY settled, parsed:", JSON.stringify(finalParsed));
            const hasData = Object.values(finalParsed).some((v) => v != null);
            if (hasData) {
              resolve(finalParsed);
            } else {
              resolve(classifyNoDataError(accumulatedOutput));
            }
            try {
              ptyProc.kill();
            } catch (e) {}
          };

          const armIdleTimer = () => {
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = setTimeout(finish, IDLE_QUIET_MS);
          };

          ptyProc.onData((data) => {
            if (settled) return;
            accumulatedOutput += data;
            log("PTY accumulated length:", accumulatedOutput.length);
            // Auto-accept the "trust this directory?" prompt that Claude shows
            // when launched from an unfamiliar working directory.
            // The prompt has ANSI escape codes between words, so check for
            // individual literal words rather than the full phrase.
            if (!trustAccepted && accumulatedOutput.includes("Accessing") && accumulatedOutput.includes("workspace:")) {
              trustAccepted = true;
              ptyProc.write("\r");
            }
            armIdleTimer();
          });
          armIdleTimer();

          ptyProc.onExit(() => {
            log("PTY closed");
            finish();
          });

          return; // Resolution handled by finish() above
        }
        // ── End Windows ConPTY path ───────────────────────────────────────────

        // 2. Mac/Linux: spawn via python3 pty-wrapper.
        // pty-wrapper.py handles its own idle-based completion detection and
        // exits once the screen has settled — we just wait for it to close
        // and parse the final accumulated output. Resolving early on partial
        // content (as the old version did once session+weekly appeared) would
        // kill the process before later sections (skills, MCP servers, usage
        // credits, /stats fields) had a chance to render.
        const ptyWrapper = app.isPackaged
          ? path.join(process.resourcesPath, "pty-wrapper.py")
          : path.join(__dirname, "pty-wrapper.py");

        const child = spawn("python3", [ptyWrapper, claudePath, command], {
          env: {
            ...augmentedEnv,
            TERM: "dumb", // Essential for consistent parsing
            FORCE_COLOR: "0",
            CLAUDE_CODE_DISABLE_ANIMATIONS: "true", // Strips TUI fluff
          },
        });

        const doneTimeout = setTimeout(() => {
          if (child) child.kill();
        }, 18000);

        let accumulatedOutput = "";

        child.stdout.on("data", (data) => {
          accumulatedOutput += data.toString();
          log("Accumulated length:", accumulatedOutput.length);
        });

        child.stderr.on("data", (data) => {
          log("stderr chunk:", data.toString().slice(0, 100));
        });

        child.on("close", (code) => {
          clearTimeout(timeout);
          clearTimeout(doneTimeout);
          isPolling = false;
          const finalParsed = parseFn(accumulatedOutput);
          log("child closed, code:", code);
          log("raw accumulated output:", JSON.stringify(accumulatedOutput.slice(0, 3000)));
          log("parsed result:", JSON.stringify(finalParsed));

          const hasData = Object.values(finalParsed).some((v) => v != null);
          if (hasData) {
            resolve(finalParsed);
          } else {
            resolve(classifyNoDataError(accumulatedOutput));
          }
        });

        child.on("error", (err) => {
          clearTimeout(timeout);
          isPolling = false;
          resolve({
            error: `Process error: ${err.message}`,
          });
        });
      }
    );
  });
}

// Fetches /usage then /stats (sequentially — running two `claude` PTYs at
// once risks both racing the same directory-trust prompt) and merges them
// into one usageData-shaped object. If /usage fails outright, /stats is
// skipped since it's the less critical of the two.
async function fetchUsageAndStats() {
  if (!(await isOnline())) {
    return { error: "You're offline.", errorType: "offline" };
  }

  const usage = await runClaudeCommand("/usage", parseUsageOutput);
  if (!usage) return null; // another poll already in flight

  if (usage.error && usage.session == null && usage.weekly == null) {
    return usage;
  }

  const stats = await runClaudeCommand("/stats", parseStatsOutput);
  return { ...usage, ...(stats || {}), error: usage.error || (stats && stats.error) || null };
}

// ─── Tray icon ───────────────────────────────────────────────────────────────

// Same brand colors as popup.html's PROVIDERS table and dynamic-island-native's
// Provider.swift — kept in sync by hand since none of these share a build step.
const PROVIDER_COLORS = { claude: "#CC785C", antigravity: "#4E8CFF", codex: "#3ECF8E", cursor: "#8B7CF6" };
const PROVIDER_LETTERS = { claude: "C", antigravity: "A", codex: "X", cursor: "U" };
// Which provider's data the tray badge reflects — driven by the popup's own
// switcher via the `set-selected-provider` IPC call, since main.js has no
// other way to know which tab the renderer is currently showing.
let selectedProviderId = "claude";

// Generate the tray-badge icon (provider brand color background, % or a
// fallback letter drawn on top). Uses the popup window's renderer canvas (no
// extra deps needed).
async function generateTrayIcon(pct, color, fallbackLabel) {
  if (
    !popupWindow ||
    popupWindow.isDestroyed() ||
    popupWindow.webContents.isLoading()
  ) {
    return null;
  }
  try {
    // Determine the physical pixel size the icon should fill.
    // On Mac: 28px (14pt @2x Retina) fills the menu bar.
    // On Windows: read the actual tray bounds in logical pixels, then
    //   multiply by scaleFactor to get physical pixels. The slot is
    //   square-constrained by its narrower dimension (width on a bottom taskbar).
    let targetSize = 28;
    if (process.platform === "win32") {
      // Use taskbar height to fill the maximum available tray icon space.
      // getBounds() only returns the current icon slot (often 16px), so instead
      // we derive the height from the taskbar: display.bounds.height - workArea.height.
      const display = tray
        ? screen.getDisplayNearestPoint({ x: tray.getBounds().x, y: tray.getBounds().y })
        : screen.getPrimaryDisplay();
      const scale = display.scaleFactor;
      const taskbarLogicalH = display.bounds.height - display.workArea.height;
      // Leave 4px total padding; minimum 16px logical.
      const logicalSize = Math.max(16, taskbarLogicalH - 4);
      targetSize = Math.round(logicalSize * scale);
    }
    // Draw at 2× target for crisp rendering, then resize down.
    const sz = targetSize * 2;

    const label = JSON.stringify(pct != null ? String(pct) + "%" : (fallbackLabel || "?"));
    const fillColor = JSON.stringify(color || PROVIDER_COLORS.claude);
    const dataURL = await popupWindow.webContents.executeJavaScript(`
      (() => {
        const c = document.createElement('canvas');
        const sz = ${sz};
        c.width = c.height = sz;
        const ctx = c.getContext('2d');
        // Rounded-rect background in the active provider's brand color
        const r = Math.round(sz * 11 / 56);
        ctx.beginPath();
        ctx.moveTo(r, 0); ctx.lineTo(sz-r, 0);
        ctx.arcTo(sz, 0, sz, r, r); ctx.lineTo(sz, sz-r);
        ctx.arcTo(sz, sz, sz-r, sz, r); ctx.lineTo(r, sz);
        ctx.arcTo(0, sz, 0, sz-r, r); ctx.lineTo(0, r);
        ctx.arcTo(0, 0, r, 0, r); ctx.closePath();
        ctx.fillStyle = ${fillColor};
        ctx.fill();
        // White session % number
        const text = ${label};
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const fs = text.length > 2 ? Math.round(sz * 19 / 56) : Math.round(sz * 24 / 56);
        ctx.font = 'bold ' + fs + 'px -apple-system, sans-serif';
        ctx.fillText(text, sz / 2, sz / 2 + 1);
        return c.toDataURL();
      })()
    `);
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

  const color = PROVIDER_COLORS[selectedProviderId] || PROVIDER_COLORS.claude;
  const letter = PROVIDER_LETTERS[selectedProviderId] || "C";

  if (selectedProviderId === "claude") {
    const { session, weekly, error } = usageData;
    const sPct = session != null ? session : null;
    const wPct = weekly != null ? weekly : null;

    // No usable data at all (nothing ever fetched successfully, or auth is
    // broken) — show the hard error state.
    if (error && sPct == null && wPct == null) {
      tray.setImage(nativeImage.createEmpty());
      tray.setTitle(`${letter} !`);
      tray.setToolTip("Claude Tray: " + error);
      return;
    }

    if (sPct == null && wPct == null) {
      tray.setImage(nativeImage.createEmpty());
      tray.setTitle(`${letter} ...`);
      tray.setToolTip("Claude Tray: fetching usage...");
      return;
    }

    // Stale-but-valid: keep showing the last known percentages, just note in
    // the tooltip that the latest refresh failed instead of hiding the icon.
    tray.setToolTip(
      error
        ? `Claude Usage — Session: ${sPct ?? "?"}%  Weekly: ${wPct ?? "?"}% (${error})`
        : `Claude Usage — Session: ${sPct ?? "?"}%  Weekly: ${wPct ?? "?"}%`
    );

    const icon = await generateTrayIcon(sPct, color, letter);
    if (icon) {
      tray.setImage(icon);
      tray.setTitle("");
    } else {
      tray.setImage(nativeImage.createEmpty());
      tray.setTitle(`${sPct ?? "?"}s  ${wPct ?? "?"}w`);
    }
    return;
  }

  if (selectedProviderId === "antigravity" && providerStatus.antigravity?.state === "loggedIn") {
    const { fiveHourPct, weeklyPct } = antigravityData;
    const pct = fiveHourPct ?? weeklyPct;
    tray.setToolTip(`Antigravity Usage — 5hr: ${fiveHourPct ?? "?"}%  Weekly: ${weeklyPct ?? "?"}%`);
    const icon = await generateTrayIcon(pct, color, letter);
    if (icon) {
      tray.setImage(icon);
      tray.setTitle("");
    } else {
      tray.setImage(nativeImage.createEmpty());
      tray.setTitle(`${letter} ${pct ?? "?"}%`);
    }
    return;
  }

  // Antigravity-not-signed-in, Codex, Cursor — no real quota to show yet, just
  // a brand-colored letter badge so the tray still reflects which provider's
  // tab is open in the popup.
  const status = providerStatus[selectedProviderId];
  tray.setToolTip(status?.message ? `${letter}: ${status.message}` : "Claude Tray");
  const icon = await generateTrayIcon(null, color, letter);
  if (icon) {
    tray.setImage(icon);
    tray.setTitle("");
  } else {
    tray.setImage(nativeImage.createEmpty());
    tray.setTitle(`${letter} ...`);
  }
}

// Pushes the latest usageData to whichever windows are alive — the popup
// (only meaningful while visible; it also pulls on show) and the setup
// wizard's "Checking Claude Code" step, which needs to react live since it
// can be open before the very first fetch resolves.
function combinedUsagePayload() {
  return { claude: usageData, antigravity: antigravityData, providers: providerStatus, isRefreshing };
}

function broadcastUsageUpdate() {
  const payload = combinedUsagePayload();
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.webContents.send("usage-update", payload);
  }
  if (wizardWindow && !wizardWindow.isDestroyed()) {
    wizardWindow.webContents.send("usage-update", payload);
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

  popupWindow.loadFile(path.join(__dirname, "popup.html"));

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
  popupWindow.webContents.send("usage-update", combinedUsagePayload());
}

// ─── Setup wizard ────────────────────────────────────────────────────────────
// Shown once on first launch (persisted via a flag file in userData, not
// electron-store — this app has no other need for a dependency like that).
// Re-openable anytime from the tray's right-click menu.

function setupFlagPath() {
  return path.join(app.getPath("userData"), "setup-complete.json");
}

function isSetupComplete() {
  try {
    return JSON.parse(fs.readFileSync(setupFlagPath(), "utf8")).complete === true;
  } catch (e) {
    return false; // missing/corrupt flag file — treat as not-yet-onboarded
  }
}

function markSetupComplete() {
  try {
    fs.writeFileSync(setupFlagPath(), JSON.stringify({ complete: true }));
  } catch (e) {
    log("failed to write setup flag:", e.message);
  }
}

function createWizardWindow() {
  if (wizardWindow && !wizardWindow.isDestroyed()) {
    wizardWindow.focus();
    return;
  }

  wizardWindow = new BrowserWindow({
    width: 400,
    height: 400,
    show: false,
    frame: false,
    resizable: false,
    center: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "wizard-preload.js"),
    },
  });

  wizardWindow.loadFile(path.join(__dirname, "wizard.html"));
  wizardWindow.once("ready-to-show", () => {
    wizardWindow.show();
    wizardWindow.focus();
  });
  wizardWindow.on("closed", () => {
    wizardWindow = null;
  });
}

// ─── IPC handlers ────────────────────────────────────────────────────────────

ipcMain.handle("get-usage", () => combinedUsagePayload());

ipcMain.handle("set-selected-provider", async (_, id) => {
  if (!PROVIDER_COLORS[id]) return;
  selectedProviderId = id;
  await updateTrayTitle();
});

ipcMain.handle("set-window-size", (_, width, height) => {
  if (!popupWindow || popupWindow.isDestroyed()) return;
  const [, oldH] = popupWindow.getSize();
  const [oldX, oldY] = popupWindow.getPosition();
  popupWindow.setSize(width, height);

  if (!tray) return;
  const trayBounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - width / 2);
  x = Math.max(display.bounds.x + 8, Math.min(x, display.bounds.x + display.bounds.width - width - 8));

  // Taskbar-at-bottom layouts anchor the popup above the tray icon — keep its
  // bottom edge fixed as height changes so it grows upward, not off-screen.
  const anchoredAbove =
    process.platform === "win32" || trayBounds.y > display.bounds.height / 2;
  let y = anchoredAbove ? oldY + (oldH - height) : oldY;
  y = Math.max(
    display.bounds.y + 8,
    Math.min(y, display.bounds.y + display.bounds.height - height - 8)
  );

  popupWindow.setPosition(x, y);
});

function applyUsageData(data) {
  if (!data) return;

  // A fetch that returned only an error (offline, not logged in, timed out,
  // etc.) shouldn't blank out the popup — keep whatever was last fetched
  // successfully on screen and just surface the error/staleness alongside it.
  const isFailure = !!data.error && data.session == null && data.weekly == null && data.stats == null;
  if (isFailure) {
    usageData = {
      ...usageData,
      error: data.error,
      errorType: data.errorType || null,
      lastAttempt: Date.now(),
    };
    return;
  }

  usageData = {
    session: null,
    weekly: null,
    sessionReset: null,
    weeklyReset: null,
    weeklyPromo: null,
    credits: null,
    skills: null,
    mcpServers: null,
    stats: null,
    ...data,
    error: null,
    errorType: null,
    lastUpdated: Date.now(),
    lastAttempt: Date.now(),
  };
}

ipcMain.handle("refresh", async () => {
  isRefreshing = true;
  broadcastUsageUpdate();
  const [claudeResult] = await Promise.all([fetchUsageAndStats(), refreshOtherProviders()]);
  applyUsageData(claudeResult);
  isRefreshing = false;
  await updateTrayTitle();
  broadcastUsageUpdate();
  return combinedUsagePayload();
});

ipcMain.handle("close-popup", () => {
  if (popupWindow) popupWindow.hide();
});

ipcMain.handle("wizard-get-login-item", () => app.getLoginItemSettings().openAtLogin);

ipcMain.handle("wizard-set-login-item", (_, enabled) => {
  app.setLoginItemSettings({ openAtLogin: enabled });
});

ipcMain.handle("wizard-finish", () => {
  markSetupComplete();
  if (wizardWindow && !wizardWindow.isDestroyed()) wizardWindow.close();
});

// ─── App lifecycle ───────────────────────────────────────────────────────────

process.on("uncaughtException", (err) => log("UNCAUGHT:", err.stack || String(err)));
process.on("unhandledRejection", (err) => log("UNHANDLED REJECTION:", (err && err.stack) || String(err)));

app.whenReady().then(async () => {
  app.dock?.hide(); // Hide from macOS dock

  // Create tray with empty icon (title will show text)
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setTitle("C …");
  tray.setToolTip("Claude Tray");

  const contextMenu = Menu.buildFromTemplate([
    { label: "Run Setup Wizard…", click: () => createWizardWindow() },
    { type: "separator" },
    { label: "Quit Claude Tray", click: () => app.quit() },
  ]);

  tray.on("click", togglePopup);
  tray.on("right-click", () => tray.popUpContextMenu(contextMenu));

  createPopupWindow();
  if (!isSetupComplete()) createWizardWindow();

  // Wait for the popup page to load so canvas icon generation works
  await new Promise((resolve) => {
    if (!popupWindow.webContents.isLoading()) return resolve();
    popupWindow.webContents.once("did-finish-load", resolve);
  });

  // The real menu-bar icon only appears in a signed, packaged build (see
  // README) — `npm start` runs the raw dev Electron binary, which macOS
  // silently refuses a status-bar slot for. This lets popup/renderer work
  // still iterate at `npm start` speed without needing a full rebuild just
  // to click a tray icon that won't be there.
  if (process.env.DEBUG_SHOW_POPUP) {
    popupWindow.setPosition(40, 40);
    popupWindow.show();
    popupWindow.focus();
  }

  // Initial fetch
  isRefreshing = true;
  broadcastUsageUpdate();
  const [initialClaude] = await Promise.all([fetchUsageAndStats(), refreshOtherProviders()]);
  applyUsageData(initialClaude);
  isRefreshing = false;
  await updateTrayTitle();
  broadcastUsageUpdate(); // wizard's "Checking Claude Code" step may already be open

  // Poll every 5 minutes
  pollInterval = setInterval(async () => {
    isRefreshing = true;
    broadcastUsageUpdate();
    const [claudeResult] = await Promise.all([fetchUsageAndStats(), refreshOtherProviders()]);
    applyUsageData(claudeResult);
    isRefreshing = false;
    await updateTrayTitle();
    broadcastUsageUpdate();
  }, 5 * 60 * 1000);
});

app.on("window-all-closed", (e) => {
  e.preventDefault(); // Keep running when window closed
});

app.on("before-quit", () => {
  if (pollInterval) clearInterval(pollInterval);
});
