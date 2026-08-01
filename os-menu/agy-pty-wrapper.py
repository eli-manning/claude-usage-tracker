#!/usr/bin/env python3
"""
Runs the Antigravity CLI (`agy`) in a PTY and drives it to the /usage quota
panel. Usage: python3 agy-pty-wrapper.py <path-to-agy>

Unlike Claude Code (see pty-wrapper.py), agy does NOT treat a slash command
passed as an argv value as a command — it just feeds it to the model as a
literal chat prompt, which produces plausible-sounding but fabricated prose
instead of real account data. The command only gets intercepted by agy's own
autocomplete when typed live into the running TUI, so this driver launches
agy bare, waits for the ready prompt, then types "/usage" and Enter as if a
user had.
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

READY_MARKER = b"for shortcuts"  # first appears once the ready `>` prompt is up
PANEL_READY_MARKER = b"GEMINI MODELS"
PANEL_FALLBACK_TIMEOUT_S = 10.0
IDLE_QUIET_S = 1.0
# First-run onboarding (color scheme, workspace trust, a live-generated
# tutorial preview) can take much longer than steady-state startup — one
# observed cold run took ~25s of Enter-nudging alone before reaching a ready
# prompt. Give it real room; this only ever runs once per machine.
WIZARD_TIMEOUT_S = 35
TOTAL_TIMEOUT_S = 55


def main():
    if len(sys.argv) < 2:
        sys.exit(1)
    agy_path = sys.argv[1]

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
        os.execv(agy_path, [agy_path])
        os._exit(1)

    # PARENT PROCESS
    os.close(slave)
    buf = b""
    start = time.time()
    last_data = start
    last_enter = 0.0
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

            # First-run onboarding (color scheme, workspace trust) blocks the
            # ready prompt — nudge through it with Enter (accepts defaults),
            # capped so a stuck/offline sign-in can't spin forever.
            if (
                ready_seen_at is None
                and idle_for > IDLE_QUIET_S
                and (now - last_enter) > 1.2
                and (now - start) < WIZARD_TIMEOUT_S
            ):
                try:
                    os.write(master, b"\r")
                    last_enter = now
                except OSError:
                    pass

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

            if typed_command and enter_after_command_at is None and now - command_sent_at > 1.0:
                try:
                    os.write(master, b"\r")
                    enter_after_command_at = now
                except OSError:
                    pass

            # A cold session can have a real network round-trip for quota
            # data between the command executing and the panel actually
            # painting — 1s of terminal silence can land right in that gap
            # (server latency, not user/terminal idleness), which was
            # grabbing a screen before the panel had rendered. Require the
            # panel to actually show up in the buffer, not just quiet time,
            # before trusting a quiet screen. NOT_SIGNED_IN_MARKER is
            # deliberately *not* treated as a stop signal here — it flashes
            # transiently during the normal startup handshake before a
            # cached-token session silently signs itself in (see
            # parseAgyOutput's own comment on this same behavior), so
            # breaking out on it early was grabbing that transient flash
            # instead of waiting for the real panel a moment later. Falls
            # back to the old idle-only rule after PANEL_FALLBACK_TIMEOUT_S
            # so a changed/missing marker (or a genuinely logged-out
            # session) can't hang the whole capture — parseAgyOutput on the
            # Node side is what actually decides signed-in vs. error from
            # whatever's in the final buffer.
            if (
                enter_after_command_at is not None
                and idle_for > IDLE_QUIET_S
            ):
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
