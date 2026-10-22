"use client";

import { useState } from "react";
import { pct } from "@/lib/format";
import {
  layoutGraph,
  type GraphCell,
  type GraphFactor,
  type GraphHolding,
} from "@/lib/exposure-graph";

const W = 900;
const LEFT_X = 200;
const RIGHT_X = 680;
const NODE_W = 12;
const PAD = 12;

const strength = (m: number) => (m >= 3 ? "strongly" : m === 2 ? "moderately" : "slightly");

/**
 * Holdings on the left, economic forces on the right, a line for every dependency. Line thickness is how much of the
 * portfolio rides on it; green means the holding is helped when the force rises, red means it is hurt. Hover, focus or
 * press a holding or force to see only its connections.
 */
export function ExposureGraph({
  holdings,
  factors,
  cells,
}: {
  holdings: GraphHolding[];
  factors: GraphFactor[];
  cells: GraphCell[];
}) {
  // Hover and focus preview a node; clicking or pressing Enter pins it until pressed again.
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const active = pinned ?? hovered;
  const layout = layoutGraph(holdings, factors, cells);
  const byId = new Map(layout.nodes.map((n) => [`${n.side}:${n.id}`, n]));

  const connected = (l: { holding: string; factor: string }) =>
    active === null || active === `holding:${l.holding}` || active === `factor:${l.factor}`;
  const nodeActive = (key: string) =>
    active === null ||
    active === key ||
    layout.links.some(
      (l) => connected(l) && (key === `holding:${l.holding}` || key === `factor:${l.factor}`),
    );

  const describe = (key: string): string => {
    const n = byId.get(key)!;
    if (n.side === "holding") {
      const parts = cells
        .filter((c) => c.ticker === n.id && c.signed !== 0)
        .map(
          (c) =>
            `${factors.find((f) => f.slug === c.factor)?.name ?? c.factor} (${c.signed > 0 ? "helped" : "hurt"} ${strength(Math.abs(c.signed))})`,
        );
      // Starts with exactly the text drawn on screen, so the spoken name contains the visible label.
      return `${n.id} ${pct(n.weight ?? 0, 0)}. Of your portfolio. Depends on: ${parts.join(", ")}`;
    }
    const names = cells
      .filter((c) => c.factor === n.id && c.signed !== 0)
      .map((c) => `${c.ticker} (${c.signed > 0 ? "helped" : "hurt"})`);
    const net = n.net ?? 0;
    return `${n.label} ${net >= 0 ? "+" : ""}${net.toFixed(2)}. Net effect on your portfolio ${net >= 0 ? "helped" : "hurt"}. Touches: ${names.join(", ")}`;
  };

  if (layout.nodes.length === 0)
    return <p className="text-sm text-muted-foreground">No exposures to draw.</p>;
  const H = layout.height + PAD * 2;

  const shared = factors
    .map((f) => ({
      name: f.name,
      tickers: cells.filter((c) => c.factor === f.slug && c.signed !== 0).map((c) => c.ticker),
    }))
    .filter((f) => f.tickers.length >= 2)
    .sort((a, b) => b.tickers.length - a.tickers.length || a.name.localeCompare(b.name));

  return (
    <figure className="space-y-3">
      <figcaption className="text-sm text-muted-foreground">
        Each line connects a holding to an economic force it depends on.{" "}
        <span className="font-medium text-gain">Green</span> means the holding is helped when that
        force rises, <span className="font-medium text-loss">red</span> means it is hurt. Thicker
        lines mean more of your money rides on it. Hover or focus a name to isolate its connections.
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="group"
        aria-label="Hidden exposure map"
        onMouseLeave={() => setHovered(null)}
      >
        <g transform={`translate(0 ${PAD})`}>
          {layout.links.map((l) => {
            const h = byId.get(`holding:${l.holding}`)!;
            const f = byId.get(`factor:${l.factor}`)!;
            void h;
            void f;
            const x0 = LEFT_X + NODE_W;
            const x1 = RIGHT_X;
            const mid = (x0 + x1) / 2;
            return (
              <path
                key={`${l.holding}-${l.factor}`}
                d={`M${x0},${l.y0} C${mid},${l.y0} ${mid},${l.y1} ${x1},${l.y1}`}
                fill="none"
                stroke={l.sign > 0 ? "var(--gain)" : "var(--loss)"}
                strokeWidth={l.width}
                strokeOpacity={connected(l) ? (active === null ? 0.42 : 0.8) : 0.08}
                style={{ transition: "stroke-opacity 120ms" }}
              />
            );
          })}
          {layout.nodes.map((n) => {
            const key = `${n.side}:${n.id}`;
            const isHolding = n.side === "holding";
            const x = isHolding ? LEFT_X : RIGHT_X;
            const tone = isHolding
              ? "var(--muted-foreground)"
              : (n.net ?? 0) >= 0
                ? "var(--gain)"
                : "var(--loss)";
            return (
              <g
                key={key}
                tabIndex={0}
                role="button"
                aria-label={describe(key)}
                aria-pressed={pinned === key}
                opacity={nodeActive(key) ? 1 : 0.3}
                className="cursor-pointer outline-none focus-visible:[&>rect]:stroke-foreground"
                onMouseEnter={() => setHovered(key)}
                onFocus={() => setHovered(key)}
                onBlur={() => setHovered(null)}
                onClick={() => setPinned(pinned === key ? null : key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setPinned(pinned === key ? null : key);
                  }
                }}
              >
                <rect
                  x={x}
                  y={n.y}
                  width={NODE_W}
                  height={Math.max(n.h, 4)}
                  rx={2}
                  fill={tone}
                  stroke="transparent"
                  strokeWidth={2}
                />
                {isHolding ? (
                  <text
                    x={x - 8}
                    y={n.y + n.h / 2}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className="fill-foreground text-[13px]"
                  >
                    <tspan className="font-semibold">{n.id}</tspan>
                    <tspan className="fill-muted-foreground"> {pct(n.weight ?? 0, 0)}</tspan>
                  </text>
                ) : (
                  <text
                    x={x + NODE_W + 8}
                    y={n.y + n.h / 2}
                    dominantBaseline="middle"
                    className="fill-foreground text-[13px]"
                  >
                    <tspan>{n.label}</tspan>
                    <tspan className="fill-muted-foreground">
                      {" "}
                      {(n.net ?? 0) >= 0 ? "+" : ""}
                      {(n.net ?? 0).toFixed(2)}
                    </tspan>
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      {shared.length > 0 && (
        <div>
          <h3 className="text-sm font-medium">Forces shared by several holdings</h3>
          <ul className="mt-1 flex flex-wrap gap-2" aria-label="Shared forces">
            {shared.map((s) => (
              <li key={s.name} className="rounded-md border px-2 py-1 text-xs">
                <span className="font-semibold">{s.name}</span>{" "}
                <span className="text-muted-foreground">touches {s.tickers.join(", ")}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">
            These are the hidden links: holdings that look unrelated but react to the same thing.
          </p>
        </div>
      )}
    </figure>
  );
}
