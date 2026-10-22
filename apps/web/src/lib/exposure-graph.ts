export interface GraphHolding {
  ticker: string;
  weight: number;
}
export interface GraphFactor {
  slug: string;
  name: string;
  /** Net portfolio loading, signed. */
  net: number;
}
export interface GraphCell {
  ticker: string;
  factor: string;
  /** Signed exposure of the holding to the factor, from -3 to +3. */
  signed: number;
}

export interface GraphNode {
  id: string;
  label: string;
  side: "holding" | "factor";
  y: number;
  h: number;
  weight?: number;
  net?: number;
}

export interface GraphLink {
  holding: string;
  factor: string;
  /** +1 when the holding is helped by the factor rising, -1 when it is hurt. */
  sign: 1 | -1;
  /** weight x |signed exposure|: how much of the portfolio rides on this link. */
  value: number;
  width: number;
  y0: number;
  y1: number;
}

export interface GraphLayout {
  nodes: GraphNode[];
  links: GraphLink[];
  height: number;
}

/**
 * Lays out a two-column flow diagram (holdings on the left, economic factors on the right). Each link's thickness
 * is proportional to weight x |exposure|; each node's height is the total thickness of its links, so lines stack
 * inside a node without overlapping. Holdings are ordered by weight and factors by total flow.
 */
export function layoutGraph(
  holdings: readonly GraphHolding[],
  factors: readonly GraphFactor[],
  cells: readonly GraphCell[],
  opts: { height?: number; gap?: number; minWidth?: number } = {},
): GraphLayout {
  const { height = 440, gap = 10, minWidth = 1.5 } = opts;
  const hOrder = [...holdings].sort(
    (a, b) => b.weight - a.weight || a.ticker.localeCompare(b.ticker),
  );
  const hIndex = new Map(hOrder.map((h, i) => [h.ticker, i]));
  const weight = new Map(hOrder.map((h) => [h.ticker, h.weight]));

  const raw = cells
    .filter((c) => c.signed !== 0 && hIndex.has(c.ticker))
    .map((c) => ({
      holding: c.ticker,
      factor: c.factor,
      sign: (c.signed > 0 ? 1 : -1) as 1 | -1,
      value: weight.get(c.ticker)! * Math.abs(c.signed),
    }));

  const flowByFactor = new Map<string, number>();
  for (const r of raw) flowByFactor.set(r.factor, (flowByFactor.get(r.factor) ?? 0) + r.value);
  const fOrder = factors
    .filter((f) => flowByFactor.has(f.slug))
    .sort(
      (a, b) =>
        flowByFactor.get(b.slug)! - flowByFactor.get(a.slug)! || a.slug.localeCompare(b.slug),
    );
  const fIndex = new Map(fOrder.map((f, i) => [f.slug, i]));

  const total = raw.reduce((a, r) => a + r.value, 0);
  const nLeft = hOrder.filter((h) => raw.some((r) => r.holding === h.ticker)).length;
  const nRight = fOrder.length;
  if (total === 0) return { nodes: [], links: [], height };

  // Scale so the taller column (including gaps and minimum widths) fits the height.
  const widthOf = (v: number, k: number) => Math.max(minWidth, v * k);
  let k = (height - Math.max(nLeft, nRight) * gap) / total;
  for (let i = 0; i < 6; i++) {
    const used = raw.reduce((a, r) => a + widthOf(r.value, k), 0);
    const over = used + Math.max(nLeft, nRight) * gap - height;
    if (over <= 0.5) break;
    k *= (height - Math.max(nLeft, nRight) * gap) / used;
  }

  const links: GraphLink[] = raw
    .map((r) => ({ ...r, width: widthOf(r.value, k), y0: 0, y1: 0 }))
    .sort(
      (a, b) =>
        hIndex.get(a.holding)! - hIndex.get(b.holding)! ||
        fIndex.get(a.factor)! - fIndex.get(b.factor)!,
    );

  const place = (keys: string[], side: "holding" | "factor") => {
    const nodes: GraphNode[] = [];
    let y = 0;
    for (const key of keys) {
      const own = links.filter((l) => (side === "holding" ? l.holding : l.factor) === key);
      if (own.length === 0) continue;
      const ordered = [...own].sort((a, b) =>
        side === "holding"
          ? fIndex.get(a.factor)! - fIndex.get(b.factor)!
          : hIndex.get(a.holding)! - hIndex.get(b.holding)!,
      );
      const h = ordered.reduce((a, l) => a + l.width, 0);
      let offset = y;
      for (const l of ordered) {
        const mid = offset + l.width / 2;
        if (side === "holding") l.y0 = mid;
        else l.y1 = mid;
        offset += l.width;
      }
      nodes.push({ id: key, label: key, side, y, h });
      y += h + gap;
    }
    return nodes;
  };

  const left = place(
    hOrder.map((h) => h.ticker),
    "holding",
  ).map((n) => ({ ...n, weight: weight.get(n.id) }));
  const right = place(
    fOrder.map((f) => f.slug),
    "factor",
  ).map((n) => {
    const f = fOrder.find((x) => x.slug === n.id)!;
    return { ...n, label: f.name, net: f.net };
  });
  return { nodes: [...left, ...right], links, height };
}
