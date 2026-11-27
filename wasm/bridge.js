/* Rust(rsim_wasm) を battle-engine.js / battle-brain.js と同じ使い方で見せる薄い橋。
 * - battle-ui.js を無改造で動かすため、EigoBattle = { Battle, DEFAULT_RULES, deepMerge } と
 *   EigoBrain = { decide, rankPoint, resultName } を提供する。
 * - 条件 #3: 状態同期は uid / seq をキーに既存オブジェクトの中身を書き換え(in-place)、
 *   画面が持っているキャラ(c)・効果(e)の参照を壊さない。
 * - Node: createBridge(require("./pkg_node/rsim_wasm.js"))
 * - ブラウザ/Tauri: init() 後に createBridge(wasmModule) を呼んで window.EigoBattle / window.EigoBrain へ設定。
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
  level_mult: {
    "小学生": 1.45, "中学1年生": 1.50, "中学2年生": 1.55, "中学3年生": 1.60,
    "高校1年生": 1.65, "高校2年生": 1.70, "高校3年生": 1.75, "難関大学": 1.80,
  },
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

const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
function deepMerge(base, over) {
  const out = clone(base);
  for (const [k, v] of Object.entries(over || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = clone(v);
    }
  }
  return out;
}

function createBridge(wasm) {
  class PlayerProxy {
    constructor(sp, tid, deck) {
      this.id = sp.id;
      this.team = tid;
      this.name = sp.name;
      this.level = sp.level;
      this.self_mode = sp.self_mode;
      this.cpu = sp.cpu;
      this.deck = deck;
      this.active = sp.active;
      this.ghost = sp.ghost;
      this.target = sp.target;
    }
    get active_char() {
      return this.active !== null ? this.deck[this.active] : null;
    }
  }

  class TeamProxy {
    constructor(tid, players, leader) {
      this.id = tid;
      this.players = players;
      this.leader = leader;
      this.effects = [];
    }
    alive() {
      return this.players.some((p) => !p.ghost);
    }
  }

  class Battle {
    constructor(setup, rules) {
      this.rules = deepMerge(DEFAULT_RULES, deepMerge(setup.rules || {}, rules || {}));
      this.constraint = setup.constraint || {};
      const wireSetup = clone(setup);
      wireSetup.rules = clone(this.rules);
      if (wireSetup.rules.seed === null || wireSetup.rules.seed === undefined) {
        wireSetup.rules.seed = Math.floor(Math.random() * 4294967296);
      }
      this._handle = new wasm.WasmBattle(JSON.stringify(wireSetup));
      this._charMap = new Map();
      this._playerMap = new Map();
      this._effectMap = new Map();
      this.history = [];
      this.teams = {};
      this.all_players = [];
      this.players = {};

      const snap = JSON.parse(this._handle.sync_json());
      this.turn = snap.turn;
      this.finished = snap.finished;
      this.result = snap.result;
      for (const tid of ["A", "B"]) {
        const st = snap.teams[tid];
        const players = st.players.map((sp) => {
          const deck = sp.deck.map((sc, idx) => {
            const c = {
              uid: sc.uid,
              cid: sc.cid,
              pid: sp.id,
              team: tid,
              idx,
              name: sc.name,
              base_attrs: sc.attrs,
              cost: sc.cost,
              theme: sc.theme,
              limit_break: sc.limit_break,
              hp: sc.hp,
              max_hp: sc.max_hp,
              power: sc.power,
              alive: sc.alive,
              count: sc.count,
              skill_turn: sc.skill_turn,
              uses: sc.uses,
              survived: sc.survived,
              revived_used: sc.revived_used,
              used_now: sc.used_now,
              delayed_now: sc.delayed_now,
              skill: sc.skill,
            };
            this._charMap.set(c.uid, c);
            return c;
          });
          const p = new PlayerProxy(sp, tid, deck);
          this._playerMap.set(p.id, p);
          return p;
        });
        this.teams[tid] = new TeamProxy(tid, players, st.leader);
      }
      this.all_players = [...this.teams.A.players, ...this.teams.B.players];
      for (const p of this.all_players) this.players[p.id] = p;
      this._syncEffects(snap);
    }

    _syncEffects(snap) {
      const aliveSeqs = new Set();
      for (const tid of ["A", "B"]) {
        const tm = this.teams[tid];
        const arr = snap.teams[tid].effects;
        tm.effects.length = 0;
        for (const se of arr) {
          aliveSeqs.add(se.seq);
          let ef = this._effectMap.get(se.seq);
          if (ef) {
            ef.remaining = se.remaining;
            ef.kind = se.kind;
            ef.team = se.team;
            ef.owner = se.owner ? (this._charMap.get(se.owner) || null) : null;
          } else {
            ef = {
              kind: se.kind,
              data: se.data,
              owner: se.owner ? (this._charMap.get(se.owner) || null) : null,
              team: se.team,
              remaining: se.remaining,
              seq: se.seq,
            };
            this._effectMap.set(se.seq, ef);
          }
          tm.effects.push(ef);
        }
      }
      for (const seq of this._effectMap.keys()) {
        if (!aliveSeqs.has(seq)) this._effectMap.delete(seq);
      }
    }

    _sync() {
      const snap = JSON.parse(this._handle.sync_json());
      this.turn = snap.turn;
      this.finished = snap.finished;
      this.result = snap.result;
      for (const tid of ["A", "B"]) {
        const st = snap.teams[tid];
        this.teams[tid].leader = st.leader;
        for (const sp of st.players) {
          const p = this._playerMap.get(sp.id);
          p.ghost = sp.ghost;
          p.active = sp.active;
          p.target = sp.target;
          for (const sc of sp.deck) {
            const c = this._charMap.get(sc.uid);
            c.hp = sc.hp;
            c.max_hp = sc.max_hp;
            c.power = sc.power;
            c.alive = sc.alive;
            c.count = sc.count;
            c.uses = sc.uses;
            c.survived = sc.survived;
            c.revived_used = sc.revived_used;
            c.used_now = sc.used_now;
            c.delayed_now = sc.delayed_now;
          }
        }
      }
      this._syncEffects(snap);
    }

    enemy_of(tid) {
      return this.teams[tid === "A" ? "B" : "A"];
    }

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
      return JSON.parse(this._handle.effective_attrs(ch.uid));
    }

    _applies(e, ch, checkAttr = true) {
      return this._handle.applies(e.seq, ch.uid, checkAttr !== false);
    }

    _targets(act, team, eff, defaultScope) {
      const tid = typeof team === "string" ? team : team.id;
      const uids = JSON.parse(this._handle.targets(act.char.uid, tid, JSON.stringify(eff || {}), defaultScope || "team"));
      return uids.map((uid) => this._charMap.get(uid)).filter(Boolean);
    }

    step(inp) {
      if (this.finished) throw new Error("battle already finished");
      const log = JSON.parse(this._handle.step(JSON.stringify(inp || {})));
      this._sync();
      this.history.push(log);
      return log;
    }

    state() {
      return JSON.parse(this._handle.state_json());
    }

    free() {
      if (this._handle) {
        this._handle.free();
        this._handle = null;
      }
    }
  }

  const EigoBattle = { Battle, DEFAULT_RULES, deepMerge };
  const EigoBrain = {
    decide(b, side, opt) {
      const level = opt && opt.level !== undefined ? opt.level : 1;
      // 2_claude/battle-brain.js (v5) は狙いの優先で絞らない(Prio::Off)
      const prioOff = !(opt && opt.prioTarget === true);
      return JSON.parse(b._handle.decide(side, level, prioOff));
    },
    rankPoint(b, side) {
      return b._handle.rank_point(side);
    },
    resultName(pt) {
      return { 2: "完勝", 1: "勝利", 0: "引き分け", "-1": "敗北", "-2": "完敗" }[pt];
    },
  };

  return { EigoBattle, EigoBrain };
}

const api = { createBridge, DEFAULT_RULES, deepMerge };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.EigoWasmBridge = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
