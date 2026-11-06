# BRO PASS MARBLE RACE
## 構成
`index.html / style.css / script.js`（画面）、`netlify/functions/api.js`（管理者認証・重要処理）、`supabase/schema.sql`（DB）
## 手順
1. **Supabase**：New project → SQL Editor に `supabase/schema.sql` を貼って Run。Settings > API で `Project URL` / `anon key` / `service_role key` を控える。
2. **GitHub**：このフォルダ一式をリポジトリにアップロード（`.env`は入れない）。
3. **Netlify**：Add new site > Import from GitHub。Build command は空、Publish directory は `.`。
4. **環境変数**（Site settings > Environment variables）：
   - `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_KEY`（service_roleは絶対に公開しない）
   - `ADMIN_PASSWORD`（管理者パスワード。コードには書かない）
   - `TOKEN_SECRET`（長いランダム文字列）
   設定後に Deploy を再実行。
5. 管理者は `https://あなたのサイト/#admin` を開いてログイン。
## 使い方
参加者は名前を選んで待機 → 管理者が「開始」。演出モードは画面上部に常時「演出モード」と表示されます（全員に見えます）。
## 仕組みと制限
- 開始時にサーバーがシード・順位・ゴール時刻を決定し、全端末が同じ開始時刻から同じ映像を再生します（端末間で展開がずれません）。通常モードは暗号論的乱数による公平な抽選です。
- ビー玉の動きは物理エンジンではなく、シード固定のコース上アニメーションです（全端末で同一の展開にするため）。ジャンプ台・分岐・回転障害物は未実装です。
