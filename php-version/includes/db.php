<?php
/**
 * Database Connection & Schema Auto-Initializer
 * Uses PDO for secure prepared statements
 */

require_once __DIR__ . '/../config.php';

class Database {
    private static ?PDO $instance = null;

    public static function getConnection(): PDO {
        if (self::$instance !== null) {
            return self::$instance;
        }

        $host = DB_HOST;
        $port = DB_PORT;
        $dbname = DB_NAME;
        $user = DB_USER;
        $pass = DB_PASS;
        $charset = DB_CHARSET;

        $dsn = "mysql:host={$host};port={$port};dbname={$dbname};charset={$charset}";
        $options = [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false
        ];

        try {
            self::$instance = new PDO($dsn, $user, $pass, $options);
        } catch (PDOException $e) {
            // If database does not exist, attempt to create it
            if ($e->getCode() == 1049) {
                try {
                    $rootDsn = "mysql:host={$host};port={$port};charset={$charset}";
                    $tmpPdo = new PDO($rootDsn, $user, $pass, $options);
                    $tmpPdo->exec("CREATE DATABASE IF NOT EXISTS `{$dbname}` CHARACTER SET {$charset} COLLATE {$charset}_unicode_ci");
                    self::$instance = new PDO($dsn, $user, $pass, $options);
                } catch (Exception $inner) {
                    throw new Exception("Database '{$dbname}' not found: " . $e->getMessage());
                }
            } else {
                throw new Exception("Database connection error: " . $e->getMessage());
            }
        }

        self::ensureSchema(self::$instance);
        return self::$instance;
    }

    private static function ensureSchema(PDO $pdo): void {
        static $checked = false;
        if ($checked) return;

        try {
            $stmt = $pdo->query("SHOW TABLES LIKE 'users'");
            if ($stmt->rowCount() === 0) {
                $schemaFile = file_exists(__DIR__ . '/../database.example.sql') ? __DIR__ . '/../database.example.sql' : __DIR__ . '/../database.sql';
                if (file_exists($schemaFile)) {
                    $sql = file_get_contents($schemaFile);
                    $pdo->exec($sql);
                }
            }

            // Ensure default admin user
            $stmt = $pdo->prepare("SELECT id FROM users WHERE username = ?");
            $stmt->execute([DEFAULT_ADMIN_USER]);
            if ($stmt->rowCount() === 0) {
                $hash = password_hash(DEFAULT_ADMIN_PASS, PASSWORD_BCRYPT);
                $ins = $pdo->prepare("INSERT INTO users (username, password_hash, role, name) VALUES (?, ?, 'admin', ?)");
                $ins->execute([DEFAULT_ADMIN_USER, $hash, DEFAULT_ADMIN_NAME]);
            }

            // Ensure default regular user
            $stmt = $pdo->prepare("SELECT id FROM users WHERE username = ?");
            $stmt->execute([DEFAULT_USER_NAME]);
            if ($stmt->rowCount() === 0) {
                $hash = password_hash(DEFAULT_USER_PASS, PASSWORD_BCRYPT);
                $ins = $pdo->prepare("INSERT INTO users (username, password_hash, role, name) VALUES (?, ?, 'user', ?)");
                $ins->execute([DEFAULT_USER_NAME, $hash, DEFAULT_USER_FULLNAME]);
            }

            // Ensure default settings row
            $stmt = $pdo->query("SELECT id FROM settings LIMIT 1");
            if ($stmt->rowCount() === 0) {
                $ins = $pdo->prepare("INSERT INTO settings (
                    model, tone, target_word_count, word_count_divisor, word_count_mode,
                    target_language, cta_link
                ) VALUES (
                    'gemini-2.5-flash', 'Professional', 2500, 10, 'total',
                    'English', 'https://wa.me/+6282132838229?text=Hello+Panorama+Lens+Trip%21'
                )");
                $ins->execute();
            }

            $checked = true;
        } catch (Exception $e) {
            // Non-fatal
        }
    }
}
