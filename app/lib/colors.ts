// Shared per-drug accent colors. Hash-based on the drug name so a drug keeps
// the same color on every screen (notes / calendar / stats) without any stored
// state. 6-hue categorical set (Okabe–Ito based) validated for CVD separation,
// lightness band and >=3:1 contrast on white cards; identity is never carried
// by color alone (a number, name or count is always adjacent).
export const DRUG_COLORS = [
  "#0072B2", // blue
  "#D55E00", // vermillion
  "#009E73", // green
  "#CC79A7", // pink
  "#7c3aed", // violet
  "#92400e", // brown
];

export function drugColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return DRUG_COLORS[h % DRUG_COLORS.length];
}
