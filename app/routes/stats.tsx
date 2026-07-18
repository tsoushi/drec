import { useEffect, useState } from "react";
import { Link } from "react-router";

import type { Route } from "./+types/stats";
import { getDrugStats, type DrugStats } from "../db/stats.server";
import { drugColor } from "../lib/colors";
import { agoLabel, formatDuration, formatTaken } from "../lib/time";

export function meta(_: Route.MetaArgs) {
  return [{ title: "drec — 統計" }];
}

export async function loader(_: Route.LoaderArgs) {
  return getDrugStats();
}

function fmtNum(v: number): string {
  return String(parseFloat(v.toFixed(2)));
}

function fmtInterval(min: number | null): string {
  return min == null ? "—" : formatDuration(min * 60000);
}

export default function Stats({ loaderData }: Route.ComponentProps) {
  const { stats, totalCount } = loaderData;
  const [nowMs, setNowMs] = useState<number | null>(null);

  // "now" only on the client (SSR hydration safety); minute precision is fine.
  useEffect(() => {
    setNowMs(Date.now());
  }, []);

  return (
    <main className="mx-auto max-w-xl px-4 pb-24">
      <header className="flex items-baseline justify-between py-4">
        <h1 className="text-xl font-bold tracking-tight">統計</h1>
        <div className="flex items-baseline gap-3">
          <span className="text-sm text-gray-500">
            {stats.length}種・計{totalCount}回
          </span>
          <Link to="/" className="text-sm text-gray-500 hover:text-gray-900">
            ← 戻る
          </Link>
        </div>
      </header>

      {stats.length === 0 ? (
        <p className="py-12 text-center text-gray-400">まだ記録がありません</p>
      ) : (
        <div className="space-y-4">
          {stats.map((s) => (
            <DrugCard key={s.drug_name} s={s} nowMs={nowMs} />
          ))}
        </div>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className="text-sm font-semibold text-gray-800 tabular-nums">
        {value}
      </div>
    </div>
  );
}

function DrugCard({ s, nowMs }: { s: DrugStats; nowMs: number | null }) {
  const color = drugColor(s.drug_name);
  const peak = Math.max(...s.hourHist);
  const totalLabel =
    s.totals.length > 0
      ? s.totals.map((t) => `${fmtNum(t.total)}${t.unit ?? ""}`).join("、")
      : "—";

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 font-semibold">
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span className="break-words">{s.drug_name}</span>
        </h2>
        <span className="shrink-0 text-sm text-gray-500 tabular-nums">
          {s.count}回
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2">
        <Stat label="合計量" value={totalLabel} />
        <Stat
          label="直近30日"
          value={`${s.count30}回${s.prev30 > 0 || s.count30 > 0 ? `（前30日 ${s.prev30}回）` : ""}`}
        />
        <Stat
          label="最終服用"
          value={
            formatTaken(s.lastAt) +
            (nowMs != null ? ` ${agoLabel(s.lastAt, nowMs)}` : "")
          }
        />
        <Stat label="間隔中央値" value={fmtInterval(s.medianIntervalMin)} />
        <Stat label="最短間隔" value={fmtInterval(s.minIntervalMin)} />
        <Stat label="初回" value={formatTaken(s.firstAt)} />
      </div>

      <div className="mt-3">
        <div className="text-[11px] text-gray-400">時間帯分布（服用回数）</div>
        <div className="mt-1 flex h-12 items-end gap-0.5">
          {s.hourHist.map((n, h) => (
            <div
              key={h}
              title={`${h}時台: ${n}回`}
              className="group relative flex h-full flex-1 items-end"
            >
              <div
                className="w-full rounded-t"
                style={{
                  backgroundColor: n > 0 ? color : "#f3f4f6",
                  height:
                    n > 0 ? `${Math.max(6, (n / peak) * 100)}%` : "3px",
                }}
              />
              {n > 0 && n === peak && (
                <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-[9px] text-gray-500 tabular-nums">
                  {n}
                </span>
              )}
              <span className="pointer-events-none absolute -top-3.5 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-1 text-[9px] text-white group-hover:block">
                {h}時 {n}回
              </span>
            </div>
          ))}
        </div>
        <div className="mt-0.5 flex justify-between text-[9px] text-gray-400 tabular-nums">
          <span>0時</span>
          <span>6時</span>
          <span>12時</span>
          <span>18時</span>
          <span>23時</span>
        </div>
      </div>
    </section>
  );
}
