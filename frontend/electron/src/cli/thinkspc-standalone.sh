#!/usr/bin/env bash
# thinkspc-standalone — Standalone CLI wrapper bundled with the Electron app.
# Installed automatically on first packaged launch, or via the Electron app menu.
#
# This script resolves the bundled app's resources and runs the bundled capability
# runner using the app's embedded Electron runtime in Node mode.

set -euo pipefail

# ── Resolve the Electron app resources directory ──

resolve_app_resources() {
  # 1. If THINKSPC_APP_RESOURCES is explicitly set, use it
  if [ -n "${THINKSPC_APP_RESOURCES:-}" ]; then
    echo "$THINKSPC_APP_RESOURCES"
    return
  fi

  # 2. macOS: look for the .app bundle in standard locations
  if [ "$(uname)" = "Darwin" ]; then
    local app_candidates=(
      "/Applications/Thinking Space.app"
      "$HOME/Applications/Thinking Space.app"
    )
    for app_path in "${app_candidates[@]}"; do
      local resources_path="$app_path/Contents/Resources"
      if [ -d "$resources_path/cli" ]; then
        echo "$resources_path"
        return
      fi
    done
  fi

  # 3. Linux: check common install paths
  if [ "$(uname)" = "Linux" ]; then
    local linux_candidates=(
      "/opt/Thinking Space/resources"
      "/usr/lib/thinking-space/resources"
      "$HOME/.local/share/Thinking Space/resources"
    )
    for resources_path in "${linux_candidates[@]}"; do
      if [ -d "$resources_path/cli" ]; then
        echo "$resources_path"
        return
      fi
    done
  fi

  echo "Error: Could not find Thinking Space app resources." >&2
  echo "Set THINKSPC_APP_RESOURCES to the app's Resources directory." >&2
  exit 1
}

APP_RESOURCES="$(resolve_app_resources)"
CLI_DIR="$APP_RESOURCES/cli"

resolve_node_platform() {
  if [ -n "${THINKSPC_NODE_PLATFORM:-}" ]; then
    echo "$THINKSPC_NODE_PLATFORM"
    return
  fi

  case "$(uname -s)" in
    Darwin)
      echo "darwin"
      ;;
    Linux)
      echo "linux"
      ;;
    *)
      echo ""
      ;;
  esac
}

resolve_node_arch() {
  if [ -n "${THINKSPC_NODE_ARCH:-}" ]; then
    echo "$THINKSPC_NODE_ARCH"
    return
  fi

  case "$(uname -m)" in
    arm64|aarch64)
      echo "arm64"
      ;;
    x86_64|amd64)
      echo "x64"
      ;;
    *)
      echo ""
      ;;
  esac
}

resolve_node_cache_root() {
  if [ -n "${THINKSPC_NODE_CACHE_DIR:-}" ]; then
    echo "$THINKSPC_NODE_CACHE_DIR"
    return
  fi

  if [ "$(uname -s)" = "Darwin" ]; then
    echo "$HOME/Library/Caches/thinkspc"
    return
  fi

  if [ -n "${XDG_CACHE_HOME:-}" ]; then
    echo "$XDG_CACHE_HOME/thinkspc"
    return
  fi

  echo "$HOME/.cache/thinkspc"
}

fetch_url_to_file() {
  local url="$1"
  local output_path="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$output_path"
    return
  fi

  if command -v wget >/dev/null 2>&1; then
    wget -qO "$output_path" "$url"
    return
  fi

  if command -v python3 >/dev/null 2>&1; then
    python3 - "$url" "$output_path" <<'PY'
import sys
import urllib.request

urllib.request.urlretrieve(sys.argv[1], sys.argv[2])
PY
    return
  fi

  echo "Error: Could not download Node.js runtime (missing curl, wget, and python3)." >&2
  exit 1
}

ensure_cached_node_exec() {
  local node_version="${THINKSPC_NODE_VERSION:-v22.14.0}"
  local node_platform
  node_platform="$(resolve_node_platform)"
  local node_arch
  node_arch="$(resolve_node_arch)"

  if [ -z "$node_platform" ] || [ -z "$node_arch" ]; then
    return 1
  fi

  local cache_root
  cache_root="$(resolve_node_cache_root)"
  local install_root="$cache_root/node/$node_version/$node_platform-$node_arch"
  local node_exec="$install_root/bin/node"
  local lock_dir="$install_root.lock"

  if [ -x "$node_exec" ]; then
    echo "$node_exec"
    return 0
  fi

  mkdir -p "$cache_root/node/$node_version"
  local acquired_lock=0
  if mkdir "$lock_dir" 2>/dev/null; then
    acquired_lock=1
    trap 'if [ "$acquired_lock" -eq 1 ]; then rmdir "$lock_dir" >/dev/null 2>&1 || true; fi' RETURN

    local archive_name="node-$node_version-$node_platform-$node_arch.tar.gz"
    local download_url="${THINKSPC_NODE_DOWNLOAD_URL:-${THINKSPC_NODE_DIST_BASE_URL:-https://nodejs.org/dist}/$node_version/$archive_name}"
    local temp_root
    temp_root="$(mktemp -d "${TMPDIR:-/tmp}/thinkspc-node.XXXXXX")"
    local archive_path="$temp_root/$archive_name"
    local extract_root="$temp_root/extracted"
    local staged_root="$install_root.tmp.$$"
    local extracted_dir="$extract_root/node-$node_version-$node_platform-$node_arch"

    mkdir -p "$extract_root"
    echo "thinkspc: downloading Node.js $node_version for $node_platform-$node_arch..." >&2
    fetch_url_to_file "$download_url" "$archive_path"
    tar -xzf "$archive_path" -C "$extract_root"

    if [ ! -x "$extracted_dir/bin/node" ]; then
      echo "Error: Downloaded Node.js runtime did not contain bin/node at $extracted_dir/bin/node" >&2
      rm -rf "$temp_root"
      return 1
    fi

    rm -rf "$staged_root"
    mkdir -p "$(dirname "$staged_root")"
    mv "$extracted_dir" "$staged_root"
    chmod 755 "$staged_root/bin/node"
    rm -rf "$install_root"
    mv "$staged_root" "$install_root"
    rm -rf "$temp_root"
    echo "thinkspc: cached Node.js runtime at $node_exec" >&2
  else
    local wait_count=0
    while [ -d "$lock_dir" ] && [ "$wait_count" -lt 120 ]; do
      sleep 1
      wait_count=$((wait_count + 1))
    done
  fi

  if [ -x "$node_exec" ]; then
    echo "$node_exec"
    return 0
  fi

  return 1
}

resolve_node_exec() {
  if [ -n "${THINKSPC_NODE_EXEC:-}" ]; then
    echo "$THINKSPC_NODE_EXEC"
    return
  fi

  local bundled_node="$CLI_DIR/bin/node"
  local bundled_node_windows="$CLI_DIR/bin/node.exe"
  if [ -x "$bundled_node" ]; then
    echo "$bundled_node"
    return
  fi
  if [ -x "$bundled_node_windows" ]; then
    echo "$bundled_node_windows"
    return
  fi

  if cached_node="$(ensure_cached_node_exec)"; then
    echo "$cached_node"
    return
  fi

  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi

  case "$(uname)" in
    Linux)
      :
      ;;
  esac

  echo "Error: Could not resolve a runtime for thinkspc." >&2
  echo "Expected a cached or bundled Node runtime, or a system node on PATH." >&2
  echo "Set THINKSPC_NODE_EXEC to a Node executable to override." >&2
  exit 1
}

resolve_persisted_vault_root() {
  local candidate_paths=(
    "$HOME/Library/Application Support/thinking-space/state/vault-root.json"
    "$HOME/Library/Application Support/long-term-memory/state/vault-root.json"
    "$HOME/Library/Application Support/Thinking Space/state/vault-root.json"
    "$HOME/Library/Application Support/thinking-space-ai-app/state/vault-root.json"
  )

  local candidate
  for candidate in "${candidate_paths[@]}"; do
    if [ -f "$candidate" ]; then
      local resolved
      resolved="$(python3 - "$candidate" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        data = json.load(handle)
    value = data.get("vaultRoot")
    if isinstance(value, str) and value.strip():
        print(value.strip())
except Exception:
    pass
PY
)"
      if [ -n "$resolved" ]; then
        echo "$resolved"
        return
      fi
    fi
  done
}

# ── Resolve vault root ──

EXPLICIT_THINKSPC_VAULT_ROOT="${THINKSPC_VAULT_ROOT:-}"
EXPLICIT_LTM_VAULT_ROOT="${LTM_VAULT_ROOT:-}"
EXPLICIT_THINK_SPACE_VAULT_ROOT="${THINK_SPACE_VAULT_ROOT:-}"
PERSISTED_THINKSPC_VAULT_ROOT="$(resolve_persisted_vault_root || true)"

if [ -f "$HOME/.config/thinkspc/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$HOME/.config/thinkspc/.env"
  set +a
fi

# Resolution order:
# 1. explicit env provided by the caller
# 2. vault selected in the app and persisted to disk
# 3. ~/.config/thinkspc/.env
if [ -n "$EXPLICIT_THINKSPC_VAULT_ROOT" ]; then
  THINKSPC_VAULT_ROOT="$EXPLICIT_THINKSPC_VAULT_ROOT"
elif [ -n "$EXPLICIT_LTM_VAULT_ROOT" ]; then
  THINKSPC_VAULT_ROOT="$EXPLICIT_LTM_VAULT_ROOT"
elif [ -n "$EXPLICIT_THINK_SPACE_VAULT_ROOT" ]; then
  THINKSPC_VAULT_ROOT="$EXPLICIT_THINK_SPACE_VAULT_ROOT"
elif [ -n "$PERSISTED_THINKSPC_VAULT_ROOT" ]; then
  THINKSPC_VAULT_ROOT="$PERSISTED_THINKSPC_VAULT_ROOT"
elif [ -n "${THINKSPC_VAULT_ROOT:-}" ]; then
  THINKSPC_VAULT_ROOT="$THINKSPC_VAULT_ROOT"
elif [ -n "${LTM_VAULT_ROOT:-}" ]; then
  THINKSPC_VAULT_ROOT="$LTM_VAULT_ROOT"
elif [ -n "${THINK_SPACE_VAULT_ROOT:-}" ]; then
  THINKSPC_VAULT_ROOT="$THINK_SPACE_VAULT_ROOT"
fi

: "${LTM_VAULT_ROOT:=${THINKSPC_VAULT_ROOT:-}}"

export THINKSPC_VAULT_ROOT
export LTM_VAULT_ROOT
export LTM_AGENT_CAPABILITIES_ENABLED=1
export LTM_CAPABILITY_RUNNER_CLI=1

if [ -z "${THINKSPC_VAULT_ROOT:-}" ]; then
  echo "Error: THINKSPC_VAULT_ROOT is not set." >&2
  echo "Set it in ~/.config/thinkspc/.env, select a vault in the app first, or export it before running." >&2
  exit 1
fi

# ── Resolve the bundled runner artifact ──

resolve_runner_script() {
  local runner_script="${THINKSPC_RUNNER_SCRIPT:-$CLI_DIR/capabilityRunner.bundle.cjs}"
  if [ -f "$runner_script" ]; then
    echo "$runner_script"
    return
  fi

  echo "Error: Bundled capability runner not found at $runner_script" >&2
  exit 1
}

NODE_EXEC="$(resolve_node_exec)"
RUNNER_SCRIPT="$(resolve_runner_script)"

cd "$CLI_DIR"
exec "$NODE_EXEC" "$RUNNER_SCRIPT" "$@"
