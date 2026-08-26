#!/usr/bin/env bash
# ==============================================================================
# SCRIPT SINKRONISASI & BACKUP DATA (LOKAL <-> VPS)
# Panorama Lens Trip Article Tool / Gemini Article Generator
# ==============================================================================

set -e

COLOR_RESET="\033[0m"
COLOR_BOLD="\033[1m"
COLOR_GREEN="\033[1;32m"
COLOR_BLUE="\033[1;34m"
COLOR_YELLOW="\033[1;33m"
COLOR_RED="\033[1;31m"
COLOR_CYAN="\033[1;36m"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${PROJECT_ROOT}"

ENV_FILE="${PROJECT_ROOT}/.env.deploy"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo -e "${COLOR_RED}[ERROR] File konfigurasi .env.deploy tidak ditemukan!${COLOR_RESET}"
  exit 1
fi

set -a
source "${ENV_FILE}"
set +a

VPS_HOST="${VPS_HOST:-}"
VPS_USER="${VPS_USER:-root}"
VPS_PORT="${VPS_PORT:-22}"
VPS_DEPLOY_DIR="${VPS_DEPLOY_DIR:-/opt/gemini-article-generator}"

RESOLVED_SSH_KEY=""
if [[ -n "${VPS_SSH_KEY:-}" ]]; then
  if [[ "${VPS_SSH_KEY}" == "~"* ]]; then
    RESOLVED_SSH_KEY="${HOME}${VPS_SSH_KEY:1}"
  else
    RESOLVED_SSH_KEY="${VPS_SSH_KEY}"
  fi
fi

# Deteksi SSH Client (WSL Interop)
SSH_CMD="ssh"
SCP_CMD="scp"
IS_WSL=false

if grep -qi microsoft /proc/version 2>/dev/null && command -v ssh.exe >/dev/null 2>&1; then
  if ! timeout 3 ssh -p "${VPS_PORT}" -o StrictHostKeyChecking=no -o ConnectTimeout=3 "${VPS_USER}@${VPS_HOST}" "echo ok" >/dev/null 2>&1; then
    SSH_CMD="ssh.exe"
    SCP_CMD="scp.exe"
    IS_WSL=true
  fi
fi

SSH_KEY_PARAM=()
SCP_KEY_PARAM=()

if [[ -n "${RESOLVED_SSH_KEY}" ]]; then
  if [[ "${IS_WSL}" = true ]]; then
    KEY_NAME=$(basename "${RESOLVED_SSH_KEY}")
    WIN_USER=$(cmd.exe /c "echo %USERNAME%" 2>/dev/null | tr -d '\r' || echo "Ramadhani")
    SSH_KEY_PARAM=("-i" "C:/Users/${WIN_USER}/.ssh/${KEY_NAME}")
    SCP_KEY_PARAM=("-i" "C:/Users/${WIN_USER}/.ssh/${KEY_NAME}")
  elif [[ -f "${RESOLVED_SSH_KEY}" ]]; then
    SSH_KEY_PARAM=("-i" "${RESOLVED_SSH_KEY}")
    SCP_KEY_PARAM=("-i" "${RESOLVED_SSH_KEY}")
  fi
fi

SSH_OPTS=("-p" "${VPS_PORT}" "-o" "StrictHostKeyChecking=no" "-o" "ConnectTimeout=10")
SCP_OPTS=("-P" "${VPS_PORT}" "-o" "StrictHostKeyChecking=no")

show_help() {
  echo -e "${COLOR_CYAN}${COLOR_BOLD}Penggunaan: ./sync-data.sh [AKSI]${COLOR_RESET}"
  echo ""
  echo "Aksi yang tersedia:"
  echo "  --pull, --backup   Download/Backup seluruh data artikel & gambar dari VPS ke komputer lokal"
  echo "  --push, --upload   Kirim/Sinkronkan seluruh data artikel & gambar dari komputer lokal ke VPS"
  echo "  -h, --help         Tampilkan bantuan ini"
  exit 0
}

MODE="$1"

if [[ -z "${MODE}" || "${MODE}" == "-h" || "${MODE}" == "--help" ]]; then
  show_help
fi

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

case "${MODE}" in
  --pull|--backup)
    echo -e "${COLOR_BLUE}[*] Mengunduh data dari VPS (${VPS_USER}@${VPS_HOST}:${VPS_DEPLOY_DIR}/data)...${COLOR_RESET}"
    
    # 1. Simpan ke folder backup timestamp
    BACKUP_DIR="${PROJECT_ROOT}/backups/data_${TIMESTAMP}"
    mkdir -p "${BACKUP_DIR}"
    $SCP_CMD -r "${SCP_OPTS[@]}" "${SCP_KEY_PARAM[@]}" "${VPS_USER}@${VPS_HOST}:${VPS_DEPLOY_DIR}/data/*" "${BACKUP_DIR}/" || true
    
    # 2. Sinkronkan juga ke folder data/ aktif lokal
    mkdir -p "${PROJECT_ROOT}/data"
    $SCP_CMD -r "${SCP_OPTS[@]}" "${SCP_KEY_PARAM[@]}" "${VPS_USER}@${VPS_HOST}:${VPS_DEPLOY_DIR}/data/*" "${PROJECT_ROOT}/data/" || true
    
    echo -e "${COLOR_GREEN}${COLOR_BOLD}✓ Backup data dari VPS berhasil!${COLOR_RESET}"
    echo -e "📁 Folder Backup : ${COLOR_CYAN}${BACKUP_DIR}${COLOR_RESET}"
    echo -e "📁 Folder Aktif  : ${COLOR_CYAN}${PROJECT_ROOT}/data${COLOR_RESET}"
    ;;

  --push|--upload)
    echo -e "${COLOR_YELLOW}[!] Mengunggah data lokal ke VPS (${VPS_USER}@${VPS_HOST}:${VPS_DEPLOY_DIR}/data)...${COLOR_RESET}"
    if [[ ! -d "${PROJECT_ROOT}/data" ]]; then
      echo -e "${COLOR_RED}[ERROR] Folder data/ lokal tidak ditemukan!${COLOR_RESET}"
      exit 1
    fi
    
    # Pastikan direktori tujuan ada
    $SSH_CMD "${SSH_OPTS[@]}" "${SSH_KEY_PARAM[@]}" "${VPS_USER}@${VPS_HOST}" "mkdir -p ${VPS_DEPLOY_DIR}/data/uploads"
    
    # Upload seluruh folder data ke VPS
    $SCP_CMD -r "${SCP_OPTS[@]}" "${SCP_KEY_PARAM[@]}" "${PROJECT_ROOT}/data" "${VPS_USER}@${VPS_HOST}:${VPS_DEPLOY_DIR}/"
    
    # Atur permission
    $SSH_CMD "${SSH_OPTS[@]}" "${SSH_KEY_PARAM[@]}" "${VPS_USER}@${VPS_HOST}" "chmod -R 777 ${VPS_DEPLOY_DIR}/data"
    
    echo -e "${COLOR_GREEN}${COLOR_BOLD}✓ Data lokal berhasil disinkronkan ke VPS!${COLOR_RESET}"
    echo -e "🔗 Target VPS : ${COLOR_CYAN}${VPS_DEPLOY_DIR}/data${COLOR_RESET}"
    ;;

  *)
    echo -e "${COLOR_RED}Aksi tidak dikenal: ${MODE}${COLOR_RESET}"
    show_help
    ;;
esac