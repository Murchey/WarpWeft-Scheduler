#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/warpweft
DATA_DIR=/var/lib/warpweft
ENV_DIR=/etc/warpweft
SERVICE_FILE=/etc/systemd/system/warpweft.service
SERVICE_NAME=warpweft
PURGE_DATA=0

if [ "${1:-}" = "--purge-data" ]; then
  PURGE_DATA=1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "请使用 root 运行：sudo bash uninstall.sh [--purge-data]" >&2
  exit 1
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl stop "$SERVICE_NAME" 2>/dev/null || true
  systemctl disable "$SERVICE_NAME" 2>/dev/null || true
fi
rm -f "$SERVICE_FILE"
if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload
fi
rm -rf "$APP_DIR"

if [ "$PURGE_DATA" -eq 1 ]; then
  rm -rf "$DATA_DIR"
  rm -rf "$ENV_DIR"
  if id -u warpweft >/dev/null 2>&1; then
    userdel warpweft 2>/dev/null || true
  fi
  echo "WarpWeft removed, including data and environment files."
else
  echo "WarpWeft removed. Data and environment files were preserved:"
  echo "  $DATA_DIR"
  echo "  $ENV_DIR"
fi
