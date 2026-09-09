"use client";

import { motion, useReducedMotion } from "motion/react";
import { fadeUp, reducedVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** One categorical ramp used by every chart, so series colours never clash. */
export const SERIES = [
  "#7c5cff", "#38bdf8", "#34d399", "#fbbf24", "#fb7185",
  "#a78bfa", "#22d3ee", "#4ade80", "#fb923c", "#f472b6", "#94a3b8",
];

/**
 * Reveals as it scrolls into view rather than all at once on load. The reports
 * page is taller than a viewport, so animating everything up front would spend
 * the motion on charts nobody is looking at yet.
 */
export function ChartCard({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();

  return (
    <motion.section
      variants={reduced ? reducedVariants : fadeUp}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-60px" }}
      className={cn("card p-4", className)}
    >
      <div className="mb-4">
        <h3 className="text-[0.8125rem] font-semibold tracking-tight text-ink">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[0.75rem] text-ink-faint">{subtitle}</p>}
      </div>
      {children}
    </motion.section>
  );
}

export function BarList({
  data,
  colorByIndex = false,
  emptyLabel = "No data in this range",
}: {
  data: { label: string; count: number; meta?: string }[];
  colorByIndex?: boolean;
  emptyLabel?: string;
}) {
  if (data.length === 0) {
    return <p className="py-6 text-center text-[0.8125rem] text-ink-faint">{emptyLabel}</p>;
  }

  const max = Math.max(...data.map((d) => d.count), 1);

  return (
    <ul className="space-y-2.5">
      {data.map((item, index) => (
        <li key={item.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[0.75rem]">
            <span className="truncate text-ink-muted">{item.label}</span>
            <span className="tabular flex-none font-medium text-ink">
              {item.count}
              {item.meta && <span className="ml-1.5 font-normal text-ink-faint">{item.meta}</span>}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunk">
            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: item.count / max }}
              transition={{ duration: 0.6, delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }}
              style={{
                originX: 0,
                background: colorByIndex ? SERIES[index % SERIES.length] : "var(--accent)",
              }}
              className="h-full w-full rounded-full"
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function TrendChart({
  data,
}: {
  data: { date: string; created: number; resolved: number }[];
}) {
  if (data.length < 2) {
    return <p className="py-8 text-center text-[0.8125rem] text-ink-faint">Not enough data yet</p>;
  }

  const width = 640;
  const height = 160;
  const pad = { top: 8, right: 4, bottom: 18, left: 4 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const max = Math.max(...data.flatMap((d) => [d.created, d.resolved]), 1);
  const x = (i: number) => pad.left + (i / (data.length - 1)) * innerW;
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;

  const line = (key: "created" | "resolved") =>
    data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(" ");

  const area = (key: "created" | "resolved") =>
    `${line(key)} L${x(data.length - 1).toFixed(1)},${(pad.top + innerH).toFixed(1)} L${x(0).toFixed(1)},${(pad.top + innerH).toFixed(1)} Z`;

  const ticks = [0, Math.floor((data.length - 1) / 2), data.length - 1];

  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-[0.75rem]">
        <span className="flex items-center gap-1.5 text-ink-muted">
          <span className="size-2 rounded-full" style={{ background: SERIES[0] }} />
          Created
        </span>
        <span className="flex items-center gap-1.5 text-ink-muted">
          <span className="size-2 rounded-full" style={{ background: SERIES[2] }} />
          Resolved
        </span>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-40 w-full min-w-[24rem]"
          role="img"
          aria-label="Tickets created and resolved per day"
        >
          <defs>
            <linearGradient id="grad-created" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES[0]} stopOpacity="0.28" />
              <stop offset="100%" stopColor={SERIES[0]} stopOpacity="0" />
            </linearGradient>
            <linearGradient id="grad-resolved" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES[2]} stopOpacity="0.22" />
              <stop offset="100%" stopColor={SERIES[2]} stopOpacity="0" />
            </linearGradient>
          </defs>

          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line
              key={f}
              x1={pad.left}
              x2={width - pad.right}
              y1={pad.top + innerH * (1 - f)}
              y2={pad.top + innerH * (1 - f)}
              stroke="var(--line)"
              strokeWidth="1"
            />
          ))}

          <motion.path
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6 }}
            d={area("created")}
            fill="url(#grad-created)"
          />
          <motion.path
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            d={area("resolved")}
            fill="url(#grad-resolved)"
          />

          <motion.path
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
            d={line("created")}
            fill="none"
            stroke={SERIES[0]}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <motion.path
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.9, delay: 0.12, ease: "easeOut" }}
            d={line("resolved")}
            fill="none"
            stroke={SERIES[2]}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {ticks.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={height - 4}
              textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
              className="fill-[var(--ink-faint)] text-[10px]"
            >
              {new Date(`${data[i].date}T00:00:00`).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
}

export function Donut({ data }: { data: { label: string; count: number }[] }) {
  const total = data.reduce((sum, d) => sum + d.count, 0);

  if (total === 0) {
    return <p className="py-6 text-center text-[0.8125rem] text-ink-faint">No data in this range</p>;
  }

  const radius = 52;
  const stroke = 16;
  const circumference = 2 * Math.PI * radius;

  // Each arc starts where the previous one ended, resolved up front so nothing
  // is mutated while the list renders.
  const arcs = data.reduce<{ label: string; count: number; dash: number; offset: number }[]>(
    (acc, item) => {
      const dash = (item.count / total) * circumference;
      const offset = acc.length ? acc[acc.length - 1].offset + acc[acc.length - 1].dash : 0;
      acc.push({ ...item, dash, offset });
      return acc;
    },
    [],
  );

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 140 140" className="size-32 flex-none -rotate-90" role="img" aria-label="Share by priority">
        {arcs.map((arc, index) => (
          <motion.circle
            key={arc.label}
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            stroke={SERIES[index % SERIES.length]}
            strokeWidth={stroke}
            strokeDasharray={`${arc.dash} ${circumference - arc.dash}`}
            strokeDashoffset={-arc.offset}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: index * 0.07 }}
          />
        ))}
      </svg>

      <ul className="min-w-0 flex-1 space-y-1.5">
        {data.map((item, index) => (
          <li key={item.label} className="flex items-center gap-2 text-[0.75rem]">
            <span
              className="size-2 flex-none rounded-full"
              style={{ background: SERIES[index % SERIES.length] }}
            />
            <span className="min-w-0 flex-1 truncate text-ink-muted">{item.label}</span>
            <span className="tabular flex-none font-medium text-ink">{item.count}</span>
            <span className="tabular w-9 flex-none text-right text-ink-faint">
              {Math.round((item.count / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
