#!/usr/bin/env bash
# Sample server-side goroutine count and heap from the pprof endpoint at a fixed
# interval, emitting a CSV timeseries. Pair this with each k6 run: the wire
# ceiling shows up here (unbounded goroutines/heap, or CPU saturation) before
# the client metrics fully degrade.
#
# Usage: PPROF=http://localhost:6771 INTERVAL=2 DURATION=120 ./loadtest/scrape-pprof.sh > run.csv
set -euo pipefail

PPROF="${PPROF:-http://localhost:6771}"
INTERVAL="${INTERVAL:-2}"
DURATION="${DURATION:-120}"

echo "ts,goroutines,heap_bytes"
end=$(( $(date +%s) + DURATION ))
while [ "$(date +%s)" -lt "$end" ]; do
  ts=$(date +%s)
  # goroutine?debug=1 starts with "goroutine profile: total N"
  goroutines=$(curl -fsS "$PPROF/debug/pprof/goroutine?debug=1" 2>/dev/null \
    | sed -n 's/^goroutine profile: total \([0-9]*\)/\1/p' | head -1)
  # heap?debug=1 ends with a runtime.MemStats block; HeapAlloc is the live heap.
  heap=$(curl -fsS "$PPROF/debug/pprof/heap?debug=1" 2>/dev/null \
    | sed -n 's/^# HeapAlloc = \([0-9]*\)/\1/p' | head -1)
  echo "${ts},${goroutines:-NA},${heap:-NA}"
  sleep "$INTERVAL"
done
