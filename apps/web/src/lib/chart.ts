/** Chart colors and text styles that follow the active theme, so every chart works in light and dark. */
export const chartColors = {
  axis: "var(--muted-foreground)",
  grid: "var(--border)",
  gain: "var(--gain)",
  loss: "var(--loss)",
  info: "var(--info)",
  warn: "var(--warn)",
  text: "var(--foreground)",
} as const;

export const axisTick = { fill: chartColors.axis, fontSize: 11 } as const;

export const tooltipStyle = {
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 12,
} as const;
