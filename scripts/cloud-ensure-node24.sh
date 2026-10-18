#!/usr/bin/env bash
# //TR: Cloud ortamı kurulum betiği: package.json engines (node>=24) için Node 24 sağlar; Node 22 ile run-validation NODE_VERSION_UNSUPPORTED verir. Idempotent. Cloud environment setup script olarak çağrılmalıdır; ardından node scripts/ensure-dependencies.mjs ve node scripts/run-validation.mjs çalıştırılır.
set -u
ver="${UASCO_NODE_VERSION:-v24.11.0}"
dest="${UASCO_NODE_HOME:-$HOME/.local/node-$ver}"
cur="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$cur" -ge 24 ]; then echo "node $(node -v) already satisfies engines"; exit 0; fi
if [ ! -x "$dest/bin/node" ]; then
  mkdir -p "$dest" && curl -fsSL "https://nodejs.org/dist/$ver/node-$ver-linux-x64.tar.xz" | tar -xJ --strip-components=1 -C "$dest" \
    || { echo "NODE24_INSTALL_FAILED: full validation must be reported NOT_RUN"; exit 1; }
fi
echo "export PATH=\"$dest/bin:\$PATH\"" > "$HOME/.uasco-node24.env"
echo "node $("$dest/bin/node" -v) at $dest; run: source ~/.uasco-node24.env"
