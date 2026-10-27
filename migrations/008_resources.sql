-- 008_resources.sql
-- Resources: the parts units are built from (wire, antenna, screws…), stocked
-- by quantity only. `resources.in_stock` is the current stock; every "add
-- stock" is logged in `resource_intakes`. `unit_resources` records how much of
-- each resource one unit used; adding units takes that out of stock, and
-- editing a unit's resources later moves stock by the difference.
--
-- `in_stock` is changed only by a single guarded UPDATE
-- (`in_stock = in_stock + ? WHERE in_stock + ? >= 0`), so it can't go negative.

CREATE TABLE IF NOT EXISTS resources (
    id           CHAR(36)       NOT NULL,
    name         VARCHAR(200)   NOT NULL,
    description  VARCHAR(2000)  NOT NULL DEFAULT '',
    in_stock     INT            NOT NULL DEFAULT 0,
    created_at   DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at   DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    -- Unique case-insensitively (via the _ci collation).
    UNIQUE KEY resources_name_key (name),
    CONSTRAINT resources_in_stock_chk CHECK (in_stock >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS resource_intakes (
    id           CHAR(36)       NOT NULL,
    resource_id  CHAR(36)       NOT NULL,
    quantity     INT            NOT NULL,
    intake_date  DATE           NOT NULL,
    notes        VARCHAR(2000)  NOT NULL DEFAULT '',
    created_by   CHAR(36)       NULL,
    created_at   DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY resource_intakes_resource_idx (resource_id, intake_date),
    CONSTRAINT resource_intakes_resource_fk FOREIGN KEY (resource_id)
        REFERENCES resources (id) ON DELETE CASCADE,
    CONSTRAINT resource_intakes_created_by_fk FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT resource_intakes_quantity_chk CHECK (quantity >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS unit_resources (
    unit_id      CHAR(36)  NOT NULL,
    resource_id  CHAR(36)  NOT NULL,
    quantity     INT       NOT NULL,
    PRIMARY KEY (unit_id, resource_id),
    KEY unit_resources_resource_idx (resource_id),
    -- The app returns a deleted unit's resources to stock before deleting it.
    CONSTRAINT unit_resources_unit_fk FOREIGN KEY (unit_id)
        REFERENCES units (id) ON DELETE CASCADE,
    -- A resource that units were built from can't be deleted.
    CONSTRAINT unit_resources_resource_fk FOREIGN KEY (resource_id)
        REFERENCES resources (id) ON DELETE RESTRICT,
    CONSTRAINT unit_resources_quantity_chk CHECK (quantity >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
