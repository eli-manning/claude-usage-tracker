# Claude Tray

Menu bar / system tray app that shows your [Claude Code](https://claude.ai/code) CLI usage at a glance — no browser, no API key, no account required.

## Features

- **Tray icon** — live session % on an orange icon in your menu bar / system tray at all times
- **Click-to-open popup** — session and weekly usage with large percentage readouts and progress bars
- **Color-coded** — icon and bars shift orange → yellow → red at 70% and 90%
- **Reset times** — shows when each limit resets, formatted cleanly (timezone stripped)
- **Usage history** — sparkline chart of your last 40 readings (up to 200 readings stored locally)
- **Session / Weekly toggle** — switch the history chart between the two limits
- **Auto-refresh** — re-runs `claude /usage` every 5 minutes in the background
- **Manual refresh** — ↻ button in the popup header
- **Countdown timer** — shows time until next auto-refresh in the popup footer
- **Dynamic popup width** — popup grows to fit 3-digit percentages (e.g. 100%) without shrinking text
- **Cross-platform** — macOS menu bar, Windows system tray, Linux system tray

## Privacy

Everything runs locally. The app calls `claude /usage` on your machine — no network requests are made beyond what Claude Code itself does. Usage percentages are stored in the popup's `localStorage` for the history chart, and nowhere else. Nothing is sent to any server.

## Requirements

- **[Claude Code](https://docs.anthropic.ai/claude-code)** installed and authenticated:
  ```bash
  npm i -g @anthropic-ai/claude-code
  claude   # log in if prompted
  ```
- **Node.js** v18+ (for running from source)
- **Python 3** — macOS and Linux only (ships with macOS via Xcode Command Line Tools)
- **Windows** — no extra dependencies; `node-pty` is bundled automatically

---

## Run from source

```bash
cd os-menu
npm install
npm start
```

The icon appears in your menu bar / tray immediately. Click it to open the popup.

---

## Build a standalone app

From the `os-menu/` directory:

```bash
npm run build:mac    # macOS   → dist/Claude Tray.dmg
npm run build:win    # Windows → dist/Claude Tray Setup 1.0.0.exe
npm run build:linux  # Linux   → dist/Claude Tray.AppImage
```

### Install and launch — macOS

1. Run `npm run build:mac` — output is `dist/Claude Tray.dmg`
2. Open the `.dmg` and drag **Claude Tray.app** into your **Applications** folder
3. Open **Claude Tray** from Applications (or Spotlight)
4. The icon appears in the menu bar

> **First launch blocked?** macOS may show "cannot be opened because the developer cannot be verified" since the app isn't notarized. Go to **System Settings → Privacy & Security**, scroll down, and click **Open Anyway**.

**Auto-launch on login:**
System Settings → General → Login Items → click **+** → select Claude Tray.app

### Install and launch — Windows

1. Run `npm run build:win` — output is `dist\Claude Tray Setup 1.0.0.exe`
2. Run the installer — it installs for your user account (no admin required) and launches automatically
3. The icon appears in the system tray (notification area, bottom-right)

> If the icon is hidden, click the **^** arrow in the notification area to find it, then drag it to the always-visible section.

**Auto-launch on login:**
The installer sets up auto-launch by default. To toggle it, right-click the tray icon → check the task manager's Startup tab if needed.

### Install and launch — Linux

1. Run `npm run build:linux` — output is `dist/Claude Tray.AppImage`
2. Make it executable and run:
   ```bash
   chmod +x "dist/Claude Tray.AppImage"
   "./dist/Claude Tray.AppImage"
   ```
3. The icon appears in your system tray

**Auto-launch on login:** Add the AppImage path to your desktop environment's startup applications.

---

## How it works

**Windows:** Uses [`node-pty`](https://github.com/microsoft/node-pty) to spawn `claude /usage` inside a Windows ConPTY (Console Pseudoconsole). This gives Claude Code the real console environment it needs — without a ConPTY, Claude treats `/usage` as an unknown slash command rather than its built-in usage display.

**macOS / Linux:** Uses a Python PTY wrapper (`pty-wrapper.py`) bundled with the app to spawn `claude /usage` inside a pseudo-terminal, then streams the ANSI output back to the Electron main process for parsing.

Both paths parse session and weekly percentages out of the terminal output and update the tray icon and popup automatically.

---

## Troubleshooting

**"Could not run claude" / blank tray icon**
`claude` isn't on your PATH. Run `which claude` (macOS/Linux) or `where claude` (Windows) to check. If missing:
```bash
npm i -g @anthropic-ai/claude-code
```

**Stuck on "fetching…" after several seconds**
Open a terminal and run `claude /usage` manually to confirm you're authenticated and it returns output. If it prompts for login, complete that first.

**Stuck on "fetching…" only in the installed app (not `npm start`)**
Claude Code is showing a directory trust prompt for the app's install location. The app handles this automatically — but if it's still happening, run this once in a terminal to pre-trust your home directory:

- **macOS / Linux:** `cd ~ && claude /usage` → press **Enter** at the prompt
- **Windows (cmd):** `cd %USERPROFILE% && claude /usage` → press **Enter**
- **Windows (PowerShell):** `cd $env:USERPROFILE; claude /usage` → press **Enter**

This only needs to be done once. Claude Code permanently remembers the answer.

**Timed out / "Is Claude Code authenticated?"**
Your Claude Code session has expired. Run `claude` in a terminal and log in again.

**Shows 0% when usage is low**
Claude reports anything below ~5% as "Under 5%", which this app maps to 0%. Expected behavior.

**macOS: Python not found**
Make sure `python3` is on your PATH. Install Xcode Command Line Tools if needed:
```bash
xcode-select --install
```

**Debug log**
The app writes a debug log to `~/claude-tray-debug.log`. Check it if something isn't working — it shows exactly what command was run, what output was received, and any parse errors.
