#!/usr/bin/env node
// Bridges the native Swift app to the proven usage-fetching pipeline shared
// with ../dynamic-island (Electron) and ../os-menu (tray app): spawn `claude
// /usage` in a PTY, parse the TUI output, print one JSON line to stdout.
// Swift shells out to this instead of re-implementing the ANSI-grid parser.
"use strict";
const { spawn, exec } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { parseUsageOutput, parseStatsOutput } = require("./usage-parser.js");

function findClaudePath() {
  return [
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    "/usr/bin/claude",
    path.join(os.homedir(), ".local/bin/claude"),
    path.join(os.homedir(), ".npm-global/bin/claude"),
  ];
}

function runClaudeCommand(claudePath, command, augmentedEnv) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ error: "Timed out." }), 20000);
    const ptyWrapper = path.join(__dirname, "pty-wrapper.py");
    const child = spawn("python3", [ptyWrapper, claudePath, command], {
      env: { ...augmentedEnv, TERM: "dumb", FORCE_COLOR: "0", CLAUDE_CODE_DISABLE_ANIMATIONS: "true" },
    });
    const doneTimeout = setTimeout(() => child.kill(), 18000);
    let accumulated = "";
    child.stdout.on("data", (d) => (accumulated += d.toString()));
    child.on("close", () => {
      clearTimeout(timeout);
      clearTimeout(doneTimeout);
      const parseFn = command === "/usage" ? parseUsageOutput : parseStatsOutput;
      resolve(parseFn(accumulated));
    });
    child.on("error", (e) => {
      clearTimeout(timeout);
      resolve({ error: `Process error: ${e.message}` });
    });
  });
}

function isOnline() {
  return new Promise((resolve) => {
    const dns = require("dns");
    const timer = setTimeout(() => resolve(false), 3000);
    dns.lookup("anthropic.com", (err) => {
      clearTimeout(timer);
      resolve(!err);
    });
  });
}

async function main() {
  const extraPaths = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(os.homedir(), ".npm-global/bin"),
    path.join(os.homedir(), ".local/bin"),
  ];
  const augmentedEnv = { ...process.env, PATH: `${extraPaths.join(":")}:${process.env.PATH || ""}` };

  if (!(await isOnline())) {
    process.stdout.write(JSON.stringify({ error: "You're offline.", errorType: "offline" }) + "\n");
    return;
  }

  const claudePath = await new Promise((resolve) => {
    exec("which claude", { env: augmentedEnv }, (err, stdout) => {
      const fromWhich = (stdout || "").trim().split("\n")[0];
      resolve(
        fromWhich ||
          findClaudePath().find((p) => {
            try { fs.accessSync(p); return true; } catch { return false; }
          }) ||
          "claude"
      );
    });
  });

  const usage = await runClaudeCommand(claudePath, "/usage", augmentedEnv);
  const hasData = usage.session != null || usage.weekly != null;
  if (!hasData) {
    process.stdout.write(JSON.stringify(usage) + "\n");
    return;
  }
  const stats = await runClaudeCommand(claudePath, "/stats", augmentedEnv);
  process.stdout.write(JSON.stringify({ ...usage, ...stats, error: null }) + "\n");
}

main();
