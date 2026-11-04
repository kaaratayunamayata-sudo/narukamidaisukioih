// ブロパス配布 第1回 陣取り争奪戦 — サーバー側API（Netlify Functions + Netlify Blobs）
// すべての書き込み・勝敗判定はここで行い、クライアントは表示と操作の送信のみを担当します。
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import { PLAYERS } from "./lib/players.mjs";

export const C = {
  CELLS: 30, // 横6 × 縦5
  TEST_MAX: 30, // テスト参加者の上限
  DUR: 5000, // お肉が0→100%まで伸びる時間(ms)
  GRACE: 1500, // 時間切れ猶予(ms)
  COUNTDOWN: 4000, // 開始までのカウントダウン(ms)
  REMATCH: 5000, // 同点再戦までの時間(ms)
  PENDING_TIMEOUT: 120000, // 準備OKを待つ時間(ms)
  ONLINE_MS: 30000, // これ以内にpingがあればオンライン
  CHAT_MAX: 200,
  CHAT_KEEP: 150,
  ADMIN_TTL: 8 * 3600 * 1000,
};

class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const fail = (code, msg) => {
  throw new ApiError(code, msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- ストレージ（テスト用に差し替え可能） ----------
let storeFactory = (name) => getStore({ name, consistency: "strong" });
export function __setStoreFactory(f) {
  storeFactory = f;
}

async function readJSON(name, key, init) {
  const d = await storeFactory(name).get(key, { type: "json" });
  return d ?? init();
}

// 楽観的排他制御つき更新（etagが一致した時だけ書き込み、衝突したら再試行）
async function mutate(name, key, init, fn) {
  const s = storeFactory(name);
  for (let i = 0; i < 14; i++) {
    const cur = await s.getWithMetadata(key, { type: "json" });
    const data = cur ? cur.data : init();
    const result = fn(data); // throwすれば書き込まず中断
    const opts = cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true };
    const r = await s.setJSON(key, data, opts);
    if (!r || r.modified !== false) return result;
    await sleep(15 + Math.random() * 70);
  }
  fail("busy", "混み合っています。もう一度お試しください");
}

// ---------- 初期データ ----------
const initGame = () => ({
  ver: 1,
  seq: 0,
  event: { status: "ready", startedAt: null, endedAt: null, endsAt: null }, // ready / running / ended（endsAt=自動終了時刻）
  rules: { battle: true }, // battle=false で「対戦なしモード」（空きマスの確保・移動だけ可能）
  notice: null, // 運営からの固定お知らせ
  names: [...PLAYERS], // 参加者の並び順（初期参加者 + 運営が作ったテスト参加者）
  cells: Array.from({ length: C.CELLS }, (_, i) => ({ n: i + 1, owner: null, battle: null, at: null })),
  players: Object.fromEntries(PLAYERS.map((n) => [n, { b: 0, w: 0, l: 0, banned: false }])),
  battles: {},
  history: [],
});
const initChat = () => ({ ver: 1, seq: 0, msgs: [] });

// ---------- 管理者認証（HMAC署名トークン） ----------
// 管理者パスワード（固定）。Netlifyの環境変数 ADMIN_PASSWORD は使いません。
const ADMIN_PASSWORD = "narukami";
const adminSecret = () => process.env.ADMIN_SECRET || ADMIN_PASSWORD;
const hmac = (s) => crypto.createHmac("sha256", adminSecret()).update(s).digest("hex");
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
function makeAdminToken() {
  const exp = Date.now() + C.ADMIN_TTL;
  return exp + "." + hmac("admin:" + exp);
}
function isAdmin(tok) {
  if (!tok || !adminSecret()) return false;
  const [exp, sig] = String(tok).split(".");
  if (!exp || !sig || +exp < Date.now()) return false;
  const good = hmac("admin:" + exp);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}
const needAdmin = (b) => {
  if (!isAdmin(b.adminToken)) fail("admin", "管理者認証が必要です");
};

// ---------- プレイヤー認証 ----------
const namesOf = (g) => g.names || PLAYERS;
function validName(g, name) {
  if (!namesOf(g).includes(name)) fail("name", "不明なアカウントです");
}
async function auth(name, token, g0) {
  validName(g0 || (await readJSON("game", "g", initGame)), name);
  if (!token) fail("session", "ログインし直してください");
  const ss = await readJSON("sessions", "s", () => ({}));
  if (!ss[name] || ss[name].token !== token) fail("session", "このアカウントは別の端末で使用されたか、ログアウトされました");
}

// ---------- 対戦ロジック ----------
const activeBattleOf = (g, name) => Object.values(g.battles).find((b) => b.c === name || b.d === name);
const cellOf = (g, n) => {
  const c = g.cells[Number(n) - 1];
  if (!c) fail("bad", "マスが存在しません");
  return c;
};
const releaseOwned = (g, name, exceptN) =>
  g.cells.forEach((c) => {
    if (c.owner === name && c.n !== exceptN && !c.battle) {
      c.owner = null;
      c.at = null;
    }
  });

function finish(g, b, winner, reason, now) {
  const loser = winner === b.c ? b.d : b.c;
  const cell = g.cells[b.cell - 1];
  if (winner === b.c) {
    // 挑戦者が勝った: 元の陣地を手放して、このマスを獲得
    g.cells.forEach((x) => {
      if (x.owner === b.c && x.n !== b.cell) {
        x.owner = null;
        x.at = null;
      }
    });
    cell.owner = b.c;
    cell.at = now;
  }
  cell.battle = null;
  g.players[b.c].b++;
  g.players[b.d].b++;
  g.players[winner].w++;
  g.players[loser].l++;
  b.state = "done";
  b.winner = winner;
  b.reason = reason; // game / forfeit / concede / admin
  b.doneAt = now;
  delete g.battles[b.id];
  g.history.unshift(b);
  g.history.length = Math.min(g.history.length, 40);
}

function cancelBattle(g, b) {
  g.cells[b.cell - 1].battle = null;
  delete g.battles[b.id];
}

function checkFinish(g, b, now) {
  if (!b.rec[b.c] || !b.rec[b.d]) return;
  const dc = Math.abs(b.rec[b.c].pos - 50);
  const dd = Math.abs(b.rec[b.d].pos - 50);
  if (Math.abs(dc - dd) < 0.05) {
    // 同点 → 再戦
    b.rounds.push({ rec: b.rec });
    b.round++;
    b.rec = {};
    b.tie = true;
    b.startAt = now + C.REMATCH;
    return;
  }
  finish(g, b, dc < dd ? b.c : b.d, "game", now);
}

// 時間切れの自動処理（どのAPI呼び出しでも先に実行される）
function needsSettle(g, now) {
  return Object.values(g.battles).some(
    (b) => b.state === "running" && now > b.startAt + C.DUR + C.GRACE && (!b.rec[b.c] || !b.rec[b.d])
  );
}
function settle(g, now) {
  for (const b of Object.values(g.battles)) {
    if (b.state !== "running" || now <= b.startAt + C.DUR + C.GRACE) continue;
    for (const p of [b.c, b.d]) if (!b.rec[p]) b.rec[p] = { pos: 100, at: b.startAt + C.DUR, auto: true };
    checkFinish(g, b, now);
  }
}

// 旧データ（6x6・names無し）を現在の仕様に合わせる
const needsFix = (g) => !Array.isArray(g.names) || g.cells.length !== C.CELLS || !g.rules;
const timerDue = (g, now) => g.event.status === "running" && g.event.endsAt && now >= g.event.endsAt;
function normGame(g) {
  if (!Array.isArray(g.names)) g.names = [...PLAYERS];
  if (!g.rules) g.rules = { battle: true };
  if (g.event.endsAt === undefined) g.event.endsAt = null;
  for (const n of g.names) if (!g.players[n]) g.players[n] = { b: 0, w: 0, l: 0, banned: false };
  // マスが減った場合: はみ出したマスの争奪戦は取り消し、陣地は消える
  while (g.cells.length > C.CELLS) {
    const c = g.cells.pop();
    if (c.battle) delete g.battles[c.battle];
  }
  for (const b of Object.values(g.battles)) if (b.cell > C.CELLS) delete g.battles[b.id];
  while (g.cells.length < C.CELLS) g.cells.push({ n: g.cells.length + 1, owner: null, battle: null, at: null });
}

async function mutGame(fn) {
  const now = Date.now();
  return mutate("game", "g", initGame, (g) => {
    normGame(g);
    settle(g, now);
    if (timerDue(g, now)) {
      g.event.status = "ended";
      g.event.endedAt = g.event.endsAt;
    }
    const r = fn(g, now);
    g.ver++;
    return r;
  });
}

const battleOf = (g, id, name) => {
  const b = g.battles[id];
  if (!b) fail("nobattle", "この対戦はすでに終了しています");
  if (name && b.c !== name && b.d !== name) fail("forbidden", "この対戦の参加者ではありません");
  return b;
};
const notBanned = (g, name) => {
  if (g.players[name].banned) fail("banned", "このアカウントは停止されています");
};

function doClaim(g, name, n, now, isOn) {
  notBanned(g, name);
  if (g.event.status !== "running") fail("not_running", "イベントは現在開催中ではありません");
  if (activeBattleOf(g, name)) fail("busy", "対戦中は操作できません");
  const c = cellOf(g, n);
  if (c.battle) fail("contested", "このマスはすでに争奪戦中です");
  if (c.owner === name) fail("mine", "すでにあなたの陣地です");
  if (!c.owner) {
    releaseOwned(g, name, c.n);
    c.owner = name;
    c.at = now;
    return { kind: "claimed", cell: c.n };
  }
  if (g.rules && g.rules.battle === false) fail("no_battle", "いまは対戦なしモードです。確保済みのマスには挑戦できません（空きマスは選べます）");
  if (isOn && !isOn(c.owner)) fail("offline", `${c.owner} は今オフラインなので、このマスは奪えません。オンラインの時に挑戦しましょう`);
  if (activeBattleOf(g, c.owner)) fail("busy", "所有者が別の対戦中です。少し待ってからもう一度どうぞ");
  const id = ++g.seq;
  g.battles[id] = {
    id,
    cell: c.n,
    c: name,
    d: c.owner,
    state: "pending",
    createdAt: now,
    ready: { [name]: false, [c.owner]: false },
    round: 1,
    startAt: null,
    rec: {},
    rounds: [],
    tie: false,
  };
  c.battle = id;
  return { kind: "battle", id };
}

// ---------- クライアント向けの表示用データ ----------
function viewGame(g) {
  return {
    ver: g.ver,
    event: g.event,
    rules: g.rules || { battle: true },
    notice: g.notice || null,
    cells: g.cells.map((c) => ({ n: c.n, o: c.owner, b: c.battle, at: c.at })),
    players: g.players,
    // 進行中の記録は誰にも見せない（stopped = 止めたかどうかだけ）
    battles: Object.values(g.battles).map((b) => ({
      id: b.id,
      cell: b.cell,
      c: b.c,
      d: b.d,
      state: b.state,
      createdAt: b.createdAt,
      ready: b.ready,
      round: b.round,
      startAt: b.startAt,
      stopped: Object.keys(b.rec),
      tie: !!b.tie,
      rounds: b.rounds,
    })),
    history: g.history.slice(0, 25),
  };
}
function viewChat(c) {
  return {
    ver: c.ver,
    msgs: c.msgs.slice(-100).map((m) => ({
      id: m.id,
      n: m.n,
      t: m.del ? "" : m.t,
      ts: m.ts,
      del: !!m.del,
      adm: !!m.adm,
      rc: m.rep.length,
    })),
  };
}

const ACTS = ["select", "battle", "spectate", "idle"];

// ---------- ルーティング ----------
async function route(b) {
  const now = Date.now();
  switch (b.action) {
    case "sync": {
      let session;
      let presence;
      const g0 = await readJSON("game", "g", initGame);
      if (b.ping && b.name) {
        try {
          await auth(b.name, b.token, g0);
          session = true;
          const act = ACTS.includes(b.activity) ? b.activity : "select";
          presence = await mutate("presence", "p", () => ({}), (p) => {
            p[b.name] = { t: now, a: act };
            return p;
          });
        } catch (e) {
          if (e instanceof ApiError && (e.code === "session" || e.code === "auth" || e.code === "name")) session = false;
          else throw e;
        }
      }
      let g = g0;
      if (needsSettle(g, now) || needsFix(g) || timerDue(g, now)) {
        await mutGame(() => {});
        g = await readJSON("game", "g", initGame);
      }
      const [pres, chat] = await Promise.all([
        presence ? Promise.resolve(presence) : readJSON("presence", "p", () => ({})),
        readJSON("chat", "c", initChat),
      ]);
      return {
        now: Date.now(),
        names: namesOf(g),
        session,
        gameVer: g.ver,
        game: g.ver !== b.gameVer ? viewGame(g) : undefined,
        presence: pres,
        chat: chat.ver !== b.chatVer ? viewChat(chat) : undefined,
      };
    }

    case "login": {
      const g = await readJSON("game", "g", initGame);
      validName(g, b.name);
      notBanned(g, b.name);
      const ss = await readJSON("sessions", "s", () => ({}));
      const pres = await readJSON("presence", "p", () => ({}));
      const online = pres[b.name] && now - pres[b.name].t < C.ONLINE_MS;
      const same = ss[b.name] && b.token && ss[b.name].token === b.token;
      if (ss[b.name] && online && !same) fail("in_use", "このアカウントはすでに別の端末で参加中です");
      const token = same ? b.token : crypto.randomBytes(24).toString("hex");
      await mutate("sessions", "s", () => ({}), (s) => {
        s[b.name] = { token, at: now };
      });
      await mutate("presence", "p", () => ({}), (p) => {
        p[b.name] = { t: now, a: "select" };
      });
      return { token };
    }

    case "logout": {
      await auth(b.name, b.token);
      await mutate("sessions", "s", () => ({}), (s) => {
        delete s[b.name];
      });
      await mutate("presence", "p", () => ({}), (p) => {
        if (p[b.name]) p[b.name].t = 0;
      });
      return {};
    }

    case "claim": {
      await auth(b.name, b.token);
      // 所有者がオンラインの時だけ奪える（オンライン = 直近のpingが ONLINE_MS 以内）
      const pres = await readJSON("presence", "p", () => ({}));
      const isOn = (n) => !!pres[n] && Date.now() - pres[n].t < C.ONLINE_MS;
      return mutGame((g, t) => doClaim(g, b.name, b.cell, t, isOn));
    }

    case "ready": {
      await auth(b.name, b.token);
      return mutGame((g, t) => {
        notBanned(g, b.name);
        const bt = battleOf(g, b.id, b.name);
        if (bt.state !== "pending") fail("state", "準備の受付は終了しています");
        bt.ready[b.name] = true;
        if (bt.ready[bt.c] && bt.ready[bt.d]) {
          bt.state = "running";
          bt.startAt = t + C.COUNTDOWN;
        }
        return {};
      });
    }

    case "stop": {
      await auth(b.name, b.token);
      return mutGame((g, t) => {
        notBanned(g, b.name);
        const bt = battleOf(g, b.id, b.name);
        if (bt.state !== "running") fail("state", "対戦は進行中ではありません");
        if (t < bt.startAt) fail("early", "まだスタートしていません");
        if (bt.rec[b.name]) fail("done", "すでにストップ済みです");
        // 位置は必ずサーバー時刻から計算する（クライアントの申告は使わない）
        const pos = Math.round(Math.min(100, ((t - bt.startAt) / C.DUR) * 100) * 100) / 100;
        bt.rec[b.name] = { pos, at: t };
        checkFinish(g, bt, t);
        return { pos };
      });
    }

    case "cancel": {
      await auth(b.name, b.token);
      return mutGame((g) => {
        const bt = battleOf(g, b.id, b.name);
        if (bt.state !== "pending") fail("state", "進行中の対戦は取り下げできません");
        if (bt.c !== b.name) fail("forbidden", "取り下げできるのは挑戦者だけです");
        cancelBattle(g, bt);
        return {};
      });
    }

    case "concede": {
      await auth(b.name, b.token);
      return mutGame((g, t) => {
        const bt = battleOf(g, b.id, b.name);
        if (bt.state !== "pending") fail("state", "進行中の対戦では降参できません");
        finish(g, bt, b.name === bt.c ? bt.d : bt.c, "concede", t);
        return {};
      });
    }

    case "forfeit": {
      await auth(b.name, b.token);
      return mutGame((g, t) => {
        const bt = battleOf(g, b.id, b.name);
        const other = b.name === bt.c ? bt.d : bt.c;
        if (bt.state !== "pending") fail("state", "不戦勝は申請できません");
        if (t < bt.createdAt + C.PENDING_TIMEOUT) fail("early", "まだ待ち時間が残っています");
        if (!bt.ready[b.name] || bt.ready[other]) fail("state", "不戦勝の条件を満たしていません");
        finish(g, bt, b.name, "forfeit", t);
        return {};
      });
    }

    // ---------- チャット ----------
    case "chat": {
      const g = await readJSON("game", "g", initGame);
      await auth(b.name, b.token, g);
      notBanned(g, b.name);
      const text = String(b.text || "").trim().slice(0, C.CHAT_MAX);
      if (!text) fail("empty", "メッセージを入力してください");
      return mutate("chat", "c", initChat, (c) => {
        const last = [...c.msgs].reverse().find((m) => m.n === b.name);
        if (last && now - last.ts < 1000) fail("rate", "送信が早すぎます。少し待ってください");
        c.msgs.push({ id: ++c.seq, n: b.name, t: text, ts: now, rep: [] });
        if (c.msgs.length > C.CHAT_KEEP) c.msgs.splice(0, c.msgs.length - C.CHAT_KEEP);
        c.ver++;
        return {};
      });
    }

    case "report": {
      await auth(b.name, b.token);
      return mutate("chat", "c", initChat, (c) => {
        const m = c.msgs.find((x) => x.id === b.id);
        if (!m || m.del) fail("nomsg", "メッセージが見つかりません");
        if (m.n === b.name) fail("self", "自分の投稿は通報できません");
        if (!m.rep.includes(b.name)) m.rep.push(b.name);
        c.ver++;
        return {};
      });
    }

    // ---------- 管理者 ----------
    case "adminLogin": {
      const ok = crypto.timingSafeEqual(sha(b.password || ""), sha(ADMIN_PASSWORD));
      if (!ok) {
        await sleep(900);
        fail("password", "パスワードが違います");
      }
      return { adminToken: makeAdminToken() };
    }

    case "adminData": {
      needAdmin(b);
      const c = await readJSON("chat", "c", initChat);
      return {
        reports: c.msgs
          .filter((m) => m.rep.length && !m.del)
          .map((m) => ({ id: m.id, n: m.n, t: m.t, ts: m.ts, rep: m.rep })),
      };
    }

    case "admin": {
      needAdmin(b);
      return adminOp(b);
    }

    default:
      fail("bad", "不明な操作です");
  }
}

async function adminOp(b) {
  switch (b.op) {
    case "event": {
      if (!["ready", "running", "ended"].includes(b.status)) fail("bad", "不正な状態です");
      return mutGame((g, t) => {
        g.event.status = b.status;
        if (b.status === "running" && !g.event.startedAt) g.event.startedAt = t;
        if (b.status === "ended") g.event.endedAt = t;
        if (b.status === "running") {
          g.event.endedAt = null;
          if (g.event.endsAt && g.event.endsAt <= t) g.event.endsAt = null; // 過ぎた終了時刻は破棄
        }
        if (b.status === "ready") g.event.endsAt = null;
        return {};
      });
    }
    case "resetCells":
      return mutGame((g) => {
        g.cells.forEach((c) => {
          c.owner = null;
          c.battle = null;
          c.at = null;
        });
        g.battles = {};
        return {};
      });
    case "resetAll":
      return mutGame((g) => {
        const fresh = initGame();
        const old = g.players;
        g.cells = fresh.cells;
        g.battles = {};
        g.history = [];
        g.players = {};
        for (const k of g.names) {
          g.players[k] = { b: 0, w: 0, l: 0, banned: !!(old[k] && old[k].banned) };
          if (old[k] && old[k].test) g.players[k].test = true;
        }
        g.event = { status: "ready", startedAt: null, endedAt: null, endsAt: null };
        return {};
      });
    case "ban":
    case "unban": {
      return mutGame((g) => {
        validName(g, b.name);
        g.players[b.name].banned = b.op === "ban";
        if (b.op === "ban") {
          const bt = activeBattleOf(g, b.name);
          if (bt) cancelBattle(g, bt);
          g.cells.forEach((c) => {
            if (c.owner === b.name) {
              c.owner = null;
              c.at = null;
            }
          });
        }
        return {};
      }).then(async (r) => {
        if (b.op === "ban")
          await mutate("sessions", "s", () => ({}), (s) => {
            delete s[b.name];
          });
        return r;
      });
    }
    case "kick": {
      validName(await readJSON("game", "g", initGame), b.name);
      await mutate("sessions", "s", () => ({}), (s) => {
        delete s[b.name];
      });
      await mutate("presence", "p", () => ({}), (p) => {
        if (p[b.name]) p[b.name].t = 0;
      });
      return {};
    }
    case "releaseCell":
      return mutGame((g) => {
        const c = cellOf(g, b.cell);
        if (c.battle) {
          const bt = g.battles[c.battle];
          if (bt) cancelBattle(g, bt);
        }
        c.owner = null;
        c.at = null;
        return {};
      });
    case "setOwner":
      return mutGame((g, t) => {
        validName(g, b.name);
        notBanned(g, b.name);
        const c = cellOf(g, b.cell);
        if (c.battle) fail("contested", "争奪戦中のマスです");
        releaseOwned(g, b.name, c.n);
        c.owner = b.name;
        c.at = t;
        return {};
      });
    case "cancelBattle":
      return mutGame((g) => {
        cancelBattle(g, battleOf(g, b.id));
        return {};
      });
    case "resolveBattle":
      return mutGame((g, t) => {
        const bt = battleOf(g, b.id);
        if (b.winner !== bt.c && b.winner !== bt.d) fail("bad", "勝者が不正です");
        finish(g, bt, b.winner, "admin", t);
        return {};
      });
    // ---------- モード・お知らせ・タイマー ----------
    case "setRules":
      return mutGame((g) => {
        g.rules.battle = b.battle !== false;
        return {};
      });
    case "setNotice": {
      const text = String(b.text || "").trim().slice(0, 120);
      return mutGame((g) => {
        g.notice = text || null;
        return {};
      });
    }
    case "setTimer": {
      const m = Number(b.minutes);
      if (!(m >= 0 && m <= 1440)) fail("bad", "分数は0〜1440の範囲で指定してください（0で解除）");
      return mutGame((g, t) => {
        g.event.endsAt = m > 0 ? t + Math.round(m * 60000) : null;
        return {};
      });
    }
    // ---------- テスト参加者 ----------
    case "addTest": {
      const want = String(b.name ?? "").trim();
      if (want) {
        if (Array.from(want).length > 24) fail("bad", "名前は24文字以内にしてください");
        if (/[\u0000-\u001f\u007f]/.test(want)) fail("bad", "使えない文字が含まれています");
        if (["運営", "__proto__", "constructor", "prototype"].includes(want)) fail("bad", "この名前は使えません");
      }
      const count = want ? 1 : Math.min(10, Math.max(1, parseInt(b.count, 10) || 1));
      return mutGame((g) => {
        const used = new Set(g.names.map((n) => n.toLowerCase()));
        const tests = g.names.filter((n) => g.players[n].test).length;
        if (tests + count > C.TEST_MAX) fail("limit", `テスト参加者は最大${C.TEST_MAX}人までです`);
        const add = (n) => {
          g.names.push(n);
          g.players[n] = { b: 0, w: 0, l: 0, banned: false, test: true };
          used.add(n.toLowerCase());
          return n;
        };
        const added = [];
        if (want) {
          if (used.has(want.toLowerCase())) fail("dup", "同じ名前の参加者がすでにいます");
          added.push(add(want));
        } else {
          for (let i = 1; added.length < count; i++) {
            const n = "テスト" + i;
            if (!used.has(n.toLowerCase())) added.push(add(n));
          }
        }
        return { added };
      });
    }
    case "removeTest":
      return mutGame((g) => {
        const n = b.name;
        if (!g.names.includes(n) || !g.players[n] || !g.players[n].test) fail("bad", "テスト参加者ではありません");
        const bt = activeBattleOf(g, n);
        if (bt) cancelBattle(g, bt);
        g.cells.forEach((c) => {
          if (c.owner === n) {
            c.owner = null;
            c.at = null;
          }
        });
        g.names = g.names.filter((x) => x !== n);
        delete g.players[n];
        return {};
      }).then(async (r) => {
        await mutate("sessions", "s", () => ({}), (s) => {
          delete s[b.name];
        });
        await mutate("presence", "p", () => ({}), (p) => {
          delete p[b.name];
        });
        return r;
      });
    case "chatDelete":
      return mutate("chat", "c", initChat, (c) => {
        const m = c.msgs.find((x) => x.id === b.id);
        if (m) {
          m.del = true;
          m.t = "";
          c.ver++;
        }
        return {};
      });
    case "chatClear":
      return mutate("chat", "c", initChat, (c) => {
        c.msgs = [];
        c.ver++;
        return {};
      });
    case "chatPost": {
      const text = String(b.text || "").trim().slice(0, C.CHAT_MAX);
      if (!text) fail("empty", "メッセージを入力してください");
      return mutate("chat", "c", initChat, (c) => {
        c.msgs.push({ id: ++c.seq, n: "運営", t: text, ts: Date.now(), rep: [], adm: true });
        c.ver++;
        return {};
      });
    }
    default:
      fail("bad", "不明な管理操作です");
  }
}

export async function handleBody(b) {
  try {
    return { status: 200, body: { ok: true, ...(await route(b)) } };
  } catch (e) {
    if (e instanceof ApiError) return { status: 200, body: { ok: false, error: e.code, message: e.message } };
    console.error(e);
    return { status: 500, body: { ok: false, error: "server", message: "サーバーエラーが発生しました" } };
  }
}

const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

export default async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ ok: false, error: "method" }), { status: 405, headers });
  let b;
  try {
    b = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "bad", message: "不正なリクエスト" }), { status: 400, headers });
  }
  const r = await handleBody(b || {});
  return new Response(JSON.stringify(r.body), { status: r.status, headers });
};

export const config = { path: "/api" };
