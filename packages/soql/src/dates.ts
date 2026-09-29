/**
 * SOQL date literals as half-open UTC ranges [start, end). Weeks start on Sunday (en_US
 * locale, the org default); fiscal periods follow the calendar year in phase 0.
 */
export interface DateRange {
  start: Date;
  end: Date;
}

const DAY = 86_400_000;

function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d));
}

function startOfDay(now: Date): Date {
  return utcDate(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY);
}

function addMonths(d: Date, n: number): Date {
  return utcDate(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate());
}

function startOfWeek(now: Date): Date {
  const day = startOfDay(now);
  return addDays(day, -day.getUTCDay());
}

function startOfMonth(now: Date): Date {
  return utcDate(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

function startOfQuarter(now: Date): Date {
  return utcDate(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1);
}

function startOfYear(now: Date): Date {
  return utcDate(now.getUTCFullYear(), 0, 1);
}

const range = (start: Date, end: Date): DateRange => ({ start, end });

export function dateLiteralRange(literal: string, now: Date): DateRange | undefined {
  const today = startOfDay(now);
  switch (literal.toUpperCase()) {
    case "YESTERDAY":
      return range(addDays(today, -1), today);
    case "TODAY":
      return range(today, addDays(today, 1));
    case "TOMORROW":
      return range(addDays(today, 1), addDays(today, 2));
    case "LAST_WEEK":
      return range(addDays(startOfWeek(now), -7), startOfWeek(now));
    case "THIS_WEEK":
      return range(startOfWeek(now), addDays(startOfWeek(now), 7));
    case "NEXT_WEEK":
      return range(addDays(startOfWeek(now), 7), addDays(startOfWeek(now), 14));
    case "LAST_MONTH":
      return range(addMonths(startOfMonth(now), -1), startOfMonth(now));
    case "THIS_MONTH":
      return range(startOfMonth(now), addMonths(startOfMonth(now), 1));
    case "NEXT_MONTH":
      return range(addMonths(startOfMonth(now), 1), addMonths(startOfMonth(now), 2));
    case "LAST_90_DAYS":
      return range(addDays(today, -90), addDays(today, 1));
    case "NEXT_90_DAYS":
      return range(addDays(today, 1), addDays(today, 91));
    case "LAST_QUARTER":
    case "LAST_FISCAL_QUARTER":
      return range(addMonths(startOfQuarter(now), -3), startOfQuarter(now));
    case "THIS_QUARTER":
    case "THIS_FISCAL_QUARTER":
      return range(startOfQuarter(now), addMonths(startOfQuarter(now), 3));
    case "NEXT_QUARTER":
    case "NEXT_FISCAL_QUARTER":
      return range(addMonths(startOfQuarter(now), 3), addMonths(startOfQuarter(now), 6));
    case "LAST_YEAR":
    case "LAST_FISCAL_YEAR":
      return range(utcDate(now.getUTCFullYear() - 1, 0, 1), startOfYear(now));
    case "THIS_YEAR":
    case "THIS_FISCAL_YEAR":
      return range(startOfYear(now), utcDate(now.getUTCFullYear() + 1, 0, 1));
    case "NEXT_YEAR":
    case "NEXT_FISCAL_YEAR":
      return range(utcDate(now.getUTCFullYear() + 1, 0, 1), utcDate(now.getUTCFullYear() + 2, 0, 1));
    default:
      return undefined;
  }
}

/** `LAST_N_DAYS:n` style literals. `LAST_N_*` includes today; `NEXT_N_*` starts tomorrow. */
export function dateNLiteralRange(literal: string, n: number, now: Date): DateRange | undefined {
  const today = startOfDay(now);
  switch (literal.toUpperCase()) {
    case "LAST_N_DAYS":
      return range(addDays(today, -n), addDays(today, 1));
    case "NEXT_N_DAYS":
      return range(addDays(today, 1), addDays(today, n + 1));
    case "N_DAYS_AGO":
      return range(addDays(today, -n), addDays(today, -n + 1));
    case "LAST_N_WEEKS":
      return range(addDays(startOfWeek(now), -7 * n), startOfWeek(now));
    case "NEXT_N_WEEKS":
      return range(addDays(startOfWeek(now), 7), addDays(startOfWeek(now), 7 * (n + 1)));
    case "N_WEEKS_AGO":
      return range(addDays(startOfWeek(now), -7 * n), addDays(startOfWeek(now), -7 * (n - 1)));
    case "LAST_N_MONTHS":
      return range(addMonths(startOfMonth(now), -n), startOfMonth(now));
    case "NEXT_N_MONTHS":
      return range(addMonths(startOfMonth(now), 1), addMonths(startOfMonth(now), n + 1));
    case "N_MONTHS_AGO":
      return range(addMonths(startOfMonth(now), -n), addMonths(startOfMonth(now), -n + 1));
    case "LAST_N_QUARTERS":
    case "LAST_N_FISCAL_QUARTERS":
      return range(addMonths(startOfQuarter(now), -3 * n), startOfQuarter(now));
    case "NEXT_N_QUARTERS":
    case "NEXT_N_FISCAL_QUARTERS":
      return range(addMonths(startOfQuarter(now), 3), addMonths(startOfQuarter(now), 3 * (n + 1)));
    case "N_QUARTERS_AGO":
    case "N_FISCAL_QUARTERS_AGO":
      return range(addMonths(startOfQuarter(now), -3 * n), addMonths(startOfQuarter(now), -3 * (n - 1)));
    case "LAST_N_YEARS":
    case "LAST_N_FISCAL_YEARS":
      return range(utcDate(now.getUTCFullYear() - n, 0, 1), startOfYear(now));
    case "NEXT_N_YEARS":
    case "NEXT_N_FISCAL_YEARS":
      return range(utcDate(now.getUTCFullYear() + 1, 0, 1), utcDate(now.getUTCFullYear() + n + 1, 0, 1));
    case "N_YEARS_AGO":
    case "N_FISCAL_YEARS_AGO":
      return range(utcDate(now.getUTCFullYear() - n, 0, 1), utcDate(now.getUTCFullYear() - n + 1, 0, 1));
    default:
      return undefined;
  }
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
