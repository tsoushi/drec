import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import type { Route } from "./+types/graph";
import { getGraphData } from "../db/graph.server";
import { formatTaken, isoToSlash, parseLocal } from "../lib/time";

export function meta(_: Route.MetaArgs) {
  return [{ title: "drec — 血中濃度グラフ" }];
}

export async function loader(_: Route.LoaderArgs) {
  return getGraphData();
}

// ---------------------------------------------------------------------------
// ごく簡易な血中濃度モデル:
//   服用量 dosePerUnit を 1 単位とし、服用から tmax 分かけて直線的に +units
//   （units = 量 / dosePerUnit）まで上昇、その後は半減期 half 分で指数減衰。
//   複数回の服用は単純に足し合わせる（重ね合わせ）。
// ---------------------------------------------------------------------------

type DosePoint = { t: number; amount: number }; // t = epoch ms

function makeConcFn(
  doses: DosePoint[],
  dosePerUnit: number,
  tmaxMs: number,
  halfMs: number,
): (t: number) => number {
  return (t: number) => {
    let c = 0;
    for (const d of doses) {
      const dt = t - d.t;
      if (dt <= 0) continue;
      const units = d.amount / dosePerUnit;
      if (dt < tmaxMs) c += units * (dt / tmaxMs);
      else c += units * Math.pow(0.5, (dt - tmaxMs) / halfMs);
    }
    return c;
  };
}

/** Parse a positive number from an input string, falling back when invalid. */
function posNum(s: string, fallback: number): number {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Pick a "nice" gridline step so we get roughly 3-6 horizontal lines. */
function niceStep(maxV: number): number {
  const raw = maxV / 5;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (raw <= m * pow) return m * pow;
  }
  return 10 * pow;
}

/** X-axis tick interval (hours) for a ±winH window: at most ~8 ticks. */
function tickStepH(winH: number): number {
  const span = winH * 2;
  for (const s of [1, 2, 3, 6, 12, 24, 48, 72, 168, 336]) {
    if (span / s <= 8) return s;
  }
  return 336;
}

function hourLabel(h: number): string {
  if (h === 0) return "0";
  const sign = h > 0 ? "+" : "-";
  const a = Math.abs(h);
  return a % 24 === 0 ? `${sign}${a / 24}d` : `${sign}${a}h`;
}

function fmtNum(v: number): string {
  return String(parseFloat(v.toFixed(2)));
}

/** epoch ms -> naive local ISO (for reusing lib/time formatters). */
function localIsoOf(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ---- per-drug cached settings ---------------------------------------------
// Model/window params persist in localStorage (they are properties of the
// drug); the reference time is only remembered per drug within the session.

type StoredParams = { unit: string; tmax: string; half: string; win: string };
const DEFAULT_PARAMS: StoredParams = { unit: "10", tmax: "25", half: "60", win: "72" };
const LS_PREFIX = "drec:graph:params:";

function loadParams(drug: string): StoredParams {
  try {
    const raw = localStorage.getItem(LS_PREFIX + drug);
    if (raw) return { ...DEFAULT_PARAMS, ...(JSON.parse(raw) as Partial<StoredParams>) };
  } catch {
    // ignore bad/blocked storage
  }
  return { ...DEFAULT_PARAMS };
}

function saveParams(drug: string, p: StoredParams): void {
  try {
    localStorage.setItem(LS_PREFIX + drug, JSON.stringify(p));
  } catch {
    // ignore
  }
}

const HOUR = 3_600_000;

// SVG layout
const W = 800;
const H = 380;
const ML = 44;
const MR = 12;
const MT = 12;
const MB = 28;
const PW = W - ML - MR;
const PH = H - MT - MB;

const fieldClass =
  "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base outline-none focus:border-gray-900";

export default function Graph({ loaderData }: Route.ComponentProps) {
  const { drugs, doses } = loaderData;

  const [drugSel, setDrugSel] = useState<string | null>(null);
  const [params, setParams] = useState<StoredParams>({ ...DEFAULT_PARAMS });
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [refMs, setRefMs] = useState<number | null>(null); // 基準時刻（グラフ中央）
  const [follow, setFollow] = useState(true); // 基準時刻を現在時刻に追従させるか

  const drug = drugSel ?? drugs[0]?.name ?? "";
  const refCache = useRef(new Map<string, { ref: number; follow: boolean }>());
  const dragRef = useRef<{ pointerId: number; startX: number; startRef: number } | null>(null);

  // Client-only clock (avoids SSR/CSR mismatch); refresh every minute.
  useEffect(() => {
    const now = Date.now();
    setNowMs(now);
    setRefMs((cur) => cur ?? now);
    const t = window.setInterval(() => {
      setNowMs(Date.now());
      setFollow((f) => {
        if (f) setRefMs(Date.now());
        return f;
      });
    }, 60_000);
    return () => window.clearInterval(t);
  }, []);

  // Restore cached settings whenever the selected drug changes (incl. mount).
  useEffect(() => {
    if (!drug) return;
    setParams(loadParams(drug));
    const sess = refCache.current.get(drug);
    if (sess) {
      setRefMs(sess.ref);
      setFollow(sess.follow);
    }
  }, [drug]);

  /** Update one param field and persist the drug's settings. */
  function updateParam(patch: Partial<StoredParams>) {
    const next = { ...params, ...patch };
    setParams(next);
    if (drug) saveParams(drug, next);
  }

  /** Switch drug, remembering the current view (reference time) for this one. */
  function switchDrug(name: string) {
    if (drug && refMs != null) refCache.current.set(drug, { ref: refMs, follow });
    setDrugSel(name);
  }

  function resetToNow() {
    const now = Date.now();
    setNowMs(now);
    setRefMs(now);
    setFollow(true);
  }

  const dosePerUnit = posNum(params.unit, 10);
  const tmaxMs = posNum(params.tmax, 25) * 60_000;
  const halfMs = posNum(params.half, 60) * 60_000;
  const winH = posNum(params.win, 72);
  const windowMs = winH * HOUR;

  const drugDoses = useMemo<DosePoint[]>(
    () =>
      doses
        .filter((d) => d.drug_name === drug)
        .map((d) => ({ t: parseLocal(d.taken_at).getTime(), amount: d.amount })),
    [doses, drug],
  );

  const chart = useMemo(() => {
    if (refMs == null) return null;
    const from = refMs - windowMs;
    const to = refMs + windowMs;
    const conc = makeConcFn(drugDoses, dosePerUnit, tmaxMs, halfMs);

    // ~400 regular samples plus exact kink points (dose time / dose peak).
    const step = Math.max(10_000, (to - from) / 400);
    const times: number[] = [];
    for (let t = from; t <= to; t += step) times.push(t);
    times.push(to);
    for (const d of drugDoses) {
      if (d.t > from && d.t < to) times.push(d.t);
      const peak = d.t + tmaxMs;
      if (peak > from && peak < to) times.push(peak);
    }
    times.sort((a, b) => a - b);

    let maxC = 0;
    const pts = times.map((t) => {
      const c = conc(t);
      if (c > maxC) maxC = c;
      return [t, c] as const;
    });

    const yMax = Math.max(1, maxC) * 1.05;
    const X = (t: number) => ML + ((t - from) / (to - from)) * PW;
    const Y = (c: number) => MT + PH - (c / yMax) * PH;

    let line = "";
    for (const [t, c] of pts) {
      line += `${line ? "L" : "M"}${X(t).toFixed(1)} ${Y(c).toFixed(1)}`;
    }
    const area = `${line}L${X(to).toFixed(1)} ${Y(0).toFixed(1)}L${X(from).toFixed(1)} ${Y(0).toFixed(1)}Z`;

    const stepY = niceStep(yMax);
    const yLines: Array<{ v: number; y: number }> = [];
    for (let v = stepY; v <= yMax; v += stepY) yLines.push({ v, y: Y(v) });

    const stepH = tickStepH(winH);
    const k = Math.floor(winH / stepH);
    const xTicks: Array<{ x: number; label: string }> = [];
    for (let i = -k; i <= k; i++) {
      const h = i * stepH;
      xTicks.push({ x: X(refMs + h * HOUR), label: hourLabel(h) });
    }

    const markers = drugDoses
      .filter((d) => d.t >= from && d.t <= to)
      .map((d) => ({ x: X(d.t), t: d.t, amount: d.amount }));

    return { line, area, yLines, xTicks, markers, from, to, atRef: conc(refMs) };
  }, [drugDoses, dosePerUnit, tmaxMs, halfMs, refMs, windowMs, winH]);

  // Position of the actual "now" line (may differ from center after panning).
  const nowX =
    chart != null && nowMs != null && nowMs >= chart.from && nowMs <= chart.to
      ? ML + ((nowMs - chart.from) / (chart.to - chart.from)) * PW
      : null;

  // ---- drag / swipe to move the reference time ----
  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (refMs == null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startRef: refMs };
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const dxView = ((e.clientX - d.startX) * W) / rect.width;
    const deltaMs = (dxView / PW) * (windowMs * 2);
    if (deltaMs !== 0) {
      setFollow(false);
      setRefMs(d.startRef - deltaMs);
    }
  }
  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  }

  const totalOfDrug = drugs.find((d) => d.name === drug)?.count ?? 0;
  const excluded = totalOfDrug - drugDoses.length;
  const isAtNow = follow || (refMs != null && nowMs != null && Math.abs(refMs - nowMs) < 60_000);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24">
      <header className="flex items-baseline justify-between py-4">
        <h1 className="text-xl font-bold tracking-tight">血中濃度グラフ</h1>
        <Link to="/" className="text-sm text-gray-500 hover:text-gray-900">
          ← 戻る
        </Link>
      </header>

      {drugs.length === 0 ? (
        <p className="py-12 text-center text-gray-400">まだ記録がありません</p>
      ) : (
        <>
          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <label className="col-span-2 block sm:col-span-1">
                <span className="text-sm font-medium text-gray-700">薬剤</span>
                <select
                  value={drug}
                  onChange={(e) => switchDrug(e.target.value)}
                  className={fieldClass}
                >
                  {drugs.map((d) => (
                    <option key={d.name} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">単位服用量</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={params.unit}
                  onChange={(e) => updateParam({ unit: e.target.value })}
                  className={fieldClass}
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">ピーク(分)</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={params.tmax}
                  onChange={(e) => updateParam({ tmax: e.target.value })}
                  className={fieldClass}
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">半減期(分)</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={params.half}
                  onChange={(e) => updateParam({ half: e.target.value })}
                  className={fieldClass}
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">期間(±h)</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={params.win}
                  onChange={(e) => updateParam({ win: e.target.value })}
                  className={fieldClass}
                />
              </label>
            </div>
            <p className="mt-3 text-xs text-gray-400">
              服用量 {fmtNum(dosePerUnit)} ごとに血中濃度 +1（服用から{" "}
              {fmtNum(tmaxMs / 60_000)}分でピーク、以降は半減期 {fmtNum(halfMs / 60_000)}
              分で減衰）。表示範囲 ±{fmtNum(winH)}h。対象レコード {drugDoses.length} 件
              {excluded > 0 && `（量未入力 ${excluded} 件は除外）`}
              。設定は薬剤ごとに保存されます。
            </p>
          </section>

          <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            {chart == null || refMs == null ? (
              <p className="py-24 text-center text-gray-400">計算中…</p>
            ) : (
              <>
                <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-700">
                  <span>
                    基準時刻:{" "}
                    <span className="font-medium tabular-nums">
                      {isoToSlash(localIsoOf(refMs))}
                    </span>
                  </span>
                  <span>
                    血中濃度:{" "}
                    <span className="text-lg font-bold tabular-nums">
                      {chart.atRef.toFixed(2)}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={resetToNow}
                    disabled={isAtNow}
                    className="rounded-lg border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                  >
                    今に戻す
                  </button>
                </div>
                <svg
                  viewBox={`0 0 ${W} ${H}`}
                  className="w-full cursor-grab select-none active:cursor-grabbing"
                  style={{ touchAction: "pan-y" }}
                  role="img"
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                >
                  {/* horizontal gridlines + labels */}
                  {chart.yLines.map(({ v, y }) => (
                    <g key={v}>
                      <line x1={ML} y1={y} x2={W - MR} y2={y} stroke="#e5e7eb" strokeWidth="1" />
                      <text x={ML - 6} y={y + 3.5} textAnchor="end" fontSize="10" fill="#9ca3af">
                        {fmtNum(v)}
                      </text>
                    </g>
                  ))}

                  {/* vertical gridlines + labels (relative to reference) */}
                  {chart.xTicks.map((t) => (
                    <g key={t.label}>
                      <line
                        x1={t.x}
                        y1={MT}
                        x2={t.x}
                        y2={MT + PH}
                        stroke={t.label === "0" ? "#9ca3af" : "#f3f4f6"}
                        strokeWidth="1"
                        strokeDasharray={t.label === "0" ? "4 3" : undefined}
                      />
                      <text
                        x={t.x}
                        y={H - MB + 14}
                        textAnchor="middle"
                        fontSize="10"
                        fontWeight={t.label === "0" ? 700 : 400}
                        fill={t.label === "0" ? "#374151" : "#9ca3af"}
                      >
                        {t.label}
                      </text>
                    </g>
                  ))}

                  {/* baseline */}
                  <line x1={ML} y1={MT + PH} x2={W - MR} y2={MT + PH} stroke="#d1d5db" strokeWidth="1" />

                  {/* concentration curve */}
                  <path d={chart.area} fill="rgba(17,24,39,0.06)" stroke="none" />
                  <path d={chart.line} fill="none" stroke="#111827" strokeWidth="1.5" />

                  {/* actual "now" line (stays put while panning) */}
                  {nowX != null && (
                    <g>
                      <line
                        x1={nowX}
                        y1={MT}
                        x2={nowX}
                        y2={MT + PH}
                        stroke="#d97706"
                        strokeWidth="1"
                        strokeDasharray="4 3"
                      />
                      <text x={nowX} y={MT + 9} textAnchor="middle" fontSize="10" fontWeight={700} fill="#d97706">
                        今
                      </text>
                    </g>
                  )}

                  {/* dose markers */}
                  {chart.markers.map((m, i) => (
                    <circle
                      key={i}
                      cx={m.x}
                      cy={MT + PH}
                      r="3.5"
                      fill="#d97706"
                      stroke="#fff"
                      strokeWidth="1"
                    >
                      <title>{`${formatTaken(localIsoOf(m.t))}  量 ${fmtNum(m.amount)}`}</title>
                    </circle>
                  ))}
                </svg>
                <p className="mt-1 text-center text-xs text-gray-400">
                  グラフを左右にドラッグ / スワイプで基準時刻を移動
                </p>
                {drugDoses.length === 0 && (
                  <p className="mt-2 text-center text-sm text-gray-400">
                    この薬剤には量が入力された記録がありません
                  </p>
                )}
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}
