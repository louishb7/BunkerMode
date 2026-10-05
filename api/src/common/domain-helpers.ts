import { HttpException, HttpStatus } from "@nestjs/common";

export function requiredText(
  value: unknown,
  message: string,
  maxLength?: number,
): string {
  if (typeof value !== "string") {
    throw new HttpException(message, HttpStatus.BAD_REQUEST);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new HttpException(message, HttpStatus.BAD_REQUEST);
  }
  if (maxLength !== undefined && normalized.length > maxLength) {
    throw new HttpException(message, HttpStatus.BAD_REQUEST);
  }
  return normalized;
}

export function optionalText(
  value: unknown,
  message = "Campo textual inválido.",
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new HttpException(message, HttpStatus.BAD_REQUEST);
  }
  const normalized = value.trim();
  return normalized || null;
}

export function positiveInt(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new HttpException(message, HttpStatus.BAD_REQUEST);
  }
  return value;
}

export function parseIsoDate(value: unknown, message: string): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw new HttpException(message, HttpStatus.BAD_REQUEST);
  }
  const [year, month, day] = value.trim().split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new HttpException(message, HttpStatus.BAD_REQUEST);
  }
  return date;
}

export function dateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function dateTime(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

// Event time is supplied by offline clients; database defaults still record receipt.
// Require a timezone so replay never interprets an event in the server's local zone.
export function eventTimestamp(value: unknown, now = new Date()): Date {
  if (value === undefined) return now;
  const match = typeof value === "string"
    ? /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value)
    : null;
  const message = "Data e hora da ocorrência inválidas.";
  if (!match) throw new HttpException(message, HttpStatus.BAD_REQUEST);
  parseIsoDate(match[1], message);
  const date = new Date(value as string);
  if (!Number.isFinite(date.getTime()) || date.getTime() > now.getTime() + 5 * 60_000)
    throw new HttpException(message, HttpStatus.BAD_REQUEST);
  return date;
}
