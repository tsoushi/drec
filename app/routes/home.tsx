import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";

import type { Route } from "./+types/home";
import {
  createRecord,
  getSuggestions,
  listRecords,
  softDeleteRecord,
  updateRecord,
  type Rec,
  type RecordInput,
} from "../db/records.server";
import {
  createComment,
  listComments,
  softDeleteComment,
  updateComment,
  type Comment,
  type CommentInput,
} from "../db/comments.server";
import {
  agoLabel,
  dateKey,
  formatDateHeader,
  formatTaken,
  isoToSlash,
  mentionDiffLabel,
  normalizeLocalInput,
  nowLocalInputValue,
  nowLocalSlash,
} from "../lib/time";

const COMMON_UNITS = ["mg", "g", "錠", "mL", "包", "滴", "単位", "回"];

export function meta(_: Route.MetaArgs) {
  return [{ title: "drec" }];
}

export async function loader(_: Route.LoaderArgs) {
  return {
    records: listRecords(),
    comments: listComments(),
    suggestions: getSuggestions(),
  };
}

type ActionResult = { ok: true } | { ok: false; error: string };

function parseInput(fd: FormData): { input?: RecordInput; error?: string } {
  const drugName = String(fd.get("drug_name") ?? "").trim();
  if (!drugName) return { error: "薬剤名を入力してください" };

  const optional = (key: string): string | null => {
    const v = String(fd.get(key) ?? "").trim();
    return v === "" ? null : v;
  };

  // Accept either the picker value or manual 'YYYY/MM/DD HH:mm' text.
  const takenAt = normalizeLocalInput(String(fd.get("taken_at") ?? ""));
  if (!takenAt) return { error: "服用時刻が不正です" };

  const amountRaw = String(fd.get("amount") ?? "").trim();
  const amountNum = amountRaw === "" ? null : Number(amountRaw);
  const amount =
    amountNum !== null && Number.isFinite(amountNum) ? amountNum : null;

  const errRaw = String(fd.get("taken_error_min") ?? "").trim();
  const errNum = errRaw === "" ? null : Number(errRaw);
  const takenError =
    errNum !== null && Number.isFinite(errNum) ? Math.round(Math.abs(errNum)) : null;

  const peakRaw = String(fd.get("peak_min") ?? "").trim();
  const peakNum = peakRaw === "" ? null : Number(peakRaw);
  const peakMin =
    peakNum !== null && Number.isFinite(peakNum) && peakNum > 0 ? peakNum : null;

  return {
    input: {
      drug_name: drugName,
      product_name: optional("product_name"),
      amount,
      unit: optional("unit"),
      taken_at: takenAt,
      taken_error_min: takenError,
      peak_min: peakMin,
      note: optional("note"),
    },
  };
}

function parseCommentInput(fd: FormData): { input?: CommentInput; error?: string } {
  const body = String(fd.get("body") ?? "").trim();
  if (!body) return { error: "コメントを入力してください" };

  const commentedAt = normalizeLocalInput(String(fd.get("taken_at") ?? ""));
  if (!commentedAt) return { error: "コメント時刻が不正です" };

  const mentions = Array.from(
    new Set(
      String(fd.get("mentions") ?? "")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  );

  const errRaw = String(fd.get("taken_error_min") ?? "").trim();
  const errNum = errRaw === "" ? null : Number(errRaw);
  const commentedError =
    errNum !== null && Number.isFinite(errNum) ? Math.round(Math.abs(errNum)) : null;

  return {
    input: {
      body,
      commented_at: commentedAt,
      commented_error_min: commentedError,
      mentions,
    },
  };
}

export async function action({
  request,
}: Route.ActionArgs): Promise<ActionResult> {
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const id = Number(fd.get("id"));
  const hasId = Number.isInteger(id) && id > 0;

  // --- records ---
  if (intent === "delete") {
    if (hasId) softDeleteRecord(id);
    return { ok: true };
  }
  if (intent === "create" || intent === "update") {
    const { input, error } = parseInput(fd);
    if (!input) return { ok: false, error: error ?? "入力エラー" };
    if (intent === "update") {
      if (!hasId) return { ok: false, error: "対象が見つかりません" };
      updateRecord(id, input);
    } else {
      createRecord(input);
    }
    return { ok: true };
  }

  // --- comments ---
  if (intent === "comment_delete") {
    if (hasId) softDeleteComment(id);
    return { ok: true };
  }
  if (intent === "comment_create" || intent === "comment_update") {
    const { input, error } = parseCommentInput(fd);
    if (!input) return { ok: false, error: error ?? "入力エラー" };
    if (intent === "comment_update") {
      if (!hasId) return { ok: false, error: "対象が見つかりません" };
      updateComment(id, input);
    } else {
      createComment(input);
    }
    return { ok: true };
  }

  return { ok: false, error: "不明な操作です" };
}

const inputClass =
  "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base outline-none focus:border-gray-900";

type Mode = "record" | "comment";

export default function Home({ loaderData }: Route.ComponentProps) {
  const { records, comments, suggestions } = loaderData;
  const fetcher = useFetcher<ActionResult>();

  const [mode, setMode] = useState<Mode>("record");
  const [editing, setEditing] = useState<Rec | null>(null);
  const [copying, setCopying] = useState<Rec | null>(null); // もう一度: コピー元
  const [editingComment, setEditingComment] = useState<Comment | null>(null);
  const [takenAt, setTakenAt] = useState("");
  const [manualTime, setManualTime] = useState(false);
  const [manualText, setManualText] = useState("");
  const [takenError, setTakenError] = useState("");
  const [commentMentions, setCommentMentions] = useState<number[]>([]);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [nowMs, setNowMs] = useState<number | null>(null);

  const drugRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const busyRef = useRef(false);

  const recordsById = useMemo(() => {
    const m = new Map<number, Rec>();
    for (const r of records) m.set(r.id, r);
    return m;
  }, [records]);

  // Records and comments merged into one newest-first timeline.
  const timeline = useMemo(() => {
    const items: Array<
      | { kind: "record"; t: string; key: string; rec: Rec }
      | { kind: "comment"; t: string; key: string; comment: Comment }
    > = [
      ...records.map((r) => ({ kind: "record" as const, t: r.taken_at, key: `r${r.id}`, rec: r })),
      ...comments.map((c) => ({ kind: "comment" as const, t: c.commented_at, key: `c${c.id}`, comment: c })),
    ];
    items.sort((a, b) => (a.t < b.t ? 1 : a.t > b.t ? -1 : 0));
    return items;
  }, [records, comments]);

  // Initialise the time field to "now" on the client (avoids SSR/CSR mismatch).
  useEffect(() => {
    setTakenAt(nowLocalInputValue());
    setManualText(nowLocalSlash());
  }, []);

  // Tick the clock every second so the relative-time labels update in real time.
  useEffect(() => {
    setNowMs(Date.now());
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // Focus the first field whenever the form (re)mounts.
  // タッチ端末ではフォーカスでソフトキーボードと datalist 候補が開いて
  // 画面を覆ってしまう（特に保存直後）ので、自動フォーカスしない。
  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (mode === "record") drugRef.current?.focus();
    else bodyRef.current?.focus();
  }, [formKey]);

  // After a successful submit, reset the form back to a fresh "create" state.
  useEffect(() => {
    if (fetcher.state !== "idle") {
      busyRef.current = true;
      return;
    }
    if (!busyRef.current) return;
    busyRef.current = false;
    if (fetcher.data?.ok) resetForm();
  }, [fetcher.state, fetcher.data]);

  function resetForm() {
    setEditing(null);
    setCopying(null);
    setEditingComment(null);
    setCommentMentions([]);
    setTakenError("");
    setTakenAt(nowLocalInputValue());
    setManualText(nowLocalSlash());
    setFormKey((k) => k + 1);
  }

  function setNow() {
    setTakenAt(nowLocalInputValue());
    setManualText(nowLocalSlash());
  }

  function toggleManual(checked: boolean) {
    if (checked) {
      setManualText(isoToSlash(takenAt));
    } else {
      const picker = normalizeLocalInput(manualText)?.slice(0, 16);
      if (picker) setTakenAt(picker);
    }
    setManualTime(checked);
  }

  function switchMode(m: Mode) {
    if (m === mode) return;
    setMode(m);
    resetForm();
  }

  /** もう一度: open a fresh create form pre-filled from the given record. */
  function startCopy(r: Rec) {
    setMode("record");
    setEditing(null);
    setCopying(r);
    setEditingComment(null);
    setCommentMentions([]);
    setTakenAt(nowLocalInputValue());
    setManualText(nowLocalSlash());
    setTakenError("");
    setFormKey((k) => k + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startEdit(r: Rec) {
    setMode("record");
    setEditing(r);
    setCopying(null);
    setEditingComment(null);
    setCommentMentions([]);
    setTakenAt(r.taken_at.slice(0, 16));
    setManualText(isoToSlash(r.taken_at));
    setTakenError(r.taken_error_min != null ? String(r.taken_error_min) : "");
    setFormKey((k) => k + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startEditComment(c: Comment) {
    setMode("comment");
    setEditingComment(c);
    setEditing(null);
    setCommentMentions(c.mentions);
    setTakenAt(c.commented_at.slice(0, 16));
    setManualText(isoToSlash(c.commented_at));
    setTakenError(
      c.commented_error_min != null ? String(c.commented_error_min) : "",
    );
    setFormKey((k) => k + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function commentOnRecord(r: Rec) {
    if (mode === "comment") {
      // accumulate a mention onto the in-progress OR edited comment (keeps body)
      setCommentMentions((cur) => (cur.includes(r.id) ? cur : [...cur, r.id]));
    } else {
      setMode("comment");
      setEditing(null);
      setCopying(null);
      setEditingComment(null);
      setCommentMentions([r.id]);
      setTakenError("");
      setNow();
      setFormKey((k) => k + 1);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(() => bodyRef.current?.focus(), 0);
  }

  function removeMention(rid: number) {
    setCommentMentions((cur) => cur.filter((x) => x !== rid));
  }

  function highlightRecord(rid: number) {
    setHighlightId(rid);
    document.getElementById(`rec-${rid}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    window.setTimeout(
      () => setHighlightId((cur) => (cur === rid ? null : cur)),
      1600,
    );
  }

  const units = Array.from(new Set([...COMMON_UNITS, ...suggestions.units]));
  const submitting = fetcher.state !== "idle";
  const errorMsg = fetcher.data && !fetcher.data.ok ? fetcher.data.error : null;
  const isEditing = editing !== null || editingComment !== null;
  // Field defaults come from the record being edited, or the copy source (もう一度).
  const seed = editing ?? copying;
  const intentValue =
    mode === "record"
      ? editing
        ? "update"
        : "create"
      : editingComment
        ? "comment_update"
        : "comment_create";
  const editId = mode === "record" ? editing?.id : editingComment?.id;
  const submitLabel =
    mode === "record"
      ? editing
        ? "更新する"
        : "記録する"
      : editingComment
        ? "更新する"
        : "コメントする";

  return (
    <main className="mx-auto max-w-xl px-4 pb-24">
      <header className="flex items-baseline justify-between py-4">
        <h1 className="text-2xl font-bold tracking-tight">drec</h1>
        <div className="flex items-baseline gap-3">
          <span className="text-sm text-gray-500">服薬記録</span>
          <Link
            to="/graph"
            className="text-xs text-gray-300 hover:text-gray-600"
          >
            グラフ
          </Link>
          <Link
            to="/report"
            className="text-xs text-gray-300 hover:text-gray-600"
          >
            レポート
          </Link>
          <Link
            to="/logs"
            className="text-xs text-gray-300 hover:text-gray-600"
          >
            ログ
          </Link>
        </div>
      </header>

      <fetcher.Form
        key={formKey}
        method="post"
        className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
      >
        <input type="hidden" name="intent" value={intentValue} />
        {isEditing && editId != null && (
          <input type="hidden" name="id" value={editId} />
        )}

        {!isEditing && (
          <div className="mb-3 inline-flex rounded-lg border border-gray-300 p-0.5">
            {(["record", "comment"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={`rounded-md px-4 py-1 text-sm font-medium ${
                  mode === m ? "bg-gray-900 text-white" : "text-gray-600"
                }`}
              >
                {m === "record" ? "記録" : "コメント"}
              </button>
            ))}
          </div>
        )}

        {mode === "record" ? (
          <>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">薬剤名 *</span>
              <input
                ref={drugRef}
                name="drug_name"
                defaultValue={seed?.drug_name ?? ""}
                list="drugs"
                required
                autoComplete="off"
                placeholder="例: ロキソプロフェン"
                className={inputClass}
              />
            </label>

            <label className="mt-3 block">
              <span className="text-sm font-medium text-gray-700">製品名</span>
              <input
                name="product_name"
                defaultValue={seed?.product_name ?? ""}
                list="products"
                autoComplete="off"
                placeholder="例: ロキソニン"
                className={inputClass}
              />
            </label>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium text-gray-700">量</span>
                <input
                  name="amount"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  defaultValue={seed?.amount ?? ""}
                  placeholder="例: 60"
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">単位</span>
                <input
                  name="unit"
                  defaultValue={seed?.unit ?? ""}
                  list="units"
                  autoComplete="off"
                  placeholder="例: mg"
                  className={inputClass}
                />
              </label>
            </div>

            <TimeField
              label="服用時刻 *"
              manualTime={manualTime}
              manualText={manualText}
              takenAt={takenAt}
              onToggleManual={toggleManual}
              onManualText={setManualText}
              onTakenAt={setTakenAt}
              onNow={setNow}
            />

            <ErrorField value={takenError} onChange={setTakenError} />

            <label className="mt-3 block">
              <span className="text-sm font-medium text-gray-700">ピーク(分)</span>
              <input
                name="peak_min"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                defaultValue={seed?.peak_min ?? ""}
                placeholder="任意（グラフでの最大到達時間。未入力は既定値）"
                className={inputClass}
              />
            </label>

            <label className="mt-3 block">
              <span className="text-sm font-medium text-gray-700">備考</span>
              <input
                name="note"
                defaultValue={editing?.note ?? ""}
                autoComplete="off"
                placeholder="例: 食後 / 頭痛のため"
                className={inputClass}
              />
            </label>
          </>
        ) : (
          <>
            <input
              type="hidden"
              name="mentions"
              value={commentMentions.join(",")}
            />
            <label className="block">
              <span className="text-sm font-medium text-gray-700">コメント *</span>
              <textarea
                ref={bodyRef}
                name="body"
                defaultValue={editingComment?.body ?? ""}
                required
                rows={3}
                placeholder="例: この後めまい。少し様子見。"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base outline-none focus:border-gray-900"
              />
            </label>

            {commentMentions.length > 0 && (
              <div className="mt-3">
                <span className="text-sm font-medium text-gray-700">
                  メンション
                </span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {commentMentions.map((rid) => {
                    const rec = recordsById.get(rid);
                    return (
                      <span
                        key={rid}
                        className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700"
                      >
                        💊 {rec ? rec.drug_name : `記録 #${rid}`}
                        {rec && (
                          <span className="text-gray-400">
                            {formatTaken(rec.taken_at)}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => removeMention(rid)}
                          className="ml-0.5 text-gray-400 hover:text-gray-700"
                          aria-label="メンションを外す"
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            <TimeField
              label="コメント時刻 *"
              manualTime={manualTime}
              manualText={manualText}
              takenAt={takenAt}
              onToggleManual={toggleManual}
              onManualText={setManualText}
              onTakenAt={setTakenAt}
              onNow={setNow}
            />

            <ErrorField value={takenError} onChange={setTakenError} />
          </>
        )}

        {errorMsg && <p className="mt-3 text-sm text-red-600">{errorMsg}</p>}

        <div className="mt-4 flex gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 rounded-lg bg-gray-900 px-4 py-2.5 text-base font-semibold text-white disabled:opacity-50"
          >
            {submitLabel}
          </button>
          {(isEditing || copying) && (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-base font-medium text-gray-700 hover:bg-gray-50"
            >
              キャンセル
            </button>
          )}
        </div>
      </fetcher.Form>

      <datalist id="drugs">
        {suggestions.drugNames.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <datalist id="products">
        {suggestions.productNames.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <datalist id="units">
        {units.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>

      <section className="mt-6">
        {timeline.length === 0 ? (
          <p className="py-12 text-center text-gray-400">まだ記録がありません</p>
        ) : (
          <ul className="space-y-2">
            {timeline.map((item, i) => {
              const showHeader =
                i === 0 || dateKey(item.t) !== dateKey(timeline[i - 1].t);
              return (
                <Fragment key={item.key}>
                  {showHeader && (
                    <li className="px-1 pt-3 text-sm font-semibold text-gray-500">
                      {formatDateHeader(item.t)}
                    </li>
                  )}
                  {item.kind === "record" ? (
                    <RecordRow
                      r={item.rec}
                      editing={editing?.id === item.rec.id}
                      highlighted={highlightId === item.rec.id}
                      nowMs={nowMs}
                      onEdit={startEdit}
                      onCopy={startCopy}
                      onComment={commentOnRecord}
                    />
                  ) : (
                    <CommentRow
                      c={item.comment}
                      editing={editingComment?.id === item.comment.id}
                      recordsById={recordsById}
                      nowMs={nowMs}
                      onEdit={startEditComment}
                      onMentionClick={highlightRecord}
                    />
                  )}
                </Fragment>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

function TimeField({
  label,
  manualTime,
  manualText,
  takenAt,
  onToggleManual,
  onManualText,
  onTakenAt,
  onNow,
}: {
  label: string;
  manualTime: boolean;
  manualText: string;
  takenAt: string;
  onToggleManual: (checked: boolean) => void;
  onManualText: (v: string) => void;
  onTakenAt: (v: string) => void;
  onNow: () => void;
}) {
  return (
    <div className="mt-3">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="checkbox"
          checked={manualTime}
          onChange={(e) => onToggleManual(e.target.checked)}
          className="h-5 w-5 shrink-0 rounded border-gray-300"
        />
        {manualTime ? (
          <input
            name="taken_at"
            type="text"
            required
            value={manualText}
            onChange={(e) => onManualText(e.target.value)}
            placeholder="2026/06/27 14:20"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base outline-none focus:border-gray-900"
          />
        ) : (
          <input
            name="taken_at"
            type="datetime-local"
            step="60"
            required
            value={takenAt}
            onChange={(e) => onTakenAt(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base outline-none focus:border-gray-900"
          />
        )}
        <button
          type="button"
          onClick={onNow}
          className="shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          今
        </button>
      </div>
    </div>
  );
}

function ErrorField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="mt-3">
      <span className="text-sm font-medium text-gray-700">時刻の誤差（±分）</span>
      <div className="mt-1 flex items-center gap-2">
        <input
          name="taken_error_min"
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="任意"
          className="w-20 rounded-lg border border-gray-300 px-3 py-2 text-base outline-none focus:border-gray-900"
        />
        <div className="flex gap-1">
          {[5, 10, 30, 60].map((n) => {
            const active = value === String(n);
            return (
              <button
                key={n}
                type="button"
                onClick={() => onChange(value === String(n) ? "" : String(n))}
                className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                  active
                    ? "border-gray-900 bg-gray-900 text-white"
                    : "border-gray-300 text-gray-700 hover:bg-gray-50"
                }`}
              >
                ±{n}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RecordRow({
  r,
  editing,
  highlighted,
  nowMs,
  onEdit,
  onCopy,
  onComment,
}: {
  r: Rec;
  editing: boolean;
  highlighted: boolean;
  nowMs: number | null;
  onEdit: (r: Rec) => void;
  onCopy: (r: Rec) => void;
  onComment: (r: Rec) => void;
}) {
  const del = useFetcher();
  const [confirming, setConfirming] = useState(false);
  const busy = del.state !== "idle";
  const ago = nowMs != null ? agoLabel(r.taken_at, nowMs) : null;

  function remove() {
    setConfirming(false);
    del.submit({ intent: "delete", id: String(r.id) }, { method: "post" });
  }

  return (
    <li
      id={`rec-${r.id}`}
      className={`scroll-mt-4 rounded-xl border bg-white p-3 shadow-sm transition ${
        editing
          ? "border-gray-900"
          : highlighted
            ? "border-amber-400 ring-2 ring-amber-300"
            : "border-gray-200"
      } ${busy ? "opacity-40" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold">{r.drug_name}</span>
            {r.product_name && (
              <span className="text-sm text-gray-500">{r.product_name}</span>
            )}
            {r.amount != null && (
              <span className="text-sm text-gray-700">
                {r.amount}
                {r.unit ?? ""}
              </span>
            )}
            {r.amount == null && r.unit && (
              <span className="text-sm text-gray-700">{r.unit}</span>
            )}
          </div>
          <div className="mt-0.5 text-sm text-gray-500">
            {formatTaken(r.taken_at)}
            {r.taken_error_min != null && ` ±${r.taken_error_min}m`}
            {ago && <span className="ml-2 text-gray-400">{ago}</span>}
          </div>
          {r.note && <div className="mt-1 text-sm text-gray-700">{r.note}</div>}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onCopy(r)}
              className="rounded-md px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
            >
              もう一度
            </button>
            <button
              type="button"
              onClick={() => onComment(r)}
              className="rounded-md px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
            >
              コメント
            </button>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onEdit(r)}
              className="rounded-md px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
            >
              編集
            </button>
            {!confirming ? (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100"
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
                  className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100"
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

function CommentRow({
  c,
  editing,
  recordsById,
  nowMs,
  onEdit,
  onMentionClick,
}: {
  c: Comment;
  editing: boolean;
  recordsById: Map<number, Rec>;
  nowMs: number | null;
  onEdit: (c: Comment) => void;
  onMentionClick: (id: number) => void;
}) {
  const del = useFetcher();
  const [confirming, setConfirming] = useState(false);
  const busy = del.state !== "idle";
  const ago = nowMs != null ? agoLabel(c.commented_at, nowMs) : null;

  function remove() {
    setConfirming(false);
    del.submit({ intent: "comment_delete", id: String(c.id) }, { method: "post" });
  }

  return (
    <li
      className={`rounded-xl border bg-amber-50 p-3 shadow-sm transition ${
        editing ? "border-gray-900" : "border-amber-200"
      } ${busy ? "opacity-40" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
            <span>💬 コメント</span>
            <span className="text-gray-400">
              {formatTaken(c.commented_at)}
              {c.commented_error_min != null && ` ±${c.commented_error_min}m`}
              {ago && <span className="ml-2">{ago}</span>}
            </span>
          </div>
          <div className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-800">
            {c.body}
          </div>
          {c.mentions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {c.mentions.map((rid) => {
                const rec = recordsById.get(rid);
                return (
                  <button
                    key={rid}
                    type="button"
                    onClick={() => onMentionClick(rid)}
                    className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs text-gray-700 ring-1 ring-amber-200 hover:bg-amber-100"
                  >
                    💊 {rec ? rec.drug_name : `記録 #${rid}`}
                    {rec && (
                      <span className="text-gray-400">
                        {formatTaken(rec.taken_at)}
                      </span>
                    )}
                    {rec && (
                      <span className="font-semibold text-amber-700">
                        {mentionDiffLabel(c.commented_at, rec.taken_at)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => onEdit(c)}
            className="rounded-md px-2 py-1 text-xs font-medium text-gray-700 hover:bg-amber-100"
          >
            編集
          </button>
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-amber-100"
            >
              削除
            </button>
          ) : (
            <div className="flex gap-1">
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
                className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-amber-100"
              >
                やめる
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
