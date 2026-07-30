#!/usr/bin/env python3
"""
Minimal ANSI/VT100 terminal-grid renderer: tracks cursor row/col and places
characters into a sparse grid, so absolute-position/column-jump sequences
(CHA, CUP, CUF, etc.) reconstruct correctly instead of being stripped.
Dev tool for building the real parser; mirrored into main.js once validated.
"""
import re

CSI_RE = re.compile(r"\x1b\[([0-9;?]*)([a-zA-Z@])")
OSC_RE = re.compile(r"\x1b\](?:[^\x07\x1b]*)(?:\x07|\x1b\\)")
ESC_OTHER_RE = re.compile(r"\x1b.")


def ansi_to_lines(raw: str):
    grid = {}  # row -> {col -> char}
    row, col = 0, 0
    max_row, max_col = 0, 0
    i = 0
    n = len(raw)

    def put(ch):
        nonlocal col, max_row, max_col
        grid.setdefault(row, {})[col] = ch
        col += 1
        max_row = max(max_row, row)
        max_col = max(max_col, col)

    while i < n:
        ch = raw[i]
        if ch == "\x1b":
            m = CSI_RE.match(raw, i)
            if m:
                params, final = m.group(1), m.group(2)
                if params.startswith("?"):
                    # private-mode toggle (e.g. \x1b[?25l) — no cursor/text effect we care about
                    i = m.end()
                    continue
                nums = [int(x) if x else None for x in params.split(";")] if params else []
                p1 = nums[0] if nums and nums[0] is not None else None
                p2 = nums[1] if len(nums) > 1 and nums[1] is not None else None
                if final in ("H", "f"):
                    row = (p1 - 1) if p1 else 0
                    col = (p2 - 1) if p2 else 0
                    row = max(0, row)
                    col = max(0, col)
                elif final == "G":
                    col = max(0, (p1 - 1) if p1 else 0)
                elif final == "d":
                    row = max(0, (p1 - 1) if p1 else 0)
                elif final == "C":
                    col += p1 if p1 else 1
                elif final == "D":
                    col = max(0, col - (p1 if p1 else 1))
                elif final == "A":
                    row = max(0, row - (p1 if p1 else 1))
                elif final == "B":
                    row += p1 if p1 else 1
                elif final == "K":
                    mode = p1 if p1 else 0
                    line = grid.get(row, {})
                    if mode == 0:
                        for c in list(line.keys()):
                            if c >= col:
                                del line[c]
                    elif mode == 1:
                        for c in list(line.keys()):
                            if c <= col:
                                del line[c]
                    elif mode == 2:
                        grid[row] = {}
                elif final == "J":
                    mode = p1 if p1 else 0
                    if mode == 2 or mode == 3:
                        grid.clear()
                    elif mode == 0:
                        for r in list(grid.keys()):
                            if r > row:
                                del grid[r]
                        line = grid.get(row, {})
                        for c in list(line.keys()):
                            if c >= col:
                                del line[c]
                    elif mode == 1:
                        for r in list(grid.keys()):
                            if r < row:
                                del grid[r]
                        line = grid.get(row, {})
                        for c in list(line.keys()):
                            if c <= col:
                                del line[c]
                # everything else (m, l, h, q, r, ?...) ignored
                i = m.end()
                continue
            m = OSC_RE.match(raw, i)
            if m:
                i = m.end()
                continue
            m = ESC_OTHER_RE.match(raw, i)
            if m:
                i = m.end()
                continue
            i += 1
            continue
        if ch == "\n":
            row += 1
            col = 0
            max_row = max(max_row, row)
            i += 1
            continue
        if ch == "\r":
            col = 0
            i += 1
            continue
        put(ch)
        i += 1

    lines = []
    for r in range(max_row + 1):
        cols = grid.get(r, {})
        if not cols:
            lines.append("")
            continue
        width = max(cols.keys()) + 1
        buf = [" "] * width
        for c, chch in cols.items():
            buf[c] = chch
        lines.append("".join(buf).rstrip())
    return lines


def strip_box_chars(s: str) -> str:
    return re.sub(r"[─│╭╰╮╯━┃┏┗┓┛█▌▛▜▝▞▟▐▙▚▔░▒▓]", "", s)


if __name__ == "__main__":
    import sys
    raw = open(sys.argv[1]).read()
    lines = ansi_to_lines(raw)
    for l in lines:
        cleaned = strip_box_chars(l).strip()
        if cleaned:
            print(cleaned)
