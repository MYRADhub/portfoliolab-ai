"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { DisplayUnit, ShownDisplay } from "@portfolio-lab/explain";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { axisTick, chartColors, tooltipStyle } from "@/lib/chart";
import { compactUsd } from "@/lib/format";

export const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/** How a chart value is written on axes and tooltips. */
export function formatValue(unit: DisplayUnit, v: number): string {
  switch (unit) {
    case "price":
      return `$${v.toFixed(2)}`;
    case "percent":
      return `${v.toFixed(1)}%`;
    case "usd":
      return compactUsd(v);
    case "score":
      return `${v > 0 ? "+" : ""}${v}`;
    case "index":
      return v.toFixed(1);
    default:
      return Math.abs(v) >= 1000
        ? v.toLocaleString("en-US", { maximumFractionDigits: 0 })
        : String(v);
  }
}

function Caption({ children }: { children: React.ReactNode }) {
  return <figcaption className="text-xs font-medium text-muted-foreground">{children}</figcaption>;
}

/** Background for a heatmap cell: green for positive, red for negative, stronger with size. */
function heatColor(v: number | null, max: number): string | undefined {
  if (v === null || v === 0 || max === 0) return undefined;
  const share = Math.min(1, Math.abs(v) / max);
  return `color-mix(in oklch, ${v > 0 ? "var(--gain)" : "var(--loss)"} ${Math.round(8 + share * 27)}%, transparent)`;
}

/**
 * A table or chart a tool produced. Values come from our data, not from the model. `size` makes charts taller for
 * dashboards and slides.
 */
export function DisplayView({
  display,
  size = "md",
}: {
  display: ShownDisplay;
  size?: "md" | "lg";
}) {
  const height = size === "lg" ? "h-80" : "h-56";

  if (display.kind === "table")
    return (
      <figure className="space-y-1">
        <Caption>{display.title}</Caption>
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

  if (display.kind === "heatmap") {
    const max = Math.max(0, ...display.values.flat().map((v) => Math.abs(v ?? 0)));
    return (
      <figure className="space-y-1">
        <Caption>{display.title}</Caption>
        <Table aria-label={display.title}>
          <TableHeader>
            <TableRow>
              <TableHead />
              {display.columns.map((c) => (
                <TableHead key={c} className="text-center text-xs whitespace-nowrap">
                  {c.replace(/_/g, " ")}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {display.rows.map((r, i) => (
              <TableRow key={r}>
                <TableCell className="font-medium">{r}</TableCell>
                {display.columns.map((c, j) => {
                  const v = display.values[i]?.[j] ?? null;
                  return (
                    <TableCell
                      key={c}
                      className="text-center tabular-nums"
                      style={{ background: heatColor(v, max) }}
                    >
                      {v === null ? "-" : v === 0 ? "" : formatValue(display.unit, v)}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </figure>
    );
  }

  if (display.kind === "bar") {
    const data = display.categories.map((c, i) => ({
      name: c,
      ...Object.fromEntries(display.series.map((s) => [s.name, s.values[i]])),
    }));
    const fmt = (v: number) => formatValue(display.unit, v);
    const horizontal =
      display.categories.length > 6 || display.categories.some((c) => c.length > 12);
    return (
      <figure className="space-y-1">
        <Caption>{display.title}</Caption>
        <div
          className={horizontal ? "w-full" : `${height} w-full`}
          style={
            horizontal ? { height: Math.max(160, display.categories.length * 30 + 40) } : undefined
          }
          role="img"
          aria-label={`Bar chart: ${display.title}`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              layout={horizontal ? "vertical" : "horizontal"}
              margin={{ top: 4, right: 12, bottom: 0, left: 0 }}
            >
              <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" />
              {horizontal ? (
                <>
                  <XAxis type="number" tick={axisTick} tickFormatter={fmt} />
                  <YAxis type="category" dataKey="name" tick={axisTick} width={140} />
                </>
              ) : (
                <>
                  <XAxis dataKey="name" tick={axisTick} />
                  <YAxis tick={axisTick} width={60} tickFormatter={fmt} />
                </>
              )}
              <ReferenceLine {...(horizontal ? { x: 0 } : { y: 0 })} stroke={chartColors.axis} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmt(Number(v))} />
              {display.series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {display.series.map((s, i) => (
                <Bar
                  key={s.name}
                  dataKey={s.name}
                  fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </figure>
    );
  }

  if (display.kind === "scatter") {
    const fx = (v: number) => formatValue(display.x.unit, v);
    const fy = (v: number) => formatValue(display.y.unit, v);
    return (
      <figure className="space-y-1">
        <Caption>{display.title}</Caption>
        <div
          className={`${height} w-full`}
          role="img"
          aria-label={`Scatter chart: ${display.title}`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
              <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" />
              <XAxis
                type="number"
                dataKey="x"
                name={display.x.label}
                tick={axisTick}
                tickFormatter={fx}
                domain={["auto", "auto"]}
                label={{
                  value: display.x.label,
                  position: "insideBottom",
                  offset: -8,
                  fill: chartColors.axis,
                  fontSize: 11,
                }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name={display.y.label}
                tick={axisTick}
                tickFormatter={fy}
                width={60}
                domain={["auto", "auto"]}
              />
              <ZAxis range={[50, 50]} />
              <ReferenceLine y={0} stroke={chartColors.axis} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v, name) => (name === display.x.label ? fx(Number(v)) : fy(Number(v)))}
                labelFormatter={() => ""}
              />
              <Scatter data={display.points} fill="var(--chart-1)" isAnimationActive={false}>
                <LabelList
                  dataKey="label"
                  position="top"
                  style={{ fontSize: 10, fill: chartColors.text }}
                />
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-muted-foreground">Vertical: {display.y.label}.</p>
      </figure>
    );
  }

  const byDate = new Map<string, Record<string, number | string>>();
  for (const s of display.series)
    for (const p of s.points) {
      const row = byDate.get(p.date) ?? { date: p.date };
      row[s.name] = p.value;
      byDate.set(p.date, row);
    }
  const data = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const fmt = (v: number) => formatValue(display.unit, v);
  return (
    <figure className="space-y-1">
      <Caption>
        {display.title}
        {display.unit === "index" && " (each line starts at 100)"}
      </Caption>
      <div className={`${height} w-full`} role="img" aria-label={`Chart: ${display.title}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={axisTick} minTickGap={40} />
            <YAxis tick={axisTick} width={60} domain={["auto", "auto"]} tickFormatter={fmt} />
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
