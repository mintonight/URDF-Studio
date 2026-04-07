#!/usr/bin/env bash
set -euo pipefail

ROWS=2
COLS=5
REPO_NAME=$(basename "$(pwd)" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')
SESSION_NAME="omx-${REPO_NAME}"
WINDOW_NAME="omx-grid"
WORKDIR=$(pwd)
START_COMMAND="omx --madmax"
ATTACH=1
KILL_EXISTING=0
REUSE_EXISTING=0
KEEP_HUD=0
DRY_RUN=0

usage() {
  cat <<'USAGE'
Usage: scripts/omx_tmux_grid.sh [options]

Create one tmux window with a fixed 2x5 grid (10 panes) and optionally run a
command in every pane.

Options:
  --session NAME         tmux session name (default: omx-<repo-name>)
  --window NAME          tmux window name (default: omx-grid)
  --cwd PATH             working directory for every pane (default: current dir)
  --command CMD          command to run in every pane (default: omx --madmax)
  --reuse-existing       attach to the existing managed window instead of rebuilding it
  --keep-hud             preserve OMX auto-attached HUD panes instead of removing them
  --no-attach            create the session but do not attach to it
  --kill-existing        kill an existing session with the same name first
  --dry-run              print what would happen and exit
  -h, --help             show this help

Examples:
  bash scripts/omx_tmux_grid.sh
  bash scripts/omx_tmux_grid.sh --session urdf-omx --no-attach
  bash scripts/omx_tmux_grid.sh --command '' --kill-existing
USAGE
}

log() {
  printf '[omx-tmux] %s\n' "$*"
}

fail() {
  printf '[omx-tmux] ERROR: %s\n' "$*" >&2
  exit 1
}

attach_or_switch_session() {
  if [[ -n "${TMUX:-}" ]]; then
    log "Switching current tmux client to session: $SESSION_NAME"
    exec tmux switch-client -t "$SESSION_NAME"
  fi
  log "Attaching to tmux session: $SESSION_NAME"
  exec tmux attach-session -t "$SESSION_NAME"
}

window_exists() {
  tmux list-windows -t "$SESSION_NAME" -F '#{window_name}' 2>/dev/null | grep -Fxq "$WINDOW_NAME"
}

fresh_window_target() {
  printf '%s:%s' "$SESSION_NAME" "$WINDOW_NAME"
}

backup_session_name() {
  printf '%s-backup' "$SESSION_NAME"
}

kill_window_hud_panes() {
  local window_target="$1"
  local pane_id pane_start

  while IFS=$'\t' read -r pane_id pane_start; do
    if [[ "$pane_start" =~ omx.*hud.*--watch ]]; then
      tmux kill-pane -t "$pane_id"
    fi
  done < <(tmux list-panes -t "$window_target" -F '#{pane_id}\t#{pane_start_command}')
}

start_window_hud_cleanup_watch() {
  local window_target="$1"
  local polls="${OMX_TMUX_GRID_HUD_CLEANUP_POLLS:-120}"
  local interval="${OMX_TMUX_GRID_HUD_CLEANUP_INTERVAL:-0.25}"

  if ! [[ "$polls" =~ ^[0-9]+$ ]]; then
    polls=120
  fi

  if ! [[ "$interval" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    interval=0.25
  fi

  (
    for _ in $(seq 1 "$polls"); do
      kill_window_hud_panes "$window_target" || true
      sleep "$interval"
    done
  ) >/dev/null 2>&1 &
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --session)
      [[ $# -ge 2 ]] || fail "--session requires a value"
      SESSION_NAME="$2"
      shift 2
      ;;
    --window)
      [[ $# -ge 2 ]] || fail "--window requires a value"
      WINDOW_NAME="$2"
      shift 2
      ;;
    --cwd)
      [[ $# -ge 2 ]] || fail "--cwd requires a value"
      WORKDIR="$2"
      shift 2
      ;;
    --command)
      [[ $# -ge 2 ]] || fail "--command requires a value"
      START_COMMAND="$2"
      shift 2
      ;;
    --reuse-existing)
      REUSE_EXISTING=1
      shift
      ;;
    --keep-hud)
      KEEP_HUD=1
      shift
      ;;
    --no-attach)
      ATTACH=0
      shift
      ;;
    --kill-existing)
      KILL_EXISTING=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown option: $1"
      ;;
  esac
done

command -v tmux >/dev/null 2>&1 || fail "tmux is not installed or not in PATH"
[[ -d "$WORKDIR" ]] || fail "working directory does not exist: $WORKDIR"

if (( DRY_RUN )); then
  log "Would create tmux session '$SESSION_NAME' / window '$WINDOW_NAME'"
  log "Grid: ${ROWS} rows x ${COLS} cols (10 panes)"
  log "Working directory: $WORKDIR"
  log "Command per pane: ${START_COMMAND:-<none>}"
  log "Attach after create: $ATTACH"
  exit 0
fi

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  if (( KILL_EXISTING )); then
    log "Killing existing tmux session: $SESSION_NAME"
    tmux kill-session -t "$SESSION_NAME"
  elif (( REUSE_EXISTING )); then
    log "tmux session '$SESSION_NAME' already exists; reusing it"
    if (( ATTACH )); then
      attach_or_switch_session
    fi
    log "Session ready. Attach with: tmux attach -t $SESSION_NAME"
    exit 0
  else
    if window_exists; then
      fresh_window="__${WINDOW_NAME}-fresh-$(date +%Y%m%d-%H%M%S)"
      backup_session="$(backup_session_name)"
      backup_window="${WINDOW_NAME}-stale-$(date +%Y%m%d-%H%M%S)"
      log "Creating a temporary replacement window '$fresh_window' in session '$SESSION_NAME'"
      tmux new-window -d -t "$SESSION_NAME" -n "$fresh_window" -c "$WORKDIR"
      log "Backing up existing window '$WINDOW_NAME' -> '$backup_session:$backup_window'"
      tmux rename-window -t "$(fresh_window_target)" "$backup_window"
      if ! tmux has-session -t "$backup_session" 2>/dev/null; then
        log "Creating backup tmux session '$backup_session'"
        tmux new-session -d -s "$backup_session" -n "__backup_holding__" -c "$WORKDIR"
      fi
      tmux move-window -s "$SESSION_NAME:$backup_window" -t "$backup_session:"
      if tmux list-windows -t "$backup_session" -F '#{window_name}' | grep -Fxq "__backup_holding__"; then
        backup_window_count=$(tmux list-windows -t "$backup_session" | wc -l | tr -d ' ')
        if (( backup_window_count > 1 )); then
          tmux kill-window -t "$backup_session:__backup_holding__"
        fi
      fi
      tmux rename-window -t "$SESSION_NAME:$fresh_window" "$WINDOW_NAME"
    else
      log "Creating a fresh managed window '$WINDOW_NAME' in existing session '$SESSION_NAME'"
      tmux new-window -d -t "$SESSION_NAME" -n "$WINDOW_NAME" -c "$WORKDIR"
    fi
  fi
fi

if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  log "Creating tmux session '$SESSION_NAME' in $WORKDIR"
  tmux new-session -d -s "$SESSION_NAME" -n "$WINDOW_NAME" -c "$WORKDIR"
fi

target_window="$(fresh_window_target)"
first_pane=$(tmux list-panes -t "$target_window" -F '#{pane_id}' | head -n 1)
top_panes=("$first_pane")
current_pane="$first_pane"

for ((i = 1; i < COLS; i++)); do
  new_pane=$(tmux split-window -h -t "$current_pane" -c "$WORKDIR" -P -F '#{pane_id}')
  top_panes+=("$new_pane")
  current_pane="$new_pane"
done

tmux select-layout -t "$target_window" even-horizontal

all_panes=("${top_panes[@]}")
for pane_id in "${top_panes[@]}"; do
  new_pane=$(tmux split-window -v -t "$pane_id" -c "$WORKDIR" -P -F '#{pane_id}')
  all_panes+=("$new_pane")
done

for pane_id in "${all_panes[@]}"; do
  if [[ -n "$START_COMMAND" ]]; then
    tmux send-keys -t "$pane_id" "$START_COMMAND" C-m
  fi
done

if (( !KEEP_HUD )) && [[ "$START_COMMAND" == *"omx"* ]]; then
  # OMX can spawn HUD panes several seconds after the leader command starts,
  # so keep sweeping in the background instead of declaring victory after a
  # brief quiet period.
  start_window_hud_cleanup_watch "$target_window"
fi

tmux select-pane -t "${top_panes[0]}"
tmux select-window -t "$target_window"

log "Created ${#all_panes[@]} panes in session '$SESSION_NAME'"
if (( ATTACH )); then
  attach_or_switch_session
fi

log "Session ready. Attach with: tmux attach -t $SESSION_NAME"
