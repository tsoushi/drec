import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher, useNavigation, useSearchParams } from "react-router";

import type { Route } from "./+types/notes";
import { getNotesPage } from "../db/notes.server";
import type { Rec } from "../db/records.server";
import type { Comment, MentionRef } from "../db/comments.server";
import { drugColor } from "../lib/colors";
import {
  dateKey,
  formatDateHeader,
  formatTaken,
  mentionDiffLabel,
  nowLocalISO,
} from "../lib/time";

const DAYS_PER_PAGE = 14;
const MAX_DAYS = 3650;

export function meta(_: Route.MetaArgs) {
  return [{ title: "drec — ノート" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const raw = Number(url.searchParams.get("days"));
  const days =
    Number.isInteger(raw) && raw > 0 ? Math.min(raw, MAX_DAYS) : DAYS_PER_PAGE;
  return { ...getNotesPage(days), days };
}

// Writes are POSTed to the home action ("/?index") so every mutation keeps
// going through the single logChange-audited path. This route has no action.

type ActionResult = { ok: true } | { ok: false; error: string };

function timeOfDay(iso: string): string {
  return iso.slice(11, 16);
}

type DayItem =
  | { kind: "record"; t: string; key: string; rec: Rec; seq: number }
  | { kind: "comment"; t: string; key: string; comment: Comment };

type DayGroup = {
  day: string;
  items: DayItem[];
  recordCount: number;
  commentCount: number;
};

type Composer = { day: string; editing: Comment | null };

/** Record ids among a comment's mentions (this screen only manages records). */
function recordIdsOf(mentions: MentionRef[]): number[] {
  return mentions.filter((m) => m.kind === "record").map((m) => m.id);
}
/** One-line preview of a comment body for compact mention chips. */
function excerpt(s: string, n = 14): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

export default function Notes({ loaderData }: Route.ComponentProps) {
  const { records, comments, mentionedRecords, hasMore, days } = loaderData;
  const fetcher = useFetcher<ActionResult>();
  const navigation = useNavigation();
  const [, setSearchParams] = useSearchParams();

  const [composer, setComposer] = useState<Composer | null>(null);
  const [mentions, setMentions] = useState<number[]>([]);
  const [memoTime, setMemoTime] = useState("12:00");
  const [composerKey, setComposerKey] = useState(0);
  const [highlightRec, setHighlightRec] = useState<number | null>(null);
  const [highlightComments, setHighlightComments] = useState<number[]>([]);
  const [today, setToday] = useState<string | null>(null);

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const busyRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const requestedRef = useRef(0);

  // "Today" is computed on the client only (avoids SSR hydration mismatch).
  useEffect(() => {
    setToday(dateKey(nowLocalISO()));
  }, []);

  const recordsById = useMemo(() => {
    const m = new Map<number, Rec>();
    for (const r of records) m.set(r.id, r);
    for (const r of mentionedRecords) m.set(r.id, r);
    return m;
  }, [records, mentionedRecords]);

  const commentsById = useMemo(() => {
    const m = new Map<number, Comment>();
    for (const c of comments) m.set(c.id, c);
    return m;
  }, [comments]);

  // Per-day sequence number of each in-window record (1 = first dose of the day).
  const seqById = useMemo(() => {
    const m = new Map<number, number>();
    let day = "";
    let seq = 0;
    for (const r of records) {
      const d = dateKey(r.taken_at);
      if (d !== day) {
        day = d;
        seq = 0;
      }
      m.set(r.id, ++seq);
    }
    return m;
  }, [records]);

  // How many loaded comments mention each record (shown as 💬n on the record).
  const commentCountByRec = useMemo(() => {
    const m = new Map<number, number>();
    for (const c of comments)
      for (const ref of c.mentions)
        if (ref.kind === "record") m.set(ref.id, (m.get(ref.id) ?? 0) + 1);
    return m;
  }, [comments]);

  // Group everything into day sections: days newest first, items morning→night.
  const dayGroups = useMemo(() => {
    const byDay = new Map<string, DayGroup>();
    const groupFor = (day: string): DayGroup => {
      let g = byDay.get(day);
      if (!g) {
        g = { day, items: [], recordCount: 0, commentCount: 0 };
        byDay.set(day, g);
      }
      return g;
    };
    for (const r of records) {
      const g = groupFor(dateKey(r.taken_at));
      g.items.push({
        kind: "record",
        t: r.taken_at,
        key: `r${r.id}`,
        rec: r,
        seq: seqById.get(r.id) ?? 0,
      });
      g.recordCount++;
    }
    for (const c of comments) {
      const g = groupFor(dateKey(c.commented_at));
      g.items.push({ kind: "comment", t: c.commented_at, key: `c${c.id}`, comment: c });
      g.commentCount++;
    }
    for (const g of byDay.values()) {
      g.items.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
    }
    const groups = Array.from(byDay.values()).sort((a, b) =>
      a.day < b.day ? 1 : -1,
    );
    // Always offer today's section so a memo can be written before any dose.
    if (today && (groups.length === 0 || groups[0].day < today)) {
      groups.unshift({ day: today, items: [], recordCount: 0, commentCount: 0 });
    }
    return groups;
  }, [records, comments, seqById, today]);

  // Close the composer once its submission has succeeded. The flag is set in
  // the form's onSubmit (not by watching fetcher.state) because a fast local
  // submission can settle without ever committing an intermediate
  // submitting/loading render.
  useEffect(() => {
    if (fetcher.state !== "idle" || !busyRef.current) return;
    busyRef.current = false;
    if (fetcher.data?.ok) closeComposer();
  }, [fetcher.state, fetcher.data]);

  // Infinite scroll: when the bottom sentinel becomes visible, grow ?days=N.
  // Keeping the cursor in the URL means post-memo revalidation reloads the
  // whole visible window consistently.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        const target = days + DAYS_PER_PAGE;
        if (requestedRef.current >= target) return;
        requestedRef.current = target;
        setSearchParams(
          (prev) => {
            const p = new URLSearchParams(prev);
            p.set("days", String(target));
            return p;
          },
          { replace: true, preventScrollReset: true },
        );
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [days, hasMore, setSearchParams]);

  function openComposer(day: string, editing: Comment | null, mentionIds: number[]) {
    setComposer({ day, editing });
    setMentions(mentionIds);
    setMemoTime(
      editing
        ? timeOfDay(editing.commented_at)
        : day === today
          ? timeOfDay(nowLocalISO())
          : "12:00",
    );
    setComposerKey((k) => k + 1);
    window.setTimeout(() => bodyRef.current?.focus(), 0);
  }

  function closeComposer() {
    setComposer(null);
    setMentions([]);
  }

  /** 記録の「＋メモ」: attach to the open composer, or start one on that day. */
  function memoOnRecord(r: Rec) {
    if (composer) {
      setMentions((cur) =>
        cur.includes(r.id) ? cur.filter((x) => x !== r.id) : [...cur, r.id],
      );
      bodyRef.current?.focus();
    } else {
      openComposer(dateKey(r.taken_at), null, [r.id]);
    }
  }

  function flashRecord(rid: number) {
    setHighlightRec(rid);
    document.getElementById(`note-rec-${rid}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    window.setTimeout(
      () => setHighlightRec((cur) => (cur === rid ? null : cur)),
      1600,
    );
  }

  function flashComments(rid: number) {
    const ids = comments
      .filter((c) =>
        c.mentions.some((ref) => ref.kind === "record" && ref.id === rid),
      )
      .map((c) => c.id);
    if (ids.length === 0) return;
    setHighlightComments(ids);
    document.getElementById(`note-com-${ids[0]}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    window.setTimeout(() => setHighlightComments([]), 1600);
  }

  function flashComment(id: number) {
    setHighlightComments([id]);
    document.getElementById(`note-com-${id}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    window.setTimeout(() => setHighlightComments([]), 1600);
  }

  const loadingMore = navigation.state === "loading" && hasMore;
  const errorMsg = fetcher.data && !fetcher.data.ok ? fetcher.data.error : null;

  return (
    <main className="mx-auto max-w-xl px-4 pb-24">
      <header className="flex items-baseline justify-between py-4">
        <h1 className="text-xl font-bold tracking-tight">ノート</h1>
        <div className="flex items-baseline gap-3">
          <span className="text-sm text-gray-500">1日ごとの記録とメモ</span>
          <Link to="/" className="text-sm text-gray-500 hover:text-gray-900">
            ← 戻る
          </Link>
        </div>
      </header>

      {dayGroups.length === 0 ? (
        <p className="py-12 text-center text-gray-400">まだ記録がありません</p>
      ) : (
        <div className="space-y-6">
          {dayGroups.map((g) => (
            <section key={g.day}>
              <div className="sticky top-0 z-10 -mx-1 flex items-baseline justify-between rounded-lg bg-gray-50/95 px-1 py-2 backdrop-blur">
                <h2 className="font-semibold text-gray-800">
                  {formatDateHeader(g.day)}
                  {g.day === today && (
                    <span className="ml-2 rounded-full bg-gray-900 px-2 py-0.5 text-[10px] font-bold text-white">
                      今日
                    </span>
                  )}
                </h2>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 tabular-nums">
                    💊{g.recordCount}・💬{g.commentCount}
                  </span>
                  {composer?.day !== g.day && (
                    <button
                      type="button"
                      onClick={() => openComposer(g.day, null, [])}
                      className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                    >
                      ＋ メモ
                    </button>
                  )}
                </div>
              </div>

              {g.items.length === 0 ? (
                <p className="px-2 py-3 text-sm text-gray-400">
                  まだ何もありません
                </p>
              ) : (
                <div className="relative mt-1">
                  <div className="absolute bottom-2 left-[9px] top-2 w-px bg-gray-200" />
                  <ul className="space-y-2">
                    {g.items.map((item) =>
                      item.kind === "record" ? (
                        <NoteRecordRow
                          key={item.key}
                          r={item.rec}
                          seq={item.seq}
                          commentCount={commentCountByRec.get(item.rec.id) ?? 0}
                          highlighted={highlightRec === item.rec.id}
                          mentionActive={
                            composer !== null && mentions.includes(item.rec.id)
                          }
                          onMemo={memoOnRecord}
                          onShowComments={flashComments}
                        />
                      ) : (
                        <NoteCommentRow
                          key={item.key}
                          c={item.comment}
                          editing={composer?.editing?.id === item.comment.id}
                          highlighted={highlightComments.includes(item.comment.id)}
                          recordsById={recordsById}
                          commentsById={commentsById}
                          seqById={seqById}
                          onEdit={(c) =>
                            openComposer(
                              dateKey(c.commented_at),
                              c,
                              recordIdsOf(c.mentions),
                            )
                          }
                          onMentionClick={flashRecord}
                          onCommentMentionClick={flashComment}
                        />
                      ),
                    )}
                  </ul>
                </div>
              )}

              {composer?.day === g.day && (
                <fetcher.Form
                  key={composerKey}
                  method="post"
                  action="/?index"
                  onSubmit={() => {
                    busyRef.current = true;
                  }}
                  className="mt-2 rounded-xl border border-gray-300 bg-white p-3 shadow-sm"
                >
                  <input
                    type="hidden"
                    name="intent"
                    value={composer.editing ? "comment_update" : "comment_create"}
                  />
                  {composer.editing && (
                    <input type="hidden" name="id" value={composer.editing.id} />
                  )}
                  <input
                    type="hidden"
                    name="mentions"
                    value={[
                      // Record mentions are what this screen edits; comment
                      // mentions (set on the home screen) are preserved as-is.
                      ...mentions.map((id) => `r${id}`),
                      ...(composer.editing?.mentions ?? [])
                        .filter((ref) => ref.kind === "comment")
                        .map((ref) => `c${ref.id}`),
                    ].join(",")}
                  />
                  <input
                    type="hidden"
                    name="taken_at"
                    value={`${g.day.replaceAll("-", "/")} ${memoTime}`}
                  />
                  <input
                    type="hidden"
                    name="taken_error_min"
                    value={composer.editing?.commented_error_min ?? ""}
                  />

                  <textarea
                    ref={bodyRef}
                    name="body"
                    defaultValue={composer.editing?.body ?? ""}
                    required
                    rows={3}
                    placeholder="この日のメモ（記録の「＋メモ」で記録を紐づけ）"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base outline-none focus:border-gray-900"
                  />

                  {mentions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {mentions.map((rid) => {
                        const rec = recordsById.get(rid);
                        return (
                          <span
                            key={rid}
                            className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700"
                          >
                            {rec ? (
                              <>
                                <SeqDot
                                  seq={seqById.get(rid)}
                                  color={drugColor(rec.drug_name)}
                                />
                                {rec.drug_name}
                                <span className="text-gray-400">
                                  {formatTaken(rec.taken_at)}
                                </span>
                              </>
                            ) : (
                              `記録 #${rid}`
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setMentions((cur) => cur.filter((x) => x !== rid))
                              }
                              className="ml-0.5 text-gray-400 hover:text-gray-700"
                              aria-label="紐づけを外す"
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {errorMsg && (
                    <p className="mt-2 text-sm text-red-600">{errorMsg}</p>
                  )}

                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="time"
                      value={memoTime}
                      onChange={(e) => setMemoTime(e.target.value)}
                      required
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-gray-900"
                    />
                    <button
                      type="submit"
                      disabled={fetcher.state !== "idle"}
                      className="flex-1 rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {composer.editing ? "更新する" : "メモする"}
                    </button>
                    <button
                      type="button"
                      onClick={closeComposer}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      キャンセル
                    </button>
                  </div>
                </fetcher.Form>
              )}
            </section>
          ))}
        </div>
      )}

      <div ref={sentinelRef} className="h-8" />
      {loadingMore ? (
        <p className="pb-4 text-center text-sm text-gray-400">読み込み中…</p>
      ) : (
        !hasMore &&
        dayGroups.length > 0 && (
          <p className="pb-4 text-center text-xs text-gray-300">
            これより前の記録はありません
          </p>
        )
      )}
    </main>
  );
}

function SeqDot({ seq, color }: { seq: number | undefined; color: string }) {
  return (
    <span
      className="inline-flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 text-[10px] font-bold text-white"
      style={{ backgroundColor: color }}
    >
      {seq ?? "💊"}
    </span>
  );
}

function NoteRecordRow({
  r,
  seq,
  commentCount,
  highlighted,
  mentionActive,
  onMemo,
  onShowComments,
}: {
  r: Rec;
  seq: number;
  commentCount: number;
  highlighted: boolean;
  mentionActive: boolean;
  onMemo: (r: Rec) => void;
  onShowComments: (rid: number) => void;
}) {
  const color = drugColor(r.drug_name);
  return (
    <li id={`note-rec-${r.id}`} className="relative scroll-mt-14 pl-7">
      <span
        className="absolute left-0 top-3 flex h-[19px] w-[19px] items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-gray-50"
        style={{ backgroundColor: color }}
      >
        {seq}
      </span>
      <div
        className={`rounded-xl border bg-white p-3 shadow-sm transition ${
          highlighted
            ? "border-amber-400 ring-2 ring-amber-300"
            : "border-gray-200"
        }`}
        style={{ borderLeftWidth: 3, borderLeftColor: color }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs text-gray-500 tabular-nums">
              {timeOfDay(r.taken_at)}
              {r.taken_error_min != null && ` ±${r.taken_error_min}m`}
            </div>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold">{r.drug_name}</span>
              {r.product_name && (
                <span className="text-sm text-gray-500">{r.product_name}</span>
              )}
              {(r.amount != null || r.unit) && (
                <span className="text-sm text-gray-700">
                  {r.amount ?? ""}
                  {r.unit ?? ""}
                </span>
              )}
            </div>
            {r.note && <div className="mt-1 text-sm text-gray-700">{r.note}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {commentCount > 0 && (
              <button
                type="button"
                onClick={() => onShowComments(r.id)}
                className="rounded-md px-1.5 py-1 text-xs text-amber-700 hover:bg-amber-50"
                title="このメモを表示"
              >
                💬{commentCount}
              </button>
            )}
            <button
              type="button"
              onClick={() => onMemo(r)}
              className={`rounded-md px-2 py-1 text-xs font-medium ${
                mentionActive
                  ? "bg-gray-900 text-white"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {mentionActive ? "✓ メモ" : "＋ メモ"}
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

function NoteCommentRow({
  c,
  editing,
  highlighted,
  recordsById,
  commentsById,
  seqById,
  onEdit,
  onMentionClick,
  onCommentMentionClick,
}: {
  c: Comment;
  editing: boolean;
  highlighted: boolean;
  recordsById: Map<number, Rec>;
  commentsById: Map<number, Comment>;
  seqById: Map<number, number>;
  onEdit: (c: Comment) => void;
  onMentionClick: (rid: number) => void;
  onCommentMentionClick: (id: number) => void;
}) {
  const del = useFetcher();
  const [confirming, setConfirming] = useState(false);
  const busy = del.state !== "idle";
  const commentDay = dateKey(c.commented_at);

  function remove() {
    setConfirming(false);
    del.submit(
      { intent: "comment_delete", id: String(c.id) },
      { method: "post", action: "/?index" },
    );
  }

  return (
    <li id={`note-com-${c.id}`} className="relative scroll-mt-14 pl-7">
      <span className="absolute left-[5px] top-4 h-[9px] w-[9px] rounded-full bg-amber-400 ring-2 ring-gray-50" />
      <div
        className={`rounded-xl border bg-amber-50 p-3 shadow-sm transition ${
          editing
            ? "border-gray-900"
            : highlighted
              ? "border-blue-400 ring-2 ring-blue-300"
              : "border-amber-200"
        } ${busy ? "opacity-40" : ""}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs text-amber-700 tabular-nums">
              {timeOfDay(c.commented_at)}
              {c.commented_error_min != null && ` ±${c.commented_error_min}m`}
            </div>
            <div className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-800">
              {c.body}
            </div>
            {c.mentions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {c.mentions.map((ref) => {
                  if (ref.kind === "record") {
                    const rec = recordsById.get(ref.id);
                    const seq = seqById.get(ref.id);
                    const sameDay = rec && dateKey(rec.taken_at) === commentDay;
                    return (
                      <button
                        key={`r${ref.id}`}
                        type="button"
                        onClick={() =>
                          rec && seq != null && onMentionClick(ref.id)
                        }
                        className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs text-gray-700 ring-1 ring-amber-200 hover:bg-amber-100"
                      >
                        {rec ? (
                          <>
                            <SeqDot seq={seq} color={drugColor(rec.drug_name)} />
                            {rec.drug_name}
                            {!sameDay && (
                              <span className="text-gray-400">
                                {formatTaken(rec.taken_at)}
                              </span>
                            )}
                            <span className="font-semibold text-amber-700">
                              {mentionDiffLabel(c.commented_at, rec.taken_at)}
                            </span>
                          </>
                        ) : (
                          `記録 #${ref.id}`
                        )}
                      </button>
                    );
                  }
                  if (ref.kind === "mental") {
                    // The notes screen doesn't load mental data; show a compact
                    // non-navigating marker (full detail lives on the home screen).
                    return (
                      <span
                        key={`m${ref.id}`}
                        className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs text-gray-500 ring-1 ring-violet-200"
                      >
                        🧠 メンタル
                      </span>
                    );
                  }
                  const tc = commentsById.get(ref.id);
                  return (
                    <button
                      key={`c${ref.id}`}
                      type="button"
                      onClick={() => tc && onCommentMentionClick(ref.id)}
                      className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs text-gray-700 ring-1 ring-blue-200 hover:bg-blue-50"
                    >
                      💬 {tc ? excerpt(tc.body) : `コメント #${ref.id}`}
                      {tc && (
                        <span className="font-semibold text-amber-700">
                          {mentionDiffLabel(c.commented_at, tc.commented_at)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => onEdit(c)}
              className="rounded-md px-2 py-1 text-xs font-medium text-gray-600 hover:bg-amber-100"
            >
              編集
            </button>
            {!confirming ? (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="rounded-md px-1.5 py-1 text-xs text-gray-400 hover:bg-amber-100"
              >
                削除
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={remove}
                  className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white"
                >
                  削除する
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-md px-1.5 py-1 text-xs text-gray-500 hover:bg-amber-100"
                >
                  やめる
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
