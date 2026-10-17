#!/usr/bin/env bash
# NaSCon '26 setup: installs Docker Engine + Compose, Java 17, adb, then pulls the image bundle.
# Run with: sudo bash setup-nascon.sh
set -e
U="${SUDO_USER:-$USER}"

# --- Docker Engine (official repo) ---
if ! command -v docker >/dev/null; then
  apt-get update
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
usermod -aG docker "$U"

# --- Java (Appium/Gradle/Android) + adb + pip ---
apt-get install -y openjdk-17-jdk adb python3-pip python3-venv

# --- Image bundle (x86_64 laptop -> node-edge, not seleniarm) ---
IMAGES=(
  postgres:16-alpine
  redis:7-alpine
  minio/minio:RELEASE.2024-09-22T00-33-43Z
  rabbitmq:3.13-management-alpine
  nats:2.10-alpine
  bluenviron/mediamtx:1.9.1
  livekit/livekit-server:v1.7.2
  binwiederhier/ntfy:v2.11.0
  prom/prometheus:v2.54.1
  grafana/grafana:11.2.0
  grafana/k6:0.54.0
  selenium/hub:4.24.0
  selenium/node-chrome:4.24.0
  selenium/node-firefox:4.24.0
  selenium/node-edge:4.24.0
  python:3.12-slim
  node:20-alpine
)
FAILED=()
for img in "${IMAGES[@]}"; do
  echo "=== pulling $img"
  docker pull "$img" || FAILED+=("$img")
done

# --- Python test tools in a venv owned by the user ---
rm -rf "/home/$U/nascon-venv"
sudo -u "$U" python3 -m venv "/home/$U/nascon-venv"
sudo -u "$U" "/home/$U/nascon-venv/bin/pip" install --retries 10 --timeout 120 \
  selenium pytest pytest-html allure-pytest Appium-Python-Client locust requests

echo
docker images
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "FAILED: ${FAILED[*]}  (re-run the script to retry)"; exit 1
fi
echo "All images pulled. Log out and back in (or run 'newgrp docker') to use docker without sudo."
