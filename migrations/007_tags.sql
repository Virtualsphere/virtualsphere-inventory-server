-- 007_tags.sql
-- Tags: stock counted by quantity only — no serials, no warranty. A tag's
-- current stock is `tags.in_stock`; every "add stock" is logged in
-- `tag_intakes`, and tags handed to a customer are lines in `dispatch_tags`
-- on the same hand-over (dispatch) as any modules given with them.
--
-- `in_stock` is changed only by a single guarded UPDATE
-- (`in_stock = in_stock - ? WHERE in_stock >= ?`), so it can't go negative
-- under concurrent hand-overs.

CREATE TABLE IF NOT EXISTS tags (
    id           CHAR(36)       NOT NULL,
    name         VARCHAR(200)   NOT NULL,
    description  VARCHAR(2000)  NOT NULL DEFAULT '',
    in_stock     INT            NOT NULL DEFAULT 0,
    created_at   DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at   DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    -- Unique case-insensitively (via the _ci collation).
    UNIQUE KEY tags_name_key (name),
    CONSTRAINT tags_in_stock_chk CHECK (in_stock >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS tag_intakes (
    id           CHAR(36)       NOT NULL,
    tag_id       CHAR(36)       NOT NULL,
    quantity     INT            NOT NULL,
    intake_date  DATE           NOT NULL,
    notes        VARCHAR(2000)  NOT NULL DEFAULT '',
    created_by   CHAR(36)       NULL,
    created_at   DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY tag_intakes_tag_idx (tag_id, intake_date),
    CONSTRAINT tag_intakes_tag_fk FOREIGN KEY (tag_id)
        REFERENCES tags (id) ON DELETE CASCADE,
    CONSTRAINT tag_intakes_created_by_fk FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT tag_intakes_quantity_chk CHECK (quantity >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS dispatch_tags (
    id           CHAR(36)  NOT NULL,
    dispatch_id  CHAR(36)  NOT NULL,
    tag_id       CHAR(36)  NOT NULL,
    quantity     INT       NOT NULL,
    PRIMARY KEY (id),
    -- A tag appears at most once per hand-over.
    UNIQUE KEY dispatch_tags_tag_key (dispatch_id, tag_id),
    KEY dispatch_tags_tag_idx (tag_id),
    CONSTRAINT dispatch_tags_dispatch_fk FOREIGN KEY (dispatch_id)
        REFERENCES dispatches (id) ON DELETE CASCADE,
    -- A tag that was given out can't be deleted; that would rewrite history.
    CONSTRAINT dispatch_tags_tag_fk FOREIGN KEY (tag_id)
        REFERENCES tags (id) ON DELETE RESTRICT,
    CONSTRAINT dispatch_tags_quantity_chk CHECK (quantity >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
