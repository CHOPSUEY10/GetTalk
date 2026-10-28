ALTER TABLE "users"
    ADD COLUMN "mfa_secret" TEXT,
    ADD COLUMN "mfa_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "mfa_recovery_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "mfa_last_totp_step" BIGINT NOT NULL DEFAULT -1;
