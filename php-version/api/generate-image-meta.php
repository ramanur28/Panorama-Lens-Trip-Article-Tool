<?php
/**
 * Multimodal Image SEO Metadata Generator API Endpoint
 * Analyzes image and generates SEO Title, Alt Text, Caption, Description, File Name
 */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/auth_middleware.php';
require_once __DIR__ . '/../includes/ai_service.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

Auth::requireAuth();

$input = json_decode(file_get_contents('php://input'), true) ?: $_POST;
$imageBase64 = $input['imageBase64'] ?? null;
$imageUrl = $input['imageUrl'] ?? null;
$location = $input['location'] ?? 'Indonesia';
$scene = $input['scene'] ?? 'Landscape';
$modelParam = $input['model'] ?? null;

$adminSettings = AIService::getSettings();
$effectiveModel = !empty($modelParam) ? $modelParam : ($adminSettings['model'] ?? 'gemini-2.5-flash');
$targetLanguage = $adminSettings['target_language'] ?? 'English';

$mimeType = 'image/jpeg';
$data = null;

if (!empty($imageUrl)) {
    $localPath = ROOT_PATH . '/' . ltrim($imageUrl, '/');
    if (file_exists($localPath)) {
        $mimeType = mime_content_type($localPath) ?: 'image/jpeg';
        $data = base64_encode(file_get_contents($localPath));
    }
} elseif (!empty($imageBase64)) {
    if (preg_match('/^data:(image\/[a-zA-Z0-9.-]+);base64,(.+)$/', $imageBase64, $m)) {
        $mimeType = $m[1];
        $data = $m[2];
    } else {
        $data = $imageBase64;
    }
}

if (empty($data)) {
    http_response_code(400);
    echo json_encode(['error' => 'Image data or URL is required.']);
    exit;
}

$prompt = "You are an expert SEO specialist, professional photographer, and travel blogger.
Generate SEO-optimized image metadata (Alt Text, Title, Caption, Description, and File Name) for this image.

Inputs:
- Location: {$location}
- Scene description: {$scene}

Requirements:
1. The entire output (alt text, title, caption, description, and file name) MUST be written entirely in {$targetLanguage}.
2. File Name: lowercase, hyphen-separated, ending with .jpg (e.g., sunrise-over-bromo-crater.jpg).

Format the output EXACTLY as a JSON object with keys 'altText', 'title', 'caption', 'description', and 'fileName'. Do not include markdown fences.";

try {
    $res = AIService::generateContent([
        'model' => $effectiveModel,
        'prompt' => $prompt,
        'image' => ['data' => $data, 'mimeType' => $mimeType]
    ]);

    $raw = trim($res['text']);
    $raw = preg_replace('/^```(?:json)?\n?/i', '', $raw);
    $raw = preg_replace('/\n?```$/', '', $raw);
    $json = json_decode($raw, true);

    if (!$json || empty($json['altText'])) {
        throw new Exception('Invalid JSON response from AI model.');
    }

    echo json_encode([
        'success' => true,
        'seoMeta' => $json,
        'tokenUsage' => $res['usageMetadata'] ?? []
    ]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
