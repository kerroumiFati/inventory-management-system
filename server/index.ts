import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { ZodError, type ZodType } from 'zod';
import {
  LoginRequestSchema,
  ChangePasswordRequestSchema,
  CreateUserRequestSchema,
  UpdateUserRequestSchema,
  SyncPushRequestSchema,
  SYNC_TABLES,
  type SyncTable,
  type SyncPullResponse,
  type SyncPushResponse,
  type UserInfo,
} from '../shared/schemas';

interface AuthTokenPayload {
  id: number;
  username: string;
  role: string;
}

interface UserRow {
  id: number;
  username: string;
  password: string;
  role: string;
  created_at: string;
}

interface RecordRow {
  tbl: SyncTable;
  uid: string;
  data: string;
  updatedAt: string;
  deleted: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthTokenPayload;
    }
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));

try {
  process.loadEnvFile(join(__dirname, '.env'));
} catch {
  // Pas de fichier .env — on continue avec les valeurs par défaut / générées ci-dessous.
}

const db = new Database(process.env.DB_PATH || join(__dirname, 'stock.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Date de modification attribuée aux données antérieures à la synchro par uid :
// n'importe quelle modification ultérieure d'un poste l'emporte sur elles.
const LEGACY_DATE = '1970-01-01T00:00:00.000Z';

db.exec(`
  -- Données métier : une ligne par enregistrement synchronisé, identifié par (table, uid).
  -- rev : valeur du compteur global lors de la dernière écriture (permet le pull incrémental).
  CREATE TABLE IF NOT EXISTS records (
    tbl       TEXT    NOT NULL,
    uid       TEXT    NOT NULL,
    data      TEXT    NOT NULL,
    updatedAt TEXT    NOT NULL,
    deleted   INTEGER NOT NULL DEFAULT 0,
    rev       INTEGER NOT NULL,
    origin    TEXT    NOT NULL DEFAULT '',
    PRIMARY KEY (tbl, uid)
  );
  CREATE INDEX IF NOT EXISTS records_rev ON records(rev);

  CREATE TABLE IF NOT EXISTS sync_meta (
    id       INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL DEFAULT 0
  );
  INSERT OR IGNORE INTO sync_meta (id, revision) VALUES (1, 0);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY,
    username   TEXT NOT NULL UNIQUE,
    password   TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'user',
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

function nextRevision(): number {
  db.prepare('UPDATE sync_meta SET revision = revision + 1 WHERE id = 1').run();
  return currentRevision();
}

function currentRevision(): number {
  return (db.prepare('SELECT revision FROM sync_meta WHERE id = 1').get() as { revision: number }).revision;
}

// ── Migration des anciennes tables (synchro par remplacement complet) ──
// Les uid « legacy-<table>-<id> » sont aussi ceux qu'attribue la migration côté poste,
// ce qui permet aux postes déjà synchronisés de retrouver leurs lignes.
function migrateLegacyTables() {
  const hasTable = (name: string) =>
    !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  if (!hasTable('products')) return;

  const migrate = db.transaction(() => {
    const ins = db.prepare(
      'INSERT OR IGNORE INTO records (tbl, uid, data, updatedAt, deleted, rev) VALUES (?, ?, ?, ?, 0, ?)'
    );
    const put = (tbl: SyncTable, id: number, data: Record<string, unknown>) =>
      ins.run(tbl, `legacy-${tbl}-${id}`, JSON.stringify(data), LEGACY_DATE, nextRevision());

    type Row = Record<string, unknown> & { id: number };
    const products  = db.prepare('SELECT * FROM products').all() as Row[];
    const bons      = db.prepare('SELECT * FROM bons').all() as Row[];
    const movements = db.prepare('SELECT * FROM movements').all() as Row[];
    const items     = db.prepare('SELECT * FROM bon_items').all() as Row[];
    const bonIdByNumber = new Map(bons.map(b => [String(b.number), b.id]));

    // updatedAt local à l'ancien serveur : remplacé par LEGACY_DATE.
    for (const { id, ...p } of products) { delete p.updatedAt; put('products', id, p); }
    for (const { id, ...b } of bons) put('bons', id, { ...b, isFormal: !!b.isFormal });
    for (const { id, productId, ...m } of movements) {
      const bonId = m.bonNumber ? bonIdByNumber.get(String(m.bonNumber)) : undefined;
      put('movements', id, {
        ...m,
        productUid: `legacy-products-${productId}`,
        bonUid: bonId != null ? `legacy-bons-${bonId}` : null,
      });
    }
    for (const { id, bonId, productId, ...i } of items) {
      put('bonItems', id, { ...i, bonUid: `legacy-bons-${bonId}`, productUid: `legacy-products-${productId}` });
    }

    // Conservées sous un autre nom, à titre de sauvegarde.
    for (const t of ['products', 'movements', 'bons', 'bon_items']) {
      db.exec(`ALTER TABLE ${t} RENAME TO legacy_${t}`);
    }
    return products.length + bons.length + movements.length + items.length;
  });

  const count = migrate();
  console.log(`  ✓ Migration vers la synchro par uid : ${count} ligne(s) reprise(s)`);
}
migrateLegacyTables();

// ── Secret JWT ──────────────────────────────────────────────
// Sans JWT_SECRET, un secret est généré une fois puis conservé en base :
// les sessions survivent ainsi aux redémarrages du serveur.
function resolveJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const row = db.prepare("SELECT value FROM settings WHERE key = 'jwt_secret'").get() as { value: string } | undefined;
  if (row) return row.value;
  const secret = randomBytes(32).toString('hex');
  db.prepare("INSERT INTO settings (key, value) VALUES ('jwt_secret', ?)").run(secret);
  console.warn('  ! JWT_SECRET absent de l\'environnement : un secret a été généré et enregistré dans la base.');
  return secret;
}
const JWT_SECRET = resolveJwtSecret();

// Créer le compte admin par défaut si aucun utilisateur n'existe
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
if (userCount.count === 0) {
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  let adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    adminPassword = randomBytes(9).toString('base64url');
    console.warn(`  ! ADMIN_PASSWORD absent de l'environnement : mot de passe généré pour "${adminUsername}" → ${adminPassword}`);
    console.warn('  ! Notez-le maintenant, il ne sera plus jamais affiché. Définissez ADMIN_PASSWORD dans server/.env pour un mot de passe stable.');
  }
  const hash = bcrypt.hashSync(adminPassword, 10);
  db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, 'admin')").run(adminUsername, hash);
  console.log(`  ✓ Compte admin créé → ${adminUsername}`);
}

const app = express();

// CORS_ORIGIN (liste séparée par des virgules) restreint les origines autorisées.
// Sans valeur, toutes les origines sont acceptées : l'API n'utilise pas de cookies
// (jeton Bearer), une page tierce ne peut donc pas agir à la place d'un utilisateur.
const corsOrigins = process.env.CORS_ORIGIN?.split(',').map(s => s.trim()).filter(Boolean);
app.use(cors(corsOrigins?.length ? { origin: corsOrigins } : undefined));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(express.json({ limit: process.env.BODY_LIMIT || '50mb' }));

// ── Middlewares ─────────────────────────────────────────────
// Le rôle est relu en base à chaque requête : un compte supprimé ou rétrogradé
// perd ses droits immédiatement, sans attendre l'expiration du jeton.
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }
  let payload: AuthTokenPayload;
  try {
    payload = jwt.verify(auth.slice(7), JWT_SECRET) as unknown as AuthTokenPayload;
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
  const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(payload.id) as AuthTokenPayload | undefined;
  if (!user) return res.status(401).json({ error: 'Compte supprimé' });
  req.user = user;
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs' });
  next();
}

// Valide le corps de la requête ; en cas d'erreur, répond 400 et renvoie null.
function parseBody<T>(schema: ZodType<T>, req: Request, res: Response): T | null {
  try {
    return schema.parse(req.body);
  } catch (err) {
    res.status(400).json({ error: err instanceof ZodError ? err.issues.map(i => i.message).join(', ') : 'Requête invalide' });
    return null;
  }
}

// ── Limitation des tentatives de connexion ──────────────────
// Après LOGIN_MAX_FAILURES échecs pour un même couple (IP, identifiant),
// les tentatives sont refusées jusqu'à la fin de la fenêtre.
const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MS    = 15 * 60 * 1000;
const loginFailures = new Map<string, { count: number; since: number }>();

function loginKey(req: Request, username: string) {
  return `${req.ip}|${username.toLowerCase()}`;
}

function loginBlockedFor(key: string): number {
  const entry = loginFailures.get(key);
  if (!entry) return 0;
  const elapsed = Date.now() - entry.since;
  if (elapsed > LOGIN_WINDOW_MS) { loginFailures.delete(key); return 0; }
  return entry.count >= LOGIN_MAX_FAILURES ? LOGIN_WINDOW_MS - elapsed : 0;
}

function recordLoginFailure(key: string) {
  const entry = loginFailures.get(key);
  if (!entry || Date.now() - entry.since > LOGIN_WINDOW_MS) loginFailures.set(key, { count: 1, since: Date.now() });
  else entry.count++;
}

// ── Statut (public) ─────────────────────────────────────────
app.get('/api/status', (_req, res) => res.json({ ok: true }));

// ── Auth : login ─────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const body = parseBody(LoginRequestSchema, req, res);
  if (!body) return;
  const { username, password } = body;

  const key = loginKey(req, username);
  const wait = loginBlockedFor(key);
  if (wait > 0) {
    return res.status(429).json({
      error: `Trop de tentatives échouées. Réessayez dans ${Math.ceil(wait / 60000)} minute(s).`,
    });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
  if (!user || !bcrypt.compareSync(password, user.password)) {
    recordLoginFailure(key);
    return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
  }
  loginFailures.delete(key);

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({ token, username: user.username, role: user.role });
});

// ── Auth : changer mot de passe ──────────────────────────────
app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const body = parseBody(ChangePasswordRequestSchema, req, res);
  if (!body) return;
  const { currentPassword, newPassword } = body;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as UserRow;
  if (!bcrypt.compareSync(currentPassword, user.password)) {
    return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.user!.id);
  res.json({ ok: true });
});

// ── Utilisateurs (administrateurs) ──────────────────────────
function adminCount(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number }).n;
}

app.get('/api/users', requireAuth, requireAdmin, (_req, res) => {
  const users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY username').all() as UserInfo[];
  res.json(users);
});

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const body = parseBody(CreateUserRequestSchema, req, res);
  if (!body) return;
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(body.username)) {
    return res.status(409).json({ error: 'Cet identifiant existe déjà' });
  }
  const info = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)')
    .run(body.username, bcrypt.hashSync(body.password, 10), body.role);
  res.status(201).json(db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(info.lastInsertRowid));
});

app.patch('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  const body = parseBody(UpdateUserRequestSchema, req, res);
  if (!body) return;
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (body.role && body.role !== 'admin' && user.role === 'admin' && adminCount() <= 1) {
    return res.status(400).json({ error: 'Il doit rester au moins un administrateur' });
  }
  if (body.role) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(body.role, id);
  if (body.password) db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(body.password, 10), id);
  res.json(db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(id));
});

app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (user.role === 'admin' && adminCount() <= 1) {
    return res.status(400).json({ error: 'Il doit rester au moins un administrateur' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ── SYNC : le poste envoie ses modifications ────────────────
// Fusion ligne par ligne : la modification la plus récente (updatedAt) l'emporte.
// Les lignes que le poste n'a pas modifiées ne sont pas envoyées et restent intactes.
app.post('/api/sync/push', requireAuth, (req, res) => {
  const body = parseBody(SyncPushRequestSchema, req, res);
  if (!body) return;

  const getRow = db.prepare('SELECT updatedAt, deleted FROM records WHERE tbl = ? AND uid = ?');
  const upsert = db.prepare(`
    INSERT INTO records (tbl, uid, data, updatedAt, deleted, rev, origin) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (tbl, uid) DO UPDATE SET
      data = excluded.data, updatedAt = excluded.updatedAt, deleted = excluded.deleted,
      rev = excluded.rev, origin = excluded.origin`);

  let applied = 0;
  let stale = 0;

  const run = db.transaction(() => {
    for (const tbl of SYNC_TABLES) {
      for (const { uid, updatedAt, ...data } of body[tbl]) {
        const existing = getRow.get(tbl, uid) as Pick<RecordRow, 'updatedAt' | 'deleted'> | undefined;
        if (existing && existing.updatedAt > updatedAt) { stale++; continue; }
        // Traçabilité : une nouvelle saisie sans auteur (ancien poste) est attribuée au compte qui l'envoie.
        const row = data as { createdBy?: string };
        if (!existing && (tbl === 'movements' || tbl === 'bons') && !row.createdBy) row.createdBy = req.user!.username;
        upsert.run(tbl, uid, JSON.stringify(data), updatedAt, 0, nextRevision(), body.clientId);
        applied++;
      }
    }
    for (const { tbl, uid, deletedAt } of body.deletions) {
      const existing = getRow.get(tbl, uid) as Pick<RecordRow, 'updatedAt' | 'deleted'> | undefined;
      // Une modification postérieure à la suppression (sur un autre poste) l'emporte.
      if (existing && (existing.deleted || existing.updatedAt > deletedAt)) { stale++; continue; }
      // Les données d'une ligne supprimée sont vidées (pièces jointes notamment).
      upsert.run(tbl, uid, '{}', deletedAt, 1, nextRevision(), body.clientId);
      applied++;
    }
  });

  run();
  const response: SyncPushResponse = { ok: true, revision: currentRevision(), applied, stale };
  res.json(response);
});

// ── SYNC : le poste récupère les modifications ──────────────
// ?since=N : seulement les lignes écrites après la révision N (0 = tout).
// ?clientId=X : exclut les lignes dont la dernière version vient de ce poste (il les a déjà).
app.get('/api/sync/pull', requireAuth, (req, res) => {
  const since    = Math.max(0, Number(req.query.since) || 0);
  const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : '';
  const full     = since === 0;

  // La révision est lue dans la même transaction que les lignes, pour ne rien manquer.
  const read = db.transaction(() => {
    const rows = db.prepare(
      full
        ? 'SELECT tbl, uid, data, updatedAt, deleted FROM records WHERE deleted = 0'
        : 'SELECT tbl, uid, data, updatedAt, deleted FROM records WHERE rev > ? AND origin != ?'
    ).all(...(full ? [] : [since, clientId])) as RecordRow[];
    return { rows, revision: currentRevision() };
  });
  const { rows, revision } = read();

  const response: SyncPullResponse = {
    revision, full, products: [], movements: [], bons: [], bonItems: [], deletions: [],
  };
  for (const r of rows) {
    if (r.deleted) { response.deletions.push({ tbl: r.tbl, uid: r.uid, deletedAt: r.updatedAt }); continue; }
    const list = response[r.tbl] as Record<string, unknown>[];
    list.push({ ...JSON.parse(r.data), uid: r.uid, updatedAt: r.updatedAt });
  }
  res.json(response);
});

export { app, db };

// Ne démarre le serveur que si ce fichier est exécuté directement
// (pas lorsqu'il est importé, ex. depuis les tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`\n  ✓ Serveur SQLite démarré → http://localhost:${PORT}`);
    console.log(`  ✓ Base de données : ${db.name}\n`);
  });
}
