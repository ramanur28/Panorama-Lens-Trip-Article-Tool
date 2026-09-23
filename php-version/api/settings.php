<?php
/**
 * Settings API Endpoint
 * Handles system settings, API keys, tone, and WordPress connection testing
 */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/auth_middleware.php';
require_once __DIR__ . '/../includes/ai_service.php';
require_once __DIR__ . '/../includes/wordpress_service.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];
$pdo = Database::getConnection();

// --- 1. Test WordPress Connection ---
if ($action === 'test-wp-connection' && $method === 'POST') {
    Auth::requireAdmin();
    $input = json_decode(file_get_contents('php://input'), true) ?: $_POST;
    $result = WordPressService::verifyConfig(
        $input['wpUrl'] ?? null,
        $input['wpUsername'] ?? null,
        $input['wpAppPassword'] ?? null
    );
    echo json_encode($result);
    exit;
}

// --- 2. GET Settings ---
if ($method === 'GET') {
    $session = Auth::requireAuth();
    $settings = AIService::getSettings();

    // Map database snake_case keys to camelCase for frontend compatibility
    $res = [
        'apiKey' => $settings['api_key'] ?? '',
        'openaiApiKey' => $settings['openai_api_key'] ?? '',
        'model' => $settings['model'] ?? 'gemini-2.5-flash',
        'tone' => $settings['tone'] ?? 'Professional',
        'customPrompt' => $settings['custom_prompt'] ?? '',
        'targetAudience' => $settings['target_audience'] ?? '',
        'brand' => $settings['brand'] ?? '',
        'wordCountMode' => $settings['word_count_mode'] ?? 'total',
        'wordCountDivisor' => (int)($settings['word_count_divisor'] ?? 10),
        'targetWordCount' => (int)($settings['target_word_count'] ?? 2500),
        'targetLanguage' => $settings['target_language'] ?? 'English',
        'ctaLink' => $settings['cta_link'] ?? 'https://wa.me/+6282132838229?text=Hello+Panorama+Lens+Trip%21',
        'wpUrl' => $settings['wp_url'] ?? '',
        'wpUsername' => $settings['wp_username'] ?? '',
        'wpAppPassword' => $settings['wp_app_password'] ?? '',
        'hasApiKey' => !empty($settings['api_key']),
        'hasOpenaiApiKey' => !empty($settings['openai_api_key']),
        'hasWpConfig' => (!empty($settings['wp_username']) && !empty($settings['wp_app_password']))
    ];

    // Mask secret keys for standard users
    if ($session['role'] !== 'admin') {
        $res['apiKey'] = !empty($res['apiKey']) ? '••••••••••••••••' : '';
        $res['openaiApiKey'] = !empty($res['openaiApiKey']) ? '••••••••••••••••' : '';
        $res['wpAppPassword'] = !empty($res['wpAppPassword']) ? '••••••••••••••••' : '';
    }

    echo json_encode($res);
    exit;
}

// --- 3. POST Save Settings (Admin Only) ---
if ($method === 'POST') {
    Auth::requireAdmin();
    $input = json_decode(file_get_contents('php://input'), true) ?: $_POST;
    $current = AIService::getSettings();

    $apiKey = isset($input['apiKey']) ? trim($input['apiKey']) : ($current['api_key'] ?? '');
    $openaiApiKey = isset($input['openaiApiKey']) ? trim($input['openaiApiKey']) : ($current['openai_api_key'] ?? '');
    $model = !empty($input['model']) ? trim($input['model']) : ($current['model'] ?? 'gemini-2.5-flash');
    $tone = !empty($input['tone']) ? trim($input['tone']) : ($current['tone'] ?? 'Professional');
    $customPrompt = isset($input['customPrompt']) ? $input['customPrompt'] : ($current['custom_prompt'] ?? '');
    $targetAudience = isset($input['targetAudience']) ? $input['targetAudience'] : ($current['target_audience'] ?? '');
    $brand = isset($input['brand']) ? $input['brand'] : ($current['brand'] ?? '');
    $mode = !empty($input['wordCountMode']) ? $input['wordCountMode'] : ($current['word_count_mode'] ?? 'total');
    $divisor = max(2, min(50, (int)($input['wordCountDivisor'] ?? $current['word_count_divisor'] ?? 10)));
    $wordCount = max(100, (int)($input['targetWordCount'] ?? $current['target_word_count'] ?? 2500));
    $lang = !empty($input['targetLanguage']) ? $input['targetLanguage'] : ($current['target_language'] ?? 'English');
    $ctaLink = isset($input['ctaLink']) ? trim($input['ctaLink']) : ($current['cta_link'] ?? '');
    $wpUrl = isset($input['wpUrl']) ? trim($input['wpUrl']) : ($current['wp_url'] ?? '');
    $wpUsername = isset($input['wpUsername']) ? trim($input['wpUsername']) : ($current['wp_username'] ?? '');
    $wpAppPassword = isset($input['wpAppPassword']) ? trim($input['wpAppPassword']) : ($current['wp_app_password'] ?? '');

    $stmt = $pdo->prepare("REPLACE INTO settings (
        id, api_key, openai_api_key, model, tone, custom_prompt, target_audience, brand,
        word_count_mode, word_count_divisor, target_word_count, target_language, cta_link,
        wp_url, wp_username, wp_app_password
    ) VALUES (
        1, :api_key, :openai_api_key, :model, :tone, :custom_prompt, :target_audience, :brand,
        :word_count_mode, :word_count_divisor, :target_word_count, :target_language, :cta_link,
        :wp_url, :wp_username, :wp_app_password
    )");

    $stmt->execute([
        ':api_key' => $apiKey,
        ':openai_api_key' => $openaiApiKey,
        ':model' => $model,
        ':tone' => $tone,
        ':custom_prompt' => $customPrompt,
        ':target_audience' => $targetAudience,
        ':brand' => $brand,
        ':word_count_mode' => $mode,
        ':word_count_divisor' => $divisor,
        ':target_word_count' => $wordCount,
        ':target_language' => $lang,
        ':cta_link' => $ctaLink,
        ':wp_url' => $wpUrl,
        ':wp_username' => $wpUsername,
        ':wp_app_password' => $wpAppPassword
    ]);

    $wpVerification = null;
    if (!empty($input['testConnection']) || !empty($wpUrl)) {
        $wpVerification = WordPressService::verifyConfig($wpUrl, $wpUsername, $wpAppPassword);
    }

    echo json_encode([
        'success' => true,
        'message' => 'Settings updated successfully.',
        'wpVerification' => $wpVerification
    ]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed.']);
