"use strict";
/* Stockroom reference client — vanilla JS, talks to the REST API at /api.
   No framework: a tiny hash router + fetch helper + per-view render functions. */

// ----------------------------------------------------------------------- auth
// The JWT lives in localStorage so a refresh keeps you signed in. Storage can
// be unavailable (private mode, blocked site data), so every access is guarded.
const TOKEN_KEY = "stockroom.token";
function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage blocked: session lasts until reload */ }
  memToken = token || null;
}
let memToken = getToken();

const isAdmin = () => state.user?.role === "admin";

// ---------------------------------------------------------------- API + utils
function authHeaders() {
  return memToken ? { Authorization: "Bearer " + memToken } : {};
}

async function api(path, opts = {}) {
  const res = await fetch("/api" + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...opts.headers },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data && data.error ? data.error.message : res.statusText;
    // Expired / revoked session anywhere except the login call itself.
    if (res.status === 401 && path !== "/auth/login") signedOut(msg);
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** Fetch an authenticated file as a blob plus its server-given filename. */
async function fetchFile(path, fallbackName) {
  const res = await fetch("/api" + path, { headers: authHeaders() });
  if (!res.ok) {
    if (res.status === 401) signedOut();
    throw new Error("Download failed (" + res.status + ")");
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const name = (/filename="([^"]+)"/.exec(cd) || [])[1] || fallbackName;
  return { blob, name };
}

/** Download an authenticated file (a plain <a href> can't send the JWT). */
async function download(path, fallbackName) {
  const { blob, name } = await fetchFile(path, fallbackName);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );

const STATUSES = [
  { v: "in_stock", label: "In stock" },
  { v: "sold", label: "Sold" },
  { v: "returned", label: "Returned" },
  { v: "defective", label: "Defective" },
];
const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.v, s.label]));
const STATUS_COLOR = {
  in_stock: "#0F8A4F",
  sold: "#5B6674",
  returned: "#B45309",
  defective: "#DC2626",
};

function statusChip(s) {
  return `<span class="chip ${s}">${esc(STATUS_LABEL[s] || s)}</span>`;
}

function serialPair(internal, manufacturer) {
  const right = manufacturer
    ? `<span class="seg">${esc(manufacturer)}</span>`
    : `<span class="seg empty">no supplier serial</span>`;
  return `<span class="pair"><span class="seg int">${esc(internal)}</span>
          <span class="arrow">←</span>${right}</span>`;
}

// Mirror of the server's serial helpers, for the live intake preview.
function productCode(sku, name) {
  const b = (sku || name || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return b || "ITEM";
}
function formatSerial(prefix, code, seq) {
  const n = String(seq).padStart(5, "0");
  return [String(prefix || "").trim(), code, n].filter((s) => s.length).join("-");
}

// Mirror of the server's warranty computation, for unit detail display.
function computeWarranty(warrantyStart, intakeDate, months) {
  const startStr = warrantyStart || intakeDate;
  const start = new Date(startStr + "T00:00:00Z");
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + months);
  const today = new Date();
  const DAY = 86400000;
  const daysRemaining = Math.ceil((end - today) / DAY);
  const total = end - start;
  const elapsed = Math.min(Math.max(today - start, 0), Math.max(total, 0));
  const pct = total > 0 ? Math.round((elapsed / total) * 100) : 100;
  return {
    start: startStr,
    end: end.toISOString().slice(0, 10),
    months,
    daysRemaining,
    expired: daysRemaining <= 0,
    percentElapsed: pct,
  };
}

function toast(msg, kind = "") {
  const wrap = $("#toast");
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity .25s";
    setTimeout(() => el.remove(), 250);
  }, 3200);
}

function openModal({ title, body, footer, onMount, wide }) {
  const root = $("#modal-root");
  root.innerHTML = `
    <div class="overlay">
      <div class="modal${wide ? " wide" : ""}" role="dialog" aria-modal="true">
        <div class="modal-h"><h3>${esc(title)}</h3>
          <button class="btn ghost sm" data-x>✕</button></div>
        <div class="modal-b">${body}</div>
        ${footer ? `<div class="modal-f">${footer}</div>` : ""}
      </div>
    </div>`;
  const overlay = $(".overlay", root);
  const close = () => (root.innerHTML = "");
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  root.querySelector("[data-x]").addEventListener("click", close);
  document.addEventListener(
    "keydown",
    function onKey(e) {
      if (e.key === "Escape") {
        close();
        document.removeEventListener("keydown", onKey);
      }
    },
  );
  if (onMount) onMount(root, close);
  return close;
}

function setHeader(title, sub, actionsHtml, bind) {
  $("#pageTitle").textContent = title;
  $("#pageSub").textContent = sub || "";
  const a = $("#pageActions");
  a.innerHTML = actionsHtml || "";
  if (bind) bind(a);
  document
    .querySelectorAll("#nav a")
    .forEach((x) =>
      x.classList.toggle("active", x.dataset.route === currentRoute),
    );
}

function emptyState(icon, text, actionHtml) {
  return `<div class="empty"><div class="big">${icon}</div><div>${esc(text)}</div>
          ${actionHtml ? `<div style="margin-top:14px">${actionHtml}</div>` : ""}</div>`;
}

// --------------------------------------------------------------- shared state
// products: the top-level groups; modules: the stocked items, each in a product.
const state = { settings: null, products: null, modules: null, user: null };

async function loadSettings(force) {
  if (!state.settings || force) state.settings = await api("/settings");
  $("#foot-company").textContent = state.settings.companyName || "Stockroom";
  return state.settings;
}
async function loadProducts(force) {
  if (!state.products || force) state.products = await api("/products");
  return state.products;
}
/** All modules, sorted by product name then module name. */
async function loadModules(force) {
  if (!state.modules || force) state.modules = await api("/modules");
  return state.modules;
}
/** Stock counts changed: drop the cached lists so they're refetched. */
function stockChanged() {
  state.products = null;
  state.modules = null;
}

/** A Product + Module select pair (ids `${prefix}-product` / `${prefix}-module`). */
function modulePickerHtml(prefix) {
  return `<div class="row">
      <label class="field"><span class="lab">Product</span>
        <select id="${prefix}-product"></select></label>
      <label class="field"><span class="lab">Module</span>
        <select id="${prefix}-module"></select></label>
    </div>`;
}

/**
 * Fill and wire a picker made by modulePickerHtml from `modules`. Changing the
 * product refills the module list. Returns a getter for the selected module.
 */
function bindModulePicker(root, prefix, modules, selectedId, onChange) {
  const pSel = $(`#${prefix}-product`, root);
  const mSel = $(`#${prefix}-module`, root);
  const products = [...new Map(modules.map((m) => [m.productId, m.productName]))];
  const start = modules.find((m) => m.id === selectedId) || modules[0];
  pSel.innerHTML = products
    .map(
      ([id, name]) =>
        `<option value="${id}" ${id === start.productId ? "selected" : ""}>${esc(name)}</option>`,
    )
    .join("");
  const fillModules = (keepId) => {
    mSel.innerHTML = modules
      .filter((m) => m.productId === pSel.value)
      .map(
        (m) =>
          `<option value="${m.id}" ${m.id === keepId ? "selected" : ""}>${esc(m.name)} — ${esc(m.sku)} (${m.inStock} in stock)</option>`,
      )
      .join("");
  };
  fillModules(start.id);
  pSel.addEventListener("change", () => {
    fillModules();
    onChange();
  });
  mSel.addEventListener("change", onChange);
  return () => modules.find((m) => m.id === mSel.value);
}

/** Product + module filter selects for list pages; the module list follows the product. */
function stockFilterHtml(prefix, products, modules, productId, moduleId) {
  const mods = productId ? modules.filter((m) => m.productId === productId) : modules;
  return `
      <select id="${prefix}-product" style="width:auto">
        <option value="">All products</option>
        ${products
          .map((p) => `<option value="${p.id}" ${p.id === productId ? "selected" : ""}>${esc(p.name)}</option>`)
          .join("")}
      </select>
      <select id="${prefix}-module" style="width:auto">
        <option value="">All modules</option>
        ${mods
          .map(
            (m) =>
              `<option value="${m.id}" ${m.id === moduleId ? "selected" : ""}>${esc(productId ? m.name : `${m.productName} · ${m.name}`)}</option>`,
          )
          .join("")}
      </select>`;
}

/** Product name over "module · SKU", for table cells. */
function moduleCell(x) {
  return `<b>${esc(x.productName)}</b>
    <div class="muted" style="font-size:12px">${esc(x.moduleName)} · <span class="mono">${esc(x.sku)}</span></div>`;
}

// -------------------------------------------------------------------- routing
let currentRoute = "dashboard";
const routes = {};
const ADMIN_ROUTES = new Set(["users", "settings"]);

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "") || "dashboard";
  const [path, query] = raw.split("?");
  const params = Object.fromEntries(new URLSearchParams(query || ""));
  return { path: path || "dashboard", params };
}

async function render() {
  if (!state.user) return;
  const { path, params } = parseHash();
  currentRoute = routes[path] && (!ADMIN_ROUTES.has(path) || isAdmin()) ? path : "dashboard";
  const view = $("#view");
  view.innerHTML = `<div class="muted" style="padding:20px">Loading…</div>`;
  try {
    await routes[currentRoute](view, params);
  } catch (err) {
    view.innerHTML = `<div class="banner err">${esc(err.message || "Failed to load")}</div>`;
  }
  $("#sidebar").classList.remove("open");
  $("#scrim").classList.remove("on");
}

function go(route) {
  location.hash = "#/" + route;
}

// ------------------------------------------------------------------ dashboard
routes.dashboard = async (view) => {
  const [stats, recent] = await Promise.all([
    api("/stats"),
    api("/units?limit=6&sort=newest"),
  ]);
  const t = stats.totals;
  const seg = (n, color) =>
    t.units > 0 && n > 0
      ? `<span style="width:${(n / t.units) * 100}%;background:${color}"></span>`
      : "";

  setHeader("Dashboard", `${esc(state.settings?.companyName || "")}`, "");

  const kpis = [
    ["Products", t.products, false],
    ["Modules", t.modules, false],
    ["Total units", t.units, false],
    ["In stock", t.inStock, false],
    ["Sold", t.sold, false],
  ]
    .map(
      ([l, v]) =>
        `<div class="card kpi"><div class="label">${l}</div><div class="value">${v}</div></div>`,
    )
    .join("");

  const low = stats.lowStock.filter((m) => m.inStock <= stats.lowStockThreshold);

  view.innerHTML = `
    <div class="cards">${kpis}</div>

    <div class="panel"><div class="panel-h"><h2>Stock distribution</h2></div>
      <div class="panel-b">
        ${
          t.units > 0
            ? `<div class="stackbar">
                 ${seg(t.inStock, STATUS_COLOR.in_stock)}
                 ${seg(t.sold, STATUS_COLOR.sold)}
                 ${seg(t.returned, STATUS_COLOR.returned)}
                 ${seg(t.defective, STATUS_COLOR.defective)}
               </div>
               <div class="legend">
                 <span><i style="background:${STATUS_COLOR.in_stock}"></i>In stock ${t.inStock}</span>
                 <span><i style="background:${STATUS_COLOR.sold}"></i>Sold ${t.sold}</span>
                 <span><i style="background:${STATUS_COLOR.returned}"></i>Returned ${t.returned}</span>
                 <span><i style="background:${STATUS_COLOR.defective}"></i>Defective ${t.defective}</span>
               </div>`
            : `<div class="muted">No units yet. Add a product and its modules, then add stock.</div>`
        }
      </div>
    </div>

    <div class="row" style="align-items:start">
      <div class="panel"><div class="panel-h"><h2>Low / out of stock</h2>
        <span class="muted" style="font-size:12px">threshold ≤ ${stats.lowStockThreshold}</span></div>
        <div class="panel-b flush">
          ${
            low.length
              ? `<table><tbody>${low
                  .map(
                    (m) =>
                      `<tr><td>${moduleCell({ productName: m.productName, moduleName: m.name, sku: m.sku })}</td>
                       <td style="text-align:right"><span class="chip ${m.inStock === 0 ? "defective" : "returned"}">${m.inStock} in stock</span></td></tr>`,
                  )
                  .join("")}</tbody></table>`
              : `<div class="panel-b muted">Everything is above the threshold. 👍</div>`
          }
        </div>
      </div>

      <div class="panel"><div class="panel-h"><h2>Recent intake</h2>
        <a class="btn ghost sm" data-go="inventory">View all →</a></div>
        <div class="panel-b flush">
          ${
            recent.items.length
              ? `<table><tbody>${recent.items
                  .map(
                    (u) =>
                      `<tr><td>${serialPair(u.internalSerial, u.manufacturerSerial)}</td>
                       <td style="text-align:right" class="muted">${esc(u.productName)} · ${esc(u.moduleName)}</td></tr>`,
                  )
                  .join("")}</tbody></table>`
              : `<div class="panel-b muted">Nothing yet.</div>`
          }
        </div>
      </div>
    </div>`;

  view.querySelectorAll("[data-go]").forEach((b) =>
    b.addEventListener("click", () => go(b.dataset.go)),
  );
};

// ------------------------------------------------------------------- products
// A product groups several modules; stock is added to and given from modules.
routes.products = async (view) => {
  const [products, modules] = await Promise.all([loadProducts(true), loadModules(true)]);
  setHeader(
    "Products",
    `${products.length} product${products.length === 1 ? "" : "s"} · ${modules.length} module${modules.length === 1 ? "" : "s"}`,
    `<button class="btn primary" data-new>＋ New product</button>`,
    (a) => a.querySelector("[data-new]").addEventListener("click", () => productModal()),
  );

  if (!products.length) {
    view.innerHTML = emptyState(
      "▤",
      "No products yet. Create a product, then add its modules to start tracking units.",
      `<button class="btn primary" id="np">＋ New product</button>`,
    );
    $("#np", view).addEventListener("click", () => productModal());
    return;
  }

  view.innerHTML = products
    .map((p) => {
      const mods = modules.filter((m) => m.productId === p.id);
      return `
    <div class="panel">
      <div class="panel-h">
        <div style="min-width:0">
          <h2>${esc(p.name)}</h2>
          <div class="muted" style="font-size:12px;margin-top:2px">
            ${p.description ? esc(p.description) + " · " : ""}${p.moduleCount} module${p.moduleCount === 1 ? "" : "s"} · ${p.inStock} in stock of ${p.totalUnits}</div>
        </div>
        <div style="white-space:nowrap">
          <button class="btn sm primary" data-new-module="${p.id}">＋ Module</button>
          ${p.totalUnits ? `<button class="btn sm" data-product-units="${p.id}">Units</button>` : ""}
          <button class="btn sm ghost" data-edit-product="${p.id}">Edit</button>
        </div>
      </div>
      <div class="panel-b flush">
      ${
        mods.length
          ? `<table>
        <thead><tr><th>Module</th><th>SKU</th><th>In stock</th><th>Total</th><th>Warranty</th><th></th></tr></thead>
        <tbody>
          ${mods
            .map(
              (m) => `
          <tr>
            <td><b>${esc(m.name)}</b>${m.description ? `<div class="muted" style="font-size:12px">${esc(m.description)}</div>` : ""}</td>
            <td class="mono">${esc(m.sku)}</td>
            <td><b>${m.inStock}</b></td>
            <td class="muted">${m.totalUnits}</td>
            <td class="muted">${m.warrantyMonths} mo</td>
            <td style="text-align:right;white-space:nowrap">
              <button class="btn sm primary" data-add="${m.id}">Add stock</button>
              <button class="btn sm" data-view="${m.id}">Units</button>
              <button class="btn sm ghost" data-edit-module="${m.id}">Edit</button>
            </td>
          </tr>`,
            )
            .join("")}
        </tbody></table>`
          : `<div class="panel-b muted">No modules yet. Add one to start adding stock to this product.</div>`
      }
      </div>
    </div>`;
    })
    .join("");

  const on = (attr, fn) =>
    view.querySelectorAll(`[${attr}]`).forEach((b) =>
      b.addEventListener("click", () => fn(b.getAttribute(attr))),
    );
  on("data-add", (id) => go("intake?moduleId=" + id));
  on("data-view", (id) => go("inventory?moduleId=" + id));
  on("data-product-units", (id) => go("inventory?productId=" + id));
  on("data-new-module", (id) => moduleModal(null, id));
  on("data-edit-module", (id) => moduleModal(modules.find((m) => m.id === id)));
  on("data-edit-product", (id) => productModal(products.find((p) => p.id === id)));
};

function productModal(product) {
  const editing = !!product;
  openModal({
    title: editing ? "Edit product" : "New product",
    body: `
      <label class="field"><span class="lab">Product name</span>
        <input id="p-name" maxlength="200" value="${esc(product?.name || "")}" placeholder="e.g. RFID Reader Kit"></label>
      <label class="field"><span class="lab">Description <span class="muted">(optional)</span></span>
        <input id="p-desc" maxlength="2000" value="${esc(product?.description || "")}"></label>
      ${editing ? "" : `<div class="hint">Next, add the modules that make up this product. Stock is added to each module.</div>`}
      <div class="hint" id="p-err" style="color:var(--err-ink)"></div>`,
    footer: `${editing && isAdmin() ? `<button class="btn danger" data-del style="margin-right:auto">Delete</button>` : ""}
             <button class="btn" data-cancel>Cancel</button>
             <button class="btn primary" data-save>${editing ? "Save" : "Create"}</button>`,
    onMount: (root, close) => {
      const errEl = $("#p-err", root);
      $("[data-cancel]", root).addEventListener("click", close);
      $("[data-save]", root).addEventListener("click", async () => {
        const body = {
          name: $("#p-name", root).value.trim(),
          description: $("#p-desc", root).value.trim(),
        };
        if (!body.name) {
          errEl.textContent = "Product name is required.";
          return;
        }
        try {
          if (editing) {
            await api("/products/" + product.id, { method: "PATCH", body: JSON.stringify(body) });
            toast("Product updated", "ok");
          } else {
            await api("/products", { method: "POST", body: JSON.stringify(body) });
            toast("Product created", "ok");
          }
          close();
          stockChanged();
          render();
        } catch (e) {
          errEl.textContent = e.message;
        }
      });
      const del = $("[data-del]", root);
      if (del)
        del.addEventListener("click", async () => {
          if (!confirm(`Delete product "${product.name}"?`)) return;
          try {
            await api("/products/" + product.id, { method: "DELETE" });
            toast("Product deleted", "ok");
            close();
            stockChanged();
            render();
          } catch (e) {
            errEl.textContent = e.message;
          }
        });
      $("#p-name", root).focus();
    },
  });
}

/** Create a module in `productId` (no `mod`), or edit `mod` — which can move it to another product. */
function moduleModal(mod, productId) {
  const editing = !!mod;
  const products = state.products || [];
  const currentProductId = mod?.productId || productId;
  openModal({
    title: editing ? "Edit module" : "New module",
    body: `
      <label class="field"><span class="lab">Product</span>
        <select id="m-product">
          ${products
            .map(
              (p) =>
                `<option value="${p.id}" ${p.id === currentProductId ? "selected" : ""}>${esc(p.name)}</option>`,
            )
            .join("")}
        </select></label>
      <label class="field"><span class="lab">Module name</span>
        <input id="m-name" maxlength="200" value="${esc(mod?.name || "")}" placeholder="e.g. VLD1030 module"></label>
      <div class="row">
        <label class="field"><span class="lab">SKU</span>
          <input id="m-sku" class="mono" maxlength="64" value="${esc(mod?.sku || "")}" placeholder="VLD1030"></label>
        <label class="field"><span class="lab">Warranty (months)</span>
          <input id="m-war" type="number" min="0" value="${mod?.warrantyMonths ?? state.settings?.defaultWarrantyMonths ?? 12}"></label>
      </div>
      <label class="field"><span class="lab">Serial prefix override <span class="muted">(optional)</span></span>
        <input id="m-prefix" class="mono" value="${esc(mod?.serialPrefix || "")}" placeholder="leave blank to use global '${esc(state.settings?.serialPrefix || "")}'"></label>
      <label class="field"><span class="lab">Description <span class="muted">(optional)</span></span>
        <input id="m-desc" maxlength="2000" value="${esc(mod?.description || "")}"></label>
      <div class="hint" id="m-err" style="color:var(--err-ink)"></div>`,
    footer: `${editing && isAdmin() ? `<button class="btn danger" data-del style="margin-right:auto">Delete</button>` : ""}
             <button class="btn" data-cancel>Cancel</button>
             <button class="btn primary" data-save>${editing ? "Save" : "Create"}</button>`,
    onMount: (root, close) => {
      const errEl = $("#m-err", root);
      const payload = () => ({
        productId: $("#m-product", root).value,
        name: $("#m-name", root).value.trim(),
        sku: $("#m-sku", root).value.trim(),
        warrantyMonths: Number($("#m-war", root).value),
        serialPrefix: $("#m-prefix", root).value.trim() || null,
        description: $("#m-desc", root).value.trim(),
      });
      $("[data-cancel]", root).addEventListener("click", close);
      $("[data-save]", root).addEventListener("click", async () => {
        const body = payload();
        if (!body.name || !body.sku) {
          errEl.textContent = "Module name and SKU are required.";
          return;
        }
        try {
          if (editing) {
            await api("/modules/" + mod.id, { method: "PATCH", body: JSON.stringify(body) });
            toast("Module updated", "ok");
          } else {
            await api("/modules", { method: "POST", body: JSON.stringify(body) });
            toast("Module created", "ok");
          }
          close();
          stockChanged();
          render();
        } catch (e) {
          errEl.textContent = e.message;
        }
      });
      const del = $("[data-del]", root);
      if (del)
        del.addEventListener("click", async () => {
          if (!confirm(`Delete module "${mod.name}" and ALL its units? This cannot be undone.`)) return;
          try {
            await api("/modules/" + mod.id, { method: "DELETE" });
            toast("Module deleted", "ok");
            close();
            stockChanged();
            render();
          } catch (e) {
            errEl.textContent = e.message;
          }
        });
      $("#m-name", root).focus();
    },
  });
}

// --------------------------------------------------------------------- intake
routes.intake = async (view, params) => {
  const [modules] = await Promise.all([loadModules(true), loadSettings()]);
  setHeader("Add stock", "Create units and map serials", "");

  if (!modules.length) {
    view.innerHTML = emptyState(
      "＋",
      "You need a product with at least one module first. Create them on the Products page.",
      `<button class="btn primary" id="gp">Go to Products</button>`,
    );
    $("#gp", view).addEventListener("click", () => go("products"));
    return;
  }

  view.innerHTML = `
    <div class="panel"><div class="panel-b">
      ${modulePickerHtml("i")}

      <div class="field">
        <span class="lab">Intake mode</span>
        <div class="seg-toggle" id="i-mode">
          <button type="button" data-mode="serials" class="on">With supplier serials</button>
          <button type="button" data-mode="qty">Quantity only</button>
        </div>
      </div>

      <div id="i-serials-wrap">
        <label class="field"><span class="lab">Supplier / manufacturer serials — one per line</span>
          <textarea id="i-serials" placeholder="SNA-1001&#10;SNA-1002&#10;SNA-1003"></textarea>
          <div class="hint">Each line becomes one unit, mapped to a generated internal serial.</div></label>
      </div>

      <div id="i-qty-wrap" style="display:none">
        <div class="row">
          <label class="field"><span class="lab">Quantity</span>
            <input id="i-qty" type="number" min="1" value="1"></label>
          <label class="field"><span class="lab">Intake date</span>
            <input id="i-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
        </div>
        <div class="hint">Type supplier serials in the preview below if you have them. Blank ones can be filled in later from Inventory → Details.</div>
      </div>

      <label class="field"><span class="lab">Notes <span class="muted">(optional, applied to all)</span></span>
        <input id="i-notes" placeholder="e.g. PO-2291, received from Acme"></label>

      <div class="panel" style="margin-top:4px"><div class="panel-h"><h2>Preview</h2>
        <span class="muted" id="i-count" style="font-size:12px"></span></div>
        <div class="panel-b" id="i-preview"></div></div>

      <div class="hint" id="i-err"></div>
      <button class="btn primary" id="i-submit">Add stock</button>
    </div></div>`;

  let mode = "serials";
  const serialsWrap = $("#i-serials-wrap", view);
  const qtyWrap = $("#i-qty-wrap", view);
  const prev = $("#i-preview", view);
  const countEl = $("#i-count", view);

  const currentModule = bindModulePicker(view, "i", modules, params.moduleId, () => {
    overrides = {}; // a different module means different generated serials
    updatePreview();
  });
  // Hand-edited internal serials, by row index. Unedited rows are generated.
  let overrides = {};
  // Supplier serials typed into the preview in quantity mode, by row index.
  const mfrInputs = {};
  const PREVIEW_MAX = 40;

  function updatePreview() {
    const p = currentModule();
    const prefix = p.serialPrefix || state.settings.serialPrefix || "";
    const code = productCode(p.sku, p.name);
    let items = [];
    if (mode === "serials") {
      const lines = $("#i-serials", view)
        .value.split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      items = lines.map((mfr, i) => ({
        mfr,
        internal: formatSerial(prefix, code, p.nextSeq + i),
      }));
    } else {
      const qty = Math.max(0, Number($("#i-qty", view).value) || 0);
      items = Array.from({ length: qty }, (_, i) => ({
        mfr: null,
        internal: formatSerial(prefix, code, p.nextSeq + i),
      }));
    }
    countEl.textContent = items.length
      ? `${items.length} unit${items.length === 1 ? "" : "s"} · next #${String(p.nextSeq).padStart(5, "0")}`
      : "";
    if (!items.length) {
      prev.innerHTML = `<div class="muted">Enter serials or a quantity to preview the mapping.</div>`;
      return;
    }
    const shown = items.slice(0, PREVIEW_MAX);
    prev.innerHTML =
      `<div class="hint" style="margin:0 0 6px">Internal serials are generated — click one to change it.${
        mode === "qty" ? " Type a supplier serial on the right, or leave it blank." : ""
      }</div>` +
      shown
        .map((it, i) => {
          const edited = overrides[i] !== undefined;
          const right =
            mode === "qty"
              ? `<input class="mfr-edit" data-i="${i}" maxlength="128"
                   placeholder="no supplier serial" value="${esc(mfrInputs[i] || "")}">`
              : `<span class="seg">${esc(it.mfr)}</span>`;
          return `<div class="preview-line"><span class="pair">
              <input class="int-edit${edited ? " edited" : ""}" data-i="${i}" maxlength="128"
                value="${esc(edited ? overrides[i] : it.internal)}" data-gen="${esc(it.internal)}">
              <span class="arrow">←</span>${right}</span></div>`;
        })
        .join("") +
      (items.length > shown.length
        ? `<div class="muted" style="margin-top:8px">+ ${items.length - shown.length} more (auto-generated)…</div>`
        : "");
  }

  // Editing a preview serial records an override without re-rendering, so
  // the input keeps focus. Typing the generated value back clears it.
  prev.addEventListener("input", (e) => {
    const mfr = e.target.closest("input.mfr-edit");
    if (mfr) {
      const v = mfr.value.trim();
      if (v) mfrInputs[mfr.dataset.i] = v;
      else delete mfrInputs[mfr.dataset.i];
      return;
    }
    const inp = e.target.closest("input.int-edit");
    if (!inp) return;
    const v = inp.value.trim();
    if (v && v !== inp.dataset.gen) overrides[inp.dataset.i] = v;
    else delete overrides[inp.dataset.i];
    inp.classList.toggle("edited", overrides[inp.dataset.i] !== undefined);
  });
  // Leaving a field blank restores the generated serial.
  prev.addEventListener("focusout", (e) => {
    const inp = e.target.closest("input.int-edit");
    if (inp && !inp.value.trim()) inp.value = inp.dataset.gen;
  });

  $("#i-mode", view)
    .querySelectorAll("button")
    .forEach((b) =>
      b.addEventListener("click", () => {
        mode = b.dataset.mode;
        $("#i-mode", view)
          .querySelectorAll("button")
          .forEach((x) => x.classList.toggle("on", x === b));
        serialsWrap.style.display = mode === "serials" ? "" : "none";
        qtyWrap.style.display = mode === "qty" ? "" : "none";
        updatePreview();
      }),
    );
  $("#i-serials", view).addEventListener("input", updatePreview);
  $("#i-qty", view).addEventListener("input", updatePreview);
  updatePreview();

  $("#i-submit", view).addEventListener("click", async () => {
    const errEl = $("#i-err", view);
    errEl.textContent = "";
    const m = currentModule();
    const body = { moduleId: m.id, notes: $("#i-notes", view).value.trim() };
    if (mode === "serials") {
      const lines = $("#i-serials", view)
        .value.split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!lines.length) {
        errEl.textContent = "Add at least one serial, or switch to quantity mode.";
        return;
      }
      body.manufacturerSerials = lines;
    } else {
      const qty = Number($("#i-qty", view).value);
      if (!qty || qty < 1) {
        errEl.textContent = "Quantity must be at least 1.";
        return;
      }
      body.quantity = qty;
      body.intakeDate = $("#i-date", view).value || undefined;
      const typed = Object.keys(mfrInputs).map(Number).filter((i) => i < qty);
      if (typed.length) {
        body.manufacturerSerials = Array.from({ length: Math.max(...typed) + 1 }, (_, i) =>
          mfrInputs[i] ?? null,
        );
      }
    }
    const count = body.quantity ?? body.manufacturerSerials.length;
    const edited = Object.keys(overrides).map(Number).filter((i) => i < count);
    if (edited.length) {
      body.internalSerials = Array.from({ length: Math.max(...edited) + 1 }, (_, i) =>
        overrides[i] ?? null,
      );
    }
    const btn = $("#i-submit", view);
    btn.disabled = true;
    btn.textContent = "Adding…";
    try {
      const r = await api("/units/intake", {
        method: "POST",
        body: JSON.stringify(body),
      });
      toast(`Added ${r.created} unit${r.created === 1 ? "" : "s"}`, "ok");
      stockChanged();
      go("inventory?moduleId=" + m.id);
    } catch (e) {
      errEl.textContent = e.message;
      btn.disabled = false;
      btn.textContent = "Add stock";
    }
  });
};

// ----------------------------------------------------------------- give stock
/** 'YYYY-MM-DD' plus whole months, the same way warranty end dates are computed. */
function addMonths(dateStr, months) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

routes.give = async (view, params) => {
  const modules = await loadModules(true);
  setHeader("Give stock", "Hand units to a customer against an invoice", "");

  const available = modules.filter((m) => m.inStock > 0);
  if (!available.length) {
    view.innerHTML = emptyState(
      "－",
      "Nothing is in stock right now. Add stock first.",
      `<button class="btn primary" id="ga">Go to Add stock</button>`,
    );
    $("#ga", view).addEventListener("click", () => go("intake"));
    return;
  }

  const today = new Date().toISOString().slice(0, 10);

  view.innerHTML = `
    <div class="panel"><div class="panel-h"><h2>Customer</h2></div><div class="panel-b">
      <label class="field"><span class="lab">Customer name</span>
        <input id="g-name" maxlength="200" placeholder="e.g. Sharma Electronics"></label>
      <div class="row">
        <label class="field"><span class="lab">Customer phone</span>
          <input id="g-phone" type="tel" maxlength="20" placeholder="e.g. 9876543210"></label>
        <label class="field"><span class="lab">GST no <span class="muted">(optional)</span></span>
          <input id="g-gst" class="mono" maxlength="15" placeholder="e.g. 27AAPFU0939F1ZV"
            style="text-transform:uppercase"></label>
      </div>
    </div></div>

    <div class="panel"><div class="panel-h"><h2>Invoice</h2></div><div class="panel-b">
      <div class="row">
        <label class="field"><span class="lab">Invoice no</span>
          <input id="g-inv" class="mono" maxlength="64" placeholder="e.g. INV-2026-0142"></label>
        <label class="field"><span class="lab">Given date</span>
          <input id="g-date" type="date" value="${today}"></label>
      </div>
      <div class="row">
        <label class="field"><span class="lab">Validity date</span>
          <input id="g-valid" type="date">
          <div class="hint" id="g-valid-hint"></div></label>
        <label class="field"><span class="lab">Notes <span class="muted">(optional)</span></span>
          <input id="g-notes" maxlength="2000"></label>
      </div>
    </div></div>

    <div class="panel"><div class="panel-h"><h2>Products</h2>
      <span class="muted" id="g-summary" style="font-size:12.5px"></span></div>
      <div class="panel-b">
        <div class="give-lines" id="g-lines"></div>
        <button class="btn" id="g-add">＋ Add another product</button>
      </div>
    </div>

    <div class="banner err" id="g-err" hidden></div>
    <button class="btn primary" id="g-submit">Give stock</button>`;

  // The validity date follows given date + the longest warranty among the
  // chosen modules, until edited by hand.
  let validEdited = false;
  const lines = [];
  let lineSeq = 0;
  const linesEl = $("#g-lines", view);

  function syncValidity() {
    const months = Math.max(...lines.map((l) => l.module().warrantyMonths));
    const given = $("#g-date", view).value || today;
    if (!validEdited) $("#g-valid", view).value = addMonths(given, months);
    $("#g-valid-hint", view).textContent = validEdited
      ? "Set by hand. Applies to every product below."
      : `Given date + ${months} months warranty${lines.length > 1 ? " (the longest of these modules)" : ""}. You can change it.`;
  }

  function syncSummary() {
    const units = lines.reduce((n, l) => n + l.count(), 0);
    $("#g-summary", view).textContent =
      `${lines.length} product${lines.length === 1 ? "" : "s"} · ${units} unit${units === 1 ? "" : "s"}`;
    // A hand-over always has at least one line.
    lines.forEach((l) => (l.removeBtn.hidden = lines.length === 1));
  }

  const changed = () => {
    syncValidity();
    syncSummary();
  };

  function addLine(moduleId) {
    // Default a new line to a module no other line is using yet.
    const used = new Set(lines.map((l) => l.module().id));
    const start = moduleId || (available.find((m) => !used.has(m.id)) || available[0]).id;
    const line = giveLine(++lineSeq, available, start, changed, () => {
      lines.splice(lines.indexOf(line), 1);
      line.el.remove();
      changed();
    });
    lines.push(line);
    linesEl.appendChild(line.el);
    changed();
  }

  $("#g-add", view).addEventListener("click", () => addLine());
  $("#g-date", view).addEventListener("input", syncValidity);
  $("#g-valid", view).addEventListener("input", (e) => {
    validEdited = !!e.target.value;
    syncValidity();
  });

  addLine(params.moduleId);

  $("#g-submit", view).addEventListener("click", async () => {
    const errEl = $("#g-err", view);
    const fail = (m) => {
      errEl.textContent = m;
      errEl.hidden = !m;
    };
    fail("");
    const body = {
      customerName: $("#g-name", view).value.trim(),
      customerPhone: $("#g-phone", view).value.trim(),
      gstNo: $("#g-gst", view).value.trim().toUpperCase() || null,
      invoiceNo: $("#g-inv", view).value.trim(),
      givenDate: $("#g-date", view).value,
      validUntil: $("#g-valid", view).value || null,
      notes: $("#g-notes", view).value.trim(),
      items: [],
    };
    if (!body.customerName) return fail("Enter the customer name.");
    if (!body.customerPhone) return fail("Enter the customer phone.");
    if (!body.invoiceNo) return fail("Enter the invoice number.");
    if (!body.givenDate) return fail("Enter the given date.");
    const seen = new Set();
    for (const [i, line] of lines.entries()) {
      const m = line.module();
      if (seen.has(m.id)) {
        return fail(`${m.productName} · ${m.name} is added twice. Remove one line, or give all of it on one line.`);
      }
      seen.add(m.id);
      const item = line.item();
      if (typeof item === "string") return fail(`Product ${i + 1} (${m.name}): ${item}`);
      body.items.push(item);
    }

    const btn = $("#g-submit", view);
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const d = await api("/dispatches", { method: "POST", body: JSON.stringify(body) });
      toast(
        `Gave ${d.quantity} unit${d.quantity === 1 ? "" : "s"}` +
          (d.items.length > 1 ? ` of ${d.items.length} products` : "") +
          ` to ${d.customerName}`,
        "ok",
      );
      stockChanged();
      go("dispatches?id=" + d.id);
    } catch (e) {
      fail(validationMessage(e));
      btn.disabled = false;
      btn.textContent = "Give stock";
    }
  });
};

/**
 * One product line on the Give stock page: a product -> module picker, then
 * either picked serials or a quantity. `item()` returns the API item, or an
 * error message string.
 */
function giveLine(n, available, moduleId, onChange, onRemove) {
  const prefix = "gl" + n;
  const el = document.createElement("div");
  el.className = "give-line";
  el.innerHTML = `
    <div class="give-line-h"><b class="n">Product</b>
      <button type="button" class="btn sm ghost" data-remove>✕ Remove</button></div>
    ${modulePickerHtml(prefix)}
    <div class="field">
      <span class="lab">Stock</span>
      <div class="seg-toggle" data-modes>
        <button type="button" data-mode="pick" class="on">Pick serials</button>
        <button type="button" data-mode="qty">Quantity (oldest first)</button>
      </div>
    </div>
    <div data-pick-wrap>
      <div class="toolbar" style="margin:4px 0 8px">
        <div class="grow search"><span class="ic">⌕</span>
          <input data-search placeholder="Filter by serial…"></div>
        <span class="muted" data-count style="font-size:12.5px"></span>
      </div>
      <div class="pick-list" data-list></div>
    </div>
    <div data-qty-wrap hidden>
      <label class="field" style="max-width:220px;margin-bottom:4px"><span class="lab">Quantity</span>
        <input data-qty type="number" min="1" value="1"></label>
      <div class="hint" data-qty-hint></div>
    </div>`;

  let mode = "pick";
  let units = []; // in-stock units of the selected module
  const picked = new Set();
  const list = $("[data-list]", el);
  const qtyInput = $("[data-qty]", el);
  const removeBtn = $("[data-remove]", el);

  const module = bindModulePicker(el, prefix, available, moduleId, () => {
    loadUnits().catch((e) => toast(e.message, "err"));
    onChange();
  });

  const countText = () => `${picked.size} of ${units.length} selected`;

  function renderList() {
    const needle = $("[data-search]", el).value.trim().toLowerCase();
    const shown = units.filter(
      (u) =>
        !needle ||
        u.internalSerial.toLowerCase().includes(needle) ||
        (u.manufacturerSerial || "").toLowerCase().includes(needle),
    );
    $("[data-count]", el).textContent = countText();
    list.innerHTML = shown.length
      ? shown
          .map(
            (u) => `<label class="pick-row">
              <input type="checkbox" data-id="${u.id}" ${picked.has(u.id) ? "checked" : ""}>
              ${serialPair(u.internalSerial, u.manufacturerSerial)}
              <span class="d muted mono">in ${esc(u.intakeDate)}</span></label>`,
          )
          .join("")
      : `<div class="muted" style="padding:14px">${units.length ? "No serial matches that filter." : "No units in stock."}</div>`;
  }

  async function loadUnits() {
    picked.clear();
    list.innerHTML = `<div class="muted" style="padding:14px">Loading…</div>`;
    const m = module();
    const data = await api(`/units?moduleId=${m.id}&status=in_stock&sort=oldest&limit=500`);
    if (module().id !== m.id) return; // switched module while loading
    units = data.items;
    renderList();
    qtyInput.max = m.inStock;
    $("[data-qty-hint]", el).textContent = `${m.inStock} in stock. The oldest units go out first.`;
    onChange();
  }

  list.addEventListener("change", (e) => {
    const cb = e.target.closest("input[type=checkbox]");
    if (!cb) return;
    if (cb.checked) picked.add(cb.dataset.id);
    else picked.delete(cb.dataset.id);
    $("[data-count]", el).textContent = countText();
    onChange();
  });
  $("[data-search]", el).addEventListener("input", renderList);
  qtyInput.addEventListener("input", onChange);
  $("[data-modes]", el)
    .querySelectorAll("button")
    .forEach((b) =>
      b.addEventListener("click", () => {
        mode = b.dataset.mode;
        $("[data-modes]", el)
          .querySelectorAll("button")
          .forEach((x) => x.classList.toggle("on", x === b));
        $("[data-pick-wrap]", el).hidden = mode !== "pick";
        $("[data-qty-wrap]", el).hidden = mode !== "qty";
        onChange();
      }),
    );
  removeBtn.addEventListener("click", onRemove);

  loadUnits().catch((e) => toast(e.message, "err"));

  return {
    el,
    removeBtn,
    module,
    /** Units this line will give, for the running total. */
    count: () => (mode === "pick" ? picked.size : Math.max(0, Number(qtyInput.value) || 0)),
    item() {
      const m = module();
      if (mode === "pick") {
        if (!picked.size) return "select at least one unit to give.";
        return { moduleId: m.id, unitIds: [...picked] };
      }
      const qty = Number(qtyInput.value);
      if (!qty || qty < 1) return "quantity must be at least 1.";
      if (qty > m.inStock) return `only ${m.inStock} in stock.`;
      return { moduleId: m.id, quantity: qty };
    },
  };
}

// ---------------------------------------------------------------- stock given
routes.dispatches = async (view, params) => {
  const [products, modules] = await Promise.all([loadProducts(), loadModules()]);
  const q = params.q || "";
  const productId = params.productId || "";
  const moduleId = params.moduleId || "";
  const limit = 50;
  const offset = Number(params.offset) || 0;

  const qs = new URLSearchParams({ limit, offset });
  if (q) qs.set("q", q);
  if (productId) qs.set("productId", productId);
  if (moduleId) qs.set("moduleId", moduleId);
  const data = await api("/dispatches?" + qs.toString());

  setHeader(
    "Stock given",
    `${data.total} record${data.total === 1 ? "" : "s"}`,
    `<button class="btn primary" data-new>－ Give stock</button>`,
    (a) => a.querySelector("[data-new]").addEventListener("click", () => go("give")),
  );

  const updateFilter = (patch) => {
    const next = { q, productId, moduleId, offset: 0, ...patch };
    const u = new URLSearchParams();
    if (next.q) u.set("q", next.q);
    if (next.productId) u.set("productId", next.productId);
    if (next.moduleId) u.set("moduleId", next.moduleId);
    if (next.offset) u.set("offset", next.offset);
    location.hash = "#/dispatches?" + u.toString();
  };

  view.innerHTML = `
    <div class="toolbar">
      <div class="grow search"><span class="ic">⌕</span>
        <input id="d-q" placeholder="Search invoice, customer, phone, GST no, product, module, serial…" value="${esc(q)}"></div>
      ${stockFilterHtml("d", products, modules, productId, moduleId)}
    </div>

    <div class="panel"><div class="panel-b flush">
    ${
      data.items.length
        ? `<table>
        <thead><tr><th>Given</th><th>Invoice</th><th>Customer</th><th>GST no</th><th>Product / module</th><th>Qty</th><th>Valid until</th><th></th></tr></thead>
        <tbody>
          ${data.items
            .map(
              (d) => `
            <tr>
              <td class="mono" style="font-size:12.5px;white-space:nowrap">${esc(d.givenDate)}</td>
              <td class="mono">${esc(d.invoiceNo)}</td>
              <td><b>${esc(d.customerName)}</b><div class="muted mono" style="font-size:12px">${esc(d.customerPhone)}</div></td>
              <td class="mono" style="font-size:12.5px">${d.gstNo ? esc(d.gstNo) : `<span class="muted">—</span>`}</td>
              <td>${d.items
                .map((i) => `<div class="item-line">${moduleCell(i)}${d.items.length > 1 ? `<span class="muted">× ${i.quantity}</span>` : ""}</div>`)
                .join("")}</td>
              <td><b>${d.quantity}</b></td>
              <td class="mono" style="font-size:12.5px;white-space:nowrap">${d.validUntil ? esc(d.validUntil) : `<span class="muted">—</span>`}</td>
              <td style="text-align:right;white-space:nowrap">
                <button class="btn sm" data-pdf="${d.id}" data-inv="${esc(d.invoiceNo)}" title="Download warranty card PDF">⤓ PDF</button>
                <button class="btn sm ghost" data-open="${d.id}">Details</button></td>
            </tr>`,
            )
            .join("")}
        </tbody></table>`
        : emptyState("⇥", q || productId || moduleId ? "No records match these filters." : "No stock has been given out yet.")
    }
    </div></div>

    ${
      data.total > limit
        ? `<div class="toolbar" style="justify-content:flex-end">
            <button class="btn sm" id="prev" ${offset === 0 ? "disabled" : ""}>← Prev</button>
            <span class="muted" style="font-size:12.5px">${offset + 1}–${Math.min(offset + limit, data.total)} of ${data.total}</span>
            <button class="btn sm" id="next" ${offset + limit >= data.total ? "disabled" : ""}>Next →</button>
          </div>`
        : ""
    }`;

  let qTimer;
  $("#d-q", view).addEventListener("input", (e) => {
    clearTimeout(qTimer);
    const val = e.target.value;
    qTimer = setTimeout(() => updateFilter({ q: val }), 300);
  });
  $("#d-product", view).addEventListener("change", (e) =>
    updateFilter({ productId: e.target.value, moduleId: "" }),
  );
  $("#d-module", view).addEventListener("change", (e) =>
    updateFilter({ moduleId: e.target.value }),
  );
  const prevBtn = $("#prev", view);
  const nextBtn = $("#next", view);
  if (prevBtn)
    prevBtn.addEventListener("click", () => updateFilter({ offset: Math.max(0, offset - limit) }));
  if (nextBtn)
    nextBtn.addEventListener("click", () => updateFilter({ offset: offset + limit }));

  view.querySelectorAll("[data-open]").forEach((b) =>
    b.addEventListener("click", () => dispatchModal(b.dataset.open)),
  );
  view.querySelectorAll("[data-pdf]").forEach((b) =>
    b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        await download(`/dispatches/${b.dataset.pdf}/pdf?download=1`, `warranty-card-${b.dataset.inv}.pdf`);
      } catch (e) {
        toast(e.message, "err");
      } finally {
        b.disabled = false;
      }
    }),
  );
  // Arriving from Give stock: show the record that was just saved.
  if (params.id) dispatchModal(params.id);
};

async function dispatchModal(id) {
  let d;
  try {
    d = await api("/dispatches/" + id);
  } catch (e) {
    return toast(e.message, "err");
  }
  openModal({
    title: `Invoice ${d.invoiceNo}`,
    body: `
      <div class="cert-grid" style="border-radius:10px;border:1px solid var(--line);margin-bottom:16px">
        <div class="c"><div class="k">Customer</div><div class="v">${esc(d.customerName)}</div></div>
        <div class="c"><div class="k">Phone</div><div class="v mono">${esc(d.customerPhone)}</div></div>
        <div class="c"><div class="k">GST no</div><div class="v mono">${d.gstNo ? esc(d.gstNo) : "—"}</div></div>
        <div class="c"><div class="k">Given date</div><div class="v mono">${esc(d.givenDate)}</div></div>
        <div class="c"><div class="k">Valid until</div><div class="v mono">${d.validUntil ? esc(d.validUntil) : "—"}</div></div>
      </div>
      <div class="lab" style="font-size:12.5px;font-weight:600;color:var(--ink-soft);margin-bottom:6px">
        ${d.quantity} unit${d.quantity === 1 ? "" : "s"} given${d.items.length > 1 ? ` across ${d.items.length} products` : ""}</div>
      ${d.items
        .map((i) => {
          const units = d.units.filter((u) => u.moduleId === i.moduleId);
          return `
      <div class="item-h">${moduleCell(i)}<span class="muted">${i.quantity} unit${i.quantity === 1 ? "" : "s"}</span></div>
      <div class="pick-list" style="margin-bottom:12px">
        ${
          units.length
            ? units
                .map(
                  (u) => `<div class="pick-row" style="cursor:default">
                    ${serialPair(u.internalSerial, u.manufacturerSerial)}
                    <span class="d">${statusChip(u.status)}</span></div>`,
                )
                .join("")
            : `<div class="muted" style="padding:14px">No units are linked to this line any more.</div>`
        }
      </div>`;
        })
        .join("")}
      ${d.notes ? `<div class="hint" style="margin-top:12px">Notes: ${esc(d.notes)}</div>` : ""}
      <div class="hint" style="margin-top:8px">Entered${d.createdByName ? " by " + esc(d.createdByName) : ""} on ${esc(new Date(d.createdAt).toLocaleString())}</div>`,
    footer: `
      ${isAdmin() ? `<button class="btn danger" data-del style="margin-right:auto">Undo &amp; return to stock</button>` : ""}
      <button class="btn" data-cancel>Close</button>
      <button class="btn" data-edit>✎ Edit</button>
      <button class="btn primary" data-pdf>⎙ PDF</button>`,
    onMount(root, close) {
      $("[data-cancel]", root).addEventListener("click", close);
      $("[data-edit]", root).addEventListener("click", () => editDispatchModal(d));
      $("[data-pdf]", root).addEventListener("click", () => pdfModal(d));
      const del = $("[data-del]", root);
      if (del)
        del.addEventListener("click", async () => {
          if (!confirm(`Delete this record${d.items.length > 1 ? ` (all ${d.items.length} products)` : ""} and put its sold units back in stock?`)) return;
          try {
            await api("/dispatches/" + d.id, { method: "DELETE" });
            toast("Record deleted, units back in stock", "ok");
            stockChanged();
            close();
            go("dispatches");
            render();
          } catch (e) {
            toast(e.message, "err");
          }
        });
    },
  });
}

/** Correct a hand-over's details; its products and units stay as they are. */
function editDispatchModal(d) {
  openModal({
    title: `Edit invoice ${d.invoiceNo}`,
    body: `
      <label class="field"><span class="lab">Customer name</span>
        <input id="e-name" maxlength="200" value="${esc(d.customerName)}"></label>
      <div class="row">
        <label class="field"><span class="lab">Customer phone</span>
          <input id="e-phone" type="tel" maxlength="20" value="${esc(d.customerPhone)}"></label>
        <label class="field"><span class="lab">GST no <span class="muted">(optional)</span></span>
          <input id="e-gst" class="mono" maxlength="15" value="${esc(d.gstNo || "")}"
            style="text-transform:uppercase"></label>
      </div>
      <div class="row">
        <label class="field"><span class="lab">Invoice no</span>
          <input id="e-inv" class="mono" maxlength="64" value="${esc(d.invoiceNo)}"></label>
        <label class="field"><span class="lab">Given date</span>
          <input id="e-date" type="date" value="${esc(d.givenDate)}"></label>
      </div>
      <div class="row">
        <label class="field"><span class="lab">Validity date</span>
          <input id="e-valid" type="date" value="${esc(d.validUntil || "")}"></label>
        <label class="field"><span class="lab">Notes <span class="muted">(optional)</span></span>
          <input id="e-notes" maxlength="2000" value="${esc(d.notes)}"></label>
      </div>
      <div class="hint">Products and serials can't be changed here — undo the record and give the stock again for that.</div>
      <div class="banner err" id="e-err" hidden></div>`,
    footer: `
      <button class="btn" data-back style="margin-right:auto">← Details</button>
      <button class="btn primary" data-save>Save</button>`,
    onMount(root) {
      $("[data-back]", root).addEventListener("click", () => dispatchModal(d.id));
      $("[data-save]", root).addEventListener("click", async (e) => {
        const errEl = $("#e-err", root);
        const fail = (m) => {
          errEl.textContent = m;
          errEl.hidden = !m;
        };
        fail("");
        const next = {
          customerName: $("#e-name", root).value.trim(),
          customerPhone: $("#e-phone", root).value.trim(),
          gstNo: $("#e-gst", root).value.trim().toUpperCase() || null,
          invoiceNo: $("#e-inv", root).value.trim(),
          givenDate: $("#e-date", root).value,
          validUntil: $("#e-valid", root).value || null,
          notes: $("#e-notes", root).value.trim(),
        };
        if (!next.customerName) return fail("Enter the customer name.");
        if (!next.customerPhone) return fail("Enter the customer phone.");
        if (!next.invoiceNo) return fail("Enter the invoice number.");
        if (!next.givenDate) return fail("Enter the given date.");
        if (next.validUntil && next.validUntil < next.givenDate) {
          return fail("Validity date can't be before the given date.");
        }
        // Send only what changed.
        const patch = {};
        for (const [k, v] of Object.entries(next)) {
          if (v !== (d[k] ?? null)) patch[k] = v;
        }
        if (!Object.keys(patch).length) return dispatchModal(d.id);
        e.target.disabled = true;
        try {
          await api("/dispatches/" + d.id, { method: "PATCH", body: JSON.stringify(patch) });
          toast("Record updated", "ok");
          stockChanged();
          dispatchModal(d.id);
          if (currentRoute === "dispatches") render();
        } catch (ex) {
          fail(validationMessage(ex));
          e.target.disabled = false;
        }
      });
    },
  });
}

// The blob URL behind the open PDF viewer; freed when the next one opens.
let pdfUrl = null;

/** View a hand-over's warranty card in a modal, with Download / Open in new tab. */
async function pdfModal(d) {
  let file;
  try {
    file = await fetchFile(`/dispatches/${d.id}/pdf`, `warranty-card-${d.invoiceNo}.pdf`);
  } catch (e) {
    return toast(e.message, "err");
  }
  if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  pdfUrl = URL.createObjectURL(file.blob);
  openModal({
    title: `Warranty card · ${d.invoiceNo}`,
    wide: true,
    body: `<iframe class="pdf-frame" src="${pdfUrl}" title="Warranty card PDF"></iframe>
      <div class="hint">Can't see the PDF? Use “Open in new tab” or “Download”.</div>`,
    footer: `
      <button class="btn" data-back style="margin-right:auto">← Details</button>
      <a class="btn" href="${pdfUrl}" target="_blank" rel="noopener">Open in new tab</a>
      <a class="btn primary" href="${pdfUrl}" download="${esc(file.name)}">⤓ Download</a>`,
    onMount(root) {
      $("[data-back]", root).addEventListener("click", () => dispatchModal(d.id));
    },
  });
}

// ------------------------------------------------------------------ inventory
routes.inventory = async (view, params) => {
  const [products, modules] = await Promise.all([loadProducts(), loadModules()]);
  const q = params.q || "";
  const productId = params.productId || "";
  const moduleId = params.moduleId || "";
  const status = params.status || "";
  const limit = Number(params.limit) || 50;
  const offset = Number(params.offset) || 0;

  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  if (productId) qs.set("productId", productId);
  if (moduleId) qs.set("moduleId", moduleId);
  if (status) qs.set("status", status);
  qs.set("limit", limit);
  qs.set("offset", offset);
  const data = await api("/units?" + qs.toString());

  const exportQs = new URLSearchParams();
  if (q) exportQs.set("q", q);
  if (productId) exportQs.set("productId", productId);
  if (moduleId) exportQs.set("moduleId", moduleId);
  if (status) exportQs.set("status", status);

  setHeader(
    "Inventory",
    `${data.total} unit${data.total === 1 ? "" : "s"}${moduleId ? " · filtered by module" : productId ? " · filtered by product" : ""}`,
    `<button class="btn" data-export>⤓ Export CSV</button>`,
    (a) =>
      a.querySelector("[data-export]").addEventListener("click", async (e) => {
        e.target.disabled = true;
        try {
          await download("/units/export.csv?" + exportQs.toString(), "stockroom-units.csv");
        } catch (err) {
          toast(err.message, "err");
        } finally {
          e.target.disabled = false;
        }
      }),
  );

  const updateFilter = (patch) => {
    const next = { q, productId, moduleId, status, limit, offset: 0, ...patch };
    const u = new URLSearchParams();
    if (next.q) u.set("q", next.q);
    if (next.productId) u.set("productId", next.productId);
    if (next.moduleId) u.set("moduleId", next.moduleId);
    if (next.status) u.set("status", next.status);
    if (next.offset) u.set("offset", next.offset);
    location.hash = "#/inventory?" + u.toString();
  };

  view.innerHTML = `
    <div class="toolbar">
      <div class="grow search"><span class="ic">⌕</span>
        <input id="f-q" placeholder="Search serial, product, module, SKU…" value="${esc(q)}"></div>
      ${stockFilterHtml("f", products, modules, productId, moduleId)}
      <select id="f-status" style="width:auto">
        <option value="">All statuses</option>
        ${STATUSES.map(
          (s) =>
            `<option value="${s.v}" ${s.v === status ? "selected" : ""}>${s.label}</option>`,
        ).join("")}
      </select>
    </div>

    <div class="panel"><div class="panel-b flush">
    ${
      data.items.length
        ? `<table>
        <thead><tr><th>Internal ← Supplier</th><th>Product / module</th><th>Status</th><th>Intake</th><th></th></tr></thead>
        <tbody>
          ${data.items
            .map(
              (u) => `
            <tr>
              <td>${serialPair(u.internalSerial, u.manufacturerSerial)}</td>
              <td>${moduleCell(u)}</td>
              <td>
                <select class="st" data-id="${u.id}" style="width:auto;padding:5px 8px">
                  ${STATUSES.map(
                    (s) =>
                      `<option value="${s.v}" ${s.v === u.status ? "selected" : ""}>${s.label}</option>`,
                  ).join("")}
                </select>
              </td>
              <td class="muted mono" style="font-size:12.5px">${esc(u.intakeDate)}</td>
              <td style="text-align:right"><button class="btn sm ghost" data-unit="${u.id}">Details</button></td>
            </tr>`,
            )
            .join("")}
        </tbody></table>`
        : emptyState("▦", "No units match these filters.")
    }
    </div></div>

    ${
      data.total > limit
        ? `<div class="toolbar" style="justify-content:flex-end">
            <button class="btn sm" id="prev" ${offset === 0 ? "disabled" : ""}>← Prev</button>
            <span class="muted" style="font-size:12.5px">${offset + 1}–${Math.min(offset + limit, data.total)} of ${data.total}</span>
            <button class="btn sm" id="next" ${offset + limit >= data.total ? "disabled" : ""}>Next →</button>
          </div>`
        : ""
    }`;

  // Filters
  let qTimer;
  $("#f-q", view).addEventListener("input", (e) => {
    clearTimeout(qTimer);
    const val = e.target.value;
    qTimer = setTimeout(() => updateFilter({ q: val }), 300);
  });
  $("#f-product", view).addEventListener("change", (e) =>
    updateFilter({ productId: e.target.value, moduleId: "" }),
  );
  $("#f-module", view).addEventListener("change", (e) =>
    updateFilter({ moduleId: e.target.value }),
  );
  $("#f-status", view).addEventListener("change", (e) =>
    updateFilter({ status: e.target.value }),
  );

  // Pagination
  const prevBtn = $("#prev", view);
  const nextBtn = $("#next", view);
  if (prevBtn)
    prevBtn.addEventListener("click", () =>
      updateFilter({ offset: Math.max(0, offset - limit) }),
    );
  if (nextBtn)
    nextBtn.addEventListener("click", () => updateFilter({ offset: offset + limit }));

  // Inline status change
  view.querySelectorAll("select.st").forEach((s) =>
    s.addEventListener("change", async () => {
      try {
        await api("/units/" + s.dataset.id, {
          method: "PATCH",
          body: JSON.stringify({ status: s.value }),
        });
        toast("Status updated", "ok");
        stockChanged();
      } catch (e) {
        toast(e.message, "err");
        render();
      }
    }),
  );

  // Details
  view.querySelectorAll("[data-unit]").forEach((b) =>
    b.addEventListener("click", () => {
      const u = data.items.find((x) => x.id === b.dataset.unit);
      unitModal(u, render);
    }),
  );
};

function unitModal(u, onSaved) {
  const w = computeWarranty(u.warrantyStart, u.intakeDate, u.warrantyMonths);
  const barClass = w.expired ? "err" : w.daysRemaining < 45 ? "warn" : "";
  openModal({
    title: "Unit detail",
    body: `
      <div class="row">
        <label class="field"><span class="lab">Internal serial</span>
          <input id="u-int" class="mono" maxlength="128" value="${esc(u.internalSerial)}"></label>
        <label class="field"><span class="lab">Supplier serial</span>
          <input id="u-mfr" class="mono" maxlength="128" value="${esc(u.manufacturerSerial || "")}"
            placeholder="none — type to add"></label>
      </div>
      <div class="cert-grid" style="border-radius:10px;border:1px solid var(--line);margin-bottom:16px">
        <div class="c"><div class="k">Product</div><div class="v">${esc(u.productName)}</div></div>
        <div class="c"><div class="k">Module</div><div class="v">${esc(u.moduleName)}</div></div>
        <div class="c"><div class="k">SKU</div><div class="v mono">${esc(u.sku)}</div></div>
        <div class="c"><div class="k">Status</div><div class="v">${statusChip(u.status)}</div></div>
        <div class="c"><div class="k">Intake date</div><div class="v mono">${esc(u.intakeDate)}</div></div>
        <div class="c"><div class="k">Warranty ends</div><div class="v mono">${esc(w.end)}</div></div>
        <div class="c"><div class="k">Days remaining</div><div class="v">${w.expired ? `<span style="color:var(--err-ink)">Expired</span>` : w.daysRemaining}</div></div>
      </div>
      <div class="bar ${barClass}"><i style="width:${w.percentElapsed}%"></i></div>
      ${u.soldTo ? `<div class="hint">Sold to ${esc(u.soldTo)}${u.soldDate ? " on " + esc(u.soldDate) : ""}</div>` : ""}
      <label class="field" style="margin-top:14px"><span class="lab">Notes</span>
        <input id="u-notes" maxlength="2000" value="${esc(u.notes)}"></label>
      <div class="hint" id="u-err" style="color:var(--err-ink)"></div>`,
    footer: `<button class="btn" data-cancel>Close</button>
             <button class="btn primary" data-save>Save</button>`,
    onMount: (root, close) => {
      $("[data-cancel]", root).addEventListener("click", close);
      $("[data-save]", root).addEventListener("click", async (e) => {
        const errEl = $("#u-err", root);
        errEl.textContent = "";
        const internal = $("#u-int", root).value.trim();
        const mfr = $("#u-mfr", root).value.trim() || null;
        const notes = $("#u-notes", root).value.trim();
        if (!internal) {
          errEl.textContent = "Internal serial can't be empty.";
          return;
        }
        const patch = {};
        if (internal !== u.internalSerial) patch.internalSerial = internal;
        if (mfr !== (u.manufacturerSerial || null)) patch.manufacturerSerial = mfr;
        if (notes !== u.notes) patch.notes = notes;
        if (!Object.keys(patch).length) return close();
        e.target.disabled = true;
        try {
          await api("/units/" + u.id, { method: "PATCH", body: JSON.stringify(patch) });
          toast("Unit updated", "ok");
          close();
          if (onSaved) onSaved();
        } catch (ex) {
          errEl.textContent = ex.message;
          e.target.disabled = false;
        }
      });
    },
  });
}

// ------------------------------------------------------------------- warranty
routes.warranty = async (view, params) => {
  setHeader("Warranty lookup", "Search by internal or supplier serial", "");
  view.innerHTML = `
    <div class="panel"><div class="panel-b">
      <div class="toolbar" style="margin:0">
        <div class="grow search"><span class="ic">◎</span>
          <input id="w-q" placeholder="Enter either serial…" value="${esc(params.serial || "")}"></div>
        <button class="btn primary" id="w-go">Look up</button>
      </div>
    </div></div>
    <div id="w-result"></div>`;

  const input = $("#w-q", view);
  const result = $("#w-result", view);

  async function lookup() {
    const serial = input.value.trim();
    if (!serial) return;
    result.innerHTML = `<div class="muted" style="padding:10px">Searching…</div>`;
    const res = await fetch(
      "/api/warranty?serial=" + encodeURIComponent(serial),
      {
        headers: authHeaders(),
      }
    );
    const data = await res.json();
    if (data.found) {
      const w = data.warranty;
      const u = data.unit;
      const barClass = w.expired ? "err" : w.daysRemaining < 45 ? "warn" : "";
      result.innerHTML = `
        <div class="cert">
          <div class="cert-top">
            <div class="t">Warranty certificate · matched ${data.matchedBy} serial</div>
            <div class="n">${esc(u.productName)}</div>
            <div style="opacity:.8;margin-top:2px">${esc(u.moduleName)}</div>
            <div style="margin-top:12px">${serialPair(u.internalSerial, u.manufacturerSerial)}</div>
          </div>
          <div class="cert-grid">
            <div class="c"><div class="k">SKU</div><div class="v mono">${esc(u.sku)}</div></div>
            <div class="c"><div class="k">Status</div><div class="v">${statusChip(u.status)}</div></div>
            <div class="c"><div class="k">Warranty start</div><div class="v mono">${esc(w.start)}</div></div>
            <div class="c"><div class="k">Warranty end</div><div class="v mono">${esc(w.end)}</div></div>
            <div class="c"><div class="k">Coverage</div><div class="v">${w.months} months</div></div>
            <div class="c"><div class="k">Days remaining</div><div class="v">${w.expired ? `<span style="color:var(--err-ink)">Expired</span>` : w.daysRemaining}</div></div>
          </div>
          <div style="padding:14px 18px">
            <div class="bar ${barClass}"><i style="width:${w.percentElapsed}%"></i></div>
          </div>
        </div>`;
    } else {
      const sug = data.suggestions || [];
      result.innerHTML = `
        <div class="banner info">No exact match for “${esc(serial)}”.</div>
        ${
          sug.length
            ? `<div class="panel"><div class="panel-h"><h2>Did you mean…</h2></div>
               <div class="panel-b flush"><table><tbody>
                 ${sug
                   .map(
                     (s) =>
                       `<tr><td>${serialPair(s.internalSerial, s.manufacturerSerial)}</td>
                        <td class="muted" style="text-align:right">${esc(s.productName)} · ${esc(s.moduleName)}</td></tr>`,
                   )
                   .join("")}
               </tbody></table></div></div>`
            : ""
        }`;
    }
  }

  $("#w-go", view).addEventListener("click", lookup);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") lookup();
  });
  if (params.serial) lookup();
};

// ------------------------------------------------------------------- settings
routes.settings = async (view) => {
  const s = await loadSettings(true);
  setHeader("Settings", "Company, serial format, and defaults", "");

  const sampleSeq = formatSerial(s.serialPrefix, "VLD1030", 1);
  view.innerHTML = `
    <div class="panel"><div class="panel-h"><h2>Configuration</h2></div>
      <div class="panel-b">
        <label class="field"><span class="lab">Company name</span>
          <input id="s-company" value="${esc(s.companyName)}"></label>
        <div class="row">
          <label class="field"><span class="lab">Global serial prefix <span class="muted">(optional)</span></span>
            <input id="s-prefix" class="mono" value="${esc(s.serialPrefix)}" placeholder="e.g. ACM"></label>
          <label class="field"><span class="lab">Default warranty (months)</span>
            <input id="s-war" type="number" min="0" value="${s.defaultWarrantyMonths}"></label>
        </div>
        <label class="field"><span class="lab">Low-stock threshold</span>
          <input id="s-low" type="number" min="0" value="${s.lowStockThreshold}"></label>
        <div class="hint">Internal serials will look like <b class="mono" id="s-sample">${esc(sampleSeq)}</b></div>
        <div class="hint" id="s-err"></div>
        <div style="margin-top:14px"><button class="btn primary" id="s-save">Save settings</button></div>
      </div>
    </div>

    <div class="panel"><div class="panel-h"><h2>Sample data</h2></div>
      <div class="panel-b">
        <p class="muted" style="margin-top:0">Create a demo product with two modules and some stock so you can click around.</p>
        <button class="btn" id="s-sample-btn">Load sample data</button>
      </div>
    </div>

    <div class="panel" style="border-color:#F0C9C9"><div class="panel-h"><h2 style="color:var(--err-ink)">Danger zone</h2></div>
      <div class="panel-b">
        <p class="muted" style="margin-top:0">Delete every product, module and unit. This cannot be undone.</p>
        <button class="btn danger" id="s-clear">Delete all data</button>
      </div>
    </div>`;

  $("#s-prefix", view).addEventListener("input", (e) => {
    $("#s-sample", view).textContent = formatSerial(
      e.target.value,
      "VLD1030",
      1,
    );
  });

  $("#s-save", view).addEventListener("click", async () => {
    const body = {
      companyName: $("#s-company", view).value.trim(),
      serialPrefix: $("#s-prefix", view).value.trim(),
      defaultWarrantyMonths: Number($("#s-war", view).value),
      lowStockThreshold: Number($("#s-low", view).value),
    };
    try {
      await api("/settings", { method: "PUT", body: JSON.stringify(body) });
      await loadSettings(true);
      toast("Settings saved", "ok");
    } catch (e) {
      $("#s-err", view).textContent = e.message;
    }
  });

  $("#s-sample-btn", view).addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Loading…";
    try {
      const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body) });
      const kit = await post("/products", {
        name: "VLD Reader Kit",
        description: "Demo product",
      });
      const a = await post("/modules", {
        productId: kit.id,
        name: "VLD1030 Module",
        sku: "VLD1030",
        warrantyMonths: 24,
      });
      await post("/units/intake", {
        moduleId: a.id,
        manufacturerSerials: ["SNA-5001", "SNA-5002", "SNA-5003", "SNA-5004"],
      });
      const b = await post("/modules", {
        productId: kit.id,
        name: "VLD2040 Reader",
        sku: "VLD2040",
        warrantyMonths: 12,
      });
      await post("/units/intake", { moduleId: b.id, quantity: 6 });
      toast("Sample data loaded", "ok");
      stockChanged();
      go("dashboard");
    } catch (err) {
      toast(err.message, "err");
      e.target.disabled = false;
      e.target.textContent = "Load sample data";
    }
  });

  $("#s-clear", view).addEventListener("click", async () => {
    if (!confirm("Delete ALL products, modules and units? This cannot be undone.")) return;
    try {
      // Modules first (taking their units): a product can't be deleted while it has any.
      for (const m of await api("/modules")) {
        await api("/modules/" + m.id, { method: "DELETE" });
      }
      for (const p of await api("/products")) {
        await api("/products/" + p.id, { method: "DELETE" });
      }
      stockChanged();
      toast("All data deleted", "ok");
      go("dashboard");
    } catch (e) {
      toast(e.message, "err");
    }
  });
};

// ---------------------------------------------------------------------- users
// Admin only. There is no public sign-up: accounts are registered here.
routes.users = async (view) => {
  const users = await api("/users");
  setHeader(
    "Users",
    `${users.length} account${users.length === 1 ? "" : "s"}`,
    `<button class="btn primary" data-new>＋ Register user</button>`,
    (a) => a.querySelector("[data-new]").addEventListener("click", () => userModal()),
  );

  const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : "never");
  view.innerHTML = `
    <div class="panel"><div class="panel-b flush">
    <table>
      <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
      <tbody>
        ${users
          .map(
            (u) => `
          <tr>
            <td><b>${esc(u.fullName || u.username)}</b>
              <div class="muted mono" style="font-size:12px">${esc(u.username)}${u.id === state.user.id ? " · you" : ""}</div></td>
            <td><span class="role ${u.role}">${u.role}</span></td>
            <td>${u.isActive ? `<span class="chip in_stock">Active</span>` : `<span class="chip sold">Disabled</span>`}</td>
            <td class="muted" style="font-size:12.5px;white-space:nowrap">${esc(fmt(u.lastLoginAt))}</td>
            <td style="text-align:right;white-space:nowrap">
              <button class="btn sm" data-edit="${u.id}">Edit</button>
            </td>
          </tr>`,
          )
          .join("")}
      </tbody>
    </table></div></div>`;

  view.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => userModal(users.find((u) => u.id === b.dataset.edit))),
  );
};

/** Register a new user (no arg) or edit an existing one. */
function userModal(user) {
  const editing = !!user;
  const self = editing && user.id === state.user.id;
  openModal({
    title: editing ? `Edit ${user.username}` : "Register user",
    body: `
      ${editing ? "" : `
      <label class="field"><span class="lab">Username</span>
        <input id="u-username" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="e.g. jsmith"></label>`}
      <label class="field"><span class="lab">Full name <span class="muted">(optional)</span></span>
        <input id="u-name" value="${esc(user?.fullName || "")}"></label>
      <div class="row">
        <label class="field"><span class="lab">Role</span>
          <select id="u-role" ${self ? "disabled" : ""}>
            <option value="user" ${user?.role !== "admin" ? "selected" : ""}>User — day-to-day stock work</option>
            <option value="admin" ${user?.role === "admin" ? "selected" : ""}>Admin — also users &amp; settings</option>
          </select></label>
        ${editing ? `
        <label class="field"><span class="lab">Status</span>
          <select id="u-active" ${self ? "disabled" : ""}>
            <option value="1" ${user.isActive ? "selected" : ""}>Active</option>
            <option value="0" ${!user.isActive ? "selected" : ""}>Disabled — cannot sign in</option>
          </select></label>` : ""}
      </div>
      <label class="field"><span class="lab">${editing ? "Reset password" : "Password"}
        ${editing ? `<span class="muted">(leave blank to keep)</span>` : ""}</span>
        <input id="u-pass" type="password" autocomplete="new-password" placeholder="at least 8 characters"></label>
      ${self ? `<div class="hint">You can't change your own role or status. Use “Password” in the sidebar to change your password.</div>` : ""}
      <div class="banner err" id="u-err" hidden></div>`,
    footer: `
      ${editing && !self ? `<button class="btn danger" data-del style="margin-right:auto">Delete</button>` : ""}
      <button class="btn" data-cancel>Cancel</button>
      <button class="btn primary" data-save>${editing ? "Save" : "Register"}</button>`,
    onMount(root, close) {
      const err = (m) => {
        const el = $("#u-err", root);
        el.textContent = m;
        el.hidden = !m;
      };
      $("[data-cancel]", root).addEventListener("click", close);
      $("[data-save]", root).addEventListener("click", async (e) => {
        const pass = $("#u-pass", root).value;
        try {
          e.target.disabled = true;
          if (editing) {
            const body = { fullName: $("#u-name", root).value.trim() };
            if (!self) {
              body.role = $("#u-role", root).value;
              body.isActive = $("#u-active", root).value === "1";
            }
            if (pass) body.password = pass;
            await api("/users/" + user.id, { method: "PATCH", body: JSON.stringify(body) });
            toast("User updated" + (pass ? " — they must sign in again" : ""), "ok");
          } else {
            const created = await api("/auth/register", {
              method: "POST",
              body: JSON.stringify({
                username: $("#u-username", root).value.trim(),
                fullName: $("#u-name", root).value.trim(),
                role: $("#u-role", root).value,
                password: pass,
              }),
            });
            toast(`Registered ${created.username}`, "ok");
          }
          close();
          render();
        } catch (ex) {
          err(validationMessage(ex));
          e.target.disabled = false;
        }
      });
      const del = $("[data-del]", root);
      if (del)
        del.addEventListener("click", async () => {
          if (!confirm(`Delete user "${user.username}"? They will no longer be able to sign in.`)) return;
          try {
            await api("/users/" + user.id, { method: "DELETE" });
            toast("User deleted", "ok");
            close();
            render();
          } catch (ex) {
            err(ex.message);
          }
        });
      (editing ? $("#u-name", root) : $("#u-username", root)).focus();
    },
  });
}

/** Turn a zod "Validation failed" error into the first field message. */
function validationMessage(ex) {
  const d = ex.data?.error?.details;
  const field = d?.fieldErrors && Object.values(d.fieldErrors).flat()[0];
  return field || d?.formErrors?.[0] || ex.message;
}

function changePasswordModal() {
  openModal({
    title: "Change your password",
    body: `
      <label class="field"><span class="lab">Current password</span>
        <input id="cp-cur" type="password" autocomplete="current-password"></label>
      <label class="field"><span class="lab">New password</span>
        <input id="cp-new" type="password" autocomplete="new-password" placeholder="at least 8 characters"></label>
      <label class="field"><span class="lab">Confirm new password</span>
        <input id="cp-new2" type="password" autocomplete="new-password"></label>
      <div class="hint">Other devices signed in to this account will be signed out.</div>
      <div class="banner err" id="cp-err" hidden style="margin-top:12px"></div>`,
    footer: `<button class="btn" data-cancel>Cancel</button>
             <button class="btn primary" data-save>Change password</button>`,
    onMount(root, close) {
      const err = (m) => {
        const el = $("#cp-err", root);
        el.textContent = m;
        el.hidden = !m;
      };
      $("[data-cancel]", root).addEventListener("click", close);
      $("[data-save]", root).addEventListener("click", async (e) => {
        const cur = $("#cp-cur", root).value;
        const next = $("#cp-new", root).value;
        if (next !== $("#cp-new2", root).value) return err("New passwords don't match");
        try {
          e.target.disabled = true;
          const r = await api("/auth/change-password", {
            method: "POST",
            body: JSON.stringify({ currentPassword: cur, newPassword: next }),
          });
          setToken(r.token); // old token was revoked; keep this session alive
          state.user = r.user;
          toast("Password changed", "ok");
          close();
        } catch (ex) {
          err(validationMessage(ex));
          e.target.disabled = false;
        }
      });
      $("#cp-cur", root).focus();
    },
  });
}

// ------------------------------------------------------------------ bootstrap
function showLogin(message) {
  $("#app").hidden = true;
  $("#auth").hidden = false;
  $("#modal-root").innerHTML = "";
  const errEl = $("#loginErr");
  errEl.textContent = message || "";
  errEl.hidden = !message;
  $("#loginPass").value = "";
  setTimeout(() => ($("#loginUser").value ? $("#loginPass") : $("#loginUser")).focus(), 0);
}

async function showApp() {
  const u = state.user;
  $("#auth").hidden = true;
  $("#app").hidden = false;
  $("#me-name").textContent = u.fullName || u.username;
  $("#me-role").textContent = u.role;
  $("#me-role").className = "role " + u.role;
  $("#me-avatar").textContent = (u.fullName || u.username).trim().charAt(0).toUpperCase();
  document
    .querySelectorAll("#nav [data-admin]")
    .forEach((a) => (a.hidden = !isAdmin()));
  try {
    await loadSettings();
  } catch (e) {
    toast("Cannot reach API: " + e.message, "err");
  }
  if (!location.hash) location.hash = "#/dashboard";
  render();
}

/** Clear the session and return to the login screen. */
function signedOut(message) {
  if (!state.user && !memToken) return;
  setToken(null);
  state.user = null;
  state.settings = null;
  stockChanged();
  showLogin(message);
}

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#loginBtn");
  const errEl = $("#loginErr");
  errEl.hidden = true;
  btn.disabled = true;
  btn.textContent = "Signing in…";
  try {
    const r = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: $("#loginUser").value.trim(),
        password: $("#loginPass").value,
      }),
    });
    setToken(r.token);
    state.user = r.user;
    await showApp();
  } catch (ex) {
    errEl.textContent = ex.status === 400 ? "Enter your username and password" : ex.message;
    errEl.hidden = false;
    $("#loginPass").select();
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign in";
  }
});

$("#logoutBtn").addEventListener("click", () => signedOut());
$("#pwBtn").addEventListener("click", () => changePasswordModal());

document.querySelectorAll("#nav a").forEach((a) =>
  a.addEventListener("click", () => go(a.dataset.route)),
);
$("#menuBtn").addEventListener("click", () => {
  $("#sidebar").classList.toggle("open");
  $("#scrim").classList.toggle("on");
});
$("#scrim").addEventListener("click", () => {
  $("#sidebar").classList.remove("open");
  $("#scrim").classList.remove("on");
});
window.addEventListener("hashchange", render);

(async function init() {
  if (!memToken) return showLogin();
  try {
    state.user = await api("/auth/me");
    await showApp();
  } catch (e) {
    // 401 already routed to the login screen by api(); anything else is a
    // network / server problem worth saying out loud.
    if (e.status !== 401) showLogin("Cannot reach the server: " + e.message);
  }
})();
