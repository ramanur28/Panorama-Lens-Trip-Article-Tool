# ==============================================================================
# SCRIPT SINKRONISASI & BACKUP DATA (LOKAL <-> VPS) - POWERSHELL
# Panorama Lens Trip Article Tool / Gemini Article Generator
# ==============================================================================

[CmdletBinding()]
param(
    [switch]$Pull,
    [switch]$Push,
    [switch]$Backup,
    [switch]$Help
)

$ProjectRoot = $PSScriptRoot
Set-Location $ProjectRoot

if ($Help -or (-not $Pull -and -not $Push -and -not $Backup)) {
    Write-Host "Penggunaan: .\sync-data.ps1 [OPSI]" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Opsi:"
    Write-Host "  -Pull / -Backup   Download/Backup seluruh data artikel & gambar dari VPS ke komputer lokal"
    Write-Host "  -Push             Kirim/Sinkronkan seluruh data artikel & gambar dari komputer lokal ke VPS"
    Write-Host "  -Help             Tampilkan bantuan ini"
    exit 0
}

$EnvFile = Join-Path $ProjectRoot ".env.deploy"
if (-not (Test-Path $EnvFile)) {
    Write-Host "[ERROR] File konfigurasi .env.deploy tidak ditemukan!" -ForegroundColor Red
    exit 1
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

$VPSHost = $DeployConfig["VPS_HOST"]
$VPSUser = if ($DeployConfig["VPS_USER"]) { $DeployConfig["VPS_USER"] } else { "root" }
$VPSPort = if ($DeployConfig["VPS_PORT"]) { $DeployConfig["VPS_PORT"] } else { "22" }
$VPSDeployDir = if ($DeployConfig["VPS_DEPLOY_DIR"]) { $DeployConfig["VPS_DEPLOY_DIR"] } else { "/opt/gemini-article-generator" }
$RawSSHKey = $DeployConfig["VPS_SSH_KEY"]

# Resolve SSH Key Path
$ResolvedSSHKey = ""
$KeyName = if ($RawSSHKey) { Split-Path $RawSSHKey -Leaf } else { "ramadhani.pem" }
$PotentialPaths = @(
    $RawSSHKey,
    ($RawSSHKey -replace "^~", $HOME),
    "C:\Users\Ramadhani\.ssh\$KeyName",
    (Join-Path $HOME ".ssh\$KeyName"),
    "\\wsl.localhost\Ubuntu\home\ramadhani\.ssh\$KeyName"
)
foreach ($p in $PotentialPaths) {
    if ($p -and (Test-Path $p)) {
        $ResolvedSSHKey = (Resolve-Path $p).Path
        break
    }
}

$RemoteTarget = "$VPSUser@$VPSHost"
$RemoteScpPath = "${RemoteTarget}:${VPSDeployDir}"
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"

$KeyParam = if ($ResolvedSSHKey) { "-i `"$ResolvedSSHKey`"" } else { "" }

if ($Pull -or $Backup) {
    Write-Host "[*] Mengunduh data dari VPS ($RemoteScpPath/data)..." -ForegroundColor Cyan
    if ($ResolvedSSHKey) {
        Write-Host "    Menggunakan SSH Key: $ResolvedSSHKey" -ForegroundColor DarkGray
    }
    
    # 1. Simpan ke folder backup timestamp
    $BackupDir = Join-Path $ProjectRoot "backups\data_$Timestamp"
    New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
    
    $ScpPullCmd = "scp -r $KeyParam -P $VPSPort -o StrictHostKeyChecking=no ${RemoteScpPath}/data `"$BackupDir`""
    Invoke-Expression $ScpPullCmd
    
    # 2. Sinkronkan juga ke data/ lokal aktif
    $LocalDataDir = Join-Path $ProjectRoot "data"
    New-Item -ItemType Directory -Force -Path $LocalDataDir | Out-Null
    $DownloadedData = Join-Path $BackupDir "data"
    if (Test-Path $DownloadedData) {
        Copy-Item "$DownloadedData\*" "$LocalDataDir" -Recurse -Force
    }
    
    Write-Host ""
    Write-Host "[OK] Backup data dari VPS berhasil!" -ForegroundColor Green
    Write-Host "Folder Backup : $BackupDir" -ForegroundColor Cyan
    Write-Host "Folder Aktif  : $LocalDataDir" -ForegroundColor Cyan
}

if ($Push) {
    Write-Host "[!] Mengunggah data lokal ke VPS ($RemoteScpPath/data)..." -ForegroundColor Yellow
    $LocalDataDir = Join-Path $ProjectRoot "data"
    if (-not (Test-Path $LocalDataDir)) {
        Write-Host "[ERROR] Folder data lokal tidak ditemukan!" -ForegroundColor Red
        exit 1
    }
    
    $SshMkdirCmd = "ssh $KeyParam -p $VPSPort -o StrictHostKeyChecking=no $RemoteTarget `"mkdir -p $VPSDeployDir/data/uploads`""
    Invoke-Expression $SshMkdirCmd
    
    $ScpPushCmd = "scp -r $KeyParam -P $VPSPort -o StrictHostKeyChecking=no `"$LocalDataDir`" ${RemoteScpPath}/"
    Invoke-Expression $ScpPushCmd
    
    $SshChmodCmd = "ssh $KeyParam -p $VPSPort -o StrictHostKeyChecking=no $RemoteTarget `"chmod -R 777 $VPSDeployDir/data`""
    Invoke-Expression $SshChmodCmd
    
    Write-Host ""
    Write-Host "[OK] Data lokal berhasil disinkronkan ke VPS!" -ForegroundColor Green
    Write-Host "Target VPS : $VPSDeployDir/data" -ForegroundColor Cyan
}