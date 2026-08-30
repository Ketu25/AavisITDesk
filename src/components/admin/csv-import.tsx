"use client";

import { useRef, useState } from "react";
import Papa from "papaparse";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError } from "@/lib/api";
import { USER_ROLES } from "@/lib/database.types";
import { cn } from "@/lib/utils";

type Row = Record<string, string | null>;
type Result = { email: string; status: "invited" | "failed"; message?: string };

const TEMPLATE = `email,name,department,role
priya.sharma@aavispharma.com,Priya Sharma,QA,user
sam.oduya@aavispharma.com,Sam Oduya,IT,agent
dana.reyes@aavispharma.com,Dana Reyes,Finance,user`;

/** Header aliases people actually use in exported spreadsheets. */
const HEADER_MAP: Record<string, string> = {
  email: "email",
  "email address": "email",
  "e-mail": "email",
  mail: "email",
  name: "name",
  "full name": "name",
  fullname: "name",
  "display name": "name",
  department: "department",
  dept: "department",
  team: "department",
  role: "role",
  "access level": "role",
};

export function CsvImport({
  departments,
  onDone,
}: {
  departments: { id: string; name: string }[];
  onDone: () => void;
}) {
  const { push } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const departmentNames = new Set(departments.map((d) => d.name.toLowerCase()));

  function ingest(text: string, name: string) {
    setParseError(null);
    setResults(null);

    const parsed = Papa.parse<Row>(text, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (header) => HEADER_MAP[header.trim().toLowerCase()] ?? header.trim().toLowerCase(),
    });

    if (parsed.errors.length > 0 && parsed.data.length === 0) {
      setParseError(parsed.errors[0].message);
      return;
    }

    const cleaned = parsed.data.filter((row) => (row.email ?? "").trim().length > 0);

    if (cleaned.length === 0) {
      setParseError("No rows with an email column were found. The header must include `email`.");
      return;
    }
    if (cleaned.length > 500) {
      setParseError(`That file has ${cleaned.length} rows; the limit is 500 per import.`);
      return;
    }

    setRows(cleaned);
    setFileName(name);
  }

  function readFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => ingest(String(reader.result ?? ""), file.name);
    reader.onerror = () => setParseError("That file could not be read.");
    reader.readAsText(file);
  }

  function issueFor(row: Row): string | null {
    const email = (row.email ?? "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return "Invalid email";
    if (!(row.name ?? "").trim()) return "Missing name";
    const dept = (row.department ?? "").trim();
    if (dept && !departmentNames.has(dept.toLowerCase())) return `Unknown department "${dept}"`;
    const role = (row.role ?? "").trim().toLowerCase();
    if (role && !USER_ROLES.includes(role as never)) return `Unknown role "${role}"`;
    return null;
  }

  const problems = rows.filter((r) => issueFor(r));

  async function submit() {
    setLoading(true);
    try {
      const response = await api<{ invited: number; failed: number; results: Result[] }>(
        "/api/admin/users/import",
        // Only send rows that pass local validation; the rest are shown
        // above so the admin can fix them and re-run.
        { method: "POST", json: { rows: rows.filter((r) => !issueFor(r)) } },
      );
      setResults(response.results);
      push({
        tone: response.failed === 0 ? "success" : "info",
        title: `${response.invited} invited, ${response.failed} failed`,
        description:
          response.failed > 0 ? "Review the rows below and re-run just those." : undefined,
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
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge tone="emerald">
            {results.filter((r) => r.status === "invited").length} invited
          </Badge>
          {failed.length > 0 && <Badge tone="rose">{failed.length} failed</Badge>}
        </div>

        {failed.length > 0 && (
          <div className="max-h-64 overflow-y-auto rounded-xl border border-line">
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
            onClick={() => inputRef.current?.click()}
            className={cn(
              "flex cursor-pointer flex-col items-center rounded-xl border border-dashed px-6 py-10 text-center transition-colors",
              dragging
                ? "border-accent-line bg-accent-soft"
                : "border-line-strong hover:bg-surface-hover",
            )}
          >
            <p className="text-[0.875rem] font-medium text-ink">
              Drop a CSV here, or click to choose one
            </p>
            <p className="mt-1 text-[0.8125rem] text-ink-muted">
              Header row required: <span className="font-mono text-xs">email, name, department, role</span>
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
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

          <details className="rounded-xl border border-line bg-surface-sunk p-3">
            <summary className="cursor-pointer text-[0.8125rem] font-medium text-ink-muted">
              Show the expected format
            </summary>
            <pre className="mt-2.5 overflow-x-auto rounded-lg bg-canvas p-3 font-mono text-[0.6875rem] leading-relaxed text-ink-muted">
              {TEMPLATE}
            </pre>
            <p className="mt-2 text-[0.75rem] leading-relaxed text-ink-faint">
              <span className="font-medium">role</span> is one of user, agent, admin — it defaults
              to user. <span className="font-medium">department</span> must match an existing
              department name exactly (case-insensitive).
            </p>
          </details>
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
            Supabase&apos;s built-in mailer is rate limited. For a batch this size, configure a
            custom SMTP provider under Supabase → Authentication → Emails first, or import in
            smaller groups.
          </p>

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={reset}>
              Cancel
            </Button>
            <Button variant="primary" loading={loading} onClick={submit}>
              Invite {rows.length - problems.length} {problems.length > 0 && "valid "}
              {rows.length - problems.length === 1 ? "person" : "people"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
