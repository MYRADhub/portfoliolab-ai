/** RFC 4180 CSV. Cells starting with = + - @ are prefixed so a spreadsheet cannot run them as formulas. */
export function toCsv(rows: readonly object[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]!);
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+@]/.test(s) || (/^-/.test(s) && Number.isNaN(Number(s)))) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return (
    [
      cols.join(","),
      ...rows.map((r) => cols.map((c) => cell((r as Record<string, unknown>)[c])).join(",")),
    ].join("\n") + "\n"
  );
}
