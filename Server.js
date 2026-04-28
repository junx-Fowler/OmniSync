const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;
const LEGACY_DATA_DIR = path.join(__dirname, 'data');
const DEFAULT_PERSISTENT_DATA_DIR = path.join(os.homedir(), '.omnisync', 'data');
const DATA_DIR = process.env.OMNISYNC_DATA_DIR || DEFAULT_PERSISTENT_DATA_DIR;
const DB_PATH = path.join(DATA_DIR, 'cloud-db.json');
const LEGACY_DB_PATH = path.join(LEGACY_DATA_DIR, 'cloud-db.json');
const DB_SCHEMA_VERSION = 2;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cors());

function hashPassword(password) {
    return crypto.createHash('sha256').update(String(password)).digest('hex');
}

function normalizeRole(role) {
    const normalized = String(role || '').trim().toLowerCase();
    if (normalized === 'operator') return 'operator';
    if (normalized === 'planner') return 'planner';
    if (normalized === 'supervisor') return 'supervisor';
    return 'admin';
}

const PERMISSIONS_BY_ROLE = {
    operator: ['EXECUTE_RUN', 'PLAN_VIEW'],
    planner: ['PLAN_VIEW', 'PLAN_EDIT', 'PLAN_RELEASE', 'SCAN_REVIEW'],
    supervisor: ['PLAN_VIEW', 'PLAN_EDIT', 'PLAN_RELEASE', 'EXECUTE_RUN', 'SUPERVISOR_VIEW', 'QUALITY_VIEW', 'SETTINGS_VIEW', 'USER_MANAGE', 'SCAN_REVIEW'],
    admin: ['PLAN_VIEW', 'PLAN_EDIT', 'PLAN_RELEASE', 'EXECUTE_RUN', 'SUPERVISOR_VIEW', 'QUALITY_VIEW', 'SETTINGS_VIEW', 'USER_MANAGE', 'SCAN_REVIEW']
};

function getPermissionsForRole(role) {
    const normalized = normalizeRole(role);
    return [...(PERMISSIONS_BY_ROLE[normalized] || [])];
}

function getDefaultUsers() {
    return [
        {
            id: 'user-planner',
            email: 'planner@fowlerprecision.com',
            passwordHash: hashPassword('password'),
            role: 'planner',
            displayName: 'Planner',
            orgId: 'fowler-demo'
        },
        {
            id: 'user-op1',
            email: 'op1@fowlerprecision.com',
            passwordHash: hashPassword('password'),
            role: 'operator',
            displayName: 'Operator 1',
            orgId: 'fowler-demo'
        },
        {
            id: 'user-op2',
            email: 'op2@fowlerprecision.com',
            passwordHash: hashPassword('password'),
            role: 'operator',
            displayName: 'Operator 2',
            orgId: 'fowler-demo'
        },
        {
            id: 'user-op3',
            email: 'op3@fowlerprecision.com',
            passwordHash: hashPassword('password'),
            role: 'operator',
            displayName: 'Operator 3',
            orgId: 'fowler-demo'
        },
        {
            id: 'user-supervisor',
            email: 'supervisor@fowlerprecision.com',
            passwordHash: hashPassword('password'),
            role: 'supervisor',
            displayName: 'Supervisor',
            orgId: 'fowler-demo'
        },
        {
            id: 'user-admin',
            email: 'admin@fowlerprecision.com',
            passwordHash: hashPassword('password'),
            role: 'admin',
            displayName: 'Admin',
            orgId: 'fowler-demo'
        }
    ];
}

function ensureDefaultUsers(db) {
    const defaults = getDefaultUsers();
    const byEmail = new Map((db.users || []).map(user => [String(user.email || '').toLowerCase(), user]));
    let changed = false;
    defaults.forEach(defaultUser => {
        const key = defaultUser.email.toLowerCase();
        if (!byEmail.has(key)) {
            db.users.push({ ...defaultUser });
            changed = true;
            return;
        }
        const existing = byEmail.get(key);
        const normalizedRole = normalizeRole(existing.role);
        if (existing.role !== normalizedRole) {
            existing.role = normalizedRole;
            changed = true;
        }
        if (!existing.orgId) {
            existing.orgId = defaultUser.orgId;
            changed = true;
        }
    });
    return changed;
}

function ensureDb() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_PATH) && fs.existsSync(LEGACY_DB_PATH)) {
        fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
    }
    if (!fs.existsSync(DB_PATH)) {
        const initialDb = {
            schemaVersion: DB_SCHEMA_VERSION,
            users: getDefaultUsers(),
            sessions: {},
            storage: {
                'fowler-demo': {}
            },
            storageMeta: {
                'fowler-demo': {
                    updatedAt: Date.now()
                }
            },
            orgSettings: {
                'fowler-demo': {
                    scanPolicy: {
                        lowConfidenceThreshold: 0.62,
                        autoApproveThreshold: 0.85,
                        requireReview: true
                    }
                }
            },
            auditEvents: [],
            measurementsDb: []
        };
        fs.writeFileSync(DB_PATH, JSON.stringify(initialDb, null, 2), 'utf8');
        return;
    }
    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    let changed = false;
    db.users = Array.isArray(db.users) ? db.users : [];
    changed = ensureDefaultUsers(db) || changed;
    if (!Number.isFinite(db.schemaVersion) || db.schemaVersion < DB_SCHEMA_VERSION) {
        db.schemaVersion = DB_SCHEMA_VERSION;
        changed = true;
    }
    if (!db.orgSettings || typeof db.orgSettings !== 'object') {
        db.orgSettings = {};
        changed = true;
    }
    if (!db.storageMeta || typeof db.storageMeta !== 'object') {
        db.storageMeta = {};
        changed = true;
    }
    if (!db.storageMeta['fowler-demo']) {
        db.storageMeta['fowler-demo'] = { updatedAt: Date.now() };
        changed = true;
    }
    if (!db.orgSettings['fowler-demo']) {
        db.orgSettings['fowler-demo'] = {};
        changed = true;
    }
    if (!db.orgSettings['fowler-demo'].scanPolicy) {
        db.orgSettings['fowler-demo'].scanPolicy = {
            lowConfidenceThreshold: 0.62,
            autoApproveThreshold: 0.85,
            requireReview: true
        };
        changed = true;
    }
    if (!Array.isArray(db.auditEvents)) {
        db.auditEvents = [];
        changed = true;
    }
    if (changed) {
        fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
    }
}

function readDb() {
    ensureDb();
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDb(db) {
    ensureDb();
    const backupPath = `${DB_PATH}.bak`;
    if (fs.existsSync(DB_PATH)) {
        fs.copyFileSync(DB_PATH, backupPath);
    }
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

function touchOrgStorageMeta(db, orgId) {
    const org = String(orgId || '');
    if (!org) return;
    db.storageMeta = db.storageMeta || {};
    db.storageMeta[org] = db.storageMeta[org] || {};
    db.storageMeta[org].updatedAt = Date.now();
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

function requireRole(allowedRoles) {
    const allowed = new Set((allowedRoles || []).map(normalizeRole));
    return (req, res, next) => {
        const role = normalizeRole(req.user?.role);
        if (!allowed.has(role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
}

function requirePermission(permission) {
    return (req, res, next) => {
        const permissions = new Set(getPermissionsForRole(req.user?.role));
        if (!permissions.has(permission)) {
            return res.status(403).json({ error: `Missing permission: ${permission}` });
        }
        next();
    };
}

function logAuditEvent(db, event) {
    if (!db || !Array.isArray(db.auditEvents)) return;
    db.auditEvents.push({
        id: `audit-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        timestamp: new Date().toISOString(),
        ...event
    });
    if (db.auditEvents.length > 20000) {
        db.auditEvents = db.auditEvents.slice(-20000);
    }
}

app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'OmniSync Cloud API', schemaVersion: DB_SCHEMA_VERSION, timestamp: new Date().toISOString() });
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
    logAuditEvent(db, {
        orgId: user.orgId,
        actorId: user.id,
        action: 'AUTH_LOGIN',
        entityType: 'session',
        entityId: token
    });
    writeDb(db);

    res.json({
        token,
        user: sanitizeUser({ ...user, role: normalizeRole(user.role) })
    });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
    res.json({ user: sanitizeUser({ ...req.user, role: normalizeRole(req.user.role) }) });
});

app.get('/api/permissions/me', authMiddleware, (req, res) => {
    res.json({
        role: normalizeRole(req.user.role),
        permissions: getPermissionsForRole(req.user.role)
    });
});

app.post('/api/auth/logout', authMiddleware, (req, res) => {
    logAuditEvent(req.db, {
        orgId: req.user.orgId,
        actorId: req.user.id,
        action: 'AUTH_LOGOUT',
        entityType: 'session',
        entityId: req.sessionToken
    });
    delete req.db.sessions[req.sessionToken];
    writeDb(req.db);
    res.json({ ok: true });
});

app.get('/api/users', authMiddleware, requireRole(['supervisor', 'admin']), (req, res) => {
    const users = (req.db.users || [])
        .filter(user => user.orgId === req.user.orgId)
        .map(user => sanitizeUser({ ...user, role: normalizeRole(user.role) }))
        .sort((a, b) => (a.displayName || a.email || '').localeCompare(b.displayName || b.email || ''));
    res.json({ users });
});

app.post('/api/users', authMiddleware, requireRole(['supervisor', 'admin']), (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const displayName = String(req.body.displayName || '').trim();
    const role = normalizeRole(req.body.role);
    if (!email || !email.includes('@') || !email.includes('.')) {
        return res.status(400).json({ error: 'Valid email is required' });
    }
    if (!password || password.length < 4) {
        return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }
    if (!['operator', 'planner', 'supervisor'].includes(role)) {
        return res.status(400).json({ error: 'Role must be operator, planner, or supervisor' });
    }
    const exists = (req.db.users || []).some(user => String(user.email || '').toLowerCase() === email);
    if (exists) {
        return res.status(409).json({ error: 'User already exists' });
    }
    const user = {
        id: `user-${Date.now()}`,
        email,
        passwordHash: hashPassword(password),
        role,
        displayName: displayName || email.split('@')[0],
        orgId: req.user.orgId
    };
    req.db.users.push(user);
    logAuditEvent(req.db, {
        orgId: req.user.orgId,
        actorId: req.user.id,
        action: 'USER_CREATE',
        entityType: 'user',
        entityId: user.id,
        after: { email: user.email, role: user.role, displayName: user.displayName }
    });
    writeDb(req.db);
    res.status(201).json({ user: sanitizeUser(user) });
});

app.delete('/api/users/:id', authMiddleware, requireRole(['supervisor', 'admin']), (req, res) => {
    const userId = String(req.params.id || '').trim();
    if (!userId) {
        return res.status(400).json({ error: 'User id is required' });
    }
    const index = (req.db.users || []).findIndex(user => user.id === userId && user.orgId === req.user.orgId);
    if (index === -1) {
        return res.status(404).json({ error: 'User not found' });
    }
    const target = req.db.users[index];
    if (target.id === req.user.id) {
        return res.status(400).json({ error: 'You cannot delete your own user' });
    }
    req.db.users.splice(index, 1);
    Object.keys(req.db.sessions || {}).forEach(token => {
        if (req.db.sessions[token]?.userId === target.id) delete req.db.sessions[token];
    });
    logAuditEvent(req.db, {
        orgId: req.user.orgId,
        actorId: req.user.id,
        action: 'USER_DELETE',
        entityType: 'user',
        entityId: target.id,
        before: { email: target.email, role: target.role, displayName: target.displayName }
    });
    writeDb(req.db);
    res.json({ ok: true });
});

app.get('/api/audit', authMiddleware, requirePermission('SUPERVISOR_VIEW'), (req, res) => {
    const entityType = String(req.query.entityType || '').trim();
    const entityId = String(req.query.entityId || '').trim();
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)));
    const events = (req.db.auditEvents || [])
        .filter(event => event.orgId === req.user.orgId)
        .filter(event => !entityType || event.entityType === entityType)
        .filter(event => !entityId || event.entityId === entityId)
        .slice(-limit)
        .reverse();
    res.json({ events });
});

app.post('/api/audit', authMiddleware, requirePermission('PLAN_VIEW'), (req, res) => {
    const action = String(req.body.action || '').trim().toUpperCase();
    const entityType = String(req.body.entityType || '').trim();
    const entityId = String(req.body.entityId || '').trim();
    const details = req.body.details && typeof req.body.details === 'object' ? req.body.details : {};
    if (!action || !entityType || !entityId) {
        return res.status(400).json({ error: 'action, entityType, and entityId are required' });
    }
    logAuditEvent(req.db, {
        orgId: req.user.orgId,
        actorId: req.user.id,
        action,
        entityType,
        entityId,
        details
    });
    writeDb(req.db);
    res.status(201).json({ ok: true });
});

app.get('/api/scan/policy', authMiddleware, requirePermission('PLAN_VIEW'), (req, res) => {
    const org = req.user.orgId;
    const policy = req.db.orgSettings?.[org]?.scanPolicy || {
        lowConfidenceThreshold: 0.62,
        autoApproveThreshold: 0.85,
        requireReview: true
    };
    res.json({ policy });
});

app.post('/api/scan/policy', authMiddleware, requirePermission('PLAN_EDIT'), (req, res) => {
    const org = req.user.orgId;
    const current = req.db.orgSettings?.[org]?.scanPolicy || {};
    const lowConfidenceThreshold = Number(req.body.lowConfidenceThreshold);
    const autoApproveThreshold = Number(req.body.autoApproveThreshold);
    const requireReview = req.body.requireReview !== false;
    const policy = {
        lowConfidenceThreshold: Number.isFinite(lowConfidenceThreshold) ? Math.max(0.2, Math.min(0.95, lowConfidenceThreshold)) : (current.lowConfidenceThreshold ?? 0.62),
        autoApproveThreshold: Number.isFinite(autoApproveThreshold) ? Math.max(0.3, Math.min(0.99, autoApproveThreshold)) : (current.autoApproveThreshold ?? 0.85),
        requireReview
    };
    req.db.orgSettings = req.db.orgSettings || {};
    req.db.orgSettings[org] = req.db.orgSettings[org] || {};
    req.db.orgSettings[org].scanPolicy = policy;
    logAuditEvent(req.db, {
        orgId: req.user.orgId,
        actorId: req.user.id,
        action: 'SCAN_POLICY_UPDATE',
        entityType: 'scanPolicy',
        entityId: org,
        before: current,
        after: policy
    });
    writeDb(req.db);
    res.json({ policy });
});

app.get('/api/storage/snapshot', authMiddleware, requirePermission('PLAN_VIEW'), (req, res) => {
    const orgStorage = req.db.storage[req.user.orgId] || {};
    const storageMeta = req.db.storageMeta?.[req.user.orgId] || {};
    res.json({
        orgId: req.user.orgId,
        kv: orgStorage,
        updatedAt: storageMeta.updatedAt || 0
    });
});

app.post('/api/storage/sync', authMiddleware, requirePermission('PLAN_VIEW'), (req, res) => {
    const ops = Array.isArray(req.body.ops) ? req.body.ops : [];
    const orgStorage = req.db.storage[req.user.orgId] || {};
    let changed = false;

    for (const op of ops) {
        if (!op || typeof op !== 'object') continue;
        if (op.type === 'clear') {
            if (Object.keys(orgStorage).length) {
                Object.keys(orgStorage).forEach(key => delete orgStorage[key]);
                changed = true;
            }
            continue;
        }
        const key = String(op.key || '');
        if (!key.startsWith('omnisync_')) continue;
        if (op.type === 'set') {
            const nextValue = String(op.value ?? '');
            if (orgStorage[key] !== nextValue) {
                orgStorage[key] = nextValue;
                changed = true;
            }
        } else if (op.type === 'remove') {
            if (Object.prototype.hasOwnProperty.call(orgStorage, key)) {
                delete orgStorage[key];
                changed = true;
            }
        }
    }

    req.db.storage[req.user.orgId] = orgStorage;
    if (changed) touchOrgStorageMeta(req.db, req.user.orgId);
    writeDb(req.db);
    res.json({ ok: true, keys: Object.keys(orgStorage).length, updatedAt: req.db.storageMeta?.[req.user.orgId]?.updatedAt || 0 });
});

app.post('/api/measurements', authMiddleware, requirePermission('EXECUTE_RUN'), (req, res) => {
    const db = req.db;
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
    logAuditEvent(db, {
        orgId: req.user.orgId,
        actorId: req.user.id,
        action: 'MEASUREMENT_CREATE',
        entityType: 'measurement',
        entityId: String(newRecord.id)
    });
    writeDb(db);
    res.status(200).json(newRecord);
});

app.get('/api/measurements/latest', authMiddleware, requirePermission('PLAN_VIEW'), (req, res) => {
    const db = req.db;
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
