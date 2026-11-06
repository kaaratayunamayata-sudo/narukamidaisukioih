/* 演出モジュール（効果音・パーティクル・流れるチャット・設定）。
   ゲームの勝敗には一切関わらず、見た目と音だけを担当します。 */
(() => {
'use strict';
const KEY = 'bp_fx';
const $ = (s) => document.querySelector(s);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* ---------- 設定 ---------- */
const cfg = { sound: true, fx: true, float: true, vibe: true };
let saved = null;
try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
if (saved) Object.assign(cfg, saved);
else if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) cfg.fx = false;
function applyBody() { document.body.classList.toggle('fx-off', !cfg.fx); }
function set(k, v) {
  cfg[k] = !!v;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch {}
  applyBody();
  if (k === 'sound' && v) { unlock(); SND.pop(); }
}

/* ---------- 効果音（WebAudioで合成。音声ファイル不要） ---------- */
let ac = null, master = null;
function unlock() {
  try {
    if (!ac) {
      const A = window.AudioContext || window.webkitAudioContext;
      if (!A) return;
      ac = new A(); master = ac.createGain(); master.gain.value = 0.5; master.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
  } catch {}
}
['pointerdown', 'touchend', 'keydown'].forEach((e) => addEventListener(e, unlock, { passive: true }));
function tone(f, d = 0.15, type = 'sine', vol = 0.3, delay = 0, slideTo) {
  if (!cfg.sound || !ac) return;
  const t = ac.currentTime + delay;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + d);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + d + 0.05);
}
const N = { C4: 261.63, E4: 329.63, G4: 392, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5 };
const SND = {
  tap() { tone(660, 0.06, 'triangle', 0.16); },
  pop() { tone(400, 0.12, 'sine', 0.25, 0, 900); },
  claim() { [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone(f, 0.14, 'triangle', 0.25, i * 0.07)); },
  alarm() { [0, 0.18, 0.36].forEach((d) => tone(880, 0.14, 'square', 0.16, d)); tone(440, 0.22, 'square', 0.14, 0.54); },
  tick() { tone(880, 0.09, 'square', 0.18); },
  go() { tone(1320, 0.35, 'square', 0.22); tone(1760, 0.35, 'triangle', 0.18, 0.05); },
  stop() { tone(180, 0.2, 'sawtooth', 0.32, 0, 60); tone(900, 0.06, 'square', 0.15); },
  win() { [N.C5, N.E5, N.G5, N.C6, N.G5, N.C6, N.E6].forEach((f, i) => tone(f, 0.22, 'triangle', 0.3, i * 0.11)); },
  lose() { [N.G4, N.E4, N.C4].forEach((f, i) => tone(f, 0.32, 'sine', 0.28, i * 0.2, f * 0.9)); },
  chat() { tone(900, 0.07, 'sine', 0.13); tone(1200, 0.09, 'sine', 0.1, 0.07); },
  start() { [N.C5, N.G5, N.C6, N.E6, N.C6, N.E6, N.G5, N.C6].forEach((f, i) => tone(f, 0.2, 'square', 0.15, i * 0.1)); },
  end() { [N.E6, N.C6, N.G5, N.E5, N.C5].forEach((f, i) => tone(f, 0.28, 'triangle', 0.26, i * 0.14)); },
  warn() { tone(300, 0.25, 'sawtooth', 0.22); tone(220, 0.35, 'sawtooth', 0.22, 0.22); },
  drum() { for (let i = 0; i < 16; i++) tone(i % 2 ? 130 : 105, 0.08, 'triangle', 0.24, i * 0.07, 55); },
  fanfare() {
    [[N.C5, 0], [N.C5, 0.13], [N.C5, 0.26], [N.G5, 0.4], [N.E5, 0.62], [N.G5, 0.76], [N.C6, 1.0]].forEach(([f, d]) => tone(f, 0.3, 'square', 0.18, d));
    tone(N.C6, 0.9, 'triangle', 0.28, 1.0); tone(N.E6, 0.9, 'triangle', 0.18, 1.0);
  },
  fw() { tone(220, 0.35, 'sawtooth', 0.14, 0, 40); tone(1500, 0.12, 'sine', 0.1, 0.05, 300); },
};
const sfx = (n) => { try { if (SND[n]) SND[n](); } catch {} };
const vibe = (p) => { if (cfg.vibe && navigator.vibrate) { try { navigator.vibrate(p); } catch {} } };

/* ---------- パーティクル（canvas） ---------- */
const COLORS = ['#ffc21a', '#ff4d6d', '#3a86ff', '#2fbf71', '#8e44ec', '#ff8a1f', '#ec4fa8', '#19b5a5'];
let cv = null, cx = null, W = 0, H = 0, parts = [], raf = 0, last = 0;
const maxP = () => ((navigator.hardwareConcurrency || 4) <= 4 ? 170 : 340);
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function ensure() {
  if (cv) return;
  cv = document.createElement('canvas'); cv.id = 'fxCanvas'; document.body.appendChild(cv);
  cx = cv.getContext('2d'); resize(); addEventListener('resize', resize);
}
function add(p) { if (parts.length < maxP()) parts.push(p); }
function frame(now) {
  const dt = Math.min(2.5, (now - last) / 16.7 || 1); last = now;
  cx.clearRect(0, 0, W, H);
  parts = parts.filter((p) => p.life > 0 && p.y < H + 60);
  for (const p of parts) {
    p.life -= dt; p.vy += p.g * dt;
    const dr = Math.pow(p.drag, dt); p.vx *= dr; p.vy *= dr;
    p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    cx.save(); cx.globalAlpha = Math.max(0, Math.min(1, p.life / 25));
    cx.translate(p.x, p.y); cx.rotate(p.rot);
    if (p.emoji) { cx.font = p.size + 'px serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(p.emoji, 0, 0); }
    else if (p.shape === 'c') { cx.fillStyle = p.color; cx.beginPath(); cx.arc(0, 0, p.size / 2, 0, 6.3); cx.fill(); }
    else { cx.fillStyle = p.color; cx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); }
    cx.restore();
  }
  if (parts.length) raf = requestAnimationFrame(frame); else { raf = 0; cx.clearRect(0, 0, W, H); }
}
function kick() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
const scale = (n) => Math.round(n * ((navigator.hardwareConcurrency || 4) <= 4 ? 0.6 : 1));

function confetti(x, y, n = 60, spread = Math.PI * 2, power = 9) {
  if (!cfg.fx) return; ensure();
  for (let i = 0; i < scale(n); i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * spread, v = power * (0.4 + Math.random());
    add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 0.28, drag: 0.985, rot: rnd(0, 6), vr: rnd(-0.3, 0.3), size: rnd(6, 13), color: pick(COLORS), shape: Math.random() < 0.3 ? 'c' : 'r', life: rnd(90, 150) });
  }
  kick();
}
function burst(x, y, color, n = 40) {
  if (!cfg.fx) return; ensure();
  for (let i = 0; i < scale(n); i++) {
    const a = rnd(0, 6.283), v = rnd(2, 8);
    add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 0.12, drag: 0.96, rot: 0, vr: 0, size: rnd(3, 7), color: color || pick(COLORS), shape: 'c', life: rnd(40, 75) });
  }
  kick();
}
function rain(emoji, n = 24) {
  if (!cfg.fx) return; ensure();
  for (let i = 0; i < scale(n); i++) {
    add({ x: rnd(0, W), y: rnd(-120, -10), vx: rnd(-0.6, 0.6), vy: rnd(2, 5), g: 0.02, drag: 1, rot: 0, vr: rnd(-0.05, 0.05), size: rnd(24, 40), emoji, life: 400 });
  }
  kick();
}
function fireworks(times = 5) {
  if (!cfg.fx) { sfx('fw'); return; }
  for (let i = 0; i < times; i++) {
    setTimeout(() => {
      ensure(); const x = W * rnd(0.15, 0.85), y = H * rnd(0.15, 0.5);
      burst(x, y, pick(COLORS), 55); burst(x, y, pick(COLORS), 25); sfx('fw'); vibe(15);
    }, i * 330);
  }
}
function shock(x, y, color) {
  if (!cfg.fx) return;
  const r = document.createElement('div'); r.className = 'fx-ring';
  r.style.left = x + 'px'; r.style.top = y + 'px'; r.style.setProperty('--c', color || '#fff');
  document.body.appendChild(r); setTimeout(() => r.remove(), 750);
}
function flash(color) {
  if (!cfg.fx) return;
  const f = document.createElement('div'); f.className = 'fx-flash'; f.style.setProperty('--c', color || '#fff');
  document.body.appendChild(f); setTimeout(() => f.remove(), 400);
}
function shake(el, ms = 420) {
  if (!cfg.fx || !el) return;
  el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); setTimeout(() => el.classList.remove('shake'), ms);
}
function banner(html, ms = 2600) {
  const b = document.createElement('div'); b.className = 'fx-banner' + (cfg.fx ? '' : ' plain');
  b.innerHTML = '<div class="fx-bn-in">' + html + '</div>';
  b.addEventListener('click', () => b.remove());
  document.body.appendChild(b); setTimeout(() => b.remove(), ms);
}
function cellFx(el, mine) {
  const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  const color = getComputedStyle(el).getPropertyValue('--c').trim() || '#ffc21a';
  shock(x, y, mine ? '#ffc21a' : color); burst(x, y, color, mine ? 36 : 18);
  if (mine) { confetti(x, y, 50, Math.PI * 1.4, 8); sfx('claim'); vibe(30); }
}
function win(big) {
  if (!cfg.fx) { sfx('win'); return; }
  ensure(); confetti(W / 2, H * 0.55, big ? 130 : 60, Math.PI * 1.2, 13);
  if (big) { confetti(W * 0.2, H * 0.7, 60, 1.2, 11); confetti(W * 0.8, H * 0.7, 60, 1.2, 11); fireworks(4); }
  sfx('win'); vibe([60, 40, 60, 40, 120]);
}
function lose() { rain('💧', 14); sfx('lose'); vibe(200); }
function play(type) {
  if (type === 'fireworks') { fireworks(8); sfx('start'); }
  else if (type === 'confetti') { ensure(); [0.2, 0.5, 0.8].forEach((k, i) => setTimeout(() => confetti(W * k, H * 0.7, 70, 1.5, 12), i * 250)); sfx('win'); }
  else if (type === 'meat') { rain('🥩', 40); sfx('pop'); }
  else if (type === 'stars') { rain('⭐', 40); sfx('claim'); }
}

/* ---------- 当選者発表の特別演出 ----------
   ルーレットで名前が高速で入れ替わり → だんだん遅くなって → 当選者が確定（花火・紙吹雪・ファンファーレ）。
   quick=true は途中参加の人向け（ルーレット省略）。画面タップでスキップ可。 */
function drawShow(winner, names, opts = {}) {
  const { quick = false, onDone } = opts;
  const old = $('#drawStage'); if (old) old.remove();
  const el = document.createElement('div');
  el.id = 'drawStage'; el.className = 'draw-stage' + (cfg.fx ? '' : ' plain');
  el.innerHTML = '<div class="ds-in"><div class="ds-title">WINNER ANNOUNCEMENT</div><div class="ds-lead">当選者を発表します！</div>' +
    '<div class="ds-slot"><span>？？？</span></div><div class="ds-sub"></div><button type="button" class="btn big ds-next" hidden>つづきを見る ▶</button></div>';
  document.body.appendChild(el);
  const slot = el.querySelector('.ds-slot span'), lead = el.querySelector('.ds-lead'), nx = el.querySelector('.ds-next');
  const timers = []; let closed = false, revealed = false;
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const close = () => { if (closed) return; closed = true; timers.forEach(clearTimeout); el.remove(); if (onDone) onDone(); };
  const reveal = () => {
    if (revealed || closed) return; revealed = true; timers.forEach(clearTimeout);
    slot.textContent = winner; el.classList.add('reveal'); lead.textContent = '🎉 おめでとうございます！ 🎉';
    sfx('fanfare'); vibe([80, 40, 80, 40, 200]);
    if (cfg.fx) {
      flash('#ffffff');
      const w = window.innerWidth, h = window.innerHeight;
      confetti(w / 2, h * 0.5, quick ? 70 : 150, Math.PI * 1.3, 13);
      if (!quick) { confetti(w * 0.15, h * 0.75, 60, 1.2, 11); confetti(w * 0.85, h * 0.75, 60, 1.2, 11); }
      fireworks(quick ? 3 : 8);
    }
    later(() => { nx.hidden = false; }, quick ? 300 : 1600);
  };
  nx.addEventListener('click', (e) => { e.stopPropagation(); close(); });
  el.addEventListener('click', () => { if (!revealed) reveal(); }); // ルーレット中のタップ = スキップ
  if (quick || !cfg.fx) { later(reveal, 200); return { close }; }
  const pool = (names || []).filter((n) => n !== winner); if (!pool.length) pool.push('…');
  const steps = 28; let at = 400, prev = '';
  sfx('drum');
  for (let i = 0; i < steps; i++) {
    const d = 70 + Math.pow(i / steps, 2) * 420; at += d;
    later(() => { let n; do { n = pick(pool); } while (n === prev && pool.length > 1); prev = n; slot.textContent = n; slot.classList.remove('tick'); void slot.offsetWidth; slot.classList.add('tick'); sfx('tick'); vibe(8); }, at);
  }
  later(() => { slot.textContent = '…'; lead.textContent = '当選者は……'; }, at + 500);
  later(reveal, at + 1500);
  return { close };
}

/* ---------- 流れるチャット ---------- */
let lane = 0;
function floatMsg(m) {
  if (!cfg.float) return;
  const root = $('#floaty'); if (!root || root.children.length > 16) return;
  const emo = /^(?:[\p{Extended_Pictographic}\u200d\ufe0f\s]){1,8}$/u.test(m.t);
  const el = document.createElement('div');
  el.className = 'fl' + (m.adm ? ' adm' : '') + (m.me ? ' me' : '') + (emo ? ' emo' : '');
  el.style.left = (4 + ((lane++ * 17 + rnd(0, 8)) % 70)) + '%';
  el.style.setProperty('--dur', rnd(9, 14).toFixed(1) + 's');
  el.style.setProperty('--sway', rnd(14, 34).toFixed(0) + 'px');
  const inn = document.createElement('div'); inn.className = 'in';
  if (!emo || m.adm) { const b = document.createElement('b'); b.textContent = (m.adm ? '📢 ' : '') + m.n; inn.appendChild(b); }
  const t = document.createElement('span'); t.textContent = m.t; inn.appendChild(t);
  el.appendChild(inn);
  el.addEventListener('animationend', (e) => { if (e.target === el) el.remove(); });
  root.appendChild(el);
}

/* ---------- 画面スリープ防止（スマホでオフライン扱いになるのを防ぐ） ---------- */
let wl = null, wantWake = false;
async function wake(on) {
  wantWake = on;
  try {
    if (on && 'wakeLock' in navigator && !wl) { wl = await navigator.wakeLock.request('screen'); wl.addEventListener('release', () => { wl = null; }); }
    else if (!on && wl) { await wl.release(); wl = null; }
  } catch {}
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && wantWake && !wl) wake(true); });

/* ---------- 背景の飾り / ボタンのさざ波 ---------- */
function initBg() {
  const bg = $('#bg'); if (!bg || bg.querySelector('.st')) return;
  const sym = ['✦', '★', '✧', '●', '✦'];
  const n = (navigator.hardwareConcurrency || 4) <= 4 ? 8 : 14;
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i'); s.className = 'st'; s.textContent = pick(sym);
    s.style.left = rnd(0, 100) + '%'; s.style.fontSize = rnd(12, 34) + 'px';
    s.style.animationDuration = rnd(16, 34) + 's'; s.style.animationDelay = -rnd(0, 30) + 's';
    s.style.color = pick(['#fff', '#fff6c2', '#ffd1dc', '#cfe3ff']);
    bg.appendChild(s);
  }
}
document.addEventListener('pointerdown', (e) => {
  const t = e.target.closest && e.target.closest('.btn:not(:disabled), .cell');
  if (!t || !cfg.fx) return;
  const r = t.getBoundingClientRect(), s = document.createElement('span'), d = Math.max(r.width, r.height) * 1.6;
  s.className = 'ripple'; s.style.width = s.style.height = d + 'px';
  s.style.left = (e.clientX - r.left - d / 2) + 'px'; s.style.top = (e.clientY - r.top - d / 2) + 'px';
  t.appendChild(s); setTimeout(() => s.remove(), 600);
}, { passive: true });

applyBody();
window.FX = { cfg, set, sfx, vibe, confetti, burst, rain, fireworks, shock, flash, shake, banner, cellFx, win, lose, play, drawShow, floatMsg, wake, initBg };
})();
