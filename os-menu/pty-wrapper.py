#!/usr/bin/env python3
"""
Runs Claude Code in a PTY with a slash command passed as an argument.
Captures the output and exits once the screen has settled.
Usage: python3 pty-wrapper.py <path-to-claude> [command]
  command defaults to /usage; also used for /stats.
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

IDLE_QUIET_S = 0.8  # no new bytes for this long => screen considered settled
MIN_ELAPSED_S = 1.0  # ignore idle detection until at least this much has elapsed (startup animation)


class _Terminated(Exception):
    pass


def _handle_sigterm(signum, frame):
    raise _Terminated()


def main():
    if len(sys.argv) < 2:
        sys.exit(1)

    claude_path = sys.argv[1]
    command = sys.argv[2] if len(sys.argv) > 2 else "/usage"
    # Node kills this wrapper with SIGTERM on a stall (see main.js's
    # doneTimeout). Python's default SIGTERM disposition terminates the
    # process immediately without running `finally` blocks, which orphaned
    # the forked claude child below instead of ever reaching the
    # os.kill(pid) cleanup — this handler turns SIGTERM into a normal
    # exception so the existing try/finally still runs.
    signal.signal(signal.SIGTERM, _handle_sigterm)

    master, slave = pty.openpty()

    # Default PTY size (24x80) truncates content past row 24 — /stats runs
    # past that. Grow it so the TUI renders everything in one frame.
    if fcntl and termios:
        try:
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 60, 200, 0, 0))
        except Exception:
            pass

    pid = os.fork()
    if pid == 0:
        # CHILD PROCESS
        os.close(master)
        os.setsid()

        # Standard PTY setup
        try:
            fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
        except Exception:
            pass

        os.dup2(slave, 0)
        os.dup2(slave, 1)
        os.dup2(slave, 2)

        if slave > 2:
            os.close(slave)

        # Run from home dir so Claude saves its trust decision to ~/.claude/
        os.chdir(os.path.expanduser('~'))

        os.execv(claude_path, [claude_path, command])
        os._exit(1)

    # PARENT PROCESS
    os.close(slave)
    buf = b''
    start_time = time.time()
    last_data_time = start_time
    timeout = 14  # Maximum seconds to wait
    trust_answered = False

    try:
        try:
            while True:
                now = time.time()
                if (now - start_time) > timeout:
                    break

                r, _, _ = select.select([master], [], [], 0.1)
                if r:
                    try:
                        data = os.read(master, 4096)
                        if not data:
                            break

                        buf += data
                        last_data_time = time.time()
                        sys.stdout.buffer.write(data)
                        sys.stdout.buffer.flush()

                        # Auto-answer Claude's directory trust prompt
                        # "safety check" has ANSI sequences between words so match on "safety" alone
                        if not trust_answered and b'safety' in buf.lower():
                            trust_answered = True
                            time.sleep(0.1)
                            try:
                                os.write(master, b'\r')
                            except OSError:
                                pass
                            last_data_time = time.time()  # don't treat the trust prompt as "settled"
                    except OSError:
                        break

                # Once the screen stops changing, give it a moment more (in case a
                # trust prompt was just accepted) then stop.
                now = time.time()
                idle_for = now - last_data_time
                elapsed = now - start_time
                if elapsed > MIN_ELAPSED_S and idle_for > IDLE_QUIET_S:
                    break

                # If the child process has already exited, stop reading
                if os.waitpid(pid, os.WNOHANG)[0] != 0:
                    break

        finally:
            # Cleanup
            try:
                os.close(master)
            except OSError:
                pass

            try:
                # Ensure the Claude process is killed
                os.kill(pid, signal.SIGTERM)
                os.waitpid(pid, 0)
            except OSError:
                pass
    except _Terminated:
        pass


if __name__ == "__main__":
    main()
