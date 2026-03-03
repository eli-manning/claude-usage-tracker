#!/usr/bin/env python3
"""
Runs Claude Code in a PTY with the /usage command passed as an argument.
Captures the output and exits as soon as data is received.
Usage: python3 pty-wrapper.py <path-to-claude>
"""
import os
import pty
import select
import sys
import time
import signal


def main():
    if len(sys.argv) < 2:
        sys.exit(1)

    claude_path = sys.argv[1]
    master, slave = pty.openpty()

    pid = os.fork()
    if pid == 0:
        # CHILD PROCESS
        os.close(master)
        os.setsid()

        # Standard PTY setup
        try:
            import fcntl
            import termios
            fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
        except Exception:
            pass

        os.dup2(slave, 0)
        os.dup2(slave, 1)
        os.dup2(slave, 2)

        if slave > 2:
            os.close(slave)

        # We pass /usage directly as an argument.
        # This bypasses the interactive prompt and TUI menu issues.
        os.execv(claude_path, [claude_path, '/usage'])
        os._exit(1)

    # PARENT PROCESS
    os.close(slave)
    buf = b''
    start_time = time.time()
    timeout = 10  # Maximum seconds to wait

    try:
        while True:
            # Check if we've timed out
            if (time.time() - start_time) > timeout:
                break

            # Watch the PTY master for data
            r, _, _ = select.select([master], [], [], 0.1)
            if r:
                try:
                    data = os.read(master, 4096)
                    if not data:
                        break

                    buf += data
                    # Output to stdout so Electron can capture it
                    sys.stdout.buffer.write(data)
                    sys.stdout.buffer.flush()

                    # Trigger exit as soon as we see the usage data
                    # This makes the refresh feel instant
                    if b'% used' in buf or b'under 5% used' in buf.lower():
                        # Give it a tiny moment to finish the current line
                        time.sleep(0.2)
                        break
                except OSError:
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


if __name__ == "__main__":
    main()
