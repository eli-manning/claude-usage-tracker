#!/usr/bin/env python3
"""
Runs the Cursor CLI (`cursor-agent`) in a PTY and drives it to the /usage
panel. Usage: python3 cursor-pty-wrapper.py <path-to-cursor-agent>

Like Codex and Antigravity, cursor-agent starts an interactive session
rather than treating an argv slash command as a real command, so this
launches it bare (with --trust to skip the first-run "trust this
workspace?" prompt non-interactively — without it, this driver would need
to type "a" blind and hope the timing lines up), waits for the ready
prompt, then types "/usage" and Enter as if a user had.
"""
import os
import pty
import select
import sys
import time
import signal
import struct

try:
    import fcntl
    import termios
except ImportError:
    fcntl = None
    termios = None

READY_MARKER = b"Auto"           # the model-name footer, present once the ready prompt is up
PANEL_READY_MARKER = b"Esc to close"  # only present once /usage has rendered
IDLE_QUIET_S = 1.2
COMMAND_SETTLE_S = 0.8
PANEL_FALLBACK_TIMEOUT_S = 10.0
TOTAL_TIMEOUT_S = 25.0


def main():
    if len(sys.argv) < 2:
        sys.exit(1)
    cursor_path = sys.argv[1]

    master, slave = pty.openpty()
    if fcntl and termios:
        try:
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 60, 200, 0, 0))
        except Exception:
            pass

    pid = os.fork()
    if pid == 0:
        # CHILD PROCESS
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
        os.execv(cursor_path, [cursor_path, "--trust"])
        os._exit(1)

    # PARENT PROCESS
    os.close(slave)
    buf = b""
    start = time.time()
    last_data = start
    ready_seen_at = None
    typed_command = False
    command_sent_at = None
    enter_after_command_at = None

    try:
        while True:
            now = time.time()
            if now - start > TOTAL_TIMEOUT_S:
                break

            r, _, _ = select.select([master], [], [], 0.1)
            if r:
                try:
                    data = os.read(master, 4096)
                    if not data:
                        break
                    buf += data
                    last_data = time.time()
                except OSError:
                    break

            now = time.time()
            idle_for = now - last_data

            if ready_seen_at is None and READY_MARKER in buf:
                ready_seen_at = now

            if (
                ready_seen_at is not None
                and not typed_command
                and idle_for > IDLE_QUIET_S
                and now - ready_seen_at > 0.3
            ):
                try:
                    os.write(master, b"/usage")
                    typed_command = True
                    command_sent_at = now
                    last_data = now
                except OSError:
                    pass

            if (
                typed_command
                and enter_after_command_at is None
                and now - command_sent_at > COMMAND_SETTLE_S
            ):
                try:
                    os.write(master, b"\r")
                    enter_after_command_at = now
                except OSError:
                    pass

            if enter_after_command_at is not None and idle_for > IDLE_QUIET_S:
                if PANEL_READY_MARKER in buf or (now - enter_after_command_at) > PANEL_FALLBACK_TIMEOUT_S:
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

    sys.stdout.buffer.write(buf)
    sys.stdout.buffer.flush()


if __name__ == "__main__":
    main()
