<?php
/**
 * Image Upload API Endpoint
 * Handles base64 and multipart file uploads to uploads/ directory
 */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../includes/auth_middleware.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

Auth::requireAuth();

if (!is_dir(UPLOAD_DIR)) {
    @mkdir(UPLOAD_DIR, 0755, true);
}

$allowedExtensions = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'];
$input = json_decode(file_get_contents('php://input'), true) ?: $_POST;
$base64 = $input['imageBase64'] ?? $input['base64'] ?? null;

// Handle Base64 Upload
if (!empty($base64)) {
    if (preg_match('/^data:(image\/[a-zA-Z0-9.-]+);base64,(.+)$/', $base64, $matches)) {
        $mime = $matches[1];
        $data = base64_decode($matches[2]);
        $rawExt = strtolower(explode('/', $mime)[1] ?? 'jpg');
        if ($rawExt === 'jpeg') $rawExt = 'jpg';
        $ext = in_array($rawExt, $allowedExtensions) ? $rawExt : 'jpg';
    } else {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid base64 image data.']);
        exit;
    }

    $fileName = 'img_' . time() . '_' . substr(md5(mt_rand()), 0, 8) . '.' . $ext;
    $filePath = UPLOAD_DIR . DIRECTORY_SEPARATOR . $fileName;

    if (file_put_contents($filePath, $data) !== false) {
        echo json_encode([
            'success' => true,
            'url' => UPLOAD_URL . $fileName,
            'fileName' => $fileName
        ]);
        exit;
    } else {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to write uploaded image to disk.']);
        exit;
    }
}

// Handle standard multipart file upload
if (!empty($_FILES['image']['tmp_name'])) {
    $origName = basename($_FILES['image']['name']);
    $rawExt = strtolower(pathinfo($origName, PATHINFO_EXTENSION) ?: 'jpg');
    if ($rawExt === 'jpeg') $rawExt = 'jpg';
    $ext = in_array($rawExt, $allowedExtensions) ? $rawExt : 'jpg';

    $fileName = 'img_' . time() . '_' . substr(md5(mt_rand()), 0, 8) . '.' . $ext;
    $filePath = UPLOAD_DIR . DIRECTORY_SEPARATOR . $fileName;

    if (move_uploaded_file($_FILES['image']['tmp_name'], $filePath)) {
        echo json_encode([
            'success' => true,
            'url' => UPLOAD_URL . $fileName,
            'fileName' => $fileName
        ]);
        exit;
    } else {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to move uploaded file.']);
        exit;
    }
}

http_response_code(400);
echo json_encode(['error' => 'No image data provided.']);
