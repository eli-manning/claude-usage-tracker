# Claude Usage Tracker

Two tools for monitoring your Claude usage limits.

---

## Tray App — `os-menu/`

A menu bar / system tray app for **Claude Code** (the CLI). Lives in your macOS menu bar or Windows system tray and shows live session and weekly usage percentages without opening a browser.

**Download:**

| Platform | Link |
|----------|------|
| macOS (Apple Silicon) | [Claude Tray.dmg](https://github.com/eli-manning/claude-usage-tracker/releases/latest/download/Claude.Tray-1.0.2-arm64.dmg) |
| Windows | [Claude Tray Setup.exe](https://github.com/eli-manning/claude-usage-tracker/releases/latest/download/Claude.Tray.Setup.1.0.2.exe) |

Requires [Claude Code](https://docs.anthropic.ai/claude-code) installed and authenticated.

> **macOS — first launch:** Apple will block the app because it's from an unverified developer. After opening the `.dmg` and dragging the app to Applications, go to **System Settings → Privacy & Security**, scroll down, and click **Open Anyway**.

**Features:**
- Orange tray icon showing your current session % at all times
- Click-to-open popup with session + weekly gauges, reset times, and a history chart
- Icon color shifts orange → yellow → red at 70% and 90%
- Auto-refreshes every 5 minutes by running `claude /usage` in the background
- Manual refresh button and countdown timer in the popup

**Privacy:** Everything runs locally. The app calls `claude /usage` on your machine — no API calls, no secrets, no network traffic beyond what Claude Code itself does. Usage percentages are stored in `localStorage` for the history chart only. Nothing leaves your machine.

→ [Full install instructions and troubleshooting](os-menu/README.md)

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
- Python 3 (macOS only)

**Chrome extension:**
- Google Chrome or any Chromium-based browser
