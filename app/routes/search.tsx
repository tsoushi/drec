import { Fragment, useMemo } from "react";
import { Form, Link } from "react-router";

import type { Route } from "./+types/search";
import { searchAll } from "../db/search.server";
import type { Rec } from "../db/records.server";
import type { Comment } from "../db/comments.server";
import { drugColor } from "../lib/colors";
import { dateKey, formatDateHeader, formatTaken } from "../lib/time";

export function meta(_: Route.MetaArgs) {
  return [{ title: "drec — 検索" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q === "") {
    return { q, records: [], comments: [], mentionedRecords: [] };
  }
  return { q, ...searchAll(q) };
}

/** Highlight every (ASCII case-insensitive) occurrence of q in text. */
function Hi({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const parts: Array<{ s: string; hit: boolean }> = [];
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  let i = 0;
  while (i < text.length) {
    const at = lower.indexOf(ql, i);
    if (at === -1) {
      parts.push({ s: text.slice(i), hit: false });
      break;
    }
    if (at > i) parts.push({ s: text.slice(i, at), hit: false });
    parts.push({ s: text.slice(at, at + q.length), hit: true });
    i = at + q.length;
  }
  return (
    <>
      {parts.map((p, idx) =>
        p.hit ? (
          <mark key={idx} className="rounded-sm bg-yellow-200 px-0.5">
            {p.s}
          </mark>
        ) : (
          <Fragment key={idx}>{p.s}</Fragment>
        ),
      )}
    </>
  );
}

export default function Search({ loaderData }: Route.ComponentProps) {
  const { q, records, comments, mentionedRecords } = loaderData;

  const recordsById = useMemo(() => {
    const m = new Map<number, Rec>();
    for (const r of records) m.set(r.id, r);
    for (const r of mentionedRecords) m.set(r.id, r);
    return m;
  }, [records, mentionedRecords]);

  // Merge into one newest-first timeline with day headers (like home).
  const results = useMemo(() => {
    const items: Array<
      | { kind: "record"; t: string; key: string; rec: Rec }
      | { kind: "comment"; t: string; key: string; comment: Comment }
    > = [
      ...records.map((r) => ({
        kind: "record" as const,
        t: r.taken_at,
        key: `r${r.id}`,
        rec: r,
      })),
      ...comments.map((c) => ({
        kind: "comment" as const,
        t: c.commented_at,
        key: `c${c.id}`,
        comment: c,
      })),
    ];
    items.sort((a, b) => (a.t < b.t ? 1 : a.t > b.t ? -1 : 0));
    return items;
  }, [records, comments]);

  return (
    <main className="mx-auto max-w-xl px-4 pb-24">
      <header className="flex items-baseline justify-between py-4">
        <h1 className="text-xl font-bold tracking-tight">検索</h1>
        <Link to="/" className="text-sm text-gray-500 hover:text-gray-900">
          ← 戻る
        </Link>
      </header>

      <Form method="get" className="flex gap-2">
        <input
          name="q"
          type="search"
          defaultValue={q}
          placeholder="薬剤名・製品名・備考・コメントを検索"
          autoComplete="off"
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base outline-none focus:border-gray-900"
        />
        <button
          type="submit"
          className="shrink-0 rounded-lg bg-gray-900 px-4 py-2 text-base font-semibold text-white"
        >
          検索
        </button>
      </Form>

      {q === "" ? (
        <p className="py-12 text-center text-sm text-gray-400">
          キーワードを入力してください（部分一致）
        </p>
      ) : results.length === 0 ? (
        <p className="py-12 text-center text-gray-400">
          「{q}」に一致するものはありません
        </p>
      ) : (
        <section className="mt-4">
          <p className="px-1 text-xs text-gray-400 tabular-nums">
            💊{records.length}件・💬{comments.length}件
            {(records.length >= 100 || comments.length >= 100) &&
              "（新しい順に100件まで）"}
          </p>
          <ul className="mt-1 space-y-2">
            {results.map((item, i) => {
              const showHeader =
                i === 0 || dateKey(item.t) !== dateKey(results[i - 1].t);
              return (
                <Fragment key={item.key}>
                  {showHeader && (
                    <li className="px-1 pt-3 text-sm font-semibold text-gray-500">
                      {formatDateHeader(item.t)}
                    </li>
                  )}
                  {item.kind === "record" ? (
                    <li
                      className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
                      style={{
                        borderLeftWidth: 3,
                        borderLeftColor: drugColor(item.rec.drug_name),
                      }}
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-semibold">
                          <Hi text={item.rec.drug_name} q={q} />
                        </span>
                        {item.rec.product_name && (
                          <span className="text-sm text-gray-500">
                            <Hi text={item.rec.product_name} q={q} />
                          </span>
                        )}
                        {item.rec.amount != null && (
                          <span className="text-sm text-gray-700">
                            {item.rec.amount}
                            {item.rec.unit ?? ""}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-sm text-gray-500">
                        {formatTaken(item.rec.taken_at)}
                      </div>
                      {item.rec.note && (
                        <div className="mt-1 text-sm text-gray-700">
                          <Hi text={item.rec.note} q={q} />
                        </div>
                      )}
                    </li>
                  ) : (
                    <li className="rounded-xl border border-amber-200 bg-amber-50 p-3 shadow-sm">
                      <div className="text-xs font-medium text-amber-700">
                        💬 {formatTaken(item.comment.commented_at)}
                      </div>
                      <div className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-800">
                        <Hi text={item.comment.body} q={q} />
                      </div>
                      {item.comment.mentions.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {item.comment.mentions.map((rid) => {
                            const rec = recordsById.get(rid);
                            return (
                              <span
                                key={rid}
                                className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs text-gray-600 ring-1 ring-amber-200"
                              >
                                💊 {rec ? rec.drug_name : `記録 #${rid}`}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </li>
                  )}
                </Fragment>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
