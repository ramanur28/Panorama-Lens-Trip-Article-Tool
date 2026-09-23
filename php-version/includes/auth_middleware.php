<?php
/**
 * Authentication & Role-Based Access Control (RBAC) Middleware
 */

require_once __DIR__ . '/db.php';

class Auth {
    public static function generateToken(): string {
        return 'af_' . bin2hex(random_bytes(16)) . dechex(time()) . bin2hex(random_bytes(8));
    }

    public static function getBearerToken(): ?string {
        $headers = [];
        if (function_exists('getallheaders')) {
            $headers = getallheaders();
        } else {
            foreach ($_SERVER as $name => $value) {
                if (substr($name, 0, 5) === 'HTTP_') {
                    $key = str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($name, 5)))));
                    $headers[$key] = $value;
                }
            }
        }

        $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? $_SERVER['HTTP_AUTHORIZATION'] ?? null;
        if ($authHeader) {
            if (preg_match('/Bearer\s+(\S+)/i', $authHeader, $matches)) {
                return trim($matches[1]);
            }
            return trim($authHeader);
        }

        if (!empty($_GET['token'])) {
            return trim($_GET['token']);
        }

        return null;
    }

    public static function getSession(): ?array {
        $token = self::getBearerToken();
        if (!$token) {
            return null;
        }

        try {
            $pdo = Database::getConnection();
            $stmt = $pdo->prepare("SELECT s.*, u.username, u.role, u.name 
                                   FROM user_sessions s 
                                   JOIN users u ON s.user_id = u.id 
                                   WHERE s.token = ? AND s.expires_at > NOW() 
                                   LIMIT 1");
            $stmt->execute([$token]);
            $session = $stmt->fetch();
            return $session ?: null;
        } catch (Exception $e) {
            return null;
        }
    }

    public static function requireAuth(): array {
        $session = self::getSession();
        if (!$session) {
            http_response_code(401);
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode(['error' => 'Authentication required. Please log in.']);
            exit;
        }
        return $session;
    }

    public static function requireAdmin(): array {
        $session = self::requireAuth();
        if (($session['role'] ?? '') !== 'admin') {
            http_response_code(403);
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode(['error' => 'Admin privileges required.']);
            exit;
        }
        return $session;
    }

    public static function createSession(int $userId, string $username, string $role, string $name): string {
        $pdo = Database::getConnection();
        $token = self::generateToken();
        $expiresAt = date('Y-m-d H:i:s', time() + (SESSION_LIFETIME_HOURS * 3600));
        $ip = $_SERVER['REMOTE_ADDR'] ?? '';
        $ua = substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255);

        $stmt = $pdo->prepare("INSERT INTO user_sessions (token, user_id, username, role, name, ip_address, user_agent, expires_at) 
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([$token, $userId, $username, $role, $name, $ip, $ua, $expiresAt]);

        if (mt_rand(1, 10) === 1) {
            $pdo->query("DELETE FROM user_sessions WHERE expires_at < NOW()");
        }

        return $token;
    }

    public static function destroySession(?string $token = null): bool {
        $token = $token ?: self::getBearerToken();
        if (!$token) return false;
        $pdo = Database::getConnection();
        $stmt = $pdo->prepare("DELETE FROM user_sessions WHERE token = ?");
        return $stmt->execute([$token]);
    }
}
