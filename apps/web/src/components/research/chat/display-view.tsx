"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ShownDisplay } from "@portfolio-lab/explain";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { axisTick, chartColors, tooltipStyle } from "@/lib/chart";

const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/** A table or chart a tool produced and the answer chose to show. Values come from our data, not from the model. */
export function DisplayView({ display }: { display: ShownDisplay }) {
  if (display.kind === "table")
    return (
      <figure className="space-y-1">
        <figcaption className="text-xs font-medium text-muted-foreground">
          {display.title}
        </figcaption>
        <Table aria-label={display.title}>
          <TableHeader>
            <TableRow>
              {display.columns.map((c, i) => (
                <TableHead key={i} className={i === 0 ? "" : "text-right"}>
                  {c}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {display.rows.map((r, i) => (
              <TableRow key={i}>
                {r.map((cell, j) => (
                  <TableCell
                    key={j}
                    className={j === 0 ? "font-medium" : "text-right tabular-nums"}
                  >
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </figure>
    );

  const byDate = new Map<string, Record<string, number | string>>();
  for (const s of display.series)
    for (const p of s.points) {
      const row = byDate.get(p.date) ?? { date: p.date };
      row[s.name] = p.value;
      byDate.set(p.date, row);
    }
  const data = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const fmt = (v: number) =>
    display.unit === "price"
      ? `$${v.toFixed(2)}`
      : display.unit === "percent"
        ? `${v.toFixed(1)}%`
        : v.toFixed(1);
  return (
    <figure className="space-y-1">
      <figcaption className="text-xs font-medium text-muted-foreground">
        {display.title}
        {display.unit === "index" && " (each line starts at 100)"}
      </figcaption>
      <div className="h-56 w-full" role="img" aria-label={`Chart: ${display.title}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={axisTick} minTickGap={40} />
            <YAxis tick={axisTick} width={52} domain={["auto", "auto"]} tickFormatter={fmt} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmt(Number(v))} />
            {display.series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
            {display.series.map((s, i) => (
              <Line
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                dot={false}
                strokeWidth={1.75}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
