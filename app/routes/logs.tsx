import { Link } from "react-router";

import type { Route } from "./+types/logs";
import { readChangeLog } from "../db/log.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "drec — 変更ログ" }];
}

export async function loader(_: Route.LoaderArgs) {
  return { entries: readChangeLog() };
}

const OP_LABEL: Record<string, string> = {
  create: "作成",
  update: "更新",
  delete: "削除",
};
const ENTITY_LABEL: Record<string, string> = {
  record: "記録",
  comment: "コメント",
  mental: "メンタル",
};

function opClass(op: string): string {
  if (op === "create") return "bg-green-100 text-green-700";
  if (op === "update") return "bg-blue-100 text-blue-700";
  if (op === "delete") return "bg-red-100 text-red-700";
  return "bg-gray-100 text-gray-700";
}

export default function Logs({ loaderData }: Route.ComponentProps) {
  const { entries } = loaderData;
  return (
    <main className="mx-auto max-w-2xl px-4 pb-24">
      <header className="flex items-baseline justify-between py-4">
        <h1 className="text-xl font-bold tracking-tight">変更ログ</h1>
        <Link to="/" className="text-sm text-gray-500 hover:text-gray-900">
          ← 戻る
        </Link>
      </header>

      {entries.length === 0 ? (
        <p className="py-12 text-center text-gray-400">ログはまだありません</p>
      ) : (
        <ul className="space-y-1">
          {entries.map((e, i) => (
            <li
              key={i}
              className="rounded-lg border border-gray-200 bg-white p-2 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="tabular-nums text-gray-500">
                  {e.at.replace("T", " ")}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${opClass(e.op)}`}
                >
                  {OP_LABEL[e.op] ?? e.op}
                </span>
                <span className="text-gray-700">
                  {ENTITY_LABEL[e.entity] ?? e.entity} #{e.id}
                </span>
              </div>
              {e.data != null && (
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-xs text-gray-400">
                  {JSON.stringify(e.data)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
