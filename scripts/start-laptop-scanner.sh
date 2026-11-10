#!/usr/bin/env bash
set -euo pipefail
install -d -o clamav -g clamav -m 750 /run/clamav /var/lib/clamav
freshclam --config-file=/etc/clamav/freshclam.conf
clamd --config-file=/etc/clamav/clamd.conf &
scanner_pid=$!
updater_pid=''
worker_pid=''
stop(){ trap - TERM INT EXIT; for pid in "$worker_pid" "$updater_pid" "$scanner_pid"; do if [[ -n "$pid" ]]; then kill -TERM "$pid" 2>/dev/null||true; fi; done; wait||true; }
trap stop TERM INT EXIT
for attempt in $(seq 1 120); do
 if ! kill -0 "$scanner_pid" 2>/dev/null; then exit 1; fi
 if [[ -S /run/clamav/clamd.ctl ]]; then break; fi
 sleep 1
done
freshclam --config-file=/etc/clamav/freshclam.conf --daemon &
updater_pid=$!
runuser -u node -- node scripts/laptop-scanner.mjs &
worker_pid=$!
set +e
wait -n "$scanner_pid" "$updater_pid" "$worker_pid"
status=$?
set -e
if [[ "$status" == 0 ]]; then status=1; fi
exit "$status"
