/* 仮想対戦ページ(画面)。エンジン・エフェクト・AIは battle-*.js。ページを最初に開いたとき app.js の openBattle が読み込んで、initBattle を呼ぶ */
window.initBattle = function () {
"use strict";
window.ROSTER = zukanToRoster({ characters: chars });
const { Battle, DEFAULT_RULES } = EigoBattle;
const ROSTER = window.ROSTER;
const BYID = new Map(ROSTER.map((c) => [c.id, c]));
const EFF_NAME = { atk_up: "攻撃UP", shield: "シールド", def_up: "防御UP", cover: "かばう", multi_attack: "連撃", all_attack: "全体攻撃",
  heal: "回復", revive: "蘇生", color_change: "色変", shorten: "短縮", delay: "遅延", regen: "継続回復" };
const STEP_NAME = { 1: "スキル", 3: "回答", 4: "スキル", 5: "属性変更", 6: "遅延", 8: "回復", 9: "攻撃強化", 10: "防御", 11: "攻撃", 12: "蘇生", 13: "ターン終了" };
const LEVELS = Object.keys(DEFAULT_RULES.level_mult);
const MODES = [["fast", "Excellent回答"], ["normal", "Correct回答"], ["late", "半誤答"], ["wrong", "完全誤答"]];
const MODE_LABEL = { ...Object.fromEntries(MODES), timeout: "完全誤答" };   // 以前の保存データの「時間切れ」は完全誤答と同じ
const PRIO = [["normal", "通常"], ["priority", "優先"], ["delay", "劣後"]];
const DECK_DEFAULT = 5;
const HAS_AI = !!window.EigoBrain;   // AIの操作(brain.js)が入っているときだけ、AIのボタンを出す
/* ランク点(ゲームの勝敗のルール。AIとは無関係): 完勝2/勝利1/引分0/敗北-1/完敗-2 */
const rankPointOf = (b, side) => { if (!b.finished) return 0; const w = b.result.winner, os = side === "A" ? "B" : "A"; if (w === "draw") return 0; if (w === side) return b.teams[side].players.every((p) => !p.ghost) ? 2 : 1; return b.teams[os].players.some((p) => p.ghost) ? -1 : -2; };
const RANK_NAME = { 2: "完勝", 1: "勝利", 0: "引き分け", "-1": "敗北", "-2": "完敗" };
const SHIBARI = [["全", null], ["火", ["火"]], ["水", ["水"]], ["風", ["風"]], ["火水", ["火", "水"]], ["水風", ["水", "風"]], ["火風", ["火", "風"]]];
const BANDS = [["低", 150, "〜150"], ["中", 220, "151〜220"], ["高", 350, "221〜350"], ["超高", 500, "351〜"]];
function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/* ---------- キャラ生成(縛りごとの実際の対戦記録に基づく) ----------
   データは web/decks.json だけ(英語物語 対戦tier の「○○入力」シート: 試合縛り入力・デッキ情報入力・デッキキャラ入力・補正入力)。補正(そのイベントで補正が付くキャラ)の枠は、使用率・組み合わせ・枠の傾向に数えない。
   縛り(全/火/水/風/…)と縛りコスト(低〜150・中〜220・高〜350・超高〜500。数字は上限)を選んで、全員のデッキを作る。どのデッキも、合計コストが縛りコストの上限を超えない。
   1体ずつ(枠1から)、その枠の使用率の中から選ぶ。候補 = その枠で実際に使われたキャラだけ(1枠でしか使われていないキャラは、他の枠には入らない)。
   重み = その枠での、その縛り・コスト帯の使用数(コスト帯が近い試合ほど重く) × exp(同じデッキの他のキャラとの組み合わせの強さ)。
   組み合わせの強さ = Σ log((同じデッキに入った回数 + m) ÷ (偶然の期待回数 + m))。人気キャラ同士は偶然でも一緒に出るので、その分を引く。
   上限を超えないのは、残りの枠を最も安いキャラで埋めても収まる候補だけを選ぶことで保証する(最後に合計を確かめ、超える場合は作り直す)。
   合計コストは、そのコスト帯の実際の試合のデッキ(上限のすぐ下まで使う)の分布に合うよう、最後の1体と、候補のデッキの選び方で整える。
   各値(h=20・α=1・m=0.5・β=1)は、学習に使っていない試合で「次のキャラ」を当てる確率が最も高くなる組み合わせ。 */
const GEN = (() => {
  const DK = window.DECKS, H = 20, ALPHA = 0, SYN_M = 0.5, SYN_BETA = 1.0, KS = 40, TB = 10, NT = 70;
  const N = DK.d.length, NA = new Map(), PN = new Map(), NK = [0, 1, 2, 3, 4].map(() => new Map()), decksOf = DK.sh.map(() => []), NS = DK.sh.map(() => 0);   // NK[k] = 枠kでのキャラ別の使用数(全体)
  const bandOf = (cap) => (cap <= BANDS[0][1] ? 0 : cap <= BANDS[1][1] ? 1 : cap <= BANDS[2][1] ? 2 : 3);
  const range = (b) => [b ? BANDS[b - 1][1] + 1 : 0, b < 3 ? BANDS[b][1] : 999];   // そのコスト帯に入る試合のコスト上限の範囲
  const realT = BANDS.map(() => new Array(NT).fill(0)), realN = BANDS.map(() => 0);
  const key = (a, b) => a * 4096 + b, tbin = (t) => Math.min(NT - 1, Math.max(0, Math.floor(t / TB)));
  for (const [mi, ids, xs] of DK.d) {
    const si = DK.m[mi][0], cap = DK.m[mi][1], bx = xs || [], keep = ids.filter((_, i) => !bx.includes(i)), u = [...new Set(keep)];   // 補正のキャラは数えない
    const at = []; ids.forEach((id, k) => { if (!bx.includes(k) && k < 5) at.push([k, id]); });   // 補正でない枠だけ: [枠, キャラ]
    decksOf[si].push([mi, keep, at]); NS[si]++;
    for (const id of u) NA.set(id, (NA.get(id) || 0) + 1);
    for (const [k, id] of at) NK[k].set(id, (NK[k].get(id) || 0) + 1);
    for (const a of u) for (const b of u) if (a !== b) PN.set(key(a, b), (PN.get(key(a, b)) || 0) + 1);
    if (ids.length === 5) { const b = bandOf(cap); realT[b][tbin(ids.reduce((a, id) => a + (BYID.get(id)?.cost || 0), 0))]++; realN[b]++; }   // 合計コストは、補正のキャラも含めた実際のデッキで見る
  }
  const syn = new Map();
  const synLog = (a, b) => { const k = key(a, b); let v = syn.get(k); if (v === undefined) { v = Math.log(((PN.get(k) || 0) + SYN_M) / ((NA.get(a) || 0) * (NA.get(b) || 0) / N + SYN_M)); syn.set(k, v); } return v; };
  const realP = (b, t) => (realT[b][tbin(t)] + 0.5) / (realN[b] + 0.5 * NT);
  const cache = new Map();
  function setFor(si, b) {
    const k = si * 4 + b; let e = cache.get(k); if (e) return e;
    const allow = SHIBARI[si][1], [lo, hi] = range(b), u = [0, 1, 2, 3, 4].map(() => new Map());   // u[k] = 枠kの使用数(その縛り・コスト帯)
    for (const [mi, , at] of decksOf[si]) {
      const c2 = DK.m[mi][1], d = c2 < lo ? lo - c2 : c2 > hi ? c2 - hi : 0, w = Math.exp(-d / H);
      for (const [k, id] of at) u[k].set(id, (u[k].get(id) || 0) + w);
    }
    for (let k = 0; k < 5; k++) for (const [id, n] of NK[k]) u[k].set(id, (u[k].get(id) || 0) + ALPHA * n / N * NS[si]);
    // 枠kの候補 = 実際に枠kで使われたことのあるキャラだけ(他の枠でしか使われていないキャラは、その枠には入らない)
    const cands = u.map((m) => ROSTER.filter((c) => c.cost > 0 && (m.get(c.id) || 0) > 0 && (!allow || c.attrs.some((a) => allow.includes(a)))));
    const mn = cands.map((cs) => cs.length ? Math.min(...cs.map((c) => c.cost)) : 1e9), rest = [0, 1, 2, 3, 4].map((k) => { let s = 0; for (let j = k + 1; j < 5; j++) s += mn[j]; return s; });   // rest[k] = 後ろの枠を最も安いキャラで埋めた合計
    e = { u, cands, rest }; cache.set(k, e); return e;
  }
  const pickW = (arr, w, rnd) => { let r = rnd() * w.reduce((a, b) => a + b, 0), i = 0; for (; i < arr.length - 1; i++) { r -= w[i]; if (r < 0) break; } return arr[i]; };
  function one(si, b, rnd, size) {
    const { u, cands, rest } = setFor(si, b), cap = BANDS[b][1], ids = []; let left = cap, legend = false;
    for (let k = 0; k < size; k++) {
      const ok = [], w = [];
      for (const c of cands[k]) {
        if (ids.includes(c.id) || (legend && c.r === "伝") || c.cost + rest[k] > left) continue;   // 後ろの枠を最も安いキャラで埋めても、上限に収まる候補だけ
        let x = u[k].get(c.id);   // 枠kでの使用数が重み
        if (ids.length) { let s = 0; for (const id of ids) s += synLog(id, c.id); x *= Math.exp(Math.max(-8, Math.min(8, SYN_BETA * s))); }
        if (k === size - 1) x *= realP(b, cap - left + c.cost);
        ok.push(c); w.push(x);
      }
      if (!ok.length) break;
      const pick = pickW(ok, w, rnd); ids.push(pick.id); left -= pick.cost; if (pick.r === "伝") legend = true;
    }
    return ids;
  }
  const total = (ids) => ids.reduce((a, id) => a + BYID.get(id).cost, 0);
  return {
    /* デッキ内の組み合わせの強さの平均(確認用) */
    strength(ids) { let s = 0, n = 0; for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { s += synLog(ids[i], ids[j]); n++; } return n ? s / n : 0; },
    /* 1人分のデッキ。合計コストは、必ず縛りコスト(BANDS[b][1])以下 */
    deck(si, b, rnd, size) {
      const cap = BANDS[b][1], cs = [];
      for (let i = 0; i < KS; i++) { const d = one(si, b, rnd, size); if (d.length === size && total(d) <= cap) cs.push(d); }
      if (!cs.length) { const d = one(si, b, rnd, size); return total(d) <= cap ? d : []; }
      const sl = cs.map(total), g = new Array(NT).fill(0.5);
      for (const t of sl) g[tbin(t)]++;
      const gt = cs.length + 0.5 * NT, d = pickW(cs, sl.map((t) => realP(b, t) / (g[tbin(t)] / gt)), rnd);
      return total(d) <= cap ? d : cs[0];
    },
  };
})();
function autoDecks(opt, setup, only) {
  const rnd = mulberry(Number(opt.seed) || 1), si = Math.max(0, SHIBARI.findIndex((x) => x[0] === opt.shibari)), b = Math.max(0, BANDS.findIndex((x) => x[0] === opt.band));
  let short = 0;
  for (const t of ["A", "B"]) for (const p of setup[t]) {
    if (only && !only(t, p)) continue;
    const ids = GEN.deck(si, b, rnd, DECK_DEFAULT);   // 合計コストは必ず縛りコスト(BANDS[b][1])以下
    if (ids.length < DECK_DEFAULT) short++;
    if (ids.length) p.deck = ids.map(specOf);
    padDeck(p);
  }
  return short;
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const $ = (s) => document.querySelector(s);
const clone = (o) => JSON.parse(JSON.stringify(o));
const n1 = (x) => Number(x).toLocaleString("ja-JP", { maximumFractionDigits: 1 });
const n2 = (x) => Number(x).toLocaleString("ja-JP", { maximumFractionDigits: 3 });

const S = {
  tab: "select", setup: null, rules: { count_step: 1, damage_rand: [0.9, 1.1], damage_rounding: "none", max_turns: 40, seed: 1 },
  auto: { shibari: "全", band: "高", seed: 1 },
  closed: new Set(), inputs: [], battle: null, draft: {}, picker: null, io: null, imgs: new Map(), openTurns: new Set(),
};

/* ---------- 画像 ---------- */
function imgSrc(id) { return S.imgs.get(id) || `https://englishstoryserver.com/Icon/Icon/Icon${id}.png`; }
/* キャラ画像は正方形のアイコン。属性は枠の色(複数属性は点)で示す */
function frameOf(attrs) {   // 枠の色の種類(2色は 右上=先の属性・左下=後の属性)
  const set = new Set(attrs || []), has = (x) => set.has(x);
  return set.size >= 3 ? "全" : set.size === 2 ? (has("火") && has("水") ? "火水" : has("水") && has("風") ? "水風" : "風火") : (attrs && attrs[0]) || "";
}
/* HPバー: 通常分(最大HPまで)と、最大HPを超えた分(回復で最大HPの2倍まで増える)の幅(%) */
function hpW(hp, mx) { mx = mx || 1; return [Math.max(0, Math.min(100, (hp / mx) * 100)), Math.max(0, Math.min(100, ((hp - mx) / mx) * 100))]; }
function hpBarHTML(hp, mx) { const [a, b] = hpW(hp, mx); return `<div class="hp" title="${n1(hp)} / ${n1(mx)}"><i style="width:${a}%"></i><b style="width:${b}%"></b></div>`; }
/* 実機 BasePartAllyController.RecoverGage / DamageGage(iTween.ScaleTo、合計1.0秒): 回復は通常分 → 超えた分、ダメージは超えた分 → 通常分の順に、
   HPの量に比例した時間で動かす(CalBaseHpHeelTime / CalExtraHpDamageTime) */
function setHpBar(el, hp, mx, anim = true) {
  if (!el) return false;
  const i = el.querySelector("i"), b = el.querySelector("b"); if (!i || !b) return false;
  const [na, nb] = hpW(hp, mx), oa = parseFloat(i.style.width) || 0, ob = parseFloat(b.style.width) || 0;
  el.title = `${n1(hp)} / ${n1(mx)}`;
  const da = Math.abs(na - oa), db = Math.abs(nb - ob), tot = da + db; if (tot < 1e-6) return false;
  if (!anim) { i.style.transition = b.style.transition = "none"; i.style.width = na + "%"; b.style.width = nb + "%"; return true; }
  const T = 1.0, ta = (T * da) / tot, tb = (T * db) / tot, up = na + nb > oa + ob, ez = "cubic-bezier(.19,1,.22,1)";   // iTween 既定の easeOutExpo
  const [f, tf, g, tg] = up ? [i, ta, b, tb] : [b, tb, i, ta];
  f.style.transition = `width ${tf}s ${ez}`; g.style.transition = `width ${tg}s ${ez} ${tf}s`;
  i.style.width = na + "%"; b.style.width = nb + "%";
  return up;
}
function tileHTML(cid, attrs, extra = "", cls = "", tag = "div", attrs2 = "") {
  const f = frameOf(attrs);
  return `<${tag} class="tile f-${f} ${cls}" ${attrs2}><img src="${esc(imgSrc(cid))}" alt="" loading="lazy" decoding="async" draggable="false"><span class="fb">#${cid}</span>${extra}</${tag}>`;
}
document.addEventListener("error", (e) => { const t = e.target; if (t.tagName === "IMG" && !t.classList.contains("waku")) t.closest(".tile")?.classList.add("noimg"); }, true);

/* ---------- 編成データ ---------- */
function specOf(id) {
  const c = BYID.get(id);
  return { id: c.id, name: c.n, attrs: c.attrs, cost: c.cost, hp: c.hp, power: c.pw, limit_hp: c.lhp ?? null, limit_power: c.lpw ?? null,
    skill: c.sk ?? null, limit_break: true, theme: false };
}
const padDeck = (p) => { p.deck = (p.deck || []).slice(0, 5); while (p.deck.length < 5) p.deck.push(null); return p; };
function emptyTeam(t) { return [1, 2, 3, 4, 5].map((n) => ({ id: `${t}${n}`, name: `${t}${n}`, level: "難関大学", self_mode: true, cpu: false, deck: [null, null, null, null, null] })); }
function sampleSetup() { const su = { A: emptyTeam("A"), B: emptyTeam("B") }; autoDecks(S.auto, su); return su; }
function save() {
  try { localStorage.setItem("eigo2-battle", JSON.stringify({ ver: 4, setup: S.setup, rules: S.rules, auto: S.auto, tab: S.tab, view: S.view || 0, autoAns: S.autoAns || "random", aiSkill3: S.aiSkill || "v7",
    battle: !!S.battle, inputs: S.inputs, draft: S.draft })); } catch (e) {}
}
function load() {
  try {
    const j = JSON.parse(localStorage.getItem("eigo2-battle") || "null");
    if (j && j.setup && !j.ver) for (const t of ["A", "B"]) for (const p of j.setup[t] || []) for (const c of p.deck || []) if (c) c.limit_break = true;   // 完凸を既定に(旧データの移行)
    if (j && j.setup) { S.setup = j.setup; for (const t of ["A", "B"]) for (const p of S.setup[t] || []) { p.cpu = false; for (const c of p.deck || []) if (c) c.limit_break = true; padDeck(p); } Object.assign(S.rules, j.rules || {}); Object.assign(S.auto, j.auto || {}); S.view = j.view || 0; S.autoAns = j.autoAns || "random"; S.aiSkill = j.aiSkill3 || "v7";
      if (j.battle && startBattle()) {
        S.inputs = Array.isArray(j.inputs) ? j.inputs : []; try { replay(S.inputs.length); } catch (e) { startBattle(); }
        for (const k in (j.draft || {})) if (S.draft[k]) Object.assign(S.draft[k], j.draft[k]);
        S.tab = j.tab || "battle";
      } else if (j.tab === "history") S.tab = "select"; else if (j.tab) S.tab = j.tab === "battle" ? "select" : j.tab; }
  } catch (e) {}
  if (!S.setup) S.setup = sampleSetup();
}
/* 画像はIndexedDBに保存(読み込みは一度だけ) */
const imgDB = () => new Promise((res, rej) => { try { const r = indexedDB.open("eigo-battle-img", 1); r.onupgradeneeded = () => r.result.createObjectStore("img"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } });
async function imgStore(files) { try { const db = await imgDB(), tx = db.transaction("img", "readwrite"); for (const [id, f] of files) tx.objectStore("img").put(f, id); } catch (e) {} }
async function imgRestore() { try { const db = await imgDB(), q = db.transaction("img").objectStore("img"), keys = await new Promise((r) => { const x = q.getAllKeys(); x.onsuccess = () => r(x.result); }), vals = await new Promise((r) => { const x = q.getAll(); x.onsuccess = () => r(x.result); });
  keys.forEach((k, i) => S.imgs.set(Number(k), URL.createObjectURL(vals[i]))); if (keys.length) render(); } catch (e) {} }
function toast(msg) { const t = $("#battleToast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 2200); }

/* ---------- 対戦の生成・再生 ---------- */
function engineRules() {
  return { count_step: Number(S.rules.count_step) || 1, damage_rand: [Number(S.rules.damage_rand[0]), Number(S.rules.damage_rand[1])],
    damage_rounding: S.rules.damage_rounding, max_turns: Number(S.rules.max_turns) || 40, seed: Number(S.rules.seed) || 1 };
}
function buildSetup() {
  const players = (t) => S.setup[t].map((p) => ({ ...clone(p), deck: p.deck.filter(Boolean).map(clone) }));
  const empty = [...S.setup.A, ...S.setup.B].find((p) => !p.deck.some(Boolean));
  if (empty) throw new Error(`${empty.id} のキャラがいません`);
  return { rules: engineRules(), teams: { A: { players: players("A") }, B: { players: players("B") } } };
}
function startBattle() {
  try { S.battle = new Battle(buildSetup()); } catch (e) { toast(String(e.message || e)); S.battle = null; return false; }
  S.inputs = []; S.openTurns = new Set(); resetDraft(); return true;
}
function replay(n) {
  const inputs = S.inputs.slice(0, n);
  S.battle = new Battle(buildSetup()); S.inputs = [];
  for (const i of inputs) { S.battle.step(i); S.inputs.push(i); }
  resetDraft();
}
function resetDraft() {
  S.draft = {};
  if (!S.battle) return;
  S.battle.all_players.forEach((p, i) => {
    const c = p.ghost ? null : p.deck[p.active];
    S.draft[p.id] = { mode: "fast", rank: null, target: "", use: false, order: null, priority: "normal" };   // スキルは、押したキャラだけ使う(既定はどれも使わない)   // 攻撃順・スキル順は、既定では全員未設定(席順で実行)
  });
}
/* 陣営内の順番(1〜5/未指定=null)→エンジン用の通し順。A1,B1,A2,B2…と交互。未指定は席順で最後。 */
function gseq(p, v) { const seat = S.battle.all_players.filter((q) => q.team === p.team).indexOf(p); return v == null ? 100 + (p.team === "B" ? 0.5 : 0) + seat : Number(v) * 2 + (p.team === "B" ? 0.5 : 0); }
function toEngineInput() {
  const players = {}, wants = [];
  for (const p of S.battle.all_players) {
    const d = S.draft[p.id]; const ok = ["fast", "normal", "late"].includes(d.mode);
    players[p.id] = { correct: ok, answer_code: d.mode === "fast" ? 1 : d.mode === "late" ? 6 : 0, rank: gseq(p, d.rank), priority: d.priority,
      target: d.target || null, use_skill: !!d.use && readyOf(p) };
    if (d.use && readyOf(p)) wants.push([gseq(p, d.order), p.id]);
  }
  wants.sort((a, b) => a[0] - b[0]);
  return { players, skill_order: wants.map((w) => w[1]), _modes: Object.fromEntries(S.battle.all_players.map((p) => [p.id, S.draft[p.id].mode])) };
}
function runTurn() {
  if (S.anim) { skipAnim(); return Promise.resolve(); }
  if (!S.battle || S.battle.finished) return Promise.resolve();
  const inp = toEngineInput(), fx = fxOn() && S.tab === "battle" && $("#board");
  const preHTML = fx ? renderBattle() : null, preAttrs = {};
  if (fx) for (const p of S.battle.all_players) { const c = p.ghost ? null : p.deck[p.active]; if (c) preAttrs[p.id] = S.battle.effective_attrs ? S.battle.effective_attrs(c) : c.attrs; }
  let log;
  try { log = S.battle.step(inp); S.inputs.push(inp); } catch (e) { toast(String(e.message || e)); stopAuto(); return Promise.resolve(); }
  resetDraft();
  if (fx && log && log.events.some((e) => e.kind === "attack" || e.kind === "skill_used")) { $("#battleApp").innerHTML = preHTML; const tk = (S.anim = { token: {} }).token; return playAnim(log.events, preAttrs, tk, log).then(() => { if (S.anim && S.anim.token === tk) { S.anim = null; render(); } }); }
  render();
  return Promise.resolve();
}

/* 自動で操作を決める(EigoBrain): その時点で見える情報だけから判断ルールで決める。見えない控え(自分以外の次のキャラ)は推測しない(noHidden)。先読みの試行計算はしない。
   回答は全員Excellent回答。相手の操作は相手の立場で同じルールを当てて予測する(2段: 相手もこちらの操作を予測して決めるとみなす)。
   スキル: 既定は学習した重みどおり。「必要な場面だけ」にすると、種類ごとの使う条件(brain.js skillNeeded)を満たさないスキルは温存する */
function aiDraft() {
  const b = S.battle; if (!b || b.finished || !window.EigoBrain) return;
  const band = (S.auto && S.auto.band) || "高";
  S.aiInfo = {};
  for (const side of ["A", "B"]) {
    const mode = S.aiSkill || "v7", d = EigoBrain.decide(b, side, { band, shibari: (S.auto && S.auto.shibari) || "全", level: 2, noHidden: true, policy: mode === "v6" ? "v6" : undefined });   // 相手予測は2段(相手も、こちらを予測して動くとみなす)
    S.aiInfo[side] = { wrong: d.wrong || [], held: (d.held || []).map((h) => `${h.pid}(${EFF_NAME[h.t] || h.t})`), predUse: d.pred ? d.pred.skill_order : [], predTgt: d.pred ? d.pred.order.map((pid) => [pid, d.pred.players[pid].target]) : [] };
    const so = d.skill_order;
    for (const p of b.all_players.filter((q) => q.team === side)) {
      const x = d.players[p.id], dr = S.draft[p.id];
      dr.mode = x.correct ? "fast" : "wrong"; dr.aiWrong = !x.correct;
      const oi = d.order.indexOf(p.id); dr.rank = oi >= 0 ? oi + 1 : null;
      dr.target = x.target || ""; dr.priority = "normal"; dr.use = !!x.use_skill;
      dr.order = x.use_skill ? so.indexOf(p.id) + 1 : null;
    }
  }
}
function stopAuto() { if (S.autorun) { S.autorun = false; render(); } }
async function autoRun() {
  if (S.autorun) { stopAuto(); return; }
  if (!S.battle || S.battle.finished) return;
  S.autorun = true; render();
  while (S.autorun && S.battle && !S.battle.finished) {
    await sleep(20); aiDraft(); render();
    await sleep(fxOn() ? 350 : 30);
    if (!S.autorun) break;
    await runTurn();
    await sleep(fxOn() ? 450 : 10);
  }
  S.autorun = false; render();
}

/* 攻撃演出(参考: CharactorBaseModel.AttackEach → EffectManager.Show → EffectAttackController.Set → 着弾で DamageEffect/死亡演出。
   攻撃キャラの属性ごとのエフェクトが相手へ飛び、着弾でHPが減る。IsSkipBattleAnim で省略可能) */
const FX_COL = { 火: "#e5484d", 水: "#2f7de1", 風: "#2fa866" };
function fxOn() { try { return localStorage.getItem("eigo2-fx") !== "off"; } catch (e) { return true; } }
// 着弾のダメージエフェクト: 実機では設定 AttackEffectSetting が ON だと表示しない(送られた録画はこの状態)。既定は OFF
function fxDmgOn() { try { return localStorage.getItem("eigo2-fxdmg") !== "off"; } catch (e) { return true; } }
// 高速対戦: 実機の特別ルール「高速」(BattleInfo.IsSpeedyRule = イベント設定 speedy)→ CreateBattleRoomInfo.skillEffectSkip → skipSkillAnim。
// 対戦で変わるのはスキル演出だけ(カットインなし・1人0.3秒)。既定は高速対戦。OFF にすると通常対戦(カットインあり)
function speedyOn() { try { return localStorage.getItem("eigo2-speedy") !== "off"; } catch (e) { return true; } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function skipAnim() { fxCleanup(); S.anim = null; render(); }
function cardCenter(pid) { const el = document.querySelector(`#board .card[data-pid="${pid}"] .pt .tile`) || document.querySelector(`#board .card[data-pid="${pid}"] .pt`), bd = $("#board"); if (!el || !bd) return null; const r = el.getBoundingClientRect(), q = bd.getBoundingClientRect(); return { x: r.left + r.width / 2 - q.left, y: r.top + r.height / 2 - q.top, el }; }
/* ---- 実機の対戦攻撃演出(libil2cpp.so / プレハブの値をそのまま使用) ----
   ScreenTGEventBattleController.<AllyAttack> : 攻撃ごとに EffectManager.Show("EffectAttack", 攻撃側.effectAttacBeforeAnchor)
     → EffectAttackController.SetTGEvent(属性, 相手, ダメージ, 番号k)
   SetTGEvent: 0.15×k 秒待つ → "EffectElementCharge"+属性+"Ally" を attackBeforeAnchor に、"EffectBullet"+属性 を bulletAnchor に表示
   チャージの EffectController.lifeTime=0.8秒 → AutoDelete → LunchBullet: 弾が相手の getTargetAnchor へ bulletTime=0.3秒で等速直線移動
   0.3秒後 OnFinishAttack → 相手 OnDamage(iTween.ShakePosition x10 y10 1秒, 数値, EffectManager.ShowDamageEffect を damageAnchor へ) → EffectAttack 消去
   ShowDamageEffect: "EffectDamage/EffectDamage"+属性+"_"+レベル(ダメージ <100,<500,<1500,<3000,<5000,<10000,<20000,<50000,<100000 → 1〜9、以上10)、lifeTime 1.5秒
   撃破: OnDie → "EffectIconDie"(灰色の六芒星 → 0.5秒から星と粒子、1秒で消去)
   座標(PartTGEventAlly、カード=120単位、左下原点): effectAttacBeforeAnchor (60,200) 縮尺0.5 / getTargetAnchor (60,60) / damageAnchor (60,0)
   UI Root(2D) の縮尺 1/640 → ワールド1単位 = 640単位。パーティクルの大きさはワールド単位(スケーリングモード Shape) */
const FXK = 1 / 640, FX_CHARGE = 0.8, FX_BULLET_T = 0.3, FX_GAP = 0.15, FX_DMG_LIFE = 1.5;
async function playAnim(events, preAttrs, tk, log) {
  const bd = $("#board"); if (!bd) return;
  const layer = document.createElement("div"); layer.id = "fxl"; bd.append(layer); drawTargets();
  fxCleanup();
  const live = () => S.anim && S.anim.token === tk && document.body.contains(layer);
  const efx = !!(window.EFX && EFX.ok());
  document.body.classList.add("fxon"); fxVeil(true);
  const card = (pid) => document.querySelector(`#board .card[data-pid="${pid}"]`);
  const apply = (snap) => {   // スキルの効果が出たあとの状態(継続効果・属性の色・カウント・HP・蘇生)
    if (!snap) return;
    for (const t of Object.keys(snap.teams)) {
      const lab = [...document.querySelectorAll("#board .tlabel")].find((l) => l.querySelector(".teamtag")?.textContent === t); if (!lab) continue;
      lab.querySelectorAll(".pill").forEach((x) => x.remove());
      for (const e of snap.teams[t]) { const sp = document.createElement("span"); sp.className = "pill"; sp.textContent = `${EFF_NAME[e.kind] || e.kind}・残${e.remaining}`; lab.append(sp); }
    }
    for (const [pid, c] of Object.entries(snap.chars)) {
      const cd = card(pid); if (!cd) continue;
      const tile = cd.querySelector(".pt .tile"), f = frameOf(c.attrs); if (tile) tile.className = tile.className.replace(/f-\S+/, "f-" + f);
      if (tile && c.hp > 0 && tile.classList.contains("dead")) tile.classList.remove("dead");   // 蘇生
      if (setHpBar(cd.querySelector(".hp"), c.hp, c.max_hp)) tile?.classList.add("healfx");   // 回復(OnRecovery → RecoverGage)
      const m = cd.querySelector(".skmark"); if (m && !m.classList.contains("used") && !m.classList.contains("gone")) { const old = m.textContent; m.textContent = c.count; m.classList.remove("wait", "rdy"); if (!m.classList.contains("on")) m.classList.add(c.count <= 0 ? "rdy" : "wait"); if (String(c.count) !== old) m.classList.add("cntfx"); }
    }
  };
  /* ---- スキル演出(実機 libil2cpp.so の ScreenTGEventBattleController.ShowSkillEffect / ShowResultEffect / AllyAttack /
     NotifySkillCountDown、EffectTagCharactorSkillController、EffectTagCountDownSkillController の処理と秒数そのまま) ----
     出る場面: 短縮 = 押した時点(この画面ではターン実行の最初) → 回答後: 色変 → 遅延 → 攻撃前: 継続回復の反映 → 回復 → 攻撃UP → 連撃
       → 全体攻撃 → シールド → かばう → 攻撃 → 攻撃後: 蘇生
     1人ずつ: キャラの上に「スキル名!」(ShowMessage) とカットイン(カード画像・説明)。場面の最初は1.0秒待ってから開く(skillEffect が未作成)。
       最初の人(Open): 0.2秒で開き、0.8秒で効果を反映、1.4秒で次の人へ。2人目から(Next): 0.8秒で反映、1.2秒で次へ。場面の最後に0.2秒で閉じる。
       短縮は専用のカットイン(1人ごとに1.0秒待ち → 2.0秒で反映)。
       反映(コールバック → ExecuteSkill)で、そのキャラのスキル使用マークを消し(NotifySkillRemove)、カウントを隠す(HideCount)。
     高速対戦(特別ルール「高速」→ skipSkillAnim)のときは、カットインも1.0秒の待ちもなく、「種類名!」→ 0.3秒で反映、を1人ずつ。
     種類名は実機の文字データ(OneEventSkillTypeExtend.GetName → LocalizeFacade.GetText)のとおり。 */
  const SK = { lead: 1.0, open: 1.4, next: 1.2, hit: 0.8, close: 0.2, openT: 0.2, cd: 2.0, skip: 0.3 };
  const skip = speedyOn();
  const SK_NAME = { atk_up: "攻撃", multi_attack: "連続", all_attack: "全体", shield: "防御", def_up: "防御", heal: "回復", revive: "蘇生", color_change: "変化", shorten: "短縮", delay: "遅延", cover: "かばう" };
  const nextEv = (e) => events[events.indexOf(e) + 1] || {};
  const kindOf = (e) => { const n = nextEv(e); return n.kind === "effect" ? n.effect : n.kind; };   // そのスキルが発動した場面(直後の効果の記録)
  const P2 = { heal: 0, atk_up: 1, multi_attack: 2, all_attack: 3, shield: 4, def_up: 4, cover: 5 };   // 実機 AllyAttack の表示順
  const ph = [[], [], [], []];
  for (const e of events) if (e.kind === "skill_used" && e.pid) { const k = kindOf(e); ph[k === "shorten" ? 0 : k === "color_change" || k === "delay" ? 1 : k === "revive" ? 3 : 2].push(e); }
  ph[2].sort((a, b) => (P2[kindOf(a)] ?? 9) - (P2[kindOf(b)] ?? 9) || events.indexOf(a) - events.indexOf(b));
  let lastIx = -1;
  const hit = (e) => {   // 効果を反映し、使ったキャラのスキル使用マークとカウントを消す
    const i = events.indexOf(e); if (i > lastIx) { lastIx = i; apply(e.snap); }   // 表示順が記録順と違う(シールドとかばう)ときは、新しい方の状態だけ使う
    const m = card(e.pid)?.querySelector(".pt .skmark"); if (m) { m.classList.add("gone"); m.style.visibility = "hidden"; }
  };
  const skl = () => { let l = document.getElementById("skfx"); if (!l) { l = document.createElement("div"); l.id = "skfx"; document.getElementById("page-battle").append(l); } return l; };
  const msg = (e) => {   // キャラの上の「スキル名!」(AnimationMessage)
    const pt = card(e.pid)?.querySelector(".pt"); if (!pt) return;
    const r = pt.getBoundingClientRect(), b = document.createElement("div"); b.className = "skmsg"; b.textContent = (SK_NAME[kindOf(e)] || EFF_NAME[kindOf(e)] || "スキル") + "!";
    b.style.left = r.left + r.width / 2 + "px"; b.style.top = r.top + r.height * 0.15 + "px"; skl().append(b);
    b.animate([{ opacity: 0, transform: "translate(-50%,-60%) scale(.6)" }, { opacity: 1, transform: "translate(-50%,-100%) scale(1.15)", offset: .15 }, { opacity: 1, transform: "translate(-50%,-100%) scale(1)", offset: .3 }, { opacity: 1, transform: "translate(-50%,-120%) scale(1)", offset: .8 }, { opacity: 0, transform: "translate(-50%,-130%) scale(1)" }], { duration: 1200, fill: "forwards" }).finished.then(() => b.remove()).catch(() => {});
  };
  const cutBody = (e) => { const c = BYID.get(e.cid) || {}; return [tileHTML(e.cid, c.attrs || []), `<b>${esc(c.n || e.pid)}</b><span>${esc((c.sk && c.sk.name) || "")}</span>`]; };
  const panel = {
    el: null,
    open(e) {   // Open → OpenCo: 背景を openTime(0.2秒)で縦に開く
      const [tl, tx] = cutBody(e), el = document.createElement("div"); el.className = "skcut";
      el.innerHTML = `<div class="skc-card">${tl}</div><div class="skc-tx">${tx}</div>`; skl().append(el); this.el = el;
      el.animate([{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], { duration: SK.openT * 1000, fill: "forwards" });
    },
    next(e) {   // Next → NextCo: 文字を0.1秒で縮め、次のカードを0.2秒で右から入れ、文字を差し替えて0.1秒で戻す
      if (!this.el) return this.open(e);
      const [tl, tx] = cutBody(e), box = this.el.querySelector(".skc-card"), txt = this.el.querySelector(".skc-tx"), old = box.firstElementChild;
      box.insertAdjacentHTML("beforeend", tl); const nw = box.lastElementChild;
      old?.animate([{ transform: "translateX(0)" }, { transform: "translateX(-130%)" }], { duration: 200, fill: "forwards" }).finished.then(() => old.remove()).catch(() => {});
      nw.animate([{ transform: "translateX(130%)" }, { transform: "translateX(0)" }], { duration: 200, fill: "forwards" });
      txt.animate([{ transform: "scaleY(1)" }, { transform: "scaleY(0)" }], { duration: 100, fill: "forwards" }).finished.then(() => {
        txt.innerHTML = tx; txt.animate([{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], { duration: 100, fill: "forwards" }); }).catch(() => {});
    },
    close() {   // Close: closeTime(0.2秒)で縦に閉じる → Finish で消す
      const el = this.el; this.el = null; if (!el) return;
      el.animate([{ transform: "scaleY(1)" }, { transform: "scaleY(0)" }], { duration: SK.close * 1000, fill: "forwards" }).finished.then(() => el.remove()).catch(() => {});
    },
  };
  const cdCut = (e) => {   // 短縮のカットイン(EffectTagCountDownSkill の cutinanim。2.0秒)
    const [tl, tx] = cutBody(e), el = document.createElement("div"); el.className = "skcut cd";
    el.innerHTML = `<div class="skc-card">${tl}</div><div class="skc-tx">${tx}</div>`; skl().append(el);
    el.animate([{ transform: "translateX(100vw)", opacity: 0 }, { transform: "translateX(0)", opacity: 1, offset: .12 }, { transform: "translateX(0)", opacity: 1, offset: .88 }, { transform: "translateX(-100vw)", opacity: 0 }], { duration: SK.cd * 1000, fill: "forwards" }).finished.then(() => el.remove()).catch(() => {});
  };
  const wait = async (sec) => { await sleep(sec * 1000); return live(); };
  const runPhase = async (list, countDown) => {
    if (!list.length) return true;
    if (skip) { for (const e of list) { msg(e); if (!(await wait(SK.skip))) return false; hit(e); } return true; }
    if (countDown) { for (const e of list) { if (!(await wait(SK.lead))) return false; msg(e); cdCut(e); if (!(await wait(SK.cd))) return false; hit(e); } return true; }
    if (!(await wait(SK.lead))) return false;
    for (let k = 0; k < list.length; k++) {
      const e = list[k]; msg(e); if (k) panel.next(e); else panel.open(e);
      if (!(await wait(SK.hit))) return false; hit(e);
      if (!(await wait((k ? SK.next : SK.open) - SK.hit))) return false;
    }
    panel.close(); return wait(SK.close);
  };
  if (!(await runPhase(ph[0], true))) return;   // 短縮
  if (!(await runPhase(ph[1]))) return;         // 回答後: 色変 → 遅延
  for (const e of events) if (e.kind === "skill_cancelled" && e.pid) {   // 遅延で不発になったスキルは、押した印を外す
    const m = card(e.pid)?.querySelector(".pt .skmark"); if (m && !m.classList.contains("gone")) { m.classList.remove("on"); m.classList.add("wait"); }
  }
  const rg = events.map((e, i) => (e.kind === "regen" ? i : -1)).filter((i) => i >= 0);
  if (rg.length && log && log.regen_snap) { apply(log.regen_snap); lastIx = Math.max(lastIx, rg[rg.length - 1]); }   // 継続回復(ApplyContinuousHeel)は攻撃前のスキルより先
  if (!(await runPhase(ph[2]))) return;         // 攻撃前: 回復 → 攻撃UP → 連撃 → 全体攻撃 → シールド → かばう
  const atks = events.filter((e) => e.kind === "attack");
  const geo = (pid) => {
    const el = document.querySelector(`#board .card[data-pid="${pid}"] .pt .tile`) || document.querySelector(`#board .card[data-pid="${pid}"] .pt`);
    if (!el) return null;
    const r = el.getBoundingClientRect(), far = !!el.closest(".tside.far"), ppu = r.width / 120;
    // 相手側の向き: 手前の列は上、奥の列は下。座標はページ基準(スクロールしてもずれない)
    return { el, x: r.left + r.width / 2 + scrollX, y: r.top + r.height / 2 + scrollY, ppu, dir: far ? 1 : -1 };
  };
  const start = performance.now();
  const jobs = atks.map((e, k) => (async () => {
    const tpid = String(e.target).split("-")[0], A = geo(e.attacker), T = geo(tpid); if (!A || !T) return;
    const nm = fxAttrName(preAttrs[e.attacker] || []), t0 = FX_GAP * k;
    await sleep(t0 * 1000); if (!live()) return;
    if (efx) {
      const ppw = A.ppu / FXK, bx = A.x, by = A.y + A.dir * 140 * A.ppu, sc = FXK * 0.5;
      const tx = T.x, ty = T.y; // getTargetAnchor = カード中心
      EFX.play("EffectElementCharge" + nm + "Ally", bx, by, ppw, sc, { life: FX_CHARGE });
      EFX.play("EffectBullet" + nm, bx, by, ppw, sc, { life: FX_CHARGE + FX_BULLET_T, path: (s) => {
        const u = Math.max(0, Math.min(1, (s - FX_CHARGE) / FX_BULLET_T)); return { x: bx + (tx - bx) * u, y: by + (ty - by) * u }; } });
    }
    await sleep((FX_CHARGE + FX_BULLET_T) * 1000); if (!live()) return;
    // 着弾: OnDamage
    fxShake(T.el, 10 * T.ppu, 1000);
    if (efx && fxDmgOn()) EFX.play("EffectDamage" + nm + "_" + fxLevel(e.damage), T.x, T.y - T.dir * 60 * T.ppu, T.ppu / FXK, FXK, { life: FX_DMG_LIFE });
    const mult = e.calc?.attr ?? 1, num = document.createElement("div"); num.className = "fxnum";
    num.style.cssText = `left:${T.x}px;top:${T.y}px;font-size:${Math.max(14, 34 * T.ppu)}px`;
    num.textContent = Math.round(e.damage).toLocaleString(); if (mult !== 1) num.title = mult > 1 ? "弱点" : "耐性"; fxNums().append(num);
    num.animate([{ transform: "translate(-50%,-50%) scale(1.4)", opacity: 0 }, { transform: "translate(-50%,-50%) scale(1)", opacity: 1, offset: .12 }, { transform: "translate(-50%,-80%)", opacity: 1, offset: .8 }, { transform: "translate(-50%,-90%)", opacity: 0 }], { duration: 1000, fill: "forwards" }).finished.then(() => num.remove()).catch(() => {});
    setHpBar(document.querySelector(`#board .card[data-pid="${tpid}"] .hp`), e.calc.hp_after, e.calc?.max_hp || 1);   // OnDamage → DamageGage
    if (e.killed) {
      T.el.classList.add("dead");
      if (efx) EFX.play("EffectIconDie", T.x, T.y, T.ppu / FXK, FXK, { life: 1.0, anim: fxIconDieAnim });
    }
    await sleep(FX_DMG_LIFE * 1000);
  })());
  await Promise.all(jobs);
  if (!live()) return;
  if (!(await runPhase(ph[3]))) return;         // 攻撃後: 蘇生(FireSkillAfterEnemyAttack)
  if (live()) { fxCleanup(); S.anim = null; render(); }
}
// EffectIconDie のアニメーション(IconDeath クリップ: IconDie α 1→0 (0.5〜1秒)、DeathStar 0.5秒から表示し0.667〜1秒で消える、粒子は0.5〜1秒)
function fxIconDieAnim(I, t) {
  const n1 = EFX.node(I, "IconDie"), n2 = EFX.node(I, "DeathStar"), n3 = EFX.node(I, "Particle System");
  if (n1) n1.alpha = t < 0.5 ? 1 : Math.max(0, 1 - (t - 0.5) / 0.5);
  if (n2) { n2.active = t >= 0.5; n2.alpha = t < 0.667 ? 1 : Math.max(0, 1 - (t - 0.667) / 0.333); }
  if (n3) { const on = t >= 0.5 && t < 1; if (on && !n3.active) { n3.active = true; n3.playing = true; n3.emitting = true; n3.t = 0; n3.started = false; n3.done = false; } if (!on) n3.active = false; }
}
// iTween.ShakePosition(x, y, time, islocal): 振幅は時間とともに0へ
function fxShake(el, amp, ms) {
  const k = [], n = 20; for (let i = 0; i <= n; i++) { const a = amp * (1 - i / n); k.push({ transform: `translate(${((Math.random() * 2 - 1) * a).toFixed(1)}px,${((Math.random() * 2 - 1) * a).toFixed(1)}px)` }); }
  k[n] = { transform: "translate(0,0)" };
  el.animate(k, { duration: ms, easing: "linear" });
}
function fxAttrName(a) {
  const s = new Set(a || []), n = s.size;
  if (n >= 3) return "FireWaterWind";
  if (n === 2) return s.has("火") && s.has("水") ? "FireWater" : s.has("水") && s.has("風") ? "WaterWind" : "WindFire";
  return s.has("水") ? "Water" : s.has("風") ? "Wind" : "Fire";
}
function fxLevel(d) { const th = [100, 500, 1500, 3000, 5000, 10000, 20000, 50000, 100000]; for (let i = 0; i < th.length; i++) if (d < th[i]) return i + 1; return 10; }
function fxUnit(w) { return Math.max(40, w * 1.7); } // 1ユニット=キャラ画像幅の1.7倍(実機録画のカード幅と爆発の大きさの比から)
function fxNums() { let n = document.getElementById("fxnums"); if (!n) { n = document.createElement("div"); n.id = "fxnums"; document.getElementById("page-battle").append(n); } return n; }
function fxVeil(on) { let v = document.getElementById("fxveil"); if (!v) { v = document.createElement("div"); v.id = "fxveil"; document.body.append(v); } requestAnimationFrame(() => { v.style.opacity = on ? 1 : 0; }); }
function fxCleanup() { try { window.EFX && EFX.clear(); } catch (e) {} document.body.classList.remove("fxon"); for (const id of ["fxveil", "fxnums", "skfx"]) document.getElementById(id)?.remove(); }

/* ---------- キャラ選択画面 ---------- */
function renderSelect() {
  const team = (t) => `<section class="bt-card"><div class="teamhead"><span class="teamtag ${t}">${t}</span><h2>チーム${t}</h2><span class="grow"></span>
      <label class="field">人数 <select data-size="${t}">${[1, 2, 3, 4, 5].map((n) => `<option ${S.setup[t].length === n ? "selected" : ""}>${n}</option>`).join("")}</select></label></div>
    ${S.setup[t].map((p, pi) => `<div class="prow" data-t="${t}" data-pi="${pi}"><div class="pid">${p.id}${pi === 0 ? `<span class="ld">リーダー</span>` : ""}</div>
      <div><div class="slots">${p.deck.map((c, ci) => { const dr = `data-char-drag="btslot:${t}:${pi}:${ci}"`; return c ? `<div class="slotwrap" data-ci="${ci}">
          ${tileHTML(c.id, c.attrs, `<button class="x" data-act="delc" aria-label="外す">×</button>`, "", "div", `data-act="editc" role="button" tabindex="0" style="cursor:pointer" aria-label="キャラを変更" ${dr}`)}
          <div class="tg"><label title="補正"><input type="checkbox" data-c="theme" ${c.theme ? "checked" : ""}>補正${c.theme ? "ON" : "OFF"}</label></div></div>`
        : `<div class="slotwrap" data-ci="${ci}"><button class="tile empty" data-act="addc" aria-label="キャラを追加" ${dr}>＋</button></div>`; }).join("")}</div>
        <div class="popts"><label class="field">レベル <select data-f="level">${LEVELS.map((l) => `<option ${p.level === l ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <label class="field"><input type="checkbox" data-f="self_mode" ${p.self_mode ? "checked" : ""}> 自力×1.2</label>
          <button class="mini-reset" data-act="autoone">自動生成</button></div></div></div>`).join("")}
  </section>`;
  const au = S.auto;
  const bandCap = (BANDS.find((x) => x[0] === au.band) || BANDS[2])[1];
  const autoPanel = `<section class="bt-card"><div class="row"><h2>キャラ生成</h2><span class="muted">縛りと縛りコストを選んで「キャラ生成」を押すと、2025年12月4日〜2026年5月24日の対戦データ(その縛りでの、枠ごとの使用率・同じデッキでのキャラの組み合わせ)に基づいて、全員のデッキを作ります。</span></div>
    <div class="row" style="margin-top:8px;gap:8px"><span class="muted">縛り</span><div class="chips lg">${chips(SHIBARI.map((x) => x[0]), au.shibari, "shibari")}</div></div>
    <div class="row" style="margin-top:8px;gap:8px"><span class="muted">縛りコスト</span><div class="chips lg">${BANDS.map(([n, , r]) => `<button class="chip ${n === au.band ? "on" : ""}" data-act="band" data-v="${n}">${n}<span style="font-weight:400">(${r})</span></button>`).join("")}</div></div>
    <div class="row" style="margin-top:8px"><button class="primary" data-act="autoall">キャラ生成</button>
      <span class="muted">どのデッキも、合計コストは ${bandCap} 以下です。押すたびに別のデッキになります。各プレイヤーの「自動生成」で1人分だけ作り直せます。</span></div></section>`;
  return `${autoPanel}<div class="cols">${team("A")}${team("B")}</div>
  <section class="bt-card"><div class="row"><button class="primary" data-act="start">この編成で対戦を始める</button>
    <span class="muted">リーダーは各チームの先頭(A1/B1)です。</span></div></section>`;
}

/* ---------- 戦闘画面 ---------- */
/* 短縮は即時ではない: スキルカウントは、ターンを実行するまで変わらない(短縮で減るのは、ターンの処理のとき。同じターンに味方が使えるようにはならない) */
function countOf(p) { const c = p.ghost ? null : p.deck[p.active]; return c ? c.count : 0; }
/* 押した時点の状態(実機・エンジンと同じ): スキルは押した時点でカウント0以下か確かめ、短縮は押した時点で味方のカウントをすぐ減らす。
   短縮で0以下になった味方は、同じターンにスキルを押せる。押したい人を順に見て、押せる人がいれば押し、短縮が出たら最初から見直す */
function pressState() {
  const b = S.battle, cnt = new Map(), valid = new Set(), committed = new Set(), front = (p) => (p.ghost ? null : p.deck[p.active]);
  for (const p of b.all_players) { const c = front(p); if (c) cnt.set(p.id, c.count); }
  const want = b.all_players.filter((p) => { const c = front(p), d = S.draft[p.id]; return d && d.use && c && c.alive && c.skill && c.uses < b.rules.max_skill_uses; }).sort((x, y) => gseq(x, S.draft[x.id].order) - gseq(y, S.draft[y.id].order));   // 押す順はエンジンと同じ(スキル順。未設定は席順)
  for (let again = true; again;) {
    again = false;
    for (const p of want) {
      if (valid.has(p.id) || cnt.get(p.id) > 0) continue;
      valid.add(p.id);
      const c = front(p);
      if ((c.skill.effects || []).some((e) => e.type === "shorten")) {
        committed.add(p.id);   // 短縮は押した時点で使用済みになる(ほかのスキルは、ターンの処理で使用済みになるので、あとから短縮を受ける)
        for (const e of c.skill.effects) if (e.type === "shorten")
          for (const t of b._targets({ char: c }, b.teams[p.team], e, "team")) { if (committed.has(t.pid) || !t.skill || t.uses >= b.rules.max_skill_uses) continue; cnt.set(t.pid, cnt.get(t.pid) - Number(e.amount ?? 1)); }
        again = true; break;
      }
    }
  }
  return { cnt, valid };
}
function shownCount(p) { const c = p.ghost ? null : p.deck[p.active]; return c ? pressState().cnt.get(p.id) : 0; }
function readyOf(p) { const c = p.ghost ? null : p.deck[p.active]; return !!(c && c.alive && c.skill && c.uses < 2 && pressState().cnt.get(p.id) <= 0); }
function fxList(p) {
  const b = S.battle, c = p.ghost ? null : p.deck[p.active]; if (!c) return [];
  return b.teams[p.team].effects.filter((e) => b._applies(e, c));
}
function fxCount(p) { const n = fxList(p).length; return n ? `(${n})` : ""; }
/* 効果の付与元。範囲が「自身」やかばうは付与したプレイヤーの出場中キャラにかかるので、付与キャラが倒れていたら引き継いだキャラも示す */
function ownerText(e) {
  if (!e.owner) return "—";
  const b = S.battle, p = b.players[e.owner.pid], cur = p && !p.ghost ? p.active_char : null;
  const selfLike = (e.data.scope ?? "team") === "self" || (e.kind === "cover" && !e.data.to_leader);
  if (selfLike && cur && cur !== e.owner) return `${e.owner.uid} ${e.owner.name} → 引き継ぎ: ${cur.uid} ${cur.name}`;
  if (selfLike && !cur) return `${e.owner.uid} ${e.owner.name}(${e.owner.pid} は幽霊のため無効)`;
  return `${e.owner.uid} ${e.owner.name}`;
}
function fxDetail(e) {
  const d = e.data, o = [];
  if (d.bonus != null) o.push(`攻撃力 +${Math.round(d.bonus * 100)}%`);
  if (d.rate != null) o.push(`回復 ${Math.round(d.rate * 100)}%`);
  if (d.cut != null) o.push(e.kind === "cover" ? `攻撃を引き受ける(${Math.round(d.cut * 100)}%カット)` : `被ダメージ ${Math.round(d.cut * 100)}%カット`);
  if (d.hits != null) o.push(`${d.hits}連撃`);
  if (d.to) o.push(`色変更→${[].concat(d.to).join("")}`);
  if (d.to_leader) o.push("リーダーをかばう");
  if (d.attr) o.push(`対象属性: ${d.attr}`);
  if (d.vs_attr) o.push(`相手属性: ${d.vs_attr}`);
  return o.join(" / ") || "—";
}
// スキル効果の説明文
function effText(e) {
  const o = [EFF_NAME[e.type] || e.type];
  const sc = e.type === "delay" ? { team: "敵全体", self: "敵", leader: "敵リーダー" }[e.scope || "team"]
    : { self: "自身(付与したプレイヤー)", team: "味方全体", leader: "リーダー", enemy: "敵" }[e.scope];
  if (sc) o.push(`対象:${sc}`);
  if (e.attr) o.push(`${e.attr}属性のみ`);
  if (e.vs_attr) o.push(`相手が${e.vs_attr}属性`);
  if (e.bonus != null) o.push(`攻撃力+${Math.round(e.bonus * 100)}%`);
  if (e.cut != null) o.push(`${Math.round(e.cut * 100)}%カット`);
  if (e.rate != null) o.push(`回復${Math.round(e.rate * 100)}%`);
  if (e.hp_rate != null) o.push(`HP${Math.round(e.hp_rate * 100)}%で復活`);
  if (e.hits != null) o.push(`${e.hits}回攻撃`);
  if (e.amount != null) o.push(e.type === "delay" ? `カウント+${e.amount}` : e.type === "shorten" ? `カウント−${e.amount}` : `${e.amount}ターン`);
  if (e.to) o.push(`→${[].concat(e.to).join("")}`);
  if (e.to_leader) o.push("リーダーへ集中");
  if (e.turns != null && e.turns > 1) o.push(`${e.turns}ターン継続`);
  return o.join(" / ");
}
// 継続効果がこのキャラに適用されるか(されない場合は理由)
function applyInfo(e, c) {
  const b = S.battle;
  if (b._applies(e, c)) return { ok: true, why: "" };
  const scope = e.data.scope ?? "team";
  if (c.team !== e.team) return { ok: false, why: "別チーム" };
  if (scope === "self") return { ok: false, why: "付与したプレイヤーの出場中キャラのみ" };
  if (scope === "leader") return { ok: false, why: "リーダーのみ" };
  if (e.data.attr) return { ok: false, why: `${e.data.attr}属性のみ` };
  return { ok: false, why: "対象外" };
}
function skcHTML() {
  const b = S.battle;
  const team = (t) => {
    const effs = b.teams[t].effects;
    const effRows = effs.length ? `<table><thead><tr><th>継続効果</th><th>内容</th><th>付与元</th><th>残り</th></tr></thead><tbody>${effs.map((e) =>
      `<tr><td>${esc(EFF_NAME[e.kind] || e.kind)}</td><td>${esc(fxDetail(e))}${e.data.scope ? `(${esc({ self: "付与したプレイヤーの出場中キャラ", team: "味方全体", leader: "リーダー" }[e.data.scope] || e.data.scope)})` : ""}</td><td>${esc(ownerText(e))}</td><td>${e.remaining}T</td></tr>`).join("")}</tbody></table>` : `<div class="ln">継続中の効果はありません。</div>`;
    const players = b.all_players.filter((p) => p.team === t).map((p) => {
      const chars = p.deck.map((c, i) => {
        const cur = !p.ghost && i === p.active;
        const sk = c.skill ? `${esc(c.skill.name || "スキル")}:${esc((c.skill.effects || []).map(effText).join(" + "))}` : "スキルなし";
        const cnt = c.skill ? (c.uses >= 2 ? "使用上限(2/2)" : c.count <= 0 ? `発動可(カウント${c.count})` : `あと${c.count}T`) : "";
        const ap = effs.map((e) => { const a = applyInfo(e, c); const nm = esc(EFF_NAME[e.kind] || e.kind);
          if (a.ok && !c.alive) return `<span class="ng" title="倒れているため">${nm}(倒れている)</span>`;
          if (a.ok && !cur) return `<span class="ok">✓${nm}(出場したら)</span>`;
          return a.ok ? `<span class="ok">✓${nm}</span>` : `<span class="ng" title="${esc(a.why)}">${nm}(${esc(a.why)})</span>`; }).join(" ");
        return `<div class="ch ${cur ? "cur" : ""}">${tileHTML(c.cid, b.effective_attrs(c), stateOverlay(c), c.alive ? "" : "dead")}
          <div><div class="nm">${cur ? "【出場中】" : c.alive ? "控え " : "倒れた "}${esc(c.name)} <span class="muted">${esc(c.uid)} HP ${n1(c.hp)}/${n1(c.max_hp)}</span></div>
          <div class="ln">${sk}${cnt ? ` ／ ${cnt} ／ 使用 ${c.uses}/2` : ""}</div>
          ${stateLine(c)}
          ${effs.length ? `<div class="ln">継続効果: ${ap}</div>` : ""}</div></div>`;
      }).join("");
      return `<div class="pl"><div class="nm">${esc(p.id)}${p.cpu ? "(CPU)" : ""}${p.ghost ? "(幽霊)" : ""}${b.teams[t].leader === p.id ? " ★リーダー" : ""}</div>${chars}</div>`;
    }).join("");
    return `<section class="tm"><h3><span class="teamtag ${t}">${t}</span>チーム${t}</h3>${effRows}${players}</section>`;
  };
  return `<div class="overlay" data-act="closeskc"><div class="modal" role="dialog" aria-label="スキル確認"><div class="mh"><div class="row"><h2>スキル確認(ターン${b.turn}終了時点)</h2><span class="grow"></span><button class="mini-reset" data-act="closeskc">閉じる</button></div>
    <div class="muted">各キャラのスキルと状態、チームの継続効果が誰に適用されるか(✓=適用、取消線=対象外と理由)を表示します。控えのキャラにも、出場したときに適用されるかを表示しています。</div></div>
    <div class="mb"><div class="skc">${team("A")}${team("B")}</div></div></div></div>`;
}
function fxHTML() {
  const b = S.battle, p = b && b.players[S.fx]; if (!p) return "";
  const c = p.ghost ? null : p.deck[p.active], list = fxList(p);
  const rows = list.map((e) => `<div class="ev"><span class="st">残り${e.remaining}T</span><div><div class="hd">${esc(EFF_NAME[e.kind] || e.kind)}</div><div class="fx">${esc(fxDetail(e))}<br>付与元: ${esc(ownerText(e))}</div></div></div>`).join("");
  const own = c && c.skill ? `<div class="muted" style="margin-top:8px">自分のスキル: ${esc(c.skill.name || "")}(発動ターン ${c.skill_turn} / 現在カウント ${c.count} / 使用 ${c.uses}/2)</div>` : "";
  return `<div class="overlay" data-act="closefx"><div class="modal" role="dialog" aria-label="付与されている効果"><div class="mh"><div class="row"><h2>${esc(S.fx)} ${c ? esc(c.name) : ""}:付与されている効果</h2><span class="grow"></span><button class="mini-reset" data-act="closefx">閉じる</button></div>
    <div class="muted">継続中の効果です。残りターンは今のターンを含みます。回復・短縮などの即時効果はここには出ません。</div></div><div class="mb">${rows || `<p class="muted">付与されている継続効果はありません。</p>`}${own}</div></div></div>`;
}
// キャラの状態(色変・使用回数・蘇生済み・遅延)
function charState(c) {
  const b = S.battle, eff = b.effective_attrs(c), base = c.base_attrs;
  const changed = eff.join("") !== base.join("");
  return { eff, base, changed, uses: c.uses, revived: c.revived_used, delayed: c.delayed_now, noskill: !c.skill };
}
const attrDots = (a) => a.map((x) => `<i class="${x}"></i>`).join("");
function stateOverlay(c) {
  const st = charState(c);
  let o = "";
  if (c.skill) o += `<span class="pips" aria-hidden="true">${[0, 1].map((i) => `<i class="${i < st.uses ? "on" : ""}"></i>`).join("")}</span>`;
  if (st.changed) o += `<span class="stag cc" title="色変: ${st.base.join("")}→${st.eff.join("")}">色${attrDots(st.eff)}</span>`;
  if (st.revived) o += `<span class="stag rv" title="蘇生済み(このキャラはもう蘇生されない)">蘇</span>`;
  else if (st.delayed) o += `<span class="stag dl" title="このターンに遅延を受けた">遅延</span>`;
  return o;
}
function stateLine(c) {
  const st = charState(c), out = [];
  if (st.changed) out.push(`<span class="s-cc">色変 ${esc(st.base.join(""))}→${esc(st.eff.join(""))}</span>`);
  if (c.skill && st.uses) out.push(`<span class="s-used">スキル使用 ${st.uses}回</span>`);
  if (st.revived) out.push(`<span class="s-rv">蘇生済み</span>`);
  if (st.delayed) out.push(`<span class="s-dl">遅延を受けた</span>`);
  return out.length ? `<div class="stl">${out.join("")}</div>` : "";
}
function cardHTML(p) {
  const c = p.ghost ? null : p.deck[p.active], d = S.draft[p.id], ready = readyOf(p), on = ready && d.use, cpu = p.cpu;
  const mcls = d.mode === "fast" ? "m-fast" : ["wrong", "timeout"].includes(d.mode) ? "m-ng" : "m-ok";
  const pic = c ? tileHTML(c.cid, S.battle.effective_attrs(c), stateOverlay(c), c.alive ? "" : "dead", "span") : `<span class="tile empty">${p.ghost ? "幽" : "—"}</span>`;
  const rk = (v) => (v == null ? "未設定" : v);
  const left = p.ghost ? 0 : p.deck.filter((x) => x.alive).length;   // 残りのキャラ数(最初は5。出場中を含む)
  let badge = ""; const k0 = c ? countOf(p) : 0, k = c ? shownCount(p) : 0;
  if (c && c.skill) badge = c.uses >= 2 ? `<span class="skmark used" aria-hidden="true">×</span>` : on ? `<span class="skmark on" aria-hidden="true">${k}</span>` : k <= 0 ? `<span class="skmark rdy" aria-hidden="true">${k}</span>` : `<span class="skmark wait ${k !== k0 ? "cntfx" : ""}" aria-hidden="true">${k}</span>`;
  let ct = ""; if (c && c.skill) ct = c.uses >= 2 ? `<div class="ct used">使用済(2/2)</div>` : k <= 0 ? `<div class="ct go">発動可(${c.uses}/2)</div>` : `<div class="ct">あと${k}T(${c.uses}/2)</div>`;
  else if (c) ct = `<div class="ct used">スキルなし</div>`;
  return `<article class="card ${p.ghost ? "ghost" : ""}" data-pid="${p.id}">
    <button class="pt ${ready ? "ready" : ""}" data-act="skilltoggle" data-pid="${p.id}" data-team="${p.team}" aria-pressed="${on}" ${cpu ? "disabled" : ""}
      aria-label="${p.id} スキル切替。画像からはみ出して相手へドラッグで狙いを指定" title="${p.id}　クリック:スキル切替 / はみ出して相手へドラッグ:狙い指定">${pic}<span class="left" aria-hidden="true">あと${left}</span>${badge}</button>
    ${c ? hpBarHTML(c.hp, c.max_hp) : `<div class="hp"><i></i><b></b></div>`}
    <button class="cb fxb" data-act="fx" data-pid="${p.id}" aria-label="${p.id} 付与されている効果">効果${fxCount(p)}</button>
    <button class="cb sk ${d.order == null ? "unset" : "set"}" data-act="srank" data-pid="${p.id}" ${cpu || !ready ? "disabled" : ""} aria-label="${p.id} スキルを使う順番:${rk(d.order)}" title="スキルを使う順番。タップするたびに 1番目→2番目→…→未設定(スキルを使えるキャラだけ)">${d.order == null ? "スキル順 ―" : `スキル ${d.order}番目`}</button>
    <button class="cb at ${d.rank == null ? "unset" : "set"}" data-act="rank" data-pid="${p.id}" ${cpu ? "disabled" : ""} aria-label="${p.id} 攻撃する順番:${rk(d.rank)}" title="攻撃する順番。タップするたびに 1番目→2番目→…→未設定">${d.rank == null ? "攻撃順 ―" : `攻撃 ${d.rank}番目`}</button>
    <button class="cb ${mcls}" data-act="ans" data-pid="${p.id}" ${cpu ? "disabled" : ""} aria-label="${p.id} 正誤判定">${MODE_LABEL[d.mode]}</button></article>`;
}
// 操作のしかた(初めての人向け)。閉じた状態はこのブラウザだけに覚える
function renderBattle() {
  if (!S.battle) return `<section class="bt-card"><p>まだ対戦が始まっていません。</p><button class="primary" data-act="start">現在の編成で開始</button></section>`;
  const b = S.battle, st = b.state(), fin = b.finished, view = S.view || 0;
  const side = (t, near) => `<section class="tside ${near ? "near" : "far"}"><div class="tlabel"><span class="teamtag ${t}">${t}</span><b>チーム${t}</b><span>${near ? "手前" : "奥"}</span>
    ${st.teams[t].effects.map((e) => `<span class="pill">${esc(EFF_NAME[e.kind] || e.kind)}・残${e.remaining}</span>`).join("")}</div>
    <div class="trow">${b.all_players.filter((p) => p.team === t).map(cardHTML).join("")}</div></section>`;
  const T = ["A", "B"], nearT = T[view], farT = T[1 - view];
  const rk = (t) => { const pt = rankPointOf(b, t); return `${t}: ${RANK_NAME[pt]}(ランク点${pt > 0 ? "+" : ""}${pt})`; };
  const banner = fin ? `<div class="banner">${b.result.winner === "draw" ? "引き分け" : `チーム${b.result.winner}の勝利`}(${b.result.turns}ターン)<span style="font-size:13px;font-weight:500;margin-left:10px">${rk("A")} ／ ${rk("B")}</span></div>` : "";
  const decks = ["A", "B"].map((t) => b.all_players.filter((p) => p.team === t).map((p) => {
    const slots = p.deck.map((x, i) => { const cur = i === p.active && !p.ghost;
      return `<div class="dslot ${cur ? "cur" : ""}">${tileHTML(x.cid, b.effective_attrs(x), stateOverlay(x), x.alive ? "" : "dead")}${hpBarHTML(x.hp, x.max_hp)}</div>`; }).join("");
    return `<section class="deckrow ${t} ${p.ghost ? "ghost" : ""}"><div class="dhead" style="cursor:default"><h3>${p.id}</h3>${p.cpu ? `<span class="pill">CPU</span>` : ""}${p.ghost ? `<span class="pill">幽霊</span>` : ""}</div><div class="dbody"><div class="dslots">${slots}</div></div></section>`; }).join(""));
  return `${banner}<section class="bt-card"><div class="row"><h2>ターン${fin ? b.turn : b.turn + 1}</h2><span class="grow"></span>
      <button class="mini-reset" data-act="fxtoggle" aria-pressed="${fxOn()}">演出 ${fxOn() ? "ON" : "OFF"}</button><button class="mini-reset" data-act="fxdmg" aria-pressed="${fxDmgOn()}" title="実機の設定「AttackEffectSetting」に相当。ONで着弾時のダメージエフェクト(EffectDamage)を表示">着弾エフェクト ${fxDmgOn() ? "ON" : "OFF"}</button><button class="mini-reset" data-act="speedy" aria-pressed="${speedyOn()}" title="実機の特別ルール「高速」。ONはスキル演出がカットインなしで1人0.3秒。OFFは通常対戦(カットインあり)">高速対戦 ${speedyOn() ? "ON" : "OFF"}</button><button class="mini-reset" data-act="skc">スキル確認</button><button class="mini-reset" data-act="view">視点切替</button><button class="mini-reset" data-act="rankreset">攻撃順リセット</button><button class="mini-reset" data-act="srankreset">スキル順リセット</button></div>
    <div class="board" id="board">${side(farT, false)}${side(nearT, true)}<svg id="tgsvg" aria-hidden="true"></svg></div>
    <div class="row" style="justify-content:center;margin-top:6px">
      <button class="mini-reset" data-act="undo" ${S.inputs.length ? "" : "disabled"}>1ターン戻す</button><button class="mini-reset" data-act="restart">やり直す</button>
      <button class="primary" data-act="run" ${fin ? "disabled" : ""}>ターン実行</button></div>
    ${HAS_AI ? `<div class="row" style="justify-content:center;margin-top:8px;gap:8px">
      <button class="mini-reset" data-act="aidraft" ${fin ? "disabled" : ""} title="このターンの狙い・チーム内の攻撃順・スキルの使用と順番を、自動で決めます(回答はExcellent回答)">自動で決める</button>
      <button class="reset-btn ${S.autorun ? "stopbtn" : "primary"}" data-act="autorun" ${fin && !S.autorun ? "disabled" : ""}>${S.autorun ? "自動操作を止める" : "決着まで自動操作"}</button></div>` : ""}</section>
    <details class="sub"><summary>デッキ・控えの状況</summary><div class="cols" style="margin-top:6px">${decks.map((x) => `<div>${x}</div>`).join("")}</div></details>`;
}

/* 狙いの矢印とドラッグ */
let drag = null;
function ptCenter(pid) { const el = document.querySelector(`#board .pt[data-pid="${pid}"]`), bd = $("#board"); if (!el || !bd) return null; const r = el.getBoundingClientRect(), q = bd.getBoundingClientRect(); return { x: r.left + r.width / 2 - q.left, y: r.top + r.height / 2 - q.top, r: r.width / 2 }; }
function drawTargets() {
  const svg = $("#tgsvg"), bd = $("#board"); if (!svg || !bd) return;
  const q = bd.getBoundingClientRect(); if (!q.width) return; svg.setAttribute("viewBox", `0 0 ${q.width} ${q.height}`);
  const col = { A: "var(--fire)", B: "var(--water)" }; let h = `<defs>${["A", "B"].map((t) => `<marker id="ar${t}" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5 0 7z" style="fill:${col[t]}"/></marker>`).join("")}</defs>`;
  if (S.battle) for (const p of S.battle.all_players) { const t = S.draft[p.id]?.target; if (!t || p.ghost) continue; const a = ptCenter(p.id), b = ptCenter(t); if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, off = p.team === "A" ? -3 : 3;
    h += `<line x1="${a.x + dx / L * a.r * .6 + off}" y1="${a.y + dy / L * a.r * .6}" x2="${b.x - dx / L * b.r * .7 + off}" y2="${b.y - dy / L * b.r * .7}" style="stroke:${col[p.team]}" stroke-width="2.5" opacity=".85" marker-end="url(#ar${p.team})"/>`; }
  if (drag && drag.active) { const a = ptCenter(drag.pid), q2 = bd.getBoundingClientRect(); if (a) h += `<line x1="${a.x}" y1="${a.y}" x2="${drag.x - q2.left}" y2="${drag.y - q2.top}" style="stroke:${col[drag.team]}" stroke-width="3" stroke-dasharray="6 4"/>`; }
  svg.innerHTML = h;
}
function cancelDrag() { if (drag) { clearTimeout(drag.timer); try { drag.el.releasePointerCapture(drag.pointerId); } catch (e) {} drag.el.classList.remove("dragging"); drag = null; } document.querySelectorAll(".pt.drop").forEach((e) => e.classList.remove("drop")); }
function toggleSkill(pid) { const p = S.battle.all_players.find((x) => x.id === pid), d = S.draft[pid]; if (!readyOf(p)) { const c = p.ghost ? null : p.deck[p.active]; toast(c && c.skill && c.uses < 2 && c.alive ? `${pid}:スキルカウント ${shownCount(p)} のため今は使えません` : `${pid}:今はスキルを使えません`); return; } d.use = !d.use; }
function cycle(pid, field) {
  const p = S.battle.all_players.find((x) => x.id === pid), mates = S.battle.all_players.filter((q) => q.team === p.team), n = Math.min(5, mates.length);
  const used = new Set(mates.filter((q) => q.id !== pid).map((q) => S.draft[q.id][field]).filter((x) => x != null));
  let v = (S.draft[pid][field] == null ? 0 : Number(S.draft[pid][field])) + 1; while (v <= n && used.has(v)) v++;
  S.draft[pid][field] = v <= n ? v : null;
}
document.addEventListener("pointerdown", (e) => {
  const el = e.target.closest(".pt"); if (!el || el.disabled || e.button !== 0 || !S.battle) return;
  cancelDrag(); e.preventDefault();
  drag = { el, pid: el.dataset.pid, team: el.dataset.team, pointerId: e.pointerId, x: e.clientX, y: e.clientY, active: false };
  try { el.setPointerCapture(e.pointerId); } catch (err) {}
});
document.addEventListener("pointermove", (e) => {
  const d = drag; if (!d || d.pointerId !== e.pointerId) return; d.x = e.clientX; d.y = e.clientY;
  if (!d.active) { const r = d.el.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) { d.active = true; d.el.classList.add("dragging"); } }
  if (d.active) { e.preventDefault(); document.querySelectorAll(".pt.drop").forEach((x) => x.classList.remove("drop"));
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest(".pt"); if (hit && hit.dataset.team !== d.team) hit.classList.add("drop"); drawTargets(); }
}, { passive: false });
document.addEventListener("pointerup", (e) => {
  const d = drag; if (!d || d.pointerId !== e.pointerId) return;
  const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest(".pt"), pid = d.pid, was = d.active;
  cancelDrag();
  if (was) { if (hit && hit.dataset.team !== d.team) { S.draft[pid].target = hit.dataset.pid; toast(`${pid} → ${hit.dataset.pid} を狙います`); }
    else if (!hit || hit.dataset.pid === pid) { S.draft[pid].target = ""; toast(`${pid} の狙いを自動に戻しました`); } render(); }
  else { toggleSkill(pid); render(); }
});
document.addEventListener("pointercancel", () => { cancelDrag(); drawTargets(); });
window.addEventListener("resize", () => drawTargets());

/* ---------- 計算履歴 ---------- */
function calcHTML(e) {
  const c = e.calc; if (!c) return "";
  const fac = [`攻撃力 <b>${n1(c.pw)}</b>`];
  if (c.surv !== 1) fac.push(`生存補正 <b>×${n2(c.surv)}</b>`);
  fac.push(`レベル・回答・自力 <b>×${n2(c.answer)}</b>`);
  if (c.up !== 1) fac.push(`攻撃UP <b>×${n2(c.up)}</b>`);
  fac.push(`固定 <b>×${c.const}</b>`, `属性 <b>×${n2(c.attr)}</b>`, `乱数 <b>×${n2(c.rand)}</b>`);
  if (c.cut !== 1) fac.push(`防御カット通過 <b>×${n2(c.cut)}</b>`);
  return `<div class="fx">${fac.join(" ") } → ダメージ <b>${n1(e.damage)}</b><br>HP ${n1(c.hp_before)} → <b>${n1(c.hp_after)}</b> / ${n1(c.max_hp)}${e.killed ? " (撃破)" : ""}</div>`;
}
function eventHTML(e) {
  const head = e.kind === "attack" ? `<div class="hd">${esc(e.calc?.attacker || e.attacker)} → ${esc(e.target)} ${esc(e.calc?.target_name || "")}</div>${calcHTML(e)}`
    : `<div class="tx">${esc(e.text)}</div>${e.details ? `<div class="fx">${e.details.map((d) => `${esc(d.name)}: HP ${n1(d.before)} → <b>${n1(d.after)}</b> / ${n1(d.max_hp)}`).join("<br>")}</div>` : ""}`;
  return `<div class="ev ${esc(e.kind)} ${e.killed ? "kill" : ""}"><span class="st">${STEP_NAME[e.step] || ""}</span><div>${head}</div></div>`;
}
function inputTable(h) {
  const rows = Object.entries(h.input.players).map(([pid, a]) => `<tr><td>${pid}</td><td>${esc(MODE_LABEL[h.mode?.[pid]] || (a.correct ? "Correct回答" : "完全誤答"))}</td><td class="num">${a.rank}</td><td>${PRIO.find((x) => x[0] === a.priority)[1]}</td><td>${a.target || "自動"}</td><td>${a.use_skill ? "使用" : "-"}</td></tr>`).join("");
  return `<div class="tw"><table class="t"><thead><tr><th>プレイヤー</th><th>正誤</th><th>攻撃順</th><th>優先度</th><th>狙い</th><th>スキル</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${h.input.skill_order.length ? `<div class="fx">スキル宣言順: <b>${h.input.skill_order.join(" → ")}</b></div>` : ""}`;
}
function renderHistory() {
  const b = S.battle;
  if (!b || !b.history.length) return `<section class="bt-card"><p class="muted">まだ計算履歴がありません。戦闘画面でターンを実行すると、ここに各ターンのダメージ計算が表示されます。</p></section>`;
  const hs = b.history.map((h, i) => ({ ...h, mode: S.inputs[i]?._modes }));
  const tot = {}; for (const h of hs) for (const e of h.events) if (e.kind === "attack") { const t = (tot[e.attacker] ||= { dealt: 0, hits: 0, kills: 0 }); t.dealt += e.damage; t.hits++; if (e.killed) t.kills++; }
  const sum = Object.entries(tot).sort((a, b2) => a[0].localeCompare(b2[0])).map(([pid, t]) => `<tr><td>${pid}</td><td class="num">${n1(t.dealt)}</td><td class="num">${t.hits}</td><td class="num">${t.kills}</td></tr>`).join("");
  return `<section class="bt-card"><div class="row"><h2>計算履歴</h2><span class="muted">${hs.length}ターン</span><span class="grow"></span><button class="mini-reset" data-act="copylog">テキストでコピー</button></div>
      <div class="tw" style="margin-top:8px"><table class="t"><thead><tr><th>プレイヤー</th><th>与ダメージ合計</th><th>攻撃回数</th><th>撃破数</th></tr></thead><tbody>${sum}</tbody></table></div></section>
    ${hs.slice().reverse().map((h, i) => `<details class="turn" data-turn="${h.turn}" ${i === 0 || S.openTurns.has(h.turn) ? "open" : ""}><summary>ターン${h.turn}${h.finished ? "(終了)" : ""}</summary>
      <div class="tb">${inputTable(h)}<div>${h.events.filter((e) => e.kind !== "answer").map(eventHTML).join("")}</div></div></details>`).join("")}`;
}
function logText() {
  const b = S.battle; if (!b) return "";
  return b.history.map((h, i) => `■ ターン${h.turn}\n` + h.events.filter((e) => e.kind !== "answer").map((e) => {
    if (e.kind !== "attack") return `  [${STEP_NAME[e.step] || ""}] ${e.text}`;
    const c = e.calc; return `  [攻撃] ${c.attacker} → ${e.target} ${c.target_name}: ${n1(c.pw)} ×生存${n2(c.surv)} ×回答${n2(c.answer)} ×UP${n2(c.up)} ×${c.const} ×属性${n2(c.attr)} ×乱数${n2(c.rand)} ×カット${n2(c.cut)} = ${n1(e.damage)} (HP ${n1(c.hp_before)}→${n1(c.hp_after)})${e.killed ? " 撃破" : ""}`;
  }).join("\n")).join("\n\n");
}

const chips = (items, cur, act, extra = "") => items.map((n) => `<button class="chip ${n === cur ? "on" : ""}" data-act="${act}" data-v="${esc(n)}" ${extra}>${esc(n)}</button>`).join("");
/* キャラ選択は図鑑・計算機と同じ共通の選択画面(catalog.js の openBattlePicker)。選んだキャラは deckPlace でデッキに入れる。同じキャラ・伝2体は不可 */
/* デッキは常に5枠(空き枠あり)。外しても後ろのキャラは詰めない。同じキャラ・伝2体は同じデッキに入れられない */
function deckOK(list) {
  const cs = list.filter(Boolean);
  return new Set(cs.map((x) => x.id)).size === cs.length && cs.filter((x) => BYID.get(x.id)?.r === "伝").length <= 1;
}
function deckPlace(t, pi, id, at) {
  const deck = S.setup[t][pi].deck, sp = specOf(id);
  if (at == null || at < 0) at = deck.findIndex((x) => !x);
  if (at < 0) return toast("デッキがいっぱいです。入れ替えたい枠を押してから選んでください");
  const next = deck.slice(); sp.theme = !!deck[at]?.theme; next[at] = sp;
  if (!deckOK(next)) return toast("同じキャラ・伝2体は同じデッキに入れられません");
  deck[at] = sp; S.battle = null; save(); render();
}
const slotAt = (id) => { const [t, pi, ci] = id.split(":"); return { t, pi: +pi, ci: +ci, deck: S.setup[t]?.[+pi]?.deck }; };
function afterDeckEdit() { S.battle = null; save(); render(); renderPickerDeck(); }
/* ドラッグ&ドロップ(部品は app.js の registerCharDrag): 枠どうし(同じデッキ内・別のデッキ・キャラ選択画面の上のデッキ)で入れ替え、お気に入りや選択画面の一覧からは枠に置く */
registerCharDrag("btslot", {
  get: (id) => { const s = slotAt(id), x = s.deck?.[s.ci]; return x ? chars.find((k) => characterKey(k) === String(x.id)) || null : null; },
  swap: (a, b) => {
    const A = slotAt(a), B = slotAt(b), x = A.deck[A.ci], y = B.deck[B.ci], na = A.deck.slice(), nb = A.deck === B.deck ? na : B.deck.slice();
    na[A.ci] = y; nb[B.ci] = x;
    if (!deckOK(na) || !deckOK(nb)) return toast("同じキャラ・伝2体は同じデッキに入れられません");
    if (!na.some(Boolean) || !nb.some(Boolean)) return toast("デッキは最低1体必要です");
    A.deck.splice(0, 5, ...na); if (B.deck !== A.deck) B.deck.splice(0, 5, ...nb);
    afterDeckEdit();
  },
  place: (id, ch) => { const s = slotAt(id), cid = ch?.details?.id ?? ch?.id; if (!BYID.has(cid)) return toast("このキャラは対戦に使えません"); deckPlace(s.t, s.pi, cid, s.ci); renderPickerDeck(); }
});
/* キャラ選択中は、そのプレイヤーのデッキを選択画面の上に出し続ける(枠を押すとその枠が入れ替え先になる。×で外す) */
let pk = null;
function pickerDeckHTML() {
  const d = S.setup[pk.t][pk.pi].deck;
  return `<div class="pk-deck-slots">${d.map((c, i) => { const dr = `data-char-drag="btslot:${pk.t}:${pk.pi}:${i}"`;
    return `<div class="pk-deck-slot ${pk.sel === i ? "on" : ""}">${c
      ? tileHTML(c.id, c.attrs, `<button type="button" class="x" data-pk="del" data-i="${i}" aria-label="外す">×</button>`, "", "div", `data-pk="sel" data-i="${i}" role="button" tabindex="0" aria-label="${i + 1}番目を入れ替える" ${dr}`)
      : `<button type="button" class="tile empty" data-pk="sel" data-i="${i}" aria-label="${i + 1}番目に入れる" ${dr}>＋</button>`}</div>`; }).join("")}</div>`;
}
function renderPickerDeck() { const el = document.getElementById("pickerDeck"); if (el && pk) el.innerHTML = pickerDeckHTML(); }
function openSlotPicker(t, pi, ci) {
  pk = { t, pi, sel: ci >= 0 ? ci : null };
  renderPickerDeck();
  window.openBattlePicker((ch) => { const id = ch?.details?.id ?? ch?.id; if (BYID.has(id)) { deckPlace(t, pi, id, pk.sel ?? -1); pk.sel = null; } else toast("このキャラは対戦に使えません"); renderPickerDeck(); },
    `${S.setup[t][pi].id} のキャラを選択`, true);
}
document.getElementById("pickerDeck")?.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-pk]"); if (!el || !pk) return;
  const act = el.dataset.pk, i = Number(el.dataset.i), deck = S.setup[pk.t][pk.pi].deck;
  if (act === "del") { ev.stopPropagation(); if (deck.filter(Boolean).length > 1) { deck[i] = null; pk.sel = null; afterDeckEdit(); } else toast("デッキは最低1体必要です"); return; }
  pk.sel = pk.sel === i ? null : i; renderPickerDeck();
});
/* ---------- 入出力 ---------- */
function ioHTML() {
  return `<div class="overlay"><div class="modal" role="dialog" aria-label="編成のJSON"><div class="mh"><div class="row"><h2>編成のJSON</h2><span class="grow"></span><button class="mini-reset" data-act="closeio">閉じる</button></div>
    <div class="muted">コピーして保存できます。貼り付けて「読み込む」と編成を置き換えます。</div></div>
    <div class="mb"><textarea id="iotext" spellcheck="false">${esc(S.io)}</textarea>
      <div class="row" style="margin-top:8px"><button class="reset-btn" data-act="iocopy">コピー</button><button class="primary" data-act="ioload">読み込む</button></div></div></div></div>`;
}

/* ---------- 描画 ---------- */
let rendering = false, again = false;
function render() {
  if (rendering) { again = true; return; }
  rendering = true;
  try { renderNow(); } finally { rendering = false; }
  if (again) { again = false; render(); }
}
function renderNow() {
  const keep = window.scrollY; if (S.anim) fxCleanup(); S.anim = null;
  document.body.classList.toggle("autorun", !!S.autorun);
  $("#battleTabs").innerHTML = [["select", "キャラ選択"], ["battle", "戦闘"], ["history", "計算履歴"]].map(([k, l]) =>
    `<button type="button" class="${S.tab === k ? "active" : ""}" role="tab" data-act="tab" data-k="${k}" aria-selected="${S.tab === k}">${l}</button>`).join("");
  $("#battleApp").innerHTML = S.tab === "select" ? renderSelect() : S.tab === "battle" ? renderBattle() : renderHistory();
  $("#battleModal").innerHTML = S.fx && S.battle ? fxHTML() : S.skc && S.battle ? skcHTML() : "";
    window.scrollTo(0, keep);
  if (S.tab === "battle") requestAnimationFrame(drawTargets);
  save();
}

/* ---------- イベント ---------- */
function ctx(el) {
  const r = el.closest(".prow"); if (!r) return {};
  const t = r.dataset.t, pi = Number(r.dataset.pi), slot = el.closest(".slotwrap");
  return { t, pi, p: S.setup[t][pi], ci: slot && slot.dataset.ci !== undefined ? Number(slot.dataset.ci) : null };
}
document.addEventListener("click", (ev) => {
  if (!ev.target.closest("#page-battle")) return;
  const el = ev.target.closest("[data-act]"); if (!el) return;
  if (el.classList.contains("overlay") && ev.target !== el) return;
  const act = el.dataset.act, c = ctx(el);
  if (S.autorun && act !== "autorun") return;   // 自動操作中は、止めるボタン以外は押せない
  if (act === "delc" ) { ev.stopPropagation(); if (c.p.deck.filter(Boolean).length > 1) c.p.deck[c.ci] = null; else toast("デッキは最低1体必要です"); }
  else if (act === "tab") { S.tab = el.dataset.k; render(); return; }
  else if (act === "addc") { openSlotPicker(c.t, c.pi, c.ci); return; }
  else if (act === "editc") { openSlotPicker(c.t, c.pi, c.ci); return; }
  else if (act === "shibari") S.auto.shibari = el.dataset.v;
  else if (act === "band") S.auto.band = el.dataset.v;
  else if (act === "autoall" || act === "autoone") {
    S.auto.seed = Math.floor(Math.random() * 1e9) + 1;
    const short = autoDecks(S.auto, S.setup, act === "autoall" ? null : (t, p) => p === c.p); S.battle = null;
    if (short) toast("この縛り・縛りコストでは5体そろえられないデッキがありました");
  }
  else if (act === "start") { if (startBattle()) S.tab = "battle"; }
  else if (act === "restart") startBattle();
  else if (act === "undo") replay(S.inputs.length - 1);
  else if (act === "run") { stopAuto(); runTurn(); return; }
  else if (act === "autorun") { autoRun(); return; }
  else if (act === "aidraft") { toast("自動で決めています…"); setTimeout(() => { aiDraft(); render(); }, 30); return; }
  else if (act === "skilltoggle") { if (ev.detail !== 0) return; toggleSkill(el.dataset.pid); }
  else if (act === "rank" || act === "srank") cycle(el.dataset.pid, act === "rank" ? "rank" : "order");
  else if (act === "ans") { const d = S.draft[el.dataset.pid], i = MODES.findIndex((m) => m[0] === d.mode); d.mode = MODES[(i + 1) % MODES.length][0]; }
  else if (act === "fx") { S.fx = el.dataset.pid; }
  else if (act === "skc") { S.skc = true; }
  else if (act === "closeskc") { if (el.classList.contains("overlay") && ev.target !== el) return; S.skc = false; }
  else if (act === "closefx") { if (el.classList.contains("overlay") && ev.target !== el) return; S.fx = null; }
  else if (act === "fxtoggle") { try { localStorage.setItem("eigo2-fx", fxOn() ? "off" : "on"); } catch (e) {} }
  else if (act === "fxdmg") { try { localStorage.setItem("eigo2-fxdmg", fxDmgOn() ? "off" : "on"); } catch (e) {} }
  else if (act === "speedy") { try { localStorage.setItem("eigo2-speedy", speedyOn() ? "off" : "on"); } catch (e) {} }
  else if (act === "view") S.view = 1 - (S.view || 0);
  else if (act === "rankreset" || act === "srankreset") { const f = act === "rankreset" ? "rank" : "order"; const side = ["A", "B"][S.view || 0]; for (const p of S.battle.all_players) if (p.team === side) S.draft[p.id][f] = null; }   // 視点(手前)のチームだけリセット
  else if (act === "copylog") { const t = logText(); (navigator.clipboard?.writeText(t) || Promise.reject()).then(() => toast("コピーしました"), () => toast("コピーできませんでした")); return; }
  else return;
  save(); render();
});
document.addEventListener("change", (ev) => {
  const el = ev.target; if (!el.closest("#page-battle")) return;
  if (el.dataset.auto) { const k = el.dataset.auto; S.auto[k] = el.type === "checkbox" ? el.checked : (k === "seed" || k === "size") ? Number(el.value) : el.value; save(); return; }
  if (el.dataset.size) { const t = el.dataset.size, n = Number(el.value), a = S.setup[t];
    while (a.length > n) a.pop();
    while (a.length < n) a.push(sampleSetup()[t][a.length]);
    a.forEach((p, i) => (p.id = `${t}${i + 1}`, p.name = p.id)); save(); render(); return; }
  if (el.dataset.f) { const c = ctx(el); c.p[el.dataset.f] = el.type === "checkbox" ? el.checked : el.value; save(); return; }
  if (el.dataset.c) { const c = ctx(el); c.p.deck[c.ci][el.dataset.c] = el.checked; save(); render(); return; }
  if (el.dataset.d) { const pid = el.closest("[data-pid]").dataset.pid, k = el.dataset.d; S.draft[pid][k] = el.value; render(); return; }
  if (el.hasAttribute("data-autoans")) { S.autoAns = el.value; save(); return; }
});
document.addEventListener("toggle", (ev) => { const d = ev.target; if (d.classList?.contains("turn")) { const n = Number(d.dataset.turn); d.open ? S.openTurns.add(n) : S.openTurns.delete(n); } }, true);

load();
render();
imgRestore();
window.battleRender = render;
};
