-- 006_dispatch_items.sql
-- One hand-over (invoice, customer, given date, validity) can now cover
-- several modules. `dispatches` becomes the hand-over itself and each module
-- given is a line in `dispatch_items`. Units keep pointing at the hand-over
-- (units.dispatch_id); their module says which line they belong to.
--
-- Existing data: every dispatch becomes a one-line hand-over, then records
-- that were saved together as one multi-module hand-over (same invoice,
-- customer, phone, GSTIN, dates, notes and user, created within a few
-- seconds of each other) are merged into one.
--
-- NOT re-runnable (MySQL commits each DDL statement): back up the database
-- before applying, and restore it if this file fails part-way.

CREATE TABLE dispatch_items (
    id           CHAR(36)  NOT NULL,
    dispatch_id  CHAR(36)  NOT NULL,
    module_id    CHAR(36)  NOT NULL,
    quantity     INT       NOT NULL,
    PRIMARY KEY (id),
    -- A module appears at most once per hand-over.
    UNIQUE KEY dispatch_items_module_key (dispatch_id, module_id),
    KEY dispatch_items_module_idx (module_id),
    CONSTRAINT dispatch_items_dispatch_fk FOREIGN KEY (dispatch_id)
        REFERENCES dispatches (id) ON DELETE CASCADE,
    -- Deleting a module already deletes its units; its lines go with it.
    CONSTRAINT dispatch_items_module_fk FOREIGN KEY (module_id)
        REFERENCES modules (id) ON DELETE CASCADE,
    CONSTRAINT dispatch_items_quantity_chk CHECK (quantity >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO dispatch_items (id, dispatch_id, module_id, quantity)
SELECT UUID(), id, module_id, quantity FROM dispatches;

-- Map each dispatch to the earliest record of the same hand-over.
CREATE TEMPORARY TABLE dispatch_merge AS
SELECT d.id AS old_id,
       (SELECT k.id FROM dispatches k
        WHERE k.invoice_no = d.invoice_no
          AND k.customer_name = d.customer_name
          AND k.customer_phone = d.customer_phone
          AND k.gst_no <=> d.gst_no
          AND k.given_date = d.given_date
          AND k.valid_until <=> d.valid_until
          AND k.notes = d.notes
          AND k.created_by <=> d.created_by
          AND k.created_at BETWEEN d.created_at - INTERVAL 5 SECOND AND d.created_at
        ORDER BY k.created_at, k.id
        LIMIT 1) AS keep_id
FROM dispatches d;

UPDATE dispatch_items i JOIN dispatch_merge m ON m.old_id = i.dispatch_id
SET i.dispatch_id = m.keep_id
WHERE m.keep_id <> m.old_id;

UPDATE units u JOIN dispatch_merge m ON m.old_id = u.dispatch_id
SET u.dispatch_id = m.keep_id
WHERE m.keep_id <> m.old_id;

DELETE d FROM dispatches d JOIN dispatch_merge m ON m.old_id = d.id
WHERE m.keep_id <> m.old_id;

DROP TEMPORARY TABLE dispatch_merge;

-- The module and quantity now live on the lines.
ALTER TABLE dispatches
    DROP FOREIGN KEY dispatches_product_fk,
    DROP CHECK dispatches_quantity_chk;
ALTER TABLE dispatches
    DROP COLUMN module_id,
    DROP COLUMN quantity;
