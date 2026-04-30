const express = require('express');
const cors = require('cors');
const path = require('path');
const { execFile } = require('child_process');

const app = express();
const PORT = Number(process.env.OMNISYNC_AGENT_PORT || 8467);
const HOST = process.env.OMNISYNC_AGENT_HOST || '127.0.0.1';
const DEFAULT_BLUEGIGA_PORT = process.env.OMNISYNC_BLUEGIGA_PORT || 'AUTO';
const DEFAULT_SCAN_MS = Number(process.env.OMNISYNC_BLUEGIGA_SCAN_MS || 2500);
const SCAN_SCRIPT = path.join(__dirname, 'scripts', 'scan-bluegiga.ps1');

app.use(cors());
app.use(express.json({ limit: '2mb' }));

let lastScanSummary = {
    ok: false,
    port: DEFAULT_BLUEGIGA_PORT,
    scannedAt: null,
    deviceCount: 0
};

function runBluegigaScan({ port = DEFAULT_BLUEGIGA_PORT, durationMs = DEFAULT_SCAN_MS } = {}) {
    return new Promise((resolve, reject) => {
        const args = [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', SCAN_SCRIPT,
            '-Port', String(port),
            '-DurationMs', String(durationMs)
        ];

        execFile('powershell.exe', args, {
            cwd: __dirname,
            timeout: Math.max(10000, durationMs + 8000),
            maxBuffer: 1024 * 1024
        }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(stderr?.trim() || error.message || 'Bluegiga scan failed'));
                return;
            }
            try {
                const payload = JSON.parse(stdout);
                resolve(payload);
            } catch (parseError) {
                reject(new Error(`Bluegiga scan returned invalid JSON: ${parseError.message}`));
            }
        });
    });
}

app.get('/health', (_req, res) => {
    res.json({
        ok: true,
        mode: 'bluegiga-local-bridge',
        host: HOST,
        port: PORT,
        defaultBluegigaPort: DEFAULT_BLUEGIGA_PORT,
        lastScanSummary
    });
});

app.get('/api/bluegiga/scan', async (req, res) => {
    const port = String(req.query.port || DEFAULT_BLUEGIGA_PORT);
    const durationMs = Number(req.query.durationMs || DEFAULT_SCAN_MS);

    try {
        const result = await runBluegigaScan({ port, durationMs });
        lastScanSummary = {
            ok: !!result.ok,
            port: result.port || port,
            scannedAt: result.scannedAt || new Date().toISOString(),
            deviceCount: Array.isArray(result.devices) ? result.devices.length : 0
        };
        res.json(result);
    } catch (error) {
        lastScanSummary = {
            ok: false,
            port,
            scannedAt: new Date().toISOString(),
            deviceCount: 0,
            error: error.message
        };
        res.status(500).json({
            ok: false,
            port,
            scannedAt: new Date().toISOString(),
            devices: [],
            error: error.message
        });
    }
});

app.listen(PORT, HOST, () => {
    console.log(`[OmniSync Local Agent] Bluegiga bridge listening on http://${HOST}:${PORT}`);
    console.log(`[OmniSync Local Agent] Default dongle port: ${DEFAULT_BLUEGIGA_PORT}`);
});
