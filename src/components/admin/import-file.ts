import Papa from "papaparse";
import { MAX_IMPORT_ROWS, type ImportOptions } from "@/lib/people-import";

/** One person as the import dialog sees them: every field a trimmed string. */
export type PersonRow = { email: string; name: string; department: string; role: string };

/** The header the file used, plus its people. Blank rows are not dropped yet. */
export type PeopleTable = { fields: string[]; rows: PersonRow[] };

const COLUMNS = ["email", "name", "department", "role"] as const;
type Column = (typeof COLUMNS)[number];

export const TEMPLATE_FILE_NAME = "aavis-it-desk-people-import-template.xlsx";

/** A 500-person import is tens of kilobytes; anything near this is the wrong file. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const PEOPLE_SHEET = "People";
const LISTS_SHEET = "Lists";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const SAVE_AS = "Save it as an Excel Workbook (.xlsx) or CSV UTF-8 and upload that.";

/** Header aliases people actually use in exported spreadsheets. */
const HEADER_MAP: Record<string, Column> = {
  email: "email",
  "email address": "email",
  "e-mail": "email",
  mail: "email",
  name: "name",
  "full name": "name",
  fullname: "name",
  "display name": "name",
  department: "department",
  dept: "department",
  team: "department",
  role: "role",
  "access level": "role",
};

/**
 * The placeholder people in the template. A row still carrying one of these
 * addresses or names is refused, so a template uploaded with its examples left
 * in never creates accounts for them.
 */
const SAMPLE_PEOPLE = [
  { handle: "example.user", name: "Example User", role: "user" },
  { handle: "example.agent", name: "Example Agent", role: "agent" },
] as const;

const SAMPLE_HANDLES = new Set<string>(SAMPLE_PEOPLE.map((p) => p.handle));
const SAMPLE_NAMES = new Set<string>(SAMPLE_PEOPLE.map((p) => p.name.toLowerCase()));

/** Zero-width characters and soft hyphens ride along when text is pasted from mail or the web. */
const INVISIBLE = /[­​-‍⁠﻿]/g;

export function isSampleRow(row: PersonRow) {
  const email = row.email.toLowerCase();
  const handle = email.includes("@") ? email.slice(0, email.indexOf("@")) : "";
  return SAMPLE_HANDLES.has(handle) || SAMPLE_NAMES.has(row.name.toLowerCase());
}

/** ExcelJS is large, so it is only fetched when a workbook is built or read. */
async function loadExcel() {
  const mod = await import("exceljs");
  // A CommonJS package: depending on interop its API is on `default` or the namespace.
  return mod.default ?? mod;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

/** `dataValidations.add` accepts a whole range but is missing from the typings. */
type RangeValidations = {
  dataValidations: { add(range: string, validation: import("exceljs").DataValidation): void };
};

export async function buildTemplate({ departments, allowedDomains, roles }: ImportOptions) {
  const { Workbook } = await loadExcel();

  // Examples use the real allow-listed domain and departments so they show
  // exactly what is accepted; example.com stands in when no domain is set.
  const domain =
    allowedDomains
      .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
      .find((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) ?? "example.com";

  const workbook = new Workbook();
  workbook.creator = "Aavis IT Desk";
  workbook.created = new Date();

  const people = workbook.addWorksheet(PEOPLE_SHEET, {
    views: [{ state: "frozen", xSplit: 0, ySplit: 1 }],
  });
  // The dropdowns read their choices from here rather than from an inline
  // list, which Excel caps at 255 characters and splits on every comma.
  const lists = workbook.addWorksheet(LISTS_SHEET, { state: "hidden" });

  const longestDepartment = Math.max(0, ...departments.map((d) => d.name.length));

  // Text format keeps what is typed or picked exactly as written, instead of
  // Excel turning a department called "1-2" into a date.
  people.columns = [
    { header: "email", key: "email", width: 34, style: { numFmt: "@" } },
    { header: "name", key: "name", width: 26, style: { numFmt: "@" } },
    {
      header: "department",
      key: "department",
      width: Math.min(Math.max(16, longestDepartment + 4), 60),
      style: { numFmt: "@" },
    },
    { header: "role", key: "role", width: 12, style: { numFmt: "@" } },
  ];
  for (let column = 1; column <= COLUMNS.length; column++) {
    people.getCell(1, column).font = { bold: true };
  }

  SAMPLE_PEOPLE.forEach((person, index) => {
    people.addRow({
      email: `${person.handle}@${domain}`,
      name: person.name,
      department: departments.length ? departments[index % departments.length].name : "",
      role: roles.includes(person.role) ? person.role : "",
    });
  });

  lists.getCell(1, 1).value = "department";
  departments.forEach((d, index) => (lists.getCell(index + 2, 1).value = d.name));
  lists.getCell(1, 2).value = "role";
  roles.forEach((role, index) => (lists.getCell(index + 2, 2).value = role));

  // Covers every row an import can hold. Excel limits these titles to 32
  // characters and messages to 225, or it reports the file as damaged.
  const lastRow = MAX_IMPORT_ROWS + 1;
  const { dataValidations } = people as unknown as RangeValidations;

  if (departments.length) {
    dataValidations.add(`C2:C${lastRow}`, {
      type: "list",
      allowBlank: true,
      formulae: [`${LISTS_SHEET}!$A$2:$A$${departments.length + 1}`],
      showErrorMessage: true,
      errorStyle: "stop",
      errorTitle: "Not a department",
      error: "Pick a department from the list, or leave the cell blank.",
    });
  }
  if (roles.length) {
    dataValidations.add(`D2:D${lastRow}`, {
      type: "list",
      allowBlank: true,
      formulae: [`${LISTS_SHEET}!$B$2:$B$${roles.length + 1}`],
      showErrorMessage: true,
      errorStyle: "stop",
      errorTitle: "Not a role",
      error: "Pick a role from the list, or leave the cell blank for user.",
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer as ArrayBuffer], { type: XLSX_TYPE });
}

export function saveFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Some browsers only start reading the blob after click() returns, so it
  // is released later rather than immediately.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// ---------------------------------------------------------------------------
// Reading an upload
// ---------------------------------------------------------------------------

/** Reads an uploaded workbook or CSV into a table, or says why it can't. */
export async function readPeopleFile(file: File): Promise<PeopleTable | string> {
  if (file.size === 0) return "That file is empty. Download the template and add one row per person.";
  if (file.size > MAX_FILE_BYTES) {
    return `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — far larger than a ${MAX_IMPORT_ROWS}-person import. Check it's the right file.`;
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return "That file could not be read.";
  }

  const name = file.name.toLowerCase();

  // .xlsx, .xlsm, .xlsb, .numbers and .ods are all zip archives.
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    if (/\.(numbers|ods)$/.test(name)) return `Numbers and OpenDocument files can't be read. ${SAVE_AS}`;

    let table: PeopleTable | null;
    try {
      table = await readWorkbook(bytes);
    } catch {
      return "The spreadsheet reader couldn't load. Check your connection and try again.";
    }
    return table ?? `That workbook couldn't be read. ${SAVE_AS}`;
  }

  // An OLE file is either a legacy .xls or an .xlsx that is encrypted — by a
  // password, or by a sensitivity label, which looks the same from here.
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) {
    return /\.xls[xmb]$/.test(name)
      ? "That workbook is password-protected or encrypted (sensitivity labels do this too). Save an unprotected copy and upload that."
      : `Older .xls workbooks can't be read. ${SAVE_AS}`;
  }

  if (/\.(xlsx|xlsm|xlsb|xls|numbers|ods)$/.test(name)) {
    return `That file couldn't be read as a workbook. ${SAVE_AS}`;
  }

  const text = decodeText(bytes);
  if (text === null) {
    return `That file isn't saved as UTF-8, so accented names would arrive garbled. ${SAVE_AS}`;
  }
  if (!text.trim()) return "That file is empty. Download the template and add one row per person.";

  return readCsv(text);
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((byte, index) => bytes[index] === byte);
}

/**
 * Strict UTF-8, so a file saved in a legacy codepage is turned away instead of
 * importing "José" as "Jos�". UTF-16 is read when it carries a byte-order mark
 * (Excel's "Unicode Text").
 */
function decodeText(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function columnFor(header: string) {
  const key = clean(header).toLowerCase();
  return HEADER_MAP[key] ?? key;
}

function readCsv(text: string): PeopleTable {
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: columnFor,
  });

  return {
    fields: parsed.meta.fields ?? [],
    rows: parsed.data.map((row) => toPerson((column) => row[column])),
  };
}

/** Returns null when the bytes are not a workbook ExcelJS can open. */
async function readWorkbook(bytes: Uint8Array): Promise<PeopleTable | null> {
  const { Workbook } = await loadExcel();
  const workbook = new Workbook();

  try {
    // Typed as a Node Buffer; the browser build takes an ArrayBuffer.
    await workbook.xlsx.load(bytes.buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    return null;
  }

  type Sheet = (typeof workbook.worksheets)[number];

  function headerOf(sheet: Sheet) {
    const positions = new Map<string, number>();
    sheet.getRow(1).eachCell((cell, column) => {
      const field = columnFor(cellText(cell.value));
      if (field && !positions.has(field)) positions.set(field, column);
    });
    return positions;
  }

  // The template's sheet first, then any visible sheet; the first with an
  // email column wins, so a renamed or reordered workbook still imports.
  const candidates = [
    ...workbook.worksheets.filter((s) => s.name.trim().toLowerCase() === PEOPLE_SHEET.toLowerCase()),
    ...workbook.worksheets.filter((s) => s.state === "visible"),
  ];
  const sheet = candidates.find((s) => headerOf(s).has("email")) ?? candidates[0];
  // Any zip opens without error — a .docx renamed to .xlsx included — but only
  // a workbook has sheets.
  if (!sheet) return null;

  const positions = headerOf(sheet);
  const rows: PersonRow[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    rows.push(
      toPerson((column) => {
        const position = positions.get(column);
        return position ? row.getCell(position).value : null;
      }),
    );
  });

  return { fields: [...positions.keys()], rows };
}

/**
 * Excel hands back more than strings: an email typed into a cell usually
 * becomes a hyperlink, formulas carry a cached result, and formatted text is
 * a list of runs.
 */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  }
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((run: { text?: unknown }) => cellText(run.text)).join("");
    }
    if ("text" in value) return cellText(value.text);
    if ("result" in value) return cellText(value.result);
  }
  // Error values (#N/A and friends) and anything unrecognised read as blank.
  return "";
}

/** Line breaks within a cell, repeated spaces and invisible characters all go. */
function clean(value: unknown) {
  return cellText(value).replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
}

function toPerson(read: (column: Column) => unknown): PersonRow {
  return {
    email: clean(read("email")),
    name: clean(read("name")),
    department: clean(read("department")),
    role: clean(read("role")),
  };
}
