/**
 * Shared by the bulk-import route and the import dialog, so the two can never
 * disagree on the row limit or on when two department names are the same.
 */

/** What the import template offers, read live when it is downloaded. */
export type ImportOptions = {
  departments: { id: string; name: string }[];
  allowedDomains: string[];
  roles: string[];
};

export const MAX_IMPORT_ROWS = 500;

/**
 * Department names match case-insensitively and regardless of repeated or
 * surrounding whitespace, so "human  resources " finds "Human Resources".
 */
export function departmentKey(name: string) {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}
