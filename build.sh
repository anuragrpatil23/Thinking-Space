#!/usr/bin/env bash
set -euo pipefail

# ─── Thinking Space Build Script ─────────────────────────────────────────────
# Usage: ./build.sh [command]
#
# Commands:
#   dev              Start frontend dev server (default)
#   web              Build web/PWA bundle
#   electron         Build & launch Electron app
#   electron:pack    Package Electron app (unpacked, for testing)
#   mac              Package Electron .dmg for macOS
#   win              Package Electron .nsis for Windows
#   win-lite         Package Windows x64 without embedded terminal
#   linux            Package Electron .AppImage for Linux
#   ios              Build for iOS and open Xcode
#   backend          Start FastAPI backend dev server
#   typecheck        Run TypeScript type check only (no build)
#   test             Run frontend tests
#   test:watch       Run frontend tests in watch mode
#   clean            Remove build artifacts
#   install          Install all dependencies
#   help             Show this help message

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
ELECTRON_DIR="$FRONTEND_DIR/electron"
BACKEND_DIR="$ROOT_DIR/backend"

# ─── Colors ──────────────────────────────────────────────────────────────────
R='\033[0;31m'   # red
G='\033[0;32m'   # green
B='\033[0;34m'   # blue
Y='\033[0;33m'   # yellow
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# ─── Spinner ──────────────────────────────────────────────────────────────────
_SPIN_FRAMES=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏)
_spin_pid=""
_spin_label=""
_spin_start=0
_build_start=0

_start_spinner() {
  _spin_label="$1"
  _spin_start=$(date +%s)
  local start=$_spin_start label=$_spin_label
  (
    i=0
    while true; do
      elapsed=$(( $(date +%s) - start ))
      frame=${_SPIN_FRAMES[$((i % 10))]}
      printf "\r  \033[0;34m%s\033[0m  %-26s \033[2m%ds\033[0m  " "$frame" "$label" "$elapsed"
      sleep 0.08
      i=$(( i + 1 ))
    done
  ) &
  _spin_pid=$!
}

_stop_spinner() {
  local ok="$1"   # 0 = success, 1 = failure
  local elapsed=$(( $(date +%s) - _spin_start ))
  if [ -n "$_spin_pid" ]; then
    kill "$_spin_pid" 2>/dev/null || true
    wait "$_spin_pid" 2>/dev/null || true
    _spin_pid=""
  fi
  if [ "$ok" = "0" ]; then
    printf "\r  ${G}✓${NC}  %-26s ${DIM}%ds${NC}\n" "$_spin_label" "$elapsed"
  else
    printf "\r  ${R}✗${NC}  %-26s ${R}failed${NC}  ${DIM}%ds${NC}\n" "$_spin_label" "$elapsed"
  fi
}

# Clean up spinner on exit / interrupt
_on_exit() {
  if [ -n "$_spin_pid" ]; then
    kill "$_spin_pid" 2>/dev/null || true
    wait "$_spin_pid" 2>/dev/null || true
    echo ""
  fi
}
trap _on_exit EXIT INT TERM

# ─── Output noise filter ──────────────────────────────────────────────────────
_NOISE='^> [a-z@]|^Unable to find node_modules|Are you sure .* is installed\?|^dist\/assets\/|dynamic import will not move|Some chunks are larger|Consider:$|- Using dynamic import|- Use build\.rollup|- Adjust chunk size|@electron\/rebuild already|To ensure your native|simply add.*postinstall|executing @electron|preparing.*node-pty|finished.*node-pty|installing native dep|^\s*•\s*(electron-builder|loaded config|packaging|signing|skipped|building block|Detected arm64|writing effective|@electron\/rebuild already)|^[[:space:]]*$'

# ─── Step runner ─────────────────────────────────────────────────────────────
# do_step "Label" cmd [args...]
#   Runs cmd with a live spinner. On failure, dumps filtered error output.
do_step() {
  local label="$1"; shift

  _start_spinner "$label"

  local tmp exit_code=0
  tmp=$(mktemp)
  "$@" >"$tmp" 2>&1 || exit_code=$?

  _stop_spinner "$exit_code"

  if [ $exit_code -ne 0 ]; then
    local filtered
    filtered=$(grep -Ev "$_NOISE" "$tmp" 2>/dev/null || true)
    if [ -n "$filtered" ]; then
      echo "$filtered" | sed 's/^/     /'
    else
      sed 's/^/     /' "$tmp"
    fi
    rm -f "$tmp"
    echo ""
    return 1
  fi

  rm -f "$tmp"
}

# ─── Helpers ─────────────────────────────────────────────────────────────────
ok()  { echo -e "  ${G}✓${NC}  $*"; }
err() { echo -e "  ${R}✗${NC}  $*" >&2; }

_total_time() {
  local elapsed=$(( $(date +%s) - _build_start ))
  if [ $elapsed -ge 60 ]; then
    printf "%dm %ds" $(( elapsed / 60 )) $(( elapsed % 60 ))
  else
    printf "%ds" "$elapsed"
  fi
}

_divider() {
  printf "  ${DIM}%-46s${NC}\n" "──────────────────────────────────────────────"
}

# ─── Dependency checks ────────────────────────────────────────────────────────
check_node()   { command -v node   &>/dev/null || { err "Node.js not found — https://nodejs.org"; exit 1; }; }
check_npm()    { command -v npm    &>/dev/null || { err "npm not found — https://nodejs.org"; exit 1; }; }
check_poetry() { command -v poetry &>/dev/null || { err "Poetry not found — https://python-poetry.org"; exit 1; }; }

ensure_frontend_deps() {
  [ -d "$FRONTEND_DIR/node_modules" ] && return
  do_step "Install frontend deps" npm --prefix "$FRONTEND_DIR" install
}

ensure_electron_deps() {
  [ -d "$ELECTRON_DIR/node_modules" ] && return
  do_step "Install electron deps" npm --prefix "$ELECTRON_DIR" install
}

# ─── Core build steps ─────────────────────────────────────────────────────────

_build_frontend() {
  # Refresh the AI cost rate table before bundling, so a build never ships a
  # stale price. This lives here, not in an npm `prebuild` hook: build.sh calls
  # `npx vite build` directly and never goes through `npm run build*`, so no
  # lifecycle hook fires on this path — the Mac ship silently built without the
  # step twice before this was caught. `_build_frontend` is the one function
  # every packaging target routes through, so one insertion covers them all.
  # The script tolerates being offline and never mutates held overrides.
  do_step "Sync AI prices" \
    bash -c "[ \"\$PRICES_CHECK\" = off ] || node '$ROOT_DIR/scripts/refresh-ai-prices.mjs' --build"

  do_step "Sync fonts" \
    node "$FRONTEND_DIR/scripts/syncExcalidrawFonts.mjs"

  do_step "Vite build" \
    bash -c "cd '$FRONTEND_DIR' && BUILD_TARGET=electron npx vite build --logLevel warn"

  do_step "Capacitor sync" \
    bash -c "cd '$FRONTEND_DIR' && npx cap sync @capacitor-community/electron"
}

_build_electron_main() {
  do_step "Electron compile" \
    bash -c "cd '$ELECTRON_DIR' && npx tsc"

  do_step "Native rebuild" \
    bash -c "cd '$ELECTRON_DIR' && npx electron-rebuild -f"
}

# ─── Commands ─────────────────────────────────────────────────────────────────

cmd_dev() {
  check_node && check_npm
  ensure_frontend_deps
  (cd "$FRONTEND_DIR" && npm run dev)
}

cmd_web() {
  check_node && check_npm
  ensure_frontend_deps
  _build_start=$(date +%s)
  echo ""
  echo -e "  ${BOLD}Thinking Space${NC}  ${DIM}›  web build${NC}"
  echo ""
  do_step "Sync fonts"  node "$FRONTEND_DIR/scripts/syncExcalidrawFonts.mjs"
  do_step "Type check"  bash -c "cd '$FRONTEND_DIR' && npx tsc --noEmit"
  do_step "Vite build"  bash -c "cd '$FRONTEND_DIR' && npx vite build --logLevel warn"
  echo ""
  _divider
  ok "frontend/dist/  ${DIM}in $(_total_time)${NC}"
  echo ""
}

cmd_electron() {
  check_node && check_npm
  ensure_frontend_deps
  ensure_electron_deps
  (cd "$FRONTEND_DIR" && npm run electron:dev)
}

cmd_electron_pack() {
  check_node && check_npm
  ensure_frontend_deps
  ensure_electron_deps
  _build_start=$(date +%s)
  echo ""
  echo -e "  ${BOLD}Thinking Space${NC}  ${DIM}›  electron pack${NC}"
  echo ""
  _build_frontend
  _build_electron_main
  do_step "Pack (unpacked)" \
    bash -c "cd '$ELECTRON_DIR' && npx electron-builder build --dir --publish never -c electron-builder.config.json"
  echo ""
  _divider
  ok "electron/dist/  ${DIM}in $(_total_time)${NC}"
  echo ""
}

_cmd_platform() {
  local eb_flag="$1" label="$2" artifact_glob="$3"

  check_node && check_npm
  ensure_frontend_deps
  ensure_electron_deps
  _build_start=$(date +%s)
  echo ""
  echo -e "  ${BOLD}Thinking Space${NC}  ${DIM}›  ${label} build${NC}"
  echo ""
  _build_frontend
  _build_electron_main
  do_step "Package" \
    bash -c "cd '$ELECTRON_DIR' && npx electron-builder build $eb_flag --publish never -c electron-builder.config.json"
  echo ""
  _divider
  local artifact
  artifact=$(ls "$ELECTRON_DIR/dist/"${artifact_glob} 2>/dev/null | head -1 || true)
  if [ -n "$artifact" ]; then
    ok "${BOLD}$(basename "$artifact")${NC}  ${DIM}in $(_total_time)${NC}"
  else
    ok "electron/dist/  ${DIM}in $(_total_time)${NC}"
  fi
  echo ""
}

cmd_mac()   { _cmd_platform "--mac"   "macOS"   "*.dmg"; }
# --x64 is explicit: electron-builder defaults to the HOST arch, so on an
# Apple Silicon Mac a bare `--win` silently produces a Windows-on-ARM
# installer. It builds and packages cleanly, so nothing looks wrong — it is
# just unusable for the x64 machines that are almost all Windows users, and
# the only tell is `-arm64` in a filename nobody reads before uploading.
# cmd_win_lite below has always passed --x64 for this reason.
cmd_win()   { _cmd_platform "--win --x64" "Windows" "*.exe"; }
cmd_linux() { _cmd_platform "--linux" "Linux"   "*.AppImage"; }

cmd_win_lite() {
  check_node && check_npm
  ensure_frontend_deps
  ensure_electron_deps
  _build_start=$(date +%s)
  echo ""
  echo -e "  ${BOLD}Thinking Space${NC}  ${DIM}›  Windows x64 lite build${NC}"
  echo ""
  _build_frontend
  do_step "Electron compile (lite)" \
    bash -c "cd '$ELECTRON_DIR' && THINKING_SPACE_ENABLE_TERMINAL=false npx tsc"
  do_step "Package (lite)" \
    bash -c "cd '$ELECTRON_DIR' && npx electron-builder build --win --x64 --publish never -c.npmRebuild=false -c.nodeGypRebuild=false -c electron-builder.win-lite.config.cjs"
  echo ""
  _divider
  local artifact
  artifact=$(ls "$ELECTRON_DIR/dist/"*.exe 2>/dev/null | head -1 || true)
  if [ -n "$artifact" ]; then
    ok "${BOLD}$(basename "$artifact")${NC}  ${DIM}in $(_total_time)${NC}"
  else
    ok "electron/dist/  ${DIM}in $(_total_time)${NC}"
  fi
  echo ""
}

cmd_ios() {
  check_node && check_npm
  ensure_frontend_deps
  _build_start=$(date +%s)
  echo ""
  echo -e "  ${BOLD}Thinking Space${NC}  ${DIM}›  iOS build${NC}"
  echo ""
  do_step "Sync fonts" \
    node "$FRONTEND_DIR/scripts/syncExcalidrawFonts.mjs"
  do_step "Vite build" \
    bash -c "cd '$FRONTEND_DIR' && BUILD_TARGET=capacitor npx vite build --logLevel warn"
  do_step "Capacitor iOS sync" \
    bash -c "cd '$FRONTEND_DIR' && npx cap sync ios"
  do_step "Open Xcode" \
    bash -c "cd '$FRONTEND_DIR' && npx cap open ios"
  echo ""
  _divider
  ok "Xcode open  ${DIM}in $(_total_time)${NC}"
  echo ""
}

cmd_backend() {
  check_poetry
  (cd "$BACKEND_DIR" && poetry run uvicorn app.main:app --reload --port 8000)
}

cmd_typecheck() {
  check_node && check_npm
  ensure_frontend_deps
  _build_start=$(date +%s)
  echo ""
  echo -e "  ${BOLD}Thinking Space${NC}  ${DIM}›  type check${NC}"
  echo ""
  do_step "Frontend" bash -c "cd '$FRONTEND_DIR' && npx tsc --noEmit"
  do_step "Electron" bash -c "cd '$ELECTRON_DIR' && npx tsc --noEmit"
  echo ""
  _divider
  ok "No type errors  ${DIM}in $(_total_time)${NC}"
  echo ""
}

cmd_test() {
  check_node && check_npm
  ensure_frontend_deps
  (cd "$FRONTEND_DIR" && npm test)
}

cmd_test_watch() {
  check_node && check_npm
  ensure_frontend_deps
  (cd "$FRONTEND_DIR" && npm run test:watch)
}

cmd_clean() {
  echo ""
  do_step "Clean artifacts" \
    rm -rf "$FRONTEND_DIR/dist" "$ELECTRON_DIR/build" "$ELECTRON_DIR/dist" "$ELECTRON_DIR/app"
  echo ""
  ok "Clean complete"
  echo ""
}

cmd_install() {
  check_node && check_npm
  _build_start=$(date +%s)
  echo ""
  echo -e "  ${BOLD}Thinking Space${NC}  ${DIM}›  install${NC}"
  echo ""
  do_step "Frontend" npm --prefix "$FRONTEND_DIR" install
  do_step "Electron" npm --prefix "$ELECTRON_DIR" install
  if [ -d "$BACKEND_DIR" ] && command -v poetry &>/dev/null; then
    do_step "Backend" bash -c "cd '$BACKEND_DIR' && poetry install"
  fi
  echo ""
  _divider
  ok "All dependencies installed  ${DIM}in $(_total_time)${NC}"
  echo ""
}

cmd_help() {
  echo ""
  echo -e "  ${BOLD}Thinking Space${NC}"
  echo ""
  echo "  Usage: ./build.sh <command>"
  echo ""
  printf "  ${DIM}%-18s  %s${NC}\n" "Command" "Description"
  _divider
  printf "  %-18s  %s\n" "dev"           "Start frontend dev server"
  printf "  %-18s  %s\n" "web"           "Build web/PWA bundle"
  printf "  %-18s  %s\n" "electron"      "Build & launch Electron app"
  printf "  %-18s  %s\n" "electron:pack" "Package app unpacked (for testing)"
  printf "  %-18s  %s\n" "mac"           "Package .dmg for macOS"
  printf "  %-18s  %s\n" "win"           "Package .exe for Windows"
  printf "  %-18s  %s\n" "win-lite"      "Package x64 Windows build without terminal"
  printf "  %-18s  %s\n" "linux"         "Package .AppImage for Linux"
  printf "  %-18s  %s\n" "ios"           "Build for iOS and open Xcode"
  printf "  %-18s  %s\n" "backend"       "Start FastAPI backend dev server"
  printf "  %-18s  %s\n" "typecheck"     "Run TypeScript type check (no build)"
  printf "  %-18s  %s\n" "test"          "Run frontend tests"
  printf "  %-18s  %s\n" "test:watch"    "Run tests in watch mode"
  printf "  %-18s  %s\n" "clean"         "Remove build artifacts"
  printf "  %-18s  %s\n" "install"       "Install all dependencies"
  printf "  %-18s  %s\n" "help"          "Show this message"
  echo ""
}

# ─── Entrypoint ───────────────────────────────────────────────────────────────

COMMAND="${1:-dev}"

case "$COMMAND" in
  dev)            cmd_dev ;;
  web)            cmd_web ;;
  electron)       cmd_electron ;;
  electron:pack)  cmd_electron_pack ;;
  mac)            cmd_mac ;;
  win)            cmd_win ;;
  win-lite)       cmd_win_lite ;;
  linux)          cmd_linux ;;
  ios)            cmd_ios ;;
  backend)        cmd_backend ;;
  typecheck)      cmd_typecheck ;;
  test)           cmd_test ;;
  test:watch)     cmd_test_watch ;;
  clean)          cmd_clean ;;
  install)        cmd_install ;;
  help|--help|-h) cmd_help ;;
  *)
    err "Unknown command: $COMMAND"
    cmd_help
    exit 1
    ;;
esac
