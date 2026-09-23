<?php
/**
 * Section Updater / Rewriter API Endpoint (SSE Streaming)
 * Scrapes target WordPress URL via native PHP DOMDocument and rewrites target H2 section
 */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/auth_middleware.php';
require_once __DIR__ . '/../includes/ai_service.php';
require_once __DIR__ . '/../includes/sse_helper.php';

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$session = Auth::requireAuth();
SSE::init();

$rawInput = file_get_contents('php://input');
$input = json_decode($rawInput, true) ?: $_POST;

$title = trim($input['title'] ?? '');
$wpUrl = trim($input['wpUrl'] ?? '');
$targetSubtitle = trim($input['targetSubtitle'] ?? '');
$starterWritings = trim($input['starterWritings'] ?? '');
$modelParam = trim($input['model'] ?? '');
$expertQuotations = $input['expertQuotations'] ?? [];
$customPromptParam = $input['customPrompt'] ?? null;
$targetAudienceParam = $input['targetAudience'] ?? null;
$brandParam = $input['brand'] ?? null;

$adminSettings = AIService::getSettings();
$effectiveModel = !empty($modelParam) ? $modelParam : ($adminSettings['model'] ?? 'gemini-2.5-flash');
$targetLanguage = $adminSettings['target_language'] ?? 'English';
$finalCustomPrompt = $customPromptParam !== null ? $customPromptParam : ($adminSettings['custom_prompt'] ?? '');
$finalTargetAudience = $targetAudienceParam !== null ? $targetAudienceParam : ($adminSettings['target_audience'] ?? '');
$finalBrand = $brandParam !== null ? $brandParam : ($adminSettings['brand'] ?? '');
$finalCtaLink = $adminSettings['cta_link'] ?? 'https://wa.me/+6282132838229?text=Hello+Panorama+Lens+Trip%21';

$rawTarget = max(200, (int)($adminSettings['target_word_count'] ?? 2500));
$divisor = max(2, min(50, (int)($adminSettings['word_count_divisor'] ?? 10)));
$targetWordCount = max(50, (int)round($rawTarget / $divisor));

try {
    SSE::send('progress', ['step' => 'fetch', 'message' => 'Fetching existing WordPress article content...', 'percent' => 10]);

    if (empty($wpUrl)) {
        throw new Exception('WordPress article URL is required.');
    }

    $ch = curl_init($wpUrl);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        CURLOPT_TIMEOUT => 20,
        CURLOPT_SSL_VERIFYPEER => true
    ]);
    $html = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    if (PHP_VERSION_ID < 80000) { @curl_close($ch); }

    if ($httpCode !== 200 || empty($html)) {
        throw new Exception("Failed to fetch article from {$wpUrl} (HTTP {$httpCode}).");
    }

    // Clean HTML using native DOMDocument
    libxml_use_internal_errors(true);
    $dom = new DOMDocument();
    $dom->loadHTML('<?xml encoding="utf-8" ?>' . $html);
    libxml_clear_errors();

    $xpath = new DOMXPath($dom);
    // Remove unwanted elements
    $nodes = $xpath->query('//script|//style|//nav|//footer|//header|//aside|//*[@class="sidebar"]|//*[@class="widget"]|//iframe');
    foreach ($nodes as $node) {
        $node->parentNode->removeChild($node);
    }

    $bodyNodes = $xpath->query('//body');
    $bodyText = '';
    if ($bodyNodes->length > 0) {
        $bodyText = $bodyNodes->item(0)->textContent;
    }
    $articleContext = trim(preg_replace('/\s+/', ' ', $bodyText));
    $articleContext = substr($articleContext, 0, 25000);

    SSE::send('progress', ['step' => 'generate', 'message' => "Rewriting section '{$targetSubtitle}' with AI...", 'percent' => 45]);

    $customPromptExtra = "";
    if (!empty($finalCustomPrompt)) {
        $customPromptExtra .= "\n\n--- CRITICAL CUSTOM INSTRUCTIONS FROM USER ---\n{$finalCustomPrompt}\n----------------------------------------------\n";
    }
    $customPromptExtra .= "\n\nIMPORTANT LANGUAGE RULE: The final output MUST be written entirely in {$targetLanguage}.";
    $customPromptExtra .= "\n\n--- INCLUSIVE & RESPECTFUL LANGUAGE RULE (STRICT) ---\nStrictly write using inclusive, respectful, empathetic, and gender-neutral language.\n------------------------------------------------------\n";

    if (!empty($finalTargetAudience)) $customPromptExtra .= "\nTarget Audience: {$finalTargetAudience}";
    if (!empty($finalBrand)) $customPromptExtra .= "\nBrand: {$finalBrand}";
    if (!empty($finalCtaLink)) {
        $customPromptExtra .= "\n\n--- CALL TO ACTION (CTA) LINK RULES ---\nUse conversion CTA link: \"{$finalCtaLink}\" (Markdown: [Anchor Text]({$finalCtaLink})).\n---------------------------------------\n";
    }

    if (!empty($expertQuotations) && is_array($expertQuotations)) {
        $customPromptExtra .= "\n\n--- EXPERT QUOTATIONS TO INCLUDE ---\n";
        foreach ($expertQuotations as $q) {
            $namePart = !empty($q['url']) ? "[{$q['name']}]({$q['url']})" : ($q['name'] ?? 'Expert');
            $customPromptExtra .= "- {$namePart}: \"{$q['quote']}\"\n";
        }
        $customPromptExtra .= "------------------------------------\n";
    }

    $updatePrompt = "You are an expert article writer and editor.{$customPromptExtra}

I have an existing article titled \"{$title}\".

Here is the full existing article for context:
--- START ARTICLE CONTEXT ---
{$articleContext}
--- END ARTICLE CONTEXT ---

I need you to write/rewrite a specific section with the following H2 heading: \"{$targetSubtitle}\"

Draft/starter writings provided:
--- START DRAFT ---
" . (!empty($starterWritings) ? $starterWritings : "(No starter writings provided. Write from scratch based on article context.)") . "
--- END DRAFT ---

Requirements:
- Improve, expand, and rewrite this section to flow perfectly with the rest of the article
- Maintain tone and style
- Write a comprehensive, high-quality section (~{$targetWordCount} words)
- Format the output in Markdown
- Ensure the section begins with: ## {$targetSubtitle}";

    $aiRes = AIService::generateContent([
        'model' => $effectiveModel,
        'prompt' => $updatePrompt
    ]);

    $generatedText = trim($aiRes['text']);
    $wordCount = SSE::countWords($generatedText);
    $usage = $aiRes['usageMetadata'] ?? [];

    SSE::send('complete', [
        'article' => $generatedText,
        'wordCount' => $wordCount,
        'percent' => 100,
        'tokenUsage' => [
            'promptTokens' => $usage['promptTokenCount'] ?? 0,
            'candidatesTokens' => $usage['candidatesTokenCount'] ?? 0,
            'totalTokens' => $usage['totalTokenCount'] ?? 0
        ]
    ]);
} catch (Throwable $e) {
    SSE::send('error', ['message' => $e->getMessage()]);
}
