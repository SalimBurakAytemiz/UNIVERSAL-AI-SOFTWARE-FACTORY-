#!/usr/bin/env bash
# //TR: YALNIZ TANI (merge edilmez): takilan build-release-zip surecinin cekirdek yiginini, thread wchan'larini, fd'lerini, NODE_* ortamini ve kisa strace/gdb ciktisini yazdirir.
for pid in $(pgrep -f "scripts/build-release-zip.mjs"); do
  echo "=== STUCK PID $pid ==="; ps -o pid,ppid,stat,etime,wchan:30,args -p $pid | cut -c1-250
  grep -E "Threads|State" /proc/$pid/status
  for t in /proc/$pid/task/*; do echo "task $(basename $t) wchan=$(cat $t/wchan 2>/dev/null) comm=$(cat $t/comm)"; sudo cat $t/stack 2>/dev/null | head -12; done
  echo "--- fds"; sudo ls -l /proc/$pid/fd 2>/dev/null | cut -c40-200
  echo "--- env NODE*/UV*/OPENSSL*/VITEST*"; sudo cat /proc/$pid/environ 2>/dev/null | tr '\0' '\n' | grep -E "^(NODE|UV_|OPENSSL|VITEST|TMPDIR)" | cut -c1-200
  echo "--- cwd"; sudo readlink /proc/$pid/cwd
  if command -v strace >/dev/null; then echo "--- strace 4s"; sudo timeout 4 strace -f -tt -p $pid 2>&1 | head -40; else echo "no strace"; fi
  if command -v gdb >/dev/null; then echo "--- gdb bt"; sudo timeout 40 gdb -p $pid -batch -ex "thread apply all bt 12" 2>&1 | grep -E "^#|^Thread" | head -60; else echo "no gdb"; fi
done
