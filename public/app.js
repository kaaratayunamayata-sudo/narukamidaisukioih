/* ブロパス配布 第1回 陣取り争奪戦 — クライアント
   表示と操作の送信だけを担当。勝敗・所有権の判定はすべて /api（Netlify Functions）で行います。 */
(() => {
'use strict';

const PAL = ['#ff4d6d', '#ff8a1f', '#19b5a5', '#3a86ff', '#8e44ec', '#2fbf71', '#ec4fa8', '#5b6cff'];
const DUR = 5000, TIMEOUT = 120000, ONLINE = 30000;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = {
  names: [], me: null, token: null, storedMe: null, inApp: false,
  game: null, presence: {}, chat: { ver: 0, msgs: [] }, gameVer: 0, chatVer: 0,
  rtts: [], offset: 0, tab: 'board', side: 'stats',
  bv: null, btSig: '', dismissed: new Set(), myStop: {}, stopping: false, knownDone: null,
  seenChat: null, unread: 0, chatOpen: false, justOpened: false,
  admin: null, adminOpen: false, adminTab: 'overview', reports: [], lastRep: 0,
  search: '', err: 0, prevOwners: null, lastPing: 0, raf: 0,
};
try { S.admin = sessionStorage.getItem('bp_admin'); S.storedMe = localStorage.getItem('bp_me'); S.token = localStorage.getItem('bp_token'); } catch {}

const sNow = () => Date.now() + S.offset;

function setHTML(el, html) {
  if (el._h === html) return false;
  el._h = html; el.innerHTML = html; return true;
}
function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 3900);
}
async function api(action, body = {}) {
  let r;
  try {
    r = await fetch('/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...body }) });
  } catch { throw Object.assign(new Error('通信できません。ネットワークを確認してください'), { code: 'net' }); }
  let d;
  try { d = await r.json(); } catch { throw Object.assign(new Error('サーバーから不正な応答がありました'), { code: 'server' }); }
  if (!d.ok) throw Object.assign(new Error(d.message || d.error), { code: d.error });
  return d;
}
const auth = () => ({ name: S.me, token: S.token });
const rate = (p) => (p && p.b ? Math.round((p.w / p.b) * 100) + '%' : '—');
const hhmm = (ts) => new Date(ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
const ownerIdx = (n) => S.names.indexOf(n);
const isTest = (n) => !!(S.game && S.game.players[n] && S.game.players[n].test);
const realNames = () => S.names.filter((n) => !isTest(n));
const testTag = (n) => (isTest(n) ? '<span class="tag test">TEST</span>' : '');
const initial = (n) => (Array.from(String(n).replace(/^#/, ''))[0] || '?').toUpperCase();

function isOn(n) { const p = S.presence[n]; return !!p && sNow() - p.t < ONLINE; }
function statusOf(n) {
  const p = S.presence[n];
  if (!isOn(n)) return { on: false, label: 'オフライン' };
  if (S.game.battles.some((b) => b.c === n || b.d === n)) return { on: true, label: '対戦中' };
  if (p.a === 'spectate') return { on: true, label: '観戦中' };
  if (!S.game.cells.some((c) => c.o === n)) return { on: true, label: '陣地選択中' };
  return { on: true, label: 'オンライン' };
}
function lastSeen(n) {
  const p = S.presence[n];
  if (!p || !p.t) return p ? '退出済み' : '未参加';
  if (isOn(n)) return 'いま';
  const m = Math.floor((sNow() - p.t) / 60000);
  if (m < 1) return 'たった今';
  if (m < 60) return m + '分前';
  if (m < 1440) return Math.floor(m / 60) + '時間前';
  return Math.floor(m / 1440) + '日前';
}

/* ================= 同期 ================= */
function activity() {
  if (S.bv) { const b = findBattle(S.bv); return b && (b.c === S.me || b.d === S.me) && b.state !== 'done' ? 'battle' : 'spectate'; }
  return 'select';
}
async function doSync(ping) {
  const t0 = Date.now();
  const d = await api('sync', { name: S.me, token: S.token, gameVer: S.gameVer, chatVer: S.chatVer, activity: activity(), ping: !!ping });
  const t1 = Date.now(), rtt = t1 - t0;
  S.rtts.push({ rtt, off: d.now - (t0 + rtt / 2) }); if (S.rtts.length > 8) S.rtts.shift();
  S.offset = S.rtts.reduce((a, b) => (b.rtt < a.rtt ? b : a)).off;
  S.names = d.names;
  S.presence = d.presence || {};
  if (d.game) { S.game = d.game; S.gameVer = d.game.ver; }
  if (d.chat) { onChat(d.chat); }
  if (S.me && d.session === false) { forceLogout('このアカウントは別の端末で使用されたか、ログアウトされました'); return; }
  if (S.me && S.game && S.game.players[S.me] && S.game.players[S.me].banned) { forceLogout('このアカウントは運営により停止されています'); return; }
  render();
}
async function loop() {
  try {
    const ping = !!S.me && Date.now() - S.lastPing > 10000;
    await doSync(ping);
    if (ping) S.lastPing = Date.now();
    if (S.adminOpen && S.admin && Date.now() - S.lastRep > 5000) {
      S.lastRep = Date.now();
      api('adminData', { adminToken: S.admin }).then((d) => { S.reports = d.reports; renderAdmin(); }).catch(adminErr);
    }
    S.err = 0; $('#offline').hidden = true;
  } catch (e) {
    if (++S.err > 2) $('#offline').hidden = false;
  }
  const busy = S.bv && findBattle(S.bv) && findBattle(S.bv).state !== 'done';
  setTimeout(loop, document.hidden ? 6000 : busy ? 700 : 1800);
}

/* ================= ログイン ================= */
function renderLogin() {
  const q = S.search.trim().toLowerCase();
  const list = S.names.filter((n) => n.toLowerCase().includes(q));
  const html = list.map((n) => {
    const st = statusOf(n), banned = S.game.players[n].banned, mine = n === S.storedMe;
    const locked = banned || (st.on && !mine);
    const lab = banned ? '停止中' : st.on ? (mine ? 'この端末で参加中' : '使用中') : '';
    return `<button class="login-item" data-name="${esc(n)}" ${locked ? 'disabled' : ''}><span class="dot ${st.on ? 'on' : ''}"></span><span class="nm">${esc(n)}</span>${testTag(n)}${lab ? `<small>${lab}</small>` : ''}</button>`;
  }).join('') || '<div class="empty-note">該当するアカウントがありません</div>';
  setHTML($('#loginList'), html);
}
function confirmLogin(name) {
  openModal(`<h3>このアカウントで参加しますか？</h3>
    <div class="big-name">${esc(name)}</div>
    <p style="margin:0;font-size:.85rem;opacity:.8">間違えると他の人のアカウントを使ってしまいます。もう一度確認してください。</p>
    <div class="row"><button class="btn green" data-act="loginOK" data-name="${esc(name)}">これで間違いありません</button>
    <button class="btn ghost" data-act="loginBack">戻って選び直す</button></div>`);
}
async function doLogin(name) {
  try {
    const d = await api('login', { name, token: S.storedMe === name ? S.token : null });
    S.me = name; S.token = d.token; S.storedMe = name; S.lastPing = Date.now();
    try { localStorage.setItem('bp_me', name); localStorage.setItem('bp_token', d.token); } catch {}
    closeModal(); enterApp(); toast(name + ' で参加しました', 'ok');
    doSync(false).catch(() => {});
  } catch (e) { closeModal(); toast(e.message, 'err'); }
}
function enterApp() {
  S.inApp = true; S.seenChat = null; S.unread = 0; S.prevOwners = null; S.knownDone = null;
  $('#screen-login').hidden = true; $('#screen-app').hidden = false; $('#chatFab').hidden = false;
  $('#chatInput').disabled = !S.me;
  $('#chatInput').placeholder = S.me ? 'メッセージを入力…' : 'ログインするとチャットに参加できます';
  S.chatVer = 0; render();
}
async function forceLogout(msg) {
  S.me = null; S.token = null; S.storedMe = null;
  try { localStorage.removeItem('bp_me'); localStorage.removeItem('bp_token'); } catch {}
  leaveApp(); if (msg) toast(msg, 'err');
}
function leaveApp() {
  closeBattle(true); closeModal(); $('#chat').hidden = true; S.chatOpen = false;
  S.inApp = false; $('#screen-app').hidden = true; $('#chatFab').hidden = true; $('#screen-login').hidden = false;
  render();
}
async function logout() {
  if (S.me) { try { await api('logout', auth()); } catch {} }
  S.me = null; S.token = null; S.storedMe = null;
  try { localStorage.removeItem('bp_me'); localStorage.removeItem('bp_token'); } catch {}
  leaveApp();
}

/* ================= 描画 ================= */
function render() {
  if (!S.game) return;
  if (!S.inApp) { renderLogin(); if (S.adminOpen) renderAdmin(); return; }
  renderHeader(); renderBanner(); renderBoard(); renderStats(); renderLive(); renderPlayers(); renderChat();
  trackDone(); autoBattle();
  if (S.bv) renderBattle();
  if (S.adminOpen) renderAdmin();
  const live = S.game.battles.length;
  const lb = $('#liveBadge'); lb.hidden = !live; lb.textContent = live;
  document.title = (S.unread ? `(${S.unread}) ` : '') + 'ブロパス配布 第1回 陣取り争奪戦';
}

const noBattle = () => !!(S.game && S.game.rules && S.game.rules.battle === false);
function pillText() {
  const ev = S.game.event;
  if (ev.status === 'ended') return '🏁 終了';
  if (ev.status !== 'running') return '⏳ 開始前';
  let t = noBattle() ? '🕊 対戦なし' : '🔥 開催中';
  if (ev.endsAt) { const r = Math.max(0, ev.endsAt - sNow()); t += ` 残り ${Math.floor(r / 60000)}:${String(Math.floor((r % 60000) / 1000)).padStart(2, '0')}`; }
  return t;
}
function renderHeader() {
  const ev = S.game.event.status;
  const pill = $('#eventPill');
  pill.className = 'pill ' + ev + (ev === 'running' && noBattle() ? ' nobattle' : '');
  pill.textContent = pillText();
  const nt = $('#notice'), ntx = S.game.notice;
  nt.hidden = !ntx; if (ntx) nt.textContent = '📢 ' + ntx;
  const me = S.me ? `<span class="dot on"></span><span>${esc(S.me)}</span>` : '<span>👀 観戦モード</span>';
  setHTML($('#meChip'), me);
  $('#btnLogout').title = S.me ? 'ログアウト' : 'アカウント選択へ';
  document.body.dataset.tab = S.tab; document.body.dataset.side = S.side;
  $$('#bottomNav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
  $$('#sideTabs button').forEach((b) => b.classList.toggle('on', b.dataset.pane === S.side));
}

function renderBanner() {
  const el = $('#banner'), ev = S.game.event.status;
  const mine = S.me && S.game.battles.find((b) => b.c === S.me || b.d === S.me);
  let html = '', cls = 'banner';
  if (mine) { cls += ' alert'; html = `⚔ マス #${mine.cell} の争奪戦が進行中！<button class="btn small" data-act="openMine" data-id="${mine.id}">対戦画面を開く</button>`; }
  else if (ev === 'ready') { cls += ' warn'; html = '⏳ イベント開始前です。運営の開始を待ちましょう（観戦・チャットは利用できます）'; }
  else if (ev === 'ended') { cls += ' warn'; html = '🏁 イベントは終了しました。ご参加ありがとうございました！'; }
  else if (ev === 'running' && noBattle()) { cls += ' warn'; html = '🕊 いまは「対戦なしモード」です。空きマスを選んで陣地を決めましょう（確保済みのマスへの挑戦はできません）'; }
  else if (S.me && !S.game.cells.some((c) => c.o === S.me)) html = '🎯 好きなマスをタップして、自分の陣地を確保しよう！';
  else if (!S.me) html = '👀 観戦モードです。参加するにはアカウントを選択してください';
  el.hidden = !html; el.className = cls; setHTML(el, html);
}

function renderBoard() {
  const prev = S.prevOwners;
  const html = S.game.cells.map((c) => {
    const o = c.o, idx = o ? ownerIdx(o) : -1;
    const cls = ['cell'];
    let style = '';
    if (!o) cls.push('free'); else { cls.push('owned', 'p' + (Math.floor(idx / 8) % 4)); style = `--c:${PAL[idx % 8]}`; }
    if (c.b) cls.push('fight');
    if (o && o === S.me) cls.push('mine');
    const away = o && o !== S.me && !c.b && !isOn(o);
    if (away) cls.push('away');
    if (prev && o && prev[c.n - 1] !== o) cls.push('pop');
    const st = o ? S.game.players[o] : null;
    const meta = o ? (c.b ? '争奪中！' : away ? '🌙 オフライン' : st.b ? '勝率' + rate(st) : '新規') : '';
    return `<button class="${cls.join(' ')}" data-cell="${c.n}" style="${style}" aria-label="マス${c.n} ${o ? esc(o) : '空き'}">
      <span class="no">${c.n}</span>
      ${o ? `<span class="own">${esc(o)}</span>${isOn(o) ? '<i class="on"></i>' : ''}` : '<span class="empty">空き</span>'}
      ${c.b ? '<span class="vs">⚔</span>' : ''}<span class="meta">${meta}</span></button>`;
  }).join('');
  setHTML($('#board'), html);
  S.prevOwners = S.game.cells.map((c) => c.o);
}

function ring(label, pct, color, sub) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  return `<div class="ring-card"><div class="ring" style="--p:${p};--c:${color}"><b>${p}%</b></div><div class="lb">${label}</div>${sub ? `<small>${sub}</small>` : ''}</div>`;
}
function renderStats() {
  const g = S.game, N = g.cells.length, RN = realNames(), P = RN.length || 29;
  const owned = g.cells.filter((c) => c.o).length, fight = g.cells.filter((c) => c.b).length;
  const online = RN.filter(isOn).length;
  const settled = RN.filter((n) => g.cells.some((c) => c.o === n)).length;
  const ev = g.event;
  const evTxt = ev.status === 'running' ? '開催中' : ev.status === 'ended' ? '終了' : '開始前';
  const since = ev.startedAt ? new Date(ev.startedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const my = S.me ? g.players[S.me] : null;
  const myCells = S.me ? g.cells.filter((c) => c.o === S.me).map((c) => '#' + c.n).join(' ') : '';
  const html = `
    <div class="card" style="padding:12px">
      <div class="stat-line"><span>イベント状態</span><b>${evTxt}</b></div>
      <div class="stat-line"><span>開始時刻</span><b>${since}</b></div>
      <div class="stat-line"><span>イベント進行率（陣地を確定した人）</span><b>${settled}/${P}人</b></div>
      <div class="bar"><i style="width:${(settled / P) * 100}%"></i></div>
    </div>
    <div class="sec-title">📊 イベント全体の状況</div>
    <div class="ring-grid">
      ${ring('陣地確保率', (owned / N) * 100, '#2f7bff', `${owned}/${N}マス`)}
      ${ring('空きマス率', ((N - owned) / N) * 100, '#ffc21a', `${N - owned}/${N}マス`)}
      ${ring('争奪中の割合', (fight / N) * 100, '#ff3b4e', `${fight}/${N}マス`)}
      ${ring('オンライン率', (online / P) * 100, '#25d366', `${online}/${P}人`)}
      ${ring('イベント進行率', (settled / P) * 100, '#7b3ff2', `${settled}/${P}人が陣地確定`)}
    </div>
    ${my ? `<div class="sec-title">🙋 あなたの戦績</div><div class="card" style="padding:12px">
      <div class="stat-line"><span>陣地</span><b>${myCells || 'まだありません'}</b></div>
      <div class="stat-line"><span>対戦</span><b>${my.b}戦 ${my.w}勝 ${my.l}敗</b></div>
      <div class="stat-line"><span>勝率</span><b>${rate(my)}</b></div></div>` : ''}`;
  setHTML($('#paneStats'), html);
}

function vsRow(b, live) {
  const stt = b.state === 'running' && b.startAt && sNow() >= b.startAt ? 'live' : '';
  return `<div class="live-card"><span class="cell-no" style="margin:0">${b.cell}</span>
    <div class="vs-t"><b>${esc(b.c)}</b><span style="opacity:.6">VS</span><b>${esc(b.d)}</b></div>
    <div style="text-align:right"><span class="tag ${stt ? 'live' : ''}">${stt ? '● LIVE' : b.state === 'pending' ? '準備中' : 'まもなく'}</span><br>
    <button class="btn small red" style="margin-top:6px" data-act="watch" data-id="${b.id}">${live ? '観戦' : '開く'}</button></div></div>`;
}
function renderLive() {
  const g = S.game;
  const act = g.battles.map((b) => vsRow(b, true)).join('') || '<div class="empty-note">いま争奪戦はありません。<br>誰かが取られているマスに挑戦すると始まります！</div>';
  const hist = g.history.slice(0, 12).map((b) => {
    const lose = b.winner === b.c ? b.d : b.c;
    const why = b.reason === 'game' ? '' : b.reason === 'forfeit' ? '（不戦勝）' : b.reason === 'concede' ? '（降参）' : '（運営判定）';
    return `<div class="live-card"><span class="cell-no" style="margin:0;background:var(--blue);color:#fff">${b.cell}</span>
      <div class="vs-t"><b>🏆 ${esc(b.winner)} ${why}</b><span style="opacity:.7;font-size:.78rem">vs ${esc(lose)}</span></div>
      <button class="btn small ghost" data-act="watch" data-id="${b.id}">結果</button></div>`;
  }).join('') || '<div class="empty-note">まだ対戦結果はありません</div>';
  setHTML($('#paneLive'), `<div class="sec-title">🔴 LIVE 対戦</div>${act}<div class="sec-title">🏁 最近の結果</div>${hist}`);
}

function renderPlayers() {
  const g = S.game;
  const rows = S.names.map((n) => ({ n, p: g.players[n], cells: g.cells.filter((c) => c.o === n).length }));
  rows.sort((a, b) => b.p.w - a.p.w || (b.p.b ? b.p.w / b.p.b : -1) - (a.p.b ? a.p.w / a.p.b : -1) || b.cells - a.cells || a.n.localeCompare(b.n));
  const RN = realNames(), online = RN.filter(isOn).length;
  const html = `<div class="sec-title">🏆 ランキング / 参加者（${online}/${RN.length}人オンライン）</div><div class="rank-list">` +
    rows.map((r, i) => {
      const st = statusOf(r.n);
      return `<div class="rank-row ${r.n === S.me ? 'me' : ''}"><div class="rank-no">${i + 1}</div>
        <div class="rank-main"><div class="rank-name"><span class="dot ${st.on ? 'on' : ''}"></span><span>${esc(r.n)}</span>${testTag(r.n)}${r.p.banned ? '<span class="tag">停止</span>' : ''}</div>
        <div class="rank-sub">${st.label}・陣地 ${r.cells}マス・最終 ${lastSeen(r.n)}</div></div>
        <div class="rank-nums"><div><b>${r.p.w}</b>勝</div><div><b>${r.p.l}</b>敗</div><div><b>${r.p.b}</b>戦</div><div><b>${rate(r.p)}</b>勝率</div></div></div>`;
    }).join('') + '</div>';
  setHTML($('#panePlayers'), html);
}

/* ================= セル詳細・確保 ================= */
function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').hidden = false; }
function closeModal() { $('#modal').hidden = true; }

function openCell(n) {
  const c = S.game.cells[n - 1], o = c.o, ev = S.game.event.status;
  const bt = c.b ? S.game.battles.find((b) => b.id === c.b) : null;
  const ps = o ? S.game.players[o] : null;
  let act;
  if (bt) act = `<button class="btn red wide" data-act="watch" data-id="${bt.id}">${bt.c === S.me || bt.d === S.me ? '⚔ 対戦画面を開く' : '🔴 観戦する'}</button>`;
  else if (!S.me) act = `<p>参加するにはアカウントを選択してください。</p><button class="btn blue wide" data-act="toLogin">アカウントを選択する</button>`;
  else if (ev !== 'running') act = '<p>イベントは現在開催中ではありません。</p>';
  else if (o === S.me) act = '<p>✅ ここはあなたの陣地です。</p>';
  else if (!o) act = `<button class="btn green wide big" data-act="claim" data-n="${n}">ここを確保する</button>`;
  else if (noBattle()) act = `<p style="margin:0 0 10px;font-size:.9rem">🕊 いまは対戦なしモードのため、確保済みのマスには挑戦できません。空きマスを選んでください。</p><button class="btn wide big" disabled>⚔ 挑戦できません</button>`;
  else if (!isOn(o)) act = `<p style="margin:0 0 10px;font-size:.9rem">🌙 <b>${esc(o)}</b> は今オフラインです。オンラインの時だけ奪えます。</p><button class="btn wide big" disabled>⚔ 挑戦できません</button>`;
  else act = `<p style="margin:0 0 10px;font-size:.88rem">すでに <b>${esc(o)}</b> が確保済みです。奪うには「お肉ピッタリ半分」で勝負！</p><button class="btn red wide big" data-act="claim" data-n="${n}">⚔ 挑戦する</button>`;
  openModal(`<h3><span class="cell-no">${n}</span>マス #${n}</h3>
    <dl class="kv"><dt>状態</dt><dd>${bt ? '🔥 争奪戦中' : o ? '確保済み' : '✨ 空き地'}</dd>
    <dt>所有者</dt><dd>${o ? esc(o) + (o === S.me ? '（あなた）' : '') + (isOn(o) ? ' 🟢' : '') : '—'}</dd>
    ${ps ? `<dt>戦績</dt><dd>${ps.b}戦 ${ps.w}勝 ${ps.l}敗（勝率 ${rate(ps)}）</dd>` : ''}
    ${bt ? `<dt>対戦</dt><dd>${esc(bt.c)} vs ${esc(bt.d)}</dd>` : ''}</dl>
    ${act}<div class="row"><button class="btn ghost" data-act="mclose">閉じる</button></div>`);
}
function confirmClaim(n) {
  const c = S.game.cells[n - 1];
  openModal(`<h3>この場所を確保しますか？</h3><div class="big-name">マス #${n}</div>
    ${c.o ? `<p style="margin:0">⚔ <b>${esc(c.o)}</b> がすでに確保中です。確定すると<b>争奪戦</b>が始まります。</p>` : '<p style="margin:0">誰もいない空きマスです。そのまま自分の陣地になります。</p>'}
    ${S.game.cells.some((x) => x.o === S.me) && !c.o ? '<p style="font-size:.8rem;opacity:.8">※ 今の陣地は手放して、こちらに移動します</p>' : ''}
    <div class="row"><button class="btn ${c.o ? 'red' : 'green'}" data-act="claimOK" data-n="${n}">${c.o ? '挑戦する！' : '確保する！'}</button><button class="btn ghost" data-act="mclose">やめる</button></div>`);
}
async function claim(n) {
  closeModal();
  try {
    const d = await api('claim', { ...auth(), cell: n });
    await doSync(false);
    if (d.kind === 'claimed') toast(`マス #${n} を確保しました！`, 'ok');
    else openBattle(d.id);
  } catch (e) {
    toast(e.message, 'err');
    if (e.code === 'session') forceLogout(e.message);
    doSync(false).catch(() => {});
  }
}

/* ================= 対戦 ================= */
function findBattle(id) { return S.game && (S.game.battles.find((b) => b.id === id) || S.game.history.find((b) => b.id === id)) || null; }
function openBattle(id) {
  closeModal(); S.bv = id; S.dismissed.delete(id); S.btSig = '';
  $('#battle').hidden = false; document.body.style.overflow = 'hidden';
  renderBattle(); cancelAnimationFrame(S.raf); S.raf = requestAnimationFrame(tick);
}
function closeBattle(silent) {
  if (S.bv) S.dismissed.add(S.bv);
  S.bv = null; S.btSig = ''; $('#battle').hidden = true; document.body.style.overflow = '';
  cancelAnimationFrame(S.raf);
}
function trackDone() {
  const ids = S.game.history.map((b) => b.id);
  if (!S.knownDone) { S.knownDone = new Set(ids); return; }
  for (const b of S.game.history) {
    if (S.knownDone.has(b.id)) continue;
    S.knownDone.add(b.id);
    if (S.me && (b.c === S.me || b.d === S.me) && S.bv !== b.id) toast(b.winner === S.me ? `🏆 マス #${b.cell} の争奪戦に勝ちました！` : `マス #${b.cell} の争奪戦は負けました…`, b.winner === S.me ? 'ok' : 'err');
  }
}
function autoBattle() {
  if (!S.me) return;
  const mine = S.game.battles.find((b) => b.c === S.me || b.d === S.me);
  if (mine && !S.dismissed.has(mine.id) && S.bv !== mine.id) {
    openBattle(mine.id);
    toast(mine.d === S.me ? `⚔ ${mine.c} がマス #${mine.cell} に挑戦してきた！` : '対戦画面を開きました', 'err');
  }
}
function fighter(b, name, side, role) {
  const done = b.state === 'done';
  const cls = ['fighter', side];
  if (done) cls.push(b.winner === name ? 'win' : 'lose');
  if (name === S.me) cls.push('you');
  const st = [];
  st.push(`<span><span class="dot ${isOn(name) ? 'on' : ''}"></span> ${isOn(name) ? 'オンライン' : 'オフライン'}</span>`);
  if (b.state === 'pending' && b.ready[name]) st.push('<span class="tag win">✔ 準備OK</span>');
  if (b.state === 'running' && b.stopped.includes(name)) st.push('<span class="tag win">STOP済み</span>');
  const p = S.game.players[name];
  return `<div class="${cls.join(' ')}"><div class="role">${role}</div><div class="avatar">${esc(initial(name))}</div>
    <div class="fn">${esc(name)}</div><div style="font-size:.7rem;opacity:.9">${p.w}勝 ${p.l}敗</div><div class="st">${st.join('')}</div></div>`;
}
function renderBattle() {
  const b = findBattle(S.bv);
  if (!b) { closeBattle(); toast('この対戦は取り下げられました'); return; }
  const role = b.c === S.me ? 'c' : b.d === S.me ? 'd' : null;
  const done = b.state === 'done';
  const my = role ? S.myStop[b.id + ':' + b.round] : null;
  const stoppedMe = role && ((b.stopped || []).includes(S.me) || !!my);
  const sig = [b.state, b.round, b.startAt, JSON.stringify(b.ready), (b.stopped || []).join(), b.winner, my ? my.pos : '', role, isOn(b.c), isOn(b.d)].join('|');
  if (sig === S.btSig) return;
  S.btSig = sig;

  let pins = '';
  if (done && b.rec) {
    const pc = b.rec[b.c], pd = b.rec[b.d];
    if (pc) pins += `<div class="pin a" style="left:${pc.pos}%">${esc(Array.from(b.c).slice(0, 6).join(''))} ${pc.pos}%</div>`;
    if (pd) pins += `<div class="pin b" style="left:${pd.pos}%">${esc(Array.from(b.d).slice(0, 6).join(''))} ${pd.pos}%</div>`;
  } else if (my) pins = `<div class="pin ${role === 'c' ? 'a' : 'b'}" style="left:${my.pos}%">あなた ${my.pos}%</div>`;

  let result = '';
  if (done) {
    const why = b.reason === 'forfeit' ? '相手が準備しなかったため不戦勝' : b.reason === 'concede' ? '相手の降参により決着' : b.reason === 'admin' ? '運営の判定により決着' : '「お肉ピッタリ半分」で決着！';
    const tbl = b.rec && b.rec[b.c] && b.rec[b.d] ? `<table><tr><th>プレイヤー</th><th>記録</th><th>目標(50%)との差</th></tr>
      ${[b.c, b.d].map((n) => `<tr><td>${esc(n)}${n === b.winner ? ' 🏆' : ''}</td><td>${b.rec[n].pos}%${b.rec[n].auto ? '（時間切れ）' : ''}</td><td>${Math.abs(b.rec[n].pos - 50).toFixed(2)}</td></tr>`).join('')}</table>` : '';
    const you = role ? `<div style="font-size:1.2rem;margin-top:8px">${b.winner === S.me ? '🎉 あなたの勝ち！' : '😢 残念…負けました'}</div>` : '';
    result = `<div class="result"><div class="crown">🏆</div><div style="font-size:.9rem">WINNER</div><div class="w1">${esc(b.winner)}</div>
      <div>マス #${b.cell} を${b.winner === b.c ? '獲得！' : '守り抜いた！'}</div><div style="font-size:.85rem;opacity:.8">${why}${b.rounds && b.rounds.length ? `（同点再戦 ${b.rounds.length}回）` : ''}</div>${you}${tbl}</div>`;
  }

  let acts = '';
  if (done || !role) acts = `<button class="btn big" data-act="bclose">閉じる</button>`;
  else if (b.state === 'pending') {
    const rdy = b.ready[S.me];
    acts = `<button class="btn green big" data-act="bready" ${rdy ? 'disabled' : ''}>${rdy ? '相手の準備を待っています…' : '✔ 準備OK！'}</button>
      ${role === 'c' ? '<button class="btn ghost" data-act="bcancel">取り下げる</button>' : '<button class="btn ghost" data-act="bconcede">降参する</button>'}
      <button class="btn purple" id="bt-forfeit" data-act="bforfeit" hidden disabled>不戦勝を申請</button>
      <button class="btn ghost small" data-act="bclose">画面を閉じる</button>`;
  } else acts = `<button class="stop-btn" id="bt-stop" disabled>STOP!</button>`;

  const html = `<div class="bt">
    <button class="icon-btn bt-close" data-act="bclose" title="閉じる">✕</button>
    <div class="bt-head"><span class="live-tag ${b.state === 'running' ? '' : 'off'}">LIVE</span><h2>マス #${b.cell} 争奪戦</h2><span class="tag">ROUND ${b.round}</span></div>
    <div class="arena">${fighter(b, b.c, 'l', '挑戦者')}
      <div class="bt-mid"><div class="bt-msg" id="bt-msg"></div>
        <div class="gauge"><div class="gbar"><div class="clip"><div class="gfill" id="bt-fill"></div><div class="gmask" id="bt-mask" hidden>？？？</div></div>
        <div class="gtarget"><span>ちょうど半分</span></div>${pins}</div><div class="gscale"><span>0</span><span>🥩 お肉の長さ</span><span>100</span></div></div>
        <div class="bt-time" id="bt-time"></div>
        ${my ? `<div class="spec-note">あなたの記録：<b>${my.pos}%</b>（目標との差 ${Math.abs(my.pos - 50).toFixed(2)}）— 結果をお待ちください</div>` : ''}
        ${!role && !done ? '<div class="spec-note">👀 観戦モード（操作はできません）</div>' : ''}
        ${role && !done && b.state === 'running' && !stoppedMe ? '<div class="spec-note">途中からお肉が見えなくなります！ スペースキーでもストップできます</div>' : ''}</div>
      ${fighter(b, b.d, 'r', '防衛者')}</div>
    <div class="bt-actions">${acts}</div>${result}</div>`;
  $('#battleBody').innerHTML = html;
  S.lastMsg = null; // 次のtickで文言更新
}

function tick() {
  if (!S.bv) return;
  const b = findBattle(S.bv);
  if (b) updateGauge(b);
  S.raf = requestAnimationFrame(tick);
}
function updateGauge(b) {
  const t = sNow(), role = b.c === S.me ? 'c' : b.d === S.me ? 'd' : null, done = b.state === 'done';
  let pos = 0, msg = '', cd = false, time = '';
  if (done) {
    pos = b.rec && b.rec[b.c] && b.rec[b.d] ? Math.max(b.rec[b.c].pos, b.rec[b.d].pos) : 0;
    msg = '決着！';
  } else if (b.state === 'pending') {
    msg = '両者の準備OKを待っています';
    const rem = Math.max(0, b.createdAt + TIMEOUT - t);
    time = `受付残り ${Math.floor(rem / 60000)}:${String(Math.floor((rem % 60000) / 1000)).padStart(2, '0')}`;
    const f = $('#bt-forfeit');
    if (f && role) {
      const opp = role === 'c' ? b.d : b.c;
      const can = b.ready[S.me] && !b.ready[opp];
      f.hidden = !can; f.disabled = rem > 0;
      f.textContent = rem > 0 ? `不戦勝を申請（あと${Math.ceil(rem / 1000)}秒）` : '不戦勝を申請';
    }
  } else if (t < b.startAt) {
    const n = Math.ceil((b.startAt - t) / 1000);
    msg = String(n); cd = true; time = b.tie || b.round > 1 ? `同点のため再戦！（ROUND ${b.round}）` : 'まもなくスタート';
  } else {
    pos = Math.min(100, ((t - b.startAt) / DUR) * 100);
    const stopped = role && ((b.stopped || []).includes(S.me) || S.myStop[b.id + ':' + b.round]);
    msg = pos >= 100 ? '判定中…' : !role ? 'LIVE！ 勝負の行方は…' : stopped ? '結果を待っています…' : 'ピッタリ半分で止めろ！';
    time = `残り ${(Math.max(0, b.startAt + DUR - t) / 1000).toFixed(1)}秒`;
  }
  const m = $('#bt-msg');
  if (m && S.lastMsg !== msg) { S.lastMsg = msg; m.textContent = msg; m.className = 'bt-msg' + (cd ? ' cd' : ''); }
  const tm = $('#bt-time'); if (tm && tm.textContent !== time) tm.textContent = time;
  const fill = $('#bt-fill'); if (fill) fill.style.width = pos + '%';
  const mask = $('#bt-mask'); if (mask) mask.hidden = !(role && !done && pos > 30);
  const st = $('#bt-stop');
  if (st) {
    const stopped = (b.stopped || []).includes(S.me) || S.myStop[b.id + ':' + b.round];
    const can = t >= b.startAt && !stopped && pos < 100 && !S.stopping;
    if (st.disabled === can) st.disabled = !can;
    const label = stopped ? 'STOP済み' : t < b.startAt ? 'READY…' : 'STOP!';
    if (st.textContent !== label) st.textContent = label;
  }
}
async function doStop() {
  const b = findBattle(S.bv);
  if (!b || b.state !== 'running' || S.stopping) return;
  const role = b.c === S.me || b.d === S.me;
  if (!role || sNow() < b.startAt || S.myStop[b.id + ':' + b.round] || (b.stopped || []).includes(S.me)) return;
  S.stopping = true;
  try {
    const d = await api('stop', { ...auth(), id: b.id });
    S.myStop[b.id + ':' + b.round] = { pos: d.pos };
    S.btSig = ''; renderBattle();
    doSync(false).catch(() => {});
  } catch (e) { toast(e.message, 'err'); }
  S.stopping = false;
}
async function battleAction(act) {
  const b = findBattle(S.bv); if (!b) return;
  try {
    if (act === 'bready') { await api('ready', { ...auth(), id: b.id }); }
    else if (act === 'bcancel') { await api('cancel', { ...auth(), id: b.id }); closeBattle(); toast('挑戦を取り下げました'); }
    else if (act === 'bconcede') { if (!confirm('本当に降参しますか？ マスは相手のものになります。')) return; await api('concede', { ...auth(), id: b.id }); }
    else if (act === 'bforfeit') { await api('forfeit', { ...auth(), id: b.id }); }
    await doSync(false);
  } catch (e) { toast(e.message, 'err'); doSync(false).catch(() => {}); }
}

/* ================= チャット ================= */
function chatToast(m, count) {
  $$('#toasts .toast.chat').forEach((e) => e.remove());
  const t = document.createElement('div');
  t.className = 'toast chat';
  const head = document.createElement('b');
  head.textContent = (m.adm ? '📢 ' : '💬 ') + m.n + (count > 1 ? `（ほか${count - 1}件）` : '');
  const body = document.createElement('div');
  body.textContent = m.t.length > 50 ? m.t.slice(0, 50) + '…' : m.t;
  t.append(head, body);
  t.addEventListener('click', () => { t.remove(); openChat(); });
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 3900);
}
function onChat(c) {
  if (!S.inApp) { S.chat = c; S.chatVer = c.ver; return; } // ログイン画面では通知しない
  const first = S.seenChat === null;
  const maxId = c.msgs.reduce((m, x) => Math.max(m, x.id), 0);
  if (first) S.seenChat = maxId;
  else {
    const fresh = c.msgs.filter((m) => m.id > S.seenChat && m.n !== S.me && !m.del);
    if (S.chatOpen) S.seenChat = maxId;
    else if (fresh.length) {
      S.unread += fresh.length; S.seenChat = maxId;
      const l = fresh[fresh.length - 1];
      const fighting = S.me && S.game && S.game.battles.some((b) => b.c === S.me || b.d === S.me);
      if (!fighting) chatToast(l, fresh.length); // 対戦中はバッジだけ（STOPの邪魔をしない）
    } else S.seenChat = Math.max(S.seenChat, maxId);
  }
  S.chat = c; S.chatVer = c.ver;
}
function renderChat() {
  const n = S.unread;
  for (const id of ['#chatBadge', '#chatBadgeTop']) { const e = $(id); e.hidden = !n; e.textContent = n > 99 ? '99+' : n; }
  $('#chatOnline').textContent = `オンライン ${S.names.filter(isOn).length}人`;
  if (!S.chatOpen) return;
  const el = $('#chatList');
  const near = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  const html = S.chat.msgs.map((m) => {
    const mine = m.n === S.me;
    const acts = (S.me && !mine && !m.adm && !m.del ? `<button class="act" data-report="${m.id}" title="通報">🚩</button>` : '') +
      (S.admin && !m.del ? `<button class="act" data-del="${m.id}" title="削除">🗑</button>` : '');
    return `<div class="msg ${mine ? 'mine' : ''} ${m.adm ? 'adm' : ''} ${m.del ? 'del' : ''}"><div class="hd">
      ${m.adm ? '📢' : `<span class="dot ${isOn(m.n) ? 'on' : ''}"></span>`}<b>${esc(m.n)}</b><time>${hhmm(m.ts)}</time>${S.admin && m.rc ? `<span class="tag">🚩${m.rc}</span>` : ''}${acts}</div>
      <div class="tx">${m.del ? '（運営により削除されました）' : esc(m.t)}</div></div>`;
  }).join('') || '<div class="empty-note">まだメッセージはありません。最初の一言をどうぞ！</div>';
  if (setHTML(el, html) && (near || S.justOpened)) { el.scrollTop = el.scrollHeight; S.justOpened = false; }
}
function openChat() {
  S.chatOpen = true; S.unread = 0; S.justOpened = true;
  S.seenChat = S.chat.msgs.reduce((m, x) => Math.max(m, x.id), 0);
  $('#chat').hidden = false; $('#chatFab').hidden = true; $('#chatList')._h = null;
  renderChat(); const el = $('#chatList'); el.scrollTop = el.scrollHeight;
  if (S.me && window.innerWidth > 700) $('#chatInput').focus();
}
function closeChat() { S.chatOpen = false; $('#chat').hidden = true; $('#chatFab').hidden = !S.inApp; }
async function sendChat(text) {
  if (!S.me) { toast('ログインするとチャットに参加できます', 'err'); return; }
  try { await api('chat', { ...auth(), text }); S.justOpened = true; await doSync(false); }
  catch (e) { toast(e.message, 'err'); if (e.code === 'session') forceLogout(e.message); }
}

/* ================= 管理画面 ================= */
function adminErr(e) {
  if (e && e.code === 'admin') { S.admin = null; try { sessionStorage.removeItem('bp_admin'); } catch {} toast('管理者認証の有効期限が切れました', 'err'); renderAdmin(); }
}
function openAdmin() { S.adminOpen = true; $('#admin').hidden = false; document.body.style.overflow = 'hidden'; S.lastRep = 0; $('#adminBody')._h = null; renderAdmin(); }
function closeAdmin() { S.adminOpen = false; $('#admin').hidden = true; if (!S.bv) document.body.style.overflow = ''; }
const ad = (op, args = {}, confirmMsg = '') => `data-aop="${op}" data-aargs="${esc(JSON.stringify(args))}" ${confirmMsg ? `data-confirm="${esc(confirmMsg)}"` : ''}`;
async function adminCall(op, args) {
  try { await api('admin', { adminToken: S.admin, op, ...args }); await doSync(false); toast('実行しました', 'ok'); S.lastRep = 0; }
  catch (e) { adminErr(e); if (e.code !== 'admin') toast(e.message, 'err'); }
}
function resultText() {
  const g = S.game, N = g.cells.length;
  const rows = S.names.filter((n) => !isTest(n)).map((n) => ({ n, p: g.players[n], cells: g.cells.filter((c) => c.o === n).map((c) => '#' + c.n) }));
  rows.sort((a, b) => b.p.w - a.p.w || (b.p.b ? b.p.w / b.p.b : -1) - (a.p.b ? a.p.w / a.p.b : -1) || b.cells.length - a.cells.length || a.n.localeCompare(b.n));
  const st = g.event.status === 'running' ? '開催中' : g.event.status === 'ended' ? '終了' : '開始前';
  return [`【ブロパス配布 第1回 陣取り争奪戦 結果】`, `状態: ${st} ／ 陣地確保 ${g.cells.filter((c) => c.o).length}/${N}マス`, '', '■ ランキング（勝利数順）',
    ...rows.map((r, i) => `${i + 1}. ${r.n}  ${r.p.w}勝${r.p.l}敗  陣地: ${r.cells.join(' ') || 'なし'}`), '', '■ マス一覧',
    ...g.cells.map((c) => `#${c.n} ${c.o || '（空き）'}`)].join('\n');
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); }
  catch { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); document.execCommand('copy'); a.remove(); }
  toast('結果をコピーしました', 'ok');
}
async function adminEnterAs(name) {
  closeAdmin();
  if (S.me) { try { await api('logout', auth()); } catch {} S.me = null; S.token = null; S.storedMe = null; try { localStorage.removeItem('bp_me'); localStorage.removeItem('bp_token'); } catch {} }
  doLogin(name);
}
function renderAdmin() {
  const body = $('#adminBody');
  if (!S.admin) {
    setHTML(body, `<div style="display:flex;justify-content:space-between;align-items:center"><h3 class="h2" style="margin:0">🔒 運営ログイン</h3><button class="icon-btn" data-act="aclose">✕</button></div>
      <p style="font-size:.85rem">管理者パスワードを入力してください。</p>
      <input id="adminPw" class="input" type="password" placeholder="管理者パスワード" autocomplete="current-password">
      <div class="row" style="display:flex;margin-top:12px"><button class="btn blue wide" data-act="adminLogin">ログイン</button></div>`);
    return;
  }
  if (document.activeElement && document.activeElement.matches && document.activeElement.matches('#adminBody input')) return;
  const g = S.game, tabs = [['overview', '概要'], ['players', '参加者'], ['battles', '争奪戦・結果'], ['chat', 'チャット']];
  let c = '';
  if (S.adminTab === 'overview') {
    const owned = g.cells.filter((x) => x.o).length;
    c = `<div class="card" style="padding:12px"><div class="stat-line"><span>状態</span><b>${g.event.status === 'running' ? '開催中' : g.event.status === 'ended' ? '終了' : '開始前'}</b></div>
      <div class="stat-line"><span>確保済み / 争奪中</span><b>${owned} / ${g.cells.filter((x) => x.b).length}（全${g.cells.length}マス）</b></div>
      <div class="stat-line"><span>オンライン</span><b>${realNames().filter(isOn).length}/${realNames().length}人（テスト${S.names.filter(isTest).length}人別）</b></div>
      <div class="stat-line"><span>停止中のアカウント</span><b>${S.names.filter((n) => g.players[n].banned).length}人</b></div>
      <div class="stat-line"><span>対戦結果</span><b>${g.history.length}件（直近）</b></div></div>
      <div class="sec-title">イベント操作</div><div class="btn-row">
      <button class="btn green" ${ad('event', { status: 'running' })}>▶ イベント開始/再開</button>
      <button class="btn red" ${ad('event', { status: 'ended' }, 'イベントを終了しますか？（新規の確保・挑戦ができなくなります）')}>■ イベント終了</button>
      <button class="btn ghost" ${ad('event', { status: 'ready' })}>↩ 開始前に戻す</button></div>
      <div class="sec-title">リセット</div><div class="btn-row">
      <button class="btn ghost" ${ad('resetCells', {}, '全マスの所有権と進行中の争奪戦をリセットします。よろしいですか？')}>的（マス）をリセット</button>
      <button class="btn red" ${ad('resetAll', {}, '全マス・全戦績・対戦結果をリセットし、開始前に戻します。本当によろしいですか？')}>すべて初期化</button></div>
      <div class="sec-title">🕊 対戦モード</div><div class="btn-row">
      <button class="btn ${noBattle() ? 'ghost' : 'green'}" ${ad('setRules', { battle: true })}>⚔ 対戦あり（通常）</button>
      <button class="btn ${noBattle() ? 'purple' : 'ghost'}" ${ad('setRules', { battle: false })}>🕊 対戦なし（位置選択のみ）</button></div>
      <small style="opacity:.8">現在: <b>${noBattle() ? '対戦なし' : '対戦あり'}</b>。対戦なし中も、空きマスの確保・移動はできます。すでに始まっている対戦は続行されます。</small>
      <div class="sec-title">⏱ 自動終了タイマー</div><div class="btn-row">
      ${[10, 30, 60].map((m) => `<button class="btn small ghost" ${ad('setTimer', { minutes: m })}>${m}分後に終了</button>`).join('')}
      <button class="btn small ghost" data-act="adminTimerCustom">分数を指定…</button>
      <button class="btn small ghost" ${ad('setTimer', { minutes: 0 })}>解除</button></div>
      <small style="opacity:.8">現在: <b>${g.event.endsAt ? new Date(g.event.endsAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' に自動終了' : '設定なし'}</b>（開催中のみ有効。参加者の画面に残り時間が出ます）</small>
      <div class="sec-title">📢 お知らせ（全員の画面に固定表示）</div>
      <form id="adminNoticeForm" style="display:flex;gap:8px;flex-wrap:wrap"><input class="input" id="adminNoticeText" maxlength="120" placeholder="例：19時から対戦開始！" value="${esc(g.notice || '')}" style="flex:1;min-width:200px"><button class="btn small blue" type="submit">表示する</button><button class="btn small ghost" type="button" ${ad('setNotice', { text: '' })}>消す</button></form>
      <div class="sec-title">📋 結果</div><div class="btn-row"><button class="btn small ghost" data-act="adminCopy">結果をテキストでコピー</button></div>`;
  } else if (S.adminTab === 'players') {
    const nTest = S.names.filter(isTest).length;
    c = `<div class="card" style="padding:12px;margin-bottom:12px"><div class="sec-title" style="margin-top:0">🧪 テスト参加者を作る（${nTest}人）</div>
      <form id="adminTestForm" style="display:flex;gap:8px;flex-wrap:wrap"><input class="input" id="adminTestName" maxlength="24" placeholder="名前（空欄なら「テスト1」のように自動で付けます）" style="flex:1;min-width:200px"><button class="btn small blue" type="submit">＋ 追加</button></form>
      <div class="btn-row"><button class="btn small ghost" ${ad('addTest', { count: 1 })}>＋ 自動で1人</button><button class="btn small ghost" ${ad('addTest', { count: 5 }, 'テスト参加者を5人まとめて作成しますか？')}>＋ 自動で5人</button></div>
      <small style="opacity:.8">作ったテスト参加者はログイン画面の一覧に出ます。下の「このアカウントで参加」から操作でき、いらなくなったら「削除」できます。ランキング以外の全体集計には含まれません。</small></div>` + S.names.map((n) => {
      const p = g.players[n], st = statusOf(n), cells = g.cells.filter((x) => x.o === n);
      return `<div class="a-row ${p.banned ? 'banned' : ''}"><span class="dot ${st.on ? 'on' : ''}"></span><div class="grow"><b>${esc(n)}</b> ${testTag(n)}<br><small>${st.label}・陣地 ${cells.map((x) => '#' + x.n).join(' ') || 'なし'}・${p.w}勝${p.l}敗・最終${lastSeen(n)}</small></div>
        ${p.banned ? `<button class="btn small green" ${ad('unban', { name: n })}>停止解除</button>` : `<button class="btn small red" ${ad('ban', { name: n }, n + ' を停止しますか？（陣地は解放され、対戦は取り消されます）')}>停止</button>`}
        ${p.banned ? '' : `<button class="btn small ghost" data-act="adminSetOwner" data-name="${esc(n)}">マス指定</button>`}
        ${isTest(n) && !p.banned ? `<button class="btn small blue" data-act="adminEnterAs" data-name="${esc(n)}">このアカウントで参加</button>` : ''}
        ${isTest(n) ? `<button class="btn small red" ${ad('removeTest', { name: n }, n + ' を削除しますか？（陣地・戦績も消えます）')}>削除</button>` : ''}
        <button class="btn small ghost" ${ad('kick', { name: n }, n + ' を強制ログアウトしますか？')}>強制ログアウト</button>
        ${cells.map((x) => `<button class="btn small ghost" ${ad('releaseCell', { cell: x.n }, 'マス#' + x.n + ' を解放しますか？')}>#${x.n}解放</button>`).join('')}</div>`;
    }).join('');
  } else if (S.adminTab === 'battles') {
    c = '<div class="sec-title">進行中</div>' + (g.battles.map((b) => `<div class="a-row"><div class="grow"><b>マス#${b.cell}</b> ${esc(b.c)} vs ${esc(b.d)}<br><small>${b.state === 'pending' ? '準備待ち' : '進行中'}・ROUND ${b.round}</small></div>
      <button class="btn small ghost" ${ad('resolveBattle', { id: b.id, winner: b.c }, esc(b.c) + ' の勝ちにしますか？')}>${esc(b.c)}の勝ち</button>
      <button class="btn small ghost" ${ad('resolveBattle', { id: b.id, winner: b.d }, esc(b.d) + ' の勝ちにしますか？')}>${esc(b.d)}の勝ち</button>
      <button class="btn small red" ${ad('cancelBattle', { id: b.id }, 'この争奪戦を取り消しますか？')}>取消</button></div>`).join('') || '<div class="empty-note">なし</div>') +
      '<div class="sec-title">対戦結果</div>' + (g.history.map((b) => `<div class="a-row"><div class="grow"><b>マス#${b.cell}</b> 🏆${esc(b.winner)} （${esc(b.c)} vs ${esc(b.d)}）<br><small>${b.reason}・${b.rec && b.rec[b.c] ? `${esc(b.c)} ${b.rec[b.c].pos}% / ${esc(b.d)} ${b.rec[b.d] ? b.rec[b.d].pos : '-'}%` : '記録なし'}・${hhmm(b.doneAt)}</small></div></div>`).join('') || '<div class="empty-note">まだありません</div>');
  } else {
    c = `<form id="adminPost" style="display:flex;gap:8px;margin-bottom:10px"><input class="input" id="adminPostText" maxlength="200" placeholder="運営からのお知らせを送信"><button class="btn small blue" type="submit">送信</button></form>
      <div class="sec-title">🚩 通報されたメッセージ</div>` +
      (S.reports.map((r) => `<div class="a-row"><div class="grow"><b>${esc(r.n)}</b> <small>${hhmm(r.ts)}・通報${r.rep.length}件（${esc(r.rep.join(', '))}）</small><br>${esc(r.t)}</div><button class="btn small red" ${ad('chatDelete', { id: r.id })}>削除</button></div>`).join('') || '<div class="empty-note">通報はありません</div>') +
      '<div class="sec-title">最近のメッセージ</div>' +
      S.chat.msgs.slice(-30).reverse().map((m) => `<div class="a-row"><div class="grow"><b>${esc(m.n)}</b> <small>${hhmm(m.ts)}</small><br>${m.del ? '（削除済み）' : esc(m.t)}</div>${m.del ? '' : `<button class="btn small red" ${ad('chatDelete', { id: m.id })}>削除</button>`}</div>`).join('') +
      `<div class="btn-row"><button class="btn small ghost" ${ad('chatClear', {}, 'チャットを全削除しますか？')}>チャット全削除</button></div>`;
  }
  setHTML(body, `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3 class="h2" style="margin:0">🛠 運営管理画面</h3>
    <div style="display:flex;gap:8px"><button class="btn small ghost" data-act="adminLogout">ログアウト</button><button class="icon-btn" data-act="aclose">✕</button></div></div>
    <div class="admin-tabs">${tabs.map(([k, l]) => `<button data-atab="${k}" class="${S.adminTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>${c}`);
}

/* ================= イベント登録 ================= */
function bind() {
  $('#search').addEventListener('input', (e) => { S.search = e.target.value; renderLogin(); });
  $('#loginList').addEventListener('click', (e) => { const b = e.target.closest('[data-name]'); if (b && !b.disabled) confirmLogin(b.dataset.name); });
  $('#btnSpectate').addEventListener('click', () => { S.me = null; enterApp(); });
  $('#btnLogout').addEventListener('click', () => { if (S.me && !confirm('ログアウトしますか？')) return; logout(); });
  $('#board').addEventListener('click', (e) => { const c = e.target.closest('[data-cell]'); if (c) openCell(+c.dataset.cell); });
  for (const id of ['#adminLink1', '#adminLink2']) $(id).addEventListener('click', (e) => { e.preventDefault(); openAdmin(); });
  $('#bottomNav').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (!b) return; S.tab = b.dataset.tab; if (S.tab !== 'board') S.side = S.tab; renderHeader(); scrollTo({ top: 0 }); });
  $('#sideTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-pane]'); if (b) { S.side = b.dataset.pane; renderHeader(); } });
  $('#paneLive').addEventListener('click', (e) => { const b = e.target.closest('[data-act="watch"]'); if (b) openBattle(+b.dataset.id); });
  $('#banner').addEventListener('click', (e) => { const b = e.target.closest('[data-act="openMine"]'); if (b) openBattle(+b.dataset.id); });
  $('#chatFab').addEventListener('click', openChat);
  $('#btnChatTop').addEventListener('click', () => (S.chatOpen ? closeChat() : openChat()));
  $('#chatClose').addEventListener('click', closeChat);
  $('#chatForm').addEventListener('submit', (e) => { e.preventDefault(); const i = $('#chatInput'), t = i.value.trim(); if (!t) return; i.value = ''; sendChat(t); });
  $('#chatList').addEventListener('click', async (e) => {
    const r = e.target.closest('[data-report]'), d = e.target.closest('[data-del]');
    if (r && confirm('このメッセージを運営に通報しますか？')) { try { await api('report', { ...auth(), id: +r.dataset.report }); toast('通報しました。ご協力ありがとうございます', 'ok'); doSync(false); } catch (er) { toast(er.message, 'err'); } }
    if (d && S.admin) adminCall('chatDelete', { id: +d.dataset.del });
  });
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  $('#modalBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act;
    if (a === 'loginOK') doLogin(b.dataset.name);
    else if (a === 'loginBack' || a === 'mclose') closeModal();
    else if (a === 'claim') confirmClaim(+b.dataset.n);
    else if (a === 'claimOK') claim(+b.dataset.n);
    else if (a === 'watch') openBattle(+b.dataset.id);
    else if (a === 'toLogin') { closeModal(); leaveApp(); }
  });
  $('#battleBody').addEventListener('pointerdown', (e) => { if (e.target.closest('#bt-stop')) { e.preventDefault(); doStop(); } });
  $('#battleBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    if (b.dataset.act === 'bclose') closeBattle(); else battleAction(b.dataset.act);
  });
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && S.bv && !e.target.matches('input,textarea')) { const st = $('#bt-stop'); if (st) { e.preventDefault(); if (!st.disabled) doStop(); } }
    if (e.key === 'Escape') { if (!$('#modal').hidden) closeModal(); }
  });
  $('#adminBody').addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]'), op = e.target.closest('[data-aop]'), tb = e.target.closest('[data-atab]');
    if (tb) { S.adminTab = tb.dataset.atab; $('#adminBody')._h = null; renderAdmin(); return; }
    if (op) { if (op.dataset.confirm && !confirm(op.dataset.confirm)) return; adminCall(op.dataset.aop, JSON.parse(op.dataset.aargs || '{}')); return; }
    if (!a) return;
    if (a.dataset.act === 'aclose') closeAdmin();
    else if (a.dataset.act === 'adminEnterAs') adminEnterAs(a.dataset.name);
    else if (a.dataset.act === 'adminCopy') copyText(resultText());
    else if (a.dataset.act === 'adminTimerCustom') { const v = prompt('何分後に自動終了しますか？（1〜1440）'); const m = Number(v); if (v !== null && m > 0) adminCall('setTimer', { minutes: m }); }
    else if (a.dataset.act === 'adminSetOwner') { const N = S.game.cells.length, v = prompt(`${a.dataset.name} を置くマス番号（1〜${N}）\n※元の陣地は空きになります`); const n = Number(v); if (v !== null && Number.isInteger(n) && n >= 1 && n <= N) adminCall('setOwner', { name: a.dataset.name, cell: n }); }
    else if (a.dataset.act === 'adminLogout') { S.admin = null; try { sessionStorage.removeItem('bp_admin'); } catch {} renderAdmin(); }
    else if (a.dataset.act === 'adminLogin') {
      const pw = $('#adminPw').value; a.disabled = true;
      try { const d = await api('adminLogin', { password: pw }); S.admin = d.adminToken; try { sessionStorage.setItem('bp_admin', S.admin); } catch {} $('#adminBody')._h = null; renderAdmin(); }
      catch (er) { toast(er.message, 'err'); }
      a.disabled = false;
    }
  });
  $('#adminBody').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'adminPw') $('[data-act="adminLogin"]').click(); });
  $('#adminBody').addEventListener('submit', (e) => {
    if (e.target.id === 'adminNoticeForm') {
      e.preventDefault(); const i = $('#adminNoticeText'), tx = i.value.trim(); i.blur();
      adminCall('setNotice', { text: tx }); return;
    }
    if (e.target.id === 'adminTestForm') {
      e.preventDefault(); const i = $('#adminTestName'), nm = i.value.trim(); i.value = ''; i.blur();
      adminCall('addTest', nm ? { name: nm } : { count: 1 }); return;
    }
    if (e.target.id !== 'adminPost') return; e.preventDefault();
    const i = $('#adminPostText'), t = i.value.trim(); if (!t) return; i.value = ''; adminCall('chatPost', { text: t });
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.game) doSync(false).catch(() => {}); });
}

async function boot() {
  bind();
  $('#loginList').innerHTML = '<div class="empty-note">読み込み中…</div>';
  try { await doSync(false); } catch (e) { toast(e.message, 'err'); }
  if (S.storedMe && S.token) {
    try {
      const d = await api('login', { name: S.storedMe, token: S.token });
      S.me = S.storedMe; S.token = d.token; S.lastPing = Date.now(); enterApp();
    } catch (e) {
      if (e.code !== 'net') { try { localStorage.removeItem('bp_me'); localStorage.removeItem('bp_token'); } catch {} S.storedMe = null; S.token = null; }
    }
  }
  render();
  setInterval(() => { if (S.game && S.inApp) $('#eventPill').textContent = pillText(); }, 1000);
  setTimeout(loop, 1500);
}
boot();
})();
