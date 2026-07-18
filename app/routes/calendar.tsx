import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import type { Route } from "./+types/calendar";
import { getMonthData } from "../db/calendar.server";
import type { Rec } from "../db/records.server";
import type { Comment } from "../db/comments.server";
import { drugColor } from "../lib/colors";
import { dateKey, formatDateHeader, nowLocalISO } from "../lib/time";

export function meta(_: Route.MetaArgs) {
  return [{ title: "drec — カレンダー" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("month") ?? "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw)
    ? raw
    : nowLocalISO().slice(0, 7);
  return { month, ...getMonthData(month) };
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${y}年${m}月`;
}

type DayCell = {
  day: string; // YYYY-MM-DD
  date: number;
  records: Rec[];
  comments: Comment[];
};

export default function Calendar({ loaderData }: Route.ComponentProps) {
  const { month, records, comments } = loaderData;
  const [selected, setSelected] = useState<string | null>(null);
  const [today, setToday] = useState<string | null>(null);

  // Today is set client-side only (SSR hydration safety).
  useEffect(() => {
    setToday(dateKey(nowLocalISO()));
  }, []);

  // Month changed -> drop the day selection.
  useEffect(() => {
    setSelected(null);
  }, [month]);

  const cells = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const byDay = new Map<string, DayCell>();
    const list: DayCell[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const day = `${month}-${String(d).padStart(2, "0")}`;
      const cell: DayCell = { day, date: d, records: [], comments: [] };
      byDay.set(day, cell);
      list.push(cell);
    }
    for (const r of records) byDay.get(dateKey(r.taken_at))?.records.push(r);
    for (const c of comments)
      byDay.get(dateKey(c.commented_at))?.comments.push(c);
    return list;
  }, [month, records, comments]);

  const leadingBlanks = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    return new Date(y, m - 1, 1).getDay();
  }, [month]);

  const selectedCell = selected
    ? cells.find((c) => c.day === selected) ?? null
    : null;
  const isCurrentMonth = today != null && today.slice(0, 7) === month;

  return (
    <main className="mx-auto max-w-xl px-4 pb-24">
      <header className="flex items-baseline justify-between py-4">
        <h1 className="text-xl font-bold tracking-tight">カレンダー</h1>
        <Link to="/" className="text-sm text-gray-500 hover:text-gray-900">
          ← 戻る
        </Link>
      </header>

      <div className="flex items-center justify-between">
        <Link
          to={`/calendar?month=${shiftMonth(month, -1)}`}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          ← 前月
        </Link>
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-semibold">{monthLabel(month)}</h2>
          {!isCurrentMonth && today && (
            <Link
              to="/calendar"
              className="text-xs text-gray-400 underline hover:text-gray-700"
            >
              今月へ
            </Link>
          )}
        </div>
        <Link
          to={`/calendar?month=${shiftMonth(month, 1)}`}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          翌月 →
        </Link>
      </div>

      <p className="mt-2 text-right text-xs text-gray-400 tabular-nums">
        この月: 💊{records.length}回・💬{comments.length}件
      </p>

      <div className="mt-2 rounded-2xl border border-gray-200 bg-white p-2 shadow-sm">
        <div className="grid grid-cols-7 text-center text-xs text-gray-400">
          {WEEKDAYS.map((w, i) => (
            <div
              key={w}
              className={`py-1 ${i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : ""}`}
            >
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: leadingBlanks }, (_, i) => (
            <div key={`b${i}`} />
          ))}
          {cells.map((cell) => {
            const weekday = (leadingBlanks + cell.date - 1) % 7;
            const isToday = cell.day === today;
            const isSelected = cell.day === selected;
            const empty =
              cell.records.length === 0 && cell.comments.length === 0;
            return (
              <button
                key={cell.day}
                type="button"
                onClick={() => setSelected(isSelected ? null : cell.day)}
                className={`min-h-14 rounded-lg border p-1 text-left align-top transition ${
                  isSelected
                    ? "border-gray-900 ring-1 ring-gray-900"
                    : isToday
                      ? "border-amber-400"
                      : "border-transparent hover:border-gray-200"
                } ${empty ? "" : "bg-gray-50"}`}
              >
                <div
                  className={`text-xs tabular-nums ${
                    isToday
                      ? "font-bold text-amber-600"
                      : weekday === 0
                        ? "text-red-400"
                        : weekday === 6
                          ? "text-blue-400"
                          : "text-gray-500"
                  }`}
                >
                  {cell.date}
                </div>
                {cell.records.length > 0 && (
                  <div className="mt-0.5 flex flex-wrap items-center gap-0.5">
                    {cell.records.slice(0, 4).map((r) => (
                      <span
                        key={r.id}
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: drugColor(r.drug_name) }}
                      />
                    ))}
                    {cell.records.length > 4 && (
                      <span className="text-[9px] leading-none text-gray-400">
                        +{cell.records.length - 4}
                      </span>
                    )}
                  </div>
                )}
                {cell.comments.length > 0 && (
                  <div className="mt-0.5 text-[9px] leading-none text-amber-600">
                    💬{cell.comments.length}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {selectedCell && (
        <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="font-semibold text-gray-800">
            {formatDateHeader(selectedCell.day)}
          </h3>
          {selectedCell.records.length === 0 &&
          selectedCell.comments.length === 0 ? (
            <p className="mt-2 text-sm text-gray-400">記録はありません</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {[
                ...selectedCell.records.map((r) => ({
                  key: `r${r.id}`,
                  t: r.taken_at,
                  rec: r,
                  com: null as Comment | null,
                })),
                ...selectedCell.comments.map((c) => ({
                  key: `c${c.id}`,
                  t: c.commented_at,
                  rec: null as Rec | null,
                  com: c,
                })),
              ]
                .sort((a, b) => (a.t < b.t ? -1 : 1))
                .map((item) =>
                  item.rec ? (
                    <li key={item.key} className="flex items-baseline gap-2">
                      <span className="text-xs text-gray-400 tabular-nums">
                        {item.t.slice(11, 16)}
                      </span>
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 self-center rounded-full"
                        style={{
                          backgroundColor: drugColor(item.rec.drug_name),
                        }}
                      />
                      <span className="min-w-0 text-sm">
                        <span className="font-medium">
                          {item.rec.drug_name}
                        </span>
                        {item.rec.amount != null && (
                          <span className="ml-1 text-gray-600">
                            {item.rec.amount}
                            {item.rec.unit ?? ""}
                          </span>
                        )}
                        {item.rec.note && (
                          <span className="ml-1 text-gray-500">
                            — {item.rec.note}
                          </span>
                        )}
                      </span>
                    </li>
                  ) : (
                    <li key={item.key} className="flex items-baseline gap-2">
                      <span className="text-xs text-gray-400 tabular-nums">
                        {item.t.slice(11, 16)}
                      </span>
                      <span className="min-w-0 break-words rounded-lg bg-amber-50 px-2 py-1 text-sm text-gray-800 ring-1 ring-amber-200">
                        {item.com!.body}
                      </span>
                    </li>
                  ),
                )}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
