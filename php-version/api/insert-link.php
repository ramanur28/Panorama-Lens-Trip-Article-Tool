<?php
/**
 * Internal Link Inserter API Endpoint (SSE Streaming)
 * Naturally weaves contextual internal links into article Markdown
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

$articleText = trim($input['articleText'] ?? '');
$links = $input['links'] ?? [];
$modelParam = trim($input['model'] ?? '');

$adminSettings = AIService::getSettings();
$effectiveModel = !empty($modelParam) ? $modelParam : ($adminSettings['model'] ?? 'gemini-2.5-flash');

try {
    if (empty($articleText)) {
        throw new Exception('Article text is required.');
    }
    if (empty($links) || !is_array($links)) {
        throw new Exception('Links array is required and must not be empty.');
    }

    SSE::send('progress', ['step' => 'analyze', 'message' => 'Analyzing article structure...', 'percent' => 20]);
    SSE::send('progress', ['step' => 'insert', 'message' => 'Weaving ' . count($links) . ' internal links naturally into paragraphs...', 'percent' => 50]);

    $linkListStr = "";
    foreach ($links as $idx => $link) {
        $cnt = max(1, (int)($link['count'] ?? 1));
        $num = $idx + 1;
        $linkListStr .= "- Link #{$num}: Topic: \"{$link['title']}\" -> URL: \"{$link['url']}\" (Insert exactly {$cnt} time(s))\n";
    }

    $prompt = "You are an expert article editor.
I have an existing article. I need you to naturally insert/weave the following internal links into the body of this article.

Links to insert:
{$linkListStr}

Instructions:
1. Find suitable paragraphs in the article body (NOT inside titles, H2 headings, SEO metadata block, or Image tables) where linking to these articles fits naturally.
2. Weave each link into a sentence using a natural anchor phrase: [Anchor Text](URL).
3. NEVER write the anchor text as the exact URL.
4. Distribute links across different relevant parts.
5. Weave each link exactly the number of times requested.
6. Do NOT make any other changes to headings, structure, image tags, or metadata.
7. Output the entire updated article.

ARTICLE CONTENT:
{$articleText}";

    $aiRes = AIService::generateContent([
        'model' => $effectiveModel,
        'prompt' => $prompt
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
