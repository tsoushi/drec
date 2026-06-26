import { Fragment, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

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
  dateKey,
  formatDateHeader,
  formatTaken,
  nowLocalInputValue,
} from "../lib/time";

const COMMON_UNITS = ["mg", "g", "錠", "mL", "包", "滴", "単位", "回"];

export function meta(_: Route.MetaArgs) {
  return [{ title: "drec" }];
}

export async function loader(_: Route.LoaderArgs) {
  return {
    records: listRecords(),
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

  const takenRaw = String(fd.get("taken_at") ?? "").trim();
  if (!takenRaw) return { error: "服用時刻を入力してください" };
  // datetime-local yields 'YYYY-MM-DDTHH:mm'; normalize to include seconds.
  const takenAt = takenRaw.length === 16 ? `${takenRaw}:00` : takenRaw;

  const amountRaw = String(fd.get("amount") ?? "").trim();
  const amountNum = amountRaw === "" ? null : Number(amountRaw);
  const amount =
    amountNum !== null && Number.isFinite(amountNum) ? amountNum : null;

  return {
    input: {
      drug_name: drugName,
      product_name: optional("product_name"),
      amount,
      unit: optional("unit"),
      taken_at: takenAt,
      note: optional("note"),
    },
  };
}

export async function action({
  request,
}: Route.ActionArgs): Promise<ActionResult> {
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");

  if (intent === "delete") {
    const id = Number(fd.get("id"));
    if (Number.isInteger(id) && id > 0) softDeleteRecord(id);
    return { ok: true };
  }

  const { input, error } = parseInput(fd);
  if (!input) return { ok: false, error: error ?? "入力エラー" };

  if (intent === "update") {
    const id = Number(fd.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return { ok: false, error: "対象が見つかりません" };
    }
    updateRecord(id, input);
    return { ok: true };
  }

  createRecord(input);
  return { ok: true };
}

const inputClass =
  "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base outline-none focus:border-gray-900";

export default function Home({ loaderData }: Route.ComponentProps) {
  const { records, suggestions } = loaderData;
  const fetcher = useFetcher<ActionResult>();

  const [editing, setEditing] = useState<Rec | null>(null);
  const [takenAt, setTakenAt] = useState("");
  const [formKey, setFormKey] = useState(0);

  const drugRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  // Initialise the time field to "now" on the client (avoids SSR/CSR mismatch).
  useEffect(() => {
    setTakenAt(nowLocalInputValue());
  }, []);

  // Focus the drug-name field whenever the form (re)mounts.
  useEffect(() => {
    drugRef.current?.focus();
  }, [formKey]);

  // After a successful submit, reset the form back to a fresh "create" state.
  useEffect(() => {
    if (fetcher.state !== "idle") {
      busyRef.current = true;
      return;
    }
    if (!busyRef.current) return;
    busyRef.current = false;
    if (fetcher.data?.ok) {
      setEditing(null);
      setTakenAt(nowLocalInputValue());
      setFormKey((k) => k + 1);
    }
  }, [fetcher.state, fetcher.data]);

  function startEdit(r: Rec) {
    setEditing(r);
    setTakenAt(r.taken_at.slice(0, 16));
    setFormKey((k) => k + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditing(null);
    setTakenAt(nowLocalInputValue());
    setFormKey((k) => k + 1);
  }

  const units = Array.from(new Set([...COMMON_UNITS, ...suggestions.units]));
  const submitting = fetcher.state !== "idle";
  const errorMsg = fetcher.data && !fetcher.data.ok ? fetcher.data.error : null;

  return (
    <main className="mx-auto max-w-xl px-4 pb-24">
      <header className="flex items-baseline justify-between py-4">
        <h1 className="text-2xl font-bold tracking-tight">drec</h1>
        <span className="text-sm text-gray-500">服薬記録</span>
      </header>

      <fetcher.Form
        key={formKey}
        method="post"
        className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
      >
        <input type="hidden" name="intent" value={editing ? "update" : "create"} />
        {editing && <input type="hidden" name="id" value={editing.id} />}

        <label className="block">
          <span className="text-sm font-medium text-gray-700">薬剤名 *</span>
          <input
            ref={drugRef}
            name="drug_name"
            defaultValue={editing?.drug_name ?? ""}
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
            defaultValue={editing?.product_name ?? ""}
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
              defaultValue={editing?.amount ?? ""}
              placeholder="例: 60"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">単位</span>
            <input
              name="unit"
              defaultValue={editing?.unit ?? ""}
              list="units"
              autoComplete="off"
              placeholder="例: mg"
              className={inputClass}
            />
          </label>
        </div>

        <label className="mt-3 block">
          <span className="text-sm font-medium text-gray-700">服用時刻 *</span>
          <div className="mt-1 flex gap-2">
            <input
              name="taken_at"
              type="datetime-local"
              step="60"
              required
              value={takenAt}
              onChange={(e) => setTakenAt(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base outline-none focus:border-gray-900"
            />
            <button
              type="button"
              onClick={() => setTakenAt(nowLocalInputValue())}
              className="shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              今
            </button>
          </div>
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

        {errorMsg && <p className="mt-3 text-sm text-red-600">{errorMsg}</p>}

        <div className="mt-4 flex gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 rounded-lg bg-gray-900 px-4 py-2.5 text-base font-semibold text-white disabled:opacity-50"
          >
            {editing ? "更新する" : "記録する"}
          </button>
          {editing && (
            <button
              type="button"
              onClick={cancelEdit}
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
        {records.length === 0 ? (
          <p className="py-12 text-center text-gray-400">まだ記録がありません</p>
        ) : (
          <ul className="space-y-2">
            {records.map((r, i) => {
              const showHeader =
                i === 0 ||
                dateKey(r.taken_at) !== dateKey(records[i - 1].taken_at);
              return (
                <Fragment key={r.id}>
                  {showHeader && (
                    <li className="px-1 pt-3 text-sm font-semibold text-gray-500">
                      {formatDateHeader(r.taken_at)}
                    </li>
                  )}
                  <RecordRow
                    r={r}
                    editing={editing?.id === r.id}
                    onEdit={startEdit}
                  />
                </Fragment>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

function RecordRow({
  r,
  editing,
  onEdit,
}: {
  r: Rec;
  editing: boolean;
  onEdit: (r: Rec) => void;
}) {
  const del = useFetcher();
  const again = useFetcher();
  const [confirming, setConfirming] = useState(false);
  const busy = del.state !== "idle" || again.state !== "idle";

  function recordAgain() {
    again.submit(
      {
        intent: "create",
        drug_name: r.drug_name,
        product_name: r.product_name ?? "",
        amount: r.amount != null ? String(r.amount) : "",
        unit: r.unit ?? "",
        taken_at: nowLocalInputValue(),
        note: "",
      },
      { method: "post" },
    );
  }

  function remove() {
    setConfirming(false);
    del.submit({ intent: "delete", id: String(r.id) }, { method: "post" });
  }

  return (
    <li
      className={`rounded-xl border bg-white p-3 shadow-sm transition ${
        editing ? "border-gray-900" : "border-gray-200"
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
          </div>
          {r.note && <div className="mt-1 text-sm text-gray-700">{r.note}</div>}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <button
            type="button"
            onClick={recordAgain}
            disabled={busy}
            className="rounded-md px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
          >
            もう一度
          </button>
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
