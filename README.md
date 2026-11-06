# BRO PASS MARBLE GRAND PRIX

## セットアップ
1. Supabaseでプロジェクト作成 → SQL Editorで下記を実行
2. `config.js` に Project URL と anon key を記入
3. GitHubにアップロード → Netlifyで公開（ビルド設定なし）

```sql
create table players(id serial primary key,name text unique not null,online bool default false,last_seen timestamptz default now(),banned bool default false,is_test bool default false);
create table race(id int primary key,status text default 'waiting',seed bigint,start_at bigint,paused_at bigint,paused_total float default 0,mode text default 'designated',designated text default 'uniuni20131004',winner text,notice text);
create table chat(id serial primary key,name text,msg text,created_at timestamptz default now());
insert into race(id) values(1);
insert into players(name) values ('hamabenokai'),('ClumsyShuhei'),('EnjoyedBshsh'),('godhand1234'),('mandicendiiiii'),('rickey3326'),('abc315315'),('asaking 1218'),('bottikunnn'),('Marisakami'),('skYAJU114514'),('Chaser44'),('kaninekoheiryo'),('WearyTwiIight78'),('FullNiceSandwich'),('192837465h'),('dicesoe'),('studiousEpiccopper'),('AdroitSturdyCelery'),('Niwatori0503'),('JocularHappyClover'),('kurumi0203'),('osaruboy0228'),('blits3939'),('StellarNeatlyTom'),('Kingsrennosuke0205'),('uniuni20131004'),('02112015'),('#2CQOVLGLOJ'),('ComplexGlasses71');
alter table players enable row level security;alter table race enable row level security;alter table chat enable row level security;
create policy a on players for all using(true) with check(true);
create policy a on race for all using(true) with check(true);
create policy a on chat for all using(true) with check(true);
alter publication supabase_realtime add table players,race,chat;
```

## 仕組み
- レースはサーバー(race表)の `seed` と `start_at` から決定論的に計算され、全員同じ展開になります。
- 管理者ボタン→race表更新→Realtimeで全員に反映。
- 指定当選者モードでは `designated` のプレイヤーが1位になり、画面上部にルールが常時表示されます。

## 既知の制限（今回の簡易版）
- 管理者権限チェックはクライアント側のみ（RLSが全許可）。本格運用ではSupabase Edge Functionで検証してください。
- 物理演算(Matter.js)・衝突演出・分岐・花火/紙吹雪・BGM/効果音は未実装。ビー玉は螺旋コース上を決定論的に移動します。
- 端末時計のズレで開始が最大数秒ずれる場合があります。
