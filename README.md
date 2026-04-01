# Claude Usage Tracker

Two tools for monitoring your Claude usage limits.

![Platform support](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)

---

## Tray App — `os-menu/`

A menu bar / system tray app for **Claude Code** (the CLI). Lives in your macOS menu bar or Windows/Linux system tray and shows live session and weekly usage percentages without opening a browser.

**Features:**
- Orange tray icon showing your current session % at all times
- Click-to-open popup with session + weekly gauges, reset times, and a history chart
- Icon color shifts orange → yellow → red at 70% and 90%
- Auto-refreshes every 5 minutes by running `claude /usage` in the background
- Manual refresh button and countdown timer in the popup

**Privacy:** Everything runs locally. The app calls `claude /usage` on your machine — no API calls, no secrets, no network traffic beyond what Claude Code itself does. Usage percentages are stored in `localStorage` for the history chart only. Nothing leaves your machine.

### Quick start

```bash
cd os-menu
npm install
npm start
```

### Build a standalone app

```bash
cd os-menu
npm run build:mac    # → dist/Claude Tray.dmg
npm run build:win    # → dist/Claude Tray Setup 1.0.0.exe
npm run build:linux  # → dist/Claude Tray.AppImage
```

Run the output installer for your platform — it installs and launches the app automatically.

→ [Full setup, install instructions, and troubleshooting](os-menu/README.md)

---

## Chrome Extension — `chrome-extension/`

A Chrome extension for **Claude.ai** (the web app). Shows session and weekly usage gauges, a history chart, and threshold alerts — all in a browser popup.

### Install

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `chrome-extension/` folder

→ [Details](chrome-extension/README.md)

---

## Requirements

**Tray app:**
- [Claude Code](https://docs.anthropic.ai/claude-code) installed and authenticated: `npm i -g @anthropic-ai/claude-code`
- Node.js v18+
- Python 3 (macOS / Linux only)

**Chrome extension:**
- Google Chrome or any Chromium-based browser
