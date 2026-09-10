CREATE TABLE "bon_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"bon_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" double precision NOT NULL,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bons" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"date" text NOT NULL,
	"type" text DEFAULT 'sortie' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"destination" text DEFAULT '' NOT NULL,
	"is_formal" boolean DEFAULT false NOT NULL,
	"file_name" text,
	"file_type" text,
	"file_data" text
);
--> statement-breakpoint
CREATE TABLE "movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"type" text NOT NULL,
	"date" text NOT NULL,
	"quantity" double precision NOT NULL,
	"bon_number" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"barcode" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"unit" text DEFAULT 'pièce' NOT NULL,
	"min_stock" double precision DEFAULT 0 NOT NULL,
	"stock_initial" double precision DEFAULT 0 NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"updated_at" text DEFAULT now()::text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "bon_items" ADD CONSTRAINT "bon_items_bon_id_bons_id_fk" FOREIGN KEY ("bon_id") REFERENCES "public"."bons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bon_items" ADD CONSTRAINT "bon_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;