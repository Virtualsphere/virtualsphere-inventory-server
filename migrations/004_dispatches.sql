-- 004_dispatches.sql
-- Stock given out to a customer. One row per (invoice, product) hand-over;
-- the physical units that went out point back here via units.dispatch_id and
-- are flipped to status 'sold' in the same transaction that creates the row.

CREATE TABLE IF NOT EXISTS dispatches (
    id              CHAR(36)       NOT NULL,
    invoice_no      VARCHAR(64)    NOT NULL,            -- not unique: one invoice may cover several products
    customer_name   VARCHAR(200)   NOT NULL,
    customer_phone  VARCHAR(20)    NOT NULL,
    gst_no          VARCHAR(15)    NULL,                -- GSTIN; NULL for unregistered customers
    product_id      CHAR(36)       NOT NULL,
    quantity        INT            NOT NULL,
    given_date      DATE           NOT NULL,
    valid_until     DATE           NULL,                -- validity / warranty date promised to the customer
    notes           VARCHAR(2000)  NOT NULL DEFAULT '',
    created_by      CHAR(36)       NULL,
    created_at      DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY dispatches_invoice_idx (invoice_no),
    KEY dispatches_customer_idx (customer_name),
    KEY dispatches_given_date_idx (given_date),
    -- Deleting a product already deletes its units; its dispatch history goes with it.
    CONSTRAINT dispatches_product_fk FOREIGN KEY (product_id)
        REFERENCES products (id) ON DELETE CASCADE,
    CONSTRAINT dispatches_created_by_fk FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT dispatches_quantity_chk CHECK (quantity >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE units
    ADD COLUMN dispatch_id CHAR(36) NULL AFTER sold_date,
    ADD KEY units_dispatch_idx (dispatch_id),
    ADD CONSTRAINT units_dispatch_fk FOREIGN KEY (dispatch_id)
        REFERENCES dispatches (id) ON DELETE SET NULL;
