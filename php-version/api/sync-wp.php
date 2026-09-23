<?php
/**
 * WordPress Sync API Endpoint
 * Triggers bidirectional synchronization of WordPress posts with local MySQL database
 */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/auth_middleware.php';
require_once __DIR__ . '/../includes/ai_service.php';
require_once __DIR__ . '/../includes/wordpress_service.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

Auth::requireAuth();

try {
    $result = WordPressService::syncWordPressArticles();
    echo json_encode([
        'success' => true,
        'updatedCount' => $result['updatedCount'],
        'total' => $result['total'],
        'message' => "WordPress sync complete! Updated status and links for {$result['updatedCount']} articles in Article Manager."
    ]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}
