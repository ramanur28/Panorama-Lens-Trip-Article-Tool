<?php
/**
 * Markdown to HTML Converter & SEO Metadata Parser
 */

class MarkdownHelper {
    public static function parseArticleSeo(string $markdown, array $fallback = []): array {
        $meta = [
            'metaTitle' => $fallback['title'] ?? '',
            'focusKeyphrase' => $fallback['keyphrase'] ?? '',
            'metaDescription' => '',
            'urlSlug' => '',
            'pageRole' => $fallback['pageRole'] ?? 'Cluster',
            'tags' => [],
            'excerpt' => ''
        ];

        if (preg_match('/(?:^|\n)>\s*\*\*SEO Metadata:\*\*([\s\S]*?)(?=\n---\s*|\n#{1,3}\s+|\n\n[A-Za-z0-9#]|$)/i', $markdown, $matches)) {
            $block = $matches[1];

            if (preg_match('/>\s*-\s*\*\*Meta Title:\*\*\s*(.+)/i', $block, $m)) {
                $meta['metaTitle'] = trim($m[1]);
            }
            if (preg_match('/>\s*-\s*\*\*Focus Keyphrase:\*\*\s*(.+)/i', $block, $m)) {
                $meta['focusKeyphrase'] = trim($m[1]);
            }
            if (preg_match('/>\s*-\s*\*\*Meta Description:\*\*\s*(.+)/i', $block, $m)) {
                $meta['metaDescription'] = trim($m[1]);
            }
            if (preg_match('/>\s*-\s*\*\*URL Slug:\*\*\s*(.+)/i', $block, $m)) {
                $slug = trim($m[1]);
                $slug = preg_replace('/^https?:\/\/[^\/]+\//i', '', $slug);
                $slug = trim($slug, '/');
                $meta['urlSlug'] = $slug;
            }
            if (preg_match('/>\s*-\s*\*\*Page Role:\*\*\s*(.+)/i', $block, $m)) {
                $meta['pageRole'] = trim($m[1]);
            }
            if (preg_match('/>\s*-\s*\*\*Tags:\*\*\s*(.+)/i', $block, $m)) {
                $tagStr = trim($m[1]);
                $meta['tags'] = array_values(array_filter(array_map('trim', explode(',', $tagStr))));
            }
            if (preg_match('/>\s*-\s*\*\*Excerpt:\*\*\s*(.+)/i', $block, $m)) {
                $meta['excerpt'] = trim($m[1]);
            }
        }

        return $meta;
    }

    public static function parseImageSeo(string $markdown): array {
        $images = [];
        $pattern = '/####\s*(Featured Image|Image\s*#?(\d+))[\s\S]*?\|[\s\S]*?(?=(?:####|\n---\s*|\n#\s+|$))/i';

        if (preg_match_all($pattern, $markdown, $matches, PREG_SET_ORDER)) {
            foreach ($matches as $match) {
                $block = $match[0];
                $isFeatured = stripos($match[1], 'Featured') !== false;
                $num = $isFeatured ? 1 : (int)($match[2] ?? 1);

                $imgData = [
                    'id' => $num,
                    'isFeatured' => $isFeatured,
                    'fileName' => '',
                    'altText' => '',
                    'title' => '',
                    'caption' => '',
                    'description' => ''
                ];

                if (preg_match('/\|\s*\*\*File Name\*\*\s*\|\s*`?([^`|\n]+)`?\s*\|/i', $block, $m)) {
                    $imgData['fileName'] = trim($m[1]);
                }
                if (preg_match('/\|\s*\*\*Alt Text\*\*\s*\|\s*([^|\n]+)\s*\|/i', $block, $m)) {
                    $imgData['altText'] = trim($m[1]);
                }
                if (preg_match('/\|\s*\*\*Title\*\*\s*\|\s*([^|\n]+)\s*\|/i', $block, $m)) {
                    $imgData['title'] = trim($m[1]);
                }
                if (preg_match('/\|\s*\*\*Caption\*\*\s*\|\s*([^|\n]+)\s*\|/i', $block, $m)) {
                    $imgData['caption'] = trim($m[1]);
                }
                if (preg_match('/\|\s*\*\*Description\*\*\s*\|\s*([^|\n]+)\s*\|/i', $block, $m)) {
                    $imgData['description'] = trim($m[1]);
                }

                $images[$num] = $imgData;
            }
        }

        return $images;
    }

    public static function cleanDoubleHeadings(string $markdown): string {
        $prev = '';
        while ($prev !== $markdown) {
            $prev = $markdown;
            $markdown = preg_replace('/^(##\s+[^\r\n]+)\r?\n+\s*#{1,2}\s+[^\r\n]+/m', "$1\n", $markdown);
        }
        return $markdown;
    }

    public static function stripInternalMetadata(string $markdown): string {
        $clean = $markdown;
        $clean = preg_replace('/(?:^|\n)>\s*\*\*SEO Metadata:\*\*[\s\S]*?(?=\n---\s*|\n#{1,3}\s+|\n\n[A-Za-z0-9#]|$)/i', '', $clean);
        $clean = preg_replace('/(?:^|\n)#{1,4}\s*SEO Metadata[\s\S]*?(?=\n---\s*|\n#{1,3}\s+|\n\n[A-Za-z0-9#]|$)/i', '', $clean);
        $clean = preg_replace('/(?:^|\n)#{1,4}\s*.*?Image SEO Metadata[\s\S]*?(?=\n---\s*|\n#\s+[^\n]+|$)/i', '', $clean);
        $clean = preg_replace('/^---\s*\n/m', '', $clean);
        return trim($clean);
    }

    public static function toWordPressHtml(string $markdown, array $imageMap = []): string {
        $md = self::stripInternalMetadata($markdown);

        // 1. Strip leading H1 title (# Title of Article) to prevent duplicate <h1> in WordPress body
        $md = preg_replace('/^\s*#\s+[^\n]+\r?\n*/', '', $md);
        $md = trim($md);

        // Remove redundant double headings (e.g. ## Heading immediately followed by # or ## subtitle)
        $md = self::cleanDoubleHeadings($md);

        // 2. Detect and extract TL;DR / Key Takeaways callout block
        $tldrHtml = '';

        // Pattern A: Standard Blockquote format (> **TL;DR:** or > **Key Takeaways:**)
        if (preg_match('/^(?:>\s*\*\*(?:TL;?DR|Key Takeaways)[^*]*\*\*[\s\S]*?)(?=\r?\n\s*\r?\n[A-Za-z0-9#]|\r?\n#{1,3}\s+|$)/i', $md, $tm)) {
            $rawTldr = $tm[0];
            $md = trim(substr($md, strlen($rawTldr)));
            $lines = explode("\n", $rawTldr);
            $items = [];
            foreach ($lines as $line) {
                $cleanLine = trim(preg_replace('/^>\s*[-*]?\s*/', '', $line));
                // Skip header line if it only says TL;DR or Key Takeaways
                $stripped = trim(preg_replace('/^[*_#\s>:-]+|[*_#\s>:-]+$/', '', $cleanLine));
                if (preg_match('/^(?:TL;?DR|Key Takeaways|Ringkasan(?:\s+Utama)?)$/i', $stripped)) {
                    continue;
                }
                if ($cleanLine && !preg_match('/^(?:\*|_|#|\s)*(?:TL;?DR|Key Takeaways)/i', $cleanLine)) {
                    // Replace legacy generic "Key Point X:" with clean topic text if present
                    $cleanLine = preg_replace('/^\*\*(?:Key Point|Poin Utama|Point)\s*\d+\s*:\*\*\s*/i', '', $cleanLine);
                    $items[] = self::inlineMarkdown($cleanLine);
                }
            }
            if (!empty($items)) {
                $listItems = implode("\n", array_map(function($it) {
                    return "    <li style=\"margin-bottom:6px;\">{$it}</li>";
                }, $items));
                $tldrHtml = "<!-- wp:group {\"className\":\"tldr-box\"} -->\n" .
                    "<div class=\"wp-block-group tldr-box\" style=\"border:1px solid #1a84ee;border-left:5px solid #1a84ee;border-radius:8px;padding:18px 22px;background-color:#f8faff;margin:20px 0 28px 0;\">\n" .
                    "  <p style=\"font-size:1.15em;font-weight:700;color:#0b4d8c;margin-top:0;margin-bottom:12px;\"><strong>TL;DR</strong></p>\n" .
                    "  <ul style=\"margin-bottom:0;padding-left:20px;color:#1f2937;line-height:1.6;\">\n" .
                    "{$listItems}\n" .
                    "  </ul>\n" .
                    "</div>\n" .
                    "<!-- /wp:group -->";
            }
        } elseif (preg_match('/^(?:[-*]\s+.+\r?\n?){2,8}(?=\r?\n+[A-Za-z0-9#]|$)/', $md, $lm)) {
            // Pattern B (Backward compatibility): Leading bullet points before introduction paragraphs
            $rawList = $lm[0];
            $md = trim(substr($md, strlen($rawList)));
            $lines = explode("\n", $rawList);
            $items = [];
            foreach ($lines as $line) {
                $cleanLine = trim(preg_replace('/^[-*]\s+/', '', $line));
                if ($cleanLine) {
                    $items[] = self::inlineMarkdown($cleanLine);
                }
            }
            if (!empty($items)) {
                $listItems = implode("\n", array_map(function($it) {
                    return "    <li style=\"margin-bottom:6px;\">{$it}</li>";
                }, $items));
                $tldrHtml = "<!-- wp:group {\"className\":\"tldr-box\"} -->\n" .
                    "<div class=\"wp-block-group tldr-box\" style=\"border:1px solid #1a84ee;border-left:5px solid #1a84ee;border-radius:8px;padding:18px 22px;background-color:#f8faff;margin:20px 0 28px 0;\">\n" .
                    "  <p style=\"font-size:1.15em;font-weight:700;color:#0b4d8c;margin-top:0;margin-bottom:12px;\"><strong>TL;DR</strong></p>\n" .
                    "  <ul style=\"margin-bottom:0;padding-left:20px;color:#1f2937;line-height:1.6;\">\n" .
                    "{$listItems}\n" .
                    "  </ul>\n" .
                    "</div>\n" .
                    "<!-- /wp:group -->";
            }
        }

        // 3. Process image placeholders
        $md = preg_replace_callback('/\[IMAGE[_\s#]*(\d+)\]/i', function($matches) use ($imageMap) {
            $num = (int)$matches[1];
            if (isset($imageMap[$num])) {
                $img = $imageMap[$num];
                $src = htmlspecialchars($img['url'] ?? '', ENT_QUOTES, 'UTF-8');
                $alt = htmlspecialchars($img['altText'] ?? '', ENT_QUOTES, 'UTF-8');
                $caption = htmlspecialchars($img['caption'] ?? '', ENT_QUOTES, 'UTF-8');
                $wpId = !empty($img['wpId']) ? 'wp-image-' . (int)$img['wpId'] : '';

                $captionHtml = $caption ? "<figcaption class=\"wp-element-caption\">{$caption}</figcaption>" : "";
                return "\n\n<figure class=\"wp-block-image size-large {$wpId}\"><img src=\"{$src}\" alt=\"{$alt}\" class=\"{$wpId}\"/>{$captionHtml}</figure>\n\n";
            }
            return '';
        }, $md);

        // 4. Tables
        $md = self::convertTables($md);

        // 5. Headings: STRICTLY convert single '#' to '<h2>' to avoid duplicate H1 in WordPress post
        $md = preg_replace('/^######\s+(.+)$/m', '<h6>$1</h6>', $md);
        $md = preg_replace('/^#####\s+(.+)$/m', '<h5>$1</h5>', $md);
        $md = preg_replace('/^####\s+(.+)$/m', '<h4>$1</h4>', $md);
        $md = preg_replace('/^###\s+(.+)$/m', '<h3>$1</h3>', $md);
        $md = preg_replace('/^##\s+(.+)$/m', '<h2>$1</h2>', $md);
        $md = preg_replace('/^#\s+(.+)$/m', '<h3>$1</h3>', $md);

        // 6. Blockquotes
        $md = preg_replace('/^>\s+(.+)$/m', '<blockquote class=\"wp-block-quote\"><p>$1</p></blockquote>', $md);
        $md = self::inlineMarkdown($md);

        // 7. Unordered / Ordered Lists
        $lines = explode("\n", $md);
        $inList = false;
        $processed = [];

        foreach ($lines as $line) {
            $trimmed = trim($line);
            if (preg_match('/^[-*]\s+(.+)$/', $trimmed, $m)) {
                if (!$inList) {
                    $processed[] = '<ul>';
                    $inList = true;
                }
                $processed[] = '<li>' . $m[1] . '</li>';
            } else {
                if ($inList) {
                    $processed[] = '</ul>';
                    $inList = false;
                }
                $processed[] = $line;
            }
        }
        if ($inList) {
            $processed[] = '</ul>';
        }
        $md = implode("\n", $processed);

        // 8. Paragraph blocks
        $blocks = preg_split('/\n\s*\n/', $md);
        $finalBlocks = [];
        if (!empty($tldrHtml)) {
            $finalBlocks[] = $tldrHtml;
        }

        foreach ($blocks as $block) {
            $trim = trim($block);
            if (empty($trim)) continue;

            if (preg_match('/^<(h[1-6]|ul|ol|table|figure|blockquote|div|!--)/i', $trim)) {
                $finalBlocks[] = $trim;
            } else {
                $finalBlocks[] = '<p>' . nl2br($trim) . '</p>';
            }
        }

        return implode("\n\n", $finalBlocks);
    }

public static function inlineMarkdown(string $text): string {
        $text = preg_replace('/\[([^\]]+)\]\(([^)]+)\)/', '<a href="$2">$1</a>', $text);
        $text = preg_replace('/\*\*\*([^*]+)\*\*\*/', '<strong><em>$1</em></strong>', $text);
        $text = preg_replace('/\*\*([^*]+)\*\*/', '<strong>$1</strong>', $text);
        $text = preg_replace('/\*([^*]+)\*/', '<em>$1</em>', $text);
        $text = preg_replace('/`([^`]+)`/', '<code>$1</code>', $text);
        return $text;
    }

    private static function convertTables(string $text): string {
        $pattern = '/((?:\|[^\n]+\|\r?\n)+)/';
        return preg_replace_callback($pattern, function($matches) {
            $lines = array_filter(array_map('trim', explode("\n", trim($matches[1]))));
            if (count($lines) < 2) return $matches[0];

            $headerLine = array_shift($lines);
            $sepLine = array_shift($lines);

            if (!preg_match('/^\|[\s\-:|]+\|$/', $sepLine)) {
                return $matches[0];
            }

            $headers = array_filter(array_map('trim', explode('|', trim($headerLine, '|'))));
            $thHtml = '';
            foreach ($headers as $th) {
                $thHtml .= '<th>' . htmlspecialchars($th, ENT_QUOTES, 'UTF-8') . '</th>';
            }

            $trHtml = '';
            foreach ($lines as $rowLine) {
                $cells = array_map('trim', explode('|', trim($rowLine, '|')));
                $trHtml .= '<tr>';
                foreach ($cells as $td) {
                    $trHtml .= '<td>' . htmlspecialchars($td, ENT_QUOTES, 'UTF-8') . '</td>';
                }
                $trHtml .= '</tr>';
            }

            return "<table class=\"wp-block-table\"><thead><tr>{$thHtml}</tr></thead><tbody>{$trHtml}</tbody></table>";
        }, $text);
    }
}
