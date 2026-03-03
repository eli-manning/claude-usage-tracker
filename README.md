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

**Build a standalone app:**
```bash
npm run build:mac    # → dist/Claude Tray.dmg
npm run build:win    # → dist/Claude Tray Setup.exe
npm run build:linux  # → dist/Claude Tray.AppImage
```

**One-time setup required after installing the built app** — trust the working directory so Claude Code doesn't prompt:

| Platform | Command |
|---|---|
| macOS / Linux | `cd / && claude /usage` |
| Windows (cmd) | `cd %USERPROFILE% && claude /usage` |
| Windows (PowerShell) | `cd $env:USERPROFILE && claude /usage` |

Press Enter at the "Quick safety check" prompt. Only needed once.

→ [Full setup & details](os-menu/README.md)

---

## Chrome Extension — `chrome-extension/` ⚠️ Deprecated

~~Tracked usage on **Claude.ai** (the web app).~~ Anthropic removed usage data from `claude.ai/settings/usage`, so this extension no longer works. Kept here for reference only.

→ [Details](chrome-extension/README.md)
