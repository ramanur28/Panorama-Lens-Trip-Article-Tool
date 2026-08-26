# ==============================================================================
# SCRIPT AUTO-DEPLOY POWERSHELL (WINDOWS)
# Panorama Lens Trip Article Tool / Gemini Article Generator
# Alur: Build Lokal -> Tag & Push Docker Hub -> Deploy ke VPS via Docker Compose
# ==============================================================================

[CmdletBinding()]
param(
    [string]$Tag = "",
    [string]$EnvFile = "",
    [switch]$SkipBuild,
    [switch]$SkipPush,
    [switch]$SyncEnv,
    [switch]$SyncData,
    [switch]$BackupData,
    [switch]$Help
)

if ($Help) {
    Write-Host "Penggunaan: .\deploy.ps1 [OPSI]" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Opsi:"
    Write-Host "  -Tag <tag_name>     Tentukan tag image (default: latest & timestamp)"
    Write-Host "  -EnvFile <path>     Gunakan file konfigurasi deploy khusus"
    Write-Host "  -SyncEnv            Kirim file .env.production lokal ke VPS sebagai .env"
    Write-Host "  -SyncData           Paksa sinkronisasi folder data lokal ke VPS (artikel, uploads, settings)"
    Write-Host "  -BackupData         Download dan backup data production dari VPS ke folder backups\"
    Write-Host "  -SkipBuild          Lewati build lokal (langsung deploy remote image yang ada)"
    Write-Host "  -SkipPush           Hanya build image lokal tanpa push ke Docker Hub"
    Write-Host "  -Help               Tampilkan bantuan ini"
    exit 0
}

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
Set-Location $ProjectRoot

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "    AUTO-DEPLOY: LOCAL BUILD -> DOCKER HUB -> VPS DEPLOY        " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Load File Konfigurasi
if ([string]::IsNullOrWhiteSpace($EnvFile)) {
    $EnvFile = Join-Path $ProjectRoot ".env.deploy"
}

if (-not (Test-Path $EnvFile)) {
    Write-Host "[!] File konfigurasi '$EnvFile' tidak ditemukan!" -ForegroundColor Yellow
    $ExampleFile = Join-Path $ProjectRoot ".env.deploy.example"
    if (Test-Path $ExampleFile) {
        Copy-Item $ExampleFile $EnvFile
        Write-Host "[*] File template '$EnvFile' telah dibuat." -ForegroundColor Green
        Write-Host "[!] Silakan isi detail Docker Hub dan VPS di '$EnvFile' terlebih dahulu!" -ForegroundColor Red
        exit 1
    } else {
        Write-Host "[ERROR] Template .env.deploy.example tidak ditemukan!" -ForegroundColor Red
        exit 1
    }
}

$DeployConfig = @{}
Get-Content $EnvFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#")) {
        $parts = $line.Split("=", 2)
        if ($parts.Count -eq 2) {
            $key = $parts[0].Trim()
            $val = $parts[1].Trim().Trim('"').Trim("'")
            $DeployConfig[$key] = $val
        }
    }
}

$DockerHubUser = $DeployConfig["DOCKERHUB_USERNAME"]
$DockerHubRepo = if ($DeployConfig["DOCKERHUB_REPO"]) { $DeployConfig["DOCKERHUB_REPO"] } else { "gemini-article-generator" }
$VPSHost = $DeployConfig["VPS_HOST"]
$VPSUser = if ($DeployConfig["VPS_USER"]) { $DeployConfig["VPS_USER"] } else { "root" }
$VPSPort = if ($DeployConfig["VPS_PORT"]) { $DeployConfig["VPS_PORT"] } else { "22" }
$VPSDeployDir = if ($DeployConfig["VPS_DEPLOY_DIR"]) { $DeployConfig["VPS_DEPLOY_DIR"] } else { "/opt/gemini-article-generator" }
$BuildPlatform = if ($DeployConfig["BUILD_PLATFORM"]) { $DeployConfig["BUILD_PLATFORM"] } else { "linux/amd64" }
$RawSSHKey = $DeployConfig["VPS_SSH_KEY"]

if ([string]::IsNullOrWhiteSpace($DockerHubUser) -or $DockerHubUser -eq "username_dockerhub_anda") {
    Write-Host "[ERROR] DOCKERHUB_USERNAME belum diatur di .env.deploy!" -ForegroundColor Red
    exit 1
}

if ([string]::IsNullOrWhiteSpace($VPSHost) -or $VPSHost -eq "103.xxx.xxx.xxx") {
    Write-Host "[ERROR] VPS_HOST belum diatur di .env.deploy!" -ForegroundColor Red
    exit 1
}

# Resolve SSH Key Path
$ResolvedSSHKey = ""
if (-not [string]::IsNullOrWhiteSpace($RawSSHKey)) {
    $PotentialPaths = @(
        $RawSSHKey,
        ($RawSSHKey -replace "^~", $HOME),
        ($RawSSHKey -replace "^~", "C:\Users\Ramadhani"),
        (Join-Path $HOME ".ssh\$($RawSSHKey -replace '^~[\\/]\.ssh[\\/]', '')"),
        "C:\Users\Ramadhani\.ssh\$($RawSSHKey -replace '^~[\\/]\.ssh[\\/]', '')",
        "\\wsl.localhost\Ubuntu\home\ramadhani\.ssh\$($RawSSHKey -replace '^~[\\/]\.ssh[\\/]', '')"
    )
    foreach ($p in $PotentialPaths) {
        if ($p -and (Test-Path $p)) {
            $ResolvedSSHKey = (Resolve-Path $p).Path
            break
        }
    }
}

$ReleaseTag = Get-Date -Format "yyyyMMdd_HHmmss"
$ImageTag = if (-not [string]::IsNullOrWhiteSpace($Tag)) { $Tag } elseif ($DeployConfig["IMAGE_TAG"]) { $DeployConfig["IMAGE_TAG"] } else { "latest" }

$FullImage = "${DockerHubUser}/${DockerHubRepo}:${ImageTag}"
$LatestImage = "${DockerHubUser}/${DockerHubRepo}:latest"
$TimestampImage = "${DockerHubUser}/${DockerHubRepo}:${ReleaseTag}"

Write-Host "[*] Konfigurasi Deploy:" -ForegroundColor Cyan
Write-Host "    - Docker Hub Image : $FullImage"
Write-Host "    - Target Platform  : $BuildPlatform"
Write-Host "    - VPS Target       : ${VPSUser}@${VPSHost}:${VPSPort}"
Write-Host "    - VPS Direktori    : $VPSDeployDir"
if ($ResolvedSSHKey) {
    Write-Host "    - SSH Key File     : $ResolvedSSHKey"
}
Write-Host ""

$SshArgs = @("-p", $VPSPort, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10")
$ScpArgs = @("-P", $VPSPort, "-o", "StrictHostKeyChecking=no")

if ($ResolvedSSHKey) {
    $SshArgs += @("-i", $ResolvedSSHKey)
    $ScpArgs += @("-i", $ResolvedSSHKey)
}

# 2. Test Koneksi SSH
Write-Host "[1/6] Menguji koneksi SSH ke VPS..." -ForegroundColor Cyan
$TestTarget = "${VPSUser}@${VPSHost}"
& ssh @SshArgs $TestTarget "echo 'SSH Connected'" | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Gagal terhubung ke VPS: ${VPSUser}@${VPSHost}:${VPSPort}" -ForegroundColor Red
    if ($ResolvedSSHKey) {
        Write-Host "SSH Key yang digunakan: $ResolvedSSHKey" -ForegroundColor Yellow
    }
    exit 1
}
Write-Host "[OK] Koneksi SSH berhasil!" -ForegroundColor Green
Write-Host ""

# Opsi Backup Data Production
if ($BackupData) {
    Write-Host "[*] Mengunduh backup data dari VPS..." -ForegroundColor Cyan
    $BackupDir = Join-Path $ProjectRoot "backups\data_$ReleaseTag"
    New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
    & scp -r @ScpArgs "${VPSUser}@${VPSHost}:${VPSDeployDir}/data/*" "$BackupDir"
    Write-Host "[OK] Backup data berhasil disimpan di: $BackupDir" -ForegroundColor Green
    exit 0
}

# 3. Build Docker Image Lokal
if (-not $SkipBuild) {
    Write-Host "[2/6] Membangun Docker Image secara lokal ($BuildPlatform)..." -ForegroundColor Cyan
    & docker build --platform $BuildPlatform -t $FullImage -t $LatestImage -t $TimestampImage -f Dockerfile .
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Gagal build Docker Image!" -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] Build Docker Image selesai!" -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host "[2/6] Melewati build lokal (-SkipBuild aktif)." -ForegroundColor Yellow
    Write-Host ""
}

# 4. Push ke Docker Hub
if (-not $SkipPush -and -not $SkipBuild) {
    Write-Host "[3/6] Mengunggah Image ke Docker Hub..." -ForegroundColor Cyan
    Write-Host "Mengunggah tag: $ImageTag"
    & docker push $FullImage
    if ($ImageTag -ne "latest") {
        Write-Host "Mengunggah tag: latest"
        & docker push $LatestImage
    }
    Write-Host "Mengunggah backup tag: $ReleaseTag"
    & docker push $TimestampImage
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Gagal push image ke Docker Hub! Pastikan Anda sudah 'docker login'." -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] Image berhasil diunggah ke Docker Hub!" -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host "[3/6] Melewati push Docker Hub (-SkipPush aktif)." -ForegroundColor Yellow
    Write-Host ""
}

# 5. Sinkronisasi File ke VPS
Write-Host "[4/6] Menyiapkan direktori dan menyinkronkan data/konfigurasi ke VPS..." -ForegroundColor Cyan
& ssh @SshArgs $TestTarget "mkdir -p $VPSDeployDir/data/uploads"

Write-Host "Mengirim docker-compose.prod.yml..."
& scp @ScpArgs "docker-compose.prod.yml" "${VPSUser}@${VPSHost}:${VPSDeployDir}/docker-compose.prod.yml"

# Manajemen Data Persisten
$RemoteDataStatus = & ssh @SshArgs $TestTarget "if [ -f $VPSDeployDir/data/articles.json ]; then echo exists; else echo none; fi"

$LocalDataDir = Join-Path $ProjectRoot "data"
if ($SyncData -and (Test-Path $LocalDataDir)) {
    Write-Host "[*] Sinkronisasi data lokal ke VPS (-SyncData aktif)..." -ForegroundColor Yellow
    & scp -r @ScpArgs "$LocalDataDir" "${VPSUser}@${VPSHost}:${VPSDeployDir}/"
    Write-Host "[OK] Data lokal berhasil disinkronkan ke VPS!" -ForegroundColor Green
} elseif ($RemoteDataStatus -notmatch "exists" -and (Test-Path $LocalDataDir)) {
    Write-Host "[*] Inisialisasi awal data ke VPS (mengirim data artikel, settings, & uploads lokal)..." -ForegroundColor Cyan
    & scp -r @ScpArgs "$LocalDataDir" "${VPSUser}@${VPSHost}:${VPSDeployDir}/"
    Write-Host "[OK] Data awal berhasil disalin ke VPS!" -ForegroundColor Green
} else {
    Write-Host "[OK] Data persisten di VPS tetap dipertahankan (tidak ditimpa)." -ForegroundColor Green
}

# Permission data
& ssh @SshArgs $TestTarget "chmod -R 777 $VPSDeployDir/data"

$ProdEnv = Join-Path $ProjectRoot ".env.production"
$ProdEnvExample = Join-Path $ProjectRoot ".env.production.example"

if ($SyncEnv -and (Test-Path $ProdEnv)) {
    Write-Host "Sinkronisasi .env.production -> VPS .env..."
    & scp @ScpArgs "$ProdEnv" "${VPSUser}@${VPSHost}:${VPSDeployDir}/.env"
} else {
    $EnvStatus = & ssh @SshArgs $TestTarget "if [ -f $VPSDeployDir/.env ]; then echo exists; else echo none; fi"
    if ($EnvStatus -notmatch "exists") {
        if (Test-Path $ProdEnv) {
            Write-Host "Mengirim file .env awal dari .env.production ke VPS..."
            & scp @ScpArgs "$ProdEnv" "${VPSUser}@${VPSHost}:${VPSDeployDir}/.env"
        } elseif (Test-Path $ProdEnvExample) {
            Write-Host "Mengirim file .env template dari .env.production.example ke VPS..."
            & scp @ScpArgs "$ProdEnvExample" "${VPSUser}@${VPSHost}:${VPSDeployDir}/.env"
        }
    }
}
Write-Host "[OK] File konfigurasi VPS berhasil disinkronkan!" -ForegroundColor Green
Write-Host ""

# 6. Jalankan Deployment di VPS
Write-Host "[5/6] Menjalankan deployment container di VPS..." -ForegroundColor Cyan

$RemoteCmds = "cd $VPSDeployDir && export DOCKERHUB_USERNAME=$DockerHubUser && export DOCKERHUB_REPO=$DockerHubRepo && export IMAGE_TAG=$ImageTag && export DOCKER_IMAGE=$FullImage && echo '>> Melakukan pull image dari Docker Hub...' && docker compose -f docker-compose.prod.yml pull && echo '>> Menyalakan / me-restart container...' && docker compose -f docker-compose.prod.yml up -d --remove-orphans && echo '>> Membersihkan image lama...' && docker image prune -f && sleep 3 && echo '>> Status Container:' && docker compose -f docker-compose.prod.yml ps"

& ssh @SshArgs $TestTarget $RemoteCmds

# 7. Selesai
Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "           DEPLOYMENT PRODUCTION BERHASIL!                      " -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host "URL Aplikasi   : http://${VPSHost}:3001" -ForegroundColor Cyan
Write-Host "Image DockerHub: $FullImage"
Write-Host "Direktori VPS  : $VPSDeployDir"
Write-Host "Data Persisten : ${VPSDeployDir}/data (Aman & Tersimpan)"
Write-Host ""