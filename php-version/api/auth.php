<?php
/**
 * Authentication API Endpoint
 * Handles login, logout, session check, and password updates
 */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/auth_middleware.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$input = json_decode(file_get_contents('php://input'), true) ?: $_POST;

$pdo = Database::getConnection();

// --- 1. Login ---
if ($action === 'login' || ($method === 'POST' && empty($action) && isset($input['username']))) {
    $username = trim($input['username'] ?? '');
    $password = trim($input['password'] ?? '');

    if (empty($username) || empty($password)) {
        http_response_code(400);
        echo json_encode(['error' => 'Username and password are required.']);
        exit;
    }

    $stmt = $pdo->prepare("SELECT * FROM users WHERE username = ? LIMIT 1");
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        http_response_code(401);
        echo json_encode(['error' => 'Invalid username or password.']);
        exit;
    }

    $token = Auth::createSession((int)$user['id'], $user['username'], $user['role'], $user['name']);

    echo json_encode([
        'success' => true,
        'token' => $token,
        'user' => [
            'id' => (int)$user['id'],
            'username' => $user['username'],
            'role' => $user['role'],
            'name' => $user['name']
        ]
    ]);
    exit;
}

// --- 2. Check Session / Me ---
if ($action === 'me' || $action === 'check-session' || $action === 'status' || ($method === 'GET' && empty($action))) {
    $session = Auth::getSession();
    if (!$session) {
        http_response_code(401);
        echo json_encode(['authenticated' => false, 'error' => 'No active session.']);
        exit;
    }

    echo json_encode([
        'authenticated' => true,
        'user' => [
            'id' => (int)$session['user_id'],
            'username' => $session['username'],
            'role' => $session['role'],
            'name' => $session['name']
        ]
    ]);
    exit;
}

// --- 3. Logout ---
if ($action === 'logout' || ($method === 'POST' && $action === 'logout')) {
    Auth::destroySession();
    echo json_encode(['success' => true, 'message' => 'Logged out successfully.']);
    exit;
}

// --- 4. Change Password & Update Profile Credentials ---
if ($action === 'change-password' || $action === 'update-profile') {
    $session = Auth::requireAuth();
    $oldPass = trim($input['oldPassword'] ?? '');
    $newPass = trim($input['newPassword'] ?? '');
    $newUsername = trim($input['newUsername'] ?? '');
    $newName = trim($input['newName'] ?? '');
    $targetUsername = trim($input['targetUsername'] ?? $session['username']);

    $isAdmin = ($session['role'] === 'admin');
    $isSelf = ($targetUsername === $session['username']);

    $stmt = $pdo->prepare("SELECT * FROM users WHERE username = ? LIMIT 1");
    $stmt->execute([$targetUsername]);
    $targetUser = $stmt->fetch();

    if (!$targetUser) {
        http_response_code(404);
        echo json_encode(['error' => "Pengguna '{$targetUsername}' tidak ditemukan."]);
        exit;
    }

    // Verify current password if user is editing their own account
    if ($isSelf) {
        if (empty($oldPass) || !password_verify($oldPass, $targetUser['password_hash'])) {
            http_response_code(400);
            echo json_encode(['error' => 'Password saat ini salah.']);
            exit;
        }
    } elseif (!$isAdmin) {
        http_response_code(403);
        echo json_encode(['error' => 'Hanya administrator yang dapat mengubah kredensial pengguna lain.']);
        exit;
    }

    $updateFields = [];
    $updateParams = [];

    // Optional New Password
    if (!empty($newPass)) {
        if (strlen($newPass) < 4) {
            http_response_code(400);
            echo json_encode(['error' => 'Password baru minimal 4 karakter.']);
            exit;
        }
        $updateFields[] = "password_hash = ?";
        $updateParams[] = password_hash($newPass, PASSWORD_BCRYPT);
    }

    // Optional New Username
    $finalUsername = $targetUser['username'];
    if (!empty($newUsername) && $newUsername !== $targetUser['username']) {
        if (!preg_match('/^[a-zA-Z0-9_.-]{3,50}$/', $newUsername)) {
            http_response_code(400);
            echo json_encode(['error' => 'Username baru hanya boleh huruf, angka, titik, strip, dan garis bawah (3-50 karakter).']);
            exit;
        }
        $checkStmt = $pdo->prepare("SELECT id FROM users WHERE username = ? AND id != ?");
        $checkStmt->execute([$newUsername, $targetUser['id']]);
        if ($checkStmt->fetch()) {
            http_response_code(400);
            echo json_encode(['error' => "Username '{$newUsername}' sudah digunakan oleh pengguna lain."]);
            exit;
        }
        $updateFields[] = "username = ?";
        $updateParams[] = $newUsername;
        $finalUsername = $newUsername;
    }

    // Optional New Name
    $finalName = $targetUser['name'];
    if (!empty($newName)) {
        $updateFields[] = "name = ?";
        $updateParams[] = $newName;
        $finalName = $newName;
    }

    if (empty($updateFields)) {
        http_response_code(400);
        echo json_encode(['error' => 'Tidak ada perubahan username, nama, atau password yang dimasukkan.']);
        exit;
    }

    $updateParams[] = $targetUser['id'];
    $sql = "UPDATE users SET " . implode(", ", $updateFields) . " WHERE id = ?";
    $upStmt = $pdo->prepare($sql);
    $upStmt->execute($updateParams);

    if ($isSelf) {
        $_SESSION['username'] = $finalUsername;
        $_SESSION['name'] = $finalName;
    }

    echo json_encode([
        'success' => true,
        'message' => 'Kredensial login berhasil diperbarui!',
        'user' => [
            'id' => (int)$targetUser['id'],
            'username' => $finalUsername,
            'role' => $targetUser['role'],
            'name' => $finalName
        ]
    ]);
    exit;
}

http_response_code(404);
echo json_encode(['error' => 'Action not found.']);
