-- CreateTable: password_reset_tokens
-- Stores SHA-256 hashed tokens for the forgot/reset password flow.
-- Raw tokens are never persisted; only their hash is stored for comparison
-- via crypto.timingSafeEqual.

CREATE TABLE "password_reset_tokens" (
    "id"         UUID          NOT NULL DEFAULT gen_random_uuid(),
    "user_id"    UUID          NOT NULL,
    "token_hash" VARCHAR(128)  NOT NULL,
    "used"       BOOLEAN       NOT NULL DEFAULT FALSE,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- Index for fast lookup by token hash (the primary query path).
CREATE INDEX "idx_password_reset_tokens_hash" ON "password_reset_tokens" ("token_hash");

-- Index for cleanup queries (delete expired tokens).
CREATE INDEX "idx_password_reset_tokens_expires" ON "password_reset_tokens" ("expires_at");

-- FK to users; cascade on user deletion.
ALTER TABLE "password_reset_tokens"
    ADD CONSTRAINT "password_reset_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
