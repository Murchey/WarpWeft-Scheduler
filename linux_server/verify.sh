#!/usr/bin/env bash
set -euo pipefail

base_url="${WARPVEFT_BASE_URL:-http://127.0.0.1:${WARPVEFT_PORT:-4317}}"
base_url="${base_url%/}"
failures=0

check() {
  local label="$1"
  shift
  if "$@"; then
    echo "[ok] $label"
  else
    echo "[fail] $label"
    failures=$((failures + 1))
  fi
}

echo "WarpWeft Linux server verification"
echo "Base URL: $base_url"
command -v node >/dev/null 2>&1 && echo "[ok] node: $(node --version)" || { echo "[fail] node not found"; failures=$((failures + 1)); }
command -v java >/dev/null 2>&1 && echo "[ok] java: $(java -version 2>&1 | head -n 1)" || { echo "[fail] java not found"; failures=$((failures + 1)); }

if curl -fsS --max-time 10 "$base_url/api/health" >/tmp/warpweft-health.$$ 2>/dev/null; then
  echo "[ok] /api/health"
  if grep -q '"ok":true' /tmp/warpweft-health.$$; then echo "[ok] health ok=true"; else echo "[fail] health ok=true missing"; failures=$((failures + 1)); fi
  if grep -q '"schemaVersion"' /tmp/warpweft-health.$$; then echo "[ok] schemaVersion present"; else echo "[fail] schemaVersion missing"; failures=$((failures + 1)); fi
else
  echo "[fail] /api/health is not reachable"
  failures=$((failures + 1))
fi
rm -f /tmp/warpweft-health.$$

if curl -fsS --max-time 10 "$base_url/" | grep -q '<div id="root">'; then
  echo "[ok] renderer index"
else
  echo "[fail] renderer index"
  failures=$((failures + 1))
fi

if curl -fsS --max-time 10 "$base_url/api/data" | grep -q '"school"'; then
  echo "[ok] /api/data"
else
  echo "[fail] /api/data"
  failures=$((failures + 1))
fi

if [ "$failures" -gt 0 ]; then
  echo "Verification failed: $failures check(s)."
  exit 1
fi
echo "Verification passed."
