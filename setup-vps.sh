#!/usr/bin/env bash
# ==============================================================================
# SCRIPT INITIAL SETUP VPS: Panorama Lens Trip Article Tool
# Menyiapkan server VPS Ubuntu/Debian baru dengan Docker & Docker Compose
# ==============================================================================

set -e

RED="\033[1;31m"
GREEN="\033[1;32m"
BLUE="\033[1;34m"
YELLOW="\033[1;33m"
CYAN="\033[1;36m"
NC="\033[0m"

echo -e "${CYAN}================================================================${NC}"
echo -e "${CYAN}     ⚙️  INITIAL SETUP VPS SERVER (DOCKER & DEPENDENCIES)       ${NC}"
echo -e "${CYAN}================================================================${NC}"

if [ "$(id -u)" -ne 0 ]; then
  echo -e "${RED}[ERROR] Script ini harus dijalankan dengan hak akses root atau sudo!${NC}"
  echo "Gunakan: sudo bash setup-vps.sh"
  exit 1
fi

echo -e "\n${BLUE}[1/5] Memperbarui package sistem apt...${NC}"
apt-get update -y
apt-get install -y ca-certificates curl gnupg lsb-release ufw git

echo -e "\n${BLUE}[2/5] Memasang Docker Engine & Docker Compose...${NC}"
if ! command -v docker &> /dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  systemctl start docker
  systemctl enable docker
  echo -e "${GREEN}✓ Docker Engine & Docker Compose Plugin berhasil dipasang!${NC}"
else
  echo -e "${GREEN}✓ Docker sudah terpasang di sistem.${NC}"
fi

echo -e "\n${BLUE}[3/5] Menyiapkan direktori deployment...${NC}"
DEPLOY_DIR="/opt/gemini-article-generator"
mkdir -p "${DEPLOY_DIR}/data/uploads"
chmod -R 755 "${DEPLOY_DIR}"
echo -e "${GREEN}✓ Direktori ${DEPLOY_DIR} siap!${NC}"

echo -e "\n${BLUE}[4/5] Mengatur firewall dasar (UFW)...${NC}"
ufw allow 22/tcp || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
ufw allow 3001/tcp || true
if ! ufw status | grep -q "Status: active"; then
  echo "y" | ufw enable || true
fi
echo -e "${GREEN}✓ Firewall diizinkan untuk port 22, 80, 443, dan 3001.${NC}"

echo -e "\n${BLUE}[5/5] Informasi Versi Terpasang:${NC}"
docker --version
docker compose version

echo -e "\n${GREEN}================================================================${NC}"
echo -e "${GREEN}     ✅ SETUP VPS BERHASIL! SERVER SIAP MENERIMA DEPLOYMENT     ${NC}"
echo -e "${GREEN}================================================================${NC}"