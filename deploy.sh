#!/usr/bin/env bash
# ==============================================================================
# SCRIPT AUTO-DEPLOY: Panorama Lens Trip Article Tool / Gemini Article Generator
# Alur: Build Lokal -> Tag & Push Docker Hub -> Deploy ke VPS via Docker Compose
# ==============================================================================

set -e

# --- Warna Output Terminal ---
COLOR_RESET="\033[0m"
COLOR_BOLD="\033[1m"
COLOR_GREEN="\033[1;32m"
COLOR_BLUE="\033[1;34m"
COLOR_YELLOW="\033[1;33m"
COLOR_RED="\033[1;31m"
COLOR_CYAN="\033[1;36m"

echo -e "${COLOR_CYAN}${COLOR_BOLD}"
echo "================================================================"
echo "    🚀 AUTO-DEPLOY: LOCAL BUILD -> DOCKER HUB -> VPS DEPLOY     "
echo "================================================================"
echo -e "${COLOR_RESET}"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${PROJECT_ROOT}"

ENV_FILE="${PROJECT_ROOT}/.env.deploy"
CUSTOM_TAG=""
SKIP_BUILD=false
SKIP_PUSH=false
SYNC_ENV=false
SYNC_DATA=false
BACKUP_DATA=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --tag)
      CUSTOM_TAG="$2"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --skip-push)
      SKIP_PUSH=true
      shift
      ;;
    --sync-env)
      SYNC_ENV=true
      shift
      ;;
    --sync-data)
      SYNC_DATA=true
      shift
      ;;
    --backup-data|--pull-data)
      BACKUP_DATA=true
      shift
      ;;
    -h|--help)
      echo "Penggunaan: ./deploy.sh [OPSI]"
      echo ""
      echo "Opsi:"
      echo "  --tag <tag_name>     Tentukan tag image (default: latest & timestamp)"
      echo "  --env-file <path>    Gunakan file konfigurasi deploy khusus"
      echo "  --sync-env           Kirim file .env.production lokal ke VPS sebagai .env"
      echo "  --sync-data          Paksa sinkronisasi folder data lokal ke VPS (articles, uploads, settings)"
      echo "  --backup-data        Download dan backup data production dari VPS ke folder backups/"
      echo "  --skip-build         Lewati build lokal (langsung deploy remote image yang ada)"
      echo "  --skip-push          Hanya build image lokal tanpa push ke Docker Hub"
      echo "  -h, --help           Tampilkan bantuan ini"
      exit 0
      ;;
    *)
      echo -e "${COLOR_RED}Opsi tidak dikenali: $1${COLOR_RESET}"
      exit 1
      ;;
  esac
done

# --- 1. Load Konfigurasi Deploy ---
if [[ ! -f "${ENV_FILE}" ]]; then
  echo -e "${COLOR_YELLOW}[!] File konfigurasi '${ENV_FILE}' tidak ditemukan!${COLOR_RESET}"
  if [[ -f "${PROJECT_ROOT}/.env.deploy.example" ]]; then
    echo -e "${COLOR_BLUE}[*] Membuat '${ENV_FILE}' dari template '.env.deploy.example'...${COLOR_RESET}"
    cp "${PROJECT_ROOT}/.env.deploy.example" "${ENV_FILE}"
    echo -e "${COLOR_RED}[!] Silakan edit file '.env.deploy' terlebih dahulu dengan detail Docker Hub & VPS Anda!${COLOR_RESET}"
    exit 1
  else
    echo -e "${COLOR_RED}[ERROR] Template '.env.deploy.example' tidak ditemukan!${COLOR_RESET}"
    exit 1
  fi
fi

set -a
source "${ENV_FILE}"
set +a

DOCKERHUB_USERNAME="${DOCKERHUB_USERNAME:-}"
DOCKERHUB_REPO="${DOCKERHUB_REPO:-gemini-article-generator}"
VPS_HOST="${VPS_HOST:-}"
VPS_USER="${VPS_USER:-root}"
VPS_PORT="${VPS_PORT:-22}"
VPS_DEPLOY_DIR="${VPS_DEPLOY_DIR:-/opt/gemini-article-generator}"
BUILD_PLATFORM="${BUILD_PLATFORM:-linux/amd64}"

if [[ -z "${DOCKERHUB_USERNAME}" || "${DOCKERHUB_USERNAME}" == "username_dockerhub_anda" ]]; then
  echo -e "${COLOR_RED}[ERROR] DOCKERHUB_USERNAME belum diatur di .env.deploy!${COLOR_RESET}"
  exit 1
fi

if [[ -z "${VPS_HOST}" || "${VPS_HOST}" == "103.xxx.xxx.xxx" ]]; then
  echo -e "${COLOR_RED}[ERROR] VPS_HOST belum diatur di .env.deploy!${COLOR_RESET}"
  exit 1
fi

# Expand tilde in VPS_SSH_KEY
RESOLVED_SSH_KEY=""
if [[ -n "${VPS_SSH_KEY:-}" ]]; then
  if [[ "${VPS_SSH_KEY}" == "~"* ]]; then
    RESOLVED_SSH_KEY="${HOME}${VPS_SSH_KEY:1}"
  else
    RESOLVED_SSH_KEY="${VPS_SSH_KEY}"
  fi
fi

# Deteksi SSH Client (WSL Interop Fallback jika Linux NAT timeout)
SSH_CMD="ssh"
SCP_CMD="scp"
IS_WSL=false

if grep -qi microsoft /proc/version 2>/dev/null && command -v ssh.exe >/dev/null 2>&1; then
  # Cek apakah Linux ssh timeout/gagal menjangkau VPS
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
    # Deteksi folder Windows User
    WIN_USER=$(cmd.exe /c "echo %USERNAME%" 2>/dev/null | tr -d '\r' || echo "Ramadhani")
    WIN_SSH_DIR="/mnt/c/Users/${WIN_USER}/.ssh"
    mkdir -p "${WIN_SSH_DIR}"
    if [[ -f "${RESOLVED_SSH_KEY}" ]] && [[ ! -f "${WIN_SSH_DIR}/${KEY_NAME}" ]]; then
      cp "${RESOLVED_SSH_KEY}" "${WIN_SSH_DIR}/${KEY_NAME}"
    fi
    SSH_KEY_PARAM=("-i" "C:/Users/${WIN_USER}/.ssh/${KEY_NAME}")
    SCP_KEY_PARAM=("-i" "C:/Users/${WIN_USER}/.ssh/${KEY_NAME}")
  elif [[ -f "${RESOLVED_SSH_KEY}" ]]; then
    SSH_KEY_PARAM=("-i" "${RESOLVED_SSH_KEY}")
    SCP_KEY_PARAM=("-i" "${RESOLVED_SSH_KEY}")
  fi
fi

RELEASE_TAG=$(date +"%Y%m%d_%H%M%S")
if [[ -n "${CUSTOM_TAG}" ]]; then
  TAG="${CUSTOM_TAG}"
else
  TAG="${IMAGE_TAG:-latest}"
fi

FULL_IMAGE_NAME="${DOCKERHUB_USERNAME}/${DOCKERHUB_REPO}:${TAG}"
TIMESTAMP_IMAGE_NAME="${DOCKERHUB_USERNAME}/${DOCKERHUB_REPO}:${RELEASE_TAG}"
LATEST_IMAGE_NAME="${DOCKERHUB_USERNAME}/${DOCKERHUB_REPO}:latest"

echo -e "${COLOR_BLUE}[*] Konfigurasi Deploy:${COLOR_RESET}"
echo "    - Docker Hub Image : ${FULL_IMAGE_NAME}"
echo "    - Target Platform  : ${BUILD_PLATFORM}"
echo "    - VPS Host         : ${VPS_USER}@${VPS_HOST}:${VPS_PORT}"
echo "    - VPS Target Dir   : ${VPS_DEPLOY_DIR}"
if [[ -n "${RESOLVED_SSH_KEY}" ]]; then
  echo "    - SSH Key File     : ${RESOLVED_SSH_KEY}"
fi
echo ""

SSH_COMMON_OPTS=("-p" "${VPS_PORT}" "-o" "StrictHostKeyChecking=no" "-o" "ConnectTimeout=10")
SCP_COMMON_OPTS=("-P" "${VPS_PORT}" "-o" "StrictHostKeyChecking=no")

# --- 2. Verifikasi Koneksi VPS & Docker ---
echo -e "${COLOR_BLUE}[1/6] Memeriksa koneksi ke server VPS...${COLOR_RESET}"
if ! $SSH_CMD "${SSH_COMMON_OPTS[@]}" "${SSH_KEY_PARAM[@]}" "${VPS_USER}@${VPS_HOST}" "echo 'SSH Connected'" >/dev/null 2>&1; then
  echo -e "${COLOR_RED}[ERROR] Gagal terhubung ke VPS (${VPS_USER}@${VPS_HOST}:${VPS_PORT})!${COLOR_RESET}"
  if [[ -n "${RESOLVED_SSH_KEY}" ]]; then
    echo -e "${COLOR_YELLOW}SSH Key yang digunakan: ${RESOLVED_SSH_KEY}${COLOR_RESET}"
  fi
  exit 1
fi
echo -e "${COLOR_GREEN}✓ Koneksi SSH ke VPS berhasil!${COLOR_RESET}"

# Opsi Backup Data Production
if [ "${BACKUP_DATA}" = true ]; then
  echo -e "\n${COLOR_BLUE}[*] Mengunduh backup data dari VPS...${COLOR_RESET}"
  BACKUP_DIR="${PROJECT_ROOT}/backups/data_${RELEASE_TAG}"
  mkdir -p "${BACKUP_DIR}"
  $SCP_CMD -r "${SCP_COMMON_OPTS[@]}" "${SCP_KEY_PARAM[@]}" "${VPS_USER}@${VPS_HOST}:${VPS_DEPLOY_DIR}/data" "${BACKUP_DIR}/" || true
  echo -e "${COLOR_GREEN}✓ Backup data berhasil disimpan di: ${BACKUP_DIR}${COLOR_RESET}"
  exit 0
fi

echo -e "${COLOR_BLUE}[*] Memeriksa instalasi Docker di VPS...${COLOR_RESET}"
REMOTE_DOCKER_CHECK=$($SSH_CMD "${SSH_COMMON_OPTS[@]}" "${SSH_KEY_PARAM[@]}" "${VPS_USER}@${VPS_HOST}" "command -v docker || true")
if [[ -z "${REMOTE_DOCKER_CHECK}" ]]; then
  echo -e "${COLOR_YELLOW}[!] Docker belum terpasang di server VPS.${COLOR_RESET}"
  read -p "Apakah Anda ingin menjalankan setup Docker otomatis di VPS sekarang? (y/n): " RUN_SETUP
  if [[ "${RUN_SETUP}" =~ ^[Yy]$ ]]; then
    echo -e "${COLOR_BLUE}[*] Mengirim dan menjalankan setup-vps.sh ke VPS...${COLOR_RESET}"
    $SCP_CMD "${SCP_COMMON_OPTS[@]}" "${SCP_KEY_PARAM[@]}" "${PROJECT_ROOT}/setup-vps.sh" "${VPS_USER}@${VPS_HOST}:/tmp/setup-vps.sh"
    $SSH_CMD "${SSH_COMMON_OPTS[@]}" "${SSH_KEY_PARAM[@]}" "${VPS_USER}@${VPS_HOST}" "chmod +x /tmp/setup-vps.sh && sudo /tmp/setup-vps.sh"
  else
    echo -e "${COLOR_RED}[ERROR] Deployment dibatalkan karena Docker belum siap di VPS.${COLOR_RESET}"
    exit 1
  fi
fi
echo -e "${COLOR_GREEN}✓ Docker siap di server VPS!${COLOR_RESET}"

# --- 3. Build Docker Image Lokal ---
if [ "${SKIP_BUILD}" = false ]; then
  echo -e "\n${COLOR_BLUE}[2/6] Membangun Docker Image secara lokal (${BUILD_PLATFORM})...${COLOR_RESET}"
  docker build \
    --platform "${BUILD_PLATFORM}" \
    -t "${FULL_IMAGE_NAME}" \
    -t "${LATEST_IMAGE_NAME}" \
    -t "${TIMESTAMP_IMAGE_NAME}" \
    -f "${PROJECT_ROOT}/Dockerfile" \
    "${PROJECT_ROOT}"
  echo -e "${COLOR_GREEN}✓ Build Docker Image selesai!${COLOR_RESET}"
else
  echo -e "\n${COLOR_YELLOW}[2/6] Melewati build lokal (--skip-build aktif).${COLOR_RESET}"
fi

# --- 4. Push Image ke Docker Hub ---
if [ "${SKIP_PUSH}" = false ] && [ "${SKIP_BUILD}" = false ]; then
  echo -e "\n${COLOR_BLUE}[3/6] Mengunggah Image ke Docker Hub...${COLOR_RESET}"
  if ! docker info 2>/dev/null | grep -q "Username"; then
    echo -e "${COLOR_YELLOW}[*] Belum login ke Docker Hub. Menjalankan 'docker login'...${COLOR_RESET}"
    docker login
  fi
  echo -e "${COLOR_CYAN}Mengunggah tag: ${TAG}${COLOR_RESET}"
  docker push "${FULL_IMAGE_NAME}"
  if [ "${TAG}" != "latest" ]; then
    echo -e "${COLOR_CYAN}Mengunggah tag: latest${COLOR_RESET}"
    docker push "${LATEST_IMAGE_NAME}"
  fi
  echo -e "${COLOR_CYAN}Mengunggah backup tag: ${RELEASE_TAG}${COLOR_RESET}"
  docker push "${TIMESTAMP_IMAGE_NAME}"
  echo -e "${COLOR_GREEN}✓ Image berhasil di-push ke Docker Hub!${COLOR_RESET}"
elif [ "${SKIP_PUSH}" = true ]; then
  echo -e "\n${COLOR_YELLOW}[3/6] Melewati push Docker Hub (--skip-push aktif).${COLOR_RESET}"
fi

# --- 5. Persiapan Direktori & Sinkronisasi Data/Konfigurasi ke VPS ---
echo -e "\n${COLOR_BLUE}[4/6] Menyiapkan direktori & menyinkronkan data/konfigurasi ke VPS...${COLOR_RESET}"
$SSH_CMD "${SSH_COMMON_OPTS[@]}" "${SSH_KEY_PARAM[@]}" "${VPS_USER}@${VPS_HOST}" "mkdir -p ${VPS_DEPLOY_DIR}/data/uploads"

echo -e "${COLOR_CYAN}Mengirim docker-compose.prod.yml -> ${VPS_DEPLOY_DIR}/docker-compose.prod.yml${COLOR_RESET}"
$SCP_CMD "${SCP_COMMON_OPTS[@]}" "${SCP_KEY_PARAM[@]}" "${PROJECT_ROOT}/docker-compose.prod.yml" "${VPS_USER}@${VPS_HOST}:${VPS_DEPLOY_DIR}/docker-compose.prod.yml"

# Manajemen Data Persisten (articles.json, admin_settings.json, uploads)
REMOTE_HAS_DATA=$($SSH_CMD "${SSH_COMMON_OPTS[@]}" "${SSH_KEY_PARAM[@]}" "${VPS_USER}@${VPS_HOST}" "test -f ${VPS_DEPLOY_DIR}/data/articles.json && echo 'yes' || echo 'no'")

if [ "${SYNC_DATA}" = true ]; then
  echo -e "${COLOR_YELLOW}[*] Sinkronisasi data lokal ke VPS (--sync-data aktif)...${COLOR_RESET}"
  $SCP_CMD -r "${SCP_COMMON_OPTS[@]}" "${SCP_KEY_PARAM[@]}" "${PROJECT_ROOT}/data" "${VPS_USER}@${VPS_HOST}:${VPS_DEPLOY_DIR}/"
  echo -e "${COLOR_GREEN}✓ Data lokal berhasil disinkronkan ke VPS!${COLOR_RESET}"
elif [ "${REMOTE_HAS_DATA}" = "no" ] && [ -d "${PROJECT_ROOT}/data" ]; then
  echo -e "${COLOR_CYAN}[*] Inisialisasi awal data ke VPS (mengirim data artikel, settings, & uploads lokal)...${COLOR_RESET}"
  $SCP_CMD -r "${SCP_COMMON_OPTS[@]}" "${SCP_KEY_PARAM[@]}" "${PROJECT_ROOT}/data" "${VPS_USER}@${VPS_HOST}:${VPS_DEPLOY_DIR}/" || true
  echo -e "${COLOR_GREEN}✓ Data awal berhasil disalin ke VPS!${COLOR_RESET}"
else
  echo -e "${COLOR_GREEN}✓ Data persisten di VPS tetap dipertahankan (tidak ditimpa).${COLOR_RESET}"
fi

# Pastikan permission folder data di VPS bisa dibaca dan ditulis oleh container Docker
$SSH_CMD "${SSH_COMMON_OPTS[@]}" "${SSH_KEY_PARAM[@]}" "${VPS_USER}@${VPS_HOST}" "chmod -R 777 ${VPS_DEPLOY_DIR}/data"

# Manajemen File .env
REMOTE_ENV_EXISTS=$($SSH_CMD "${SSH_COMMON_OPTS[@]}" "${SSH_KEY_PARAM[@]}" "${VPS_USER}@${VPS_HOST}" "test -f ${VPS_DEPLOY_DIR}/.env && echo 'exists' || echo 'none'")

if [ "${SYNC_ENV}" = true ] && [ -f "${PROJECT_ROOT}/.env.production" ]; then
  echo -e "${COLOR_CYAN}Sinkronisasi .env.production -> ${VPS_DEPLOY_DIR}/.env${COLOR_RESET}"
  $SCP_CMD "${SCP_COMMON_OPTS[@]}" "${SCP_KEY_PARAM[@]}" "${PROJECT_ROOT}/.env.production" "${VPS_USER}@${VPS_HOST}:${VPS_DEPLOY_DIR}/.env"
elif [ "${REMOTE_ENV_EXISTS}" = "none" ]; then
  if [ -f "${PROJECT_ROOT}/.env.production" ]; then
    echo -e "${COLOR_CYAN}Mengirim file .env awal dari .env.production ke VPS...${COLOR_RESET}"
    $SCP_CMD "${SCP_COMMON_OPTS[@]}" "${SCP_KEY_PARAM[@]}" "${PROJECT_ROOT}/.env.production" "${VPS_USER}@${VPS_HOST}:${VPS_DEPLOY_DIR}/.env"
  elif [ -f "${PROJECT_ROOT}/.env.production.example" ]; then
    echo -e "${COLOR_CYAN}Mengirim template .env awal dari .env.production.example ke VPS...${COLOR_RESET}"
    $SCP_CMD "${SCP_COMMON_OPTS[@]}" "${SCP_KEY_PARAM[@]}" "${PROJECT_ROOT}/.env.production.example" "${VPS_USER}@${VPS_HOST}:${VPS_DEPLOY_DIR}/.env"
    echo -e "${COLOR_YELLOW}[PENTING] File .env dibuat dari template. Silakan edit API key & password jika diperlukan!${COLOR_RESET}"
  fi
fi
echo -e "${COLOR_GREEN}✓ File konfigurasi VPS berhasil disinkronkan!${COLOR_RESET}"

# --- 6. Eksekusi Deploy Remote di VPS ---
echo -e "\n${COLOR_BLUE}[5/6] Menjalankan deployment di server VPS...${COLOR_RESET}"
$SSH_CMD "${SSH_COMMON_OPTS[@]}" "${SSH_KEY_PARAM[@]}" "${VPS_USER}@${VPS_HOST}" "cd ${VPS_DEPLOY_DIR} && export DOCKERHUB_USERNAME=${DOCKERHUB_USERNAME} && export DOCKERHUB_REPO=${DOCKERHUB_REPO} && export IMAGE_TAG=${TAG} && export DOCKER_IMAGE=${FULL_IMAGE_NAME} && echo '>> Melakukan pull image dari Docker Hub...' && docker compose -f docker-compose.prod.yml pull && echo '>> Menyalakan / me-restart container...' && docker compose -f docker-compose.prod.yml up -d --remove-orphans && echo '>> Membersihkan image lama...' && docker image prune -f && sleep 3 && echo '>> Status Container:' && docker compose -f docker-compose.prod.yml ps"

# --- 7. Verifikasi Akhir & Ringkasan ---
echo -e "\n${COLOR_BLUE}[6/6] Verifikasi status deployment...${COLOR_RESET}"
PORT_VALUE="${PORT:-3001}"
echo -e "${COLOR_GREEN}${COLOR_BOLD}"
echo "================================================================"
echo "           🎉 DEPLOYMENT PRODUCTION BERHASIL!                  "
echo "================================================================"
echo -e "${COLOR_RESET}"
echo -e "Aplikasi siap diakses di:"
echo -e "🔗 URL             : ${COLOR_CYAN}${COLOR_BOLD}http://${VPS_HOST}:${PORT_VALUE}${COLOR_RESET}"
echo -e "📦 Docker Hub Image: ${FULL_IMAGE_NAME}"
echo -e "📁 Direktori VPS   : ${VPS_DEPLOY_DIR}"
echo -e "💾 Data Persisten  : ${VPS_DEPLOY_DIR}/data (Aman & Tersimpan)"
echo ""
echo -e "Perintah monitoring di VPS:"
echo -e "  - Cek Log Realtime : ${COLOR_YELLOW}ssh ${VPS_USER}@${VPS_HOST} 'cd ${VPS_DEPLOY_DIR} && docker compose -f docker-compose.prod.yml logs -f'${COLOR_RESET}"
echo -e "  - Cek Status       : ${COLOR_YELLOW}ssh ${VPS_USER}@${VPS_HOST} 'cd ${VPS_DEPLOY_DIR} && docker compose -f docker-compose.prod.yml ps'${COLOR_RESET}"
echo "================================================================"