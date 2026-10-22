"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { axisTick, chartColors, tooltipStyle } from "@/lib/chart";

/** A single series drawn as a line over a soft gradient fill. Colors follow the theme. */
export function AreaSeries({
  data,
  xKey,
  yKey,
  color = chartColors.info,
  digits = 2,
  yWidth = 40,
}: {
  data: readonly object[];
  xKey: string;
  yKey: string;
  color?: string;
  digits?: number;
  yWidth?: number;
}) {
  const id = useId().replace(/:/g, "");
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data as object[]} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} minTickGap={56} tick={axisTick} tickLine={false} axisLine={false} />
        <YAxis
          domain={["auto", "auto"]}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          width={yWidth}
          tickFormatter={(v: number) => v.toFixed(0)}
        />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => Number(v).toFixed(digits)} />
        <Area
          type="monotone"
          dataKey={yKey}
          stroke={color}
          strokeWidth={2}
          fill={`url(#${id})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
