import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { ZodError } from 'zod';
import { eq, count } from 'drizzle-orm';
import { createDb } from './db/client.ts';
import { users, products, movements, bons, bonItems } from './db/schema.ts';
import {
  LoginRequestSchema,
  ChangePasswordRequestSchema,
  SyncPushRequestSchema,
} from '../shared/schemas';

interface AuthTokenPayload {
  id: number;
  username: string;
  role: string;
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

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('  ✗ DATABASE_URL est requis (voir server/.env.example). Lancez `docker compose up -d` puis `npm run db:migrate`.');
  process.exit(1);
}

const { db, pool } = createDb(connectionString);

const envJwtSecret = process.env.JWT_SECRET;
const JWT_SECRET: string = envJwtSecret ?? randomBytes(32).toString('hex');
if (!envJwtSecret) {
  console.warn('  ! JWT_SECRET absent de l\'environnement : un secret aléatoire a été généré pour cette exécution.');
  console.warn('  ! Les sessions existantes seront invalidées à chaque redémarrage tant que JWT_SECRET n\'est pas défini dans server/.env');
}

// Créer le compte admin par défaut si aucun utilisateur n'existe
const [{ value: userCount }] = await db.select({ value: count() }).from(users);
if (userCount === 0) {
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  let adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    adminPassword = randomBytes(9).toString('base64url');
    console.warn(`  ! ADMIN_PASSWORD absent de l'environnement : mot de passe généré pour "${adminUsername}" → ${adminPassword}`);
    console.warn('  ! Notez-le maintenant, il ne sera plus jamais affiché. Définissez ADMIN_PASSWORD dans server/.env pour un mot de passe stable.');
  }
  const hash = bcrypt.hashSync(adminPassword, 10);
  await db.insert(users).values({ username: adminUsername, password: hash, role: 'admin' });
  console.log(`  ✓ Compte admin créé → ${adminUsername}`);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ── Middleware JWT ──────────────────────────────────────────
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET) as unknown as AuthTokenPayload;
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

// Transforme une erreur Zod en réponse 400 lisible.
function zodErrorMessage(err: ZodError): string {
  return err.issues.map(i => i.message).join(', ');
}

// ── Statut (public) ─────────────────────────────────────────
app.get('/api/status', (_req, res) => res.json({ ok: true }));

// ── Auth : login ─────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  let body;
  try {
    body = LoginRequestSchema.parse(req.body);
  } catch (err) {
    return res.status(400).json({ error: err instanceof ZodError ? zodErrorMessage(err) : 'Identifiants requis' });
  }
  const { username, password } = body;

  const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
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
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  let body;
  try {
    body = ChangePasswordRequestSchema.parse(req.body);
  } catch (err) {
    return res.status(400).json({ error: err instanceof ZodError ? zodErrorMessage(err) : 'Champs requis' });
  }
  const { currentPassword, newPassword } = body;

  const [user] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
  if (!user || !bcrypt.compareSync(currentPassword, user.password)) {
    return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  await db.update(users).set({ password: hash }).where(eq(users.id, req.user!.id));
  res.json({ ok: true });
});

// ── SYNC : le client envoie toutes ses données ──────────────
app.post('/api/sync/push', requireAuth, async (req, res) => {
  let body;
  try {
    body = SyncPushRequestSchema.parse(req.body);
  } catch (err) {
    return res.status(400).json({ error: err instanceof ZodError ? zodErrorMessage(err) : 'Payload invalide' });
  }
  const { products: productsPayload, movements: movementsPayload, bons: bonsPayload, bonItems: bonItemsPayload } = body;

  await db.transaction(async tx => {
    // Ordre FK-safe : enfants d'abord pour la suppression, parents d'abord pour l'insertion.
    await tx.delete(bonItems);
    await tx.delete(movements);
    await tx.delete(bons);
    await tx.delete(products);

    // Les id sont fournis explicitement par le client (généré par Dexie côté navigateur),
    // comme c'était déjà le cas avec la clé auto-incrémentée SQLite.
    if (productsPayload.length) {
      await tx.insert(products).values(productsPayload.map(p => ({
        id: p.id, name: p.name, reference: p.reference || '', barcode: p.barcode || '',
        category: p.category || '', unit: p.unit || 'pièce', minStock: p.minStock || 0,
        stockInitial: p.stockInitial || 0, description: p.description || '',
        updatedAt: new Date().toISOString(),
      })));
    }
    if (movementsPayload.length) {
      await tx.insert(movements).values(movementsPayload.map(m => ({
        id: m.id, productId: m.productId, type: m.type, date: m.date,
        quantity: m.quantity, bonNumber: m.bonNumber || '', note: m.note || '',
      })));
    }
    if (bonsPayload.length) {
      await tx.insert(bons).values(bonsPayload.map(b => ({
        id: b.id, number: b.number, date: b.date, type: b.type || 'sortie',
        note: b.note || '', destination: b.destination || '', isFormal: b.isFormal ?? false,
        fileName: b.fileName || null, fileType: b.fileType || null, fileData: b.fileData || null,
      })));
    }
    if (bonItemsPayload.length) {
      await tx.insert(bonItems).values(bonItemsPayload.map(i => ({
        id: i.id, bonId: i.bonId, productId: i.productId, quantity: i.quantity, note: i.note || '',
      })));
    }
  });

  res.json({
    ok: true,
    synced: { products: productsPayload.length, movements: movementsPayload.length, bons: bonsPayload.length },
  });
});

// ── SYNC : le client récupère toutes les données ────────────
app.get('/api/sync/pull', requireAuth, async (_req, res) => {
  const [productsList, movementsList, bonsList, bonItemsList] = await Promise.all([
    db.select().from(products),
    db.select().from(movements),
    db.select().from(bons),
    db.select().from(bonItems),
  ]);
  res.json({ products: productsList, movements: movementsList, bons: bonsList, bonItems: bonItemsList });
});

export { app, pool };

// Ne démarre le serveur que si ce fichier est exécuté directement
// (pas lorsqu'il est importé, ex. depuis les tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`\n  ✓ Serveur démarré → http://localhost:${PORT}`);
    console.log(`  ✓ Base de données : PostgreSQL (${connectionString.replace(/:[^:@]+@/, ':****@')})\n`);
  });
}
