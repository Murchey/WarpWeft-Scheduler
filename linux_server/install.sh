#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/warpweft
DATA_DIR=/var/lib/warpweft
ENV_DIR=/etc/warpweft
ENV_FILE="$ENV_DIR/warpweft.env"
SERVICE_FILE=/etc/systemd/system/warpweft.service
SERVICE_NAME=warpweft

if [ "$(id -u)" -ne 0 ]; then
  echo "请使用 root 运行：sudo bash install.sh" >&2
  exit 1
fi

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ ! -f "$source_dir/linux_server/server.cjs" ] || [ ! -f "$source_dir/dist/index.html" ]; then
  echo "安装包不完整：需要 linux_server/server.cjs 和 dist/index.html。" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "找不到 node。请先安装 Node.js 20 或 22。" >&2
  exit 1
fi
if ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"; then
  echo "Node.js 版本过低：需要 20 或更高，当前 $(node --version)。" >&2
  exit 1
fi
if ! command -v systemctl >/dev/null 2>&1; then
  echo "找不到 systemctl。本安装脚本要求 systemd。" >&2
  exit 1
fi
if ! id -u warpweft >/dev/null 2>&1; then
  useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin warpweft
fi

if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  systemctl stop "$SERVICE_NAME"
fi

# Stage the new application before replacing the old one, so a failed copy
# leaves the previous installation intact.
stage_dir="${APP_DIR}.new"
rm -rf "$stage_dir"
install -d -m 0755 "$stage_dir"
cp -a "$source_dir/." "$stage_dir/"
chown -R root:root "$stage_dir"
rm -rf "${APP_DIR}.old"
if [ -d "$APP_DIR" ]; then
  mv "$APP_DIR" "${APP_DIR}.old"
fi
mv "$stage_dir" "$APP_DIR"
rm -rf "${APP_DIR}.old"

install -d -m 0750 -o warpweft -g warpweft "$DATA_DIR"
install -d -m 0750 -o root -g warpweft "$ENV_DIR"
if [ ! -f "$ENV_FILE" ]; then
  install -m 0640 -o root -g warpweft "$APP_DIR/linux_server/warpweft.env.example" "$ENV_FILE"
fi
chown root:warpweft "$ENV_FILE"
chmod 0640 "$ENV_FILE"
install -m 0644 "$APP_DIR/linux_server/warpweft.service" "$SERVICE_FILE"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

echo "WarpWeft installed."
echo "  application: $APP_DIR"
echo "  data:        $DATA_DIR"
echo "  environment: $ENV_FILE"
echo "  service:     systemctl status $SERVICE_NAME"
echo "  create admin:"
echo "    sudo -u warpweft env WARPVEFT_DATA_DIR=$DATA_DIR node $APP_DIR/linux_server/user-cli.cjs create-admin admin"
echo "Check:       bash $APP_DIR/linux_server/verify.sh"
