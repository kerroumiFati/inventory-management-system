import { z } from 'zod';

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
  updatedAt: z.string().optional(),
});
export type Product = z.infer<typeof ProductSchema>;

export const MovementSchema = z.object({
  id: z.number().int().optional(),
  productId: z.number().int(),
  type: z.enum(['entree', 'sortie']),
  date: z.string(),
  quantity: z.number(),
  bonNumber: z.string().default(''),
  note: z.string().default(''),
});
export type Movement = z.infer<typeof MovementSchema>;

export const BonSchema = z.object({
  id: z.number().int().optional(),
  number: z.string().min(1),
  date: z.string(),
  type: z.string().default('sortie'),
  note: z.string().default(''),
  destination: z.string().default(''),
  isFormal: z.boolean().default(false),
  fileName: z.string().nullable().default(null),
  fileType: z.string().nullable().default(null),
  fileData: z.string().nullable().default(null),
});
export type Bon = z.infer<typeof BonSchema>;

export const BonItemSchema = z.object({
  id: z.number().int().optional(),
  bonId: z.number().int(),
  productId: z.number().int(),
  quantity: z.number(),
  note: z.string().default(''),
});
export type BonItem = z.infer<typeof BonItemSchema>;

export const LoginRequestSchema = z.object({
  username: z.string().min(1, 'Identifiant requis'),
  password: z.string().min(1, 'Mot de passe requis'),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(4, 'Le mot de passe doit faire au moins 4 caractères'),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const SyncPushRequestSchema = z.object({
  products: z.array(ProductSchema).default([]),
  movements: z.array(MovementSchema).default([]),
  bons: z.array(BonSchema).default([]),
  bonItems: z.array(BonItemSchema).default([]),
});
export type SyncPushRequest = z.infer<typeof SyncPushRequestSchema>;
