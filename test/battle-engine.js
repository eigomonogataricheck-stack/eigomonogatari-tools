/* 英語物語 対戦イベント 仮想対戦エンジン (engine.py の忠実な JS 移植)
 * ブラウザ/Node 両対応。依存なし。入出力はすべて JSON 互換オブジェクト。
 *   const b = new Battle(setup); const log = b.step(turnInput); b.state();
 */
(function (root) {
"use strict";

const DEFAULT_RULES = {
  max_turns: 40,
  survival_mult: 1.3,
  theme_mult: 1.5,
  limit_break_mult: 1.6,
  answer_code_mult: { "1": 1.2, "6": 0.5 },
  self_mode_mult: 1.2,
  default_level: "中学1年生",
  level_mult: { "小学生": 1.45, "中学1年生": 1.50, "中学2年生": 1.55, "中学3年生": 1.60,
                "高校1年生": 1.65, "高校2年生": 1.70, "高校3年生": 1.75, "難関大学": 1.80 },
  ghost_power: 1000,
  ghost_attr_mult: 1.0,
  count_step: 1,
  max_skill_uses: 2,
  max_hp_rate: 2.0,
  attr_beats: { "水": "火", "火": "風", "風": "水" },
  attr_mult: { advantage: 1.5, same: 1.0, disadvantage: 0.5 },
  damage_const: 0.5,
  damage_rand: [0.9, 1.1],
  static_mult: 1.0,
  damage_rounding: "none",
  random_target: true,
  seed: null,
  cut_stack_base: 3,
  all_attack_ignores_cover: false,
  revive_per_player: 1,
};
const PRIORITY_ALIASES = { "優先": "priority", "回答": "normal", "劣後": "delay",
                           priority: "priority", normal: "normal", delay: "delay" };
const PRIORITY_ORDER = { priority: 0, normal: 1, delay: 2 };
const DEFAULT_SCOPE = { atk_up: "self", all_attack: "self", multi_attack: "self", heal: "self",
                        shield: "team", def_up: "team", color_change: "team" };

const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
function deepMerge(base, over) {
  const out = clone(base);
  for (const [k, v] of Object.entries(over || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = clone(v);
  }
  return out;
}
// Python の round() (偶数丸め) 互換
function pyRound(x) {
  const f = Math.floor(x), d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}
const round6 = (x) => Math.round(x * 1e6) / 1e6;

// 乱数 (mulberry32)。seed=null なら Math.random 由来
function makeRng(seed) {
  let a = (seed === null || seed === undefined) ? Math.floor(Math.random() * 2 ** 32) : (seed >>> 0);
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { random: next, uniform: (lo, hi) => lo + (hi - lo) * next(), choice: (arr) => arr[Math.floor(next() * arr.length)],
    getState: () => a, setState: (v) => { a = v >>> 0; } };
}

class Char {
  constructor(pid, team, idx, spec, rules) {
    this.uid = `${pid}-${idx + 1}`;
    this.pid = pid; this.team = team; this.idx = idx;
    this.name = spec.name ?? this.uid;
    this.base_attrs = [...(spec.attrs || [])];
    this.cost = spec.cost ?? 0;
    this.theme = !!spec.theme;
    this.limit_break = !!spec.limit_break;
    let mult = 1.0;
    if (this.theme) mult *= rules.theme_mult;
    if (this.limit_break) mult *= rules.limit_break_mult;
    let hp0 = spec.hp ?? 1000, pw0 = spec.power ?? 500;
    if (this.limit_break && spec.limit_hp != null && spec.limit_power != null) {
      hp0 = spec.limit_hp; pw0 = spec.limit_power;
      mult = this.theme ? rules.theme_mult : 1.0;
    }
    this.max_hp = Math.max(1, pyRound(hp0 * mult));
    this.power = pyRound(pw0 * mult);
    this.hp = this.max_hp;
    this.skill = spec.skill ? clone(spec.skill) : null;
    this.skill_turn = this.skill ? parseInt(this.skill.turn ?? 3, 10) : 0;
    this.count = this.skill_turn;
    this.uses = 0; this.survived = 0; this.alive = true; this.revived_used = false; this.death_seq = -1;
    this.used_now = false; this.delayed_now = false; // APK: nsCount=-9998(使用済み) / isCountDelayed
    this.cid = spec.id ?? null;
  }
  toDict(effAttrs) {
    return { uid: this.uid, cid: this.cid, name: this.name, attrs: this.base_attrs, eff_attrs: effAttrs, cost: this.cost, theme: this.theme,
      limit_break: this.limit_break, hp: this.hp, max_hp: this.max_hp, power: this.power, alive: this.alive, count: this.count,
      skill_turn: this.skill_turn, uses: this.uses, survived: this.survived, revived_used: this.revived_used, used_now: this.used_now, delayed_now: this.delayed_now, skill: this.skill };
  }
}

class Player {
  constructor(pid, team, spec, rules) {
    this.id = pid; this.team = team;
    this.name = spec.name ?? pid;
    this.level = spec.level ?? rules.default_level;
    this.self_mode = !!spec.self_mode;
    this.cpu = !!spec.cpu;
    this.deck = (spec.deck || []).map((c, i) => new Char(pid, team, i, c, rules));
    if (!this.deck.length) throw new Error(`${pid}: deck is empty`);
    this.active = 0; this.ghost = false; this.target = null; this.target_char = null;
  }
  get active_char() { return this.active !== null ? this.deck[this.active] : null; }
}

class Effect {
  constructor(kind, data, owner, team, remaining, seq) {
    this.kind = kind; this.data = data; this.owner = owner; this.team = team; this.remaining = remaining; this.seq = seq;
  }
  toDict() {
    return { kind: this.kind, owner: this.owner ? this.owner.uid : null, owner_name: this.owner ? this.owner.name : null,
      remaining: this.remaining, data: this.data };
  }
}

class Act {
  constructor(player, char) { this.player = player; this.char = char; this.skill = char.skill; this.committed = false; this.cancelled = false; }
}

class Team {
  constructor(tid, players, leader) {
    this.id = tid; this.players = players;
    this.leader = leader || players[0].id;
    if (!players.some((p) => p.id === this.leader)) throw new Error(`team ${tid}: unknown leader ${this.leader}`);
    this.effects = [];
  }
  alive() { return this.players.some((p) => !p.ghost); }
}

class Battle {
  constructor(setup, rules) {
    this.rules = deepMerge(DEFAULT_RULES, deepMerge(setup.rules || {}, rules || {}));
    this.constraint = setup.constraint || {};
    this.teams = {};
    for (const tid of ["A", "B"]) {
      const raw = setup.teams[tid];
      const plist = Array.isArray(raw) ? raw : raw.players;
      const players = plist.map((spec, i) => new Player(spec.id ?? `${tid}${i + 1}`, tid, spec, this.rules));
      if (players.length < 1 || players.length > 5) throw new Error(`team ${tid}: players must be 1..5`);
      this.teams[tid] = new Team(tid, players, Array.isArray(raw) ? null : raw.leader);
    }
    this.all_players = [...this.teams.A.players, ...this.teams.B.players];
    this.players = {};
    for (const p of this.all_players) this.players[p.id] = p;
    if (Object.keys(this.players).length !== this.all_players.length) throw new Error("player ids must be unique");
    this.rng = makeRng(this.rules.seed);
    this.turn = 0; this.finished = false; this.result = null;
    this._seq = 0; this._death_seq = 0;
    this._events = []; this._acts = []; this._revived_now = new Set(); this.history = [];
  }

  enemy_of(tid) { return this.teams[tid === "A" ? "B" : "A"]; }
  _ev(step, kind, text, data) { this._events.push({ turn: this.turn, step, kind, text, ...(data || {}) }); }

  validate() {
    const warns = [], mc = this.constraint.max_cost, allowed = this.constraint.attrs;
    for (const p of this.all_players) {
      const total = p.deck.reduce((s, c) => s + c.cost, 0);
      if (mc != null && total > mc) warns.push(`${p.id}: デッキコスト ${total} が上限 ${mc} を超えています`);
      if (p.deck.length > 5) warns.push(`${p.id}: デッキが5体を超えています`);
      if (allowed) for (const c of p.deck) if (!c.base_attrs.some((a) => allowed.includes(a))) warns.push(`${c.uid} ${c.name}: 属性 ${c.base_attrs} が縛り ${allowed} に合いません`);
    }
    return warns;
  }

  effective_attrs(ch) {
    let attrs = ch.base_attrs;
    for (const e of this.teams[ch.team].effects) if (e.kind === "color_change" && this._applies(e, ch, false)) attrs = e.data.to ?? attrs;
    return [...attrs];
  }
  _applies(e, ch, checkAttr = true) {
    const scope = e.data.scope ?? DEFAULT_SCOPE[e.kind] ?? "team";
    let ok;
    if (scope === "self") ok = e.owner !== null && ch.pid === e.owner.pid;   // APK: 「自身」はプレイヤー単位(交代しても引き継ぐ)
    else if (scope === "leader") ok = ch.team === e.team && ch.pid === this.teams[e.team].leader;
    else ok = ch.team === e.team;
    if (ok && checkAttr && e.data.attr) ok = this.effective_attrs(ch).includes(e.data.attr);
    return ok;
  }
  _fronts(team, aliveOnly = true) {
    const out = [];
    for (const p of team.players) { const c = p.active_char; if (c && !p.ghost && (c.alive || !aliveOnly)) out.push(c); }
    return out;
  }
  attr_mult(atk, def) {
    const beats = this.rules.attr_beats, m = this.rules.attr_mult;
    if (!atk.length || !def.length) return m.same;
    const vals = [];
    for (const a of atk) for (const d of def) vals.push(a === d ? m.same : beats[a] === d ? m.advantage : m.disadvantage);
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  }
  _roll() { const [lo, hi] = this.rules.damage_rand; return lo === hi ? lo : this.rng.uniform(lo, hi); }
  _round_dmg(x) {
    const mode = this.rules.damage_rounding;
    if (mode === "none") return round6(x);
    return { round: (v) => Math.floor(v + 0.5), floor: Math.floor, ceil: Math.ceil }[mode](x);
  }
  _answer_mult(a) {
    const r = this.rules;
    let m = r.level_mult[a.level];
    m *= r.answer_code_mult[String(a.answer_code)] ?? 1.0;
    if (a.self_mode) m *= r.self_mode_mult;
    return m;
  }
  _cut_pass(cuts) {
    const base = this.rules.cut_stack_base;
    let passed = 1.0;
    [...cuts].sort((a, b) => b - a).forEach((c, i) => { passed *= 1 - (c * base) / (2 * i + base); });
    return passed;
  }

  _parse_inputs(inp) {
    const given = inp.players || {};
    for (const pid of Object.keys(given)) if (!this.players[pid]) throw new Error(`unknown player id: ${pid}`);
    const out = {};
    this.all_players.forEach((p, i) => {
      let a = given[p.id] || {};
      const pr = PRIORITY_ALIASES[a.priority ?? "normal"];
      if (!pr) throw new Error(`${p.id}: invalid priority ${a.priority}`);
      const lv = a.level ?? p.level;
      if (!(lv in this.rules.level_mult)) throw new Error(`${p.id}: unknown level ${lv}`);
      const tgt = a.target ?? null;
      if (tgt !== null && (!this.players[tgt] || this.players[tgt].team === p.team)) throw new Error(`${p.id}: invalid target ${tgt}`);
      if (p.cpu) {
        const c = p.active_char;
        const ready = !p.ghost && c && c.alive && c.skill && c.uses < this.rules.max_skill_uses && c.count <= 0;
        a = { ...a, correct: true, answer_code: 0, excellent: false, use_skill: !!ready };
      }
      out[p.id] = {
        correct: a.correct === undefined ? true : !!a.correct,
        rank: a.rank !== undefined && a.rank !== null && a.rank !== "" ? Number(a.rank) : 1000 + i,
        priority: pr, target: tgt, use_skill: !!a.use_skill,
        answer_code: a.answer_code ?? (a.excellent ? 1 : 0),
        level: lv, self_mode: a.self_mode !== undefined ? !!a.self_mode : p.self_mode,
      };
    });
    return out;
  }

  step(inp) {
    if (this.finished) throw new Error("battle already finished");
    inp = inp || {};
    const acts = this._parse_inputs(inp);
    this.turn += 1; this._events = []; this._acts = []; this._revived_now = new Set(); this._last_used = null;
    for (const p of this.all_players) for (const c of p.deck) c.delayed_now = false; // APK: 毎ターン isCountDelayed を戻す
    const order = [...(inp.skill_order || [])];

    let wanting = order.filter((pid) => this.players[pid]);
    const seats = [...this.all_players].sort((p, q) => {
      const ia = this.teams[p.team].players.indexOf(p), ib = this.teams[q.team].players.indexOf(q);
      return ia !== ib ? ia - ib : (p.team < q.team ? -1 : p.team > q.team ? 1 : 0);
    });
    for (const p of seats) if (!wanting.includes(p.id)) wanting.push(p.id);
    wanting = wanting.filter((pid) => acts[pid].use_skill);

    // APK TGMoServerController.OnReceiveSendSkillFireToS: スキルは問題に答えている間(入力中)に押す。押した時点で CanUseSkill
    // (カウント0以下・未使用)を確かめ、短縮(IsCountDown)ならその場で TryToUseSkill(味方のカウントがすぐ減る)、それ以外は
    // FireSkill(ターン末に発動する予約)。→ 味方の短縮でカウントが0以下になったキャラは、同じ入力中にスキルを押せる。
    // 押したい人は「押せるようになった時点で押す」: 順番に見て、押せる人がいれば押し、短縮が出たら最初から見直す。
    // 最後まで押せなかった人は不可。CPUだけのチーム(FireCpuSkills, 全員の回答後)は席順に1回ずつ、押せるなら押す。
    const press = (p) => {
      const c = p.active_char;
      if ((c.skill.effects || []).some((e) => e.type === "shorten")) {
        const act = new Act(p, c); this._acts.push(act); this._commit(act);
        for (const eff of c.skill.effects) if (eff.type === "shorten") this._do_shorten(act, eff);
        return true;
      }
      this._acts.push(new Act(p, c));
      this._ev(4, "skill_declared", `${p.id} ${c.name} がスキル「${c.skill.name ?? ""}」を宣言`, { pid: p.id });
      return false;
    };
    let pending = [];
    for (const pid of wanting) {
      const p = this.players[pid], c = p.active_char;
      if (p.cpu) continue;
      if (p.ghost || !c || !c.alive || !c.skill) { this._ev(1, "skill_invalid", `${pid}: スキルを発動できる状態ではありません`, { pid }); continue; }
      if (c.uses >= this.rules.max_skill_uses) { this._ev(1, "skill_invalid", `${pid} ${c.name}: スキル使用回数の上限です`, { pid }); continue; }
      pending.push(p);
    }
    for (let again = true; again;) {
      again = false;
      for (const p of pending) {
        if (p.active_char.count > 0) continue;
        pending = pending.filter((q) => q !== p);
        if (press(p)) { again = true; break; }   // 短縮: 味方のカウントが変わったので最初から見直す
      }
    }
    for (const p of pending) this._ev(1, "skill_invalid", `${p.id} ${p.active_char.name}: スキルカウント ${p.active_char.count} のため発動できません`, { pid: p.id });
    for (const p of seats) {
      if (!p.cpu) continue;
      const c = p.active_char;
      const ok = !p.ghost && c && c.alive && c.skill && c.uses < this.rules.max_skill_uses && c.count <= 0;
      acts[p.id].use_skill = !!ok;
      if (ok) press(p);
    }
    this._fin_snap();

    for (const p of this.all_players) {
      const a = acts[p.id];
      this._ev(3, "answer", `${p.id}: ${!a.correct ? "完全誤答" : a.answer_code === 1 ? "Excellent回答" : a.answer_code === 6 ? "半誤答" : "Correct回答"}`, { pid: p.id, correct: a.correct });
    }

    this._run_phase(5, ["color_change"], (...x) => this._do_register(...x));
    this._phase_delay();
    this._fin_snap();
    this._regen_tick();
    const regen_snap = this._skill_snapshot();   // 画面用: 継続回復のあとの状態
    const counters = this.all_players.map((p) => [p, p.active]);
    this._run_phase(8, ["heal"], (...x) => this._do_heal(...x));
    this._run_phase(9, ["atk_up"], (...x) => this._do_register(...x));
    this._run_phase(9, ["multi_attack"], (...x) => this._do_register(...x));
    this._run_phase(9, ["all_attack"], (...x) => this._do_register(...x));
    this._run_phase(10, ["cover"], (...x) => this._do_register(...x));
    this._run_phase(10, ["shield", "def_up"], (...x) => this._do_register(...x));

    const skill_snap = this._skill_snapshot();   // 画面用: スキルの効果が出たあと(攻撃の前)の状態
    if (this._last_used) this._last_used.snap = skill_snap;
    this._last_used = null;
    this._phase_attack(acts);
    // 蘇生(APK FireSkillAfterEnemyAttack: 蘇生できる相手がいる時だけ発動し、いなければ消費しない)
    for (const act of [...this._acts]) for (const eff of act.skill.effects || []) if (eff.type === "revive") { this._try_revive(act, eff); break; }
    this._fin_snap();
    this._countdown(acts, counters);
    this._end_of_turn();
    this._check_finish();

    const log = { turn: this.turn, input: { players: acts, skill_order: order }, events: this._events, finished: this.finished, result: this.result, skill_snap, regen_snap };
    this.history.push(log);
    return log;
  }

  // 画面用: 直前に発動したスキルの記録に、その効果が出たあとの状態を付ける(区切りごとに呼ぶ)
  _fin_snap() { if (this._last_used) { this._last_used.snap = this._skill_snapshot(); this._last_used = null; } }
  _commit(act) {
    this._fin_snap();
    act.committed = true; act.char.uses += 1; act.char.used_now = true; // APK: nsCount=-9998。ターン末に InitCount で再装填
    this._ev(4, "skill_used", `${act.player.id} ${act.char.name} がスキル「${act.skill.name ?? ""}」を発動(${act.char.uses}/${this.rules.max_skill_uses}回目)`,
      { pid: act.player.id, cid: act.char.cid, types: (act.skill.effects || []).map((e) => e.type) });   // 画面のスキル演出用
    this._last_used = this._events[this._events.length - 1];
  }
  _check(act, step) {
    if (act.cancelled) return false;
    if (act.committed) return true;
    if (act.char.count > 0) {
      act.cancelled = true;
      this._ev(step, "skill_cancelled", `${act.player.id} ${act.char.name} のスキルは遅延でカウント ${act.char.count} となり不発`, { pid: act.player.id });
      return false;
    }
    this._commit(act); return true;
  }
  _run_phase(step, kinds, fn) {
    for (const act of [...this._acts]) {
      for (const eff of act.skill.effects || []) {
        if (kinds.includes(eff.type)) {
          if (!this._check(act, step)) break;
          fn(act, eff, step);
        }
      }
    }
  }
  _targets(act, team, eff, defaultScope) {
    const scope = eff.scope ?? defaultScope;
    const fronts = this._fronts(team);
    if (scope === "self") return fronts.filter((c) => c.pid === act.char.pid);
    let out = fronts;
    if (scope === "leader") out = out.filter((c) => c.pid === team.leader);
    if (eff.attr) out = out.filter((c) => this.effective_attrs(c).includes(eff.attr));
    return out;
  }
  // APK: nsCount が -9999(スキル無し/上限) か -9998(このターン使用済み)なら短縮・遅延の対象外
  _no_skill(c) { return !c.skill || c.uses >= this.rules.max_skill_uses || c.used_now; }
  _do_shorten(act, eff) {
    const team = this.teams[act.char.team], hit = [], changes = [];
    for (const c of this._targets(act, team, eff, "team")) {
      if (this._no_skill(c)) continue;
      const before = c.count; c.count -= parseInt(eff.amount ?? 1, 10);
      hit.push(`${c.pid} ${c.name} ${before}→${c.count}`); changes.push({ pid: c.pid, count: c.count });
    }
    this._ev(1, "shorten", `${act.player.id}: 味方スキルターンを${eff.amount ?? 1}短縮(${hit.length ? hit.join("、") : "対象なし"})`, { pid: act.player.id, changes });
  }
  // APK AttackCountUp / TryToUseSkill(9): 範囲・属性が合い(CanAffectEnemy)、このターンまだ遅延されておらず(isCountDelayed)、
  // 未使用のスキルを持つ(IsUsedOrNoSkill でない)相手の出場中キャラ
  _delay_targets(act, eff) { return this._targets(act, this.enemy_of(act.char.team), eff, "team").filter((c) => !this._no_skill(c) && !c.delayed_now); }
  // APK TryToUseSkill(種別9): 遅延だけは発動時に CanUseSkill を見ない(同じターンに相手の遅延を受けても発動する)。
  // ただし遅延できる相手が1体もいなければ発動せず、スキルも消費しない(使用回数・カウントはそのまま)
  _phase_delay() {
    for (const act of [...this._acts]) {
      const effs = (act.skill.effects || []).filter((e) => e.type === "delay");
      if (!effs.length || act.cancelled) continue;
      if (!act.committed) {
        if (!this._delay_targets(act, effs[0]).length) {
          act.cancelled = true;
          this._ev(6, "skill_unused", `${act.player.id} ${act.char.name} の遅延は、遅延できる相手がいないため発動しません(スキルは消費しません)`, { pid: act.player.id });
          continue;
        }
        this._commit(act);
      }
      for (const eff of effs) this._do_delay(act, eff, 6);
    }
  }
  _do_delay(act, eff) {
    // APK SkillCountDownForEvent(負の値): 1ターンに1回しか遅延しない(isCountDelayed)
    const hit = this._delay_targets(act, eff);
    for (const c of hit) { c.count += parseInt(eff.amount ?? 1, 10); c.delayed_now = true; }
    this._ev(6, "delay", `${act.player.id}: 敵スキルターンを${eff.amount ?? 1}遅延(${hit.length}体)`, { pid: act.player.id, changes: hit.map((c) => ({ pid: c.pid, count: c.count })) });
  }
  _heel(c, rate) {
    let pct = rate * 100.0;
    const miss = Math.max(0.0, 100.0 - (c.hp * 100.0) / c.max_hp);
    if (miss < pct) pct = miss + (pct - miss) * 0.5;
    c.hp = Math.min(Math.trunc(c.hp + (c.max_hp * pct) / 100.0), Math.trunc(c.max_hp * this.rules.max_hp_rate));
  }
  _do_heal(act, eff) {
    const team = this.teams[act.char.team];
    const rate = parseFloat(eff.rate ?? 0.3);
    const details = [];
    for (const c of this._targets(act, team, eff, "self")) { const b0 = c.hp; this._heel(c, rate); details.push({ uid: c.uid, pid: c.pid, name: c.name, before: b0, after: c.hp, max_hp: c.max_hp }); }
    this._ev(8, "heal", `${act.player.id}: 回復 ${Math.trunc(rate * 100)}%`, { pid: act.player.id, details });
    const turns = parseInt(eff.turns ?? 1, 10);
    if (turns >= 2) {
      const data = { ...eff }; delete data.type;
      team.effects.push(new Effect("regen", data, act.char, team.id, turns - 1, this._seq++));
    }
  }
  _regen_tick() {
    for (const t of Object.values(this.teams)) {
      for (const e of [...t.effects]) {
        if (e.kind !== "regen") continue;
        const act = new Act(this.players[e.owner.pid], e.owner);
        const rate = parseFloat(e.data.rate ?? 0.3);
        for (const c of this._targets(act, t, e.data, "self")) this._heel(c, rate);
        this._ev(8, "regen", `${e.owner.pid}: 継続回復 ${Math.trunc(rate * 100)}%`, { pid: e.owner.pid });
        e.remaining -= 1;
      }
      t.effects = t.effects.filter((e) => e.kind !== "regen" || e.remaining > 0);
    }
  }
  _do_register(act, eff, step) {
    const kind = eff.type;
    const data = { ...eff }; delete data.type;
    let tid = act.char.team;
    if (kind === "color_change" && data.scope === "enemy") { tid = this.enemy_of(tid).id; data.scope = "team"; }
    const e = new Effect(kind, data, act.char, tid, parseInt(eff.turns ?? 1, 10), this._seq++);
    this.teams[tid].effects.push(e);
    this._ev(step, "effect", `${act.player.id}: ${kind} を${e.remaining}ターン付与`, { pid: act.player.id, effect: kind });
  }
  _countdown(acts, counters) {
    const step = parseInt(this.rules.count_step ?? 1, 10);
    // APK HasMoreTeam → InitCount: 使用済みは needCount へ再装填
    for (const p of this.all_players) for (const c of p.deck) if (c.used_now) { c.used_now = false; c.count = c.skill_turn; }
    for (const [p, start] of counters) {
      if (p.ghost || !acts[p.id].correct) continue;
      for (const c of p.deck.slice(start)) if (c.alive) c.count -= step;   // 控えも正解ごとに減る
    }
  }

  _plan_attacks(team, acts) {
    const plans = [], r = this.rules;
    team.players.forEach((p, i) => {
      const a = acts[p.id];
      if (!a.correct) return;
      const c = p.active_char;
      let plan;
      if (p.ghost) plan = { p, char: null, ghost: true, attrs: [], pw: r.ghost_power, surv: 1.0, base: r.ghost_power, hits: 1, all: false, ups: [] };
      else if (c && c.alive) {
        const effs = team.effects.filter((e) => this._applies(e, c));
        const ups = effs.filter((e) => e.kind === "atk_up").map((e) => [parseFloat(e.data.bonus ?? 0), e.data.vs_attr ?? null]);
        const extra = effs.filter((e) => e.kind === "multi_attack").reduce((s, e) => s + (parseInt(e.data.hits ?? 2, 10) - 1), 0);
        plan = { p, char: c, ghost: false, attrs: this.effective_attrs(c), pw: c.power, surv: Math.pow(r.survival_mult, c.survived), base: c.power * Math.pow(r.survival_mult, c.survived),
          hits: 1 + extra, all: effs.some((e) => e.kind === "all_attack"), ups };
      } else return;
      plan.am = this._answer_mult(a);
      plan.base *= plan.am;
      plan.order = [PRIORITY_ORDER[a.priority], a.rank, i];
      plan.target_in = a.target;
      plans.push(plan);
    });
    plans.sort((x, y) => x.order[0] - y.order[0] || x.order[1] - y.order[1] || x.order[2] - y.order[2]);
    return plans;
  }
  _atk_key(plan) { return plan.ghost ? "ghost" : plan.char.uid; }
  _skill_snapshot() {
    const teams = {}, chars = {};
    for (const t of Object.keys(this.teams)) teams[t] = this.teams[t].effects.map((e) => ({ kind: e.kind, remaining: e.remaining }));
    for (const p of this.all_players) { const c = p.ghost ? null : p.deck[p.active]; if (c) chars[p.id] = { attrs: this.effective_attrs(c).slice(), count: c.count, hp: c.hp, max_hp: c.max_hp }; }
    return { teams, chars };
  }
  _phase_attack(acts) {
    const merged = [];
    Object.entries(this.teams).forEach(([tid, t], ti) => {
      for (const plan of this._plan_attacks(t, acts)) {
        plan.tid = tid; plan.order = [plan.order[0], plan.order[1], ti, plan.order[2]];
        merged.push(plan);
      }
    });
    merged.sort((x, y) => { for (let k = 0; k < 4; k++) if (x.order[k] !== y.order[k]) return x.order[k] - y.order[k]; return 0; });
    for (const plan of merged) {
      const wanted = plan.target_in ? this.players[plan.target_in] : null;
      this._execute_attack(plan, wanted, this.enemy_of(plan.tid));
    }
  }
  _cover_for(plan, defteam) {
    if (plan.ghost) return [null, 0.0];
    const covers = defteam.effects.filter((e) => e.kind === "cover").sort((a, b) => b.seq - a.seq);
    for (const e of covers) {
      // APK GetTargetCardOnHandId: かばう対象は発動者プレイヤーの出場中キャラ(倒れても次のキャラが引き継ぐ)
      const op = e.owner ? this.players[e.owner.pid] : null;
      let o = op && !op.ghost ? op.active_char : null;
      if (e.data.to_leader) { const lp = this.players[this.teams[e.team].leader]; o = !lp.ghost ? lp.active_char : null; }
      if (o && o.alive && this._is_front(o)) {
        const vs = e.data.vs_attr ?? null;
        if (vs === null || plan.attrs.includes(vs)) return [o, parseFloat(e.data.cut ?? 0.0)];
      }
    }
    return [null, 0.0];
  }
  _pick_single(plan, defteam) {
    const cands = this._fronts(defteam);
    if (!cands.length) return null;
    const p = plan.p;
    if (p.target_char && p.target_char[0] === this._atk_key(plan)) {
      const hit = cands.find((c) => c.uid === p.target_char[1]);
      if (hit) return hit;
    }
    return this.rules.random_target ? this.rng.choice(cands) : cands[0];
  }
  _execute_attack(plan, wanted, defteam) {
    const p = plan.p;
    const who = `${p.id}${plan.ghost ? "(幽霊)" : " " + plan.char.name}`;
    if (wanted && wanted.active_char && !wanted.ghost) { p.target = wanted.id; p.target_char = [this._atk_key(plan), wanted.active_char.uid]; }
    const r = this.rules;
    for (let h = 0; h < plan.hits; h++) {
      const cands = this._fronts(defteam);
      if (!cands.length) break;
      let [cover, cut] = this._cover_for(plan, defteam);
      if (plan.all && r.all_attack_ignores_cover) cover = null;
      if (plan.all) {
        for (const c of cands) {
          if (cover) { if (!cover.alive) continue; this._single_hit(plan, cover, defteam, who, cut, `→${cover.name}がかばう`); }
          else if (c.alive) this._single_hit(plan, c, defteam, who, null);
        }
        continue;
      }
      if (cover) { this._single_hit(plan, cover, defteam, who, cut, `→${cover.name}がかばう`); continue; }
      const tc = this._pick_single(plan, defteam);
      if (tc) this._single_hit(plan, tc, defteam, who, null);
    }
  }
  _single_hit(plan, tc, defteam, who, coverCut, note = "") {
    const r = this.rules;
    const cuts = coverCut === null ? [] : [coverCut];
    if (!plan.ghost) {
      for (const e of defteam.effects) if ((e.kind === "shield" || e.kind === "def_up") && this._applies(e, tc)) {
        const vs = e.data.vs_attr ?? null;
        if (vs === null || plan.attrs.includes(vs)) cuts.push(parseFloat(e.data.cut ?? 0.0));
      }
    }
    if (!tc.alive) { this._ev(11, "wasted", `${who} の攻撃は ${tc.name} が既に倒れており空振り`, { pid: plan.p.id }); return; }
    let power = plan.base, mult, upm = 1.0;
    if (!plan.ghost) {
      for (const [b, vs] of plan.ups) if (vs === null || this.effective_attrs(tc).includes(vs)) { power *= 1 + b; upm *= 1 + b; }
      mult = this.attr_mult(plan.attrs, this.effective_attrs(tc));
    } else mult = r.ghost_attr_mult;
    const passed = cuts.length ? this._cut_pass(cuts) : 1.0;
    const rnd = this._roll();
    const dmg = this._round_dmg(power * r.damage_const * mult * rnd * passed * r.static_mult);
    const hpBefore = tc.hp;
    tc.hp -= dmg;
    let killed = false;
    if (tc.hp <= 0) { tc.hp = 0; tc.alive = false; killed = true; tc.death_seq = this._death_seq++; }
    this._ev(11, "attack", `${who} → ${tc.uid} ${tc.name} に ${dmg} ダメージ${note}(属性x${mult.toFixed(2)}/乱数x${rnd.toFixed(3)}/カット通過${passed.toFixed(2)})${killed ? " 撃破" : ""}`,
      { attacker: plan.p.id, target: tc.uid, damage: dmg, killed,
        calc: { pw: plan.pw, surv: round6(plan.surv), answer: round6(plan.am), up: round6(upm), const: r.damage_const, attr: round6(mult), rand: round6(rnd),
          cut: round6(passed), static: r.static_mult, hp_before: hpBefore, hp_after: tc.hp, max_hp: tc.max_hp, attacker: who, target_name: tc.name, ghost: plan.ghost } });
  }
  _is_front(c) { const p = this.players[c.pid]; return !p.ghost && p.active_char === c; }

  // APK AllyModel.CanAffectAlly: スキルの適用範囲(自身/リーダー/属性)
  _revive_scope_ok(act, eff, c, team) {
    const scope = eff.scope ?? "team";
    if (scope === "self" && c.pid !== act.char.pid) return false;
    if (scope === "leader" && c.pid !== team.leader) return false;
    if (eff.attr && !this.effective_attrs(c).includes(eff.attr)) return false;
    return true;
  }
  /* APK FireSkillAfterEnemyAttack + Raise: 発動者はこのターンに倒れていても発動できる。対象は各プレイヤーの出場中キャラ
     (このターンに倒れたキャラ、幽霊なら最後のキャラ)。1キャラ1回、HP=ceil(最大HP x 率)、攻撃力はそのまま。対象なしなら消費しない */
  _try_revive(act, eff) {
    if (act.cancelled) return;
    const team = this.teams[act.char.team];
    if (!act.committed && act.char.count > 0) {
      act.cancelled = true;
      this._ev(12, "skill_cancelled", `${act.player.id} ${act.char.name} のスキルは遅延でカウント ${act.char.count} となり不発`, { pid: act.player.id });
      return;
    }
    const cands = [];
    for (const p of team.players) {
      const c = p.ghost ? p.deck[p.deck.length - 1] : p.active_char;
      if (!c || c.alive || c.revived_used) continue;
      if (this._revive_scope_ok(act, eff, c, team)) cands.push([p, c]);
    }
    if (!cands.length) { this._ev(12, "skill_unused", `${act.player.id} ${act.char.name} の蘇生は対象がいないため発動しなかった(スキルは残る)`, { pid: act.player.id }); return; }
    if (!act.committed) this._commit(act);
    const rate = parseFloat(eff.hp_rate ?? 1.0);
    for (const [p, c] of cands) {
      c.revived_used = true;
      c.hp = Math.ceil(round6(c.max_hp * rate));
      c.alive = c.hp > 0;
      this._revived_now.add(c.uid);
      if (p.ghost) { p.ghost = false; p.active = c.idx; }
      this._ev(12, "revive", `${c.uid} ${c.name} が HP${Math.trunc(rate * 100)}% で蘇生`, { pid: p.id, uid: c.uid });
    }
  }
  _end_of_turn() {
    for (const t of Object.values(this.teams)) {
      const keep = [];
      for (const e of t.effects) {
        if (e.kind === "regen") { keep.push(e); continue; }
        e.remaining -= 1;
        if (e.remaining > 0) keep.push(e);   // APK NextTurn: 残りターンが0で消える(発動キャラが倒れても消えない)
      }
      t.effects = keep;
    }
    for (const p of this.all_players) {
      const c = p.active_char;
      if (!p.ghost && c && c.alive) c.survived += 1; // APK: 蘇生したキャラも生存していれば x1.3
    }
    for (const p of this.all_players) {
      if (p.ghost) continue;
      const c = p.active_char;
      if (c && c.alive) continue;
      const nxt = p.deck.filter((x) => x.alive);
      if (nxt.length) { p.active = nxt[0].idx; nxt[0].survived = 0; this._ev(13, "switch", `${p.id}: ${nxt[0].name} が出撃`, { pid: p.id }); }
      else { p.ghost = true; p.active = null; this._ev(13, "ghost", `${p.id}: 全滅して幽霊になった`, { pid: p.id }); }
    }
  }
  _check_finish() {
    const a = this.teams.A.alive(), b = this.teams.B.alive();
    if (!a || !b) {
      this.finished = true;
      this.result = { winner: !a && !b ? "draw" : !a ? "B" : "A", reason: "annihilation", turns: this.turn };
    } else if (this.turn >= this.rules.max_turns) {
      this.finished = true; this.result = { winner: "draw", reason: "timeout", turns: this.turn };
    }
  }

  /* 盤面の複製(AIの先読み用)。履歴・イベントは持たない */
  clone(seed) {
    const b = Object.create(Battle.prototype);
    b.rules = this.rules; b.constraint = this.constraint;
    b.rng = makeRng(0); b.rng.setState(seed === undefined ? this.rng.getState() : seed);
    b.turn = this.turn; b.finished = this.finished; b.result = this.result;
    b._seq = this._seq; b._death_seq = this._death_seq;
    b._events = []; b._acts = []; b._revived_now = new Set(); b.history = [];
    const cmap = new Map();
    b.teams = {};
    for (const tid of ["A", "B"]) {
      const t = this.teams[tid];
      const players = t.players.map((p) => {
        const q = Object.create(Player.prototype);
        Object.assign(q, p);
        q.deck = p.deck.map((c) => { const d = Object.create(Char.prototype); Object.assign(d, c); cmap.set(c, d); return d; });
        q.target_char = p.target_char ? [...p.target_char] : null;
        return q;
      });
      const nt = Object.create(Team.prototype);
      nt.id = t.id; nt.players = players; nt.leader = t.leader;
      b.teams[tid] = nt;
    }
    for (const tid of ["A", "B"]) {
      b.teams[tid].effects = this.teams[tid].effects.map((e) => new Effect(e.kind, e.data, e.owner ? cmap.get(e.owner) : null, e.team, e.remaining, e.seq));
    }
    b.all_players = [...b.teams.A.players, ...b.teams.B.players];
    b.players = {}; for (const p of b.all_players) b.players[p.id] = p;
    return b;
  }

  state() {
    const teams = {};
    for (const [tid, t] of Object.entries(this.teams)) {
      teams[tid] = {
        leader: t.leader,
        players: t.players.map((p) => ({ id: p.id, name: p.name, level: p.level, self_mode: p.self_mode, cpu: p.cpu, ghost: p.ghost, active: p.active, target: p.target,
          deck: p.deck.map((c) => c.toDict(this.effective_attrs(c))) })),
        effects: t.effects.map((e) => e.toDict()), alive: t.alive(),
      };
    }
    return { turn: this.turn, finished: this.finished, result: this.result, teams, levels: Object.keys(this.rules.level_mult) };
  }
}

const api = { Battle, DEFAULT_RULES, deepMerge };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.EigoBattle = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

