# BRO PASS MARBLE RACE

ビー玉レース型のブロパス抽選イベントサイトです。GitHub + Netlify + Supabaseで公開できます。

## 含まれる機能
- 登録済み30アカウントの正確な表記
- 自分のアカウントを選んで待機
- Three.jsによる3Dマーブルアリーナ
- 約3分の自動レース、順位表示、結果画面
- Supabase RealtimeのオンラインPresence・チャット・レース状態Broadcast
- Netlify Functionによる管理者ログインとレース状態更新
- テストプレイヤー追加、画面上でのBAN/解除
- 公平モード / 明示的な演出モード

## 重要：公開前に必ず設定すること

このプロジェクトはフロントエンドだけでは複数端末のオンライン同期を成立させられません。Supabaseプロジェクトを用意してください。

### 1. Supabase
1. https://supabase.com/ でプロジェクトを作成
2. SQL Editorを開き、`supabase/schema.sql` の内容を実行
3. Project Settings → APIからProject URLとanon/public keyを取得
4. `runtime-config.js` を編集し、URLとanon keyを設定
5. **service_role keyは絶対にruntime-config.jsやGitHubへ置かない**

### 2. Netlify環境変数
Netlifyの Site configuration → Environment variables に以下を登録します。

- `ADMIN_PASSWORD` : 管理者用パスワード
- `SUPABASE_URL` : Supabase Project URL
- `SUPABASE_SERVICE_ROLE_KEY` : Supabase service_role key（サーバー専用）
- `ALLOWED_ORIGIN` : 公開サイトのURL（例 `https://your-site.netlify.app`）

管理者パスワードはHTMLやJavaScriptに保存しません。公開前に推測されにくい専用パスワードへ変更してください。チャットや参加登録は公開サイトの誰でも利用できるため、個人情報を書き込まないでください。

### 3. GitHubへアップロード
このフォルダ内のファイルをリポジトリのルートへアップロードします。
`runtime-config.js` は公開用anon keyだけを含みます。service_role keyや管理者パスワードは含めないでください。

### 4. Netlifyへデプロイ
1. Netlifyで「Add new site」→「Import an existing project」
2. GitHubリポジトリを選択
3. Build commandは空欄、Publish directoryは `.`（ドット）
4. Deploy site
5. 環境変数を登録後、再デプロイ

ローカルで試す場合：
```bash
npm install
npx netlify dev
```

## 現在の実装上の注意
- 3Dは物理エンジンによる厳密な剛体シミュレーションではなく、滑らかなレース演出を行う決定論的なアニメーションです。全端末で同じシードと開始時刻を使ってレースを同期します。
- RealtimeのチャットとPresenceはSupabase設定後に有効になります。
- BANとテストプレイヤー追加は現在のブラウザ内の管理画面状態に反映されます。複数端末に永続同期するには、参加者テーブルと管理用Netlify Functionを追加する必要があります。
- レースの開始・リセットはNetlify Function経由でrace_stateに保存します。画面間のレース開始通知はRealtime Broadcastを使います。
- 現在のデモは参加者の本人確認を行いません。アカウント名を選ぶ方式なので、公開イベントで不正参加を防ぐには認証または招待コードを追加してください。
- 演出モードは公平抽選ではありません。必ず画面に演出モードと表示してください。
