# Stockroom — Serial & Warranty Inventory (backend + frontend + DB)

A small ERP for tracking **individual units** of a product. You create a
product (e.g. `VLD1030`), then add units to it. Each unit maps the
**manufacturer / supplier serial** (what you claim warranty against with the
vendor) to an **internally generated serial** (your own tracking id), 1:1.

This is the production counterpart to the single-file prototype: a
**Node.js + TypeScript + Express** API over **MySQL**, with **race-free
serial allocation**, plus a static reference web client.

---

## Table of contents
- [Stack](#stack)
- [Project structure](#project-structure)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [How internal serials are generated (the important part)](#how-internal-serials-are-generated-the-important-part)
- [Database schema](#database-schema)
- [Authentication](#authentication)
- [API reference](#api-reference)
- [The reference frontend](#the-reference-frontend)
- [Testing](#testing)
- [Taking it further](#taking-it-further)

---

## Stack

| Concern         | Choice                                           |
|-----------------|--------------------------------------------------|
| Language        | TypeScript (strict)                              |
| Runtime         | Node.js ≥ 20                                      |
| HTTP            | Express 4                                         |
| Database        | MySQL 8.0.16+ (via `mysql2`, raw SQL — no ORM)   |
| Validation      | Zod                                              |
| Migrations      | plain `.sql` files + a tiny forward-only runner  |
| Tests           | Vitest                                           |
| Dev run         | `tsx` (run TS directly, watch mode)              |

Raw SQL is deliberate: the one genuinely interesting operation — serial
allocation — is a transaction with an explicit row lock, and an ORM would hide
exactly the thing worth seeing.

---

## Project structure

```
stockroom-server/
├── docker-compose.yml          # local MySQL
├── Dockerfile                  # app image (migrate + start)
├── .env.example
├── migrations/
│   ├── 001_init.sql            # schema: settings, products, units (+ indexes)
│   └── 002_seed_settings.sql   # singleton settings row
├── src/
│   ├── index.ts                # entrypoint, graceful shutdown
│   ├── app.ts                  # express wiring, routes, static, 404
│   ├── config.ts               # typed env config
│   ├── types.ts                # domain types (Product, Unit, UnitView, …)
│   ├── db/
│   │   ├── pool.ts             # mysql2 pool + withTransaction()
│   │   └── migrate.ts          # `npm run migrate`
│   ├── lib/
│   │   ├── errors.ts           # AppError + helpers
│   │   ├── asyncHandler.ts
│   │   ├── validate.ts         # zod -> 400
│   │   ├── serial.ts           # internal-serial formatting
│   │   └── warranty.ts         # warranty-window math
│   ├── middleware/
│   │   └── errorHandler.ts
│   └── modules/
│       ├── products/           # schema / repo / service / routes
│       ├── units/              # schema / repo / service / routes  ← intake lives here
│       ├── warranty/           # routes (lookup by either serial)
│       ├── settings/           # schema / repo / routes
│       └── stats/              # repo / routes (dashboard)
├── public/                     # static reference client (vanilla JS)
│   ├── index.html
│   └── app.js
└── test/
    └── intake.concurrency.test.ts   # proves no serial collision
```

Each module follows the same layering: **routes** (HTTP + validation) →
**service** (business rules, transactions, error translation) → **repo** (SQL).

---

## Quick start

Prerequisites: Node ≥ 20, and either Docker (for the bundled MySQL) or your
own MySQL 8.0.16+.

```bash
# 1. MySQL (skip if you have your own — create a database + user, then set the DB_* values in .env)
docker compose up -d

# 2. install + configure
npm install
cp .env.example .env            # defaults already match docker-compose

# 3. create the schema
npm run migrate

# 4. run (API + frontend on http://localhost:4000)
npm run dev
```

Open **http://localhost:4000** for the web client, or hit the API directly:

```bash
curl localhost:4000/api/health
```

Production build:

```bash
npm run build && npm start
```

The `Dockerfile` builds the app and runs `migrate` then `start`; point it at a
database with the `DB_*` variables (or `DATABASE_URL`).

---

## Environment variables

| Variable       | Default                                                     | Notes                                   |
|----------------|------------------------------------------------------------|-----------------------------------------|
| `PORT`         | `4000`                                                      | HTTP port                               |
| `DB_HOST`      | `localhost`                                                 | MySQL server                            |
| `DB_PORT`      | `3306`                                                      |                                         |
| `DB_USER`      | `stockroom`                                                 |                                         |
| `DB_PASSWORD`  | (empty)                                                     | any characters, no encoding needed      |
| `DB_NAME`      | `stockroom`                                                 | database name                           |
| `DATABASE_URL` | —                                                           | optional `mysql://user:pass@host:port/db`; **overrides** the `DB_*` values |
| `TEST_DB_NAME` | —                                                           | throwaway database for `npm test`       |
| `DB_POOL_MAX`  | `10`                                                        | max pooled connections                  |
| `CORS_ORIGIN`  | `*`                                                         | comma-separated origins, or `*` for dev |
| `JWT_SECRET`   | — (**required**)                                            | 32+ random chars; signs login tokens. Changing it signs everyone out |
| `JWT_EXPIRES_IN` | `8h`                                                      | login lifetime (`30m`, `8h`, `1d`, …)   |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | —                                      | first admin, created at startup **only if no active admin exists** |
| `ADMIN_FULL_NAME` | `Administrator`                                          | display name for that admin             |
| `NODE_ENV`     | `development`                                               | `production` hides error internals      |

---

## How internal serials are generated (the important part)

Format: `PREFIX-PRODUCTCODE-NNNNN` — e.g. `ACM-VLD1030-00001`.

- **PREFIX** — the product's own `serial_prefix`, falling back to the global
  one in settings; omitted entirely if both are blank.
- **PRODUCTCODE** — derived from the SKU (uppercased, non-alphanumerics
  stripped).
- **NNNNN** — a per-product counter, zero-padded to 5 digits.

Each product carries its counter in `products.next_seq`. The prototype advanced
that counter with last-writer-wins, which can hand two simultaneous intakes the
same number. Here, intake runs in **one transaction that locks the product row**:

```sql
START TRANSACTION;
  SELECT next_seq FROM products WHERE id = ? FOR UPDATE;  -- row lock
  -- generate N serials from next_seq … next_seq + N - 1, bulk INSERT the units
  UPDATE products SET next_seq = next_seq + N WHERE id = ?;
COMMIT;
```

`FOR UPDATE` takes an exclusive InnoDB row lock, so a second intake on the
**same product** blocks until the first commits and then reads the updated
`next_seq` (a locking read always sees the latest committed row, even under
InnoDB's default REPEATABLE READ). Allocation is
therefore serialized per product — and two UNIQUE indexes,
`(product_id, seq)` and `internal_serial`, are the hard backstop. Intakes on
*different* products don't contend. See `src/modules/units/unit.service.ts`
(`intake`) and the proof in `test/intake.concurrency.test.ts`.

---

## Database schema

Three InnoDB tables (full DDL in `migrations/001_init.sql`). Text columns use
the case-insensitive `utf8mb4_0900_ai_ci` collation, so `=`, `LIKE` and UNIQUE
keys on SKUs and serials ignore case. UUIDs are `CHAR(36)`, generated by the app
(`crypto.randomUUID()`); timestamps are `DATETIME(3)` stored in UTC.

**`products`** — a product line.

| column            | type          | notes                                   |
|-------------------|---------------|-----------------------------------------|
| `id`              | char(36) PK   | UUID, generated by the app              |
| `name`            | varchar(200)  |                                         |
| `sku`             | varchar(64)   | unique (case-insensitive)               |
| `description`     | varchar(2000) |                                         |
| `warranty_months` | int           | default warranty applied to new units   |
| `serial_prefix`   | varchar null  | optional override of the global prefix  |
| `next_seq`        | int           | per-product serial counter (locked)     |
| `created_at`/`updated_at` | datetime(3) | UTC                               |

**`units`** — one physical unit; the heart of the system.

| column                | type         | notes                                         |
|-----------------------|--------------|-----------------------------------------------|
| `id`                  | char(36) PK  |                                               |
| `product_id`          | char(36) FK  | → products, `ON DELETE CASCADE`               |
| `seq`                 | int          | per-product sequence; **UNIQUE (product_id, seq)** |
| `internal_serial`     | varchar(128) | generated; **globally UNIQUE**                |
| `manufacturer_serial` | varchar null | supplier serial; **UNIQUE per product** when present (case-insensitive) |
| `status`              | enum         | `in_stock` / `sold` / `returned` / `defective` |
| `intake_date`         | date         |                                               |
| `warranty_start`      | date null    | defaults to intake date                       |
| `warranty_months`     | int          | snapshot from the product at intake           |
| `sold_to` / `sold_date` | varchar / date |                                           |
| `notes`               | varchar(2000) |                                              |
| `created_at`/`updated_at` | datetime(3) | UTC                                       |

Indexed on `product_id`, `status`, `internal_serial` and `manufacturer_serial`;
the case-insensitive collation makes those indexes serve case-insensitive
lookups directly.

**`settings`** — a single pinned row (`id = 1`): `company_name`,
`serial_prefix`, `default_warranty_months`, `low_stock_threshold`.

Manufacturer-serial uniqueness is scoped to the product, not global, because two
different manufacturers can legitimately reuse the same serial string across
unrelated lines.

---

## Authentication

Every `/api` route except `GET /api/health` and `POST /api/auth/login` needs a
JWT: `Authorization: Bearer <token>`. There is **no public sign-up** — an admin
registers accounts.

- **First admin.** On startup, if no active admin exists, the server creates one
  from `ADMIN_USERNAME` / `ADMIN_PASSWORD`. After that those variables are
  ignored; change the password in the app (sidebar → *Password*).
- **Roles.** `user` can do all day-to-day stock work. `admin` can additionally
  manage users, change settings and delete products.
- **Passwords** are hashed with scrypt (Node built-in), min 8 characters.
- **Tokens** are HS256, expire after `JWT_EXPIRES_IN`, and carry the user's
  `token_version`. Each request re-checks the user in the database, so
  deactivating a user, changing their role, or changing/resetting a password
  signs them out **immediately**, not when the token expires.
- **Brute force.** 10 failed logins per IP + username in 15 minutes → `429`
  (in-memory; use a shared store if you run several instances).
- **Lock-out guard.** An admin can't demote, deactivate or delete themselves, and
  the last active admin can't be removed.

| Method | Path                     | Who    | Notes |
|--------|--------------------------|--------|-------|
| POST   | `/auth/login`            | public | `{ username, password }` → `{ token, expiresAt, user }` |
| GET    | `/auth/me`               | any    | the signed-in user |
| POST   | `/auth/change-password`  | any    | `{ currentPassword, newPassword }` → new `{ token, … }` (old tokens revoked) |
| POST   | `/auth/register`         | admin  | `{ username, password, fullName?, role? }` → user |
| GET    | `/users`                 | admin  | all accounts |
| PATCH  | `/users/:id`             | admin  | `{ fullName?, role?, isActive?, password? }` (password = reset) |
| DELETE | `/users/:id`             | admin  | |

Also admin-only: `PUT /settings`, `DELETE /products/:id`. Errors: `401` not
signed in / session invalid, `403` signed in but not allowed.

---

## API reference

Base path `/api`. All bodies and responses are JSON. All routes below require
a signed-in user (see [Authentication](#authentication)). Errors are
`{ "error": { "code", "message", "details?" } }` with an appropriate status
(`400` validation, `404` not found, `409` conflict).

### Products
| Method | Path                      | Body / notes |
|--------|---------------------------|--------------|
| GET    | `/products`               | list with `inStock` / `totalUnits` counts |
| POST   | `/products`               | `{ name, sku, warrantyMonths?, serialPrefix?, description? }` |
| GET    | `/products/:id`           | product + counts |
| GET    | `/products/:id/units`     | all units of the product |
| PATCH  | `/products/:id`           | any subset of the create fields |
| DELETE | `/products/:id`           | cascades to its units |

### Units
| Method | Path                  | Body / notes |
|--------|-----------------------|--------------|
| GET    | `/units`              | query: `q`, `productId`, `status`, `sort` (`newest`\|`oldest`\|`serial`), `limit`, `offset` → `{ items, total, limit, offset }` |
| POST   | `/units/intake`       | `{ productId, manufacturerSerials[] }` **or** `{ productId, quantity }`, plus `intakeDate?`, `notes?` → `{ created, units[] }` |
| GET    | `/units/:id`          | single unit (with product name/SKU) |
| PATCH  | `/units/:id`          | `{ status?, manufacturerSerial?, soldTo?, soldDate?, warrantyStart?, warrantyMonths?, notes? }` |
| GET    | `/units/export.csv`   | same filters as list → CSV download |

Intake takes **either** a `manufacturerSerials` array (one unit per serial) or a
`quantity` (units with no supplier serial yet) — not both. Duplicate supplier
serials, in the batch or already stored for that product, return `409`.

### Warranty
| Method | Path                       | Notes |
|--------|----------------------------|-------|
| GET    | `/warranty?serial=...`     | matches **either** serial, case-insensitively. `200` → `{ found: true, matchedBy, unit, warranty }`; `404` → `{ found: false, suggestions[] }` |

`warranty` = `{ start, end, months, daysRemaining, expired, percentElapsed }`.

### Settings & stats
| Method | Path         | Notes |
|--------|--------------|-------|
| GET    | `/settings`  | current config |
| PUT    | `/settings`  | any subset of `{ companyName, serialPrefix, defaultWarrantyMonths, lowStockThreshold }` |
| GET    | `/stats`     | `{ totals, lowStockThreshold, lowStock[] }` for the dashboard |

---

## The reference frontend

`public/` is a dependency-free single-page client (same design language as the
prototype) served by the API itself. It exercises every endpoint: dashboard,
products (create/edit/delete), intake with a **live serial-mapping preview**,
inventory (search / filter / pagination / inline status change / CSV), warranty
lookup, and settings (including *Load sample data* and a *Delete all data*
danger zone). It's a working client and a usage example — swap in React/Vue
against the same API whenever you like.

---

## Testing

```bash
mysql -u root -p -e "CREATE DATABASE stockroom_test; GRANT ALL ON stockroom_test.* TO 'stockroom'@'localhost';"
# then in .env:  TEST_DB_NAME=stockroom_test
npm test
```

`test/intake.concurrency.test.ts` fires 8 intakes at one product in parallel and
asserts the serials are unique and contiguous (`1..200`) and the counter lands
exactly at `201` — i.e. the row lock holds. It **deletes all rows**, so it only
runs when `TEST_DB_NAME` is set, and never against your normal database.

---

## Taking it further

This is a focused core, not a full ERP. Natural next additions:

- **Multi-tenant** — a `tenant_id` on every table.
- **Audit trail** — a `unit_events` table logging each status change.
- **Rate limiting & request logging** — e.g. `express-rate-limit`, `pino-http`.
- **OpenAPI** — generate a spec from the Zod schemas.
- **Idempotency keys** on intake, if you ever retry over flaky networks.

Note on dates: `intake_date` defaults to the server's UTC date; pass
`intakeDate` explicitly if you need a specific local date.
