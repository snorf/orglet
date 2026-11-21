/**
 * Small whole-text reader for Bulk 2.0 CSV as Heimdall stores it (LF line endings). A streaming reader is the
 * archive loader's concern. Errors carry a line number and a reason, never cell content.
 */

export type ArchiveCsvReason = "empty" | "missing-final-newline" | "unterminated-quote" | "ragged-row" | "carriage-return";

export class ArchiveCsvError extends Error {
  constructor(
    readonly line: number,
    readonly reason: ArchiveCsvReason,
  ) {
    super(`bulk csv: ${reason} at line ${line}`);
    this.name = "ArchiveCsvError";
  }
}

export interface BulkCsv {
  header: string[];
  rows: string[][];
}

export function parseBulkCsv(text: string): BulkCsv {
  if (text.length === 0) throw new ArchiveCsvError(1, "empty");
  const records: { cells: string[]; line: number }[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuote = false;
  let atFieldStart = true;
  let line = 1;
  let recordLine = 1;
  let quoteLine = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuote = false;
      } else {
        if (c === "\n") line++;
        field += c;
      }
      continue;
    }
    if (c === '"' && atFieldStart) {
      inQuote = true;
      atFieldStart = false;
      quoteLine = line;
    } else if (c === ",") {
      cells.push(field);
      field = "";
      atFieldStart = true;
    } else if (c === "\n") {
      cells.push(field);
      records.push({ cells, line: recordLine });
      cells = [];
      field = "";
      atFieldStart = true;
      line++;
      recordLine = line;
    } else if (c === "\r") {
      throw new ArchiveCsvError(line, "carriage-return");
    } else {
      field += c;
      atFieldStart = false;
    }
  }
  if (inQuote) throw new ArchiveCsvError(quoteLine, "unterminated-quote");
  if (!text.endsWith("\n")) throw new ArchiveCsvError(line, "missing-final-newline");
  const [head, ...rest] = records;
  const header = head!.cells;
  for (const r of rest) if (r.cells.length !== header.length) throw new ArchiveCsvError(r.line, "ragged-row");
  return { header, rows: rest.map((r) => r.cells) };
}
