#!/usr/bin/env bash
# conflux.sh — Start, stop, and restart all Conflux services
# Usage: ./conflux.sh {start|stop|restart|status|logs} [api|worker|ui|synapse]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_DIR="$SCRIPT_DIR/.conflux/pids"
LOG_DIR="$SCRIPT_DIR/.conflux/logs"

mkdir -p "$PID_DIR" "$LOG_DIR"

# ── PID & log file paths ──────────────────────────────────────────────────────
API_PID="$PID_DIR/api.pid"
WORKER_PID="$PID_DIR/worker.pid"
UI_PID="$PID_DIR/ui.pid"
SYNAPSE_PID="$PID_DIR/synapse.pid"

API_LOG="$LOG_DIR/api.log"
WORKER_LOG="$LOG_DIR/worker.log"
UI_LOG="$LOG_DIR/ui.log"
SYNAPSE_LOG="$LOG_DIR/synapse.log"

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✔${NC}  $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
err()  { echo -e "${RED}✖${NC}  $*"; }

# ── Helpers ───────────────────────────────────────────────────────────────────
is_running() {
    local pidfile="$1"
    [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null
}

_start() {
    local name="$1" pidfile="$2" logfile="$3"
    shift 3  # remaining args are the command

    if is_running "$pidfile"; then
        warn "$name already running (PID $(cat "$pidfile"))"
        return 0
    fi

    echo -n "  Starting $name... "
    # Rotate log if it exceeds 10 MB
    if [[ -f "$logfile" && $(stat -c%s "$logfile" 2>/dev/null || echo 0) -gt 10485760 ]]; then
        mv "$logfile" "${logfile%.log}.$(date +%Y%m%d%H%M%S).log"
    fi

    nohup "$@" >> "$logfile" 2>&1 &
    local pid=$!
    echo "$pid" > "$pidfile"
    sleep 1

    if is_running "$pidfile"; then
        ok "$name started (PID $pid) → logs: $logfile"
    else
        err "$name failed to start — check $logfile"
        rm -f "$pidfile"
        return 1
    fi
}

_stop() {
    local name="$1" pidfile="$2"

    if ! is_running "$pidfile"; then
        warn "$name is not running"
        rm -f "$pidfile"
        return 0
    fi

    local pid
    pid=$(cat "$pidfile")
    echo -n "  Stopping $name (PID $pid)... "
    kill "$pid"

    local waited=0
    while kill -0 "$pid" 2>/dev/null && (( waited < 10 )); do
        sleep 1
        waited=$(( waited + 1 ))
    done

    if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
        warn "$name force-killed after ${waited}s"
    else
        ok "$name stopped"
    fi
    rm -f "$pidfile"
}

_status() {
    local name="$1" pidfile="$2"
    if is_running "$pidfile"; then
        ok "$name  running  (PID $(cat "$pidfile"))"
    elif [[ -f "$pidfile" ]]; then
        warn "$name  stale PID — was it killed externally?"
        rm -f "$pidfile"
    else
        err "$name  stopped"
    fi
}

# ── Service starters ──────────────────────────────────────────────────────────
start_api() {
    cd "$SCRIPT_DIR"
    _start "API    " "$API_PID" "$API_LOG" \
        uv run uvicorn conflux.api.main:app --host 0.0.0.0 --port 8001
}

start_worker() {
    cd "$SCRIPT_DIR"
    _start "Worker " "$WORKER_PID" "$WORKER_LOG" \
        uv run arq conflux.workers.WorkerSettings
}

start_ui() {
    local mode="${1:-dev}"   # dev | prod
    cd "$SCRIPT_DIR/ui"
    if [[ "$mode" == "prod" ]]; then
        _start "UI     " "$UI_PID" "$UI_LOG" bun run start
    else
        _start "UI     " "$UI_PID" "$UI_LOG" bun run dev
    fi
}

build_ui() {
    echo -e "\n${YELLOW}⚙  Building UI (bun run build)...${NC}"
    local BUILD_LOG="$LOG_DIR/build-ui.log"
    cd "$SCRIPT_DIR/ui"
    echo "  Build log → $BUILD_LOG"
    if bun run build > "$BUILD_LOG" 2>&1; then
        ok "UI built successfully"
    else
        err "UI build FAILED — check $BUILD_LOG"
        tail -20 "$BUILD_LOG"
        return 1
    fi
}

start_synapse() {
    local mode="${1:-dev}"
    cd /root/synapse

    if is_running "$SYNAPSE_PID"; then
        warn "Synapse already running (PID $(cat "$SYNAPSE_PID"))"
        return 0
    fi

    echo -n "  Starting Synapse... "
    local cmd
    if [[ "$mode" == "prod" ]]; then
        # Use vite binary directly — bun propagates SIGHUP which kills the process
        cmd="/root/synapse/node_modules/.bin/vite preview --host 0.0.0.0 --port 3001"
    else
        cmd="/root/synapse/node_modules/.bin/vite --host 0.0.0.0 --port 3001"
    fi

    nohup bash -c "cd /root/synapse && $cmd" </dev/null >> "$SYNAPSE_LOG" 2>&1 &
    local pid=$!
    disown $pid
    echo "$pid" > "$SYNAPSE_PID"
    sleep 3

    if is_running "$SYNAPSE_PID"; then
        ok "Synapse started (PID $pid) → logs: $SYNAPSE_LOG"
    else
        err "Synapse failed to start — check $SYNAPSE_LOG"
        rm -f "$SYNAPSE_PID"
        return 1
    fi
}

build_synapse() {
    echo -e "\n${YELLOW}⚙  Building Synapse (bun run build)...${NC}"
    local BUILD_LOG="$LOG_DIR/build-synapse.log"
    cd /root/synapse
    echo "  Build log → $BUILD_LOG"
    if bun run build > "$BUILD_LOG" 2>&1; then
        ok "Synapse built successfully"
    else
        err "Synapse build FAILED — check $BUILD_LOG"
        tail -20 "$BUILD_LOG"
        return 1
    fi
}

# ── Commands ──────────────────────────────────────────────────────────────────
cmd_start() {
    echo -e "\n${GREEN}▶ Starting Conflux${NC}"
    local mode="${2:-dev}"
    case "${1:-all}" in
        api)     start_api              ;;
        worker)  start_worker           ;;
        ui)      start_ui "$mode"       ;;
        synapse) start_synapse "$mode"  ;;
        all)     start_api; start_worker; start_ui "$mode"; start_synapse "$mode" ;;
        *)       usage; exit 1 ;;
    esac
    echo
}

cmd_stop() {
    echo -e "\n${RED}■ Stopping Conflux${NC}"
    case "${1:-all}" in
        api)     _stop "API    " "$API_PID"         ;;
        worker)  _stop "Worker " "$WORKER_PID"      ;;
        ui)      _stop "UI     " "$UI_PID"          ;;
        synapse) _stop "Synapse" "$SYNAPSE_PID"     ;;
        all)
            _stop "Synapse" "$SYNAPSE_PID"
            _stop "UI     " "$UI_PID"
            _stop "Worker " "$WORKER_PID"
            _stop "API    " "$API_PID"
            ;;
        *)       usage; exit 1 ;;
    esac
    echo
}

cmd_restart() {
    local svc="${1:-all}"
    local mode="${2:-dev}"
    cmd_stop  "$svc"
    sleep 1
    cmd_start "$svc" "$mode"
}

cmd_status() {
    echo -e "\n${YELLOW}● Conflux Service Status${NC}"
    case "${1:-all}" in
        api)     _status "API    " "$API_PID" ;;
        worker)  _status "Worker " "$WORKER_PID" ;;
        ui)      _status "UI     " "$UI_PID" ;;
        synapse) _status "Synapse" "$SYNAPSE_PID" ;;
        all)
            _status "API    " "$API_PID"
            _status "Worker " "$WORKER_PID"
            _status "UI     " "$UI_PID"
            _status "Synapse" "$SYNAPSE_PID"
            ;;
        *)       usage; exit 1 ;;
    esac
    echo -e "\n  Logs: $LOG_DIR"
    echo
}

cmd_logs() {
    local svc="${1:-all}"
    case "$svc" in
        api)     tail -f "$API_LOG" ;;
        worker)  tail -f "$WORKER_LOG" ;;
        ui)      tail -f "$UI_LOG" ;;
        synapse) tail -f "$SYNAPSE_LOG" ;;
        build)   tail -f "$LOG_DIR/build-ui.log" ;;
        all)     tail -f "$API_LOG" "$WORKER_LOG" "$UI_LOG" "$SYNAPSE_LOG" ;;
        *)       usage; exit 1 ;;
    esac
}

cmd_build() {
    echo -e "\n${GREEN}⚙  Build Conflux${NC}"
    case "${1:-all}" in
        ui)      build_ui ;;
        synapse) build_synapse ;;
        all)     build_ui; build_synapse ;;
        *)       usage; exit 1 ;;
    esac
    echo
}

cmd_redeploy() {
    local svc="${1:-all}"
    echo -e "\n${GREEN}⚡ Rebuild & redeploy Conflux${NC}"

    # 1. Build target services
    case "$svc" in
        ui)
            build_ui || exit 1
            ;;
        synapse)
            build_synapse || exit 1
            ;;
        all)
            build_ui || exit 1
            build_synapse || exit 1
            ;;
        *)  usage; exit 1 ;;
    esac

    # 2. Stop target services
    case "$svc" in
        ui)
            _stop "UI     " "$UI_PID"
            ;;
        synapse)
            _stop "Synapse" "$SYNAPSE_PID"
            ;;
        all)
            _stop "Synapse" "$SYNAPSE_PID"
            _stop "UI     " "$UI_PID"
            _stop "Worker " "$WORKER_PID"
            _stop "API    " "$API_PID"
            ;;
    esac
    sleep 1

    # 3. Start in production mode
    case "$svc" in
        ui)
            start_ui prod
            ;;
        synapse)
            start_synapse prod
            ;;
        all)
            start_api
            start_worker
            start_ui prod
            start_synapse prod
            ;;
    esac
    echo
}

usage() {
    echo "Usage: $0 {start|stop|restart|build|redeploy|status|logs} [api|worker|ui|synapse|all]"
    echo
    echo "  $0 start                 — start all services (dev mode)"
    echo "  $0 start api             — start API only"
    echo "  $0 start synapse         — start Synapse only"
    echo "  $0 stop                  — stop all services"
    echo "  $0 restart               — restart all services"
    echo "  $0 restart worker        — restart worker only"
    echo "  $0 build                 — build UI and Synapse for production"
    echo "  $0 build ui              — build UI for production (bun run build)"
    echo "  $0 build synapse         — build Synapse for production (bun run build)"
    echo "  $0 redeploy              — build UI + Synapse then restart all in production mode"
    echo "  $0 redeploy ui           — build & restart UI only"
    echo "  $0 redeploy synapse      — build & restart Synapse only"
    echo "  $0 status                — show service status"
    echo "  $0 status synapse        — show Synapse status"
    echo "  $0 logs                  — tail all logs"
    echo "  $0 logs ui               — tail UI log only"
    echo "  $0 logs synapse          — tail Synapse log only"
    echo "  $0 logs build            — tail last UI build log"
}

# ── Dispatch ──────────────────────────────────────────────────────────────────
case "${1:-}" in
    start)    cmd_start    "${2:-all}" "${3:-dev}" ;;
    stop)     cmd_stop     "${2:-all}" ;;
    restart)  cmd_restart  "${2:-all}" "${3:-dev}" ;;
    build)    cmd_build    "${2:-all}" ;;
    redeploy) cmd_redeploy "${2:-all}" ;;
    status)   cmd_status   "${2:-all}" ;;
    logs)     cmd_logs     "${2:-all}" ;;
    *)        usage; exit 1 ;;
esac
