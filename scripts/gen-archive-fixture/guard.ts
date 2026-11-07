/**
 * Leak guard for the archive fixture (Phase 16 D-04): before anything is written, every Id in the generated Bulk CSVs must come from the generator's own allocation and every datetime must fall inside the period window, so a wall-clock stamp or a random Id cannot slip into the committed fixture. Diagnostics name object and field only, never a cell (PITFALLS P22).
 */
export interface GuardCsv {
  objectName: string;
  deleted: boolean;
  header: readonly string[];
  rows: readonly (readonly string[])[];
  referenceColumns: ReadonlySet<string>;
}

/** Salesforce `+0000` datetimes, inclusive. */
export interface GuardWindow {
  from: string;
  to: string;
}

export type LeakReason = "unallocated-id" | "datetime-outside-window";

export class FixtureLeakError extends Error {
  constructor(
    readonly objectName: string,
    readonly field: string,
    readonly reason: LeakReason,
  ) {
    super(`fixture leak guard: ${objectName}.${field}: ${reason}`);
    this.name = "FixtureLeakError";
  }
}

const DATETIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}\+0000$/;

export function checkLeaks(csvs: readonly GuardCsv[], allocated: ReadonlySet<string>, window: GuardWindow): void {
  for (const csv of csvs) {
    const name = `${csv.objectName}${csv.deleted ? "_deleted" : ""}`;
    for (const row of csv.rows) {
      csv.header.forEach((field, i) => {
        const cell = row[i] ?? "";
        if (cell === "") return;
        if ((field === "Id" || csv.referenceColumns.has(field)) && !allocated.has(cell)) throw new FixtureLeakError(name, field, "unallocated-id");
        // The fixed-width UTC form sorts lexically, so string comparison is the window test.
        if (DATETIME.test(cell) && (cell < window.from || cell > window.to)) throw new FixtureLeakError(name, field, "datetime-outside-window");
      });
    }
  }
}
