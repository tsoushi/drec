# drec

飲んだ薬をその場でサッと記録する、個人用の服薬記録 Web アプリ。

## スタック

- React Router v7 (framework mode) + React 19 + TypeScript
- Vite / Tailwind CSS v4
- SQLite（better-sqlite3、素の SQL）

## セットアップ

```sh
npm install
```

## 開発

```sh
npm run dev
```

→ http://localhost:5173 （ポートを変える場合は `npm run dev -- --port 3001`）

## 本番

```sh
npm run build
npm run start
```

→ http://localhost:3000

## 型チェック

```sh
npm run typecheck
```

## データ

- DB ファイル: `data/drec.db`（WAL モード。`data/` は起動時に自動生成）。
- 保存先を変えたい場合は環境変数 `DREC_DB` を指定（例: `DREC_DB=C:\path\to\drec.db`）。

### 記録項目

薬剤名（必須） / 製品名 / 量（数値＋単位） / 服用時刻 / 時刻の誤差（±分・任意） / 備考 / 作成時刻（変更不可） / 更新時刻。

### コメント

服薬記録とは別に、コメントを同じ時系列に残せます。コメントは0件以上の服薬記録を「メンション」（参照）でき、記録カードの「コメント」ボタンから対象の記録を参照した状態で書けます（複数参照も可）。コメントのメンションチップをタップすると対象の記録までスクロール＆ハイライト。コメントも時刻（手入力切替可）・時刻の誤差（±分）・編集・論理削除に対応。テーブルは `comments` と多対多の `comment_mentions`。

### 経過時間の表示

記録・コメントは、直近 72 時間以内であれば日時の右に経過時間（例: `2h30m前`）を表示します。コメントのメンションには、対象記録との時間差（例: `+2h30m`）を常に表示します。

### 削除について

削除は**論理削除**です。アプリの一覧からは消えますが、行は DB に残り `deleted_at` に削除時刻が
入ります。削除済みの確認・復元は DB を直接操作してください。

```sql
-- 削除済みを見る
SELECT * FROM records WHERE deleted_at IS NOT NULL;

-- 復元する
UPDATE records SET deleted_at = NULL WHERE id = ?;
```

### 変更ログ

すべての DB 変更（作成・更新・削除）は、サーバのコンソールと `data/changes.log`（JSON Lines）に追記されます。出力先は環境変数 `DREC_LOG` で変更できます。画面右上の「ログ」リンク（`/logs`）から閲覧できます。
