import { z } from 'zod';

// ── Champs de synchronisation (côté poste) ──────────────────
// uid       : identifiant unique global, commun à tous les postes (l'id local reste propre à chaque poste)
// updatedAt : date de dernière modification, sert à départager deux modifications concurrentes
// dirty     : 1 si la ligne a été modifiée localement et pas encore envoyée au serveur
const LocalSyncFields = {
  uid: z.string().optional(),
  updatedAt: z.string().optional(),
  dirty: z.number().int().optional(),
};

export const ProductSchema = z.object({
  id: z.number().int().optional(),
  name: z.string().min(1, 'Le libellé est requis'),
  reference: z.string().default(''),
  barcode: z.string().default(''),
  category: z.string().default(''),
  unit: z.string().default('pièce'),
  minStock: z.number().min(0).default(0),
  stockInitial: z.number().min(0).default(0),
  description: z.string().default(''),
  // Prix unitaire (valorisation du stock et des mouvements).
  unitPrice: z.number().min(0).optional(),
  // Fournisseur habituel (regroupement des propositions de réapprovisionnement).
  supplier: z.string().optional(),
  // Stock visé après réapprovisionnement (0 = deux fois le stock minimum).
  maxStock: z.number().min(0).optional(),
  ...LocalSyncFields,
});
export type Product = z.infer<typeof ProductSchema>;

export const MovementSchema = z.object({
  id: z.number().int().optional(),
  productId: z.number().int(),
  // Bon d'origine (sortie ou réception). Absent pour une entrée unitaire.
  bonId: z.number().int().optional(),
  type: z.enum(['entree', 'sortie']),
  date: z.string(),
  quantity: z.number(),
  bonNumber: z.string().default(''),
  note: z.string().default(''),
  // Utilisateur qui a saisi le mouvement.
  createdBy: z.string().optional(),
  ...LocalSyncFields,
});
export type Movement = z.infer<typeof MovementSchema>;

// commande : bon de commande fournisseur, sans effet sur le stock tant qu'il n'est pas réceptionné.
// inventaire : comptage physique ; ses mouvements ajustent le stock aux quantités comptées.
export const BON_TYPES = ['sortie', 'entree', 'commande', 'inventaire'] as const;
export type BonType = typeof BON_TYPES[number];

export const BonSchema = z.object({
  id: z.number().int().optional(),
  number: z.string().min(1),
  date: z.string(),
  type: z.string().default('sortie'),
  note: z.string().default(''),
  destination: z.string().default(''),
  // Accepte aussi 0/1 (format SQLite) pour les données déjà reçues du serveur.
  isFormal: z.union([z.boolean(), z.number()]).transform(v => Boolean(v)).default(false),
  fileName: z.string().nullable().default(null),
  fileType: z.string().nullable().default(null),
  fileData: z.string().nullable().default(null),
  // Utilisateur qui a créé le bon.
  createdBy: z.string().optional(),
  // Réception : uid de la commande qu'elle solde (l'uid est commun à tous les postes).
  orderUid: z.string().nullable().optional(),
  ...LocalSyncFields,
});
export type Bon = z.infer<typeof BonSchema>;

export const BonItemSchema = z.object({
  id: z.number().int().optional(),
  bonId: z.number().int(),
  productId: z.number().int(),
  quantity: z.number(),
  note: z.string().default(''),
  // Inventaire : stock théorique au moment du comptage (quantity = quantité comptée).
  expected: z.number().nullable().optional(),
  ...LocalSyncFields,
});
export type BonItem = z.infer<typeof BonItemSchema>;

// ── Authentification / utilisateurs ─────────────────────────
export const PASSWORD_MIN_LENGTH = 8;
const NewPassword = z.string().min(PASSWORD_MIN_LENGTH, `Le mot de passe doit faire au moins ${PASSWORD_MIN_LENGTH} caractères`);

export const ROLES = ['admin', 'user'] as const;
export type Role = typeof ROLES[number];

export const LoginRequestSchema = z.object({
  username: z.string().min(1, 'Identifiant requis'),
  password: z.string().min(1, 'Mot de passe requis'),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1, 'Mot de passe actuel requis'),
  newPassword: NewPassword,
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const CreateUserRequestSchema = z.object({
  username: z.string().trim().min(2, 'L\'identifiant doit faire au moins 2 caractères').max(50),
  password: NewPassword,
  role: z.enum(ROLES).default('user'),
});

export const UpdateUserRequestSchema = z.object({
  role: z.enum(ROLES).optional(),
  password: NewPassword.optional(),
});

export interface UserInfo {
  id: number;
  username: string;
  role: Role;
  created_at: string;
}

// ── Synchronisation (format échangé avec le serveur) ────────
// Les relations y sont exprimées par uid, car les id locaux diffèrent d'un poste à l'autre.
export const SYNC_TABLES = ['products', 'movements', 'bons', 'bonItems'] as const;
export type SyncTable = typeof SYNC_TABLES[number];

const Uid = z.string().min(1).max(100);
const SyncFields = { uid: Uid, updatedAt: z.string().min(1) };

export const SyncProductSchema = ProductSchema
  .omit({ id: true, uid: true, updatedAt: true, dirty: true })
  .extend(SyncFields);
export const SyncMovementSchema = MovementSchema
  .omit({ id: true, productId: true, bonId: true, uid: true, updatedAt: true, dirty: true })
  .extend({ ...SyncFields, productUid: Uid, bonUid: Uid.nullable().default(null) });
export const SyncBonSchema = BonSchema
  .omit({ id: true, uid: true, updatedAt: true, dirty: true })
  .extend(SyncFields);
export const SyncBonItemSchema = BonItemSchema
  .omit({ id: true, bonId: true, productId: true, uid: true, updatedAt: true, dirty: true })
  .extend({ ...SyncFields, bonUid: Uid, productUid: Uid });

export type SyncProduct  = z.infer<typeof SyncProductSchema>;
export type SyncMovement = z.infer<typeof SyncMovementSchema>;
export type SyncBon      = z.infer<typeof SyncBonSchema>;
export type SyncBonItem  = z.infer<typeof SyncBonItemSchema>;

export const TombstoneSchema = z.object({
  tbl: z.enum(SYNC_TABLES),
  uid: Uid,
  deletedAt: z.string().min(1),
});
export type Tombstone = z.infer<typeof TombstoneSchema>;

export const SyncPushRequestSchema = z.object({
  clientId: z.string().min(1).max(100),
  products: z.array(SyncProductSchema).default([]),
  movements: z.array(SyncMovementSchema).default([]),
  bons: z.array(SyncBonSchema).default([]),
  bonItems: z.array(SyncBonItemSchema).default([]),
  deletions: z.array(TombstoneSchema).default([]),
});
export type SyncPushRequest = z.input<typeof SyncPushRequestSchema>;

export interface SyncPushResponse {
  ok: true;
  revision: number;
  applied: number;
  // Lignes ignorées car le serveur en a une version plus récente (elles reviendront au prochain pull).
  stale: number;
}

export interface SyncPullResponse {
  revision: number;
  // true : réponse complète (since=0), le poste peut supprimer ce qui n'y figure pas.
  full: boolean;
  products: SyncProduct[];
  movements: SyncMovement[];
  bons: SyncBon[];
  bonItems: SyncBonItem[];
  deletions: { tbl: SyncTable; uid: string; deletedAt: string }[];
}
