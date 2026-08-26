# 📘 Panduan Auto-Deploy ke Server Production (VPS) via Docker Hub

Dokumen ini menjelaskan alur kerja dan langkah demi langkah untuk melakukan auto-deployment aplikasi **Panorama Lens Trip Article Tool / Gemini Article Generator** ke server production VPS menggunakan Docker Hub dan Docker Compose.

---

## 🏗️ Alur Kerja & Manajemen Data Persisten

```
+---------------------+        +--------------------+        +---------------------+
|                     |  push  |                    |  pull  |                     |
|  Komputer Lokal     | -----> |     Docker Hub     | -----> |  Server Production  |
| (Build Image x86_64)|        |  (Image Registry)  |        |        (VPS)        |
+---------------------+        +--------------------+        +---------------------+
           |                                                            |
           |==================== SSH / SCP =============================|
             (Sinkronisasi Compose, Seed Data Awal & Perintah Restart)  |
                                                                        v
                                                            [📁 /opt/.../data]
                                                            (Persistent Volume)
                                                            - articles.json
                                                            - admin_settings.json
                                                            - article_manager.json
                                                            - uploads/
```

### 💾 Bagaimana Data Aplikasi Tetap Aman & Masih Ada?
1. **Docker Volume Bind Mount**: Folder `./data` di VPS dimounting langsung ke `/app/data` di dalam container (`docker-compose.prod.yml`). Saat container diperbarui/dihapus/di-restart, file JSON database dan gambar uploads di VPS **tidak akan hilang**.
2. **Auto-Seed Data Awal**: Pada saat pertama kali deploy ke VPS baru, script auto-deploy akan **secara otomatis menyalin data lokal** (`articles.json`, `admin_settings.json`, `article_manager.json`, folder `uploads/`) ke VPS sehingga aplikasi langsung memiliki data lengkap.
3. **Data Safety pada Redeploy**: Saat deploy berikutnya, script mendeteksi bahwa data sudah ada di VPS dan **tidak akan menimpanya**, sehingga data produksi terbaru yang dibuat di VPS tetap aman.
4. **Opsi Sinkronisasi Manual (`--sync-data`)**: Jika Anda ingin sengaja mengirim data lokal terbaru ke VPS.
5. **Opsi Backup Produksi (`--backup-data`)**: Anda dapat mengunduh seluruh data production VPS ke folder lokal `backups/` kapan saja.

---

## 📋 Prasyarat (Prerequisites)

1. **Komputer Lokal**:
   - Docker & Docker Compose sudah terpasang dan berjalan (Docker Desktop / Docker Engine).
   - Akses SSH ke VPS (IP publik, port SSH, username `root` atau `sudoer`).
2. **Akun Docker Hub**:
   - Akun di [hub.docker.com](https://hub.docker.com).
   - Login lokal: jalankan `docker login` di terminal lokal Anda sekali.
3. **Server Production (VPS)**:
   - OS Ubuntu 20.04/22.04/24.04 atau Debian.
   - Port `3001` (atau port web yang Anda pilih) dan port `22` (SSH) terbuka di firewall.

---

## 🚀 Langkah 1: Persiapan Server VPS (Hanya Sekali)

Jika VPS Anda masih baru dan belum memiliki Docker, Anda dapat menjalankan script instalasi otomatis `setup-vps.sh`.

### Opsi A (Otomatis dari Komputer Lokal):
Saat pertama kali Anda menjalankan `./deploy.sh`, script akan mendeteksi apakah Docker sudah terpasang di VPS. Jika belum, Anda akan ditawari opsi untuk memasangnya secara otomatis.

### Opsi B (Manual di Terminal VPS):
1. Salin script `setup-vps.sh` ke VPS:
   ```bash
   scp -P 22 setup-vps.sh root@IP_VPS_ANDA:/tmp/setup-vps.sh
   ```
2. Login ke VPS dan jalankan script:
   ```bash
   ssh root@IP_VPS_ANDA
   sudo bash /tmp/setup-vps.sh
   ```

---

## ⚙️ Langkah 2: Konfigurasi File Deploy Lokal

1. Buat file `.env.deploy` dari template:
   ```bash
   cp .env.deploy.example .env.deploy
   ```
2. Buka dan edit file `.env.deploy`:
   ```ini
   # Username Docker Hub Anda
   DOCKERHUB_USERNAME=username_dockerhub_anda
   DOCKERHUB_REPO=gemini-article-generator
   IMAGE_TAG=latest

   # Kredensial Server VPS
   VPS_HOST=103.123.45.67
   VPS_USER=root
   VPS_PORT=22
   # VPS_SSH_KEY=~/.ssh/id_rsa   # Opsional jika menggunakan SSH key

   # Direktori aplikasi di VPS
   VPS_DEPLOY_DIR=/opt/gemini-article-generator
   BUILD_PLATFORM=linux/amd64
   ```

3. Siapkan environment production:
   ```bash
   cp .env.production.example .env.production
   ```
   Edit password admin, API key Gemini, dan integrasi WordPress di `.env.production`.

---

## 🚢 Langkah 3: Menjalankan Auto-Deploy

### Di Linux / macOS / WSL (Ubuntu) / Git Bash:
```bash
# Berikan izin eksekusi script (hanya sekali)
chmod +x deploy.sh setup-vps.sh

# Jalankan auto-deploy (otomatis seed data awal jika VPS baru)
./deploy.sh
```

### Di Windows (PowerShell):
```powershell
.\deploy.ps1
```

---

## 🛠️ Opsi Perintah Tambahan

- **Paksa Sinkronisasi Data Lokal ke VPS:**
  ```bash
  ./deploy.sh --sync-data
  # PowerShell: .\deploy.ps1 -SyncData
  ```
- **Backup / Download Data Production VPS ke Komputer Lokal:**
  ```bash
  ./deploy.sh --backup-data
  # PowerShell: .\deploy.ps1 -BackupData
  ```
- **Deploy dengan Custom Tag Rilis:**
  ```bash
  ./deploy.sh --tag v1.0.0
  ```
- **Sinkronisasi Ulang Environment Variables (.env.production) ke VPS:**
  ```bash
  ./deploy.sh --sync-env
  ```
- **Hanya Deploy Remote tanpa Rebuild Lokal:**
  ```bash
  ./deploy.sh --skip-build
  ```

---

## 🔍 Langkah 4: Verifikasi & Monitoring di VPS

Setelah deployment selesai, aplikasi akan langsung aktif di:
`http://IP_VPS_ANDA:3001`

### Perintah Cepat Monitoring di VPS:
Login ke VPS:
```bash
ssh root@IP_VPS_ANDA
cd /opt/gemini-article-generator
```

- **Melihat Status Container**:
  ```bash
  docker compose -f docker-compose.prod.yml ps
  ```
- **Melihat Live Logs Aplikasi**:
  ```bash
  docker compose -f docker-compose.prod.yml logs -f --tail=100
  ```
- **Melihat File Data Persisten di VPS**:
  ```bash
  ls -la data/
  ```
- **Restart Container**:
  ```bash
  docker compose -f docker-compose.prod.yml restart
  ```
- **Stop Container**:
  ```bash
  docker compose -f docker-compose.prod.yml down
  ```