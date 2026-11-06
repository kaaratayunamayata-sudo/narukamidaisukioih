-- Supabase の SQL Editor に丸ごと貼り付けて Run
create table if not exists players(id uuid primary key default gen_random_uuid(),name text unique not null,color text not null,is_test boolean default false,banned boolean default false,joined boolean default false,client_id text,created_at timestamptz default now());
create table if not exists chat(id bigserial primary key,name text not null,body text not null,created_at timestamptz default now());
create table if not exists race(id int primary key,status text default 'idle',mode text default 'normal',target text default 'uniuni20131004',seed int default 1,started_at timestamptz,paused_at timestamptz,pause_total_ms bigint default 0,"order" jsonb default '[]',winner text);
create table if not exists history(id bigserial primary key,winner text,mode text,"order" jsonb,created_at timestamptz default now());
insert into race(id) values(1) on conflict do nothing;
insert into players(name,color)
select n,'hsl('||((i-1)*12)||',85%,55%)' from unnest(array['hamabenokai','ClumsyShuhei','EnjoyedBshsh','godhand1234','mandicendiiiii','rickey3326','abc315315','asaking 1218','bottikunnn','Marisakami','skYAJU114514','Chaser44','kaninekoheiryo','WearyTwiIight78','FullNiceSandwich','192837465h','dicesoe','studiousEpiccopper','AdroitSturdyCelery','Niwatori0503','JocularHappyClover','kurumi0203','osaruboy0228','blits3939','StellarNeatlyTom','Kingsrennosuke0205','uniuni20131004','02112015','#2CQOVLGLOJ','ComplexGlasses71']) with ordinality as t(n,i) on conflict do nothing;
-- 読み取りのみ公開。書き込みは Netlify Functions(service role)だけ
alter table players enable row level security;alter table chat enable row level security;alter table race enable row level security;alter table history enable row level security;
create policy "read" on players for select using(true);create policy "read" on chat for select using(true);create policy "read" on race for select using(true);create policy "read" on history for select using(true);
alter publication supabase_realtime add table players,chat,race;
