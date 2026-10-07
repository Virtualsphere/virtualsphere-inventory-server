-- 005_products_modules.sql
-- Adds a level above the stocked item: a PRODUCT now groups several MODULES,
-- and units (stock) belong to a module.
--
-- What used to be `products` (SKU, warranty, serial prefix, serial counter)
-- is exactly what a module is, so that table is renamed to `modules` and its
-- foreign-key columns follow. A new, thin `products` table is the parent.
--
-- Existing data: one product is created per distinct module name and each
-- module is linked to it, so nothing is orphaned. Regroup modules afterwards
-- by editing a module's product.
--
-- NOT re-runnable (MySQL commits each DDL statement): back up the database
-- before applying, and restore it if this file fails part-way.

RENAME TABLE products TO modules;

-- InnoDB renames the column inside the existing foreign keys and indexes too.
ALTER TABLE units      RENAME COLUMN product_id TO module_id;
ALTER TABLE dispatches RENAME COLUMN product_id TO module_id;

CREATE TABLE products (
    id           CHAR(36)       NOT NULL,
    name         VARCHAR(200)   NOT NULL,
    description  VARCHAR(2000)  NOT NULL DEFAULT '',
    created_at   DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at   DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    -- Unique case-insensitively (via the _ci collation).
    UNIQUE KEY products_name_key (name),
    KEY products_created_at_idx (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE modules ADD COLUMN product_id CHAR(36) NULL AFTER id;

-- One parent per distinct module name (grouped with the same collation the
-- UNIQUE key and the join below use, so the three always agree).
INSERT INTO products (id, name)
SELECT UUID(), name FROM modules GROUP BY name;

UPDATE modules m JOIN products p ON p.name = m.name
SET m.product_id = p.id;

ALTER TABLE modules
    MODIFY COLUMN product_id CHAR(36) NOT NULL,
    ADD KEY modules_product_idx (product_id),
    -- A product with modules can't be deleted; its modules go first.
    ADD CONSTRAINT modules_product_fk FOREIGN KEY (product_id)
        REFERENCES products (id) ON DELETE RESTRICT;
