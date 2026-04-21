const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.OMNISYNC_DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'cloud-db.json');

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cors());

function hashPassword(password) {
    return crypto.createHash('sha256').update(String(password)).digest('hex');
}

function ensureDb() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_PATH)) {
        const initialDb = {
            users: [
                {
                    id: 'user-admin',
                    email: 'admin@fowlerprecision',
                    passwordHash: hashPassword('password'),
                    role: 'admin',
                    displayName: 'Admin',
                    orgId: 'fowler-demo'
                },
                {
                    id: 'user-op1',
                    email: 'op1@fowlerprecision',
                    passwordHash: hashPassword('password'),
                    role: 'operator',
                    displayName: 'Operator 1',
                    orgId: 'fowler-demo'
                }
            ],
            sessions: {},
            storage: {
                'fowler-demo': {}
            },
            measurementsDb: []
        };
        fs.writeFileSync(DB_PATH, JSON.stringify(initialDb, null, 2), 'utf8');
    }
}

function readDb() {
    ensureDb();
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDb(db) {
    ensureDb();
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

function createToken() {
    return crypto.randomBytes(24).toString('hex');
}

function sanitizeUser(user) {
    if (!user) return null;
    const { passwordHash, ...safeUser } = user;
    return safeUser;
}

function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) {
        return res.status(401).json({ error: 'Missing bearer token' });
    }

    const db = readDb();
    const session = db.sessions[token];
    if (!session) {
        return res.status(401).json({ error: 'Invalid session' });
    }

    const user = db.users.find(candidate => candidate.id === session.userId);
    if (!user) {
        return res.status(401).json({ error: 'User not found' });
    }

    req.db = db;
    req.sessionToken = token;
    req.user = user;
    next();
}

app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'OmniSync Cloud API', timestamp: new Date().toISOString() });
});

app.post('/api/auth/login', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const db = readDb();
    const user = db.users.find(candidate => candidate.email.toLowerCase() === email);

    if (!user || user.passwordHash !== hashPassword(password)) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = createToken();
    db.sessions[token] = {
        userId: user.id,
        createdAt: new Date().toISOString()
    };
    if (!db.storage[user.orgId]) {
        db.storage[user.orgId] = {};
    }
    writeDb(db);

    res.json({
        token,
        user: sanitizeUser(user)
    });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
    res.json({ user: sanitizeUser(req.user) });
});

app.post('/api/auth/logout', authMiddleware, (req, res) => {
    delete req.db.sessions[req.sessionToken];
    writeDb(req.db);
    res.json({ ok: true });
});

app.get('/api/storage/snapshot', authMiddleware, (req, res) => {
    const orgStorage = req.db.storage[req.user.orgId] || {};
    res.json({
        orgId: req.user.orgId,
        kv: orgStorage
    });
});

app.post('/api/storage/sync', authMiddleware, (req, res) => {
    const ops = Array.isArray(req.body.ops) ? req.body.ops : [];
    const orgStorage = req.db.storage[req.user.orgId] || {};

    for (const op of ops) {
        if (!op || typeof op !== 'object') continue;
        if (op.type === 'clear') {
            Object.keys(orgStorage).forEach(key => delete orgStorage[key]);
            continue;
        }
        const key = String(op.key || '');
        if (!key.startsWith('omnisync_')) continue;
        if (op.type === 'set') {
            orgStorage[key] = String(op.value ?? '');
        } else if (op.type === 'remove') {
            delete orgStorage[key];
        }
    }

    req.db.storage[req.user.orgId] = orgStorage;
    writeDb(req.db);
    res.json({ ok: true, keys: Object.keys(orgStorage).length });
});

app.post('/api/measurements', (req, res) => {
    const db = readDb();
    const { toolId, operatorId, value } = req.body;

    const TARGET_NOMINAL = 12.0;
    const UPPER_TOL = 0.05;
    const LOWER_TOL = 0.05;
    const numericValue = Number(value);

    let status = 'FAIL';
    if (Number.isFinite(numericValue) && numericValue >= (TARGET_NOMINAL - LOWER_TOL) && numericValue <= (TARGET_NOMINAL + UPPER_TOL)) {
        status = 'PASS';
    }

    const newRecord = {
        id: Date.now(),
        toolId: toolId || 'Unknown Tool',
        operatorId: operatorId || 'Unknown Operator',
        value: numericValue,
        status,
        timestamp: new Date().toISOString()
    };

    db.measurementsDb.push(newRecord);
    writeDb(db);
    res.status(200).json(newRecord);
});

app.get('/api/measurements/latest', (_req, res) => {
    const db = readDb();
    const latest = db.measurementsDb[db.measurementsDb.length - 1] || null;
    res.json(latest);
});

app.use(express.static(__dirname));

app.get(/^(?!\/api\/).*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    ensureDb();
    console.log(`OmniSync Cloud API running on http://localhost:${PORT}`);
});
