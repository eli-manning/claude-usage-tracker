// Minimal ANSI/VT100 terminal-grid renderer.
//
// Claude Code's TUI positions text with absolute cursor moves (CUP `\x1b[r;cH`,
// CHA `\x1b[cG`) rather than plain newlines/spaces — e.g. two-column layouts
// like "Favorite model: Sonnet 5   Total tokens: 23.7m" are drawn by jumping
// the cursor to column 42 and writing "Total tokens:" there. A regex that
// just strips ANSI codes collapses that gap and runs words together
// ("Favoritemodel:...Totaltokens:"). Tracking a real cursor position and
// placing each character into a sparse grid reconstructs the intended
// spacing regardless of how the TUI chose to move the cursor.

const CSI_RE = /\x1b\[([0-9;?]*)([a-zA-Z@])/g;
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const ESC_OTHER_RE = /\x1b./g;

function ansiToLines(raw) {
  const grid = new Map(); // row -> Map(col -> char)
  let row = 0;
  let col = 0;
  let maxRow = 0;

  const lineAt = (r) => {
    let l = grid.get(r);
    if (!l) {
      l = new Map();
      grid.set(r, l);
    }
    return l;
  };

  const clearLineFrom = (r, fromCol, toCol) => {
    const l = grid.get(r);
    if (!l) return;
    for (const c of Array.from(l.keys())) {
      if (c >= fromCol && c <= toCol) l.delete(c);
    }
  };

  let i = 0;
  const n = raw.length;
  while (i < n) {
    const ch = raw[i];
    if (ch === "\x1b") {
      CSI_RE.lastIndex = i;
      const csiMatch = CSI_RE.exec(raw);
      if (csiMatch && csiMatch.index === i) {
        const params = csiMatch[1];
        const final = csiMatch[2];
        i = CSI_RE.lastIndex;
        if (params.startsWith("?")) continue; // private-mode toggle, no text effect
        const nums = params.length
          ? params.split(";").map((x) => (x === "" ? null : parseInt(x, 10)))
          : [];
        const p1 = nums.length > 0 && nums[0] != null ? nums[0] : null;
        const p2 = nums.length > 1 && nums[1] != null ? nums[1] : null;
        switch (final) {
          case "H":
          case "f":
            row = Math.max(0, (p1 || 1) - 1);
            col = Math.max(0, (p2 || 1) - 1);
            break;
          case "G":
            col = Math.max(0, (p1 || 1) - 1);
            break;
          case "d":
            row = Math.max(0, (p1 || 1) - 1);
            break;
          case "C":
            col += p1 || 1;
            break;
          case "D":
            col = Math.max(0, col - (p1 || 1));
            break;
          case "A":
            row = Math.max(0, row - (p1 || 1));
            break;
          case "B":
            row += p1 || 1;
            break;
          case "K": {
            const mode = p1 || 0;
            if (mode === 0) clearLineFrom(row, col, Infinity);
            else if (mode === 1) clearLineFrom(row, -Infinity, col);
            else if (mode === 2) grid.set(row, new Map());
            break;
          }
          case "J": {
            const mode = p1 || 0;
            if (mode === 2 || mode === 3) {
              grid.clear();
            } else if (mode === 0) {
              for (const r of Array.from(grid.keys())) if (r > row) grid.delete(r);
              clearLineFrom(row, col, Infinity);
            } else if (mode === 1) {
              for (const r of Array.from(grid.keys())) if (r < row) grid.delete(r);
              clearLineFrom(row, -Infinity, col);
            }
            break;
          }
          // everything else (m, l, h, q, r, ...) ignored — no cursor/text effect
        }
        maxRow = Math.max(maxRow, row);
        continue;
      }
      OSC_RE.lastIndex = i;
      const oscMatch = OSC_RE.exec(raw);
      if (oscMatch && oscMatch.index === i) {
        i = OSC_RE.lastIndex;
        continue;
      }
      ESC_OTHER_RE.lastIndex = i;
      const escMatch = ESC_OTHER_RE.exec(raw);
      if (escMatch && escMatch.index === i) {
        i = ESC_OTHER_RE.lastIndex;
        continue;
      }
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row += 1;
      col = 0;
      maxRow = Math.max(maxRow, row);
      i += 1;
      continue;
    }
    if (ch === "\r") {
      col = 0;
      i += 1;
      continue;
    }
    lineAt(row).set(col, ch);
    col += 1;
    maxRow = Math.max(maxRow, row);
    i += 1;
  }

  const lines = [];
  for (let r = 0; r <= maxRow; r++) {
    const l = grid.get(r);
    if (!l || l.size === 0) {
      lines.push("");
      continue;
    }
    const width = Math.max(...l.keys()) + 1;
    const buf = new Array(width).fill(" ");
    for (const [c, chch] of l) buf[c] = chch;
    lines.push(buf.join("").replace(/\s+$/, ""));
  }
  return lines;
}

const BOX_CHARS_RE = /[─│╭╰╮╯━┃┏┗┓┛█▌▛▜▝▞▟▐▙▚▔░▒▓]/g;

function stripBoxChars(s) {
  return s.replace(BOX_CHARS_RE, "");
}

module.exports = { ansiToLines, stripBoxChars };
