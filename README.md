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

薬剤名（必須） / 製品名 / 量（数値＋単位） / 服用時刻 / 備考 / 作成時刻（変更不可） / 更新時刻。

### 削除について

削除は**論理削除**です。アプリの一覧からは消えますが、行は DB に残り `deleted_at` に削除時刻が
入ります。削除済みの確認・復元は DB を直接操作してください。

```sql
-- 削除済みを見る
SELECT * FROM records WHERE deleted_at IS NOT NULL;

-- 復元する
UPDATE records SET deleted_at = NULL WHERE id = ?;
```
