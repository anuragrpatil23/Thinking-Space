#!/usr/bin/env bash
# iTerm2 Semantic History command: cmd+click on a path opens vault files in
# Thinking Space and everything else in its default app.
#
# iTerm2 → Settings → Profiles → Advanced → Semantic History → "Run command…":
#   /path/to/Thinking-Space/scripts/iterm-open.sh \1

set -euo pipefail

file="${1:-}"
[ -n "$file" ] && [ -e "$file" ] || exit 0

VAULT_ROOT_FILE="$HOME/Library/Application Support/thinking-space/state/vault-root.json"
vault_root="$(plutil -extract vaultRoot raw -o - "$VAULT_ROOT_FILE" 2>/dev/null || true)"

if [ -n "$vault_root" ] && [ -d "$vault_root" ] && [ -f "$file" ]; then
  real_root="$(cd "$vault_root" && pwd -P)"
  real_file="$(cd "$(dirname "$file")" && pwd -P)/$(basename "$file")"
  rel="${real_file#"$real_root"/}"
  # Inside the vault, and not under a dot-folder (.git, .obsidian, …).
  if [ "$rel" != "$real_file" ] && [[ "/$rel" != */.* ]]; then
    exec open -b com.anurag.thinking-space "$real_file"
  fi
fi

exec open "$file"
