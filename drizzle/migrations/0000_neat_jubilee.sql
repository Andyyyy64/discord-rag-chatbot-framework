CREATE TABLE "channels" (
	"guild_id" text NOT NULL,
	"channel_id" text PRIMARY KEY NOT NULL,
	"category_id" text,
	"name" text,
	"type" integer,
	"last_scanned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "embed_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "message_embeddings" (
	"window_id" uuid PRIMARY KEY NOT NULL,
	"embedding" vector(3072) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "message_windows" (
	"window_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"category_id" text,
	"channel_id" text NOT NULL,
	"thread_id" text,
	"date" date NOT NULL,
	"window_seq" integer NOT NULL,
	"message_ids" text[] NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"token_est" integer,
	"text" text
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"guild_id" text NOT NULL,
	"category_id" text,
	"channel_id" text NOT NULL,
	"thread_id" text,
	"message_id" text PRIMARY KEY NOT NULL,
	"author_id" text,
	"content_md" text,
	"content_plain" text,
	"created_at" timestamp with time zone,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"mentions" jsonb,
	"attachments" jsonb,
	"jump_link" text,
	"token_count" integer,
	"allowed_role_ids" text[],
	"allowed_user_ids" text[]
);
--> statement-breakpoint
CREATE TABLE "sync_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"op_id" uuid NOT NULL,
	"target_id" text NOT NULL,
	"date" date NOT NULL,
	"cursor" jsonb,
	"status" text DEFAULT 'ready' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sync_cursors" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"last_message_id" text,
	"last_synced_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sync_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"scope" text NOT NULL,
	"mode" text NOT NULL,
	"target_ids" text[],
	"since" timestamp with time zone,
	"requested_by" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"thread_id" text PRIMARY KEY NOT NULL,
	"name" text,
	"archived" boolean DEFAULT false,
	"last_scanned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "message_embeddings" ADD CONSTRAINT "message_embeddings_window_id_message_windows_window_id_fk" FOREIGN KEY ("window_id") REFERENCES "public"."message_windows"("window_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_chunks" ADD CONSTRAINT "sync_chunks_op_id_sync_operations_id_fk" FOREIGN KEY ("op_id") REFERENCES "public"."sync_operations"("id") ON DELETE cascade ON UPDATE no action;