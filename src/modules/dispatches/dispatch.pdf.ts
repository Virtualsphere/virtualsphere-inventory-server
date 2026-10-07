/**
 * Warranty card PDF for one hand-over: company logo, invoice and customer
 * details, the product lines, and every serial that went out.
 *
 * Uses pdfkit's built-in Helvetica/Courier (WinAnsi), so text outside Latin-1
 * (e.g. Devanagari names) would need an embedded TTF font.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import type { DispatchDetail, Settings, UnitView } from "../../types";

/** logo.png at the project root (same path from src/ and dist/). */
const LOGO_PATH = join(__dirname, "..", "..", "..", "logo.png");

const BRAND_RED = "#E31E24";
const INK = "#1B2530";
const SOFT = "#5B6674";
const LINE = "#D9DEE5";
const FILL = "#F3F5F8";

const MARGIN = 40;
const FOOTER_H = 28;

type Doc = PDFKit.PDFDocument;

export function buildDispatchPdf(
  d: DispatchDetail,
  settings: Settings,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    bufferPages: true, // footers ("Page x of y") are stamped once all pages exist
    info: {
      Title: `Warranty card ${d.invoiceNo}`,
      Author: settings.companyName,
      Subject: `Stock given to ${d.customerName}`,
    },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = MARGIN;
  const width = doc.page.width - MARGIN * 2;

  header(doc, d, left, width);
  parties(doc, d, left, width);
  itemsTable(doc, d, left, width);
  serials(doc, d, left, width);
  notesAndSignatures(doc, d, settings, left, width);
  footers(doc, d, settings);

  doc.end();
  return done;
}

/** Start a new page if fewer than `h` points are left above the footer. */
function ensureSpace(doc: Doc, h: number): void {
  if (doc.y + h > doc.page.height - MARGIN - FOOTER_H) doc.addPage();
}

function rule(doc: Doc, left: number, width: number, color = LINE, w = 0.75): void {
  doc.save().moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(w).strokeColor(color).stroke().restore();
}

function header(doc: Doc, d: DispatchDetail, left: number, width: number): void {
  const top = MARGIN;
  if (existsSync(LOGO_PATH)) doc.image(LOGO_PATH, left, top, { width: 190 });

  const right = left + width;
  doc.font("Helvetica-Bold").fontSize(18).fillColor(INK)
    .text("WARRANTY CARD", left, top, { width, align: "right" });
  // Label column, then the value right-aligned to the page edge.
  const meta = (label: string, value: string, y: number) => {
    doc.font("Helvetica").fontSize(9.5).fillColor(SOFT).text(label, right - 230, y, { width: 70 });
    doc.font("Helvetica-Bold").fillColor(INK).text(value, right - 160, y, { width: 160, align: "right" });
  };
  meta("Invoice", d.invoiceNo, top + 26);
  meta("Given on", d.givenDate, top + 40);

  doc.y = top + 64;
  rule(doc, left, width, BRAND_RED, 2);
  doc.y += 16;
}

function parties(doc: Doc, d: DispatchDetail, left: number, width: number): void {
  const colW = (width - 20) / 2;
  const top = doc.y;
  const block = (x: number, title: string, rows: Array<[string, string]>) => {
    doc.font("Helvetica-Bold").fontSize(8).fillColor(SOFT)
      .text(title.toUpperCase(), x, top, { width: colW, characterSpacing: 0.6 });
    let y = top + 14;
    for (const [k, v] of rows) {
      doc.font("Helvetica").fontSize(9).fillColor(SOFT).text(k, x, y, { width: 80 });
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK).text(v, x + 80, y, { width: colW - 80 });
      y = Math.max(doc.y, y + 13) + 3;
    }
    return y;
  };
  const yLeft = block(left, "Customer", [
    ["Name", d.customerName],
    ["Phone", d.customerPhone],
    ["GSTIN", d.gstNo ?? "—"],
  ]);
  const yRight = block(left + colW + 20, "Details", [
    ["Given date", d.givenDate],
    ["Warranty till", d.validUntil ?? "—"],
    ["Total units", String(d.quantity)],
  ]);
  doc.y = Math.max(yLeft, yRight) + 10;
}

interface Col {
  title: string;
  w: number;
  align?: "left" | "right";
}

/** A table row: cells wrap; the row is as tall as its tallest cell. */
function row(
  doc: Doc,
  cols: Col[],
  cells: string[],
  left: number,
  opts: { bold?: boolean; fill?: string; size?: number; font?: string; pad?: number } = {},
): void {
  const size = opts.size ?? 9;
  const font = opts.font ?? (opts.bold ? "Helvetica-Bold" : "Helvetica");
  const pad = opts.pad ?? 5;
  doc.font(font).fontSize(size);
  const h =
    Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: cols[i]!.w - pad * 2 }))) + pad * 2;
  ensureSpace(doc, h);
  const y = doc.y;
  const total = cols.reduce((n, c) => n + c.w, 0);
  if (opts.fill) doc.save().rect(left, y, total, h).fill(opts.fill).restore();
  let x = left;
  cells.forEach((c, i) => {
    const col = cols[i]!;
    doc.font(font).fontSize(size).fillColor(opts.bold ? SOFT : INK)
      .text(c, x + pad, y + pad, { width: col.w - pad * 2, align: col.align ?? "left" });
    x += col.w;
  });
  doc.y = y + h;
  rule(doc, left, total);
}

function sectionTitle(doc: Doc, title: string, left: number): void {
  ensureSpace(doc, 40);
  doc.font("Helvetica-Bold").fontSize(10.5).fillColor(INK).text(title, left, doc.y);
  doc.y += 6;
}

function itemsTable(doc: Doc, d: DispatchDetail, left: number, width: number): void {
  sectionTitle(doc, "Products", left);
  const cols: Col[] = [
    { title: "#", w: 26 },
    { title: "Product", w: 165 },
    { title: "Module", w: 165 },
    { title: "SKU", w: width - 26 - 165 - 165 - 60 },
    { title: "Qty", w: 60, align: "right" },
  ];
  const head = () => row(doc, cols, cols.map((c) => c.title.toUpperCase()), left, { bold: true, fill: FILL, size: 8 });
  head();
  d.items.forEach((it, i) => {
    if (doc.y + 30 > doc.page.height - MARGIN - FOOTER_H) {
      doc.addPage();
      head();
    }
    row(doc, cols, [String(i + 1), it.productName, it.moduleName, it.sku, String(it.quantity)], left);
  });
  row(doc, cols, ["", "", "", "Total", String(d.quantity)], left, { bold: true });
  doc.y += 14;
}

function serials(doc: Doc, d: DispatchDetail, left: number, width: number): void {
  sectionTitle(doc, "Serial numbers", left);
  // Internal serials only (supplier serials stay internal), four per row.
  const PER_ROW = 4;
  const cols: Col[] = Array.from({ length: PER_ROW }, () => ({ title: "", w: width / PER_ROW }));
  for (const it of d.items) {
    const units: UnitView[] = d.units.filter((u) => u.moduleId === it.moduleId);
    ensureSpace(doc, 60);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK)
      .text(`${it.productName} · ${it.moduleName}`, left, doc.y, { continued: true })
      .font("Helvetica").fillColor(SOFT).text(`   ${it.sku} · ${units.length} unit${units.length === 1 ? "" : "s"}`);
    doc.y += 4;
    if (!units.length) {
      doc.font("Helvetica-Oblique").fontSize(9).fillColor(SOFT)
        .text("No units are linked to this line any more.", left, doc.y);
      doc.y += 12;
      continue;
    }
    for (let i = 0; i < units.length; i += PER_ROW) {
      const cells = cols.map((_, k) => units[i + k]?.internalSerial ?? "");
      row(doc, cols, cells, left, { font: "Courier", size: 8.5, pad: 3.5 });
    }
    doc.y += 12;
  }
}

function notesAndSignatures(
  doc: Doc,
  d: DispatchDetail,
  settings: Settings,
  left: number,
  width: number,
): void {
  if (d.notes) {
    sectionTitle(doc, "Notes", left);
    doc.font("Helvetica").fontSize(9).fillColor(INK).text(d.notes, left, doc.y, { width });
    doc.y += 14;
  }
  ensureSpace(doc, 64);
  doc.y += 28;
  const boxW = 200;
  const y = doc.y;
  for (const [x, label] of [
    [left, "Customer signature"],
    [left + width - boxW, `For ${settings.companyName}`],
  ] as const) {
    doc.save().moveTo(x, y).lineTo(x + boxW, y).lineWidth(0.75).strokeColor(SOFT).stroke().restore();
    doc.font("Helvetica").fontSize(8.5).fillColor(SOFT).text(label, x, y + 5, { width: boxW, align: "center" });
  }
  doc.y = y + 24;
}

function footers(doc: Doc, d: DispatchDetail, settings: Settings): void {
  const range = doc.bufferedPageRange();
  const stamp = new Date().toISOString().slice(0, 10);
  const by = d.createdByName ? ` by ${d.createdByName}` : "";
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - MARGIN - 12;
    const width = doc.page.width - MARGIN * 2;
    // Writing below the bottom margin would make pdfkit add a page; lift it for the footer.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.save().moveTo(MARGIN, y - 6).lineTo(MARGIN + width, y - 6).lineWidth(0.5).strokeColor(LINE).stroke().restore();
    doc.font("Helvetica").fontSize(7.5).fillColor(SOFT)
      .text(`${settings.companyName} · Invoice ${d.invoiceNo} · Entered${by} · Generated ${stamp}`, MARGIN, y, {
        width: width - 70,
        lineBreak: false,
      })
      .text(`Page ${i - range.start + 1} of ${range.count}`, MARGIN + width - 70, y, {
        width: 70,
        align: "right",
        lineBreak: false,
      });
    doc.page.margins.bottom = bottom;
  }
}
