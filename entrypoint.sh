#!/bin/sh
# Container entrypoint: supervise the Node server and Caddy in one container.
#
# The previous version started Node in the background and `exec caddy` as PID 1,
# so `docker stop`'s SIGTERM never reached Node: its graceful-shutdown handler
# was dead code and the process always ended in SIGKILL.
#
# tini is PID 1 (see Dockerfile) and reaps zombies. This script forwards
# TERM/INT to both children, waits for them, and exits non-zero if either child
# dies on its own — a dead backend must never leave the container "healthy".
set -eu

NODE_ENTRY="${NODE_ENTRY:-/srv/server/index.js}"
CADDY_CONFIG="${CADDY_CONFIG:-/etc/caddy/Caddyfile}"

log() {
  printf '[entrypoint] %s\n' "$*"
}

node_pid=''
caddy_pid=''
stopping=0

# Forward TERM/INT to both children, wait up to 10s, then SIGKILL.
shutdown() {
  status="${1:-0}"
  if [ "$stopping" -eq 1 ]; then
    exit "$status"
  fi
  stopping=1
  trap - TERM INT

  log "stopping node (${node_pid:-none}) and caddy (${caddy_pid:-none})"
  [ -n "$caddy_pid" ] && kill -TERM "$caddy_pid" 2>/dev/null || true
  [ -n "$node_pid" ] && kill -TERM "$node_pid" 2>/dev/null || true

  waited=0
  while [ "$waited" -lt 10 ]; do
    alive=0
    if [ -n "$node_pid" ] && kill -0 "$node_pid" 2>/dev/null; then alive=1; fi
    if [ -n "$caddy_pid" ] && kill -0 "$caddy_pid" 2>/dev/null; then alive=1; fi
    [ "$alive" -eq 0 ] && break
    waited=$((waited + 1))
    sleep 1
  done

  if [ -n "$node_pid" ] && kill -0 "$node_pid" 2>/dev/null; then
    log "node still alive after ${waited}s, sending SIGKILL"
    kill -KILL "$node_pid" 2>/dev/null || true
  fi
  if [ -n "$caddy_pid" ] && kill -0 "$caddy_pid" 2>/dev/null; then
    log "caddy still alive after ${waited}s, sending SIGKILL"
    kill -KILL "$caddy_pid" 2>/dev/null || true
  fi

  wait 2>/dev/null || true
  exit "$status"
}

trap 'shutdown 0' TERM INT

log "starting server: node $NODE_ENTRY"
node "$NODE_ENTRY" &
node_pid=$!

log "starting caddy: $CADDY_CONFIG"
caddy run --config "$CADDY_CONFIG" --adapter caddyfile &
caddy_pid=$!

# Supervision loop: a dead child takes the container down with it.
while :; do
  sleep 1

  if ! kill -0 "$node_pid" 2>/dev/null; then
    if wait "$node_pid"; then status=0; else status=$?; fi
    log "node exited (status $status); stopping container"
    shutdown 1
  fi

  if ! kill -0 "$caddy_pid" 2>/dev/null; then
    if wait "$caddy_pid"; then status=0; else status=$?; fi
    log "caddy exited (status $status); stopping container"
    shutdown 1
  fi
done
