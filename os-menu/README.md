# Claude Tray

Menu bar / system tray app that shows your Claude Code CLI usage at a glance — no browser required.

## Features

- **Live percentages** — session and weekly usage displayed in the popup
- **Tray icon** — shows your current session % on an orange icon in the menu bar / system tray at all times
- **Color-coded** — orange → yellow → red as you approach your limits (70% and 90% thresholds)
- **Reset times** — shows when your session and weekly limits reset, with timezone stripped for readability
- **Auto-refresh** — re-runs `claude /usage` every 5 minutes in the background
- **Usage history** — chart in the popup shows trends across your last 40 readings (up to 200 stored)
- **Dynamic popup width** — the popup grows wider to fit 3-digit percentages (e.g. 100%) without shrinking text
- **Cross-platform** — works on macOS (menu bar), Windows and Linux (system tray)

## Requirements

- **Node.js** v18+
- **Python 3** (macOS / Linux only — used to run the PTY wrapper)
- **Claude Code** installed and authenticated:
  ```bash
  npm i -g @anthropic-ai/claude-code
  claude   # log in if prompted
  ```

## Quick start

```bash
cd os-menu
npm install
npm start
```

The icon appears in your menu bar immediately. Click it to open the popup.

## Build a standalone app

```bash
npm run build:mac    # → dist/Claude Tray.dmg
npm run build:win    # → dist/Claude Tray Setup.exe
npm run build:linux  # → dist/Claude Tray.AppImage
```

### One-time setup before first use

When launched from Finder / Start Menu / desktop, the app runs from a system directory that Claude Code considers untrusted. You need to trust it once in a terminal so the app can fetch usage data on every future launch.

**macOS / Linux:**
```bash
cd / && claude /usage
```

**Windows (Command Prompt):**
```cmd
cd %USERPROFILE% && claude /usage
```

**Windows (PowerShell):**
```powershell
cd $env:USERPROFILE && claude /usage
```

Press **Enter** (or Y + Enter) at the "Quick safety check" prompt. Claude Code will remember the answer permanently.

## Auto-launch on login (macOS)

1. Build and move `Claude Tray.app` to `/Applications`
2. System Settings → General → Login Items → add Claude Tray

## How it works

On macOS and Linux, the app uses a Python PTY wrapper (`pty-wrapper.py`) to spawn `claude /usage` inside a pseudo-terminal — this is needed because Claude Code requires a TTY to run. The wrapper streams output back to the Electron main process, which parses the session and weekly percentages out of the ANSI-formatted output.

On Windows, `claude /usage` is called directly since a PTY wrapper isn't needed.

No network requests are made and no API keys are required — everything reads from your existing authenticated Claude Code session.

## Troubleshooting

**"Could not run claude"** — `claude` isn't on your PATH.
Run `which claude` to check. If missing: `npm i -g @anthropic-ai/claude-code`

**Stuck on "fetching…"** — open a terminal and run `claude /usage` manually to confirm you're authenticated and it returns output.

**Stuck on "fetching…" only in the installed app (not `npm start`)** — Claude Code is showing a directory trust prompt. Run the one-time setup command for your platform (see above under "Build a standalone app") and press Enter at the prompt. This only needs to be done once.

**macOS: permission error on first launch** — macOS may block the app since it isn't notarized. Go to System Settings → Privacy & Security → scroll down and click "Open Anyway".

**Shows 0% when usage is very low** — Claude reports usage below the minimum threshold as "Under 5%", which this app maps to 0%. That's expected.

**Python not found** — make sure `python3` is on your PATH. On macOS it ships with Xcode Command Line Tools: `xcode-select --install`
