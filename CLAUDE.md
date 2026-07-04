# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

drec — 個人用の服薬記録 Web アプリ（単一ユーザー・認証なし）。最優先は「さっと記録できること」と画面のシンプルさ。UI は日本語。

スタック: React Router v7 (framework mode) / React 19 / TypeScript / Vite / Tailwind CSS v4 / better-sqlite3（素の SQL、ORM なし）。

**react-router 系は意図的に `^7` に固定している（v8 が存在するがアップグレードしない）。** dev 起動時の「Future Flag Warning (v8...)」は既知のノイズで、対応不要。

## コマンド

```sh
npm run dev        # 開発サーバ → http://localhost:5173
npm run typecheck  # react-router typegen && tsc（変更後は必ず実行）
npm run build      # 本番ビルド
npm run start      # 本番サーバ → http://localhost:3000
```

テストスイートはない。検証は typecheck ＋ 実機（dev サーバをブラウザで操作）＋ DB 直接確認（node + better-sqlite3 の使い捨てスクリプト）で行う。

- DB: `data/drec.db`（WAL、`DREC_DB` で変更可）。**`data/` は実データ。消さない。** 検証で入れたテスト行は必ず後始末する。
- 変更ログ: `data/changes.log`（JSON Lines、`DREC_LOG` で変更可）。

## アーキテクチャ

メイン画面は `app/routes/home.tsx`（loader / action / UI がすべて入っている）。補助画面は読み取り専用で `/logs`（変更ログ閲覧）、`/report`（月別の薬剤別 回数・合計量レポート。`report.server.ts`）、`/graph`（血中濃度の簡易グラフ。専用の `graph.server.ts` を持ち、モデル計算・SVG 描画・ドラッグ操作はクライアント側。パラメータは薬剤ごとに `graph_settings` テーブルへ action 経由でデバウンス保存 — 表示設定なので例外的に `logChange` を通さない。`shouldRevalidate` で設定保存の再検証を抑止。表示薬剤は `?drug=` クエリパラメータに保持。曲線上に服用（オレンジ）とコメント（青）の点を描き、押下でポップオーバー詳細 — コメントを効果予測に照らして分析する用途）。

- **action は formData の `intent` で分岐**: `create` / `update` / `delete`（記録）、`comment_create` / `comment_update` / `comment_delete`（コメント）。成功で `{ ok: true }` → useFetcher の revalidation で一覧更新。
- **DB 層** (`app/db/`): `*.server.ts` 命名必須（better-sqlite3 をクライアントバンドルに混入させない。`vite.config.ts` の `ssr.external` にも指定済み）。
  - `db.server.ts` — 接続シングルトン（HMR 対策で `globalThis.__drecDb` にキャッシュ）＋ **`PRAGMA user_version` ベースのマイグレーション**。スキーマ変更は `MIGRATIONS` 配列に関数を 1 つ追記するだけ（現在 v7）。
  - `records.server.ts` / `comments.server.ts` — prepared statement による型付き CRUD。コメントは `comment_mentions`（多対多）で 0..N 件の記録を参照。
  - `log.server.ts` — **記録・コメントの DB 変更（create/update/delete）は `logChange` を必ず通す**。コンソール＋ `changes.log` に追記され、`/logs`（`app/routes/logs.tsx`）で閲覧できる。新しい書き込み経路を作るときも必須（例外: `graph_settings` などの表示設定はログ対象外）。
- **タイムライン**: 記録（`taken_at`）とコメント（`commented_at`）をクライアントでマージして新しい順に表示。

## 重要な規約

- **時刻はすべてローカル naive ISO `YYYY-MM-DDTHH:mm:ss`**（辞書順＝時系列順）。生成・整形・差分計算は必ず `app/lib/time.ts` のヘルパを使う。`Date.toISOString()` 等の UTC 系 API は使わない。
- **論理削除**: `deleted_at` に値を入れるだけ（記録・コメント共通）。復元 UI は意図的に作らない（DB 直接操作で行う設計）。
- **`created_at` は不変**。update 文で絶対に触らない。
- **「今」の初期値はクライアント側 `useEffect` でセット**（SSR ハイドレーション不整合の回避）。フォームのリセットは `formKey` の increment（再マウント）で行う。
- 経過時間表示（`-3d2h30m` 等）は 1 秒 tick の `nowMs` state で更新。誤差は `±Nm` 表記。

## ハマりどころ

- ルートへのドキュメント POST は **`/?index`** に送らないと index ルートの action に届かない（`root` に action がないというエラーになる）。curl での動作確認時に注意。ブラウザの `fetcher.Form` は自動で付く。
- **シェル経由で日本語をアプリに渡さない**（Windows の CP932 で化ける）。日本語を含むテストは Node スクリプト＋ `URLSearchParams` / better-sqlite3 直接で行う。コミットメッセージも UTF-8 ファイルに書いて `git commit -F <file>` を使う。
- dev サーバ初回起動直後、better-sqlite3 の依存最適化で Vite がリロードし action 登録が壊れることがある → サーバを再起動すれば直る。
