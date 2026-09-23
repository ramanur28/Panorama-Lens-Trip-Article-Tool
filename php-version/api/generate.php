<?php
/**
 * Multi-Step AI Article Generator Endpoint (SSE Streaming)
 * Executes progressive pipeline: Image SEO -> Outline -> Intro -> Body -> Conclusion -> SEO Meta
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

$title = trim($input['title'] ?? 'Untitled Article');
$topic = trim($input['topic'] ?? '');
$keyphrase = trim($input['keyphrase'] ?? '');
$pageRole = trim($input['pageRole'] ?? 'Cluster');
$starterArticle = trim($input['starterArticle'] ?? '');
$modelParam = trim($input['model'] ?? '');
$expertQuotations = $input['expertQuotations'] ?? [];
$images = $input['images'] ?? [];
$internalLinks = $input['internalLinks'] ?? [];
$customPromptParam = $input['customPrompt'] ?? null;
$targetAudienceParam = $input['targetAudience'] ?? null;
$brandParam = $input['brand'] ?? null;

// Global settings
$adminSettings = AIService::getSettings();
$effectiveModel = !empty($modelParam) ? $modelParam : ($adminSettings['model'] ?? 'gemini-2.5-flash');
$tone = $adminSettings['tone'] ?? 'Professional';
$targetLanguage = $adminSettings['target_language'] ?? 'English';
$finalCustomPrompt = $customPromptParam !== null ? $customPromptParam : ($adminSettings['custom_prompt'] ?? '');
$finalTargetAudience = $targetAudienceParam !== null ? $targetAudienceParam : ($adminSettings['target_audience'] ?? '');
$finalBrand = $brandParam !== null ? $brandParam : ($adminSettings['brand'] ?? '');
$finalCtaLink = $adminSettings['cta_link'] ?? 'https://wa.me/+6282132838229?text=Hello+Panorama+Lens+Trip%21';

$wordCountMode = $adminSettings['word_count_mode'] ?? 'total';
$wordCountDivisor = max(2, min(50, (int)($adminSettings['word_count_divisor'] ?? 10)));
$rawTarget = max(200, (int)($adminSettings['target_word_count'] ?? 2500));
$targetWordCount = ($wordCountMode === 'total') 
    ? max(50, (int)round($rawTarget / $wordCountDivisor)) 
    : $rawTarget;
$numBodySections = max(1, $wordCountDivisor - 2);

try {
    $toneInstruction = $tone ? "Write in a " . strtolower($tone) . " tone and style." : "Write in a professional tone.";

    $customPromptExtra = "";
    if (!empty($finalCustomPrompt)) {
        $customPromptExtra .= "\n\n--- CRITICAL CUSTOM INSTRUCTIONS FROM USER ---\n{$finalCustomPrompt}\n----------------------------------------------\n";
    }
    $customPromptExtra .= "\n\nIMPORTANT LANGUAGE RULE: The final output MUST be written entirely in {$targetLanguage}, regardless of the language used in the inputs or starter text.";
    $customPromptExtra .= "\n\n--- INCLUSIVE & RESPECTFUL LANGUAGE RULE (STRICT) ---\nYou MUST strictly write using inclusive, respectful, empathetic, and non-discriminatory language throughout the article.\n- Gender Neutrality: Use gender-neutral terminology (e.g. 'travelers', 'photographers', 'guests', 'people', 'they/them/their') instead of gender-biased or exclusionary pronouns/phrases (e.g. 'he/him', 'guys').\n- Respect & Dignity: Avoid any non-inclusive, stereotypical, ableist, ageist, culturally insensitive, or exclusionary phrasing.\n------------------------------------------------------\n";

    if (!empty($finalTargetAudience)) $customPromptExtra .= "\nTarget Audience: {$finalTargetAudience}";
    if (!empty($finalBrand)) $customPromptExtra .= "\nBrand: {$finalBrand}";
    if (!empty($finalCtaLink)) {
        $customPromptExtra .= "\n\n--- CALL TO ACTION (CTA) LINK RULES ---\nWhen writing Calls to Action (CTAs), always use the following destination URL for any conversion CTA links: \"{$finalCtaLink}\". Format it as standard Markdown: [Anchor Text]({$finalCtaLink}). Do NOT use dummy/hash links like '#' or placeholder URLs.\n---------------------------------------\n";
    }

    if (!empty($expertQuotations) && is_array($expertQuotations)) {
        $customPromptExtra .= "\n\n--- EXPERT QUOTATIONS TO INCLUDE ---\nThe user has provided the following expert quotations. Please weave them naturally into the article where appropriate. Format the expert's name as a clickable Markdown link if a URL is provided:\n";
        foreach ($expertQuotations as $q) {
            $namePart = !empty($q['url']) ? "[{$q['name']}]({$q['url']})" : ($q['name'] ?? 'Expert');
            $customPromptExtra .= "- {$namePart}: \"{$q['quote']}\"\n";
        }
        $customPromptExtra .= "------------------------------------\n";
    }

    $starterContext = !empty($starterArticle) 
        ? "\n\nThe user has provided a starter/reference article. Use it as context for direction, style, and background knowledge:\n\n---START REFERENCE---\n{$starterArticle}\n---END REFERENCE---\n\n"
        : "";

    $promptTokens = 0;
    $candidatesTokens = 0;
    $totalTokens = 0;

    $trackUsage = function($res) use (&$promptTokens, &$candidatesTokens, &$totalTokens) {
        if (!empty($res['usageMetadata'])) {
            $promptTokens += $res['usageMetadata']['promptTokenCount'] ?? 0;
            $candidatesTokens += $res['usageMetadata']['candidatesTokenCount'] ?? 0;
            $totalTokens += $res['usageMetadata']['totalTokenCount'] ?? 0;
        }
    };

    // --- Step 1: Multimodal Image SEO Analysis ---
    $imageSeoResults = [];
    if (!empty($images) && is_array($images)) {
        SSE::send('progress', ['step' => 'image-seo', 'message' => 'Analyzing ' . count($images) . ' images with AI...', 'percent' => 3]);

        foreach ($images as $img) {
            $imgId = $img['id'] ?? (count($imageSeoResults) + 1);
            $mimeType = 'image/jpeg';
            $base64Data = null;

            if (!empty($img['imageUrl'])) {
                $filePath = ROOT_PATH . '/' . ltrim($img['imageUrl'], '/');
                if (file_exists($filePath)) {
                    $mimeType = mime_content_type($filePath) ?: 'image/jpeg';
                    $base64Data = base64_encode(file_get_contents($filePath));
                }
            } elseif (!empty($img['imageBase64'])) {
                if (preg_match('/^data:(image\/[a-zA-Z0-9.-]+);base64,(.+)$/', $img['imageBase64'], $m)) {
                    $mimeType = $m[1];
                    $base64Data = $m[2];
                } else {
                    $base64Data = $img['imageBase64'];
                }
            }

            if ($base64Data) {
                $loc = $img['location'] ?? 'Indonesia';
                $scene = $img['scene'] ?? 'Landscape';
                $isFeat = !empty($img['isFeatured']) ? 'Yes' : 'No';

                $imgPrompt = "You are an expert SEO specialist, professional photographer, and travel blogger.
Generate SEO-optimized image metadata (Alt Text, Title, Caption, Description, and File Name) for this image.

Inputs:
- Location: {$loc}
- Scene description: {$scene}
- Is Featured Image: {$isFeat}

Requirements:
1. The entire output (alt text, title, caption, description, and file name) MUST be written entirely in {$targetLanguage}.
2. File Name: lowercase, hyphen-separated, ending with .jpg (e.g., golden-pavilion-temple.jpg).

Format the output EXACTLY as a JSON object with keys 'altText', 'title', 'caption', 'description', and 'fileName'. Do not include markdown fences.";

                try {
                    $aiRes = AIService::generateContent([
                        'model' => $effectiveModel,
                        'prompt' => $imgPrompt,
                        'image' => ['data' => $base64Data, 'mimeType' => $mimeType]
                    ]);
                    $trackUsage($aiRes);

                    $rawJson = trim($aiRes['text']);
                    $rawJson = preg_replace('/^```(?:json)?\n?/i', '', $rawJson);
                    $rawJson = preg_replace('/\n?```$/', '', $rawJson);
                    $parsed = json_decode($rawJson, true);

                    if (!$parsed || empty($parsed['altText'])) {
                        throw new Exception("JSON parse error");
                    }

                    $imageSeoResults[] = array_merge($img, $parsed);
                } catch (Throwable $e) {
                    $imageSeoResults[] = array_merge($img, [
                        'altText' => "Image of {$scene} at {$loc}.",
                        'title' => "Image {$imgId}",
                        'caption' => "View of {$scene} at {$loc}.",
                        'description' => "Photograph capturing {$scene} located at {$loc}.",
                        'fileName' => "image-{$imgId}.jpg"
                    ]);
                }
            }
        }
    }

    if (!empty($imageSeoResults)) {
        $customPromptExtra .= "\n\n--- AVAILABLE IMAGES FOR THIS ARTICLE ---\n";
        foreach ($imageSeoResults as $img) {
            $customPromptExtra .= "- Image #{$img['id']}: Location: \"{$img['location']}\", Scene: \"{$img['scene']}\", Alt Text: \"{$img['altText']}\"\n";
        }
        $customPromptExtra .= "-----------------------------------------\n";
    }

    // --- Step 2: Distribute Internal Links ---
    $linksByPart = ['-1' => []];
    for ($sIdx = 0; $sIdx < $numBodySections; $sIdx++) {
        $linksByPart[(string)$sIdx] = [];
    }
    $linksByPart[(string)$numBodySections] = [];

    if (!empty($internalLinks) && is_array($internalLinks)) {
        $partIndices = array_merge([-1], range(0, $numBodySections - 1), [$numBodySections]);
        foreach ($internalLinks as $link) {
            $count = max(1, (int)($link['count'] ?? 1));
            shuffle($partIndices);
            for ($c = 0; $c < $count; $c++) {
                $pIdx = $partIndices[$c % count($partIndices)];
                $linksByPart[(string)$pIdx][] = [
                    'title' => $link['title'] ?? '',
                    'url' => $link['url'] ?? ''
                ];
            }
        }
    }

    $formatPartLinks = function(array $partLinks): string {
        if (empty($partLinks)) return "";
        $res = "\n\n--- INTERNAL LINKS TO INCLUDE IN THIS SECTION ---\nYou MUST naturally weave the following internal link(s) into the body text paragraphs of this section:\n";
        foreach ($partLinks as $l) {
            $res .= "- Target: \"{$l['title']}\" -> URL: \"{$l['url']}\" (Format: [Anchor Text]({$l['url']}))\n";
        }
        $res .= "Instructions: The Anchor Text should fit naturally in the sentence. Do NOT use the raw URL as anchor text.\n-------------------------------------------------\n";
        return $res;
    };

    // --- Step 3: Generate Outline ---
    SSE::send('progress', ['step' => 'outline', 'message' => 'Designing comprehensive article outline...', 'percent' => 8]);

    $outlinePrompt = "You are an expert long-form content strategist and SEO writer.{$customPromptExtra}

Create a detailed article outline for:
- Title: \"{$title}\"
- Topic / Core Question: \"{$topic}\"
- Focus Keyphrase: \"{$keyphrase}\"
{$toneInstruction}{$starterContext}

Target Word Count Specifications:
- Total Target: {$rawTarget} words
- Number of Components: {$wordCountDivisor} (1 Intro + {$numBodySections} Body Sections + 1 Conclusion)
- Target Length per Section: ~{$targetWordCount} words

Design exactly {$numBodySections} section headings that comprehensively cover this topic.
Return ONLY a valid JSON object with keys:
- \"sections\": array of exactly {$numBodySections} objects with \"heading\", \"description\", \"assignedImageId\"
- \"introImageId\": (number or null)
- \"conclusionImageId\": (number or null)

Example format:
{
  \"introImageId\": null,
  \"conclusionImageId\": null,
  \"sections\": [
    {\"heading\": \"Heading 1\", \"description\": \"Description 1\", \"assignedImageId\": 1}
  ]
}";

    $outlineRes = AIService::generateContent([
        'model' => $effectiveModel,
        'prompt' => $outlinePrompt
    ]);
    $trackUsage($outlineRes);

    $rawOutline = trim($outlineRes['text']);
    $rawOutline = preg_replace('/^```(?:json)?\n?/i', '', $rawOutline);
    $rawOutline = preg_replace('/\n?```$/', '', $rawOutline);

    $sections = [];
    $introImageId = null;
    $conclusionImageId = null;

    $parsedOutline = json_decode($rawOutline, true);
    if (!empty($parsedOutline['sections'])) {
        $sections = $parsedOutline['sections'];
        $introImageId = $parsedOutline['introImageId'] ?? null;
        $conclusionImageId = $parsedOutline['conclusionImageId'] ?? null;
    } elseif (is_array($parsedOutline)) {
        $sections = $parsedOutline;
    }

    // Fallback if parsing failed
    if (empty($sections)) {
        for ($i = 1; $i <= $numBodySections; $i++) {
            $sections[] = ['heading' => "Key Aspect {$i}: Guide and Insights", 'description' => "Detailed discussion of aspect {$i}"];
        }
    }

    $headings = array_map(fn($s) => $s['heading'] ?? 'Section', $sections);
    SSE::send('outline', ['sections' => $headings, 'percent' => 12]);

    // Map Images to Sections
    $imageAssignments = [];
    $unassignedImages = array_column($imageSeoResults, 'id');

    $assignImage = function($partKey, $imgId) use (&$imageAssignments, &$unassignedImages) {
        if ($imgId && in_array($imgId, $unassignedImages)) {
            $imageAssignments[(string)$partKey][] = $imgId;
            $unassignedImages = array_values(array_diff($unassignedImages, [$imgId]));
        }
    };

    if ($introImageId) $assignImage('-1', $introImageId);
    if ($conclusionImageId) $assignImage((string)$numBodySections, $conclusionImageId);

    foreach ($sections as $idx => $sec) {
        if (!empty($sec['assignedImageId'])) {
            $assignImage((string)$idx, $sec['assignedImageId']);
        }
    }

    // Distribute remaining images
    $distIdx = 0;
    while (!empty($unassignedImages)) {
        $imgId = array_shift($unassignedImages);
        $partKey = (string)($distIdx % $numBodySections);
        $imageAssignments[$partKey][] = $imgId;
        $distIdx++;
    }

    // --- Step 4: Generate Introduction ---
    SSE::send('progress', ['step' => 'introduction', 'message' => 'Writing engaging introduction...', 'percent' => 15]);

    $introImgInstr = "";
    if (!empty($imageAssignments['-1'])) {
        $id = $imageAssignments['-1'][0];
        $introImgInstr = "\n- Image Placement: You MUST place `[IMAGE_{$id}]` on its own line where it fits best.\n";
    }

    $sectionListLines = [];
    foreach ($sections as $i => $s) {
        $num = $i + 1;
        $h = $s['heading'] ?? 'Section';
        $sectionListLines[] = "{$num}. {$h}";
    }
    $sectionListStr = implode("\n", $sectionListLines);

    $introPrompt = "You are an expert article writer.{$customPromptExtra}{$formatPartLinks($linksByPart['-1'] ?? [])}

Write a compelling introduction (~{$targetWordCount} words) for an article titled \"{$title}\".
Topic / Core Question: \"{$topic}\"
Focus Keyphrase: \"{$keyphrase}\"
{$toneInstruction}{$starterContext}

The article covers these sections:
{$sectionListStr}

Requirements:
- Start immediately with a structured TL;DR executive summary callout block with exactly 3-4 high-impact key takeaways.
- CRITICAL RULE FOR BULLET HEADINGS: NEVER write \"Key Point 1\", \"Key Point 2\", \"Point 1\", or generic number labels. Instead, you MUST use the actual specific TOPIC/SUBJECT of discussion in bold as the heading for each bullet point (e.g., **[Topik Pembahasan 1]:**, **[Topik Pembahasan 2]:**, **[Topik Pembahasan 3]:** based on the article's core topics such as location, timing, cost, equipment, accommodation, or practical tips).
- Format the TL;DR block exactly as follows:
> **TL;DR:**
> - **[Topik Pembahasan 1]:** [Concise core takeaway or direct answer to search query]
> - **[Topik Pembahasan 2]:** [Important practical tip or recommendation]
> - **[Topik Pembahasan 3]:** [Crucial expectation, cost, or insider advice]

- Followed by a blank line and an engaging introductory paragraph hooking the reader immediately.
- Naturally include focus keyphrase \"{$keyphrase}\" 1-2 times.
- Do NOT include any # title or H1 heading (the title is handled separately).
- Write in Markdown format.
- Aim for ~{$targetWordCount} words{$introImgInstr}";

    $introRes = AIService::generateContent([
        'model' => $effectiveModel,
        'prompt' => $introPrompt
    ]);
    $trackUsage($introRes);

    $fullArticle = "# {$title}\n\n" . trim($introRes['text']) . "\n\n";
    SSE::send('section_done', ['index' => -1, 'name' => 'Introduction', 'wordCount' => SSE::countWords($fullArticle), 'percent' => 20]);

    // --- Step 5: Generate Body Sections ---
    $totalSections = count($sections);
    for ($i = 0; $i < $totalSections; $i++) {
        $sec = $sections[$i];
        $pct = round(20 + (($i + 1) / $totalSections) * 65);

        SSE::send('progress', [
            'step' => 'section',
            'current' => $i + 1,
            'total' => $totalSections,
            'message' => "Writing: {$sec['heading']}",
            'percent' => $pct
        ]);

        $secImgInstr = "";
        if (!empty($imageAssignments[(string)$i])) {
            $id = $imageAssignments[(string)$i][0];
            $secImgInstr = "\n- Image Placement: You MUST place `[IMAGE_{$id}]` on its own line where it fits best in this section.\n";
        }

        $prevHeadings = array_slice($headings, 0, $i);
        $nextHeadings = array_slice($headings, $i + 1);
        $secNum = $i + 1;

        $secPrompt = "You are an expert article writer continuing to write an article.{$customPromptExtra}{$formatPartLinks($linksByPart[(string)$i] ?? [])}

Article Title: \"{$title}\"
Focus Keyphrase: \"{$keyphrase}\"
{$toneInstruction}

Section {$secNum} of {$totalSections}
Heading: \"{$sec['heading']}\"
Description: \"{$sec['description']}\"

Previous sections: " . (empty($prevHeadings) ? "(First section)" : implode(", ", $prevHeadings)) . "
Upcoming sections: " . (empty($nextHeadings) ? "(Final body section)" : implode(", ", $nextHeadings)) . "

Requirements:
- Write ~{$targetWordCount} words of deep, high-value content
- Naturally include focus keyphrase \"{$keyphrase}\" at least once
- Use subheadings (###) if helpful
- Write in Markdown format
- CRITICAL HEADING REQUIREMENT: Do NOT output any section title, H1, or H2 heading. The main section heading (## {$sec['heading']}) will be inserted automatically. Start immediately with body text paragraphs. Use ONLY level 3 subheadings (###) if you need subsections within this section{$secImgInstr}";

        $secRes = AIService::generateContent([
            'model' => $effectiveModel,
            'prompt' => $secPrompt
        ]);
        $trackUsage($secRes);

        $secText = trim($secRes['text']);
        // 1. Strip any leading heading line (# or ##) generated by the AI
        while (preg_match('/^\s*#{1,2}\s+[^\r\n]+/i', $secText)) {
            $secText = preg_replace('/^\s*#{1,2}\s+[^\r\n]+\r?\n*/i', '', $secText);
            $secText = trim($secText);
        }
        // 2. Strip first line if it contains the section heading text without markdown hash
        $lines = explode("\n", $secText);
        if (!empty($lines[0]) && stripos($lines[0], $sec['heading']) !== false) {
            array_shift($lines);
            $secText = trim(implode("\n", $lines));
        }

        $fullArticle .= "## {$sec['heading']}\n\n{$secText}\n\n";

        SSE::send('section_done', [
            'index' => $i,
            'name' => $sec['heading'],
            'wordCount' => SSE::countWords($fullArticle),
            'percent' => $pct
        ]);
    }

    // --- Step 6: Generate Conclusion ---
    SSE::send('progress', ['step' => 'conclusion', 'message' => 'Writing conclusion and call-to-action...', 'percent' => 88]);

    $concImgInstr = "";
    if (!empty($imageAssignments[(string)$numBodySections])) {
        $id = $imageAssignments[(string)$numBodySections][0];
        $concImgInstr = "\n- Image Placement: You MUST place `[IMAGE_{$id}]` on its own line where it fits best.\n";
    }

    $concPrompt = "You are an expert article writer.{$customPromptExtra}{$formatPartLinks($linksByPart[(string)$numBodySections] ?? [])}

Write a strong conclusion (~{$targetWordCount} words) for \"{$title}\".
Focus Keyphrase: \"{$keyphrase}\"
{$toneInstruction}

Requirements:
- Summarize core takeaways
- Include focus keyphrase \"{$keyphrase}\" naturally
- End with an outcome-driven call-to-action linking to \"{$finalCtaLink}\"
- Markdown format (no heading, just paragraphs){$concImgInstr}";

    $concRes = AIService::generateContent([
        'model' => $effectiveModel,
        'prompt' => $concPrompt
    ]);
    $trackUsage($concRes);

    $fullArticle .= "## Conclusion\n\n" . trim($concRes['text']) . "\n\n";

    // --- Step 7: Generate SEO Metadata ---
    SSE::send('progress', ['step' => 'seo', 'message' => 'Crafting SEO meta tags & snippets...', 'percent' => 95]);

    $seoPrompt = "You are an expert SEO specialist.
Based on the following article titled \"{$title}\" with focus keyphrase \"{$keyphrase}\", generate the SEO metadata.

ARTICLE CONTENT:
" . substr($fullArticle, 0, 15000) . "

REQUIREMENTS:
1. Meta Title (50-60 chars, includes keyword)
2. Focus Keyphrase: {$keyphrase}
3. Meta Description (Max 140 chars)
4. URL Slug (Max 60 chars, lowercase, hyphens)
5. Page Role: {$pageRole}
6. Tags (Comma-separated)
7. Excerpt (Brief summary)

Format output EXACTLY like this:
> **SEO Metadata:**
> - **Meta Title:** [Title]
> - **Focus Keyphrase:** {$keyphrase}
> - **Meta Description:** [Description]
> - **URL Slug:** [Slug]
> - **Page Role:** {$pageRole}
> - **Tags:** [Tags]
> - **Excerpt:** [Excerpt]";

    $seoRes = AIService::generateContent([
        'model' => $effectiveModel,
        'prompt' => $seoPrompt
    ]);
    $trackUsage($seoRes);

    $imageSeoMarkdown = "";
    if (!empty($imageSeoResults)) {
        $imageSeoMarkdown = "\n### 📷 Image SEO Metadata\n\n";
        foreach ($imageSeoResults as $img) {
            $header = !empty($img['isFeatured']) ? "Featured Image" : "Image #{$img['id']}";
            $loc = $img['location'] ?? 'Not specified';
            $imageSeoMarkdown .= "#### {$header} (Location: {$loc})\n";
            $imageSeoMarkdown .= "| Element | Generated SEO Content |\n| :--- | :--- |\n";
            $imageSeoMarkdown .= "| **File Name** | `{$img['fileName']}` |\n";
            $imageSeoMarkdown .= "| **Alt Text** | {$img['altText']} |\n";
            $imageSeoMarkdown .= "| **Title** | {$img['title']} |\n";
            $imageSeoMarkdown .= "| **Caption** | {$img['caption']} |\n";
            $imageSeoMarkdown .= "| **Description** | {$img['description']} |\n\n";
        }
    }

    if (!empty($imageSeoMarkdown)) {
        $fullArticle = trim($seoRes['text']) . "\n\n" . $imageSeoMarkdown . "---\n\n" . $fullArticle;
    } else {
        $fullArticle = trim($seoRes['text']) . "\n\n---\n\n" . $fullArticle;
    }

    $finalWordCount = SSE::countWords($fullArticle);

    SSE::send('complete', [
        'article' => $fullArticle,
        'wordCount' => $finalWordCount,
        'percent' => 100,
        'images' => $imageSeoResults,
        'tokenUsage' => [
            'promptTokens' => $promptTokens,
            'candidatesTokens' => $candidatesTokens,
            'totalTokens' => $totalTokens
        ]
    ]);
} catch (Throwable $e) {
    SSE::send('error', ['message' => $e->getMessage()]);
}
