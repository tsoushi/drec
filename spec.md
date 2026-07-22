# drec 初期設計書

個人用の服薬記録 Web アプリ drec の初期設計をまとめたドキュメント。実装の全体像・データモデル・設計上の決めごとを記す。日常の運用手順は `README.md`、開発時の注意は `CLAUDE.md` を参照。

## 1. 目的と設計方針

- 飲んだ薬をその場で**さっと記録できる**ことを最優先にする。
- 単一ユーザー・認証なし。自分のローカル/自宅サーバで動かす前提。
- 画面はシンプルに保ち、UI は日本語。
- 記録本体に加えて、体調メモ（コメント）を同じ時系列に残し、後から血中濃度の推定グラフと照らして振り返れるようにする。

## 2. 技術スタック

| 層 | 採用技術 |
| --- | --- |
| フレームワーク | React Router v7（framework mode）+ React 19 + TypeScript |
| ビルド | Vite |
| スタイル | Tailwind CSS v4 |
| DB | SQLite（better-sqlite3、素の SQL。ORM は使わない） |

react-router 系は意図的に `^7` に固定する（v8 にはアップグレードしない）。

## 3. 画面構成

ルート定義は `app/routes.ts`。

| パス | ファイル | 役割 |
| --- | --- | --- |
| `/` | `app/routes/home.tsx` | メイン画面。記録・コメントの入力フォームとタイムライン。loader / action / UI を 1 ファイルに持つ |
| `/logs` | `app/routes/logs.tsx` | 変更ログの閲覧（読み取り専用） |
| `/report` | `app/routes/report.tsx` | 月別の薬剤別 回数・合計量レポート（読み取り専用） |
| `/graph` | `app/routes/graph.tsx` | 血中濃度の簡易グラフ。表示設定の保存のみ書き込みあり |

### メイン画面（`/`）

- フォームは「記録」「コメント」の 2 モードをトグルで切替。
- 記録の項目: 薬剤名（必須）/ 製品名 / 量＋単位 / 服用時刻（必須。ピッカーと手入力テキストを切替可）/ 時刻の誤差（±分）/ ピーク(分)（グラフ用・任意）/ 備考。
- 薬剤名・製品名・単位は過去の入力から `datalist` で補完候補を出す。
- タイムラインは記録（`taken_at`）とコメント（`commented_at`）をクライアントでマージし新しい順に表示。日付見出しを差し込む。
- 各記録カードに「もう一度」（内容をコピーして新規作成）/「コメント」（その記録をメンションしたコメント作成）/「編集」/「削除」（二段階確認）。
- コメントは 0..N 件の記録をメンションでき、チップのタップで対象記録へスクロール＆ハイライト。
- 経過時間（`-3d2h30m` 等）は 1 秒 tick で更新。誤差は `±Nm` 表記。

### 血中濃度グラフ（`/graph`）

- モデル: 単位服用量で濃度 +1。服用からピーク（tmax）まで直線上昇、以降は半減期で指数減衰。複数服用は足し合わせる。
- ピークまでの時間は記録の `peak_min` を優先し、未設定なら薬剤ごとの既定値を使う。
- 複数薬剤を同時選択（`?drug=` を複数保持）し、各薬剤を自身の設定で別色の線として重ね描き（合算しない）。パラメータ編集は「編集対象」で選んだ 1 薬剤のみ。
- 曲線上に服用（薬剤色）とコメント（青）の点を描き、押下でポップオーバー詳細。コメントを効果予測に照らして分析する用途。
- パラメータ（単位服用量・tmax・半減期・表示範囲）は薬剤ごとに `graph_settings` へデバウンス保存。表示設定なので変更ログの対象外とし、`shouldRevalidate` で保存時の再検証を抑止する。
- モデル計算・SVG 描画・ドラッグ操作はクライアント側。サーバ側は専用の `graph.server.ts` が担う。

## 4. データモデル

DB は `data/drec.db`（WAL モード、`DREC_DB` で変更可）。スキーマは `app/db/db.server.ts` の `MIGRATIONS` 配列＋ `PRAGMA user_version` で管理し、変更は配列に関数を 1 つ追記するだけで反映される。

### records — 服薬記録

| カラム | 型 | 説明 |
| --- | --- | --- |
| `id` | INTEGER PK | 自動採番 |
| `drug_name` | TEXT NOT NULL | 薬剤名（一般名） |
| `product_name` | TEXT | 製品名 |
| `amount` | REAL | 量 |
| `unit` | TEXT | 単位（mg, 錠 など） |
| `taken_at` | TEXT NOT NULL | 服用時刻（ローカル naive ISO） |
| `taken_error_min` | INTEGER | 時刻の誤差（±分） |
| `peak_min` | REAL | ピークまでの分（グラフ用。NULL なら薬剤既定値） |
| `note` | TEXT | 備考 |
| `created_at` / `updated_at` | TEXT NOT NULL | 作成・更新時刻。`created_at` は不変 |
| `deleted_at` | TEXT | 論理削除時刻（NULL = 有効） |

### comments — コメント（タイムライン上の体調メモ）

`body`（本文・必須）、`commented_at`（時刻）、`commented_error_min`（±分）、`created_at` / `updated_at` / `deleted_at`（records と同じ規約）。

### mentals — メンタル記録

`level`（INTEGER、-10〜10 の自己申告値）、`recorded_at`（時刻）、`recorded_error_min`（±分）、`created_at` / `updated_at` / `deleted_at`（records と同じ規約）。記録・コメントと同じタイムラインに並び、コメントからメンションでき、血中濃度グラフに絶対目盛りで重ねられる。範囲定数は `app/lib/mental.ts`。

### comment_mentions / comment_comment_mentions / comment_mental_mentions — コメントの参照（多対多）

コメントは 0..N 件を **メンション** でき、対象は記録・コメント・メンタルの3種。それぞれ `(comment_id, record_id)` / `(comment_id, target_comment_id)` / `(comment_id, mental_id)` の複合 PK。クライアントのタグ表現は `r<id>` / `c<id>` / `m<id>`、サーバ型は `MentionRef = {kind, id}`。

### graph_settings — グラフの薬剤別表示設定

`drug_name` PK、`unit`（単位服用量）、`tmax_min`、`half_min`、`window_h`、`updated_at`。表示設定であり記録データではない。

## 5. アーキテクチャ

### サーバ層（`app/db/*.server.ts`）

- `*.server.ts` 命名を必須とし、better-sqlite3 をクライアントバンドルへ混入させない（`vite.config.ts` の `ssr.external` にも指定）。
- `db.server.ts` — 接続シングルトン。dev の HMR で接続が増えないよう `globalThis.__drecDb` にキャッシュ。起動時にマイグレーションを適用。
- `records.server.ts` / `comments.server.ts` / `mentals.server.ts` — prepared statement による型付き CRUD。一覧は `deleted_at IS NULL` のみ返す。コメントのメンションは全読み取り経路で `buildMentions` により統一デコード。
- `report.server.ts` / `graph.server.ts` — 各補助画面用の読み取り（graph は設定の upsert のみ書き込み）。
- `log.server.ts` — 変更ログ。**記録・コメント・メンタルの create / update / delete は必ず `logChange` を通す**。コンソールと `data/changes.log`（JSON Lines、`DREC_LOG` で変更可）に追記し、`/logs` で閲覧する。新しい書き込み経路を作るときも必須（例外: `graph_settings` などの表示設定）。

### action の設計

メイン画面の action は formData の `intent` で分岐する:

- 記録: `create` / `update` / `delete`
- コメント: `comment_create` / `comment_update` / `comment_delete`

成功時は `{ ok: true }` を返し、`useFetcher` の revalidation で一覧が更新される。失敗時は `{ ok: false, error }` を返しフォーム下に表示する。

### フォームの状態管理

- 「今」の初期値はクライアント側 `useEffect` でセットする（SSR ハイドレーション不整合の回避）。
- フォームのリセットは `formKey` の increment による再マウントで行う。
- 再マウント時の自動フォーカスはデスクトップのみ。タッチ端末（`pointer: coarse`）ではソフトキーボードと候補ドロップダウンが画面を覆うため行わない。

## 6. 重要な規約

- **時刻はすべてローカル naive ISO `YYYY-MM-DDTHH:mm:ss`**（辞書順＝時系列順）。生成・整形・差分計算は `app/lib/time.ts` のヘルパに集約し、`Date.toISOString()` 等の UTC 系 API は使わない。
- **論理削除**: `deleted_at` に値を入れるだけ。復元 UI は意図的に作らず、DB 直接操作で行う。
- **`created_at` は不変**。update 文で絶対に触らない。
- **記録・コメントの DB 変更は必ず `logChange` を通す**（表示設定は例外）。

## 7. 検証方針

テストスイートは持たない。検証は次の組み合わせで行う:

1. `npm run typecheck`（変更後は必ず実行）
2. 実機確認（dev サーバをブラウザで操作）
3. DB 直接確認(node + better-sqlite3 の使い捨てスクリプト)。検証で入れたテスト行は必ず後始末する。`data/` は実データなので消さない。
