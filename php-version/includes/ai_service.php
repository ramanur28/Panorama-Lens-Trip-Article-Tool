<?php
/**
 * Unified AI Service for Google Gemini and OpenAI Models
 */

require_once __DIR__ . '/db.php';

class AIService {
    public static function generateContent(array $params): array {
        $settings = self::getSettings();
        $model = $params['model'] ?? $settings['model'] ?? 'gemini-2.5-flash';
        $isOpenAI = strpos($model, 'gpt-') === 0 || strpos($model, 'o1-') === 0 || strpos($model, 'o3-') === 0;

        if ($isOpenAI) {
            return self::callOpenAI($model, $params, $settings);
        } else {
            return self::callGemini($model, $params, $settings);
        }
    }

    public static function getSettings(): array {
        try {
            $pdo = Database::getConnection();
            $stmt = $pdo->query("SELECT * FROM settings ORDER BY id DESC LIMIT 1");
            $res = $stmt->fetch();
            if ($res) return $res;
        } catch (Exception $e) {}

        return [
            'model' => 'gemini-2.5-flash',
            'tone' => 'Professional',
            'custom_prompt' => '',
            'target_audience' => '',
            'brand' => '',
            'word_count_mode' => 'total',
            'word_count_divisor' => 10,
            'target_word_count' => 2500,
            'target_language' => 'English',
            'cta_link' => 'https://wa.me/+6282132838229?text=Hello+Panorama+Lens+Trip%21'
        ];
    }

    private static function callGemini(string $model, array $params, array $settings): array {
        $apiKey = $params['apiKey'] ?? $settings['api_key'] ?? getenv('GEMINI_API_KEY');
        if (empty($apiKey)) {
            throw new Exception('Google Gemini API Key is not configured in Settings.');
        }

        $prompt = $params['prompt'];
        $image = $params['image'] ?? null;

        $parts = [];
        if ($image && !empty($image['data'])) {
            $parts[] = [
                'inline_data' => [
                    'mime_type' => $image['mimeType'] ?? 'image/jpeg',
                    'data' => $image['data']
                ]
            ];
        }
        $parts[] = ['text' => $prompt];

        $reqBody = [
            'contents' => [
                ['parts' => $parts]
            ],
            'generationConfig' => [
                'temperature' => 0.7
            ]
        ];

        $url = "https://generativelanguage.googleapis.com/v1beta/models/{$model}:generateContent?key=" . urlencode($apiKey);

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_POSTFIELDS => json_encode($reqBody),
            CURLOPT_TIMEOUT => 180,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_SSL_VERIFYPEER => true
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr = curl_error($ch);
        if (PHP_VERSION_ID < 80000) { @curl_close($ch); }

        if ($curlErr) {
            throw new Exception("Gemini API Network Error: {$curlErr}");
        }

        $json = json_decode($response, true);
        if ($httpCode !== 200 || !empty($json['error'])) {
            $errMsg = $json['error']['message'] ?? "Gemini API returned HTTP {$httpCode}";
            throw new Exception($errMsg);
        }

        $text = '';
        if (!empty($json['candidates'][0]['content']['parts'])) {
            foreach ($json['candidates'][0]['content']['parts'] as $part) {
                if (!empty($part['text'])) {
                    $text .= $part['text'];
                }
            }
        }

        $usage = $json['usageMetadata'] ?? [];
        return [
            'text' => $text,
            'usageMetadata' => [
                'promptTokenCount' => $usage['promptTokenCount'] ?? 0,
                'candidatesTokenCount' => $usage['candidatesTokenCount'] ?? 0,
                'totalTokenCount' => $usage['totalTokenCount'] ?? 0
            ]
        ];
    }

    private static function callOpenAI(string $model, array $params, array $settings): array {
        $apiKey = $params['openaiApiKey'] ?? $settings['openai_api_key'] ?? getenv('OPENAI_API_KEY');
        if (empty($apiKey)) {
            throw new Exception('OpenAI API Key is not configured in Settings.');
        }

        $prompt = $params['prompt'];
        $image = $params['image'] ?? null;

        $content = [];
        if ($image && !empty($image['data'])) {
            $mime = $image['mimeType'] ?? 'image/jpeg';
            $content[] = ['type' => 'text', 'text' => $prompt];
            $content[] = [
                'type' => 'image_url',
                'image_url' => [
                    'url' => "data:{$mime};base64,{$image['data']}"
                ]
            ];
        } else {
            $content = $prompt;
        }

        $reqBody = [
            'model' => $model,
            'messages' => [
                ['role' => 'user', 'content' => $content]
            ]
        ];

        $isReasoning = strpos($model, 'o1') === 0 || strpos($model, 'o3') === 0 || strpos($model, 'gpt-5') === 0;
        if (!$isReasoning) {
            $reqBody['temperature'] = 0.7;
        }

        $ch = curl_init('https://api.openai.com/v1/chat/completions');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $apiKey
            ],
            CURLOPT_POSTFIELDS => json_encode($reqBody),
            CURLOPT_TIMEOUT => 180,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_SSL_VERIFYPEER => true
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr = curl_error($ch);
        if (PHP_VERSION_ID < 80000) { @curl_close($ch); }

        if ($curlErr) {
            throw new Exception("OpenAI API Network Error: {$curlErr}");
        }

        $json = json_decode($response, true);
        if ($httpCode !== 200 || !empty($json['error'])) {
            $errMsg = $json['error']['message'] ?? "OpenAI API returned HTTP {$httpCode}";
            throw new Exception($errMsg);
        }

        $text = $json['choices'][0]['message']['content'] ?? '';
        $usage = $json['usage'] ?? [];

        return [
            'text' => $text,
            'usageMetadata' => [
                'promptTokenCount' => $usage['prompt_tokens'] ?? 0,
                'candidatesTokenCount' => $usage['completion_tokens'] ?? 0,
                'totalTokenCount' => $usage['total_tokens'] ?? 0
            ]
        ];
    }
}
