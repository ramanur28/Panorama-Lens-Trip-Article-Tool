# 📚 Dokumentasi Teknis & Panduan Lengkap: Panorama Lens Trip Article Tool

Dokumen ini berisi spesifikasi teknis, referensi API lengkap, arsitektur data, panduan penggunaan, serta prosedur operasional untuk platform **Panorama Lens Trip Article Tool / Gemini Article Generator**.

---

## 📑 Daftar Isi
1. [Arsitektur & Alur Kerja Sistem](#1-arsitektur--alur-kerja-sistem)
2. [Spesifikasi REST API Server](#2-spesifikasi-rest-api-server)
3. [Struktur Data & Skema JSON](#3-struktur-data--skema-json)
4. [Sistem Autentikasi & Keamanan (RBAC)](#4-sistem-autentikasi--keamanan-rbac)
5. [Panduan Pengguna (User Manual)](#5-panduan-pengguna-user-manual)
6. [Panduan Administrator](#6-panduan-administrator)
7. [Integrasi WordPress REST API](#7-integrasi-wordpress-rest-api)
8. [DevOps, Deployment, & Troubleshooting](#8-devops-deployment--troubleshooting)

---

## 1. Arsitektur & Alur Kerja Sistem

Aplikasi dibangun dengan arsitektur **Single Page Application (SPA) Full-Stack**:
- **Frontend**: Menggunakan HTML5, Vanilla JavaScript modern (ES Modules), dan Vanilla CSS yang diperkaya tema *Light/Dark Mode* serta efek *Glassmorphism*. Dibundel secara optimal menggunakan Vite.
- **Backend**: Express.js server yang bertindak sebagai *API Gateway*, proxy aman ke Google Gemini AI, manajer persistensi data berbasis file JSON, dan jembatan publikasi ke WordPress.
- **Komunikasi Realtime**: Menggunakan **Server-Sent Events (SSE)** untuk streaming teks artikel dan proses komputasi AI secara realtime ke antarmuka pengguna tanpa memblokir koneksi HTTP standar.

```
+-----------------------------------------------------------------------------------+
|                                CLIENT BROWSER (SPA)                               |
| - Auth Gateway Modal          - Article Generation Studio    - Image SEO Studio   |
| - Editorial Calendar UI       - Article Manager Grid         - Admin Settings     |
+-----------------------------------------------------------------------------------+
                                          │
                   ┌──────────────────────┴──────────────────────┐
                   │ HTTP JSON (CRUD)           SSE Streams (AI) │
                   ▼                                             ▼
+-----------------------------------------------------------------------------------+
|                               EXPRESS.JS API SERVER                               |
| - Session Store (Auth RBAC)   - Prompt Builder & Pipeline    - WP REST Client     |
| - Static Assets Middleware    - Data Persist Handler (FS)    - Upload Controller  |
+-----------------------------------------------------------------------------------+
       │                                     │                         │
       ▼                                     ▼                         ▼
 [Google Gemini API]               [Persistent Storage]       [WordPress REST API]
 - gemini-2.0-flash / 1.5          - data/articles.json       - wp/v2/posts
 - Multimodal Vision               - data/admin_settings.json - Application Passwords
                                   - data/article_manager.json
                                   - data/uploads/*
```

---

## 2. Spesifikasi REST API Server

Seluruh endpoint API berada di bawah path `/api/`. Endpoint yang memerlukan autentikasi mewajibkan header:
`Authorization: Bearer <SESSION_TOKEN>`

### A. Autentikasi (`/api/auth`)

#### 1. `POST /api/auth/login`
Memverifikasi kredensial pengguna dan mengembalikan token sesi aktif.
- **Request Body**:
  ```json
  {
    "username": "admin",
    "password": "your_password"
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "success": true,
    "token": "af_xxxxxxxxxxxxxxxxxxxxxx",
    "user": {
      "username": "admin",
      "role": "admin",
      "name": "Administrator"
    }
  }
  ```

#### 2. `GET /api/auth/status`
Memeriksa apakah token sesi saat ini masih valid.
- **Response (200 OK)**:
  ```json
  {
    "authenticated": true,
    "user": {
      "username": "admin",
      "role": "admin",
      "name": "Administrator"
    }
  }
  ```

#### 3. `POST /api/auth/logout`
Menghapus sesi aktif dari memory store server.

#### 4. `POST /api/auth/change-password` *(Requires Auth)*
Mengubah password untuk akun yang sedang login atau akun yang ditentukan oleh Admin.
- **Request Body**:
  ```json
  {
    "targetUsername": "user",
    "oldPassword": "current_password",
    "newPassword": "new_strong_password"
  }
  ```

---

### B. Pengaturan Sistem (`/api/settings`)

#### 1. `GET /api/settings`
Mengambil konfigurasi global aplikasi (API key, custom prompt, CTA link, pengaturan WordPress).

#### 2. `POST /api/settings` *(Requires Admin)*
Menyimpan pembaruan konfigurasi global ke `data/admin_settings.json`.
- **Request Body**:
  ```json
  {
    "apiKey": "your-gemini-api-key",
    "openaiKey": "your-openai-api-key",
    "ctaLink": "https://wa.me/+6282132838229?text=Hello",
    "wpUrl": "https://panoramalenstrip.com",
    "wpUsername": "admin@domain.com",
    "wpAppPassword": "xxxx xxxx xxxx xxxx",
    "customPrompt": "Tulis dengan gaya bahasa profesional dan ramah...",
    "audience": "Travelers, Photographers",
    "brand": "Panorama Lens Trip"
  }
  ```

---

### C. Pembuatan Artikel & AI Streams (`/api/generate`)

#### 1. `POST /api/generate` *(Requires Auth - SSE Stream)*
Memicu pembuatan artikel long-form lengkap (2000+ kata) secara streaming via Gemini.
- **Request Body**:
  ```json
  {
    "title": "Panduan Lengkap Wisata Bromo 2026",
    "keyphrase": "wisata bromo",
    "secondaryKeywords": "sewa jeep bromo, tiket bromo, sunrise bromo",
    "tone": "informative",
    "targetWordCount": 2200,
    "images": [
      {
        "url": "http://103.175.217.71:3001/uploads/img_xxx.jpg",
        "altText": "Pemandangan Sunrise Gunung Bromo",
        "caption": "Spot terbaik melihat sunrise di Bromo"
      }
    ],
    "quotes": ["Menurut pemandu lokal, waktu terbaik datang adalah musim kemarau."]
  }
  ```
- **SSE Events Dispatched**:
  - `status`: `{ "message": "Merancang outline artikel..." }`
  - `chunk`: `{ "text": "## Pengantar\nGunung Bromo merupakan..." }`
  - `complete`: `{ "article": "...", "wordCount": 2340, "tokenUsage": { "totalTokens": 4500 } }`
  - `error`: `{ "message": "Deskripsi error..." }`

---

### D. Image SEO Metadata AI (`/api/generate-image-seo`)

#### 1. `POST /api/generate-image-seo` *(Requires Auth - SSE Stream)*
Menganalisis gambar menggunakan model multimodal Gemini untuk menghasilkan metadata SEO.
- **Request Body**:
  ```json
  {
    "articleTitle": "Eksplorasi Keindahan Kawah Ijen",
    "targetKeywords": "blue fire kawah ijen, sewa gas mask",
    "imageBase64": "data:image/jpeg;base64,...",
    "imageIndex": 0,
    "isFeatured": true
  }
  ```
- **Response**: Mengembalikan data JSON berstruktur: `fileName`, `altText`, `title`, `caption`, `description`, `location`.

---

### E. Manajemen Media & Upload (`/api/upload`)

#### 1. `POST /api/upload` *(Requires Auth)*
Menyimpan gambar Base64 ke direktori persisten server `/app/data/uploads/` dan mengembalikan URL publik.
- **Request Body**:
  ```json
  {
    "imageBase64": "data:image/jpeg;base64,..."
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "success": true,
    "url": "/uploads/img_1784990907258_c0sd0z.jpeg",
    "fileName": "img_1784990907258_c0sd0z.jpeg"
  }
  ```

---

### F. Publikasi WordPress (`/api/publish-wordpress`)

#### 1. `POST /api/publish-wordpress` *(Requires Auth)*
Menerbitkan artikel secara otomatis ke situs WordPress tujuan.
- **Request Body**:
  ```json
  {
    "title": "Panduan Sunrise Bromo",
    "content": "<h1>Panduan Sunrise Bromo</h1><p>...</p>",
    "status": "publish", // atau "draft" / "future"
    "scheduledDate": "2026-09-01T08:00:00",
    "tags": ["Bromo", "Jawa Timur"],
    "categories": [1, 5]
  }
  ```

---

## 3. Struktur Data & Skema JSON

Seluruh data aplikasi disimpan di folder `./data/` yang di-mount secara persisten di Docker VPS:

### 1. `data/admin_settings.json`
Menyimpan konfigurasi server dan kredensial eksternal:
```json
{
  "apiKey": "your-gemini-api-key",
  "openaiKey": "",
  "ctaLink": "https://wa.me/+6282132838229?text=Hello+Panorama+Lens+Trip%21",
  "audience": "Travelers, Nature Photographers",
  "brand": "Panorama Lens Trip",
  "customPrompt": "",
  "wpUrl": "https://panoramalenstrip.com",
  "wpUsername": "admin@domain.com",
  "wpAppPassword": "xxxx xxxx xxxx xxxx"
}
```

### 2. `data/articles.json`
Menyimpan antrean artikel dalam studio pembuatan:
```json
[
  {
    "id": "art_1784174532",
    "title": "10 Spot Foto Terbaik di Bromo",
    "keyphrase": "spot foto bromo",
    "status": "completed",
    "wordCount": 2150,
    "article": "# 10 Spot Foto Terbaik...\n\n...",
    "images": [],
    "createdAt": "2026-08-25T14:30:00.000Z"
  }
]
```

### 3. `data/article_manager.json`
Menyimpan database kalender editorial dan status publikasi:
```json
[
  {
    "id": "mgr_1784204880",
    "title": "Panduan Sewa Jeep Bromo Murah",
    "category": "Tips Wisata",
    "status": "Scheduled",
    "scheduledDate": "2026-08-30",
    "author": "admin",
    "wpPostId": null
  }
]
```

---

## 4. Sistem Autentikasi & Keamanan (RBAC)

Platform menggunakan sistem Role-Based Access Control:

| Fitur / Tindakan | Role: Administrator | Role: Standard User / Editor |
|---|:---:|:---:|
| Membuat Artikel Baru (Single & Batch) | ✅ | ✅ |
| Optimasi Image SEO & Upload Media | ✅ | ✅ |
| Mengelola Antrean Artikel | ✅ | ✅ |
| Mengatur Kalender Editorial & Publish WP | ✅ | ✅ |
| Mengubah Password Akun Pribadi | ✅ | ✅ |
| Mengubah Password Pengguna Lain | ✅ | ❌ |
| Mengubah API Key Gemini & OpenAI | ✅ | ❌ |
| Mengubah Konfigurasi WordPress | ✅ | ❌ |
| Mengubah CTA Link Global & System Prompt | ✅ | ❌ |

---

## 5. Panduan Pengguna (User Manual)

### A. Membuat Artikel SEO Baru
1. Masuk ke aplikasi dan pilih tab **Article Generator**.
2. Isi **Main Title** (Judul Artikel) dan **Focus Keyphrase** (Kata Kunci Utama).
3. (Opsional) Tambahkan *Secondary Keywords*, *Target Audience*, dan *Expert Quotes*.
4. Klik **Generate Article**. Pantau proses streaming realtime di panel editor.
5. Setelah selesai, Anda dapat:
   - Menyalin teks langsung (**Copy Article**).
   - Mengunduh sebagai berkas Markdown (**Download .md**).
   - Mengirim ke antrean publikasi WordPress.

### B. Menggunakan Section Updater (Rewriter)
1. Buka tab **Section Updater**.
2. Tempel artikel yang sudah ada di kolom teks sumber.
3. Tulis instruksi bagian yang ingin diubah atau ditambahkan (misal: *"Tambahkan sub-bab tentang rincian biaya tiket masuk terbaru 2026"*).
4. Klik **Rewrite Section** untuk memperbarui konten tanpa merusak struktur artikel yang sudah ada.

### C. Optimasi SEO Gambar
1. Pada form pembuatan artikel, klik area **Upload Images**.
2. Pilih satu atau beberapa gambar. Gambar akan dikompresi otomatis di browser.
3. Klik tombol **AI Analyze Image** pada kartu gambar.
4. Gemini AI akan mengisi *Alt Text, Title, Caption*, dan *Description* secara otomatis.
5. Klik **Download Meta** untuk menyimpan metadata teks pendukung.

---

## 6. Panduan Administrator

### Mengatur Kunci API & CTA Link:
1. Login dengan akun Administrator.
2. Klik tombol **Settings** (ikon roda gigi) di pojok kanan atas.
3. Masukkan **Gemini API Key** Anda.
4. Atur **CTA Button Link** (misalnya tautan langsung ke nomor WhatsApp tim reservasi Panorama Lens Trip).
5. Klik **Save Settings**. Pengaturan akan disimpan secara permanen di server.

---

## 7. Integrasi WordPress REST API

### Cara Membuat Application Password di WordPress:
1. Login ke Dashboard WordPress Anda (`https://panoramalenstrip.com/wp-admin`).
2. Buka menu **Users** → **Profile** (atau Pengguna → Profil Anda).
3. Gulir ke bawah ke bagian **Application Passwords**.
4. Masukkan nama aplikasi (misal: `Panorama Article Tool`), lalu klik **Add New Application Password**.
5. Salin kode password yang muncul (format: `xxxx xxxx xxxx xxxx`).
6. Masukkan URL WordPress, Username, dan Application Password ke menu **Settings** di platform ini.

---

## 8. DevOps, Deployment, & Troubleshooting

### A. Perintah Cepat Auto-Deploy
- **Windows PowerShell**: `.\deploy.ps1`
- **Linux / WSL**: `./deploy.sh`

### B. Perintah Backup & Restore Data
- **Download/Backup dari VPS ke Lokal**: `.\sync-data.ps1 -Pull` (atau `./sync-data.sh --pull`)
- **Upload Data Lokal ke VPS**: `.\sync-data.ps1 -Push` (atau `./sync-data.sh --push`)

### C. Troubleshooting Masalah Umum

#### 1. Error: `Permission denied (publickey)` saat deploy
- Pastikan file kunci SSH (`.pem` / `id_rsa`) berada di direktori `C:\Users\<Username>\.ssh\` (Windows) atau `~/.ssh/` (Linux).
- Pastikan `VPS_USER` dan `VPS_HOST` pada `.env.deploy` sudah sesuai dengan data VPS Anda.

#### 2. Error: `pull access denied for repository`
- Terjadi jika Anda belum login ke Docker Hub di komputer lokal.
- Jalankan perintah: `docker login` dan masukkan kredensial Docker Hub Anda.

#### 3. Gambar tidak tampil setelah diunggah
- Pastikan folder `/var/www/ramadhani/panorama-article-tool/data/uploads` di server VPS memiliki izin baca/tulis.
- Jalankan di terminal VPS: `sudo chmod -R 777 /var/www/ramadhani/panorama-article-tool/data`.