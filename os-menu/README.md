# Claude Tray

Menu bar / system tray app that shows your [Claude Code](https://claude.ai/code) usage at a glance — no browser, no API key required.

## Download

| Platform | Link |
|----------|------|
| macOS (Apple Silicon) | [Claude Tray.dmg](https://github.com/eli-manning/claude-usage-tracker/releases/latest/download/Claude.Tray-1.0.0-arm64.dmg) |
| Windows | [Claude Tray Setup.exe](https://github.com/eli-manning/claude-usage-tracker/releases/latest/download/Claude.Tray.Setup.1.0.0.exe) |

**Requires [Claude Code](https://docs.anthropic.ai/claude-code) to be installed and authenticated.**

---

## Install

### macOS
1. Open the `.dmg` and drag **Claude Tray** into your **Applications** folder
2. Launch it from Applications or Spotlight
3. The icon appears in your menu bar immediately

> **First launch blocked?** macOS blocks apps from unverified developers. Go to **System Settings → Privacy & Security** → scroll down → click **Open Anyway**.

### Windows
Run the installer — it installs for your user account (no admin required) and launches automatically. The icon appears in the system tray (bottom-right). If it's hidden, click **^** to find it and drag it to the visible area.

---

## Features

- **Live tray icon** — session % shown at all times in your menu bar / system tray
- **Click-to-open popup** — session and weekly usage with progress bars and reset times
- **Color-coded** — icon and bars shift orange → yellow → red at 70% and 90%
- **Usage history** — sparkline chart of your last 40 readings
- **Auto-refresh** — re-runs `claude /usage` every 5 minutes; manual ↻ button also available

## Privacy

Everything runs locally. The app calls `claude /usage` on your machine — no network requests beyond what Claude Code itself makes. Nothing is sent to any server.

---

## Troubleshooting

**Blank tray icon / "Could not run claude"**
`claude` isn't on your PATH. Run `which claude` (macOS) or `where claude` (Windows). If missing: `npm i -g @anthropic-ai/claude-code`

**Stuck on "fetching…"**
Open a terminal and run `claude /usage` to confirm you're authenticated. If it prompts for login, complete that first.

**Stuck on "fetching…" only in the installed app**
Claude Code is showing a directory trust prompt. Run this once in a terminal:
- **macOS:** `cd ~ && claude /usage` → press **Enter** at the prompt
- **Windows:** `cd %USERPROFILE% && claude /usage` → press **Enter**

**Session expired**
Run `claude` in a terminal and log in again.

**Debug log (dev/source builds only)**
When running from source (`npm start`), a debug log is written to `~/claude-tray-debug.log`. Not written in packaged/installed builds.

---

## Build from source

```bash
cd os-menu
npm install
npm start
```

To build a distributable:
```bash
npm run build:mac    # → dist/Claude Tray.dmg
npm run build:win    # → dist/Claude Tray Setup 1.0.0.exe
npm run build:linux  # → dist/Claude Tray.AppImage
```
