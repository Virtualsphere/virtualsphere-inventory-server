-- 009_tag_categories.sql
-- Tag categories: the tags page also stocks other quantity-only things given
-- to customers (RS232 cables, adapters…). Each tag belongs to one category;
-- admins manage the list in Settings. Everything else — stock intakes, giving
-- on a hand-over, undo — works the same for every category.
--
-- Existing tags go into a "Tag" category. ALTER TABLE … ADD COLUMN has no
-- IF NOT EXISTS in MySQL, so this file relies on the runner applying it once.

CREATE TABLE IF NOT EXISTS tag_categories (
    id           CHAR(36)       NOT NULL,
    name         VARCHAR(100)   NOT NULL,
    created_at   DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at   DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    -- Unique case-insensitively (via the _ci collation).
    UNIQUE KEY tag_categories_name_key (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO tag_categories (id, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'Tag');

ALTER TABLE tags ADD COLUMN category_id CHAR(36) NULL AFTER id;

UPDATE tags SET category_id = '00000000-0000-4000-8000-000000000001'
WHERE category_id IS NULL;

ALTER TABLE tags
    MODIFY category_id CHAR(36) NOT NULL,
    ADD KEY tags_category_idx (category_id),
    -- A category that still has tags can't be deleted.
    ADD CONSTRAINT tags_category_fk FOREIGN KEY (category_id)
        REFERENCES tag_categories (id) ON DELETE RESTRICT;
