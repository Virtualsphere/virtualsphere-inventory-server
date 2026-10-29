-- 010_antennas.sql
-- Antennas: stocked and given exactly like modules — units with internal and
-- supplier serials, warranty, resources used, hand-overs — but kept apart from
-- them in the app. A product is now one of two kinds: a `module` product
-- groups modules, an `antenna` product groups antenna models. The models are
-- rows of `modules` either way, so units, intake, dispatches and warranty need
-- nothing new.
--
-- Existing products are all module products. ALTER TABLE … ADD COLUMN has no
-- IF NOT EXISTS in MySQL, so this file relies on the runner applying it once.

ALTER TABLE products
    ADD COLUMN kind ENUM('module', 'antenna') NOT NULL DEFAULT 'module' AFTER id,
    ADD KEY products_kind_idx (kind);
