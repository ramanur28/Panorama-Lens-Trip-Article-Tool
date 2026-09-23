<?php
/**
 * Generation Queue API Endpoint
 * Stores studio generation queue items in MySQL
 */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/auth_middleware.php';

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
$id = $_GET['id'] ?? null;
$input = json_decode(file_get_contents('php://input'), true) ?: $_POST;

// --- 1. GET Queue Items (Dynamic Article Manager Sync) ---
if ($method === 'GET') {
    // Dynamically link generation_queue with articles table
    $sql = "SELECT q.*, 
                   a.id AS article_id, 
                   a.status AS article_status, 
                   a.link AS article_link,
                   a.scheduled_date AS article_scheduled_date,
                   a.published_date AS article_published_date,
                   a.wp_post_id AS article_wp_post_id
            FROM generation_queue q
            LEFT JOIN articles a ON (
                a.id = JSON_UNQUOTE(JSON_EXTRACT(q.input_params, '$.managerId'))
                OR (JSON_EXTRACT(q.input_params, '$.managerId') IS NULL AND LOWER(TRIM(q.title)) = LOWER(TRIM(a.title)))
            )
            ORDER BY q.created_at ASC";
    $stmt = $pdo->query($sql);
    $rows = $stmt->fetchAll();

    $items = [];
    $updateStmt = $pdo->prepare("UPDATE generation_queue SET status = ? WHERE id = ?");

    foreach ($rows as $r) {
        $inputParams = !empty($r['input_params']) ? json_decode($r['input_params'], true) : [];
        $currentStatus = $r['status'];

        // Dynamic status resolution based on Article Manager
        if (!in_array($currentStatus, ['generating', 'pending'])) {
            if (!empty($r['article_status'])) {
                if (in_array($r['article_status'], ['dijadwalkan', 'telah_dibuat', 'draft'])) {
                    $currentStatus = $r['article_status'];
                } elseif ($r['article_status'] === 'belum_dibuat' && !empty($r['article_content'])) {
                    $currentStatus = 'complete';
                }
            }
        }

        // Keep physical status in generation_queue in sync if different
        if ($currentStatus !== $r['status'] && !empty($r['id'])) {
            $updateStmt->execute([$currentStatus, $r['id']]);
        }

        $items[] = array_merge($inputParams ?: [], [
            'id' => $r['id'],
            'title' => $r['title'],
            'topic' => $r['topic'] ?? '',
            'keyphrase' => $r['keyphrase'] ?? '',
            'pageRole' => $r['page_role'] ?? 'Cluster',
            'status' => $currentStatus,
            'managerId' => !empty($r['article_id']) ? (int)$r['article_id'] : ($inputParams['managerId'] ?? null),
            'link' => !empty($r['article_link']) ? $r['article_link'] : ($inputParams['link'] ?? ''),
            'scheduledDate' => !empty($r['article_scheduled_date']) ? $r['article_scheduled_date'] : ($inputParams['scheduledDate'] ?? null),
            'publishedDate' => !empty($r['article_published_date']) ? $r['article_published_date'] : ($inputParams['publishedDate'] ?? null),
            'wpPostId' => !empty($r['article_wp_post_id']) ? (int)$r['article_wp_post_id'] : ($inputParams['wpPostId'] ?? null),
            'progress' => (int)$r['progress'],
            'progressMessage' => $r['progress_message'] ?? '',
            'mode' => $r['mode'] ?? 'standard',
            'targetWordCount' => (int)$r['target_word_count'],
            'article' => $r['article_content'] ?? '',
            'error' => $r['error_message'] ?? null,
            'createdAt' => $r['created_at']
        ]);
    }

    echo json_encode($items);
    exit;
}

// --- 2. POST Save / Update Queue Items ---
if ($method === 'POST') {
    $items = is_array($input) ? (isset($input['id']) ? [$input] : $input) : [];

    $ins = $pdo->prepare("REPLACE INTO generation_queue (
        id, user_id, title, topic, keyphrase, page_role, status, progress,
        progress_message, mode, target_word_count, article_content, input_params, error_message
    ) VALUES (
        :id, :user_id, :title, :topic, :keyphrase, :page_role, :status, :progress,
        :progress_message, :mode, :target_word_count, :article_content, :input_params, :error_message
    )");

    $pdo->beginTransaction();
    foreach ($items as $item) {
        $qId = $item['id'] ?? ('art_' . time() . '_' . substr(md5(mt_rand()), 0, 6));
        $title = $item['title'] ?? 'Untitled';
        $topic = $item['topic'] ?? '';
        $kp = $item['keyphrase'] ?? '';
        $role = $item['pageRole'] ?? 'Cluster';
        $status = $item['status'] ?? 'pending';
        $prog = (int)($item['progress'] ?? 0);
        $progMsg = $item['progressMessage'] ?? '';
        $mode = $item['mode'] ?? 'standard';
        $wc = (int)($item['targetWordCount'] ?? 2500);
        $art = $item['article'] ?? null;
        $err = $item['error'] ?? null;

        $ins->execute([
            ':id' => $qId,
            ':user_id' => $session['user_id'],
            ':title' => $title,
            ':topic' => $topic,
            ':keyphrase' => $kp,
            ':page_role' => $role,
            ':status' => $status,
            ':progress' => $prog,
            ':progress_message' => $progMsg,
            ':mode' => $mode,
            ':target_word_count' => $wc,
            ':article_content' => $art,
            ':input_params' => json_encode($item),
            ':error_message' => $err
        ]);
    }
    $pdo->commit();

    echo json_encode(['success' => true, 'count' => count($items)]);
    exit;
}

// --- 3. DELETE Queue Item(s) ---
if ($method === 'DELETE') {
    if (!empty($id)) {
        $stmt = $pdo->prepare("DELETE FROM generation_queue WHERE id = ?");
        $stmt->execute([$id]);
        echo json_encode(['success' => true, 'message' => "Item '{$id}' removed."]);
        exit;
    } else {
        Auth::requireAdmin();
        $pdo->exec("TRUNCATE TABLE generation_queue");
        echo json_encode(['success' => true, 'message' => 'Queue cleared.']);
        exit;
    }
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed.']);
