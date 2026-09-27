<?php
/**
 * WordPress REST API Service
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/markdown_helper.php';
require_once __DIR__ . '/ai_service.php';

class WordPressService {
    public static function sanitizeUrl(?string $url): string {
        if (empty($url)) return '';
        $url = trim($url);
        if (!preg_match('/^https?:\/\//i', $url)) {
            $url = 'https://' . $url;
        }
        return rtrim($url, '/');
    }

    public static function verifyConfig(?string $url, ?string $username, ?string $password): array {
        $settings = AIService::getSettings();
        $wpUrl = self::sanitizeUrl($url ?: ($settings['wp_url'] ?? ''));
        $user = trim($username ?: ($settings['wp_username'] ?? ''));
        $pass = str_replace(' ', '', trim($password ?: ($settings['wp_app_password'] ?? '')));

        if (empty($wpUrl)) {
            return ['success' => false, 'error' => 'WordPress Site URL is required.'];
        }

        $headers = [
            'User-Agent: Panorama-Lens-Trip-Article-Tool/2.0 (PHP)',
            'Accept: application/json'
        ];

        $hasAuth = !empty($user) && !empty($pass);
        if ($hasAuth) {
            $headers[] = 'Authorization: Basic ' . base64_encode("{$user}:{$pass}");
        }

        $endpoint = $hasAuth ? "{$wpUrl}/wp-json/wp/v2/users/me" : "{$wpUrl}/wp-json/wp/v2/posts?per_page=1";

        $ch = curl_init($endpoint);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_SSL_VERIFYPEER => true
        ]);

        $res = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        if (PHP_VERSION_ID < 80000) { @curl_close($ch); }

        if ($err) {
            return ['success' => false, 'error' => "Network error connecting to {$wpUrl}: {$err}"];
        }

        $json = json_decode($res, true);

        if ($code >= 200 && $code < 300) {
            $name = $json['name'] ?? $json['slug'] ?? $user;
            return [
                'success' => true,
                'authenticated' => $hasAuth,
                'user' => $name,
                'message' => $hasAuth 
                    ? "Successfully connected & authenticated with WordPress as '{$name}'!" 
                    : "Connected to WordPress REST API at {$wpUrl} (Public access only)."
            ];
        }

        $msg = $json['message'] ?? "HTTP error {$code}";
        return [
            'success' => false,
            'authenticated' => false,
            'error' => "WordPress authentication failed ({$code}): {$msg}"
        ];
    }

    public static function uploadMedia(string $wpUrl, string $authHeader, string $filePath, string $fileName, array $seoMeta = []): ?array {
        if (!file_exists($filePath)) return null;

        $mimeType = mime_content_type($filePath) ?: 'image/jpeg';
        $fileData = file_get_contents($filePath);
        if (!$fileData) return null;

        $endpoint = "{$wpUrl}/wp-json/wp/v2/media";
        $ch = curl_init($endpoint);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $fileData,
            CURLOPT_HTTPHEADER => [
                $authHeader,
                "Content-Type: {$mimeType}",
                "Content-Disposition: attachment; filename=\"{$fileName}\""
            ],
            CURLOPT_TIMEOUT => 60,
            CURLOPT_SSL_VERIFYPEER => true
        ]);

        $res = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if (PHP_VERSION_ID < 80000) { @curl_close($ch); }

        $json = json_decode($res, true);
        if ($code < 200 || $code >= 300 || empty($json['id'])) {
            return null;
        }

        $mediaId = (int)$json['id'];
        $sourceUrl = $json['source_url'] ?? '';

        $updateData = [];
        if (!empty($seoMeta['altText'])) $updateData['alt_text'] = $seoMeta['altText'];
        if (!empty($seoMeta['title'])) $updateData['title'] = $seoMeta['title'];
        if (!empty($seoMeta['caption'])) $updateData['caption'] = $seoMeta['caption'];
        if (!empty($seoMeta['description'])) $updateData['description'] = $seoMeta['description'];

        if (!empty($updateData)) {
            $ch2 = curl_init("{$endpoint}/{$mediaId}");
            curl_setopt_array($ch2, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => json_encode($updateData),
                CURLOPT_HTTPHEADER => [
                    $authHeader,
                    'Content-Type: application/json'
                ],
                CURLOPT_TIMEOUT => 20,
                CURLOPT_SSL_VERIFYPEER => true
            ]);
            curl_exec($ch2);
            if (PHP_VERSION_ID < 80000) { @curl_close($ch2); }
        }

        return [
            'id' => $mediaId,
            'url' => $sourceUrl,
            'fileName' => $fileName,
            'altText' => $seoMeta['altText'] ?? '',
            'caption' => $seoMeta['caption'] ?? ''
        ];
    }

    public static function postToWordPress(array $params): array {
        $settings = AIService::getSettings();
        $wpUrl = self::sanitizeUrl($params['url'] ?? $settings['wp_url'] ?? '');
        $user = trim($params['username'] ?? $settings['wp_username'] ?? '');
        $pass = str_replace(' ', '', trim($params['password'] ?? $settings['wp_app_password'] ?? ''));

        if (empty($wpUrl) || empty($user) || empty($pass)) {
            return [
                'success' => false,
                'error' => 'WordPress credentials (site URL, username & application password) are required in Settings.'
            ];
        }

        $authHeader = 'Authorization: Basic ' . base64_encode("{$user}:{$pass}");
        $content = $params['content'] ?? '';
        $title = $params['title'] ?? 'New Article';
        $action = $params['action'] ?? 'publish';
        $date = $params['date'] ?? date('Y-m-d H:i:s');
        $rawImages = $params['images'] ?? [];

        $articleSeo = MarkdownHelper::parseArticleSeo($content, ['title' => $title]);
        $imageSeoMap = MarkdownHelper::parseImageSeo($content);

        $imageMap = [];
        $featuredMediaId = null;

        if (is_array($rawImages)) {
            foreach ($rawImages as $idx => $img) {
                $num = $img['id'] ?? ($idx + 1);
                $seoMeta = $imageSeoMap[$num] ?? $img;
                $fileName = $img['fileName'] ?? ($seoMeta['fileName'] ?? "image-{$num}.jpg");

                $filePath = null;
                if (!empty($img['imageUrl'])) {
                    $possible = ROOT_PATH . '/' . ltrim($img['imageUrl'], '/');
                    if (file_exists($possible)) $filePath = $possible;
                }
                if (!$filePath) {
                    $possible = UPLOAD_DIR . '/' . $fileName;
                    if (file_exists($possible)) $filePath = $possible;
                }

                if ($filePath && file_exists($filePath)) {
                    $uploaded = self::uploadMedia($wpUrl, $authHeader, $filePath, $fileName, $seoMeta);
                    if ($uploaded) {
                        $imageMap[$num] = [
                            'url' => $uploaded['url'],
                            'altText' => $uploaded['altText'],
                            'caption' => $uploaded['caption'],
                            'wpId' => $uploaded['id']
                        ];
                        if ($idx === 0 || !empty($img['isFeatured'])) {
                            $featuredMediaId = $uploaded['id'];
                        }
                    }
                }
            }
        }

        $htmlContent = MarkdownHelper::toWordPressHtml($content, $imageMap);

        $postStatus = ($action === 'publish') ? 'publish' : 'future';
        $formattedDate = date('Y-m-d\TH:i:s', strtotime($date));

        $postData = [
            'title' => $title,
            'content' => $htmlContent,
            'status' => $postStatus,
            'date' => $formattedDate,
            'meta' => []
        ];

        if ($featuredMediaId) {
            $postData['featured_media'] = $featuredMediaId;
        }

        if (!empty($articleSeo['urlSlug'])) {
            $postData['slug'] = $articleSeo['urlSlug'];
        }

        if (!empty($articleSeo['excerpt'])) {
            $postData['excerpt'] = $articleSeo['excerpt'];
        }

        if (!empty($articleSeo['metaTitle'])) {
            $postData['meta']['_yoast_wpseo_title'] = $articleSeo['metaTitle'];
            $postData['meta']['rank_math_title'] = $articleSeo['metaTitle'];
        }
        if (!empty($articleSeo['metaDescription'])) {
            $postData['meta']['_yoast_wpseo_metadesc'] = $articleSeo['metaDescription'];
            $postData['meta']['rank_math_description'] = $articleSeo['metaDescription'];
        }
        if (!empty($articleSeo['focusKeyphrase'])) {
            $postData['meta']['_yoast_wpseo_focuskw'] = $articleSeo['focusKeyphrase'];
            $postData['meta']['rank_math_focus_keyword'] = $articleSeo['focusKeyphrase'];
        }

        if (!empty($articleSeo['tags'])) {
            $tagIds = [];
            foreach ($articleSeo['tags'] as $tagName) {
                $tId = self::getOrCreateTagId($wpUrl, $authHeader, $tagName);
                if ($tId) $tagIds[] = $tId;
            }
            if (!empty($tagIds)) {
                $postData['tags'] = $tagIds;
            }
        }

        $ch = curl_init("{$wpUrl}/wp-json/wp/v2/posts");
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($postData),
            CURLOPT_HTTPHEADER => [
                $authHeader,
                'Content-Type: application/json'
            ],
            CURLOPT_TIMEOUT => 45,
            CURLOPT_SSL_VERIFYPEER => true
        ]);

        $res = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        if (PHP_VERSION_ID < 80000) { @curl_close($ch); }

        if ($err) {
            return ['success' => false, 'error' => "Network error posting to WordPress: {$err}"];
        }

        $json = json_decode($res, true);
        if ($code >= 200 && $code < 300 && !empty($json['id'])) {
            return [
                'success' => true,
                'wpPost' => [
                    'id' => $json['id'],
                    'link' => $json['link'] ?? '',
                    'status' => $json['status'] ?? $postStatus
                ]
            ];
        }

        $errMsg = $json['message'] ?? "WordPress returned HTTP {$code}";
        return ['success' => false, 'error' => $errMsg];
    }

    private static function getOrCreateTagId(string $wpUrl, string $authHeader, string $tagName): ?int {
        $clean = trim($tagName);
        if (empty($clean)) return null;

        $ch = curl_init("{$wpUrl}/wp-json/wp/v2/tags?search=" . urlencode($clean));
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => [$authHeader],
            CURLOPT_TIMEOUT => 10,
            CURLOPT_SSL_VERIFYPEER => true
        ]);
        $res = curl_exec($ch);
        if (PHP_VERSION_ID < 80000) { @curl_close($ch); }

        $tags = json_decode($res, true);
        if (is_array($tags)) {
            foreach ($tags as $t) {
                if (strcasecmp($t['name'] ?? '', $clean) === 0) {
                    return (int)$t['id'];
                }
            }
        }

        $ch2 = curl_init("{$wpUrl}/wp-json/wp/v2/tags");
        curl_setopt_array($ch2, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode(['name' => $clean]),
            CURLOPT_HTTPHEADER => [
                $authHeader,
                'Content-Type: application/json'
            ],
            CURLOPT_TIMEOUT => 10,
            CURLOPT_SSL_VERIFYPEER => true
        ]);
        $res2 = curl_exec($ch2);
        if (PHP_VERSION_ID < 80000) { @curl_close($ch2); }

        $newTag = json_decode($res2, true);
        return !empty($newTag['id']) ? (int)$newTag['id'] : null;
    }

    public static function cleanTitle(string $t): string {
        $t = html_entity_decode(strip_tags($t), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $t = str_replace(["’", "‘", "“", "”", "–", "—", "&amp;"], ["'", "'", '"', '"', "-", "-", "&"], $t);
        $t = preg_replace('/\s+/', ' ', $t);
        return mb_strtolower(trim($t), 'UTF-8');
    }

    public static function fetchAllPosts(string $wpUrl, ?string $username, ?string $password): array {
        $posts = [];
        $page = 1;
        $perPage = 100;
        $hasMore = true;

        $headers = ['User-Agent: Panorama-Lens-Trip-Article-Tool/2.0 (PHP)'];
        $statusParam = 'publish';

        if (!empty($username) && !empty($password)) {
            $headers[] = 'Authorization: Basic ' . base64_encode("{$username}:{$password}");
            $statusParam = 'publish,future,draft';
        }

        while ($hasMore && $page <= 10) {
            $url = "{$wpUrl}/wp-json/wp/v2/posts?per_page={$perPage}&page={$page}&status={$statusParam}&orderby=date&order=desc";
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_TIMEOUT => 25,
                CURLOPT_SSL_VERIFYPEER => true
            ]);
            $res = curl_exec($ch);
            $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            if (PHP_VERSION_ID < 80000) { @curl_close($ch); }

            if ($code !== 200) {
                break;
            }

            $data = json_decode($res, true);
            if (is_array($data) && count($data) > 0) {
                $posts = array_merge($posts, $data);
                if (count($data) < $perPage) {
                    $hasMore = false;
                } else {
                    $page++;
                }
            } else {
                $hasMore = false;
            }
        }

        // Sort posts so newest date/modified always comes first
        usort($posts, function($a, $b) {
            $timeA = strtotime($a['date'] ?? $a['modified'] ?? '1970-01-01');
            $timeB = strtotime($b['date'] ?? $b['modified'] ?? '1970-01-01');
            return $timeB <=> $timeA;
        });

        return $posts;
    }

    public static function syncWordPressArticles(): array {
        $settings = AIService::getSettings();
        $wpUrl = self::sanitizeUrl($settings['wp_url'] ?? '');
        $user = trim($settings['wp_username'] ?? '');
        $pass = str_replace(' ', '', trim($settings['wp_app_password'] ?? ''));

        if (empty($wpUrl)) {
            return ['updatedCount' => 0, 'total' => 0];
        }

        $wpPosts = self::fetchAllPosts($wpUrl, $user, $pass);
        $pdo = Database::getConnection();

        // Index WordPress posts by ID and by cleaned title
        $postsById = [];
        $postsByCleanTitle = [];
        foreach ($wpPosts as $p) {
            $postsById[(string)$p['id']] = $p;
            $ct = self::cleanTitle($p['title']['rendered'] ?? '');
            if ($ct !== '' && !isset($postsByCleanTitle[$ct])) {
                // First encountered is the newest because of usort
                $postsByCleanTitle[$ct] = $p;
            }
        }

        $stmt = $pdo->query("SELECT * FROM articles");
        $articles = $stmt->fetchAll();

        $updatedCount = 0;

        foreach ($articles as $art) {
            $match = null;
            $artTitleClean = self::cleanTitle($art['title']);

            $titleMatch = $postsByCleanTitle[$artTitleClean] ?? null;
            $idMatch = (!empty($art['wp_post_id']) && isset($postsById[(string)$art['wp_post_id']])) 
                ? $postsById[(string)$art['wp_post_id']] 
                : null;

            // Pick the newest post between titleMatch and idMatch
            if ($titleMatch && $idMatch) {
                $timeTitle = strtotime($titleMatch['date'] ?? '1970-01-01');
                $timeId = strtotime($idMatch['date'] ?? '1970-01-01');
                $match = ($timeTitle >= $timeId) ? $titleMatch : $idMatch;
            } elseif ($titleMatch) {
                $match = $titleMatch;
            } elseif ($idMatch) {
                $match = $idMatch;
            }

            if ($match) {
                $wpStatus = $match['status'] ?? 'publish';
                $wpLink = !empty($match['link']) ? $match['link'] : ($art['link'] ?? '');
                $matchDate = !empty($match['date']) ? substr($match['date'], 0, 10) : null;
                $matchPostId = (int)$match['id'];

                if ($wpStatus === 'publish') {
                    $newStatus = 'telah_dibuat';
                    // Ensure date is newest: use WordPress live publish date
                    $pubDate = $matchDate ?: ($art['published_date'] ?: date('Y-m-d'));
                    $schedDate = null; // Cleared because it is now published
                } elseif ($wpStatus === 'future') {
                    $newStatus = 'dijadwalkan';
                    // Future date on WordPress is the scheduled publication date
                    $schedDate = $matchDate ?: ($art['scheduled_date'] ?: date('Y-m-d'));
                    $pubDate = null; // MUST BE NULL so it is never marked as published
                } elseif ($wpStatus === 'draft') {
                    $newStatus = 'draft';
                    $schedDate = null;
                    $pubDate = null;
                } else {
                    $newStatus = 'belum_dibuat';
                    $schedDate = null;
                    $pubDate = null;
                }

                $up = $pdo->prepare("UPDATE articles SET 
                    status = ?, 
                    link = ?, 
                    scheduled_date = ?, 
                    published_date = ?, 
                    wp_post_id = ? 
                    WHERE id = ?");
                $up->execute([$newStatus, $wpLink, $schedDate, $pubDate, $matchPostId, $art['id']]);
                $updatedCount++;

                // Dynamically sync status to generation_queue if item is in queue
                $qSync = $pdo->prepare("UPDATE generation_queue SET status = ?, updated_at = NOW() 
                    WHERE (id = ? 
                       OR JSON_UNQUOTE(JSON_EXTRACT(input_params, '$.managerId')) = ? 
                       OR LOWER(TRIM(title)) = LOWER(?)) 
                       AND status NOT IN ('generating')");
                $qSync->execute([$newStatus, (string)$art['id'], (string)$art['id'], trim($art['title'])]);

                // Also update input_params in generation_queue to keep variables synchronized
                $stmtQ = $pdo->prepare("SELECT id, input_params FROM generation_queue 
                    WHERE (id = ? 
                       OR JSON_UNQUOTE(JSON_EXTRACT(input_params, '$.managerId')) = ? 
                       OR LOWER(TRIM(title)) = LOWER(?))");
                $stmtQ->execute([(string)$art['id'], (string)$art['id'], trim($art['title'])]);
                while ($qRow = $stmtQ->fetch()) {
                    $qParams = json_decode($qRow['input_params'], true) ?: [];
                    $qParams['status'] = $newStatus;
                    $qParams['scheduledDate'] = $schedDate;
                    $qParams['publishedDate'] = $pubDate;
                    if (!empty($wpLink)) $qParams['link'] = $wpLink;
                    if (!empty($matchPostId)) $qParams['wpPostId'] = $matchPostId;
                    $upQ = $pdo->prepare("UPDATE generation_queue SET input_params = ? WHERE id = ?");
                    $upQ->execute([json_encode($qParams), $qRow['id']]);
                }
            }
        }

        $totalStmt = $pdo->query("SELECT COUNT(*) FROM articles");
        $total = (int)$totalStmt->fetchColumn();

        return [
            'updatedCount' => $updatedCount,
            'total' => $total
        ];
    }
}
