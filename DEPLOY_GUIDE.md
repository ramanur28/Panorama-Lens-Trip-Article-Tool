# 📘 Panduan Auto-Deploy & Sinkronisasi Data (Lokal <-> VPS)

Dokumen ini menjelaskan alur kerja, langkah deployment, dan cara melakukan backup serta sinkronisasi data artikel & gambar antara komputer lokal dan server production VPS.

---

## 🏗️ Alur Kerja (Workflow)

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

---

## 💾 Cara Backup & Sinkronisasi Data (Lokal <-> VPS)

Telah disediakan skrip khusus **`sync-data.sh`** (Linux/WSL) dan **`sync-data.ps1`** (Windows PowerShell) untuk transfer data tanpa perlu melakukan build atau deploy ulang:

### 1. Download / Backup Data dari VPS ke Komputer Lokal (Pull):
Menyalin seluruh artikel, pengaturan, dan folder gambar `uploads/` dari VPS ke komputer lokal, serta membuat arsip di folder `backups/data_YYYYMMDD_HHMMSS/`.

- **Di Windows PowerShell:**
  ```powershell
  .\sync-data.ps1 -Pull
  ```
- **Di Linux / WSL / Git Bash:**
  ```bash
  ./sync-data.sh --pull
  ```

---

### 2. Kirim / Sinkronkan Data dari Komputer Lokal ke VPS (Push):
Mengunggah data artikel, pengaturan, dan gambar `uploads/` lokal ke server VPS produksi.

- **Di Windows PowerShell:**
  ```powershell
  .\sync-data.ps1 -Push
  ```
- **Di Linux / WSL / Git Bash:**
  ```bash
  ./sync-data.sh --push
  ```

---

## 🚢 Panduan Menjalankan Auto-Deploy Aplikasi

### 1. Konfigurasi Awal
1. Salin template konfigurasi:
   ```bash
   cp .env.deploy.example .env.deploy
   cp .env.production.example .env.production
   ```
2. Isi detail server VPS dan Docker Hub pada `.env.deploy`.
3. Isi password dan API Key pada `.env.production`.

### 2. Jalankan Auto-Deploy
- **Di Windows PowerShell:**
  ```powershell
  .\deploy.ps1
  ```
- **Di Linux / WSL / Git Bash:**
  ```bash
  ./deploy.sh
  ```

### 3. Opsi Tambahan Deploy:
- **Deploy dengan Custom Tag Rilis**:
  ```bash
  ./deploy.sh --tag v1.0.0
  # PowerShell: .\deploy.ps1 -Tag v1.0.0
  ```
- **Sinkronisasi Ulang Environment Variables (.env.production)**:
  ```bash
  ./deploy.sh --sync-env
  # PowerShell: .\deploy.ps1 -SyncEnv
  ```
- **Deploy Cepat Remote (Skip Build Lokal)**:
  ```bash
  ./deploy.sh --skip-build
  # PowerShell: .\deploy.ps1 -SkipBuild
  ```

---

## 🔍 Monitoring di Server VPS

Setelah aplikasi aktif di `http://IP_VPS_ANDA:3001`:

```bash
ssh -i ~/.ssh/ramadhani.pem ramadhani@IP_VPS_ANDA
cd /var/www/ramadhani/panorama-article-tool

# Cek status container
docker compose -f docker-compose.prod.yml ps

# Cek logs realtime
docker compose -f docker-compose.prod.yml logs -f --tail=100

# Restart container
docker compose -f docker-compose.prod.yml restart
```