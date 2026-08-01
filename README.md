# Claude Usage Tracker

Three tools for monitoring your Claude usage limits.

---

## Tray App — `os-menu/`

A menu bar / system tray app for **Claude Code** (the CLI). Lives in your macOS menu bar or Windows system tray and shows live session and weekly usage percentages without opening a browser.

**Download:**

| Platform | Link |
|----------|------|
| macOS (Apple Silicon) | [Claude-Tray.dmg](https://github.com/eli-manning/claude-usage-tracker/releases/latest/download/Claude-Tray.dmg) |
| Windows | [Claude-Tray.exe](https://github.com/eli-manning/claude-usage-tracker/releases/latest/download/Claude-Tray.exe) |

Requires [Claude Code](https://docs.anthropic.ai/claude-code) installed and authenticated.

> **macOS — first launch:** Apple will block the app because it's from an unverified developer. After opening the `.dmg` and dragging the app to Applications, go to **System Settings → Privacy & Security**, scroll down, and click **Open Anyway**. If it instead says the app "is damaged and can't be opened," run `xattr -cr "/Applications/Claude Tray.app"` in Terminal, then launch it again.

**Features:**
- Orange tray icon showing your current session % at all times
- Click-to-open popup with session + weekly gauges, reset times, and a history chart
- Icon color shifts orange → yellow → red at 70% and 90%
- Auto-refreshes every 5 minutes by running `claude /usage` in the background
- Manual refresh button in the popup
- Switch between providers (Claude, Antigravity, Codex, Cursor) right from the popup

**Privacy:** Everything runs locally. The app calls `claude /usage` on your machine — no API calls, no secrets, no network traffic beyond what Claude Code itself does. Usage percentages are stored in `localStorage` for the history chart only. Nothing leaves your machine.

→ [Full install instructions and troubleshooting](os-menu/README.md)

---

## Dynamic Island — `dynamic-island-native/`

A native macOS Swift Package: a floating panel that hangs just under your Mac's menu bar, always visible — no click-to-open step. Rest state is a small pill with a live session/weekly readout; click it and it morphs into a radial ring of provider wedges (Claude, Antigravity, Codex, Cursor), with Claude and Antigravity's own model/quota stats wired up so far.

Run from source with `swift build && swift run` — no packaged download yet.

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

**Tray app & Dynamic Island:**
- [Claude Code](https://docs.anthropic.ai/claude-code) installed and authenticated: `npm i -g @anthropic-ai/claude-code`
- Node.js v18+
- Python 3
- Dynamic Island is macOS-only (it hangs under the menu bar, which is a Mac-specific concept)

**Chrome extension:**
- Google Chrome or any Chromium-based browser
