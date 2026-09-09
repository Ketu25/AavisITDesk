"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError } from "@/lib/api";
import { PRIORITY_META } from "@/lib/constants";
import { minutesToLabel } from "@/lib/format";
import type { SlaRule } from "@/lib/database.types";
import { Stagger, StaggerItem } from "@/components/motion";

export function SlaAdmin({ rules }: { rules: SlaRule[] }) {
  const router = useRouter();
  const { push } = useToast();

  const [draft, setDraft] = useState<Record<string, { minutes: string; threshold: string }>>(
    Object.fromEntries(
      rules.map((r) => [
        r.id,
        { minutes: String(r.duration_minutes), threshold: String(r.at_risk_threshold_pct) },
      ]),
    ),
  );
  const [busy, setBusy] = useState<string | null>(null);

  async function save(rule: SlaRule) {
    const values = draft[rule.id];
    const minutes = Number(values.minutes);
    const threshold = Number(values.threshold);

    if (!Number.isFinite(minutes) || minutes < 1) {
      push({ tone: "error", title: "Duration must be at least 1 minute." });
      return;
    }
    if (!Number.isFinite(threshold) || threshold < 1 || threshold > 99) {
      push({ tone: "error", title: "At-risk threshold must be between 1 and 99." });
      return;
    }

    setBusy(rule.id);
    try {
      await api(`/api/admin/sla/${rule.id}`, {
        method: "PATCH",
        json: { duration_minutes: minutes, at_risk_threshold_pct: threshold },
      });
      push({ tone: "success", title: `${PRIORITY_META[rule.priority].label} SLA updated` });
      router.refresh();
    } catch (error) {
      push({
        tone: "error",
        title: "Could not save",
        description: error instanceof ApiClientError ? error.message : "Please try again.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Stagger className="space-y-3">
      {rules.map((rule) => {
        const values = draft[rule.id];
        const dirty =
          Number(values.minutes) !== rule.duration_minutes ||
          Number(values.threshold) !== rule.at_risk_threshold_pct;

        return (
          <StaggerItem key={rule.id} className="card p-4">
            <div className="mb-3.5 flex items-center justify-between gap-3">
              <Badge tone={PRIORITY_META[rule.priority].tone}>
                {PRIORITY_META[rule.priority].label}
              </Badge>
              <p className="tabular text-[0.8125rem] text-ink-muted">
                Target: {minutesToLabel(Number(values.minutes) || rule.duration_minutes)}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Field label="Resolve within (minutes)" htmlFor={`min-${rule.id}`}>
                <Input
                  id={`min-${rule.id}`}
                  type="number"
                  min={1}
                  value={values.minutes}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [rule.id]: { ...d[rule.id], minutes: e.target.value } }))
                  }
                />
              </Field>

              <Field
                label="Flag as at-risk at (%)"
                htmlFor={`pct-${rule.id}`}
                hint={`Warns after ${minutesToLabel(
                  Math.round(
                    ((Number(values.threshold) || rule.at_risk_threshold_pct) / 100) *
                      (Number(values.minutes) || rule.duration_minutes),
                  ),
                )}`}
              >
                <Input
                  id={`pct-${rule.id}`}
                  type="number"
                  min={1}
                  max={99}
                  value={values.threshold}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      [rule.id]: { ...d[rule.id], threshold: e.target.value },
                    }))
                  }
                />
              </Field>

              <Button
                variant={dirty ? "primary" : "secondary"}
                disabled={!dirty}
                loading={busy === rule.id}
                onClick={() => save(rule)}
                className="sm:mb-[1.375rem]"
              >
                Save
              </Button>
            </div>
          </StaggerItem>
        );
      })}

      <p className="text-[0.75rem] leading-relaxed text-ink-faint">
        Changing a duration re-targets open tickets the next time their priority changes; tickets
        already resolved keep the SLA they were judged against. The clock pauses automatically
        while a ticket is <span className="font-medium">Waiting</span> on the requester.
      </p>
    </Stagger>
  );
}
