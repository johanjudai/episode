/**
 * Minimal RFC 4180 CSV parser.
 *
 * Why home-grown: TV Time exports are well-formed (no embedded newlines
 * inside fields, no exotic quoting), and the largest file is ~3 MB — we
 * don't need streaming or fancy options. A 50-line parser keeps the
 * import bundle small and audit-friendly.
 *
 * Handles: double-quoted fields, escaped quotes ("" → "), embedded
 * commas inside quotes, CRLF and LF line endings, optional trailing
 * newline. Fields outside quotes are taken verbatim (TV Time never
 * trims for us — caller should `.trim()` if needed).
 */

export interface CsvRow {
  [column: string]: string;
}

/**
 * Parse a CSV text into an array of row objects keyed by the header row.
 *
 * Unknown columns are kept; missing columns (short rows) become empty
 * strings. The caller is responsible for type-coercing numeric and date
 * fields — everything we return is a string.
 */
export function parseCsv(text: string): CsvRow[] {
  const records = parseCsvRaw(text);
  if (records.length === 0) return [];
  const header = records[0];
  const out: CsvRow[] = new Array(records.length - 1);
  for (let i = 1; i < records.length; i++) {
    const row = records[i];
    const obj: CsvRow = {};
    for (let c = 0; c < header.length; c++) {
      obj[header[c]] = row[c] ?? '';
    }
    out[i - 1] = obj;
  }
  return out;
}

/**
 * Lower-level CSV → string[][] (no header interpretation). Exported so
 * tests can assert the raw tokenizer behaviour separately from the
 * header-binding pass above.
 */
export function parseCsvRaw(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  const len = text.length;

  for (let i = 0; i < len; i++) {
    const ch = text.charCodeAt(i);
    if (inQuotes) {
      if (ch === 34 /* " */) {
        if (i + 1 < len && text.charCodeAt(i + 1) === 34) {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += text[i];
      }
      continue;
    }
    if (ch === 34 /* " */) {
      inQuotes = true;
      continue;
    }
    if (ch === 44 /* , */) {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === 13 /* \r */) {
      /* Swallow \r; the following \n (if any) handles the row break. */
      if (i + 1 < len && text.charCodeAt(i + 1) === 10) continue;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    if (ch === 10 /* \n */) {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += text[i];
  }

  /* Flush the last field/row when there's no trailing newline. */
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
