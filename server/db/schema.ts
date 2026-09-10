import { pgTable, serial, text, integer, boolean, doublePrecision } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),
  role: text('role').notNull().default('user'),
  createdAt: text('created_at').notNull().default(sql`now()::text`),
});

export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  reference: text('reference').notNull().default(''),
  barcode: text('barcode').notNull().default(''),
  category: text('category').notNull().default(''),
  unit: text('unit').notNull().default('pièce'),
  minStock: doublePrecision('min_stock').notNull().default(0),
  stockInitial: doublePrecision('stock_initial').notNull().default(0),
  description: text('description').notNull().default(''),
  updatedAt: text('updated_at').notNull().default(sql`now()::text`),
});

export const movements = pgTable('movements', {
  id: serial('id').primaryKey(),
  productId: integer('product_id').notNull().references(() => products.id),
  type: text('type').notNull(), // 'entree' | 'sortie'
  date: text('date').notNull(),
  quantity: doublePrecision('quantity').notNull(),
  bonNumber: text('bon_number').notNull().default(''),
  note: text('note').notNull().default(''),
});

export const bons = pgTable('bons', {
  id: serial('id').primaryKey(),
  number: text('number').notNull(),
  date: text('date').notNull(),
  type: text('type').notNull().default('sortie'),
  note: text('note').notNull().default(''),
  destination: text('destination').notNull().default(''),
  isFormal: boolean('is_formal').notNull().default(false),
  fileName: text('file_name'),
  fileType: text('file_type'),
  fileData: text('file_data'),
});

export const bonItems = pgTable('bon_items', {
  id: serial('id').primaryKey(),
  bonId: integer('bon_id').notNull().references(() => bons.id),
  productId: integer('product_id').notNull().references(() => products.id),
  quantity: doublePrecision('quantity').notNull(),
  note: text('note').notNull().default(''),
});

export const productsRelations = relations(products, ({ many }) => ({
  movements: many(movements),
  bonItems: many(bonItems),
}));

export const movementsRelations = relations(movements, ({ one }) => ({
  product: one(products, { fields: [movements.productId], references: [products.id] }),
}));

export const bonsRelations = relations(bons, ({ many }) => ({
  items: many(bonItems),
}));

export const bonItemsRelations = relations(bonItems, ({ one }) => ({
  bon: one(bons, { fields: [bonItems.bonId], references: [bons.id] }),
  product: one(products, { fields: [bonItems.productId], references: [products.id] }),
}));
