-- 003_users.sql
-- Accounts for login. There is no public sign-up: an admin registers users.
-- The first admin is created at server start from ADMIN_USERNAME /
-- ADMIN_PASSWORD (see src/modules/auth/bootstrapAdmin.ts), because a password
-- hash cannot be safely shipped in a SQL file.

CREATE TABLE IF NOT EXISTS users (
    id             CHAR(36)      NOT NULL,
    username       VARCHAR(32)   NOT NULL,             -- login name; unique, case-insensitive (_ci collation)
    full_name      VARCHAR(200)  NOT NULL DEFAULT '',
    password_hash  VARCHAR(255)  NOT NULL,             -- scrypt$N$r$p$salt$hash (see src/lib/password.ts)
    role           ENUM('admin', 'user') NOT NULL DEFAULT 'user',
    is_active      TINYINT(1)    NOT NULL DEFAULT 1,
    -- Embedded in every JWT; bumping it (password change, deactivation)
    -- invalidates all of that user's outstanding tokens immediately.
    token_version  INT           NOT NULL DEFAULT 0,
    last_login_at  DATETIME(3)   NULL,
    created_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY users_username_key (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
