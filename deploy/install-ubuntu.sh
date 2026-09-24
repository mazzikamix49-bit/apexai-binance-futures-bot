#!/usr/bin/env bash
set -euo pipefail
sudo apt-get update
sudo apt-get install -y ca-certificates curl git docker.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER" || true
echo "Docker is installed. Upload/clone the ApexAI project, create .env from .env.example, then run: docker compose up -d --build"
