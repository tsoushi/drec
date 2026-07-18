import { db } from "./db.server";
import type { Rec } from "./records.server";
import { nowLocalISO, parseLocal } from "../lib/time";

// Read-only per-drug aggregates for the /stats screen. All math is done in JS
// over the active records — the data set is personal-sized.

export type DrugStats = {
  drug_name: string;
  count: number;
  count30: number; // doses in the last 30 days
  prev30: number; // doses in the 30 days before that
  firstAt: string;
  lastAt: string;
  /** Sum of amounts per unit (records without an amount are skipped). */
  totals: Array<{ unit: string | null; total: number }>;
  /** Median / minimum gap between consecutive doses, in minutes. */
  medianIntervalMin: number | null;
  minIntervalMin: number | null;
  /** Doses per hour of day, 24 buckets. */
  hourHist: number[];
};

const allStmt = db.prepare(
  `SELECT * FROM records
    WHERE deleted_at IS NULL
    ORDER BY drug_name, taken_at, id`,
);

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86400000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

export function getDrugStats(): { stats: DrugStats[]; totalCount: number } {
  const rows = allStmt.all() as Rec[];
  const cut30 = isoDaysAgo(30);
  const cut60 = isoDaysAgo(60);
  const now = nowLocalISO();

  const byDrug = new Map<string, Rec[]>();
  for (const r of rows) {
    const list = byDrug.get(r.drug_name);
    if (list) list.push(r);
    else byDrug.set(r.drug_name, [r]);
  }

  const stats: DrugStats[] = [];
  for (const [name, recs] of byDrug) {
    const totalsMap = new Map<string, { unit: string | null; total: number }>();
    const hourHist = new Array<number>(24).fill(0);
    const gaps: number[] = [];
    let count30 = 0;
    let prev30 = 0;

    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      if (r.amount != null) {
        const key = r.unit ?? "";
        const t = totalsMap.get(key);
        if (t) t.total += r.amount;
        else totalsMap.set(key, { unit: r.unit, total: r.amount });
      }
      hourHist[parseLocal(r.taken_at).getHours()]++;
      if (r.taken_at >= cut30 && r.taken_at <= now) count30++;
      else if (r.taken_at >= cut60 && r.taken_at < cut30) prev30++;
      if (i > 0) {
        gaps.push(
          Math.round(
            (parseLocal(r.taken_at).getTime() -
              parseLocal(recs[i - 1].taken_at).getTime()) /
              60000,
          ),
        );
      }
    }

    gaps.sort((a, b) => a - b);
    const median =
      gaps.length === 0
        ? null
        : gaps.length % 2 === 1
          ? gaps[(gaps.length - 1) / 2]
          : Math.round((gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2);

    stats.push({
      drug_name: name,
      count: recs.length,
      count30,
      prev30,
      firstAt: recs[0].taken_at,
      lastAt: recs[recs.length - 1].taken_at,
      totals: Array.from(totalsMap.values()),
      medianIntervalMin: median,
      minIntervalMin: gaps.length > 0 ? gaps[0] : null,
      hourHist,
    });
  }

  stats.sort(
    (a, b) => b.count - a.count || a.drug_name.localeCompare(b.drug_name, "ja"),
  );
  return { stats, totalCount: rows.length };
}
