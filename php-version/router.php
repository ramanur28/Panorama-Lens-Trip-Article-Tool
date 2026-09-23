<?php
/**
 * Router script for PHP built-in web server
 * Usage: php -S 0.0.0.0:8088 router.php
 */

$rawUri = $_SERVER['REQUEST_URI'];
$uri = urldecode(parse_url($rawUri, PHP_URL_PATH));
$file = __DIR__ . $uri;

// Serve existing static files (css, js, images) directly
if ($uri !== '/' && file_exists($file) && !is_dir($file)) {
    return false;
}

// Emulate .htaccess rewrite rules for API routes
if (preg_match('#^/api/auth/(login|logout|me|check-session|status|change-password)#', $uri, $m)) {
    $_GET['action'] = $m[1];
    require __DIR__ . '/api/auth.php';
    exit;
}
if (preg_match('#^/api/admin/(login|logout|check-session)#', $uri, $m)) {
    $_GET['action'] = ($m[1] === 'check-session') ? 'me' : $m[1];
    require __DIR__ . '/api/auth.php';
    exit;
}
if ($uri === '/api/login') {
    $_GET['action'] = 'login';
    require __DIR__ . '/api/auth.php';
    exit;
}
if ($uri === '/api/logout') {
    $_GET['action'] = 'logout';
    require __DIR__ . '/api/auth.php';
    exit;
}

if ($uri === '/api/settings' || $uri === '/api/admin/settings') {
    require __DIR__ . '/api/settings.php';
    exit;
}
if ($uri === '/api/admin/test-wp-connection') {
    $_GET['action'] = 'test-wp-connection';
    require __DIR__ . '/api/settings.php';
    exit;
}

if ($uri === '/api/articles/sync-wp' || $uri === '/api/articles/sync') {
    require __DIR__ . '/api/sync-wp.php';
    exit;
}
if ($uri === '/api/articles/schedule-publish' || $uri === '/api/publish-wordpress') {
    require __DIR__ . '/api/publish-wordpress.php';
    exit;
}
if ($uri === '/api/articles/import-csv') {
    $_GET['action'] = 'import-csv';
    require __DIR__ . '/api/articles.php';
    exit;
}
if ($uri === '/api/articles/export-csv') {
    $_GET['action'] = 'export-csv';
    require __DIR__ . '/api/articles.php';
    exit;
}
if (preg_match('#^/api/articles/(\d+)$#', $uri, $m)) {
    $_GET['id'] = $m[1];
    require __DIR__ . '/api/articles.php';
    exit;
}
if ($uri === '/api/articles') {
    require __DIR__ . '/api/articles.php';
    exit;
}

if (preg_match('#^/api/queue/([a-zA-Z0-9_-]+)$#', $uri, $m)) {
    $_GET['id'] = $m[1];
    require __DIR__ . '/api/queue.php';
    exit;
}
if ($uri === '/api/queue') {
    require __DIR__ . '/api/queue.php';
    exit;
}

if ($uri === '/api/upload' || $uri === '/api/upload-image') {
    require __DIR__ . '/api/upload.php';
    exit;
}
if ($uri === '/api/generate') {
    require __DIR__ . '/api/generate.php';
    exit;
}
if ($uri === '/api/update-section') {
    require __DIR__ . '/api/update-section.php';
    exit;
}
if ($uri === '/api/insert-link') {
    require __DIR__ . '/api/insert-link.php';
    exit;
}
if ($uri === '/api/generate-image-meta') {
    require __DIR__ . '/api/generate-image-meta.php';
    exit;
}

// Fallback to index.php
require __DIR__ . '/index.php';
