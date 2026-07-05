import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher, useSearchParams } from "react-router";
import type { ShouldRevalidateFunctionArgs } from "react-router";

import type { Route } from "./+types/graph";
import {
  getGraphData,
  saveGraphSettings,
  type GraphComment,
  type GraphDose,
  type GraphSettings,
} from "../db/graph.server";
import { formatTaken, isoToSlash, parseLocal } from "../lib/time";

export function meta(_: Route.MetaArgs) {
  return [{ title: "drec — 血中濃度グラフ" }];
}

export async function loader(_: Route.LoaderArgs) {
  return getGraphData();
}

// Settings saves don't change the loader data — skip revalidation for them.
export function shouldRevalidate({
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (formMethod && formMethod !== "GET") return false;
  return defaultShouldRevalidate;
}

export async function action({ request }: Route.ActionArgs) {
  const fd = await request.formData();
  const key = String(fd.get("drug_name") ?? "").trim();
  if (!key) return { ok: false as const };
  saveGraphSettings(key, {
    unit: posNum(String(fd.get("unit") ?? ""), 10),
    tmax_min: posNum(String(fd.get("tmax") ?? ""), 25),
    half_min: posNum(String(fd.get("half") ?? ""), 60),
    window_h: posNum(String(fd.get("win") ?? ""), 72),
  });
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// ごく簡易な血中濃度モデル:
//   服用量 dosePerUnit を 1 単位とし、服用から tmax 分かけて直線的に +units
//   （units = 量 / dosePerUnit）まで上昇、その後は半減期 half 分で指数減衰。
//   複数回の服用は単純に足し合わせる（重ね合わせ）。薬剤は薬剤ごとに別の線。
// ---------------------------------------------------------------------------

type DosePoint = { t: number; dose: GraphDose }; // t = epoch ms

/** Per-record peak override (minutes) wins over the default Tmax. */
function doseTmaxMs(d: DosePoint, defaultTmaxMs: number): number {
  return d.dose.peak_min != null ? d.dose.peak_min * 60_000 : defaultTmaxMs;
}

function makeConcFn(
  doses: DosePoint[],
  dosePerUnit: number,
  defaultTmaxMs: number,
  halfMs: number,
): (t: number) => number {
  return (t: number) => {
    let c = 0;
    for (const d of doses) {
      const dt = t - d.t;
      if (dt <= 0) continue;
      const units = d.dose.amount / dosePerUnit;
      const tmaxMs = doseTmaxMs(d, defaultTmaxMs);
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

function fmtNum(v: number): string {
  return String(parseFloat(v.toFixed(2)));
}

/** epoch ms -> naive local ISO (for reusing lib/time formatters). */
function localIsoOf(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Distinct per-drug line colors (blue is reserved for comment markers).
const DRUG_COLORS = [
  "#111827",
  "#dc2626",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
];
function drugColor(name: string, allNames: string[]): string {
  const i = allNames.indexOf(name);
  return DRUG_COLORS[(i < 0 ? 0 : i) % DRUG_COLORS.length];
}
const COMMENT_COLOR = "#2563eb";

// ---- per-drug settings (persisted in the DB via action) ---------------------

type StoredParams = { unit: string; tmax: string; half: string; win: string };
const DEFAULT_PARAMS: StoredParams = { unit: "10", tmax: "25", half: "60", win: "72" };

function toStored(s: GraphSettings | undefined): StoredParams {
  if (!s) return { ...DEFAULT_PARAMS };
  return {
    unit: String(s.unit),
    tmax: String(s.tmax_min),
    half: String(s.half_min),
    win: String(s.window_h),
  };
}

const HOUR = 3_600_000;
// Fixed local-midnight anchor so wall-clock ticks keep a stable phase.
const TICK_ANCHOR = new Date(2001, 0, 1).getTime();

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

type Marker =
  | { kind: "dose"; key: string; x: number; y: number; color: string; dose: GraphDose }
  | {
      kind: "comment";
      key: string;
      x: number;
      y: number;
      comment: GraphComment;
      concs: Array<{ name: string; color: string; v: number }>;
    };

export default function Graph({ loaderData }: Route.ComponentProps) {
  const { drugs, doses, comments, settings } = loaderData;
  const [searchParams, setSearchParams] = useSearchParams();

  // ---- selection: one or more drug names, persisted in the URL (?drug=…) ----
  const drugNames = useMemo(() => drugs.map((d) => d.name), [drugs]);
  const selected = useMemo(() => {
    const wanted = searchParams.getAll("drug").filter((n) => drugNames.includes(n));
    const uniq = drugNames.filter((n) => wanted.includes(n)); // stable order, deduped
    return uniq.length > 0 ? uniq : drugNames.slice(0, 1);
  }, [searchParams, drugNames]);

  // Which selected drug the parameter panel edits.
  const [focusSel, setFocusSel] = useState<string | null>(null);
  const focus =
    focusSel && selected.includes(focusSel) ? focusSel : (selected[0] ?? "");

  const [params, setParams] = useState<StoredParams>(() => toStored(settings[focus]));
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [refMs, setRefMs] = useState<number | null>(null); // 基準時刻（グラフ中央）
  const [follow, setFollow] = useState(true); // 基準時刻を現在時刻に追従させるか
  const [activeMarker, setActiveMarker] = useState<string | null>(null);

  const saveFetcher = useFetcher();
  // Latest settings edited this session (loader data goes stale after saves).
  const sessionSettings = useRef(new Map<string, StoredParams>());
  const saveTimer = useRef<number | null>(null);
  const pendingSave = useRef<{ key: string; p: StoredParams } | null>(null);
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

  function storedFor(key: string): StoredParams {
    return sessionSettings.current.get(key) ?? toStored(settings[key]);
  }

  // Reload params whenever the focused drug changes.
  useEffect(() => {
    setParams(storedFor(focus));
    setActiveMarker(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  function submitSave(key: string, p: StoredParams) {
    saveFetcher.submit(
      { drug_name: key, unit: p.unit, tmax: p.tmax, half: p.half, win: p.win },
      { method: "post" },
    );
  }

  function flushSave() {
    if (saveTimer.current != null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const pending = pendingSave.current;
    pendingSave.current = null;
    if (pending) submitSave(pending.key, pending.p);
  }

  /** Update one param field for the focused drug; persist to the DB (debounced). */
  function updateParam(patch: Partial<StoredParams>) {
    if (!focus) return;
    const next = { ...params, ...patch };
    setParams(next);
    sessionSettings.current.set(focus, next);
    pendingSave.current = { key: focus, p: next };
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      const pending = pendingSave.current;
      pendingSave.current = null;
      if (pending) submitSave(pending.key, pending.p);
    }, 600);
  }

  function setSelectedDrugs(names: string[]) {
    const sp = new URLSearchParams();
    for (const n of names) sp.append("drug", n);
    setSearchParams(sp, { replace: true, preventScrollReset: true });
  }

  /** Toggle a drug on/off (keep at least one selected). */
  function toggleDrug(name: string) {
    flushSave();
    const set = new Set(selected);
    if (set.has(name)) {
      if (set.size > 1) set.delete(name);
    } else {
      set.add(name);
    }
    setSelectedDrugs(drugNames.filter((n) => set.has(n)));
  }

  function changeFocus(name: string) {
    flushSave();
    setFocusSel(name);
  }

  function resetToNow() {
    const now = Date.now();
    setNowMs(now);
    setRefMs(now);
    setFollow(true);
  }

  const winH = posNum(params.win, 72);
  const windowMs = winH * HOUR;

  const dosesByDrug = useMemo(() => {
    const m = new Map<string, DosePoint[]>();
    for (const d of doses) {
      let arr = m.get(d.drug_name);
      if (!arr) {
        arr = [];
        m.set(d.drug_name, arr);
      }
      arr.push({ t: parseLocal(d.taken_at).getTime(), dose: d });
    }
    return m;
  }, [doses]);

  const chart = useMemo(() => {
    if (refMs == null || selected.length === 0) return null;
    const from = refMs - windowMs;
    const to = refMs + windowMs;

    // One series per selected drug, each with its own (focused = live) params.
    const series = selected.map((name) => {
      const p = name === focus ? params : storedFor(name);
      const dp = dosesByDrug.get(name) ?? [];
      const tmaxMs = posNum(p.tmax, 25) * 60_000;
      return {
        name,
        color: drugColor(name, drugNames),
        doses: dp,
        tmaxMs,
        fn: makeConcFn(dp, posNum(p.unit, 10), tmaxMs, posNum(p.half, 60) * 60_000),
      };
    });

    // ~400 regular samples plus exact kink points (dose time / dose peak).
    const step = Math.max(10_000, (to - from) / 400);
    const times: number[] = [];
    for (let t = from; t <= to; t += step) times.push(t);
    times.push(to);
    for (const s of series) {
      for (const d of s.doses) {
        if (d.t > from && d.t < to) times.push(d.t);
        const peak = d.t + doseTmaxMs(d, s.tmaxMs);
        if (peak > from && peak < to) times.push(peak);
      }
    }
    times.sort((a, b) => a - b);

    let maxC = 0;
    const seriesPts = series.map((s) => {
      const pts = times.map((t) => [t, s.fn(t)] as const);
      for (const [, c] of pts) if (c > maxC) maxC = c;
      return pts;
    });

    const yMax = Math.max(1, maxC) * 1.05;
    const X = (t: number) => ML + ((t - from) / (to - from)) * PW;
    const Y = (c: number) => MT + PH - (c / yMax) * PH;

    const lines = series.map((s, i) => {
      let d = "";
      for (const [t, c] of seriesPts[i]) d += `${d ? "L" : "M"}${X(t).toFixed(1)} ${Y(c).toFixed(1)}`;
      return { name: s.name, color: s.color, d };
    });
    // Light area fill only when a single drug is shown (keeps overlays clean).
    const area =
      lines.length === 1
        ? `${lines[0].d}L${X(to).toFixed(1)} ${Y(0).toFixed(1)}L${X(from).toFixed(1)} ${Y(0).toFixed(1)}Z`
        : null;

    const stepY = niceStep(yMax);
    const yLines: Array<{ v: number; y: number }> = [];
    for (let v = stepY; v <= yMax; v += stepY) yLines.push({ v, y: Y(v) });

    // Wall-clock-anchored ticks: fixed absolute times, so they slide together
    // with the curves while panning.
    const stepH = tickStepH(winH);
    const stepMs = stepH * HOUR;
    const first = TICK_ANCHOR + Math.ceil((from - TICK_ANCHOR) / stepMs) * stepMs;
    const xTicks: Array<{ key: number; x: number; label: string; strong: boolean }> = [];
    for (let t = first; t <= to; t += stepMs) {
      const dd = new Date(t);
      const midnight = dd.getHours() === 0 && dd.getMinutes() === 0;
      xTicks.push({
        key: t,
        x: X(t),
        label: midnight || stepH >= 24
          ? `${dd.getMonth() + 1}/${dd.getDate()}`
          : `${dd.getHours()}:00`,
        strong: midnight,
      });
    }

    // Markers: dose (drug color) on its curve; comment (blue) on the first
    // selected drug's curve, with each drug's concentration in the popover.
    const markers: Marker[] = [];
    for (const s of series) {
      for (const d of s.doses) {
        if (d.t < from || d.t > to) continue;
        markers.push({
          kind: "dose",
          key: `d${d.dose.id}`,
          x: X(d.t),
          y: Y(s.fn(d.t)),
          color: s.color,
          dose: d.dose,
        });
      }
    }
    const primary = series[0];
    for (const c of comments) {
      const t = parseLocal(c.commented_at).getTime();
      if (t < from || t > to) continue;
      markers.push({
        kind: "comment",
        key: `c${c.id}`,
        x: X(t),
        y: Y(primary.fn(t)),
        comment: c,
        concs: series.map((s) => ({ name: s.name, color: s.color, v: s.fn(t) })),
      });
    }

    const refVals = series.map((s) => ({ name: s.name, color: s.color, v: s.fn(refMs) }));

    return { lines, area, markers, yLines, xTicks, from, to, refVals };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, focus, params, dosesByDrug, comments, refMs, windowMs, winH, settings, drugNames]);

  // Position of the actual "now" line (may differ from center after panning).
  const nowX =
    chart != null && nowMs != null && nowMs >= chart.from && nowMs <= chart.to
      ? ML + ((nowMs - chart.from) / (chart.to - chart.from)) * PW
      : null;

  // ---- drag / swipe to move the reference time ----
  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (refMs == null) return;
    setActiveMarker(null);
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

  const single = selected.length === 1;
  const focusDoses = dosesByDrug.get(focus)?.length ?? 0;
  const focusTotal = drugs.find((d) => d.name === focus)?.count ?? 0;
  const focusExcluded = focusTotal - focusDoses;
  const isAtNow = follow || (refMs != null && nowMs != null && Math.abs(refMs - nowMs) < 60_000);
  const centerX = ML + PW / 2;

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
            <span className="text-sm font-medium text-gray-700">薬剤（複数選択可）</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {drugs.map((d) => {
                const on = selected.includes(d.name);
                const color = drugColor(d.name, drugNames);
                return (
                  <button
                    key={d.name}
                    type="button"
                    onClick={() => toggleDrug(d.name)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm ${
                      on ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: on ? color : "#d1d5db" }}
                    />
                    {d.name}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {!single && (
                <label className="col-span-2 block sm:col-span-1">
                  <span className="text-sm font-medium text-gray-700">編集対象</span>
                  <select
                    value={focus}
                    onChange={(e) => changeFocus(e.target.value)}
                    className={fieldClass}
                  >
                    {selected.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              )}
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
              服用量ごとに血中濃度 +1、ピークまで直線上昇→半減期で減衰（レコード個別の
              ピーク設定があれば優先）。{single ? "" : "各薬剤は保存済み設定で描画。上の「編集対象」で個別に調整できます。"}
              期間 ±{fmtNum(winH)}h。編集対象「{focus}」の対象レコード {focusDoses} 件
              {focusExcluded > 0 && `（量未入力 ${focusExcluded} 件は除外）`}
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
                  <button
                    type="button"
                    onClick={resetToNow}
                    disabled={isAtNow}
                    className="rounded-lg border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                  >
                    今に戻す
                  </button>
                </div>
                {/* legend + per-drug concentration at the reference time */}
                <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {chart.refVals.map((r) => (
                    <span key={r.name} className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-2.5 w-4 rounded-full"
                        style={{ backgroundColor: r.color }}
                      />
                      <span className="text-gray-700">{r.name}</span>
                      <span className="font-bold tabular-nums">{r.v.toFixed(2)}</span>
                    </span>
                  ))}
                </div>
                <div className="relative">
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

                  {/* wall-clock gridlines + labels (move together with the curves) */}
                  {chart.xTicks.map((t) => (
                    <g key={t.key}>
                      <line
                        x1={t.x}
                        y1={MT}
                        x2={t.x}
                        y2={MT + PH}
                        stroke={t.strong ? "#e5e7eb" : "#f3f4f6"}
                        strokeWidth="1"
                      />
                      <text
                        x={t.x}
                        y={H - MB + 14}
                        textAnchor="middle"
                        fontSize="10"
                        fontWeight={t.strong ? 700 : 400}
                        fill="#9ca3af"
                      >
                        {t.label}
                      </text>
                    </g>
                  ))}

                  {/* reference (center) line */}
                  <line
                    x1={centerX}
                    y1={MT}
                    x2={centerX}
                    y2={MT + PH}
                    stroke="#9ca3af"
                    strokeWidth="1"
                    strokeDasharray="4 3"
                  />
                  {!isAtNow && (
                    <text x={centerX} y={MT + 9} textAnchor="middle" fontSize="10" fontWeight={700} fill="#6b7280">
                      基準
                    </text>
                  )}

                  {/* baseline */}
                  <line x1={ML} y1={MT + PH} x2={W - MR} y2={MT + PH} stroke="#d1d5db" strokeWidth="1" />

                  {/* concentration curves (one per drug) */}
                  {chart.area && <path d={chart.area} fill="rgba(17,24,39,0.06)" stroke="none" />}
                  {chart.lines.map((l) => (
                    <path key={l.name} d={l.d} fill="none" stroke={l.color} strokeWidth="1.5" />
                  ))}

                  {/* actual "now" line (anchored to real time, slides while panning) */}
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

                  {/* markers: dose (drug color) / comment (blue). Large transparent
                      hit circle makes them easy to tap on touch screens. */}
                  {chart.markers.map((m) => {
                    const active = activeMarker === m.key;
                    const color = m.kind === "dose" ? m.color : COMMENT_COLOR;
                    return (
                      <g key={m.key}>
                        <circle
                          cx={m.x}
                          cy={m.y}
                          r={20}
                          fill="none"
                          pointerEvents="all"
                          tabIndex={0}
                          className="cursor-pointer outline-none"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMarker((cur) => (cur === m.key ? null : m.key));
                          }}
                          onFocus={() => setActiveMarker(m.key)}
                          onBlur={() => setActiveMarker((cur) => (cur === m.key ? null : cur))}
                        />
                        <circle
                          cx={m.x}
                          cy={m.y}
                          r={active ? 8 : 6}
                          fill={color}
                          stroke="#fff"
                          strokeWidth="1.5"
                          pointerEvents="none"
                        />
                      </g>
                    );
                  })}
                </svg>

                {/* marker detail popover */}
                {(() => {
                  const m = chart.markers.find((mk) => mk.key === activeMarker);
                  if (!m) return null;
                  const xPct = (m.x / W) * 100;
                  const yPct = (m.y / H) * 100;
                  const below = yPct < 30;
                  return (
                    <div
                      className="pointer-events-none absolute z-10 rounded-lg bg-gray-900 px-3 py-2 text-xs text-white shadow-lg"
                      style={{
                        left: `${xPct}%`,
                        top: `${yPct}%`,
                        transform: `translate(${xPct > 82 ? "-90%" : xPct < 18 ? "-10%" : "-50%"}, ${below ? "14px" : "calc(-100% - 14px)"})`,
                        maxWidth: "70%",
                      }}
                    >
                      {m.kind === "dose" ? (
                        <>
                          <div className="font-semibold">
                            {m.dose.drug_name}
                            {m.dose.product_name && (
                              <span className="ml-1.5 font-normal text-gray-300">
                                {m.dose.product_name}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-gray-300 tabular-nums">
                            {formatTaken(m.dose.taken_at)}
                            {m.dose.taken_error_min != null && ` ±${m.dose.taken_error_min}m`}
                            <span className="ml-1.5 text-white">
                              量 {fmtNum(m.dose.amount)}
                              {m.dose.unit ?? ""}
                            </span>
                            {m.dose.peak_min != null && (
                              <span className="ml-1.5">ピーク{fmtNum(m.dose.peak_min)}分</span>
                            )}
                          </div>
                          {m.dose.note && (
                            <div className="mt-0.5 break-words text-gray-300">{m.dose.note}</div>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="font-semibold">💬 コメント</div>
                          <div className="mt-0.5 text-gray-300 tabular-nums">
                            {formatTaken(m.comment.commented_at)}
                            {m.comment.commented_error_min != null &&
                              ` ±${m.comment.commented_error_min}m`}
                          </div>
                          <div className="mt-1 whitespace-pre-wrap break-words">
                            {m.comment.body}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 tabular-nums">
                            {m.concs.map((c) => (
                              <span key={c.name} className="inline-flex items-center gap-1">
                                <span
                                  className="inline-block h-2 w-2 rounded-full"
                                  style={{ backgroundColor: c.color }}
                                />
                                {c.name} {c.v.toFixed(2)}
                              </span>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()}
                </div>
                <p className="mt-1 text-center text-xs text-gray-400">
                  グラフを左右にドラッグ / スワイプで基準時刻を移動。点（服用 / 💬コメント）をタップで詳細
                </p>
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}
