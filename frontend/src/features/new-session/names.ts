import { copy } from "../../copy/en.js";

export const MAX_NAMES = 30;
export const MAX_NAME_LENGTH = 60;

/** Returns an error message, or null when the name can be added. */
export function validateName(name: string, existing: readonly string[]): string | null {
  if (existing.length >= MAX_NAMES) return copy.names.errors.tooMany(MAX_NAMES);
  if (name.length > MAX_NAME_LENGTH) return copy.names.errors.tooLong(MAX_NAME_LENGTH);
  const key = name.toLocaleLowerCase();
  if (existing.some((item) => item.toLocaleLowerCase() === key)) return copy.names.errors.duplicate;
  return null;
}
