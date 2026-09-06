#!/usr/bin/env bash
set -euo pipefail

echo "=== Installing Docker Engine in WSL2 ==="

# Add Docker's official GPG key
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
echo "Docker repo added"

# Install Docker Engine
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
echo "Docker Engine installed"

# Add user to docker group
sudo usermod -aG docker $USER
echo "Added $USER to docker group"

# Start Docker daemon (since WSL2 doesn't auto-start systemd services)
sudo dockerd > /tmp/dockerd.log 2>&1 &
sleep 3
echo "Docker daemon started"

# Verify
docker version
docker compose version

echo ""
echo "=== Docker is ready! ==="
echo "NOTE: You may need to run 'newgrp docker' or start a new shell for group permissions to take effect."
echo "If docker version says 'permission denied', run: sudo chmod 666 /var/run/docker.sock"
