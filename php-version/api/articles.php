<?php
/**
 * Articles API Endpoint
 * Handles Editorial Calendar, Article Manager CRUD, CSV import/export, and scheduling
 */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/auth_middleware.php';
require_once __DIR__ . '/../includes/wordpress_service.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$session = Auth::requireAuth();
$pdo = Database::getConnection();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$input = json_decode(file_get_contents('php://input'), true) ?: $_POST;

// --- 1. Import CSV ---
if ($action === 'import-csv' && $method === 'POST') {
    $csvContent = $input['csv'] ?? '';
    if (empty($csvContent) && !empty($_FILES['file']['tmp_name'])) {
        $csvContent = file_get_contents($_FILES['file']['tmp_name']);
    }

    if (empty($csvContent)) {
        http_response_code(400);
        echo json_encode(['error' => 'No CSV content provided.']);
        exit;
    }

    $lines = preg_split('/\r\n|\r|\n/', trim($csvContent));
    if (empty($lines)) {
        http_response_code(400);
        echo json_encode(['error' => 'CSV file is empty.']);
        exit;
    }

    $imported = 0;
    $skipped = 0;
    $pdo->beginTransaction();

    $ins = $pdo->prepare("INSERT INTO articles (page_role, keyphrase, title, topic, intent, link, status, scheduled_date, published_date) 
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");

    $isFirst = true;
    foreach ($lines as $line) {
        $line = trim($line);
        if (empty($line)) continue;
        $row = str_getcsv($line, ',', '"', '\\');

        // Skip header if line looks like header
        if ($isFirst && (stripos($row[0] ?? '', 'page') !== false || stripos($row[1] ?? '', 'keyphrase') !== false || stripos($row[2] ?? '', 'title') !== false)) {
            $isFirst = false;
            continue;
        }
        $isFirst = false;

        $pageRole = trim($row[0] ?? 'Cluster');
        $keyphrase = trim($row[1] ?? '');
        $title = trim($row[2] ?? $keyphrase);
        $topic = trim($row[3] ?? '');
        $intent = trim($row[4] ?? 'Informational');
        $link = trim($row[5] ?? '');
        $status = trim($row[6] ?? 'belum_dibuat');
        $sched = !empty($row[7]) ? substr(trim($row[7]), 0, 10) : null;
        $pub = !empty($row[8]) ? substr(trim($row[8]), 0, 10) : null;

        if (empty($title) && empty($keyphrase)) {
            $skipped++;
            continue;
        }

        $ins->execute([$pageRole, $keyphrase, $title, $topic, $intent, $link, $status, $sched, $pub]);
        $imported++;
    }

    $pdo->commit();
    echo json_encode(['success' => true, 'imported' => $imported, 'skipped' => $skipped]);
    exit;
}

// --- 2. Export CSV ---
if ($action === 'export-csv' && $method === 'GET') {
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename=articles_' . date('Y-m-d') . '.csv');

    $out = fopen('php://output', 'w');
    fputcsv($out, ['Page Role', 'Focus Keyphrase', 'Article Title', 'Topic/Question', 'Search Intent', 'Published URL', 'Status', 'Scheduled Date', 'Published Date'], ',', '"', '\\');

    $stmt = $pdo->query("SELECT * FROM articles ORDER BY id ASC");
    while ($r = $stmt->fetch()) {
        fputcsv($out, [
            $r['page_role'],
            $r['keyphrase'],
            $r['title'],
            $r['topic'],
            $r['intent'],
            $r['link'],
            $r['status'],
            $r['scheduled_date'],
            $r['published_date']
        ], ',', '"', '\\');
    }
    fclose($out);
    exit;
}

// --- 3. GET Articles List ---
if ($method === 'GET') {
    $pageRole = trim($_GET['pageRole'] ?? '');
    $status = trim($_GET['status'] ?? '');
    $search = trim($_GET['search'] ?? '');
    $page = max(1, (int)($_GET['page'] ?? 1));
    $limit = !empty($_GET['limit']) ? max(1, min(200, (int)$_GET['limit'])) : 0; // 0 = all

    $where = [];
    $params = [];

    if (!empty($pageRole)) {
        $where[] = "page_role = ?";
        $params[] = $pageRole;
    }
    if (!empty($status)) {
        $where[] = "status = ?";
        $params[] = $status;
    }
    if (!empty($search)) {
        $where[] = "(title LIKE ? OR keyphrase LIKE ? OR topic LIKE ?)";
        $params[] = "%{$search}%";
        $params[] = "%{$search}%";
        $params[] = "%{$search}%";
    }

    $whereSql = !empty($where) ? "WHERE " . implode(" AND ", $where) : "";

    $sql = "SELECT * FROM articles {$whereSql} ORDER BY id ASC";
    if ($limit > 0) {
        $offset = ($page - 1) * $limit;
        $sql .= " LIMIT {$limit} OFFSET {$offset}";
    }

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    $articles = [];
    foreach ($rows as $r) {
        $images = !empty($r['images_json']) ? json_decode($r['images_json'], true) : [];
        $articles[] = [
            'id' => (int)$r['id'],
            'pageRole' => $r['page_role'],
            'keyphrase' => $r['keyphrase'],
            'title' => $r['title'],
            'topic' => $r['topic'],
            'intent' => $r['intent'],
            'link' => $r['link'] ?? '',
            'status' => $r['status'],
            'scheduledDate' => $r['scheduled_date'],
            'publishedDate' => $r['published_date'],
            'article' => $r['article_content'] ?? '',
            'images' => is_array($images) ? $images : [],
            'wpPostId' => $r['wp_post_id'] ? (int)$r['wp_post_id'] : null,
            'createdAt' => $r['created_at'],
            'updatedAt' => $r['updated_at']
        ];
    }

    echo json_encode($articles);
    exit;
}

// --- 4. POST Create or Update Article ---
if ($method === 'POST') {
    $item = $input;
    if (empty($item)) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid article data.']);
        exit;
    }

    $id = !empty($item['id']) ? (int)$item['id'] : null;
    $pageRole = $item['pageRole'] ?? 'Cluster';
    $keyphrase = $item['keyphrase'] ?? '';
    $title = $item['title'] ?? '';
    $topic = $item['topic'] ?? '';
    $intent = $item['intent'] ?? 'Informational';
    $link = $item['link'] ?? '';
    $status = $item['status'] ?? 'belum_dibuat';
    $sched = !empty($item['scheduledDate']) ? substr($item['scheduledDate'], 0, 10) : null;
    $pub = !empty($item['publishedDate']) ? substr($item['publishedDate'], 0, 10) : null;
    $article = $item['article'] ?? null;
    $imagesJson = !empty($item['images']) ? json_encode($item['images']) : null;
    $wpPostId = !empty($item['wpPostId']) ? (int)$item['wpPostId'] : null;

    if ($id) {
        $stmt = $pdo->prepare("UPDATE articles SET 
            page_role = COALESCE(?, page_role),
            keyphrase = COALESCE(?, keyphrase),
            title = COALESCE(?, title),
            topic = COALESCE(?, topic),
            intent = COALESCE(?, intent),
            link = COALESCE(?, link),
            status = COALESCE(?, status),
            scheduled_date = ?,
            published_date = ?,
            article_content = COALESCE(?, article_content),
            images_json = COALESCE(?, images_json),
            wp_post_id = COALESCE(?, wp_post_id)
            WHERE id = ?");
        $stmt->execute([$pageRole, $keyphrase, $title, $topic, $intent, $link, $status, $sched, $pub, $article, $imagesJson, $wpPostId, $id]);

        // Dynamically synchronize status with generation_queue if article is in queue
        if (!empty($status)) {
            $queueStatus = $status;
            if ($status === 'belum_dibuat') {
                $queueStatus = !empty($article) ? 'complete' : 'pending';
            }
            $qSync = $pdo->prepare("UPDATE generation_queue SET status = ?, updated_at = NOW() 
                WHERE (id = ? 
                   OR JSON_UNQUOTE(JSON_EXTRACT(input_params, '$.managerId')) = ? 
                   OR LOWER(TRIM(title)) = LOWER(?)) 
                   AND status NOT IN ('generating')");
            $qSync->execute([$queueStatus, (string)$id, (string)$id, trim($title)]);
        }

        echo json_encode(['success' => true, 'id' => $id]);
        exit;
    } else {
        $stmt = $pdo->prepare("INSERT INTO articles (page_role, keyphrase, title, topic, intent, link, status, scheduled_date, published_date, article_content, images_json, wp_post_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([$pageRole, $keyphrase, $title, $topic, $intent, $link, $status, $sched, $pub, $article, $imagesJson, $wpPostId]);
        $newId = (int)$pdo->lastInsertId();

        echo json_encode(['success' => true, 'id' => $newId]);
        exit;
    }
}

// --- 5. DELETE Article ---
if ($method === 'DELETE') {
    $delId = !empty($_GET['id']) ? (int)$_GET['id'] : null;
    if (!$delId && !empty($input['id'])) {
        $delId = (int)$input['id'];
    }

    if (!$delId) {
        http_response_code(400);
        echo json_encode(['error' => 'Article ID is required for deletion.']);
        exit;
    }

    $stmt = $pdo->prepare("DELETE FROM articles WHERE id = ?");
    $stmt->execute([$delId]);

    echo json_encode(['success' => true, 'message' => "Article #{$delId} deleted."]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed.']);
