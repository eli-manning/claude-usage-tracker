# Claude Usage Tracker

Two tools for keeping an eye on your Claude usage limits.

---

## Menu Bar / Tray App — `os-menu/` ✓ Active

Tracks usage for **Claude Code** (the CLI). Lives in your macOS menu bar or Windows/Linux system tray. Runs `claude /usage` in the background every 5 minutes — no browser, no API key needed.

**Quick start:**
```bash
cd os-menu
npm install
npm start
```

→ [Full setup & details](os-menu/README.md)

---

## Chrome Extension — `chrome-extension/` ⚠️ Deprecated

~~Tracked usage on **Claude.ai** (the web app).~~ Anthropic removed usage data from `claude.ai/settings/usage`, so this extension no longer works. Kept here for reference only.

→ [Details](chrome-extension/README.md)
