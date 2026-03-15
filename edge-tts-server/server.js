#!/usr/bin/env node
/**
 * Edge TTS local server
 * Wraps edge-tts-universal (Node.js) as a simple HTTP service
 * so Tauri's WebView can use it without browser WebSocket restrictions.
 *
 * Usage:  node server.js [port]
 *   PORT env or first arg overrides the default port (3099).
 *
 * Endpoints:
 *   GET  /health              → { ok: true, voices: [...] }
 *   POST /synthesize          → audio/mpeg (MP3 bytes)
 *     body: { text, voice?, rate?, pitch?, volume? }
 */

import http from 'http';
import { EdgeTTS } from 'edge-tts-universal';

const PORT = parseInt(process.argv[2] || process.env.PORT || '3099', 10);

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

async function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => (data += chunk));
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);

    // ── GET /health ──────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    // ── POST /synthesize ─────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/synthesize') {
        let params;
        try {
            const body = await readBody(req);
            params = JSON.parse(body);
        } catch {
            res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'text/plain' });
            res.end('Invalid JSON body');
            return;
        }

        const {
            text,
            voice = 'vi-VN-HoaiMyNeural',
            rate = '+0%',
            pitch = '+0Hz',
            volume = '+0%',
        } = params;

        if (!text?.trim()) {
            res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'text/plain' });
            res.end('Missing "text" field');
            return;
        }

        try {
            const tts = new EdgeTTS(text.trim(), voice, { rate, pitch, volume });
            const result = await tts.synthesize();
            const audioBuffer = Buffer.from(await result.audio.arrayBuffer());

            res.writeHead(200, {
                ...CORS_HEADERS,
                'Content-Type': 'audio/mpeg',
                'Content-Length': audioBuffer.length,
            });
            res.end(audioBuffer);
            console.log(`[synth] ${voice} "${text.slice(0, 40)}" → ${audioBuffer.length} bytes`);
        } catch (err) {
            console.error('[synth error]', err.message);
            res.writeHead(500, { ...CORS_HEADERS, 'Content-Type': 'text/plain' });
            res.end(err.message);
        }
        return;
    }

    res.writeHead(404, CORS_HEADERS);
    res.end('Not Found');
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`Edge TTS server listening on http://127.0.0.1:${PORT}`);
    console.log('  POST /synthesize  { text, voice?, rate?, pitch? }');
    console.log('  GET  /health');
});

server.on('error', err => {
    console.error('Server error:', err.message);
    process.exit(1);
});
