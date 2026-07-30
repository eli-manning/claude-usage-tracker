// Parses cleaned Claude Code TUI output (from `/usage` and `/stats`) into
// structured data. No Electron dependency — kept separate from main.js so it
// can be unit-tested with plain node.
//
// Claude Code's TUI positions text with absolute cursor moves (column jumps
// for two-column layouts, e.g. "Favorite model: X    Total tokens: Y") rather
// than literal spaces. ansiToLines() replays those moves against a virtual
// grid so the reconstructed lines keep their intended spacing, which the
// regexes below rely on to split label/value pairs.

const { ansiToLines, stripBoxChars } = require("./ansi-grid.js");

function toCleanLines(raw) {
  return ansiToLines(raw)
    .map((l) => stripBoxChars(l).trim())
    .filter(Boolean);
}

function parseUsageOutput(raw) {
  const result = {
    session: null,
    weekly: null,
    sessionReset: null,
    weeklyReset: null,
    weeklyPromo: null,
    credits: null,
    skills: null,
    mcpServers: null,
  };

  const lines = toCleanLines(raw);

  let section = null; // 'session-gauge' | 'weekly-gauge' | 'credits-gauge' | 'skills' | 'mcp'

  const tableRowRe = /^(.+?)\s{2,}(\d+)%$/;

  lines.forEach((line) => {
    let m;

    // The "Session" block up top (Total cost/duration/code changes/Usage by
    // model) describes the one-shot `claude /usage` process we spawn to read
    // this screen, not the user's real terminal session — it's always ~zero
    // and not worth parsing or showing.

    if (/^Current session$/.test(line)) {
      section = "session-gauge";
      return;
    }
    if (/^Current week/.test(line)) {
      section = "weekly-gauge";
      return;
    }
    if (/^Usage credits$/.test(line)) {
      section = "credits-gauge";
      result.credits = result.credits || {};
      return;
    }
    if (/^Skills\s+% of usage$/.test(line)) {
      section = "skills";
      result.skills = [];
      return;
    }
    if (/^MCP servers\s+% of usage$/.test(line)) {
      section = "mcp";
      result.mcpServers = [];
      return;
    }

    if ((m = line.match(/(\d+)%\s*used/i))) {
      const pct = parseInt(m[1], 10);
      if (section === "session-gauge") result.session = pct;
      else if (section === "weekly-gauge") result.weekly = pct;
      else if (section === "credits-gauge") result.credits.pct = pct;
      return;
    }

    if (section === "session-gauge" && /^Resets\s/i.test(line)) {
      result.sessionReset = line.replace(/^Resets\s*/i, "").trim();
      return;
    }
    if (section === "weekly-gauge") {
      if (/^Resets\s/i.test(line)) {
        result.weeklyReset = line.replace(/^Resets\s*/i, "").trim();
        return;
      }
      if (/promo/i.test(line)) {
        result.weeklyPromo = line.trim();
        return;
      }
    }
    if (
      section === "credits-gauge" &&
      (m = line.match(/^\$([\d,.]+)\s*\/\s*\$([\d,.]+)\s*spent\s*·\s*Resets\s+(.+)/i))
    ) {
      result.credits.spent = parseFloat(m[1].replace(/,/g, ""));
      result.credits.total = parseFloat(m[2].replace(/,/g, ""));
      result.credits.reset = m[3].trim();
      return;
    }

    if ((section === "skills" || section === "mcp") && (m = line.match(tableRowRe))) {
      const entry = { name: m[1].trim(), pct: parseInt(m[2], 10) };
      if (section === "skills") result.skills.push(entry);
      else result.mcpServers.push(entry);
      return;
    }
  });

  return result;
}

function parseStatsOutput(raw) {
  const result = { stats: null };
  const lines = toCleanLines(raw);
  let expectFunFact = false;

  lines.forEach((line) => {
    let m;
    if (
      (m = line.match(/^Favorite model:\s*(.+?)\s{2,}Total tokens:\s*(.+)$/))
    ) {
      result.stats = result.stats || {};
      result.stats.favoriteModel = m[1].trim();
      result.stats.totalTokens = m[2].trim();
      return;
    }
    if ((m = line.match(/^Sessions:\s*(\d+)\s{2,}Longest session:\s*(.+)$/))) {
      result.stats = result.stats || {};
      result.stats.sessions = parseInt(m[1], 10);
      result.stats.longestSession = m[2].trim();
      return;
    }
    if (
      (m = line.match(
        /^Active days:\s*(\d+)\/(\d+)\s{2,}Longest streak:\s*(.+)$/
      ))
    ) {
      result.stats = result.stats || {};
      result.stats.activeDays = parseInt(m[1], 10);
      result.stats.totalDays = parseInt(m[2], 10);
      result.stats.longestStreak = m[3].trim();
      return;
    }
    if (
      (m = line.match(
        /^Most active day:\s*(.+?)\s{2,}Current streak:\s*(.+)$/
      ))
    ) {
      result.stats = result.stats || {};
      result.stats.mostActiveDay = m[1].trim();
      result.stats.currentStreak = m[2].trim();
      expectFunFact = true;
      return;
    }
    // The trivia line after "Most active day" rotates between templates
    // ("You've used ~Nx more tokens than X", "Your longest session is ~Nx
    // longer than a X", etc.) — rather than chase each wording, just take
    // whatever line comes next, stopping at the footer hint line.
    if (expectFunFact) {
      expectFunFact = false;
      if (!/^[↓↑]/.test(line)) {
        result.stats = result.stats || {};
        result.stats.funFact = line.trim();
      }
      return;
    }
  });

  return result;
}

module.exports = { parseUsageOutput, parseStatsOutput, toCleanLines };
