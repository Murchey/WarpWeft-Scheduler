#!/usr/bin/env bash
set -euo pipefail

base_url="${WARPVEFT_BASE_URL:-http://127.0.0.1:${WARPVEFT_PORT:-4317}}"
url="${base_url%/}/api/health"
curl -fsS --max-time 10 "$url"
printf '\n'
