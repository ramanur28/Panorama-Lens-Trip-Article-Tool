# Panduan Instalasi & Deployment di Shared Hosting (cPanel)
## Panorama Lens Trip - Article Tool (PHP + MySQL Edition)

Versi ini dirancang khusus agar dapat berjalan 100% pada **Shared Hosting standar (cPanel, DirectAdmin, CyberPanel, dll.)** tanpa memerlukan Node.js, PM2, Docker, ataupun proses build `npm/vite`.

---

### 📋 Prasyarat Server Hosting
- **PHP Version**: PHP 7.4, 8.0, 8.1, 8.2, atau 8.3
- **Ekstensi PHP Standar**:
  - `pdo_mysql` (koneksi database)
  - `curl` (komunikasi AI & WordPress REST API)
  - `json` & `mbstring` (pemrosesan data)
  - `fileinfo` & `gd` (pengelolaan gambar)
- **Database**: MySQL 5.7+ atau MariaDB 10.3+
- **Web Server**: Apache dengan modul `mod_rewrite` aktif (bawaan 99.9% hosting cPanel)

---

### 🚀 Langkah 1: Buat Database MySQL di cPanel
1. Masuk ke **cPanel Dashboard** akun hosting Anda.
2. Cari dan buka menu **MySQL® Databases** atau **MySQL® Database Wizard**.
3. **Buat Database Baru**, misalnya: `username_panorama` (catat nama database ini).
4. **Buat Pengguna MySQL Baru**, misalnya: `username_dbuser` dan masukkan kata sandi yang kuat (catat username & password ini).
5. **Tambahkan User ke Database**, lalu centang pilihan **ALL PRIVILEGES** dan klik *Make Changes*.

---

### 📥 Langkah 2: Import Skema & Data Awal (`database.example.sql`)
1. Di cPanel, buka menu **phpMyAdmin**.
2. Pilih database yang baru Anda buat di panel sebelah kiri.
3. Klik tab **Import** di bagian atas.
4. Klik tombol **Choose File** / *Pilih File*, lalu pilih berkas `database.example.sql` yang ada di dalam folder aplikasi ini.
5. Klik tombol **Import** (atau *Go*) di bagian bawah.
6. Tunggu hingga muncul notifikasi hijau sukses.
   > 💡 **Catatan**: Berkas `database.example.sql` ini sudah mencakup **157 artikel bawaan**, skema antrean, pengaturan sistem, dan akun login default!

---

### 📂 Langkah 3: Upload Berkas ke File Manager
1. Di komputer lokal Anda, kompres seluruh isi folder `php-version/` menjadi format `.zip`.
2. Buka **File Manager** di cPanel hosting Anda.
3. Masuk ke folder tujuan:
   - Jika ingin diakses di domain utama: masuk ke `public_html/`
   - Jika ingin diakses di subdomain / subfolder: buat folder, misalnya `public_html/article-tool/`
4. Klik **Upload**, lalu unggah berkas zip tersebut.
5. Klik kanan pada berkas zip yang telah diunggah di File Manager, lalu pilih **Extract**.
6. Pastikan berkas `.htaccess` ikut ter-upload (aktifkan opsi *Show Hidden Files (dotfiles)* di Settings File Manager jika belum terlihat).

---

### ⚙️ Langkah 4: Sesuaikan `config.php`
1. Di File Manager cPanel, klik kanan pada file `config.php` lalu pilih **Edit**.
2. Sesuaikan baris koneksi database dengan kredensial cPanel yang telah dibuat pada Langkah 1:

```php
define('DB_HOST', 'localhost');              // Umumnya tetap 'localhost' di cPanel
define('DB_NAME', 'username_panorama');       // Nama database Anda
define('DB_USER', 'username_dbuser');         // Username database Anda
define('DB_PASS', 'PasswordDatabaseAnda123'); // Password user database Anda
define('DB_PORT', '3306');
```
3. Klik **Save Changes**.

---

### 🔒 Langkah 5: Atur Izin Folder `uploads/`
1. Pastikan folder `uploads/` memiliki izin tulis (*write permission*).
2. Di File Manager, periksa permission folder `uploads/`. Umumnya adalah `755` (atau `777` jika server Anda menggunakan konfigurasi izin tertentu).

---

### 🔑 Langkah 6: Login ke Aplikasi
Buka domain / URL hosting Anda di browser:
- **URL**: `https://namadomainanda.com/` (atau `https://namadomainanda.com/article-tool/`)
- **Kredensial Default**:
  - **Administrator**:
    - Username: `admin`
    - Password: `admin123`
  - **Standard User**:
    - Username: `user`
    - Password: `user123`

> ⚠️ **Penting**: Segera ubah kata sandi default Anda setelah login melalui modal profil / ganti password di kanan atas!

---

### 🛠️ Langkah 7: Pengaturan API Key & WordPress
1. Login dengan akun **Administrator**.
2. Klik tombol **Settings** (ikon roda gigi) di pojok kanan atas.
3. Masukkan:
   - **Google Gemini API Key** (dapatkan gratis di [Google AI Studio](https://aistudio.google.com/apikey))
   - **OpenAI API Key** (opsional jika menggunakan model GPT)
   - **WordPress Site URL**: misalnya `https://panoramalenstrip.com`
   - **WordPress Username**: username / email admin website WordPress Anda
   - **WordPress Application Password**: Application password WordPress (format: `xxxx xxxx xxxx xxxx`)
4. Klik tombol **Test WordPress Connection** untuk memverifikasi koneksi REST API.
5. Klik **Save Settings**.

---

### ❓ Troubleshooting Masalah Umum

#### 1. Error 404 pada pemanggilan API
- Pastikan modul Apache `mod_rewrite` aktif di hosting Anda.
- Pastikan berkas `.htaccess` berada di direktori root aplikasi yang sama dengan `index.php`.

#### 2. Streaming Real-Time (SSE) Tidak Berjalan Mulus
- Pada beberapa shared hosting dengan Nginx reverse proxy atau Cloudflare:
  - Header `X-Accel-Buffering: no` sudah disematkan otomatis di script `sse_helper.php`.
  - Jika menggunakan Cloudflare, pastikan buffer proxy dimatikan untuk path `/api/generate` atau nonaktifkan proxy orange cloud untuk subdomain alat ini.

#### 3. Gambar Tidak Tersimpan Saat Diunggah
- Pastikan folder `uploads/` ada dan memiliki permission `755` atau `777`.
- Periksa batas upload PHP di cPanel menu **Select PHP Version** -> **Options**:
  - `upload_max_filesize` disarankan minimal `16M`
  - `post_max_size` disarankan minimal `32M`
  - `max_execution_time` disarankan minimal `180` detik untuk penulisan artikel AI panjang.
