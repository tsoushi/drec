import { Link } from "react-router";

import type { Route } from "./+types/export";
import { getExportCounts } from "../db/export.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "drec — エクスポート" }];
}

export async function loader(_: Route.LoaderArgs) {
  return getExportCounts();
}

const items = [
  {
    target: "records.csv",
    title: "記録 CSV",
    desc: "服薬記録の全行（列: 薬剤名・量・時刻など）",
  },
  {
    target: "comments.csv",
    title: "コメント CSV",
    desc: "コメント全行（メンション先の記録IDは ; 区切り）",
  },
  {
    target: "all.json",
    title: "全データ JSON",
    desc: "記録＋コメントをまとめた完全バックアップ",
  },
] as const;

export default function Export({ loaderData }: Route.ComponentProps) {
  const c = loaderData;
  return (
    <main className="mx-auto max-w-xl px-4 pb-24">
      <header className="flex items-baseline justify-between py-4">
        <h1 className="text-xl font-bold tracking-tight">エクスポート</h1>
        <Link to="/" className="text-sm text-gray-500 hover:text-gray-900">
          ← 戻る
        </Link>
      </header>

      <p className="text-sm text-gray-500">
        現在のデータ: 記録 {c.records}件・コメント {c.comments}件
        {c.recordsDeleted + c.commentsDeleted > 0 &&
          `（削除済み 記録${c.recordsDeleted}・コメント${c.commentsDeleted} も含めて出力）`}
      </p>

      <div className="mt-4 space-y-3">
        {items.map((it) => (
          <section
            key={it.target}
            className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
          >
            <div className="min-w-0">
              <h2 className="font-semibold">{it.title}</h2>
              <p className="mt-0.5 text-sm text-gray-500">{it.desc}</p>
            </div>
            <a
              href={`/export/dl?target=${it.target}`}
              download
              className="shrink-0 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white"
            >
              ダウンロード
            </a>
          </section>
        ))}
      </div>

      <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-gray-400">
        <li>CSV は UTF-8（BOM 付き）。Excel でそのまま開けます。</li>
        <li>
          削除済み（deleted_at あり）の行も含む完全な写しです。復元・移行の
          元データとして使えます。
        </li>
      </ul>
    </main>
  );
}
