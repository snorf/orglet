/**
 * Minimal RFC 4180 CSV parser and writer for the Bulk API 2.0 surface. No external
 * dependency. The parser accepts LF, CRLF or lone CR line breaks regardless of the job's
 * declared line ending, since real-world uploads are not always consistent about it.
 */

export type ColumnDelimiter = "COMMA" | "TAB" | "PIPE" | "SEMICOLON" | "CARET" | "BACKQUOTE";
export type LineEnding = "LF" | "CRLF";

const DELIMITER_CHARS: Record<ColumnDelimiter, string> = {
  COMMA: ",",
  TAB: "\t",
  PIPE: "|",
  SEMICOLON: ";",
  CARET: "^",
  BACKQUOTE: "`",
};

const LINE_ENDING_CHARS: Record<LineEnding, string> = {
  LF: "\n",
  CRLF: "\r\n",
};

export function delimiterChar(d: ColumnDelimiter): string {
  return DELIMITER_CHARS[d];
}

export function lineEndingChars(l: LineEnding): string {
  return LINE_ENDING_CHARS[l];
}

export interface ParsedCsv {
  header: string[];
  rows: string[][];
}

/**
 * Parse CSV text into a header row and data rows. A quote only opens a quoted field at the
 * start of a field (RFC 4180 shape); doubled quotes inside a quoted field are an escaped
 * quote. Trailing blank lines (a lone empty field from a final line break) are dropped.
 */
export function parseCsv(text: string, delimiter = ","): ParsedCsv {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const c = text.charAt(i);
    if (inQuotes) {
      if (c === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"' && field === "") {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === delimiter) {
      pushField();
      i += 1;
      continue;
    }
    if (c === "\r") {
      if (text.charAt(i + 1) === "\n") i += 1;
      pushRow();
      i += 1;
      continue;
    }
    if (c === "\n") {
      pushRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field !== "" || row.length > 0) pushRow();

  // Drop a trailing artifact row produced by a final line break (a single empty field).
  while (rows.length > 0) {
    const last = rows[rows.length - 1] as string[];
    if (last.length === 1 && last[0] === "") rows.pop();
    else break;
  }

  const [header, ...dataRows] = rows;
  return { header: header ?? [], rows: dataRows };
}

/** Escape one CSV field per RFC 4180: quote it when it holds the delimiter, a quote or a newline. */
export function csvField(value: string, delimiter = ","): string {
  if (value.includes(delimiter) || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Write a full CSV document (header + rows) with the given delimiter and line ending. */
export function writeCsv(header: string[], rows: string[][], delimiter = ",", lineEnding = "\n"): string {
  const line = (fields: string[]) => fields.map((f) => csvField(f, delimiter)).join(delimiter);
  return [line(header), ...rows.map(line)].map((l) => l + lineEnding).join("");
}
