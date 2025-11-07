ALTER TABLE "embed_queue" ADD COLUMN "window_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "embed_queue" ADD CONSTRAINT "embed_queue_window_id_message_windows_window_id_fk" FOREIGN KEY ("window_id") REFERENCES "public"."message_windows"("window_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embed_queue" DROP COLUMN "message_id";