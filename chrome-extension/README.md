# Claude Usage Tracker — Chrome Extension

> **Deprecated** — Anthropic removed usage data from `claude.ai/settings/usage`, so this extension no longer has a page to scrape. It is kept here for reference but is not actively maintained. For Claude Code CLI usage tracking, see the [menu bar app](../os-menu/README.md) instead.

---

Track and visualize your Claude.ai usage over time, with history the native settings page doesn't show you.

## Features

- **Session & Weekly usage** displayed as live gauges
- **Usage history chart** — see how your usage changes over time
- **Badge icon** on the toolbar showing your current weekly % at a glance
- **Alerts** when you cross 75%, 90%, or 100% of either limit
- **Auto-refresh** every 30 minutes in the background

## Installation

Since this is an unpacked extension (not on the Chrome Web Store), you load it manually:

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `chrome-extension` folder

## How It Works

- A **content script** runs on `claude.ai/settings/usage` and scrapes your usage percentages
- Data is saved to **Chrome local storage** — nothing leaves your browser
- A **background service worker** triggers a refresh every 30 minutes by briefly opening the settings page in a background tab (it auto-closes after 10 seconds)
- You can also manually refresh by clicking the ↻ button in the popup

## Permissions Used

- `storage` — save usage history locally
- `alarms` — schedule periodic refresh
- `tabs` — open/close the settings page for scraping
- `scripting` — inject content script
- `notifications` — usage threshold alerts
- `https://claude.ai/*` — access the settings page

## Privacy

All data stays in your browser. Nothing is sent anywhere.
