#!/usr/bin/env python3
"""
Dev-only capture tool. Spawns `claude` in a PTY, runs a slash command,
optionally sends follow-up keystrokes (e.g. to switch TUI tabs), and dumps
both the raw (ANSI-included) and cleaned output to files for offline parser
development. Not shipped with the app.

Idle-based: waits until no new bytes arrive for a quiet window, treats that
as "frame settled", then either sends the next queued keystroke or (if none
left) writes output and exits.

Usage:
  python3 capture.py /usage
  python3 capture.py /stats
  python3 capture.py /stats --send Right --send Right   # try arrow-key tab switch
  python3 capture.py /stats --send Tab                   # try Tab if arrows don't work
"""
import os
import pty
import re
import select
import sys
import time
import signal
import shutil
import struct
import fcntl
import termios
import argparse

KEYMAP = {
    "Right": b"\x1b[C",
    "Left": b"\x1b[D",
    "Up": b"\x1b[A",
    "Down": b"\x1b[B",
    "Tab": b"\t",
    "ShiftTab": b"\x1b[Z",
    "Enter": b"\r",
    "r": b"r",
}

IDLE_QUIET_S = 3.0  # no new bytes for this long => frame considered settled
MIN_FIRST_WAIT_S = 1.5  # ignore idle detection until at least this much has elapsed (startup animation)


def find_claude():
    p = shutil.which("claude")
    if p:
        return p
    for c in ["/opt/homebrew/bin/claude", "/usr/local/bin/claude"]:
        if os.path.exists(c):
            return c
    sys.exit("claude not found on PATH")


def strip_ansi(raw: str) -> str:
    # Mirror os-menu/main.js parseUsageOutput cleaning so captures match
    # what the shipped parser will actually see.
    s = re.sub(r"\x1b\[\d+;\d*[Hf]", "\n", raw)
    s = s.replace("\x1b[1C", "")
    s = re.sub(r"\x1b\[[0-9;?]*a", "a", s)
    s = re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]", "", s)
    s = re.sub(r"[─│╭╰╮╯━┃┏┗┓┛█▌▛▜▝▞▟▐▙▚]", "", s)
    s = s.replace("\r", "\n")
    lines = [l.strip() for l in s.split("\n")]
    return "\n".join(l for l in lines if l)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("command", help="slash command, e.g. /usage or /stats")
    ap.add_argument("--send", action="append", default=[], help="keystroke to send after each settle (repeatable): Right/Left/Up/Down/Tab/Enter/r")
    ap.add_argument("--timeout", type=float, default=20.0, help="hard timeout in seconds")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "out"))
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    slug = args.command.strip("/").replace(" ", "_") or "root"
    if args.send:
        slug += "_" + "_".join(args.send)

    claude_path = find_claude()
    master, slave = pty.openpty()
    # Default PTY size is 24x80, which truncates content past row 24 (e.g. the
    # bottom half of /stats). Grow it so the TUI renders everything.
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 60, 200, 0, 0))

    pid = os.fork()
    if pid == 0:
        os.close(master)
        os.setsid()
        try:
            fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
        except Exception:
            pass
        os.dup2(slave, 0)
        os.dup2(slave, 1)
        os.dup2(slave, 2)
        if slave > 2:
            os.close(slave)
        os.chdir(os.path.expanduser("~"))
        os.execv(claude_path, [claude_path, args.command])
        os._exit(1)

    os.close(slave)
    buf = b""
    start = time.time()
    last_data_at = start
    trust_answered = False
    pending_sends = list(args.send)

    try:
        while time.time() - start < args.timeout:
            r, _, _ = select.select([master], [], [], 0.1)
            now = time.time()
            if r:
                try:
                    data = os.read(master, 4096)
                except OSError:
                    break
                if not data:
                    break
                buf += data
                last_data_at = now
                sys.stdout.buffer.write(data)
                sys.stdout.buffer.flush()

                if not trust_answered and b"safety" in buf.lower():
                    trust_answered = True
                    time.sleep(0.2)
                    try:
                        os.write(master, b"\r")
                    except OSError:
                        pass
                    last_data_at = time.time()  # don't treat the trust prompt as "settled"

            idle_for = now - last_data_at
            elapsed = now - start
            if elapsed > MIN_FIRST_WAIT_S and idle_for > IDLE_QUIET_S:
                if pending_sends:
                    key = pending_sends.pop(0)
                    seq = KEYMAP.get(key)
                    if seq:
                        try:
                            os.write(master, seq)
                        except OSError:
                            pass
                    last_data_at = time.time()
                else:
                    break

            if os.waitpid(pid, os.WNOHANG)[0] != 0:
                break
    finally:
        try:
            os.close(master)
        except OSError:
            pass
        try:
            os.kill(pid, signal.SIGTERM)
            os.waitpid(pid, 0)
        except OSError:
            pass

    raw_text = buf.decode("utf-8", errors="replace")
    clean_text = strip_ansi(raw_text)

    raw_path = os.path.join(args.out, slug + ".raw.txt")
    clean_path = os.path.join(args.out, slug + ".clean.txt")
    with open(raw_path, "w") as f:
        f.write(raw_text)
    with open(clean_path, "w") as f:
        f.write(clean_text)

    sys.stderr.write(f"\n\n--- wrote {raw_path} and {clean_path} ---\n")


if __name__ == "__main__":
    main()
