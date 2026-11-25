/* 英語物語 対戦 自動操作AI(ブラウザ/Node 両対応)
 * 1ターン分の操作(スキルを使うか・スキル順・狙い・攻撃の優先/回答/劣後)を、盤面から決める。
 * 方針はパラメータ θ で表し、大量の仮想対戦(tools/train_ai.js)で強いものを選んだ値を LEARNED に入れている。
 *   const inp = EigoAI.decide(battle, "A", answers, EigoAI.LEARNED);   // answers: {pid: {correct, answer_code, rank}}
 */
(function (root) {
"use strict";

// 学習済みパラメータ(tools/train_ai.js の結果で置き換える)
let LEARNED = {  // tools/train_ai.js で学習(60世代・約23万試合)。検証: 何もしない基準に勝率66.9%、初期値に58.8%
  w_kill: 0.2477,
  w_frac: 2.5909,
  w_threat: 2.3596,
  w_ready: 0.0678,
  w_leader: 0.1116,
  w_attr: 2.1685,
  w_low: -0.549,
  overkill: 2.1882,
  prio_kill: 0.4163,
  prio_none: 0.8309,
  late_weak: 0.7219,
  off_always: 0.9904,
  def_thr: 0.5224,
  heal_thr: 0.3341,
  shorten_min: 2.0873,
  delay_min: 1.5004,
  cc_gain: 0.0146,
  ord_delay: 3.8778,
  ord_shorten: 2.0623,
  ord_color: 1.6877,
  ord_off: 0.6035,
  ord_def: 2.4945,
  ord_heal: 4.5761,
  ord_revive: 3.3819,
  w_left: 2,  // 残りキャラが多いプレイヤーを狙う(tools/exp_hypo.js で検証: 0→2 で対戦スコア 50%→53%)
};

const OFF = new Set(["atk_up", "multi_attack", "all_attack"]);
const DEF = new Set(["shield", "cover", "def_up"]);

function effTypes(c) { return c && c.skill ? (c.skill.effects || []).map((e) => e.type) : []; }
function mainType(c) { const t = effTypes(c); return t[0] || null; }
function ready(b, p) {
  const c = p.ghost ? null : p.active_char;
  return !!(c && c.alive && c.skill && c.uses < b.rules.max_skill_uses && c.count <= 0);
}

/* 期待攻撃力(乱数=1)。攻撃UPは現在かかっている効果+(予定)使うスキル */
function atkPower(b, p, ans, extraUp) {
  const c = p.active_char, r = b.rules;
  if (p.ghost) return { base: r.ghost_power * 1.0, hits: 1, all: false, ups: [] };
  const team = b.teams[p.team];
  const effs = team.effects.filter((e) => b._applies(e, c));
  const ups = effs.filter((e) => e.kind === "atk_up").map((e) => [parseFloat(e.data.bonus ?? 0), e.data.vs_attr ?? null]).concat(extraUp && extraUp.ups ? extraUp.ups : []);
  let hits = 1 + effs.filter((e) => e.kind === "multi_attack").reduce((s, e) => s + (parseInt(e.data.hits ?? 2, 10) - 1), 0) + (extraUp && extraUp.hits ? extraUp.hits : 0);
  const all = effs.some((e) => e.kind === "all_attack") || !!(extraUp && extraUp.all);
  const am = b._answer_mult({ level: ans.level ?? p.level, answer_code: ans.answer_code ?? 0, self_mode: ans.self_mode ?? p.self_mode });
  return { base: c.power * Math.pow(r.survival_mult, c.survived) * am, hits, all, ups };
}
function hitDamage(b, atkP, atkAttrs, tc, ghost) {
  const r = b.rules;
  let power = atkP.base, mult;
  if (ghost) mult = r.ghost_attr_mult;
  else {
    const ta = b.effective_attrs(tc);
    for (const [bo, vs] of atkP.ups) if (vs === null || ta.includes(vs)) power *= 1 + bo;
    mult = b.attr_mult(atkAttrs, ta);
  }
  const cuts = [];
  const dt = b.teams[tc.team];
  for (const e of dt.effects) if ((e.kind === "shield" || e.kind === "def_up") && b._applies(e, tc)) { const vs = e.data.vs_attr ?? null; if (vs === null || atkAttrs.includes(vs)) cuts.push(parseFloat(e.data.cut ?? 0)); }
  const pass = cuts.length ? b._cut_pass(cuts) : 1;
  return power * r.damage_const * mult * pass * r.static_mult;
}

/* その相手が今ターンに与えてくる見込みダメージ(ざっくり: 自軍の誰か1体に) */
function threatOf(b, ep, eAns) {
  if (ep.ghost) return b.rules.ghost_power * 0.5;
  const ec = ep.active_char; if (!ec || !ec.alive) return 0;
  return ec.power * Math.pow(b.rules.survival_mult, ec.survived) * 0.5 * 1.6;
}

/* スキルを使うか */
function wantSkill(b, p, side, th, ctx) {
  const c = p.active_char, t = mainType(c), eff = (c.skill.effects || [])[0] || {};
  const team = b.teams[side], enemy = b.enemy_of(side);
  const fronts = team.players.filter((q) => !q.ghost && q.active_char && q.active_char.alive).map((q) => q.active_char);
  const efronts = enemy.players.filter((q) => !q.ghost && q.active_char && q.active_char.alive).map((q) => q.active_char);
  if (t === "revive") return true;                         // 実機: 対象がいなければ消費しない
  if (OFF.has(t)) return th.off_always >= 0.5 || ctx.killGain(p, eff) > 0;
  if (DEF.has(t)) { const danger = fronts.some((x) => ctx.incoming(x) >= x.hp * th.def_thr); return danger; }
  if (t === "heal") return fronts.some((x) => x.hp < x.max_hp * th.heal_thr);
  if (t === "shorten") return fronts.filter((x) => x !== c && x.skill && x.uses < 2 && x.count > 0 && x.count <= (eff.amount ?? 1) + th.shorten_min).length > 0;
  if (t === "delay") return efronts.filter((x) => x.skill && x.uses < 2 && x.count <= (eff.amount ?? 1) + th.delay_min - 1).length > 0;
  if (t === "color_change") {
    const to = [].concat(eff.to || []); if (!to.length) return false;
    const tgtEnemy = eff.scope === "enemy";
    const mine = (tgtEnemy ? efronts : fronts), opp = tgtEnemy ? fronts : efronts;
    if (!mine.length || !opp.length) return false;
    let before = 0, after = 0;
    for (const x of mine) for (const y of opp) {
      const xa = b.effective_attrs(x), ya = b.effective_attrs(y);
      if (tgtEnemy) { before += b.attr_mult(ya, xa); after += b.attr_mult(ya, to); }   // 相手の色を変える: 相手→自分の倍率が下がるほど良い
      else { before += b.attr_mult(xa, ya) - 0.5 * b.attr_mult(ya, xa); after += b.attr_mult(to, ya) - 0.5 * b.attr_mult(ya, to); }
    }
    const n = mine.length * opp.length;
    return tgtEnemy ? (before - after) / n > th.cc_gain : (after - before) / n > th.cc_gain;
  }
  return true;
}
function orderKey(t, th) {
  if (t === "delay") return th.ord_delay;
  if (t === "shorten") return th.ord_shorten;
  if (t === "color_change") return th.ord_color;
  if (OFF.has(t)) return th.ord_off;
  if (DEF.has(t)) return th.ord_def;
  if (t === "heal") return th.ord_heal;
  return th.ord_revive;
}

/* 1陣営分の操作を決める。answers は {pid: {correct, answer_code, rank, level?, self_mode?}}(正誤・速さはプレイヤーの実力なので入力扱い) */
function decide(b, side, answers, th) {
  th = Object.assign({}, LEARNED, th || {});
  const team = b.teams[side], enemy = b.enemy_of(side);
  const out = {}, order = [];
  const ans = (p) => answers[p.id] || { correct: true, answer_code: 0 };
  const eAlive = enemy.players.filter((q) => !q.ghost && q.active_char && q.active_char.alive);
  const eTotalThreat = eAlive.reduce((s, q) => s + threatOf(b, q), 0) || 1;
  const maxThreat = Math.max(1, ...eAlive.map((q) => threatOf(b, q)));
  const incoming = (x) => eTotalThreat / Math.max(1, team.players.filter((q) => !q.ghost).length);

  // 攻撃する味方と、その期待攻撃力
  const attackers = team.players.filter((p) => ans(p).correct && (p.ghost || (p.active_char && p.active_char.alive)));
  const plan = (p, extra) => atkPower(b, p, ans(p), extra);
  const killsWith = (extraMap) => {
    const rem = new Map(eAlive.map((q) => [q.id, q.active_char.hp]));
    let kills = 0;
    for (const p of attackers) {
      const pw = plan(p, extraMap.get(p.id)), attrs = p.ghost ? [] : b.effective_attrs(p.active_char);
      for (let h = 0; h < pw.hits; h++) {
        const tg = pw.all ? eAlive : [eAlive.slice().sort((x, y) => rem.get(x.id) - rem.get(y.id)).find((q) => rem.get(q.id) > 0)].filter(Boolean);
        for (const q of tg) { if (rem.get(q.id) <= 0) continue; const d = hitDamage(b, pw, attrs, q.active_char, p.ghost); rem.set(q.id, rem.get(q.id) - d); if (rem.get(q.id) <= 0) kills++; }
      }
    }
    return kills;
  };
  const baseKills = killsWith(new Map());
  const offExtra = (p, eff) => {
    const m = new Map();
    const scopeAll = (eff.scope ?? "self") !== "self";
    const ex = eff.type === "atk_up" ? { ups: [[parseFloat(eff.bonus ?? 0), eff.vs_attr ?? null]] } : eff.type === "multi_attack" ? { hits: (eff.hits ?? 2) - 1 } : { all: true };
    for (const q of attackers) if (q === p || scopeAll) m.set(q.id, ex);
    return m;
  };
  const ctx = { killGain: (p, eff) => killsWith(offExtra(p, eff)) - baseKills, incoming };

  // 1) スキル
  const using = [];
  for (const p of team.players) {
    out[p.id] = { correct: ans(p).correct, answer_code: ans(p).answer_code ?? 0, rank: ans(p).rank, priority: "normal", target: null, use_skill: false };
    if (p.cpu || !ready(b, p)) continue;
    if (wantSkill(b, p, side, th, ctx)) { out[p.id].use_skill = true; using.push(p); }
  }
  using.sort((x, y) => orderKey(mainType(x.active_char), th) - orderKey(mainType(y.active_char), th));
  for (const p of using) order.push(p.id);

  // 予定スキルの攻撃強化を反映した攻撃力
  const extra = new Map();
  for (const p of using) { const eff = (p.active_char.skill.effects || [])[0]; if (eff && OFF.has(eff.type)) for (const [k, v] of offExtra(p, eff)) { const cur = extra.get(k) || {}; extra.set(k, { ups: (cur.ups || []).concat(v.ups || []), hits: (cur.hits || 0) + (v.hits || 0), all: cur.all || v.all }); } }

  // 2) 狙い: 攻撃力の高い順に、残りHP見込みを減らしながら割り当てる
  const rem = new Map(eAlive.map((q) => [q.id, q.active_char.hp]));
  const leaderId = enemy.leader;
  const atkInfo = attackers.map((p) => ({ p, pw: plan(p, extra.get(p.id)), attrs: p.ghost ? [] : b.effective_attrs(p.active_char) }))
    .sort((x, y) => y.pw.base - x.pw.base);
  const killers = new Set();
  for (const a of atkInfo) {
    if (!eAlive.length) break;
    if (a.pw.all) { for (const q of eAlive) rem.set(q.id, rem.get(q.id) - a.pw.hits * hitDamage(b, a.pw, a.attrs, q.active_char, a.p.ghost)); continue; }
    let best = null, bs = -1e9;
    for (const q of eAlive) {
      const r0 = rem.get(q.id), qc = q.active_char;
      const d = a.pw.hits * hitDamage(b, a.pw, a.attrs, qc, a.p.ghost);
      const kill = r0 > 0 && d >= r0 ? 1 : 0;
      const over = r0 <= 0 ? 1 : 0;
      const s = th.w_kill * kill + th.w_frac * Math.min(1, d / Math.max(1, r0)) + th.w_threat * threatOf(b, q) / maxThreat
        + th.w_ready * (ready(b, q) ? 1 : 0) + th.w_leader * (q.id === leaderId ? 1 : 0)
        + th.w_attr * (a.p.ghost ? 0 : b.attr_mult(a.attrs, b.effective_attrs(qc)) - 1) + th.w_low * (1 - r0 / qc.max_hp) - th.overkill * over
        + (th.w_left || 0) * q.deck.filter((x) => x.alive).length / 5;   // 残りキャラが多いプレイヤーを狙う
      if (s > bs) { bs = s; best = q; }
    }
    out[a.p.id].target = best.id;
    const d = a.pw.hits * hitDamage(b, a.pw, a.attrs, best.active_char, a.p.ghost);
    if (rem.get(best.id) > 0 && d >= rem.get(best.id)) killers.add(a.p.id);
    rem.set(best.id, rem.get(best.id) - d);
  }

  // 3) 攻撃の優先/回答/劣後
  for (const a of atkInfo) {
    const o = out[a.p.id];
    if (th.prio_kill >= 0.5 && killers.has(a.p.id)) o.priority = "priority";
    else if (th.prio_none >= 0.5) o.priority = "priority";
    else if (th.late_weak >= 0.5 && !killers.has(a.p.id)) o.priority = "delay";
  }
  return { players: out, skill_order: order };
}

/* 両陣営の入力をまとめる(どちらかを AI 以外にする場合は片方だけ使う) */
function decideBoth(b, answers, thA, thB) {
  const a = decide(b, "A", answers, thA), c = decide(b, "B", answers, thB);
  return { players: Object.assign({}, a.players, c.players), skill_order: interleave(a.skill_order, c.skill_order) };
}
function interleave(x, y) { const o = []; for (let i = 0; i < Math.max(x.length, y.length); i++) { if (i < x.length) o.push(x[i]); if (i < y.length) o.push(y[i]); } return o; }

/* 何もしない基準(スキルは使える時に必ず使う、狙い・順番は指定なし) */
function baseline(b, side, answers) {
  const out = {}, order = [];
  for (const p of b.teams[side].players) {
    const a = answers[p.id] || { correct: true, answer_code: 0 };
    out[p.id] = { correct: a.correct, answer_code: a.answer_code ?? 0, rank: a.rank, priority: "normal", target: null, use_skill: ready(b, p) && !p.cpu };
    if (out[p.id].use_skill) order.push(p.id);
  }
  return { players: out, skill_order: order };
}

const api = { decide, decideBoth, baseline, interleave, get LEARNED() { return LEARNED; }, setLearned(x) { LEARNED = Object.assign({}, LEARNED, x); } };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.EigoAI = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
