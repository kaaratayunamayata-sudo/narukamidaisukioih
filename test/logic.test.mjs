// 模擬Blobsを使った対戦ロジックの検証:  node test/logic.test.mjs
import assert from "node:assert/strict";

// @netlify/blobs が未インストールでも動くよう、動的importの代わりに差し替え可能な設計になっている
const { __setStoreFactory, handleBody, C } = await import("../netlify/functions/api.mjs").catch(async (e) => {
  console.error("api.mjs の読み込みに失敗（npm install 済みか確認）:", e.message);
  process.exit(1);
});

const mem = new Map();
let etagN = 0;
__setStoreFactory((name) => ({
  async get(key) { const v = mem.get(name + key); return v ? JSON.parse(v.json) : null; },
  async getWithMetadata(key) { const v = mem.get(name + key); return v ? { data: JSON.parse(v.json), etag: v.etag } : null; },
  async setJSON(key, data, opts = {}) {
    const k = name + key, cur = mem.get(k);
    if (opts.onlyIfNew && cur) return { modified: false };
    if (opts.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return { modified: false };
    mem.set(k, { json: JSON.stringify(data), etag: "e" + ++etagN });
    return { modified: true, etag: "e" + etagN };
  },
}));

const call = async (action, body = {}) => (await handleBody({ action, ...body })).body;
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 管理者
assert.equal((await call("adminLogin", { password: "bad" })).ok, false);
const adminToken = ok(await call("adminLogin", { password: "narukami" })).adminToken;
assert.equal((await call("admin", { op: "event", status: "running" })).ok, false); // 認証なしは拒否
ok(await call("admin", { adminToken, op: "event", status: "running" }));

// ログイン & 二重ログイン防止
const A = "hamabenokai", B = "ClumsyShuhei", D = "godhand1234";
const ta = ok(await call("login", { name: A })).token;
const tb = ok(await call("login", { name: B })).token;
const td = ok(await call("login", { name: D })).token;
ok(await call("sync", { name: A, token: ta, ping: true, activity: "select" }));
ok(await call("sync", { name: B, token: tb, ping: true }));
const dup = await call("login", { name: A });
assert.equal(dup.error, "in_use");
assert.equal(ok(await call("login", { name: A, token: ta })).token, ta); // 同端末の再開はOK

// 空きマス確保（争いは発生しない）
let r = ok(await call("claim", { name: A, token: ta, cell: 5 }));
assert.equal(r.kind, "claimed");
r = ok(await call("claim", { name: B, token: tb, cell: 6 }));
assert.equal(r.kind, "claimed");
// 偽トークン拒否
assert.equal((await call("claim", { name: B, token: "x", cell: 7 })).ok, false);
// 同時に同じ空きマスを狙う → 片方が確保、後着は所有者ありなので争奪戦になる
const tdi = ok(await call("login", { name: "dicesoe" })).token;
const [x, y] = await Promise.all([
  call("claim", { name: D, token: td, cell: 10 }),
  call("claim", { name: "dicesoe", token: tdi, cell: 10 }),
]);
ok(x); ok(y);
assert.deepEqual([x.kind, y.kind].sort(), ["battle", "claimed"]);
const chal = x.kind === "battle" ? D : "dicesoe", def = chal === D ? "dicesoe" : D;
const tok = { [D]: td, dicesoe: tdi };
const battleId = (x.kind === "battle" ? x : y).id;

// 対戦中は他の操作不可 / 他人は準備できない
assert.equal((await call("claim", { name: chal, token: tok[chal], cell: 20 })).error, "busy");
assert.equal((await call("ready", { name: A, token: ta, id: battleId })).error, "forbidden");
// 不戦勝は待ち時間前は不可
ok(await call("ready", { name: chal, token: tok[chal], id: battleId }));
assert.equal((await call("forfeit", { name: chal, token: tok[chal], id: battleId })).error, "early");
// カウントダウン前のストップは拒否
ok(await call("ready", { name: def, token: tok[def], id: battleId }));
assert.equal((await call("stop", { name: chal, token: tok[chal], id: battleId })).error, "early");
// 進行中の記録は他人に見えない
let sy = ok(await call("sync", { gameVer: 0, chatVer: 0 }));
assert.ok(sy.game.battles[0].stopped && !sy.game.battles[0].rec);

await sleep(C.COUNTDOWN + C.DUR * 0.5); // 約50%の位置
const s1 = ok(await call("stop", { name: chal, token: tok[chal], id: battleId }));
assert.ok(Math.abs(s1.pos - 50) < 8, "50%付近で止まる: " + s1.pos);
await sleep(1200);
const s2 = ok(await call("stop", { name: def, token: tok[def], id: battleId }));
sy = ok(await call("sync", { gameVer: 0, chatVer: 0 }));
assert.equal(sy.game.battles.length, 0);
const h = sy.game.history[0];
assert.equal(h.winner, chal, "50%に近い方が勝つ");
assert.equal(sy.game.cells[9].o, chal);
assert.equal(sy.game.players[chal].w, 1);
assert.equal(sy.game.players[def].l, 1);
assert.equal((await call("stop", { name: def, token: tok[def], id: battleId })).error, "nobattle");

// 敗者は陣地なし→別マス確保、挑戦者は元の陣地を手放して移動
ok(await call("claim", { name: def, token: tok[def], cell: 11 }));
const mv = ok(await call("claim", { name: A, token: ta, cell: 12 }));
assert.equal(mv.kind, "claimed");
sy = ok(await call("sync", { gameVer: 0, chatVer: 0 }));
assert.equal(sy.game.cells[4].o, null, "移動で元のマスは空く");

// 降参
const cc = ok(await call("claim", { name: A, token: ta, cell: 6 })); // Bの陣地に挑戦
assert.equal(cc.kind, "battle");
ok(await call("concede", { name: B, token: tb, id: cc.id }));
sy = ok(await call("sync", { gameVer: 0, chatVer: 0 }));
assert.equal(sy.game.cells[5].o, A);

// チャット・通報・管理者削除
ok(await call("chat", { name: A, token: ta, text: "こんにちは" }));
assert.equal((await call("chat", { name: A, token: ta, text: "連投" })).error, "rate");
let ch = ok(await call("sync", { gameVer: 0, chatVer: 0 })).chat;
const mid = ch.msgs[0].id;
ok(await call("report", { name: B, token: tb, id: mid }));
assert.equal(ok(await call("adminData", { adminToken })).reports.length, 1);
ok(await call("admin", { adminToken, op: "chatDelete", id: mid }));
ch = ok(await call("sync", { gameVer: 0, chatVer: 0 })).chat;
assert.equal(ch.msgs[0].t, "");

// 停止（BAN）
ok(await call("admin", { adminToken, op: "ban", name: A }));
assert.equal((await call("claim", { name: A, token: ta, cell: 1 })).ok, false);
assert.equal((await call("login", { name: A })).error, "banned");
ok(await call("admin", { adminToken, op: "event", status: "ended" }));
assert.equal((await call("claim", { name: B, token: tb, cell: 1 })).error, "not_running");


// ---------- 30マス(6x5) ----------
{
  const g = ok(await call("sync", { gameVer: 0, chatVer: 0 })).game;
  assert.equal(g.cells.length, 30, "マスは30個");
  assert.equal(C.CELLS, 30);
}

// ---------- 旧データ(36マス・names無し)の自動移行 ----------
{
  const oldG = JSON.parse(mem.get("gameg").json);
  delete oldG.names;
  oldG.cells = Array.from({ length: 36 }, (_, i) => ({ n: i + 1, owner: null, battle: null, at: null }));
  oldG.cells[35].owner = "kurumi0203"; // 消えるマス
  oldG.cells[2].owner = "kurumi0203"; // 残るマス
  mem.set("gameg", { json: JSON.stringify(oldG), etag: "e" + ++etagN });
  const s2 = ok(await call("sync", { gameVer: 0, chatVer: 0 }));
  assert.equal(s2.game.cells.length, 30, "36→30に移行");
  assert.equal(s2.names.length >= 29, true);
  assert.equal(s2.game.cells[2].o, "kurumi0203");
}

// ---------- 管理者パスワードとテスト参加者 ----------
{
  await call("admin", { adminToken, op: "event", status: "running" });
  // 認証なしは拒否
  assert.equal((await call("admin", { op: "addTest" })).ok, false);
  // 自動命名
  let r2 = ok(await call("admin", { adminToken, op: "addTest", count: 2 }));
  assert.deepEqual(r2.added, ["テスト1", "テスト2"]);
  // 名前指定 / 重複拒否 / 予約名拒否
  r2 = ok(await call("admin", { adminToken, op: "addTest", name: "  MyTester " }));
  assert.deepEqual(r2.added, ["MyTester"]);
  assert.equal((await call("admin", { adminToken, op: "addTest", name: "mytester" })).error, "dup");
  assert.equal((await call("admin", { adminToken, op: "addTest", name: "hamabenokai" })).error, "dup");
  assert.equal((await call("admin", { adminToken, op: "addTest", name: "運営" })).error, "bad");
  assert.equal((await call("admin", { adminToken, op: "addTest", name: "x".repeat(25) })).error, "bad");
  let s3 = ok(await call("sync", { gameVer: 0, chatVer: 0 }));
  assert.ok(s3.names.includes("テスト1") && s3.game.players["テスト1"].test === true);
  assert.equal(s3.game.players["hamabenokai"].test, undefined);

  // テスト参加者でログイン→確保→対戦
  const t1 = ok(await call("login", { name: "テスト1" })).token;
  const t2 = ok(await call("login", { name: "テスト2" })).token;
  ok(await call("claim", { name: "テスト1", token: t1, cell: 30 }));
  const bt = ok(await call("claim", { name: "テスト2", token: t2, cell: 30 }));
  assert.equal(bt.kind, "battle");
  const tm = ok(await call("login", { name: "MyTester" })).token;
  assert.equal((await call("claim", { name: "MyTester", token: tm, cell: 31 })).error, "bad"); // 31マス目は存在しない
  // 削除: 対戦は取り消し・陣地は解放・本人は次のsyncでセッション無効
  ok(await call("admin", { adminToken, op: "removeTest", name: "テスト1" }));
  s3 = ok(await call("sync", { gameVer: 0, chatVer: 0 }));
  assert.ok(!s3.names.includes("テスト1"));
  assert.equal(s3.game.cells[29].o, null);
  assert.equal(s3.game.cells[29].b, null);
  assert.equal(s3.game.battles.length, 0);
  const gone = ok(await call("sync", { name: "テスト1", token: t1, ping: true, gameVer: 0, chatVer: 0 }));
  assert.equal(gone.session, false);
  // 本物の参加者は削除できない
  assert.equal((await call("admin", { adminToken, op: "removeTest", name: "hamabenokai" })).ok, false);
  // 全初期化してもテスト参加者は残る
  ok(await call("admin", { adminToken, op: "resetAll" }));
  s3 = ok(await call("sync", { gameVer: 0, chatVer: 0 }));
  assert.ok(s3.names.includes("テスト2") && s3.game.players["テスト2"].test === true);
  // 上限
  assert.equal((await call("admin", { adminToken, op: "addTest", count: 10 })).ok, true);
  assert.equal((await call("admin", { adminToken, op: "addTest", count: 10 })).ok, true);
  assert.equal((await call("admin", { adminToken, op: "addTest", count: 10 })).error, "limit");
}

// ---------- オフラインの人のマスは奪えない ----------
{
  ok(await call("admin", { adminToken, op: "event", status: "running" }));
  ok(await call("admin", { adminToken, op: "addTest", name: "Own" }));
  ok(await call("admin", { adminToken, op: "addTest", name: "Chal" }));
  const to = ok(await call("login", { name: "Own" })).token;
  const tc = ok(await call("login", { name: "Chal" })).token;
  ok(await call("claim", { name: "Own", token: to, cell: 3 }));
  ok(await call("logout", { name: "Own", token: to })); // オフラインになる
  const off = await call("claim", { name: "Chal", token: tc, cell: 3 });
  assert.equal(off.error, "offline", "オフラインの所有者のマスは奪えない");
  const to2 = ok(await call("login", { name: "Own" })).token; // オンラインに戻る
  const on = ok(await call("claim", { name: "Chal", token: tc, cell: 3 }));
  assert.equal(on.kind, "battle", "オンラインなら挑戦できる");
}

console.log("ALL TESTS PASSED");
