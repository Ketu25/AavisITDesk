"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { Icons } from "@/components/shell/icons";
import { api, ApiClientError } from "@/lib/api";
import { USER_ROLES } from "@/lib/database.types";
import { departmentKey, MAX_IMPORT_ROWS, type ImportOptions } from "@/lib/people-import";
import {
  buildTemplate,
  isSampleRow,
  readPeopleFile,
  saveFile,
  TEMPLATE_FILE_NAME,
  type PersonRow,
} from "./import-file";
import { CredentialsPanel } from "./credentials-panel";
import { cn } from "@/lib/utils";

type Result = {
  email: string;
  status: "created" | "failed";
  name?: string;
  temp_password?: string;
  message?: string;
};

export function CsvImport({
  departments,
  allowedDomains,
  onDone,
}: {
  departments: { id: string; name: string }[];
  allowedDomains: string[];
  onDone: () => void;
}) {
  const { push } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  // Seeded from the page, then replaced by a live read when the dialog opens,
  // when the template is downloaded, and when a file is chosen.
  const [options, setOptions] = useState<ImportOptions>(() => ({
    departments,
    allowedDomains,
    roles: USER_ROLES,
  }));
  const optionsRequest = useRef(0);
  const readingRef = useRef(false);

  const [rows, setRows] = useState<PersonRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [dragging, setDragging] = useState(false);

  const departmentKeys = new Set(options.departments.map((d) => departmentKey(d.name)));
  const activationUrl =
    typeof window === "undefined" ? "/activate" : `${window.location.origin}/activate`;

  /** Reads what is live right now; when reads overlap, only the newest lands. */
  const loadOptions = useCallback(async () => {
    const request = ++optionsRequest.current;
    const live = await api<ImportOptions>("/api/admin/users/import", { cache: "no-store" });
    if (request === optionsRequest.current) setOptions(live);
    return live;
  }, []);

  useEffect(() => {
    // A failure keeps the page's copy; the server checks every row regardless.
    loadOptions().catch(() => {});
  }, [loadOptions]);

  async function readFile(file: File) {
    // One file at a time: a second drop mid-read would race the first.
    if (readingRef.current) return;
    readingRef.current = true;
    setReading(true);
    setParseError(null);
    setResults(null);

    try {
      // Validate against what is live now, not what was live when the page loaded.
      const [table] = await Promise.all([readPeopleFile(file), loadOptions().catch(() => {})]);

      if (typeof table === "string") {
        setParseError(table);
        return;
      }
      if (!table.fields.includes("email")) {
        setParseError(
          "The header row needs an email column. Download the template and keep its header row as it is.",
        );
        return;
      }

      // A row with a name but no email is kept, so it is flagged below rather
      // than silently left out of the import.
      const people = table.rows.filter((row) => Object.values(row).some(Boolean));

      if (people.length === 0) {
        setParseError("That file has a header row but no people yet. Add one row per person under it.");
        return;
      }
      if (people.length > MAX_IMPORT_ROWS) {
        setParseError(`That file has ${people.length} rows; the limit is ${MAX_IMPORT_ROWS} per import.`);
        return;
      }

      setRows(people);
      setFileName(file.name);
    } catch {
      setParseError("That file could not be read.");
    } finally {
      readingRef.current = false;
      setReading(false);
    }
  }

  async function downloadTemplate() {
    setPreparing(true);
    try {
      // Read at the moment of download, so the dropdowns hold exactly the
      // departments and roles that are live right now.
      const live = await loadOptions();
      saveFile(await buildTemplate(live), TEMPLATE_FILE_NAME);
    } catch (error) {
      push({
        tone: "error",
        title: "The template could not be prepared",
        description: error instanceof ApiClientError ? error.message : "Please try again.",
      });
    } finally {
      setPreparing(false);
    }
  }

  function issueFor(row: PersonRow): string | null {
    if (isSampleRow(row)) return "Sample row from the template — replace or delete it";
    if (!row.email) return "Missing email";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) return "Invalid email";
    if (!row.name) return "Missing name";
    // Mirrors the import route's limit, so the row is caught before sending.
    if (row.name.length > 120) return "Name is over 120 characters";
    if (row.department && !departmentKeys.has(departmentKey(row.department))) {
      return `Not an active department: "${row.department}"`;
    }
    const role = row.role.toLowerCase();
    if (role && !options.roles.includes(role)) return `Unknown role "${row.role}"`;
    return null;
  }

  const problems = rows.filter((r) => issueFor(r));
  const validCount = rows.length - problems.length;

  async function submit() {
    setLoading(true);
    try {
      const response = await api<{ created: number; failed: number; results: Result[] }>(
        "/api/admin/users/import",
        // Only send rows that pass local validation; the rest are shown
        // above so the admin can fix them and re-run.
        { method: "POST", json: { rows: rows.filter((r) => !issueFor(r)) } },
      );
      setResults(response.results);
      push({
        tone: response.failed === 0 ? "success" : "info",
        title: `${response.created} created, ${response.failed} failed`,
        description:
          response.failed > 0
            ? "Review the rows below and re-run just those."
            : "Copy the passwords before closing — they are not shown again.",
      });
      onDone();
    } catch (error) {
      push({
        tone: "error",
        title: "Import failed",
        description: error instanceof ApiClientError ? error.message : "Please try again.",
      });
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setRows([]);
    setFileName(null);
    setResults(null);
    setParseError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  if (results) {
    const failed = results.filter((r) => r.status === "failed");
    const created = results.filter((r) => r.status === "created" && r.temp_password);

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge tone="emerald">{created.length} created</Badge>
          {failed.length > 0 && <Badge tone="rose">{failed.length} failed</Badge>}
        </div>

        {created.length > 0 && (
          <CredentialsPanel
            credentials={created.map((r) => ({
              email: r.email,
              full_name: r.name,
              temp_password: r.temp_password!,
            }))}
            activationUrl={activationUrl}
          />
        )}

        {failed.length > 0 && (
          <div>
            <p className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-faint">
              Not created
            </p>
            <div className="max-h-48 overflow-y-auto rounded-xl border border-line">
              <table className="w-full text-[0.8125rem]">
                <tbody>
                  {failed.map((row, index) => (
                    <tr key={index} className="border-b border-line last:border-b-0">
                      <td className="w-1/2 px-3 py-2 font-mono text-xs text-ink">{row.email}</td>
                      <td className="px-3 py-2 text-ink-muted">{row.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="secondary" onClick={reset}>
            Import another file
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) readFile(file);
            }}
            onClick={() => {
              if (!reading) inputRef.current?.click();
            }}
            aria-busy={reading}
            className={cn(
              "flex cursor-pointer flex-col items-center rounded-xl border border-dashed px-6 py-10 text-center transition-colors",
              reading && "cursor-progress",
              dragging
                ? "border-accent-line bg-accent-soft"
                : "border-line-strong hover:bg-surface-hover",
            )}
          >
            <p className="text-[0.875rem] font-medium text-ink">
              {reading ? "Reading the file…" : "Drop the filled-in template here, or click to choose it"}
            </p>
            <p className="mt-1 text-[0.8125rem] text-ink-muted">
              Excel (.xlsx) or CSV · up to {MAX_IMPORT_ROWS} people per file
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Cleared so choosing the same file again, after fixing it,
                // still fires a change.
                e.target.value = "";
                if (file) readFile(file);
              }}
            />
          </div>

          <AnimatePresence>
            {parseError && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="rounded-lg border border-[rgb(244_63_94_/_0.3)] bg-[rgb(244_63_94_/_0.08)] px-3 py-2.5 text-[0.8125rem] text-ink"
              >
                {parseError}
              </motion.p>
            )}
          </AnimatePresence>

          <div className="rounded-xl border border-line bg-surface-sunk p-3">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <p className="min-w-0 flex-1 basis-56 text-[0.8125rem] leading-relaxed text-ink-muted">
                Start from the Excel template: department and role are drop-downs of what is
                live right now. Keep its header row and replace the two example rows with one
                row per person.
              </p>
              <Button
                size="sm"
                variant="secondary"
                icon={<Icons.download className="size-3.5" />}
                loading={preparing}
                onClick={downloadTemplate}
              >
                Download template
              </Button>
            </div>

            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 border-t border-line pt-3 text-[0.75rem] leading-relaxed">
              <dt className="font-mono text-ink">email</dt>
              <dd className="flex flex-wrap items-center gap-1 text-ink-faint">
                {options.allowedDomains.length ? (
                  <>
                    <span>Required · allowed domains</span>
                    <Values items={options.allowedDomains} />
                  </>
                ) : (
                  <span>Required · no domain allow-list is set — add one under Settings</span>
                )}
              </dd>
              <dt className="font-mono text-ink">name</dt>
              <dd className="text-ink-faint">Required · their full name</dd>
              <dt className="font-mono text-ink">department</dt>
              <dd className="flex flex-wrap items-center gap-1 text-ink-faint">
                {options.departments.length ? (
                  <>
                    <span>Optional · one of</span>
                    <Values items={options.departments.map((d) => d.name)} />
                  </>
                ) : (
                  <span>Optional · no active departments yet, so leave it blank</span>
                )}
              </dd>
              <dt className="font-mono text-ink">role</dt>
              <dd className="flex flex-wrap items-center gap-1 text-ink-faint">
                <span>Optional · one of</span>
                <Values items={options.roles} />
                <span>— blank means user</span>
              </dd>
            </dl>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[0.8125rem] text-ink-muted">
              <span className="font-medium text-ink">{fileName}</span> · {rows.length} row
              {rows.length === 1 ? "" : "s"}
              {problems.length > 0 && (
                <span className="ml-2 text-[#e11d48] dark:text-[#fb7185]">
                  {problems.length} need attention
                </span>
              )}
            </p>
            <Button size="sm" variant="ghost" onClick={reset}>
              Choose a different file
            </Button>
          </div>

          <div className="max-h-72 overflow-auto rounded-xl border border-line">
            <table className="w-full text-[0.8125rem]">
              <thead className="sticky top-0 bg-canvas-raised">
                <tr className="border-b border-line text-left text-[0.6875rem] uppercase tracking-wider text-ink-faint">
                  <th className="px-3 py-2 font-semibold">Email</th>
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Department</th>
                  <th className="px-3 py-2 font-semibold">Role</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const issue = issueFor(row);
                  return (
                    <tr
                      key={index}
                      className={cn(
                        "border-b border-line last:border-b-0",
                        issue && "bg-[rgb(244_63_94_/_0.06)]",
                      )}
                    >
                      <td className="px-3 py-1.5 font-mono text-xs text-ink">
                        {row.email}
                        {issue && (
                          <span className="ml-2 font-sans text-[0.6875rem] text-[#e11d48] dark:text-[#fb7185]">
                            {issue}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-ink-muted">{row.name}</td>
                      <td className="px-3 py-1.5 text-ink-muted">{row.department || "—"}</td>
                      <td className="px-3 py-1.5 text-ink-muted">{row.role || "user"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-[0.75rem] leading-relaxed text-ink-faint">
            Each person gets a generated temporary password, shown once after the import so you
            can distribute them. Nothing is emailed, so a full company import runs in one pass
            with no rate limit.
          </p>

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={reset}>
              Cancel
            </Button>
            <Button variant="primary" loading={loading} disabled={validCount === 0} onClick={submit}>
              Create {validCount} {problems.length > 0 && "valid "}
              {validCount === 1 ? "account" : "accounts"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Accepted values as separate chips, so a name with a comma reads as one. */
function Values({ items }: { items: readonly string[] }) {
  return items.map((item) => (
    <code
      key={item}
      className="rounded border border-line bg-canvas px-1 font-mono text-[0.6875rem] text-ink-muted"
    >
      {item}
    </code>
  ));
}
