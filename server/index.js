import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

try {
  process.loadEnvFile(join(__dirname, '.env'));
} catch {
  // Pas de fichier .env — on continue avec les valeurs par défaut / générées ci-dessous.
}

const db = new Database(process.env.DB_PATH || join(__dirname, 'stock.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  JWT_SECRET = randomBytes(32).toString('hex');
  console.warn('  ! JWT_SECRET absent de l\'environnement : un secret aléatoire a été généré pour cette exécution.');
  console.warn('  ! Les sessions existantes seront invalidées à chaque redémarrage tant que JWT_SECRET n\'est pas défini dans server/.env');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id         INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    reference  TEXT    DEFAULT '',
    barcode    TEXT    DEFAULT '',
    category   TEXT    DEFAULT '',
    unit       TEXT    DEFAULT 'pièce',
    minStock   REAL    DEFAULT 0,
    stockInitial REAL  DEFAULT 0,
    description TEXT   DEFAULT '',
    updatedAt  TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS movements (
    id         INTEGER PRIMARY KEY,
    productId  INTEGER NOT NULL,
    type       TEXT    NOT NULL,
    date       TEXT    NOT NULL,
    quantity   REAL    NOT NULL,
    bonNumber  TEXT    DEFAULT '',
    note       TEXT    DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS bons (
    id          INTEGER PRIMARY KEY,
    number      TEXT NOT NULL,
    date        TEXT NOT NULL,
    type        TEXT DEFAULT 'sortie',
    note        TEXT DEFAULT '',
    destination TEXT DEFAULT '',
    isFormal    INTEGER DEFAULT 0,
    fileName    TEXT DEFAULT NULL,
    fileType    TEXT DEFAULT NULL,
    fileData    TEXT DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS bon_items (
    id        INTEGER PRIMARY KEY,
    bonId     INTEGER NOT NULL,
    productId INTEGER NOT NULL,
    quantity  REAL    NOT NULL,
    note      TEXT    DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY,
    username   TEXT NOT NULL UNIQUE,
    password   TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'user',
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Créer le compte admin par défaut si aucun utilisateur n'existe
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
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
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ── Middleware JWT ──────────────────────────────────────────
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

// ── Statut (public) ─────────────────────────────────────────
app.get('/api/status', (_, res) => res.json({ ok: true }));

// ── Auth : login ─────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Identifiants requis' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({ token, username: user.username, role: user.role });
});

// ── Auth : changer mot de passe ──────────────────────────────
app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Champs requis' });
  }
  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'Le mot de passe doit faire au moins 4 caractères' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password)) {
    return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.user.id);
  res.json({ ok: true });
});

// ── SYNC : le client envoie toutes ses données ──────────────
app.post('/api/sync/push', requireAuth, (req, res) => {
  const { products = [], movements = [], bons = [], bonItems = [] } = req.body;

  const run = db.transaction(() => {
    db.prepare('DELETE FROM bon_items').run();
    db.prepare('DELETE FROM movements').run();
    db.prepare('DELETE FROM bons').run();
    db.prepare('DELETE FROM products').run();

    const insProduct = db.prepare(`
      INSERT INTO products (id,name,reference,barcode,category,unit,minStock,stockInitial,description,updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    for (const p of products) {
      insProduct.run(p.id, p.name, p.reference||'', p.barcode||'', p.category||'',
        p.unit||'pièce', p.minStock||0, p.stockInitial||0, p.description||'', new Date().toISOString());
    }

    const insMov = db.prepare(`
      INSERT INTO movements (id,productId,type,date,quantity,bonNumber,note)
      VALUES (?,?,?,?,?,?,?)`);
    for (const m of movements) {
      insMov.run(m.id, m.productId, m.type, m.date, m.quantity, m.bonNumber||'', m.note||'');
    }

    const insBon = db.prepare(`
      INSERT INTO bons (id,number,date,type,note,destination,isFormal,fileName,fileType,fileData)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    for (const b of bons) {
      insBon.run(b.id, b.number, b.date, b.type||'sortie', b.note||'', b.destination||'',
        b.isFormal ? 1 : 0, b.fileName||null, b.fileType||null, b.fileData||null);
    }

    const insItem = db.prepare(`
      INSERT INTO bon_items (id,bonId,productId,quantity,note)
      VALUES (?,?,?,?,?)`);
    for (const i of bonItems) {
      insItem.run(i.id, i.bonId, i.productId, i.quantity, i.note||'');
    }
  });

  run();
  res.json({ ok: true, synced: { products: products.length, movements: movements.length, bons: bons.length } });
});

// ── SYNC : le client récupère toutes les données ────────────
app.get('/api/sync/pull', requireAuth, (req, res) => {
  const products  = db.prepare('SELECT * FROM products').all();
  const movements = db.prepare('SELECT * FROM movements').all();
  const bons      = db.prepare('SELECT * FROM bons').all();
  const bonItems  = db.prepare('SELECT * FROM bon_items').all();
  res.json({ products, movements, bons, bonItems });
});

export { app, db };

// Ne démarre le serveur que si ce fichier est exécuté directement
// (pas lorsqu'il est importé, ex. depuis les tests).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`\n  ✓ Serveur SQLite démarré → http://localhost:${PORT}`);
    console.log(`  ✓ Base de données : ${db.name}\n`);
  });
}
