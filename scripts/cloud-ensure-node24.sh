#!/usr/bin/env bash
# //TR: Cloud ortamı kurulum betiği: package.json engines (node>=24) için Node 24 sağlar; Node 22 ile run-validation NODE_VERSION_UNSUPPORTED verir. Idempotent. Cloud environment setup script olarak çağrılmalıdır; ardından node scripts/ensure-dependencies.mjs ve node scripts/run-validation.mjs çalıştırılır.
#
# Usage (cloud environment setup script):
#   bash scripts/cloud-ensure-node24.sh && source ~/.uasco-node24.env
#   node scripts/ensure-dependencies.mjs && node scripts/run-validation.mjs
# If $CLAUDE_ENV_FILE is set, the PATH export is also appended there.
#
# Env overrides:
#   UASCO_NODE_HOME    absolute install dir (^/[A-Za-z0-9._/-]+$, no '..'); default $HOME/.local/node-<ver>
#   UASCO_NODE_VERSION must match ^v24\.N\.N$. Any version other than the pinned default
#                      REQUIRES UASCO_NODE_SHA256 (sha256 of node-<ver>-linux-x64.tar.xz).
#   UASCO_NODE_SHA256  expected tarball sha256 (must also match nodejs.org SHASUMS256.txt).
# Integrity: the tarball is downloaded to a temp dir; its sha256 must equal BOTH the expected
# value (pinned in this script for the default version) AND the SHASUMS256.txt entry.
# It is then extracted in the temp dir and moved into place.
set -euo pipefail

DEFAULT_VER="v24.11.0"
# sha256 of node-v24.11.0-linux-x64.tar.xz (from https://nodejs.org/dist/v24.11.0/SHASUMS256.txt)
PINNED_SHA256="46da9a098973ab7ba4fca76945581ecb2eaf468de347173897044382f10e0a0a"

fail() { echo "NODE24_INSTALL_FAILED: $1; full validation must be reported NOT_RUN" >&2; exit 1; }

# 1. Already satisfied? Check before touching HOME or anything else.
if command -v node >/dev/null 2>&1; then
  cur="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  case "$cur" in ''|*[!0-9]*) cur=0 ;; esac
  if [ "$cur" -ge 24 ]; then
    # Write a no-op env file so the documented `&& source ~/.uasco-node24.env` also works here.
    if [ -n "${HOME:-}" ] && [ -d "$HOME" ]; then printf '%s\n' ': # node >=24 already on PATH; nothing to export' > "$HOME/.uasco-node24.env" || true; fi
    echo "node $(node -v) already satisfies engines"; exit 0
  fi
fi

# 2. Platform
[ "$(uname -s)" = "Linux" ] || fail "unsupported platform ($(uname -s))"
[ "$(uname -m)" = "x86_64" ] || fail "unsupported platform ($(uname -m))"

# 3. Validate inputs
ver="${UASCO_NODE_VERSION:-$DEFAULT_VER}"
[[ "$ver" =~ ^v24\.[0-9]+\.[0-9]+$ ]] || fail "invalid UASCO_NODE_VERSION"
if [ "$ver" = "$DEFAULT_VER" ]; then
  expected="$PINNED_SHA256"
  if [ -n "${UASCO_NODE_SHA256:-}" ] && [ "$UASCO_NODE_SHA256" != "$PINNED_SHA256" ]; then
    fail "UASCO_NODE_SHA256 differs from pinned hash for $DEFAULT_VER"
  fi
else
  [ -n "${UASCO_NODE_SHA256:-}" ] || fail "UASCO_NODE_SHA256 required when UASCO_NODE_VERSION is overridden"
  expected="$UASCO_NODE_SHA256"
fi
[[ "$expected" =~ ^[0-9a-f]{64}$ ]] || fail "invalid sha256"

: "${HOME:?HOME must be set}"
dest="${UASCO_NODE_HOME:-$HOME/.local/node-$ver}"
[[ "$dest" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "invalid install dir"
case "$dest/" in */../*) fail "invalid install dir (..)" ;; esac
dest="${dest%/}"
[ -n "$dest" ] || fail "invalid install dir"

want="${ver#v}"
installed_ok() {
  [ -x "$dest/bin/node" ] || return 1
  local v
  v="$("$dest/bin/node" -p process.versions.node 2>/dev/null)" || return 1
  [ "$v" = "$want" ]
}

# 4. Install if no verified install exists (version is checked, not just -x)
if ! installed_ok; then
  file="node-$ver-linux-x64.tar.xz"
  base="https://nodejs.org/dist/$ver"
  parent="$(dirname "$dest")"
  mkdir -p "$parent" || fail "cannot create $parent"
  tmp="$(mktemp -d "$parent/.node24-tmp.XXXXXX")" || fail "mktemp failed"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL -o "$tmp/$file" "$base/$file" || fail "download failed"
  curl -fsSL -o "$tmp/SHASUMS256.txt" "$base/SHASUMS256.txt" || fail "SHASUMS256.txt download failed"
  line="$(grep -E "^[0-9a-f]{64}  ${file//./\\.}\$" "$tmp/SHASUMS256.txt" || true)"
  [ -n "$line" ] || fail "no SHASUMS256.txt entry for $file"
  sums_hash="${line%% *}"
  [ "$sums_hash" = "$expected" ] || fail "expected sha256 does not match SHASUMS256.txt"
  (cd "$tmp" && printf '%s  %s\n' "$expected" "$file" | sha256sum -c -) >&2 || fail "sha256 mismatch"
  mkdir "$tmp/x"
  tar -xJf "$tmp/$file" --strip-components=1 -C "$tmp/x" || fail "extract failed"
  [ "$("$tmp/x/bin/node" -p process.versions.node 2>/dev/null)" = "$want" ] || fail "extracted node version mismatch"
  if [ -d "$dest" ] && [ -z "$(ls -A "$dest")" ]; then rmdir "$dest"; fi
  [ ! -e "$dest" ] || fail "$dest exists and is not a valid node $want install; remove it manually"
  mv "$tmp/x" "$dest" || fail "move into place failed"
fi

# 5. Post-install verification
inst="$("$dest/bin/node" -p process.versions.node 2>/dev/null)" || fail "installed node does not run"
case "${inst%%.*}" in ''|*[!0-9]*) fail "bad node version" ;; esac
[ "${inst%%.*}" -ge 24 ] || fail "installed node major < 24"

# 6. Env file (shell-quoted; sourcing cannot execute anything from $dest)
exp="$(printf 'export PATH=%q:"$PATH"' "$dest/bin")"
printf '%s\n' "$exp" > "$HOME/.uasco-node24.env"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then printf '%s\n' "$exp" >> "$CLAUDE_ENV_FILE"; fi
echo "node v$inst at $dest; run: source ~/.uasco-node24.env"
