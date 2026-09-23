<?php
/**
 * Server-Sent Events (SSE) Helper for Shared Hosting
 */

class SSE {
    private static bool $initialized = false;

    public static function init(): void {
        if (self::$initialized) return;

        @set_time_limit(300);
        @ini_set('max_execution_time', '300');
        @ini_set('display_errors', '0');

        if (function_exists('apache_setenv')) {
            @apache_setenv('no-gzip', '1');
        }
        @ini_set('zlib.output_compression', '0');
        @ini_set('output_buffering', 'off');
        @ini_set('implicit_flush', '1');

        header('Content-Type: text/event-stream; charset=utf-8');
        header('Cache-Control: no-cache, no-transform');
        header('Connection: keep-alive');
        header('X-Accel-Buffering: no');

        while (ob_get_level()) {
            @ob_end_clean();
        }
        @ob_implicit_flush(true);
        @flush();

        self::$initialized = true;
    }

    public static function send(string $type, $data = []): void {
        self::init();

        while (ob_get_level()) {
            @ob_end_clean();
        }

        $payload = is_array($data) ? $data : ['message' => (string)$data];
        $payload['type'] = $type;

        echo "data: " . json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n\n";
        @flush();
    }

    public static function countWords(?string $text): int {
        if (empty($text)) return 0;
        $clean = preg_replace('/```[\s\S]*?```/', '', $text);
        $clean = preg_replace('/https?:\/\/\S+/', '', $clean);
        return preg_match_all('/\b[\p{L}\p{N}\x{27}-]+\b/u', $clean);
    }
}
