-- Unified Settings Module: profile fields, email change OTP, privacy settings, and blocked users.

DO $$ BEGIN
  CREATE TYPE "privacy_visibility" AS ENUM ('everyone', 'friends', 'nobody');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "nickname" VARCHAR(60),
  ADD COLUMN IF NOT EXISTS "bio" VARCHAR(160),
  ADD COLUMN IF NOT EXISTS "last_seen_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "pending_email" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "email_change_token_hash" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "email_change_expires_at" TIMESTAMPTZ(6);

CREATE TABLE IF NOT EXISTS "user_privacy_settings" (
  "user_id" UUID NOT NULL,
  "last_seen_visibility" "privacy_visibility" NOT NULL DEFAULT 'everyone',
  "online_visibility" "privacy_visibility" NOT NULL DEFAULT 'everyone',
  "read_receipts_enabled" BOOLEAN NOT NULL DEFAULT true,
  "typing_indicator_enabled" BOOLEAN NOT NULL DEFAULT true,
  "who_can_message" "privacy_visibility" NOT NULL DEFAULT 'everyone',
  "who_can_add_to_groups" "privacy_visibility" NOT NULL DEFAULT 'everyone',
  "default_disappearing_timer" INTEGER NOT NULL DEFAULT 0,
  "security_change_notifications" BOOLEAN NOT NULL DEFAULT true,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_privacy_settings_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "user_privacy_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "blocked_users" (
  "blocker_id" UUID NOT NULL,
  "blocked_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "blocked_users_pkey" PRIMARY KEY ("blocker_id", "blocked_id"),
  CONSTRAINT "blocked_users_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "blocked_users_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_blocked_users_blocked" ON "blocked_users"("blocked_id");

