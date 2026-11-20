import ExcelJS from "exceljs";
import { AppError } from "@/lib/errors";
import type { ImportRow } from "./invitations";

const HEADERS: Record<keyof Omit<ImportRow, "row">, string[]> = {
  name: ["الاسم", "اسم", "الاسم الكامل", "اسم المدعو", "name", "full name", "fullname"],
  phone: ["الجوال", "رقم الجوال", "جوال", "الهاتف", "رقم الهاتف", "واتساب", "رقم الواتساب", "phone", "mobile", "whatsapp"],
  email: ["البريد", "البريد الإلكتروني", "البريد الالكتروني", "الايميل", "الإيميل", "ايميل", "email", "e-mail", "mail"],
  companion: ["مرافق", "المرافق", "يسمح بمرافق", "مع مرافق", "companion", "plus one", "+1"],
};

function norm(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(Math.trunc(v) === v ? v : v);
  if (typeof v === "boolean") return v ? "نعم" : "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("").trim();
    if ("text" in v && typeof v.text === "string") return v.text.trim();
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
  }
  return String(v).trim();
}

function mapHeader(cells: string[]) {
  const idx: Partial<Record<keyof Omit<ImportRow, "row">, number>> = {};
  cells.forEach((c, i) => {
    const n = norm(c);
    for (const [key, names] of Object.entries(HEADERS)) {
      if (idx[key as keyof typeof idx] === undefined && names.some((h) => norm(h) === n)) {
        idx[key as keyof typeof idx] = i;
      }
    }
  });
  return idx;
}

function toRows(matrix: string[][]): ImportRow[] {
  const nonEmpty = matrix.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) throw new AppError("الملف فارغ");
  let header = mapHeader(nonEmpty[0]);
  let startIndex = 1;
  if (header.name === undefined) {
    // بدون صف عناوين: الترتيب الافتراضي الاسم، الجوال، البريد، مرافق
    header = { name: 0, phone: 1, email: 2, companion: 3 };
    startIndex = 0;
  }
  const rows: ImportRow[] = [];
  for (let i = startIndex; i < nonEmpty.length; i++) {
    const r = nonEmpty[i];
    rows.push({
      row: matrix.indexOf(r) + 1,
      name: header.name !== undefined ? (r[header.name] ?? "") : "",
      phone: header.phone !== undefined ? (r[header.phone] ?? "") : "",
      email: header.email !== undefined ? (r[header.email] ?? "") : "",
      companion: header.companion !== undefined ? (r[header.companion] ?? "") : "",
    });
  }
  if (rows.length === 0) throw new AppError("لا توجد صفوف بيانات بعد صف العناوين");
  if (rows.length > 5000) throw new AppError("الحد الأقصى 5000 صف في الملف الواحد");
  return rows;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const s = text.replace(/^﻿/, "");
  const delimiter = (s.split("\n")[0] ?? "").includes(";") && !(s.split("\n")[0] ?? "").includes(",") ? ";" : ",";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}

const MAX_BYTES = 5 * 1024 * 1024;

export async function parseInviteeFile(fileName: string, data: ArrayBuffer): Promise<ImportRow[]> {
  if (data.byteLength === 0) throw new AppError("الملف فارغ");
  if (data.byteLength > MAX_BYTES) throw new AppError("حجم الملف أكبر من 5 ميجابايت");
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    return toRows(parseCsv(new TextDecoder("utf-8").decode(data)));
  }
  if (lower.endsWith(".xls")) throw new AppError("صيغة .xls القديمة غير مدعومة. احفظ الملف بصيغة .xlsx أو .csv");
  if (!lower.endsWith(".xlsx")) throw new AppError("ارفع ملف Excel بصيغة .xlsx أو ملف .csv");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data);
  } catch {
    throw new AppError("تعذّرت قراءة ملف Excel. تأكد أنه بصيغة .xlsx وغير محمي بكلمة مرور");
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new AppError("لا توجد أوراق في الملف");
  const matrix: string[][] = [];
  const colCount = Math.min(ws.columnCount || 10, 30);
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= colCount; c++) cells.push(cellText(row.getCell(c).value));
    matrix.push(cells);
  }
  return toRows(matrix);
}

/** ملف Excel نموذجي للتنزيل */
export async function buildTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("المدعوون", { views: [{ rightToLeft: true }] });
  ws.columns = [
    { header: "الاسم", key: "name", width: 28 },
    { header: "الجوال", key: "phone", width: 18 },
    { header: "البريد الإلكتروني", key: "email", width: 30 },
    { header: "مرافق", key: "companion", width: 10 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getColumn("phone").numFmt = "@";
  ws.addRow({ name: "سارة العتيبي", phone: "0501234567", email: "sara@example.com", companion: "لا" });
  ws.addRow({ name: "خالد الحربي", phone: "0559876543", email: "", companion: "نعم" });
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
