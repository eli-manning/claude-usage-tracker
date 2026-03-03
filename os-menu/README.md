# Claude Tray

Menu bar / system tray app that shows your Claude Code usage at a glance — no browser required.

## Features

- **Live percentages** — session and weekly usage in the menu bar
- **Color-coded status** — green / yellow / red based on how close you are to limits
- **Auto-refresh** — re-runs `claude /usage` every 5 minutes in the background
- **Usage history** — mini chart in the popup shows trends over your last 30 readings
- **Cross-platform** — works on macOS (menu bar), Windows and Linux (system tray)

## Requirements

- **Node.js** v18+
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

## Auto-launch on login (macOS)

1. Build and move `Claude Tray.app` to `/Applications`
2. System Settings → General → Login Items → add Claude Tray

## How it works

On each refresh the app spawns a `claude` subprocess, sends `/usage` to its stdin, waits for the output, then parses the session and weekly percentages. No network requests, no API keys — it reads from your existing Claude Code session.

## Troubleshooting

**"Could not run claude"** — `claude` isn't on your PATH.
Run `which claude` to check. If missing: `npm i -g @anthropic-ai/claude-code`

**Stuck on "fetching…"** — open a terminal and run `claude` manually to confirm you're authenticated.

**Shows 0% when usage is very low** — Claude reports usage below a threshold as "Under", which this app maps to 0%. That's correct behavior.
