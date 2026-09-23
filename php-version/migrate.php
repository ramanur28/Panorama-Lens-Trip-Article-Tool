<?php
/**
 * Migration Utility: Imports existing JSON database & settings into MySQL
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/includes/db.php';

header('Content-Type: text/plain; charset=utf-8');

echo "=== Panorama Lens Trip - Data Migration Tool ===\n\n";

try {
    $pdo = Database::getConnection();
    echo "[OK] Connected to MySQL database '" . DB_NAME . "'.\n";
} catch (Exception $e) {
    die("[ERROR] Database connection failed: " . $e->getMessage() . "\n");
}

$oldDataDir = dirname(__DIR__) . '/data';
if (!is_dir($oldDataDir)) {
    $oldDataDir = __DIR__ . '/data';
}

// 1. Migrate Admin Settings
$settingsFile = $oldDataDir . '/admin_settings.json';
if (file_exists($settingsFile)) {
    echo "\n[INFO] Migrating admin_settings.json...\n";
    $json = json_decode(file_get_contents($settingsFile), true);
    if ($json) {
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
            ':api_key' => $json['apiKey'] ?? '',
            ':openai_api_key' => $json['openaiApiKey'] ?? '',
            ':model' => $json['model'] ?? 'gemini-2.5-flash',
            ':tone' => $json['tone'] ?? 'Professional',
            ':custom_prompt' => $json['customPrompt'] ?? '',
            ':target_audience' => $json['targetAudience'] ?? '',
            ':brand' => $json['brand'] ?? '',
            ':word_count_mode' => $json['wordCountMode'] ?? 'total',
            ':word_count_divisor' => (int)($json['wordCountDivisor'] ?? 10),
            ':target_word_count' => (int)($json['targetWordCount'] ?? 2500),
            ':target_language' => $json['targetLanguage'] ?? 'English',
            ':cta_link' => $json['ctaLink'] ?? '',
            ':wp_url' => $json['wpUrl'] ?? '',
            ':wp_username' => $json['wpUsername'] ?? '',
            ':wp_app_password' => $json['wpAppPassword'] ?? ''
        ]);
        echo "[SUCCESS] Settings migrated successfully.\n";
    }
} else {
    echo "[SKIP] admin_settings.json not found.\n";
}

// 2. Migrate Article Manager Items
$managerFile = $oldDataDir . '/article_manager.json';
if (file_exists($managerFile)) {
    echo "\n[INFO] Migrating article_manager.json...\n";
    $articles = json_decode(file_get_contents($managerFile), true);
    if (is_array($articles)) {
        $pdo->beginTransaction();
        $stmt = $pdo->prepare("REPLACE INTO articles (
            id, page_role, keyphrase, title, topic, intent, link, status,
            scheduled_date, published_date, article_content, images_json, wp_post_id
        ) VALUES (
            :id, :page_role, :keyphrase, :title, :topic, :intent, :link, :status,
            :scheduled_date, :published_date, :article_content, :images_json, :wp_post_id
        )");

        $count = 0;
        foreach ($articles as $art) {
            $sched = !empty($art['scheduledDate']) ? substr($art['scheduledDate'], 0, 10) : null;
            $pub = !empty($art['publishedDate']) ? substr($art['publishedDate'], 0, 10) : null;
            $imagesJson = !empty($art['images']) ? json_encode($art['images']) : null;
            $wpId = !empty($art['wpPostId']) ? (int)$art['wpPostId'] : null;

            $stmt->execute([
                ':id' => (int)$art['id'],
                ':page_role' => $art['pageRole'] ?? 'Cluster',
                ':keyphrase' => $art['keyphrase'] ?? '',
                ':title' => $art['title'] ?? '',
                ':topic' => $art['topic'] ?? '',
                ':intent' => $art['intent'] ?? 'Informational',
                ':link' => $art['link'] ?? '',
                ':status' => $art['status'] ?? 'belum_dibuat',
                ':scheduled_date' => $sched,
                ':published_date' => $pub,
                ':article_content' => $art['article'] ?? null,
                ':images_json' => $imagesJson,
                ':wp_post_id' => $wpId
            ]);
            $count++;
        }
        $pdo->commit();
        echo "[SUCCESS] Migrated {$count} articles into 'articles' table.\n";
    }
} else {
    echo "[SKIP] article_manager.json not found.\n";
}

// 3. Migrate Uploaded Files
$oldUploadsDir = $oldDataDir . '/uploads';
if (is_dir($oldUploadsDir)) {
    echo "\n[INFO] Copying uploaded images...\n";
    $files = scandir($oldUploadsDir);
    $copied = 0;
    foreach ($files as $f) {
        if ($f === '.' || $f === '..') continue;
        $src = $oldUploadsDir . '/' . $f;
        $dst = UPLOAD_DIR . '/' . $f;
        if (!file_exists($dst) && is_file($src)) {
            copy($src, $dst);
            $copied++;
        }
    }
    echo "[SUCCESS] Copied {$copied} media files to uploads/ directory.\n";
}

echo "\n=== Migration Completed Successfully! ===\n";
