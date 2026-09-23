<?php
/**
 * Panorama Lens Trip - Article Tool (PHP Edition)
 * Configuration File for Shared Hosting / cPanel & Local Development
 */

// Optional: Load local secret overrides if present (ignored in git)
if (file_exists(__DIR__ . '/config.local.php')) {
    require_once __DIR__ . '/config.local.php';
}

// Error Reporting (Set to false in production)
if (!defined('APP_DEBUG')) define('APP_DEBUG', true);
if (APP_DEBUG) {
    // Suppress display of warnings/deprecations in HTTP body to prevent JSON response corruption
    ini_set('display_errors', '0');
    ini_set('log_errors', '1');
    error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);
} else {
    ini_set('display_errors', '0');
    error_reporting(0);
}

// Database Credentials (Configure with your shared hosting cPanel database details)
if (!defined('DB_HOST')) define('DB_HOST', getenv('DB_HOST') ?: '127.0.0.1');
if (!defined('DB_NAME')) define('DB_NAME', getenv('DB_NAME') ?: 'panorama_articles');
if (!defined('DB_USER')) define('DB_USER', getenv('DB_USER') ?: 'panorama');
if (!defined('DB_PASS')) define('DB_PASS', getenv('DB_PASS') ?: 'panorama123');
if (!defined('DB_PORT')) define('DB_PORT', getenv('DB_PORT') ?: '3306');
if (!defined('DB_CHARSET')) define('DB_CHARSET', 'utf8mb4');

// Default Admin & User credentials for initial seeding
if (!defined('DEFAULT_ADMIN_USER')) define('DEFAULT_ADMIN_USER', 'admin');
if (!defined('DEFAULT_ADMIN_PASS')) define('DEFAULT_ADMIN_PASS', 'admin123');
if (!defined('DEFAULT_ADMIN_NAME')) define('DEFAULT_ADMIN_NAME', 'Administrator');

if (!defined('DEFAULT_USER_NAME')) define('DEFAULT_USER_NAME', 'user');
if (!defined('DEFAULT_USER_PASS')) define('DEFAULT_USER_PASS', 'user123');
if (!defined('DEFAULT_USER_FULLNAME')) define('DEFAULT_USER_FULLNAME', 'Standard User');

// Paths
if (!defined('ROOT_PATH')) define('ROOT_PATH', __DIR__);
if (!defined('UPLOAD_DIR')) define('UPLOAD_DIR', __DIR__ . DIRECTORY_SEPARATOR . 'uploads');
if (!defined('UPLOAD_URL')) define('UPLOAD_URL', 'uploads/');

// Session & Security
if (!defined('SESSION_LIFETIME_HOURS')) define('SESSION_LIFETIME_HOURS', 168); // 7 days
if (!defined('JWT_SECRET_KEY')) define('JWT_SECRET_KEY', 'panorama_lens_trip_secret_key_change_me_in_production_' . md5(__DIR__));

// Timezone
date_default_timezone_set('Asia/Jakarta');

// Auto-create uploads directory if it doesn't exist
if (!is_dir(UPLOAD_DIR)) {
    @mkdir(UPLOAD_DIR, 0755, true);
}