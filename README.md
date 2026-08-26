# 🌐 Panorama Lens Trip — AI Article Generator & Manager Tool

> **Platform Otomasi Pembuatan Artikel SEO Long-Form (2000+ Kata), Generator Image SEO Metadata, Editorial Calendar, & Auto-Publish WordPress Berbasis Google Gemini AI.**

---

## 📖 Daftar Isi
- [✨ Fitur Utama](#-fitur-utama)
- [🏗️ Arsitektur Teknologi](#️-arsitektur-teknologi)
- [📂 Struktur Proyek](#-struktur-proyek)
- [🚀 Panduan Instalasi & Menjalankan Lokal](#-panduan-instalasi--menjalankan-lokal)
- [🐳 Menjalankan dengan Docker](#-menjalankan-dengan-docker)
- [🚢 Panduan Auto-Deploy ke Server VPS](#-panduan-auto-deploy-ke-server-vps)
- [🔄 Backup & Sinkronisasi Data (Lokal <-> VPS)](#-backup--sinkronisasi-data-lokal---vps)
- [🔒 Manajemen Kredensial & Autentikasi](#-manajemen-kredensial--autentikasi)
- [📑 Dokumentasi Lengkap](#-dokumentasi-lengkap)

---

## ✨ Fitur Utama

### 1. ✍️ AI Long-Form Article Generation (2000+ Kata)
- **Struktur Komprehensif**: Outline otomatis, pengantar mendalam, sub-bab berbasis H2/H3, dan kesimpulan bernilai tinggi.
- **Optimasi SEO Mendalam**: Menghitung kepadatan kata kunci (*keyphrase density*), meta title, meta description, slug URL, tags, dan excerpt secara otomatis.
- **Integrasi Call-To-Action (CTA)**: Tombol WhatsApp & link CTA dinamis yang dapat disesuaikan untuk kebutuhan bisnis Panorama Lens Trip.
- **Section Updater & Rewriter**: Memperbarui atau menambahkan bagian baru pada artikel lama tanpa menulis ulang dari awal.

### 2. 🖼️ AI Image SEO Metadata Generator
- **Multi-Image Upload & Canvas Compression**: Kompresi gambar otomatis di sisi browser sebelum diunggah ke server.
- **Analisis AI Visual**: Mengisi *Alt Text, Title, Caption, Description*, dan *Scene Location* otomatis untuk mendominasi Google Image Search.
- **Ekspor Cepat**: Salin Alt Text instan atau download metadata gambar format `.meta.txt`.

### 3. 📅 Editorial Calendar & Article Manager
- **Status Alur Kerja**: Pelacakan status *Draft, Scheduled, Published*.
- **Kalender Interaktif**: Visualisasi jadwal rilis artikel bulanan dengan fitur *drag/reschedule*.
- **WordPress Integration**: Publikasi artikel langsung ke website WordPress via REST API & Application Password.

### 4. 👥 Sistem Autentikasi Berbasis Peran (RBAC)
- **Role Admin**: Akses penuh ke pengaturan API key, konfigurasi WordPress, prompt sistem, dan manajemen user.
- **Role User/Editor**: Fokus pada pembuatan konten, antrean artikel, dan kalender editorial.

### 5. 🛠️ DevOps & Auto-Deployment Cerdas
- **Build Lokal & Push ke Docker Hub**: Hemat CPU/RAM server VPS (aman untuk VPS 1GB/2GB).
- **Persistent Volume (`./data`)**: Seluruh database JSON dan gambar uploads tidak akan hilang saat container diperbarui.
- **Auto-Sync & Backup Script**: Utilitas 1-klik untuk sinkronisasi dua arah data lokal dan VPS.

---

## 🏗️ Arsitektur Teknologi

```
+-----------------------------------------------------------------------+
|                           FRONTEND (SPA)                             |
|  HTML5 Semantik • Vanilla CSS (Glassmorphism & Dark Mode) • Vite 6   |
|  Marked.js (Markdown Renderer) • Client-side Canvas Image Compressor   |
+-----------------------------------------------------------------------+
                                  │ (HTTP / SSE Streams)
                                  ▼
+-----------------------------------------------------------------------+
|                           BACKEND SERVER                              |
|  Node.js (v20) • Express.js • Server-Sent Events (SSE Realtime Stream)|
|  Cheerio (Scraping & Research) • Multer/FS Data Storage Manager       |
+-----------------------------------------------------------------------+
                                  │
         ┌────────────────────────┴────────────────────────┐
         ▼                                                 ▼
+──────────────────+                             +──────────────────+
|  AI & API CLOUD  |                             | PERSISTENT STORE |
| Google Gemini AI |                             | ./data/ JSON DB  |
| OpenAI (Opsional)|                             | ./data/uploads/  |
| WordPress REST   |                             +──────────────────+
+──────────────────+
```

---

## 📂 Struktur Proyek

```text
Panorama-Lens-Trip-Article-Tool/
├── data/                         # Direktori database JSON & file uploads (persisten)
│   ├── admin_settings.json       # Pengaturan API key, CTA, prompt, WP config
│   ├── article_manager.json      # Database kalender & status artikel
│   ├── articles.json             # Database antrean artikel
│   └── uploads/                  # Berkas gambar artikel yang diunggah
├── src/
│   ├── main.js                   # Logika frontend utama (SPA Controller)
│   └── style.css                 # Sistem desain responsif, modern, dark/light theme
├── backups/                      # Folder arsip otomatis data production
├── index.html                    # Kerangka antarmuka utama aplikasi
├── server.js                     # Backend API server (Express + Gemini + Auth + WP)
├── Dockerfile                    # Multi-stage build container production
├── docker-compose.yml            # Konfigurasi Docker compose lokal
├── docker-compose.prod.yml       # Konfigurasi Docker compose production (VPS)
├── deploy.sh                     # Auto-deploy script untuk Linux / macOS / WSL
├── deploy.ps1                    # Auto-deploy script untuk Windows PowerShell
├── sync-data.sh                  # Backup & sync script untuk Linux / macOS / WSL
├── sync-data.ps1                 # Backup & sync script untuk Windows PowerShell
├── setup-vps.sh                  # Script inisialisasi Docker & Firewall server VPS
├── .env.deploy.example           # Template konfigurasi deployment
├── .env.production.example       # Template environment variable server production
├── DEPLOY_GUIDE.md               # Panduan deployment VPS detail
└── DOCUMENTATION.md              # Dokumentasi teknis lengkap & API reference
```

---

## 🚀 Panduan Instalasi & Menjalankan Lokal

### Prasyarat:
- Node.js (v18 atau v20 LTS disarankan)
- npm (bawaan Node.js)
- Kunci API Google Gemini ([Dapatkan di Google AI Studio](https://aistudio.google.com/apikey))

### Langkah-langkah:
1. **Clone repository & masuk ke direktori**:
   ```bash
   git clone <URL_REPO_ANDA>
   cd Panorama-Lens-Trip-Article-Tool
   ```

2. **Install dependensi**:
   ```bash
   npm install
   ```

3. **Jalankan dalam mode Development**:
   ```bash
   npm run dev
   ```
   Aplikasi akan aktif di:
   - Frontend Vite: `http://localhost:3000` (atau IP lokal Anda di port 3000)
   - Backend API: `http://localhost:3001`

---

## 🐳 Menjalankan dengan Docker

Untuk menjalankan secara instan di lingkungan container lokal:

```bash
# Menjalankan container di background
docker compose up -d --build

# Melihat log container
docker compose logs -f

# Menghentikan container
docker compose down
```
Aplikasi siap diakses di `http://localhost:3001`.

---

## 🚢 Panduan Auto-Deploy ke Server VPS

Aplikasi ini dilengkapi alur deployment otomatis (**Local Build → Push Docker Hub → Pull & Run di VPS**):

1. **Siapkan berkas konfigurasi deploy**:
   ```bash
   cp .env.deploy.example .env.deploy
   cp .env.production.example .env.production
   ```
   Isi IP VPS, username SSH, dan username Docker Hub di `.env.deploy`.

2. **Login ke Docker Hub (Sekali Saja)**:
   ```bash
   docker login
   ```

3. **Eksekusi Auto-Deploy**:
   - **Windows PowerShell**:
     ```powershell
     .\deploy.ps1
     ```
   - **Linux / WSL / macOS**:
     ```bash
     ./deploy.sh
     ```

Panduan lengkap instalasi VPS dari nol tersedia di [**`DEPLOY_GUIDE.md`**](file:///home/ramadhani/Panorama-Lens-Trip-Article-Tool/DEPLOY_GUIDE.md).

---

## 🔄 Backup & Sinkronisasi Data (Lokal <-> VPS)

Anda dapat mentransfer seluruh database artikel dan gambar uploads kapan saja tanpa perlu deploy ulang:

### Download/Backup Data VPS ke Komputer Lokal (Pull):
```bash
# Windows PowerShell
.\sync-data.ps1 -Pull

# Linux / WSL
./sync-data.sh --pull
```

### Upload Data Lokal ke VPS (Push):
```bash
# Windows PowerShell
.\sync-data.ps1 -Push

# Linux / WSL
./sync-data.sh --push
```

---

## 🔒 Manajemen Kredensial & Autentikasi

### Kredensial Default:
- **Admin**: `admin` / Password default dapat diubah di menu Pengaturan.
- **User**: `user` / Password default dapat diubah di menu Pengaturan.

Kredensial production dapat dikonfigurasi melalui environment variables di `.env.production`:
- `ADMIN_USERNAME` & `ADMIN_PASSWORD`
- `USER_USERNAME` & `USER_PASSWORD`
- `GEMINI_API_KEY`
- `WP_URL`, `WP_USERNAME`, `WP_APPLICATION_PASSWORD`

---

## 📑 Dokumentasi Lengkap
Pelajari dokumentasi teknis mendalam, skema REST API, arsitektur data, dan panduan penggunaan di [**`DOCUMENTATION.md`**](file:///home/ramadhani/Panorama-Lens-Trip-Article-Tool/DOCUMENTATION.md).