#!/usr/bin/env bash
set -euo pipefail

app_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
base_url="${WARPVEFT_BASE_URL:-http://127.0.0.1:${WARPVEFT_PORT:-4317}}"
base_url="${base_url%/}"
failures=0
health_file="$(mktemp)"
trap 'rm -f "$health_file"' EXIT

fail() {
  echo "[fail] $1"
  failures=$((failures + 1))
}

echo "WarpWeft Linux server verification"
echo "Base URL: $base_url"
if command -v node >/dev/null 2>&1; then
  echo "[ok] node: $(node --version)"
else
  fail "node not found"
fi
if command -v java >/dev/null 2>&1; then
  echo "[ok] java: $(java -version 2>&1 | head -n 1)"
else
  fail "java not found"
fi

if curl -fsS --max-time 10 "$base_url/api/health" >"$health_file" 2>/dev/null; then
  echo "[ok] /api/health"
  grep -q '"ok":true' "$health_file" && echo "[ok] health ok=true" || fail "health ok=true missing"
  grep -q '"schemaVersion"' "$health_file" && echo "[ok] schemaVersion present" || fail "schemaVersion missing"
else
  fail "/api/health is not reachable"
fi

auth_required=0
if [ -s "$health_file" ]; then
  auth_required="$(node -e "const fs=require('fs');const h=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(h.auth&&h.auth.required?'1':'0')" "$health_file" 2>/dev/null || echo 0)"
fi
token=""
if [ "$auth_required" = "1" ]; then
  if [ -n "${WARPVEFT_VERIFY_USERNAME:-}" ] && [ -n "${WARPVEFT_VERIFY_PASSWORD:-}" ]; then
    login_body="$(WARPVEFT_VERIFY_USERNAME="$WARPVEFT_VERIFY_USERNAME" WARPVEFT_VERIFY_PASSWORD="$WARPVEFT_VERIFY_PASSWORD" node -e "process.stdout.write(JSON.stringify({username:process.env.WARPVEFT_VERIFY_USERNAME,password:process.env.WARPVEFT_VERIFY_PASSWORD}))")"
    login_json="$(curl -fsS --max-time 10 -H 'Content-Type: application/json' -d "$login_body" "$base_url/api/auth/login" 2>/dev/null || true)"
    token="$(printf '%s' "$login_json" | node -e "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{try{const o=JSON.parse(s);if(o.token)process.stdout.write(o.token)}catch{}})" 2>/dev/null || true)"
    if [ -n "$token" ]; then
      echo "[ok] login"
    else
      fail "login failed (check WARPVEFT_VERIFY_USERNAME/PASSWORD)"
    fi
  else
    echo "[skip] /api/data login check (set WARPVEFT_VERIFY_USERNAME and WARPVEFT_VERIFY_PASSWORD)"
  fi
fi

if curl -fsS --max-time 10 "$base_url/" | grep -q '<div id="root">'; then
  echo "[ok] renderer index"
else
  fail "renderer index"
fi

if [ "$auth_required" = "1" ] && [ -z "$token" ]; then
  :
elif [ -n "$token" ]; then
  if curl -fsS --max-time 10 -H "Authorization: Bearer $token" "$base_url/api/data" | grep -q '"school"'; then
    echo "[ok] /api/data"
  else
    fail "/api/data"
  fi
else
  if curl -fsS --max-time 10 "$base_url/api/data" | grep -q '"school"'; then
    echo "[ok] /api/data"
  else
    fail "/api/data"
  fi
fi

if [ -f "$app_dir/warpweft-build.json" ]; then
  if node "$app_dir/linux_server/verify-manifest.cjs" "$health_file" "$app_dir"; then
    :
  else
    fail "build manifest / package files do not match the running server"
  fi
else
  echo "[skip] build manifest (older package without warpweft-build.json)"
fi

if [ "$failures" -gt 0 ]; then
  echo "Verification failed: $failures check(s)."
  exit 1
fi
echo "Verification passed."
