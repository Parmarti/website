import { fromZonedTime } from "date-fns-tz";

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse a schedule time. ISO strings with an offset or "Z" are absolute.
 * Strings without an offset (e.g. "2026-12-01T09:00") are read in the given IANA timezone.
 */
export function parseScheduledFor(value: string, timezone = "UTC"): Date {
  const hasOffset = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value.trim());
  const date = hasOffset ? new Date(value) : fromZonedTime(value, timezone);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid scheduledFor value: ${value}`);
  return date;
}
