---
name: verify
description: drec の変更を実機検証する手順（scratch DB の dev サーバを Playwright で駆動）
---

# drec の実機検証レシピ

1. **実データを触らない**: `DREC_DB` / `DREC_LOG` を一時パスに向けて
   `npm run dev`（→ http://localhost:5173）。バックグラウンド起動時は
   出力をファイルにリダイレクトする — `| head` 等にパイプすると
   パイプが閉じた時点で SIGPIPE でサーバごと死ぬ。
2. 初回起動直後は better-sqlite3 の依存最適化で Vite がリロードし
   action 登録が壊れることがある（CLAUDE.md 参照）。一度 `/` を curl
   して数秒待ってから（または再起動してから）操作を始める。
   起動時のマイグレーションで scratch DB にスキーマが作られる。
3. **シードは node + better-sqlite3 直接**（シェル経由で日本語を渡さない）。
   リポジトリの `node_modules/better-sqlite3` を `createRequire` で読む。
4. ブラウザ駆動は `playwright-core` +
   `chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })`
   （リモート実行環境の場合。ローカルなら通常の Playwright でよい）。
5. 書き込み検証は POST 先が **`/?index`**（index ルートの action）。
   成功レスポンスは `{ ok: true }`。`logChange` 経路の確認は
   `DREC_LOG` のファイルを見る。
6. useFetcher の完了検知を state 遷移の監視でやると、ローカルの速い
   送信では submitting/loading のレンダーがコミットされず取りこぼす。
   フラグは form の onSubmit で立てる（notes.tsx の実装参照）。
