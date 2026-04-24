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

        # Run from home dir so Claude saves its trust decision to ~/.claude/
        os.chdir(os.path.expanduser('~'))

        # We pass /usage directly as an argument.
        # This bypasses the interactive prompt and TUI menu issues.
        os.execv(claude_path, [claude_path, '/usage'])
        os._exit(1)

    # PARENT PROCESS
    os.close(slave)
    buf = b''
    start_time = time.time()
    timeout = 10  # Maximum seconds to wait
    last_pct_time = time.time()
    trust_answered = False

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

                    # Check for completion markers
                    has_pct = b'% used' in buf or b'under 5%' in buf.lower()
                    has_reset = b'resets' in buf.lower() or b'in ' in buf.lower()

                    # Only exit early if we have BOTH the percentage AND the reset time
                    # Or if we've seen a percentage but 1.5s have passed without a reset line
                    if has_pct:
                        if has_reset:
                            # If we accepted a trust prompt, give Claude time to persist the decision
                            time.sleep(1.5 if trust_answered else 0.1)
                            break
                        elif (time.time() - last_pct_time) > 1.5:
                            break
                    else:
                        last_pct_time = time.time()
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
