#!/bin/bash
# df-input.sh — Inject clicks and keystrokes into the live DragonFruit window.
#
# Intended for an AI agent (Claude) running in dev hot-reload. macOS only.
# Requires cliclick: brew install cliclick.
#
# Usage:
#   scripts/df-input.sh click X Y
#   scripts/df-input.sh dblclick X Y
#   scripts/df-input.sh rclick X Y
#   scripts/df-input.sh move X Y
#   scripts/df-input.sh drag X1 Y1 X2 Y2
#   scripts/df-input.sh key COMBO         (e.g. cmd+s, esc, shift+r, a,b,c)
#   scripts/df-input.sh type TEXT
#   scripts/df-input.sh --help
#
# Exit codes:
#   0  succeeded
#   1  not running on macOS
#   2  DragonFruit not running
#   5  cliclick not installed
#   6  input validation failed
#   7  cliclick runtime error
#
# Coordinates are logical points; same coordinate space as scripts/df-snap.sh.

set -euo pipefail

PROG="df-input"
log() { printf '[%s] %s\n' "$PROG" "$*" >&2; }

print_help() {
    cat <<'EOF'
df-input — inject clicks and keystrokes into the DragonFruit window

Usage:
  scripts/df-input.sh click X Y                Single left click
  scripts/df-input.sh dblclick X Y             Double left click
  scripts/df-input.sh rclick X Y               Right click (reproduces #55)
  scripts/df-input.sh move X Y                 Move cursor without clicking
  scripts/df-input.sh drag X1 Y1 X2 Y2         Left-button drag
  scripts/df-input.sh key COMBO                Keystroke or chord
  scripts/df-input.sh type TEXT                Type a literal string

Key combo syntax:
  Chords:    cmd+s, shift+esc, ctrl+alt+a, fn+f1
  Sequences: a,b,c (press a, then b, then c — no modifiers)
  Cannot mix '+' and ',' in one combo.
  Allowed modifiers: cmd, alt, ctrl, shift, fn.
  Punctuation chords (cmd+,) are NOT supported via 'key' in v1 — use 'type' for
  literal punctuation, or use a function-key alternative.

Type constraints:
  Max 256 bytes; control characters (newlines, CR, tabs, etc.) rejected.

Coordinates are logical points; same coordinate space as df-snap.sh.

Example:
  scripts/df-input.sh click 240 120
  scripts/df-input.sh key cmd+s            # save
  scripts/df-input.sh type "hello world"

Exit codes:
  0  succeeded
  1  not running on macOS
  2  DragonFruit not running
  5  cliclick not installed
  6  input validation failed
  7  cliclick runtime error
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    print_help
    exit 0
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
    log "df-input is macOS-only (uname -s = $(uname -s))"
    exit 1
fi

if [[ $# -eq 0 ]]; then
    print_help >&2
    exit 6
fi

require_int() {
    local name="$1" value="$2"
    if [[ ! "$value" =~ ^-?[0-9]+$ ]]; then
        log "$name must be an integer, got: '$value'"
        exit 6
    fi
}

# run_cliclick is called only after subcommand args are fully validated. It
# checks cliclick presence and that DragonFruit is actually running before
# activating — `tell app to activate` would otherwise auto-launch the app via
# LaunchServices.
run_cliclick() {
    if ! command -v cliclick >/dev/null 2>&1; then
        log "cliclick not found. Install with: brew install cliclick"
        exit 5
    fi
    if ! pgrep -x DragonFruit >/dev/null 2>&1 && ! pgrep -x dragonfruit-desktop >/dev/null 2>&1; then
        log "DragonFruit is not running. Start with: npm run tauri:dev"
        exit 2
    fi
    osascript -e 'tell application "System Events" to set frontmost of (first process whose name is "DragonFruit" or name is "dragonfruit-desktop") to true' >/dev/null 2>&1 || true
    if ! cliclick "$@"; then
        log "cliclick failed. If the app does not respond, grant Accessibility AND Input Monitoring permission to your terminal in System Settings → Privacy & Security, then retry."
        exit 7
    fi
}

# Parse a chord like "cmd+s" or "shift+ctrl+esc" into the global arrays
# CHORD_MODS (modifiers in order) and CHORD_KEY (the key name). Exits 6 on
# malformed input. Validation must run before arg-building so that exit codes
# propagate from the main shell, not a subshell.
parse_chord() {
    local combo="$1"
    local IFS='+'
    # shellcheck disable=SC2206 -- intentional word-splitting on +
    local parts=($combo)
    local n=${#parts[@]}
    # bash IFS-splitting drops a trailing empty field, so "cmd+" yields n=1.
    # Treat that and any explicit empty key as a missing-key error.
    if [[ $n -lt 2 || -z "${parts[n-1]:-}" ]]; then
        log "key combo trailing '+' has no key, got: '$combo'"
        exit 6
    fi
    CHORD_KEY="${parts[n-1]}"
    CHORD_MODS=()
    local i
    for ((i = 0; i < n - 1; i++)); do
        local m="${parts[i]}"
        case "$m" in
            cmd|alt|ctrl|shift|fn) CHORD_MODS+=("$m") ;;
            *) log "unknown modifier '$m'; allowed: cmd, alt, ctrl, shift, fn"; exit 6 ;;
        esac
    done
}

# After parse_chord, build the cliclick arg array CHORD_ARGS:
#   kd:m1 kd:m2 ... kp:key ku:m2 ku:m1
build_chord_args() {
    CHORD_ARGS=()
    local m
    for m in "${CHORD_MODS[@]}"; do CHORD_ARGS+=("kd:$m"); done
    CHORD_ARGS+=("kp:$CHORD_KEY")
    local i
    for ((i = ${#CHORD_MODS[@]} - 1; i >= 0; i--)); do
        CHORD_ARGS+=("ku:${CHORD_MODS[i]}")
    done
}

# Build cliclick args for a drag from (x1,y1) to (x2,y2) into DRAG_ARGS.
# Emits dd:start, several interpolated dm: points, du:end, with brief wait:5
# events to give the UI time to register pointermove events.
build_drag_args() {
    local x1=$1 y1=$2 x2=$3 y2=$4
    local steps=8
    DRAG_ARGS=("dd:$x1,$y1" "wait:5")
    local i
    for ((i = 1; i < steps; i++)); do
        local x=$(( x1 + (x2 - x1) * i / steps ))
        local y=$(( y1 + (y2 - y1) * i / steps ))
        DRAG_ARGS+=("dm:$x,$y" "wait:5")
    done
    DRAG_ARGS+=("du:$x2,$y2")
}

SUBCOMMAND="$1"
shift

case "$SUBCOMMAND" in
    click)
        [[ $# -eq 2 ]] || { log "click requires X Y"; exit 6; }
        require_int X "$1"
        require_int Y "$2"
        run_cliclick "c:$1,$2"
        ;;
    dblclick)
        [[ $# -eq 2 ]] || { log "dblclick requires X Y"; exit 6; }
        require_int X "$1"
        require_int Y "$2"
        run_cliclick "dc:$1,$2"
        ;;
    rclick)
        [[ $# -eq 2 ]] || { log "rclick requires X Y"; exit 6; }
        require_int X "$1"
        require_int Y "$2"
        run_cliclick "rc:$1,$2"
        ;;
    move)
        [[ $# -eq 2 ]] || { log "move requires X Y"; exit 6; }
        require_int X "$1"
        require_int Y "$2"
        run_cliclick "m:$1,$2"
        ;;
    drag)
        [[ $# -eq 4 ]] || { log "drag requires X1 Y1 X2 Y2"; exit 6; }
        require_int X1 "$1"
        require_int Y1 "$2"
        require_int X2 "$3"
        require_int Y2 "$4"
        build_drag_args "$1" "$2" "$3" "$4"
        run_cliclick "${DRAG_ARGS[@]}"
        ;;
    key)
        [[ $# -eq 1 ]] || { log "key requires COMBO"; exit 6; }
        COMBO="$1"
        if [[ ! "$COMBO" =~ ^[a-zA-Z0-9+,_-]+$ ]]; then
            log "key combo must match [a-zA-Z0-9+,_-]+, got: '$COMBO'"
            exit 6
        fi
        if [[ "$COMBO" == *+* && "$COMBO" == *,* ]]; then
            log "key combo cannot mix chord '+' and sequence ',', got: '$COMBO'"
            exit 6
        fi
        if [[ "$COMBO" == *+* ]]; then
            # Chord — validate then emit kd: ... kp: ... ku: ... events.
            parse_chord "$COMBO"
            build_chord_args
            run_cliclick "${CHORD_ARGS[@]}"
        else
            # Single key or comma-separated sequence — pass to cliclick kp:.
            run_cliclick "kp:$COMBO"
        fi
        ;;
    type)
        [[ $# -eq 1 ]] || { log "type requires TEXT"; exit 6; }
        TEXT="$1"
        if [[ ${#TEXT} -gt 256 ]]; then
            log "type text exceeds 256 bytes (got ${#TEXT})"
            exit 6
        fi
        if [[ "$TEXT" =~ [[:cntrl:]] ]]; then
            log "type text contains control characters; only printable input is allowed"
            exit 6
        fi
        # TEXT is a single argv element to cliclick — bash double-quoting around
        # "$TEXT" preserves its literal contents without further expansion.
        run_cliclick "t:$TEXT"
        ;;
    *)
        log "unknown subcommand: '$SUBCOMMAND'. See --help."
        exit 6
        ;;
esac
