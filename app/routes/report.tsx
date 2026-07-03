import { Link } from "react-router";

import type { Route } from "./+types/report";
import { getMonthlyReport } from "../db/report.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "drec — 月別レポート" }];
}

export async function loader(_: Route.LoaderArgs) {
  return { rows: getMonthlyReport() };
}

function fmtNum(v: number): string {
  return String(parseFloat(v.toFixed(2)));
}

function monthLabel(m: string): string {
  return `${Number(m.slice(0, 4))}年${Number(m.slice(5, 7))}月`;
}

type DrugLine = { name: string; times: number; amounts: string[] };
type MonthGroup = { month: string; totalTimes: number; lines: DrugLine[] };

export default function Report({ loaderData }: Route.ComponentProps) {
  const { rows } = loaderData;

  // Merge (month, drug, unit) rows into one line per drug per month.
  const months: MonthGroup[] = [];
  const monthMap = new Map<string, { group: MonthGroup; drugs: Map<string, DrugLine> }>();
  for (const r of rows) {
    let m = monthMap.get(r.month);
    if (!m) {
      m = { group: { month: r.month, totalTimes: 0, lines: [] }, drugs: new Map() };
      monthMap.set(r.month, m);
      months.push(m.group);
    }
    let line = m.drugs.get(r.drug_name);
    if (!line) {
      line = { name: r.drug_name, times: 0, amounts: [] };
      m.drugs.set(r.drug_name, line);
      m.group.lines.push(line);
    }
    line.times += r.times;
    m.group.totalTimes += r.times;
    if (r.total != null) line.amounts.push(`${fmtNum(r.total)}${r.unit ?? ""}`);
  }
  for (const g of months) {
    g.lines.sort((a, b) => b.times - a.times || a.name.localeCompare(b.name, "ja"));
  }

  return (
    <main className="mx-auto max-w-xl px-4 pb-24">
      <header className="flex items-baseline justify-between py-4">
        <h1 className="text-xl font-bold tracking-tight">月別レポート</h1>
        <Link to="/" className="text-sm text-gray-500 hover:text-gray-900">
          ← 戻る
        </Link>
      </header>

      {months.length === 0 ? (
        <p className="py-12 text-center text-gray-400">まだ記録がありません</p>
      ) : (
        <div className="space-y-4">
          {months.map((g) => (
            <section
              key={g.month}
              className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-baseline justify-between">
                <h2 className="font-semibold">{monthLabel(g.month)}</h2>
                <span className="text-sm text-gray-500">計 {g.totalTimes} 回</span>
              </div>
              <ul className="mt-2 divide-y divide-gray-100">
                {g.lines.map((l) => (
                  <li
                    key={l.name}
                    className="flex items-baseline justify-between gap-3 py-2"
                  >
                    <span className="min-w-0 break-words font-medium">{l.name}</span>
                    <span className="shrink-0 text-sm text-gray-600 tabular-nums">
                      {l.times} 回
                      {l.amounts.length > 0 && (
                        <span className="ml-2 text-gray-500">
                          {l.amounts.join("、")}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
