#!/usr/bin/env bash
# Official signatures are mandatory. No fixture signatures or scanner bypass.
set -euo pipefail
install -d -o clamav -g clamav -m 750 /run/clamav /var/lib/clamav
freshclam --config-file=/etc/clamav/freshclam.conf
clamd --config-file=/etc/clamav/clamd.conf &
scanner_pid=$!
updater_pid=''
app_pid=''
stop() {
  trap - TERM INT EXIT
  for pid in "$app_pid" "$updater_pid" "$scanner_pid"; do
    if [[ -n "$pid" ]]; then kill -TERM "$pid" 2>/dev/null || true; fi
  done
  wait || true
}
trap stop TERM INT EXIT
ready=false
for attempt in $(seq 1 120); do
  if ! kill -0 "$scanner_pid" 2>/dev/null; then
    echo 'Required scanner exited during startup.' >&2
    exit 1
  fi
  if node -e 'const n=require("node:net");const c=n.connect(process.env.CLAMD_SOCKET_PATH);c.setTimeout(1000);c.on("connect",()=>c.write("zPING\0"));c.on("data",b=>{c.destroy();process.exit(b.toString().trim().replace(/\0/g,"")==="PONG"?0:1)});for(const e of ["error","timeout"])c.on(e,()=>process.exit(1));' ; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then echo 'Required scanner did not become ready.' >&2; exit 1; fi
freshclam --config-file=/etc/clamav/freshclam.conf --daemon &
updater_pid=$!
# Migrations are additive/versioned and separately rehearsed before release.
runuser -u node -- node scripts/migrate.mjs
runuser -u node -- node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port "${PORT:-10000}" &
app_pid=$!
# Any essential process exiting terminates the instance for platform recovery.
set +e
wait -n "$scanner_pid" "$updater_pid" "$app_pid"
status=$?
set -e
if [[ "$status" == 0 ]]; then status=1; fi
exit "$status"
