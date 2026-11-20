-- Registration Email Verification via 6-Digit OTP.
-- Existing accounts created before this migration are marked verified so they are
-- not locked out on deployment; all newly registered accounts default to FALSE
-- and must verify their email via 6-digit OTP before logging in.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "email_verified" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "email_verified_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "email_verification_token_hash" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "email_verification_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "email_verification_attempts" INTEGER NOT NULL DEFAULT 0;

UPDATE "users"
  SET "email_verified_at" = COALESCE("email_verified_at", "created_at", NOW())
  WHERE "email_verified" = TRUE AND "email_verified_at" IS NULL;

ALTER TABLE "users"
  ALTER COLUMN "email_verified" SET DEFAULT FALSE;
