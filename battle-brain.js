/* 英語物語 対戦 操作AI「EigoBrain」(ブラウザ/Node 両対応)
 *
 * 1ターン分の操作を、その時点で見える情報だけから「判断ルール」で決める。対戦を先読み計算(盤面の複製・試行)はしない。
 *   - 回答は全員速答
 *   - 決めるもの: スキルを使うか(使わなくてよい場面・温存する場面では使わない) / 同じ種類のスキルの発動順 / チーム内の攻撃順 / 狙い
 *   - 狙い: スキルが発動しそうな相手・残りキャラが多い相手を優先(ユーザー指定)。倒せるか・削れる割合・脅威・属性なども見る
 *   - かばう崩し(第7版・ユーザー指定): かばう役が倒れると以降の攻撃はかばわれない。かばわれない味方を先にしてかばう役を倒し、
 *     残りの味方(かばわれる属性の味方を含む)は最初から別の相手を狙う。撃破数が増えるときだけ採用
 *   - 狙いの付け替え(第7版): 1人ずつ狙いを替えてみて、攻撃順どおりに当てた見込みの撃破数が増えるなら替える
 *   - スキルの使う/温存(第7版): 味方の他のスキルと合わせた「今打った場合の上積み」と、次のターンの見積もり(後ろから出るキャラ・
 *     使えるようになるスキル・倒される/倒せる見込み)を含む75個の判断材料から、打つ方が良いときだけ打つ(decideSkills・P.use7・P.hold7)
 *   - 狙い・攻撃順(第7版): かばう崩し・撃破数が増える付け替え・次のターンまで見た付け替えと攻撃順の移動(assign)
 *   - 短縮(第7版・APK): 押した時点で味方のカウントが減るので、0以下になった味方も同じターンに使うか決める
 *   - 相手の操作は「相手の立場で同じルールを当てはめて」予測する(相手がスキルを使うか・誰を狙うか・シールドやかばうを張るか)
 *     opt.level = 2 なら、相手も「こちらの操作を予測して」決めるとみなして予測する(画面のAIはこれを使う)
 *   - 見えない控え(自分以外の次のキャラ)は、環境(使用者数・枠・同時採用率)から予想する
 *   - 判断ルールの重み θ は大量の仮想対戦でランク点(完勝2 勝利1 引分0 敗北-1 完敗-2)が最大になるよう学習
 *     (第6版: tools/train_fork.js で全部の重みを学習、色変・回復の使う条件は tools/cf_skill.js の場面ごとの検証から推定)
 *
 *   const out = EigoBrain.decide(battle, "A", { band: "高" });
 *   // out.players[pid] = {correct, answer_code, target, use_skill, priority:"normal"}, out.order = [攻撃順のpid], out.skill_order
 */
(function (root) {
"use strict";

const TYPES = ["atk_up", "multi_attack", "all_attack", "shield", "cover", "heal", "color_change", "shorten", "delay", "revive"];
const TYPE_PHASE = { shorten: 0, color_change: 1, delay: 2, heal: 3, atk_up: 4, multi_attack: 5, all_attack: 6, cover: 7, shield: 8, revive: 9 };
const OFF = new Set(["atk_up", "multi_attack", "all_attack", "color_change"]);
const DEF_SCOPE = { atk_up: "self", all_attack: "self", multi_attack: "self", heal: "self", shield: "team", def_up: "team", color_change: "team" };

/* 特徴量の名前(学習結果の説明・レポート用) */
const F_USE = ["基本", "効果量", "効果範囲の人数", "与ダメ増加", "撃破できる数の増加", "受けるダメージの危険度", "倒されそうな味方を守れる数", "自分が倒されそう", "最後の1回", "ターン数", "生存プレイヤー差", "種類別の指標", "相手の準備済みスキル数", "継続ターン数", "相手が今ターン攻撃系スキルを使いそう", "自分の攻撃が相手のかばう・シールドに吸われる", "実際に効く上積み(余り・かばう除く)", "使う必要がある場面(ルール判定)",
  "相手のかばうが続くターン数", "次のターンに使えるようになる相手の攻撃系スキル数",
  // 第6版(分解): 発動者 / 効果を受けるキャラ(対象) / 効果量・継続ターン / 自軍への影響
  "発動者のHP割合", "発動者の攻撃力(味方平均との比)", "発動者が属性有利をとれる相手の割合",
  "対象の人数(発動者以外)", "対象のHP割合の平均", "対象の攻撃力の合計(遅延は相手の攻撃力)", "対象のうち倒されそう(遅延は発動間近)な数", "対象が属性有利をとれる相手の割合",
  "効果量×対象の攻撃力", "継続ターン×対象が次のターンも残りそう", "効果量×継続ターン",
  "自軍の受けるダメージの減少見込み", "自軍の与ダメ増加×相手の残りキャラの多さ", "遅延する相手の脅威の割合"];
const F_ORD = ["効果量", "効果範囲の人数", "持ち主のHP割合", "持ち主の攻撃力", "持ち主が倒されそう", "持ち主がリーダー", "持ち主のHP(実数)",
  "継続ターン", "対象のうち倒されそうな数", "持ち主のプレイヤーの残りキャラ数", "効果量×対象の攻撃力"];
const F_ATT = ["基本", "幽霊", "連撃の追加回数", "全体攻撃", "与ダメの大きさ", "1人で倒せる相手がいる", "かばうに吸われる", "属性有利の相手の割合", "攻撃UP中", "狙いが被りやすい",
  "同じ相手を狙う味方の数", "自分1人で狙いを倒せる", "味方と合わせて倒す", "狙いのHPに対する自分のダメージ", "このターン自分がスキルを使う", "狙いの相手のスキルが発動しそう",
  "狙いに属性有利", "狙いの相手のHP割合", "かばう役に当たる", "自分がこのターン倒されそう", "連撃で狙いを倒せる"];
const F_TGT = ["倒せる", "削れる割合", "既に倒れる見込み(過剰)", "相手の脅威", "相手のスキル準備済み", "準備済みが攻撃系", "準備済みが防御・回復・蘇生", "相手プレイヤーの残り数", "相手の最後のキャラ", "次のキャラの脅威-今の脅威", "属性有利", "属性不利", "相手の残りHP割合", "相手リーダー", "相手が蘇生できる", "基本", "完敗の危険があるとき残りの少ない相手(撃破数を取りに行く)", "スキルが次のターンまでに発動しそう", "発動しそうなスキルの危険度", "残りキャラ数が相手の中で最多",
  "発動しそう×倒せる", "発動しそう×攻撃系スキル", "発動しそう×蘇生・かばう・シールド", "残数最多×倒せる", "相手のかばう役", "相手が今ターンスキルを使いそう",
  "発動しそうなスキルの効果量", "発動しそうなスキルの継続ターン", "攻撃UP・連撃が乗った攻撃で倒せる", "相手が今ターン守りのスキル(シールド・かばう・回復)を使いそう"];
const F_WRONG = [];   // わざと誤答はしない(ユーザー指示で廃止)

/* 初期値(人の常識で置いた値)。学習済みの値は setParams で上書き */
function defaultParams() {
  const use = {
    atk_up:       [-0.3, 0.4, 0.3, 3.0, 2.0, 0, 0, 1.0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    multi_attack: [-0.3, 0.4, 0.3, 3.0, 2.0, 0, 0, 1.0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    all_attack:   [0.3, 0.4, 0.3, 3.0, 2.0, 0, 0, 1.0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    shield:       [-1.2, 0.5, 0.5, 0, 0, 2.0, 2.0, 0.5, -0.2, 0, 0, 1.0, 0.3, 0, 0, 0, 0, 0],
    cover:        [-1.2, 0.5, 0, 0, 0, 1.5, 2.0, 0, -0.2, 0, 0, 1.0, 0.3, 0, 0, 0, 0, 0],
    heal:         [-1.5, 0.5, 0.3, 0, 0, 1.0, 2.5, 0.5, -0.2, 0, 0, 2.0, 0, 0, 0, 0, 0, 0],
    color_change: [-0.5, 0, 0.2, 3.0, 2.0, 0, 0, 0.5, 0, 0, 0, -1.0, 0, 0, 0, 0, 0, 0],
    shorten:      [-0.5, 0.3, 0.2, 0, 0, 0, 0, 1.0, 0, 0, 0, 3.0, 0, 0, 0, 0, 0, 0],
    delay:        [-0.8, 0.3, 0.3, 0, 0, 0, 0, 1.0, 0, 0, 0, 3.0, 0.5, 0, 0, 0, 0, 0],
    revive:       [-0.5, 0.5, 0.2, 0, 0, 0, 0, 0.5, -0.3, 0, 0, 3.0, 0, 0, 0, 0, 0, 0],
  };
  // 同じ種類のスキルの発動順(値が大きいほど先)。かばう・色変は「後に発動したものが有効」、遅延は「先に当てたものだけ有効」
  const ord = {
    atk_up: [0, 0, 0, 0, 0, 0, 0], multi_attack: [0, 0, 0, 0, 0, 0, 0], all_attack: [0, 0, 0, 0, 0, 0, 0], shield: [0, 0, 0, 0, 0, 0, 0],
    cover: [-1, 0, -1, 0, 1, 0, 0], heal: [1, 0, 0, 0, 0, 0, 0], color_change: [0, -1, 0, 0, 0, 0, 0], shorten: [1, 0, 0, 0, 0, 0, 0],
    delay: [1, 1, 0, 0, 0, 0, 0], revive: [1, 1, 0, 0, 0, 0, 0],
  };
  for (const t of TYPES) use[t].push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);   // 第6版で追加した特徴(初期値0 = 以前と同じ判断)
  for (const t of TYPES) ord[t].push(0, 0, 0, 0);
  return {
    use, ord,
    att: [0, -0.5, 0.3, 0.5, 0.5, 0.5, 1.0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    tgt: [1.5, 2.5, -3.0, 2.0, 0.3, 0.5, 0.2, 2.0, 0.3, -0.5, 1.0, -0.5, -0.5, 0.1, -0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    wrong: [-4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
}
let PARAMS = defaultParams();
let META = null;
function setParams(p) { if (p) PARAMS = mergeParams(defaultParams(), p); }
const BAND_CAP = { "低": 150, "中": 220, "高": 350, "超高": 500 };
const BAND_IDX = { "低": 0, "中": 1, "高": 2, "超高": 3 };
let NEXT_CACHE = new Map();
function setMeta(m) {
  META = m; NEXT_CACHE = new Map();
  if (!m || !m.chars) return;
  META._chars = m.chars.map((a) => ({ id: a[0], cost: a[1], lg: a[2], hp: a[3], pw: a[4], t: a[5], u: a[6], sl: a[7], slTot: a[7].reduce((x, y) => x + y, 0), at: a[8] || "", u28: a[9] || null }));
  META._byId = new Map(META._chars.map((c) => [c.id, c]));
  META._pair = new Map();
  for (const [a, b2, v] of m.pairs || []) for (const k of [a + ":" + b2, b2 + ":" + a]) META._pair.set(k, Math.max(META._pair.get(k) || 0, v));
  // 同じ値を「既出キャラ → (候補 → 値)」の形でも持つ(予想の計算を速くするため)
  META._pairBy = new Map();
  for (const [k, v] of META._pair) { const i = k.indexOf(":"), a = Number(k.slice(0, i)), b2 = Number(k.slice(i + 1)); if (!META._pairBy.has(a)) META._pairBy.set(a, new Map()); META._pairBy.get(a).set(b2, v); }
  META._idx = new Map(META._chars.map((c, j) => [c.id, j]));
  META._syn = new Float64Array(META._chars.length);
  // 枠・コスト帯ごとの基本の重み(下の予想と同じ式を前計算)
  META._w0 = [0, 1, 2, 3].map((bi) => [0, 1, 2, 3, 4].map((slot) => Float64Array.from(META._chars.map((ch) => ch.u[bi] * (ch.sl[slot] + 0.3) / (ch.slTot + 1.5)))));
  META._w0s = {};
}
/* 縛り(属性)の対戦: 見えない控えは、その属性を含むキャラだけを、その縛り・コスト帯の使用者数で予想する */
const SHIBARI_ALLOW = { "全": null, "火": ["火"], "水": ["水"], "風": ["風"], "火水": ["火", "水"], "水風": ["水", "風"], "火風": ["火", "風"] };
const SHIBARI_IDX = { "全": 0, "火": 1, "水": 2, "風": 3, "火水": 4, "水風": 5, "火風": 6 };
function w0For(sh, bi) {
  if (!sh || sh === "全" || !(sh in SHIBARI_IDX) || !META._chars.length || !META._chars[0].u28) return META._w0[bi];
  const key = sh + bi;
  if (META._w0s[key]) return META._w0s[key];
  const si = SHIBARI_IDX[sh], allow = SHIBARI_ALLOW[sh];
  return (META._w0s[key] = [0, 1, 2, 3, 4].map((slot) => Float64Array.from(META._chars.map((ch) => {
    if (!allow.some((a) => ch.at.includes(a))) return 0;
    return ch.u28[si * 4 + bi] * (ch.sl[slot] + 0.3) / (ch.slTot + 1.5);
  }))));
}
function mergeParams(base, p) {
  const out = JSON.parse(JSON.stringify(base));
  const cp = (dst, src) => { for (let i = 0; i < Math.min(dst.length, src.length); i++) dst[i] = src[i]; };
  for (const k of ["att", "tgt", "wrong"]) if (Array.isArray(p[k])) cp(out[k], p[k]);
  for (const k of ["use", "ord"]) if (p[k]) for (const t of TYPES) if (Array.isArray(p[k][t])) cp(out[k][t], p[k][t]);
  if (p.hold7) out.hold7 = JSON.parse(JSON.stringify(p.hold7));
  if (p.use7) { out.use7 = {}; for (const t of TYPES) { const v = (p.use7[t] || []).slice(0, NF7); while (v.length < NF7) v.push(0); out.use7[t] = v; } }   // 第7版の使う/温存の重み
  return out;
}
/* 学習用: θ を1本のベクトルにする(ord は専用検証で決めるので入れない) */
function flatten(p) {
  const v = [];
  for (const t of TYPES) v.push(...p.use[t]);
  v.push(...p.att, ...p.tgt, ...p.wrong);
  return v;
}
function unflatten(v, base) {
  const p = JSON.parse(JSON.stringify(base || PARAMS));
  let i = 0;
  for (const t of TYPES) for (let j = 0; j < p.use[t].length; j++) p.use[t][j] = v[i++];
  for (const k of ["att", "tgt", "wrong"]) for (let j = 0; j < p[k].length; j++) p[k][j] = v[i++];
  return p;
}
const dot = (w, f) => { let s = 0; for (let i = 0; i < w.length; i++) s += w[i] * (f[i] || 0); return s; };
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/* ---------- 見える情報 ---------- */
const front = (p) => (!p.ghost && p.active_char && p.active_char.alive ? p.active_char : null);
const leftOf = (p) => { let n = 0; for (const c of p.deck) if (c.alive) n++; return n; };
const mainEff = (c) => (c && c.skill && c.skill.effects && c.skill.effects[0]) || null;
const mainType = (c) => { const e = mainEff(c); return e ? e.type : null; };
function isReady(b, c) { return !!(c && c.alive && c.skill && c.uses < b.rules.max_skill_uses && c.count <= 0 && !c.used_now); }
function magOf(e) {
  if (!e) return 0;
  switch (e.type) {
    case "atk_up": return Number(e.bonus || 0);
    case "multi_attack": return (Number(e.hits || 2) - 1) / 2;
    case "all_attack": return 1;
    case "shield": case "cover": return Number(e.cut || 0);
    case "heal": return Number(e.rate || 0);
    case "shorten": case "delay": return Number(e.amount || 1) / 3;
    case "revive": return Number(e.hp_rate || 1);
    default: return 0.5;
  }
}

/* ---------- 予定の効果を含めた計算(人が頭の中でする程度のダメージ見積もり) ---------- */
function Ctx(b, side, opt) {
  this.b = b; this.side = side; this.os = side === "A" ? "B" : "A"; this.opt = opt;
  this.my = b.teams[side]; this.en = b.teams[this.os];
  this.plan = { [side]: [], [this.os]: [] };      // 予定・予測の効果 {kind, data, owner, team, seq}
  this.seq = 1e6;
  this.cancel = new Set();                          // 遅延で不発になる見込みのスキル(uid)
  // 計算結果の記憶(同じ判断の中で同じ計算を繰り返さない)。予定の効果・不発見込みが変わるたびに別の版になる
  this.ver = 0; this._nv = 0; this._vstack = []; this._caches = new Map(); this._next = new Map(); this._nthr = new Map();
}
Ctx.prototype._cc = function () {
  let c = this._caches.get(this.ver);
  if (!c) { c = { effA: null, effB: null, attrs: new Map(), atk: new Map(), hp: new Map() }; this._caches.set(this.ver, c); }
  return c;
};
Ctx.prototype._bump = function () { this.ver = ++this._nv; };
/* このターンの短縮を入れたカウント(押した時点で減る) */
Ctx.prototype.cntOf = function (c) { return this.cnt && this.cnt.has(c.uid) ? this.cnt.get(c.uid) : c.count; };
Ctx.prototype.mkEff = function (team, kind, data, owner) { const d = Object.assign({}, data); delete d.type; return { kind, data: d, owner, team, seq: this.seq++, remaining: 1 }; };
/* 一時的に効果を足して計算し、外すと元の版に戻る */
Ctx.prototype.pushPlan = function (team, e) { this._vstack.push(this.ver); this.plan[team].push(e); this._bump(); };
Ctx.prototype.popPlan = function (team) { this.plan[team].pop(); this.ver = this._vstack.pop(); };
Ctx.prototype.addCancel = function (uid) { this.cancel.add(uid); this._bump(); };
/* 一時的に「遅延で不発」を足して計算し、外すと元の版に戻る */
Ctx.prototype.pushCancel = function (uids) { const add = uids.filter((u) => !this.cancel.has(u)); this._vstack.push(this.ver); this._cstack = this._cstack || []; this._cstack.push(add); for (const u of add) this.cancel.add(u); this._bump(); };
Ctx.prototype.popCancel = function () { for (const u of this._cstack.pop()) this.cancel.delete(u); this.ver = this._vstack.pop(); };
Ctx.prototype.addEff = function (team, kind, data, owner) {
  const d = Object.assign({}, data); delete d.type;
  this.plan[team].push({ kind, data: d, owner, team, seq: this.seq++, remaining: 1 });
  this._bump();
};
Ctx.prototype.effects = function (team) {
  const c = this._cc(), k = team === "A" ? "effA" : "effB";
  return c[k] || (c[k] = this.b.teams[team].effects.concat(this.plan[team]));
};
Ctx.prototype.attrs = function (ch) {
  const cm = this._cc().attrs;
  if (cm.has(ch.uid)) return cm.get(ch.uid);
  let a = this.b.effective_attrs(ch);
  for (const e of this.plan[ch.team]) if (e.kind === "color_change" && this.applies(e, ch, false)) a = e.data.to || a;
  cm.set(ch.uid, a);
  return a;
};
Ctx.prototype.applies = function (e, ch, checkAttr = true) {
  const scope = e.data.scope ?? DEF_SCOPE[e.kind] ?? "team";
  let ok;
  if (scope === "self") ok = e.owner && ch.pid === e.owner.pid;
  else if (scope === "leader") ok = ch.team === e.team && ch.pid === this.b.teams[e.team].leader;
  else ok = ch.team === e.team;
  if (ok && checkAttr && e.data.attr) ok = this.attrs(ch).includes(e.data.attr);
  return !!ok;
};
/* 攻撃側の1撃あたり期待ダメージ・回数・全体攻撃か */
Ctx.prototype.atkInfo = function (p) {
  const cm = this._cc().atk;
  if (cm.has(p.id)) return cm.get(p.id);
  const v = this._atkInfo(p);
  cm.set(p.id, v);
  return v;
};
Ctx.prototype._atkInfo = function (p) {
  const b = this.b, r = b.rules;
  const am = b._answer_mult({ level: p.level, answer_code: 1, self_mode: p.self_mode });
  if (p.ghost) return { ghost: true, base: r.ghost_power * am, hits: 1, all: false, ups: [], attrs: [] };
  const c = p.active_char;
  if (!c || !c.alive) return null;
  const effs = this.effects(p.team).filter((e) => this.applies(e, c) && !(e.owner && this.cancel.has(e.owner.uid) && e.seq >= 1e6));
  const ups = effs.filter((e) => e.kind === "atk_up").map((e) => [Number(e.data.bonus || 0), e.data.vs_attr || null]);
  const hits = 1 + effs.filter((e) => e.kind === "multi_attack").reduce((s, e) => s + (Number(e.data.hits || 2) - 1), 0);
  const all = effs.some((e) => e.kind === "all_attack");
  return { ghost: false, c, base: c.power * Math.pow(r.survival_mult, c.survived) * am, hits, all, ups, attrs: this.attrs(c) };
};
Ctx.prototype.cover = function (ai, defTeam) {
  if (ai.ghost) return null;
  const covers = this.effects(defTeam).filter((e) => e.kind === "cover").sort((x, y) => y.seq - x.seq);
  for (const e of covers) {
    if (e.owner && this.cancel.has(e.owner.uid) && e.seq >= 1e6) continue;
    let o = e.owner ? front(this.b.players[e.owner.pid]) : null;   // かばうは発動者プレイヤーの出場中キャラが引き継ぐ
    if (e.data.to_leader) { const lp = this.b.players[this.b.teams[e.team].leader]; o = front(lp); }
    if (o && o.alive && front(this.b.players[o.pid]) === o) {
      const vs = e.data.vs_attr || null;
      if (vs === null || ai.attrs.includes(vs)) return { c: o, cut: Number(e.data.cut || 0) };
    }
  }
  return null;
};
Ctx.prototype.hit = function (ai, tc, coverCut) {
  if (coverCut != null) return this._hit(ai, tc, coverCut);
  let hm = ai._hit;
  if (!hm || ai._hitCtx !== this) { hm = ai._hit = new Map(); ai._hitCtx = this; }
  let m = hm.get(this.ver);
  if (!m) { m = new Map(); hm.set(this.ver, m); }
  if (m.has(tc.uid)) return m.get(tc.uid);
  const v = this._hit(ai, tc, null);
  m.set(tc.uid, v);
  return v;
};
Ctx.prototype._hit = function (ai, tc, coverCut) {
  const b = this.b;
  if (ai.ghost) return ai.base * b.rules.damage_const * b.rules.ghost_attr_mult;
  const ta = this.attrs(tc);
  let power = ai.base;
  for (const [bo, vs] of ai.ups) if (vs === null || ta.includes(vs)) power *= 1 + bo;
  const mult = b.attr_mult(ai.attrs, ta);
  const cuts = coverCut != null ? [coverCut] : [];
  for (const e of this.effects(tc.team)) {
    if ((e.kind === "shield" || e.kind === "def_up") && this.applies(e, tc) && !(e.owner && this.cancel.has(e.owner.uid) && e.seq >= 1e6)) {
      const vs = e.data.vs_attr || null;
      if (vs === null || ai.attrs.includes(vs)) cuts.push(Number(e.data.cut || 0));
    }
  }
  const passed = cuts.length ? b._cut_pass(cuts) : 1;
  return power * b.rules.damage_const * mult * passed * b.rules.static_mult;
};
/* 攻撃前の回復(継続回復・予定の回復)を入れたHP */
Ctx.prototype.preHp = function (c) {
  const cm = this._cc().hp;
  if (cm.has(c.uid)) return cm.get(c.uid);
  const v = this._preHp(c);
  cm.set(c.uid, v);
  return v;
};
Ctx.prototype._preHp = function (c) {
  let hp = c.hp;
  const heel = (rate) => {
    let pct = rate * 100; const miss = Math.max(0, 100 - (hp * 100) / c.max_hp);
    if (miss < pct) pct = miss + (pct - miss) * 0.5;
    hp = Math.min(Math.trunc(hp + (c.max_hp * pct) / 100), Math.trunc(c.max_hp * this.b.rules.max_hp_rate));
  };
  for (const e of this.b.teams[c.team].effects) if (e.kind === "regen" && this.applies(e, c)) heel(Number(e.data.rate || 0.3));
  for (const e of this.plan[c.team]) if (e.kind === "heal" && this.applies(e, c) && !(e.owner && this.cancel.has(e.owner.uid))) heel(Number(e.data.rate || 0.3));
  return hp;
};
/* 脅威度: その相手が自軍に与えそうな1ターンのダメージ(自軍の生存キャラ平均) */
Ctx.prototype.threat = function (p, vsTeam) {
  const ai = this.atkInfo(p); if (!ai) return 0;
  const fr = this.b.teams[vsTeam].players.map(front).filter(Boolean);
  if (!fr.length) return 0;
  let s = 0; for (const c of fr) s += this.hit(ai, c, null);
  return (s / fr.length) * ai.hits * (ai.all ? Math.min(3, fr.length) : 1);
};
/* 見えない次のキャラの予想: 環境(コスト帯の使用者数 x 枠の割合 x すでに見えたキャラとの同時採用率)から、
   残りコストに収まり伝の重複がないキャラの分布を作る。最後のキャラなら幽霊(固定攻撃力) */
const STRONG = new Set(["all_attack", "multi_attack", "cover", "shield", "revive"]);
Ctx.prototype.predictNext = function (p) {
  if (this._next.has(p.id)) return this._next.get(p.id);
  const v = this._predictNext(p);
  this._next.set(p.id, v);
  return v;
};
Ctx.prototype._predictNext = function (p) {
  const c = front(p); if (!c) return null;
  if (leftOf(p) <= 1) return { ghost: true, revive: 0, strong: 0, cover: 0, pw: this.b.rules.ghost_power, hp: 0 };
  if (this.opt && this.opt.noHidden) return { ghost: false, revive: 0.08, strong: 0.3, cover: 0.05, pw: 3500, hp: 4000 };   // 見えない控えは推測しない(固定の想定。使用率・縛り・コスト帯のデータは使わない)
  const band = (this.opt && this.opt.band) || "高", bi = BAND_IDX[band] ?? 2, cap = BAND_CAP[band] ?? 350;
  const sh = (this.opt && this.opt.shibari) || "全";
  const seenChars = p.deck.slice(0, c.idx + 1);
  const key = band + "|" + sh + "|" + seenChars.map((x) => x.cid).join(",");
  if (NEXT_CACHE.has(key)) return NEXT_CACHE.get(key);
  const slot = Math.min(4, c.idx + 1), slotsLeft = Math.max(1, p.deck.length - (c.idx + 1));
  let res;
  if (!META || !META._chars) {
    const m = META && META.bands && META.bands[band] ? META.bands[band][slot] : null;
    res = { ghost: false, revive: m ? m.types.revive || 0 : 0.08, strong: 0.3, cover: m ? m.types.cover || 0 : 0.05, pw: m ? m.pw : 3500, hp: m ? m.hp : 4000 };
  } else {
    const seen = new Set(seenChars.map((x) => x.cid));
    const used = seenChars.reduce((s2, x) => s2 + (x.cost || 0), 0);
    const hasLg = seenChars.some((x) => META._byId.get(x.cid) && META._byId.get(x.cid).lg);
    const maxCost = cap - used - (slotsLeft - 1) * 1;
    let W = 0, rv = 0, st = 0, cv = 0, pw = 0, hp = 0;
    // 同時採用率の合計(既出キャラの順に足す)
    const SYN = META._syn, touched = [];
    for (const sid of seen) { const pm = META._pairBy.get(sid); if (pm) for (const [id, v] of pm) { const j = META._idx.get(id); if (j === undefined) continue; if (SYN[j] === 0) touched.push(j); SYN[j] += v || 0; } }
    const w0 = bi >= 0 && bi <= 3 && slot >= 0 && slot <= 4 ? w0For(sh, bi)[slot] : null, chars = META._chars, synW = META.synW ?? 3;
    for (let j = 0; j < chars.length; j++) {
      const ch = chars[j];
      if (seen.has(ch.id) || ch.cost > maxCost || (hasLg && ch.lg)) continue;
      let w = w0 ? w0[j] : ch.u[bi] * (ch.sl[slot] + 0.3) / (ch.slTot + 1.5);
      if (!(w > 0)) continue;
      w *= 1 + synW * SYN[j];
      W += w; pw += w * ch.pw; hp += w * ch.hp;
      if (ch.t === "revive") rv += w; if (ch.t === "cover") cv += w; if (STRONG.has(ch.t)) st += w;
    }
    for (const j of touched) SYN[j] = 0;
    res = W > 0 ? { ghost: false, revive: rv / W, strong: st / W, cover: cv / W, pw: pw / W, hp: hp / W } : { ghost: false, revive: 0.08, strong: 0.3, cover: 0.05, pw: 3500, hp: 4000 };
  }
  if (NEXT_CACHE.size > 20000) NEXT_CACHE.clear();
  NEXT_CACHE.set(key, res);
  return res;
};

/* 見えていない控えの具体的な1通りを引く(先読みの仮定用)。コスト上限(使った分と残り枠を引いた残り)・伝は1体まで・縛り・使用率・同時採用率で重みをつける。
   p = 相手のプレイヤー。出てきたキャラ(front まで)は確定、その後ろを deck.length まで引く。戻り値 = キャラ id の配列(後ろの分) */
function sampleTail(b, p, band, sh, rnd) {
  const c = front(p); if (!c || !META || !META._chars || !META._chars.length) return null;
  const bi = BAND_IDX[band] ?? 2, cap = BAND_CAP[band] ?? 350, n = p.deck.length;
  const seenChars = p.deck.slice(0, c.idx + 1), seen = new Set(seenChars.map((x) => x.cid));
  let used = seenChars.reduce((s2, x) => s2 + (x.cost || 0), 0), hasLg = seenChars.some((x) => META._byId.get(x.cid) && META._byId.get(x.cid).lg);
  const chars = META._chars, synW = META.synW ?? 3, out = [], SYN = new Float64Array(chars.length);
  const addSyn = (sid) => { const pm = META._pairBy.get(sid); if (pm) for (const [id, v] of pm) { const j = META._idx.get(id); if (j !== undefined) SYN[j] += v || 0; } };
  for (const sid of seen) addSyn(sid);
  for (let k = c.idx + 1; k < n; k++) {
    const slot = Math.min(4, k), left = n - k - 1, maxCost = cap - used - left;
    const w0 = bi >= 0 && bi <= 3 ? w0For(sh, bi)[slot] : null;
    let W = 0; const ws = new Float64Array(chars.length);
    for (let j = 0; j < chars.length; j++) {
      const ch = chars[j];
      if (seen.has(ch.id) || ch.cost > maxCost || (hasLg && ch.lg)) continue;
      let w = w0 ? w0[j] : ch.u[bi] * (ch.sl[slot] + 0.3) / (ch.slTot + 1.5);
      if (!(w > 0)) continue;
      w *= 1 + synW * SYN[j]; ws[j] = w; W += w;
    }
    if (!(W > 0)) return null;
    let x = rnd() * W, pick = chars.length - 1; for (let j = 0; j < chars.length; j++) { x -= ws[j]; if (x < 0 && ws[j] > 0) { pick = j; break; } }
    const ch = chars[pick]; out.push(ch.id); seen.add(ch.id); used += ch.cost; if (ch.lg) hasLg = true; addSyn(ch.id);
  }
  return out;
}
Ctx.prototype.nextThreat = function (p) {
  if (this._nthr.has(p.id)) return this._nthr.get(p.id);
  const v = this._nextThreat(p);
  this._nthr.set(p.id, v);
  return v;
};
Ctx.prototype._nextThreat = function (p) {
  const b = this.b, r = b.rules;
  const am = b._answer_mult({ level: p.level, answer_code: 1, self_mode: p.self_mode });
  if (leftOf(p) <= 1) return r.ghost_power * am * r.damage_const;
  const nx = this.predictNext(p);
  return (nx ? nx.pw : 3500) * am * r.damage_const;
};

/* ---------- 相手の操作の予測(相手の立場で同じルールを使う) ---------- */
function predictEnemy(b, side, opt) {
  const os = side === "A" ? "B" : "A";
  // level 1: 相手は「こちらを予測しない簡易版」で予測。level 2: 相手も「こちらを予測する」として予測(計算は約2倍)
  // 相手の予測には検証用の指定(forceUse など)を持ち込まない
  // 相手も温存ルールで動くとみるか(predHold2。指定がなければ自分と同じ)
  const ph = opt.predHold2 === undefined ? opt.hold2 : opt.predHold2;
  // 相手のスキルの使い方の予測は、計算を軽くするため既定では第6版の判断を使う(opt.predPolicy で指定可)
  return decideCore(b, os, Object.assign({}, opt, { level: Math.max(0, (opt.level ?? 1) - 1), hold2: ph, predHold2: ph, policy: opt.predPolicy === undefined ? "v6" : opt.predPolicy, forceUse: null, forceTarget: null, swapOrder: null, swapSkill: null, tgtLog: false, logFeats: false }));
}

/* 自軍キャラへの受けダメージ予想 */
function incoming(ctx, pred) {
  const b = ctx.b, inc = new Map(), mine = ctx.my.players.map(front).filter(Boolean);
  for (const c of mine) inc.set(c.uid, 0);
  if (!mine.length) return { inc, single: 0 };
  let single = 0;
  for (const q of ctx.en.players) {
    const ai = ctx.atkInfo(q); if (!ai) continue;
    const pa = pred ? pred.players[q.id] : null;
    if (pred && (!pa || !pa.correct)) continue;
    if (ai.all) { for (const c of mine) inc.set(c.uid, inc.get(c.uid) + ai.hits * ctx.hit(ai, c, null)); continue; }
    const cv = ctx.cover(ai, ctx.side);
    if (cv) { inc.set(cv.c.uid, inc.get(cv.c.uid) + ai.hits * ctx.hit(ai, cv.c, cv.cut)); continue; }
    let tgt = null;
    if (pa && pa.target) tgt = front(b.players[pa.target]);
    if (tgt) { const d = ai.hits * ctx.hit(ai, tgt, null); inc.set(tgt.uid, inc.get(tgt.uid) + d); single += d; }
    else { for (const c of mine) { const d = ai.hits * ctx.hit(ai, c, null) / mine.length; inc.set(c.uid, inc.get(c.uid) + d); single += d; } }
  }
  return { inc, single };
}

/* ---------- スキル使用の判断 ---------- */
function skillFeatures(ctx, p, c, base) {
  const b = ctx.b, e = mainEff(c), t = e.type;
  const f = new Array(34).fill(0);
  f[0] = 1; f[1] = magOf(e);
  f[13] = (Number(e.turns || 1) - 1) / 2;
  const mine = ctx.my.players.map(front).filter(Boolean), theirs = ctx.en.players.map(front).filter(Boolean);
  // 効果がかかる味方(属性条件・範囲)
  const probe = { kind: t, data: Object.assign({}, e), owner: c, team: ctx.side, seq: ctx.seq + 1 };
  delete probe.data.type;
  const aff = t === "delay" ? theirs.filter((x) => !e.attr || ctx.attrs(x).includes(e.attr)) : mine.filter((x) => ctx.applies(probe, x));
  f[2] = aff.length / 5;
  const enHp = theirs.reduce((s, x) => s + ctx.preHp(x), 0) + 1;
  if (OFF.has(t)) {
    // 与ダメ増加と撃破数の増加(この効果を足した場合と足さない場合)
    let gain = 0, flips = 0;
    for (const x of aff) {
      const q = b.players[x.pid];
      const a0 = ctx.atkInfo(q);
      ctx.pushPlan(ctx.side, probe);
      const a1 = ctx.atkInfo(q);
      ctx.popPlan(ctx.side);
      if (!a0 || !a1) continue;
      let best0 = 0, best1 = 0, k0 = false, k1 = false;
      for (const y of theirs) {
        const d0 = a0.hits * ctx.hit(a0, y, null) * (a0.all ? 1 : 1), d1 = a1.hits * ctx.hit(a1, y, null);
        const hp = ctx.preHp(y);
        best0 = Math.max(best0, d0); best1 = Math.max(best1, d1);
        if (d0 >= hp) k0 = true; if (d1 >= hp) k1 = true;
      }
      const all1 = a1.all ? theirs.reduce((s, y) => s + Math.min(ctx.preHp(y), a1.hits * ctx.hit(a1, y, null)), 0) : best1;
      const all0 = a0.all ? theirs.reduce((s, y) => s + Math.min(ctx.preHp(y), a0.hits * ctx.hit(a0, y, null)), 0) : best0;
      gain += Math.max(0, all1 - all0);
      if (k1 && !k0) flips++;
      if (a1.all && !a0.all) flips += theirs.filter((y) => a1.hits * ctx.hit(a1, y, null) >= ctx.preHp(y)).length;
    }
    f[3] = clamp(gain / enHp, 0, 2); f[4] = flips / 3;
    // 実際に効く上積み(かばうに吸われる分・倒しきった後の余りを除く): 相手1体のHPに対する割合の最大
    let eff = 0;
    for (const x of aff) {
      const q = b.players[x.pid];
      const a0 = ctx.atkInfo(q); ctx.pushPlan(ctx.side, probe); const a1 = ctx.atkInfo(q); ctx.popPlan(ctx.side);
      if (!a0 || !a1) continue;
      const cv = ctx.cover(a1, ctx.os);
      const tgts = cv ? [cv.c] : theirs;
      if (a1.all && !a0.all) { eff = Math.max(eff, 1); continue; }
      for (const y of tgts) {
        const hp = ctx.preHp(y), cut = cv ? cv.cut : null;
        const d0 = a0.hits * ctx.hit(a0, y, cut) * (a0.all ? 1 : 1), d1 = a1.hits * ctx.hit(a1, y, cut);
        eff = Math.max(eff, (Math.min(d1, hp) - Math.min(d0, hp)) / Math.max(1, hp));
      }
    }
    f.eff = eff;
  }
  // 受けるダメージの危険度・守れる数
  const inc = base.inc;
  let danger = 0, saved = 0;
  for (const x of aff) { if (x.team !== ctx.side) continue; const hp = ctx.preHp(x); danger += Math.min(1.5, (inc.get(x.uid) || 0) / Math.max(1, hp)); }
  f[5] = aff.length ? danger / aff.length : 0;
  if (t === "shield") {
    for (const x of aff) { const hp = ctx.preHp(x), d = inc.get(x.uid) || 0; if (d >= hp && d * (1 - Number(e.cut || 0)) < hp) saved++; }
  } else if (t === "heal") {
    for (const x of aff) {
      const d = inc.get(x.uid) || 0, hp0 = ctx.preHp(x);
      ctx.pushPlan(ctx.side, probe); const hp1 = ctx.preHp(x); ctx.popPlan(ctx.side);
      if (d >= hp0 && d < hp1) saved++;
    }
  } else if (t === "cover") {
    const cc = e.to_leader ? front(b.players[ctx.my.leader]) : c;
    if (cc) for (const x of mine) { if (x === cc) continue; const d = inc.get(x.uid) || 0; if (d >= ctx.preHp(x)) saved++; }
    if (cc) { const tot = base.single, hp = ctx.preHp(cc); if (tot * (1 - Number(e.cut || 0)) >= hp) saved -= 1; }
  }
  f[6] = saved / 3;
  f[7] = clamp(((inc.get(c.uid) || 0) / Math.max(1, ctx.preHp(c)) - 0.7) / 0.6, 0, 1);
  f[8] = c.uses === b.rules.max_skill_uses - 1 ? 1 : 0;
  f[9] = b.turn / 10;
  const alive = (tm) => tm.players.filter((q) => !q.ghost).length;
  f[10] = (alive(ctx.my) - alive(ctx.en)) / 5;
  // 種類別の指標
  if (t === "shield" || t === "cover") {
    const tot = mine.reduce((s, x) => s + ctx.preHp(x), 0) + 1;
    f[11] = clamp([...inc.values()].reduce((s, v) => s + v, 0) / tot, 0, 2);
  } else if (t === "heal") {
    f[11] = aff.length ? aff.reduce((s, x) => s + (1 - x.hp / x.max_hp), 0) / aff.length : 0;
  } else if (t === "color_change") {
    // 受けるダメージの変化(増えるならプラス=使わない方向)
    let d0 = 0, d1 = 0;
    for (const x of aff) {
      for (const q of ctx.en.players) {
        const ai = ctx.atkInfo(q); if (!ai || ai.ghost) continue;
        d0 += ctx.hit(ai, x, null);
        ctx.pushPlan(ctx.side, probe); d1 += ctx.hit(ai, x, null); ctx.popPlan(ctx.side);
      }
    }
    const hp = mine.reduce((s, x) => s + ctx.preHp(x), 0) + 1;
    f[11] = clamp((d1 - d0) / hp, -2, 2);
  } else if (t === "shorten") {
    // APK: 短縮は押した時点で味方のカウントが減る。カウント1〜量 の味方は「このターンに」使えるようになり、
    //   (量+1) は次のターン、(量+2) は2ターン後に早まる。もともと使える(0以下)味方には得がない
    let now = 0, next = 0, later = 0; const amt = Number(e.amount || 1);
    for (const x of mine) {
      if (x === c || !x.skill || x.uses >= b.rules.max_skill_uses || x.used_now || !ctx.applies(probe, x)) continue;
      const k = ctx.cntOf(x);
      if (k > 0 && k <= amt) now++; else if (k === amt + 1) next++; else if (k === amt + 2) later++;
    }
    f[11] = (now + 0.5 * next + 0.2 * later) / 3;
  } else if (t === "delay") {
    // APK: 遅延は 短縮・色変 の後に発動するので、それらと相手の遅延は止められない。遅延できる相手がいなければ発動せず消費もしない
    const amt = Number(e.amount || 1);
    let cancel = 0, near = 0;
    const pred = ctx.pred;
    for (const x of aff) {
      if (!x.skill || x.uses >= b.rules.max_skill_uses || x.delayed_now) continue;
      const tx = mainType(x);
      if (pred && pred.players[x.pid] && pred.players[x.pid].use_skill && tx !== "shorten" && tx !== "color_change" && tx !== "delay") cancel++;
      else if (x.count <= amt) near++;
    }
    f[11] = (cancel + 0.3 * near) / 3;
  } else if (t === "revive") {
    let deaths = 0;
    for (const x of mine) { if (!ctx.applies({ kind: "revive", data: { scope: e.scope, attr: e.attr }, owner: c, team: ctx.side }, x)) continue; if ((inc.get(x.uid) || 0) >= ctx.preHp(x)) deaths++; }
    f[11] = deaths / 3;
  } else {
    f[11] = mine.filter((x) => x !== c && isReady(b, x) && OFF.has(mainType(x))).length / 5;
  }
  f[12] = theirs.filter((x) => isReady(b, x)).length / 5;
  // 相手が今ターン攻撃系スキルを使いそうか(予測があれば予測、なければ準備済みの数)
  const OFF3 = (tt) => tt === "atk_up" || tt === "multi_attack" || tt === "all_attack";
  f[14] = ctx.pred ? (ctx.pred.uses || []).filter((u) => OFF3(u.t)).length / 3 : theirs.filter((x) => isReady(b, x) && OFF3(mainType(x))).length / 3;
  // 自分たちの攻撃が相手のかばう・シールドに吸われるか(既存+予測)
  const effs = ctx.effects(ctx.os);
  f[15] = effs.some((x) => x.kind === "cover") ? 1 : effs.some((x) => x.kind === "shield" || x.kind === "def_up") ? 0.5 : 0;
  f[16] = f.eff != null ? f.eff : 0;
  f[17] = skillNeeded(t, f) ? 1 : 0;
  // 相手のかばうがあと何ターン続くか(攻撃系はかばうに吸われる)
  let coverLeft = 0; for (const x of b.teams[ctx.os].effects) if (x.kind === "cover") coverLeft = Math.max(coverLeft, Number(x.remaining || 0));
  f[18] = clamp(coverLeft / 3, 0, 2);
  // 次のターンに使えるようになる相手の攻撃系スキル(シールド・かばうを次のターンに回すかどうか)
  let nextOff = 0; for (const y of theirs) { const ty = mainType(y); if (y.skill && y.uses < b.rules.max_skill_uses && y.count === 1 && (ty === "atk_up" || ty === "multi_attack" || ty === "all_attack")) nextOff++; }
  f[19] = nextOff / 3;
  // ---- 第6版: 発動者と対象を分けた特徴
  const powOf = (x) => { const ai = ctx.atkInfo(b.players[x.pid]); return ai && !ai.ghost ? ai.base : 0; };
  const advShare = (x, vs) => { if (!vs.length) return 0; const ax = ctx.attrs(x); let n = 0; for (const y of vs) if (b.attr_mult(ax, ctx.attrs(y)) > 1) n++; return n / vs.length; };
  const myPow = mine.reduce((s2, x) => s2 + powOf(x), 0), enPow = theirs.reduce((s2, x) => s2 + powOf(x), 0);
  f[20] = c.hp / c.max_hp;
  f[21] = mine.length && myPow > 0 ? clamp(powOf(c) / (myPow / mine.length), 0, 3) : 0;
  f[22] = advShare(c, theirs);
  const isDelay = t === "delay", others = aff.filter((x) => x !== c);
  f[23] = others.length / 4;
  f[24] = aff.length ? aff.reduce((s2, x) => s2 + x.hp / x.max_hp, 0) / aff.length : 0;
  const affPow = aff.reduce((s2, x) => s2 + powOf(x), 0);
  f[25] = isDelay ? (enPow > 0 ? clamp(affPow / enPow, 0, 1) : 0) : (myPow > 0 ? clamp(affPow / myPow, 0, 1) : 0);
  f[26] = isDelay ? aff.filter((x) => x.skill && x.uses < b.rules.max_skill_uses && x.count <= 1).length / 5 : aff.filter((x) => (inc.get(x.uid) || 0) >= ctx.preHp(x)).length / 5;
  f[27] = aff.length ? aff.reduce((s2, x) => s2 + advShare(x, isDelay ? mine : theirs), 0) / aff.length : 0;
  const tl = (Number(e.turns || 1) - 1) / 2;
  f[28] = clamp(f[1], 0, 3) * f[25];
  f[29] = tl * (1 - clamp(f[5], 0, 1.5) / 1.5);
  f[30] = clamp(f[1], 0, 3) * tl;
  const myHp = mine.reduce((s2, x) => s2 + ctx.preHp(x), 0) + 1;
  if (t === "shield") f[31] = aff.reduce((s2, x) => s2 + Math.min(inc.get(x.uid) || 0, ctx.preHp(x)) * Number(e.cut || 0), 0) / myHp;
  else if (t === "cover") f[31] = (base.single || 0) * Number(e.cut || 0) / myHp;
  else if (t === "heal") { let g = 0; for (const x of aff) { const h0 = ctx.preHp(x); ctx.pushPlan(ctx.side, probe); const h1 = ctx.preHp(x); ctx.popPlan(ctx.side); g += Math.min(h1 - h0, Math.max(0, inc.get(x.uid) || 0)); } f[31] = g / myHp; }
  else if (t === "color_change") f[31] = Math.max(0, -f[11]);
  f[31] = clamp(f[31], 0, 2);
  const enLeft = ctx.en.players.filter((q) => !q.ghost).reduce((s2, q) => s2 + leftOf(q), 0) / Math.max(1, ctx.en.players.length);
  f[32] = f[3] * enLeft / 5;
  if (isDelay) { let tt = 0, ta = 0; for (const q of ctx.en.players) { const v = ctx.threat(q, ctx.side); ta += v; const x = front(q); if (x && aff.includes(x)) tt += v; } f[33] = ta > 0 ? tt / ta : 0; }
  return f;
}

/* 使う必要がある場面か(なければ温存)。f は skillFeatures の値
   攻撃系: 倒せる相手が増える / 与ダメが大きく増える / 自分が倒されそうで今使わないと無駄になる
   シールド・かばう: 倒されそうな味方を守れる / 受けるダメージが大きい
   回復: 倒されそうな味方を守れる / HPが大きく減っている
   短縮: このターン(押した時点で減る)・次のターン・その次に使えるようになる味方がいる
   遅延: 相手の今使いそうなスキル・もうすぐ使えるスキルを遅らせられる
   蘇生: このターンに倒されそうな味方がいる */
const HOLD = {};   // 温存の基準(比較用に変更可)
function setHold(h) { Object.assign(HOLD, h || {}); }
function skillNeeded(t, f) {
  if (HOLD.only && !HOLD.only.includes(t)) return true;
  switch (t) {
    case "atk_up": case "multi_attack": case "color_change": case "all_attack":
      // 倒せる相手が増える / 倒しきれない相手への上積みが相手のHPの一定以上 / 自分が倒されそう(今使わないと無駄)
      return f[4] > 0 || (f.eff ?? f[3]) >= (HOLD.off ?? 0.15) || (f[7] >= 0.8 && (f.eff ?? f[3]) > 0.02);
    case "shield": case "cover":
      return f[6] > 0 || f[5] >= (HOLD.def ?? 0.4) || f[11] >= (HOLD.def ?? 0.4);
    case "heal":
      return f[6] > 0 || f[11] >= (HOLD.heal ?? 0.25);
    case "shorten": case "delay": case "revive":
      return f[11] > 0;
    default: return true;
  }
}
// strictHold: true なら全種類、種類名の配列ならその種類だけ「使う必要がある場面」以外は使わない
const strictFor = (ctx, t) => ctx.opt.strictHold === true || (Array.isArray(ctx.opt.strictHold) && ctx.opt.strictHold.includes(t));

/* ---------- 温存ルール(ユーザー指定 2026-10-26) ----------
   使うと決めたスキルのうち、なくても結果が変わらないものは温存する(使わない判断を増やすだけ。使う判断は増やさない)
   - かばう・シールド: 守りのスキルを1つずつ足していき、倒される味方が0人になった(かばいきれる)ら残りは温存
     (1人のかばうで敵の攻撃を全部かばいきれるなら、2人目のかばうは温存。シールドも同じ)
   - 攻撃系(攻撃UP・連撃・全体): 攻撃系スキルを1つずつ足していき、相手の出場中キャラを全員倒せるようになったら残りは温存。
     継続1ターンなら必ず温存。継続2ターン以上は、発動者がこのターン倒されない(または味方の蘇生が発動する)なら温存
   - 遅延: 発動者がこのターン倒されそうなとき以外は温存(相手のスキルが発動してしまっても、次の相手のスキルを止められる方がよい)
   opt.holdRules で個別に切り替え可(比較用): { def, defFull, off, delay: "dying" | "kill" | false, safe, killMargin }
   仮想対戦(6000試合ずつ、温存なしのAIと対戦): 守りだけ +0.001、攻撃系だけ -0.020、遅延だけ -0.018、全部 -0.032(誤差 ±0.014)。
   守りを「それ以上減らない」で温存すると -0.078(温存したキャラの約2/3が使う前に倒される)ので、「かばいきれる」ときだけにしている */
const HOLD2_DEF = { def: true, defFull: true, off: true, delay: "dying", dieMargin: 0.08, safe: null, killMargin: 0 };
// defFull: かばう・シールドは「足した守りで倒される味方が0人になる(かばいきれる)」ときだけ残りを温存。false なら「それ以上減らない」で温存(比較用)
// safe: 数値なら「温存するキャラが、このターンに受けそうなダメージが HP×safe 未満のときだけ温存」(温存したキャラが倒されて無駄になるのを避ける。比較用)
// killMargin: 攻撃系の「全員倒せる」を、相手のHPの (1+killMargin) 倍のダメージが見込めるときだけにする(比較用)
function applyHold(ctx, P, uses, out) {
  const b = ctx.b, side = ctx.side, H = Object.assign({}, HOLD2_DEF, ctx.opt.holdRules || {});
  const mine = ctx.my.players.map(front).filter(Boolean);
  const forced = (u) => ctx.opt.forceUse && u.p.id in ctx.opt.forceUse;
  const safeOk = (c, inc) => H.safe == null || ((inc || (ctx.base && ctx.base.inc)).get(c.uid) || 0) < ctx.preHp(c) * H.safe;
  const hold = (u, rule, inc) => { if (forced(u) || !safeOk(u.c, inc)) return; const i = uses.indexOf(u); if (i < 0) return; uses.splice(i, 1); out.held.push({ pid: u.p.id, t: u.t, f: u.f, z: u.z, need: false, rule }); };
  const pushU = (list) => { for (const u of list) ctx.pushPlan(side, ctx.mkEff(side, u.t, mainEff(u.c), u.c)); };
  const popN = (n) => { for (let i = 0; i < n; i++) ctx.popPlan(side); };
  // 自軍の色変は先に入れて計算する(受けるダメージ・与えるダメージが変わる)
  const cc = uses.filter((u) => u.t === "color_change");
  pushU(cc);
  // --- かばう・シールド
  const D = uses.filter((u) => u.t === "cover" || u.t === "shield");
  const evalD = (S) => {
    pushU(S);
    const r = incoming(ctx, ctx.pred || null);
    let dead = 0, dmg = 0;
    for (const x of mine) { const hp = ctx.preHp(x), d = r.inc.get(x.uid) || 0; if (d >= hp) dead++; dmg += Math.min(d, hp) / x.max_hp; }
    popN(S.length);
    return [dead, dmg, r.inc];
  };
  if (H.def && D.length >= 2) {
    const goal = evalD(D)[0], S = [];
    while (S.length < D.length) {
      if (S.length && evalD(S)[0] <= goal) break;
      let best = null, bv = null;
      for (const u of D) {
        if (S.includes(u)) continue;
        const v = evalD(S.concat([u]));
        if (!bv || v[0] < bv[0] || (v[0] === bv[0] && (v[1] < bv[1] - 1e-9 || (Math.abs(v[1] - bv[1]) <= 1e-9 && u.z > best.z)))) { best = u; bv = v; }
      }
      S.push(best);
    }
    const eS = evalD(S);
    if (!H.defFull || eS[0] === 0) for (const u of D) if (!S.includes(u)) hold(u, "かばう・シールドが足りている", eS[2]);
  }
  // 最終的な守りを入れた受けダメージ(発動者が倒されるかの判定)
  const Dk = uses.filter((u) => u.t === "cover" || u.t === "shield");
  pushU(Dk);
  const incF = incoming(ctx, ctx.pred || null).inc;
  popN(Dk.length);
  const revs = uses.filter((u) => u.t === "revive");
  const survives = (c) => {
    if ((incF.get(c.uid) || 0) < ctx.preHp(c) * (1 - H.dieMargin)) return true;
    if (c.revived_used) return false;
    return revs.some((v) => { const e = mainEff(v.c); return ctx.applies({ kind: "revive", data: { scope: e.scope, attr: e.attr }, owner: v.c, team: side }, c); });
  };
  // --- 攻撃系
  const O = uses.filter((u) => u.t === "atk_up" || u.t === "multi_attack" || u.t === "all_attack");
  const attackers = ctx.my.players.filter((p) => p.ghost || front(p));
  const planRem = (S) => {
    pushU(S);
    const tmp = { players: {} };
    for (const p of ctx.my.players) tmp.players[p.id] = Object.assign({}, out.players[p.id], { use_skill: uses.some((v) => v.p === p) });
    const r = assign(ctx, P, tmp, attackers, true);
    popN(S.length);
    return r;
  };
  const allKilled = (r) => r.theirs.length > 0 && r.theirs.every((y) => r.rem.get(y.uid) <= -H.killMargin * ctx.preHp(y));
  if (H.off && O.length) {
    const sorted = O.slice().sort((x, y) => y.z - x.z), S = [];
    let ok = allKilled(planRem(S));
    for (const u of sorted) { if (ok) break; S.push(u); ok = allKilled(planRem(S)); }
    if (ok) for (const u of sorted) {
      if (S.includes(u)) continue;
      const turns = Number(mainEff(u.c).turns || 1);
      if (turns <= 1 || survives(u.c)) hold(u, "攻撃系なしでも全員倒せる", incF);
    }
  }
  // --- 遅延
  const DL = uses.filter((u) => u.t === "delay");
  if (H.delay && DL.length) {
    let killedNow = null;
    if (H.delay === "kill") {
      const r = planRem(uses.filter((u) => u.t === "atk_up" || u.t === "multi_attack" || u.t === "all_attack"));
      killedNow = new Set(r.theirs.filter((y) => r.rem.get(y.uid) <= 0).map((y) => y.uid));
    }
    for (const u of DL) {
      if (!survives(u.c)) continue;   // 倒されそう: 今使わないと無駄になる
      if (killedNow) {
        // 止めた相手をこのターンに倒せるなら、そのスキルは二度と発動しない(永久に止まる)
        const e = mainEff(u.c);
        const stopsForever = ctx.en.players.some((q) => { const x = front(q); if (!x || !killedNow.has(x.uid) || !ctx.pred || !ctx.pred.players[q.id] || !ctx.pred.players[q.id].use_skill) return false; const tx = mainType(x); return tx !== "shorten" && tx !== "color_change" && tx !== "delay" && (!e.attr || ctx.attrs(x).includes(e.attr)); });
        if (stopsForever) continue;
      }
      hold(u, "遅延は次の相手のスキルのために温存", incF);
    }
  }
  popN(cc.length);
}
/* ---------- 使う/温存の判断(第7版) ----------
   「打たない方がいい場面では温存」: スキルごとに、味方が使う予定の他のスキルを入れた上での「今打った場合の上積み」と、
   「温存した場合の価値」(持ち主がこのターンを生き残れそうか・狙われているか・相手の次のスキル など)を特徴にし、
   打った場合 − 温存した場合 のランク点の差を予測する重み(P.use7、仮想対戦の同じ場面の分岐から学習)で決める。
   上積みの大きいものから1つずつ足していき、予測が正(打つ方が良い)のものだけ打つ。対戦中に先読みの計算はしない。 */
const NF7 = 75;
const F_USE7 = F_USE.concat(["撃破数の上積み(味方の他のスキル込み)", "削る量の上積み(倒しきった後の余り・かばいに吸われる分を除く)", "倒される味方の減少", "受けるダメージの減少",
  "持ち主の受けそうなダメージ/HP", "持ち主がこのターン倒されそう", "持ち主を狙いそうな相手の数", "継続ターン×上積み", "もうすぐ使える相手の攻撃系スキル", "もうすぐ使える相手の守り・回復・蘇生",
  "遅延で止まる相手のスキル(今ターン使いそう)", "止めた相手をこのターンに倒せる(二度と発動しない)", "遅延で後ろにずれる相手のスキル(まだ使えない)", "味方が既に遅延を使う",
  "自軍の残りキャラ", "相手の残りキャラ", "このスキルなしでも相手を全員倒せる", "このスキルなしでも倒される味方がいない", "持ち主が生き残り、上積みがない",
  "蘇生で戻せそうな味方", "最後の1回で持ち主が生き残る",
  // 次のターンの見積もり(温存した場合 H / 今使った場合 U)
  "次のターンに倒される見込み(H)", "次のターンに倒される見込みの差(U−H)", "次のターンに倒せる見込み(H)", "次のターンに倒せる見込みの差(U−H)",
  "温存して次のターンに使った場合の上積み", "持ち主が次のターンまで残る", "次のターンに使える相手の攻撃系", "次のターンに使える相手の守り・回復・蘇生",
  "次のターンに出てくる相手の新しいキャラ", "相手の次のキャラが蘇生持ちの見込み", "次のターンに使える味方の攻撃系(噛み合い)", "次のターンに使える味方の守り・回復・蘇生",
  "持ち主の生き残りターン(攻撃力の伸び)", "持ち主が最後のキャラ", "持ち主の次のキャラの攻撃力/今の攻撃力", "残りキャラの差(相手−自軍)", "幽霊の数の差(自軍−相手)",
  "遅延で止まるスキルの危険度(全体・蘇生・連撃などが高い)", "遅延で止めた相手が次のターンまでに倒れそう(先送りで消える)", "遅延の量/止まる相手の発動ターン数"]);
const OFF3T = new Set(["atk_up", "multi_attack", "all_attack"]);
/* 遅延で止まる相手: 範囲・属性が合い、未使用のスキルを持ち、このターンまだ遅延されておらず、遅延後のカウントが1以上になる出場中キャラ。
   短縮・色変・遅延は遅延より先に処理されるか遅延を受けても発動する(APK)ので止まらない */
function delayHits(ctx, c) {
  const b = ctx.b, e = mainEff(c), amt = Number(e.amount || 1), out = [];
  for (const q of ctx.en.players) {
    const x = front(q); if (!x || !x.skill || x.uses >= b.rules.max_skill_uses || x.used_now || x.delayed_now) continue;
    if (e.attr && !ctx.attrs(x).includes(e.attr)) continue;
    if (e.scope === "leader" && x.pid !== ctx.en.leader) continue;
    out.push({ x, q, stops: x.count + amt > 0 && !["shorten", "color_change", "delay"].includes(mainType(x)) });
  }
  return out;
}
/* 攻撃の計画(狙い・攻撃順)を1回だけ決めておき、スキルを足したときはその計画のまま攻撃力・かばう・シールドだけ変えて当て直す(速さのため) */
function basePlan(ctx, P, attackers, useFlags) {
  const tmp = { players: {} };
  for (const p of ctx.my.players) tmp.players[p.id] = { correct: true, answer_code: 1, priority: "normal", target: null, use_skill: !!useFlags[p.id] };
  const r = assign(ctx, P, tmp, attackers, true);
  return { order: tmp.order.slice(), tgt: Object.fromEntries(Object.entries(tmp.players).map(([k, v]) => [k, v.target])), theirs: r.theirs };
}
/* いまの予定(ctx.plan・不発見込み)でのチーム全体の見込み: 撃破数・削る量(計画の攻撃順どおり)、倒される味方・受けるダメージ */
function teamEval(ctx, plan) {
  const b = ctx.b, theirs = plan.theirs;
  const seq = [];
  for (const pid of plan.order) { const p = b.players[pid], ai = ctx.atkInfo(p); if (!ai) continue; const tp = plan.tgt[pid]; seq.push({ x: { p, ai }, tgt: tp ? front(b.players[tp]) : null }); }
  const r = simAttack(ctx, theirs, seq);
  let kills = 0, eff = 0;
  for (const y of theirs) { const s0 = ctx.preHp(y), rm = r.rem.get(y.uid); if (rm <= 0) kills++; eff += (s0 - Math.max(0, rm)) / Math.max(1, s0); }
  const inc = incoming(ctx, ctx.pred || null).inc, mine = ctx.my.players.map(front).filter(Boolean);
  let dead = 0, dmg = 0, tot = 1;
  for (const x of mine) { const hp = ctx.preHp(x), d = inc.get(x.uid) || 0; if (d >= hp) dead++; dmg += Math.min(d, hp); tot += x.max_hp; }
  return { kills, eff, dead, dmg: dmg / tot, inc, rem: r.rem, theirs, nEn: theirs.length };
}
/* ---------- 次のターンの見積もり(盤面は複製しない。人が頭の中でする程度) ----------
   このターンの見込み(ev: 味方の受けるダメージ inc・相手の残りHP rem)から、次のターンの両軍を作る。
   - 生き残ったキャラ: 残りHP、攻撃力は生き残りで×1.3、スキルのカウントは正解で1進む(使ったスキルは発動ターン数に戻る)
   - 倒れたキャラ: 次のキャラが出る。自分(判断するキャラの持ち主)の次は実際のキャラ(カウントも控えの間に進む)、他の人の次は使用者数・同時採用から予想。最後なら幽霊
   - 次のターンに使えるスキル(カウント0以下・使用回数が残る): 攻撃UP・連撃・全体は攻撃に、かばう・シールド・回復は守りに入れる
   その上で、次のターンに倒される見込みと倒せる見込みを、単純な割り当て(倒せる相手を優先)で数える */
function nextSide(ctx, team, lossOf, ownPid, usedNow) {
  const b = ctx.b, r = b.rules, out = [];
  for (const p of team.players) {
    const am = b._answer_mult({ level: p.level, answer_code: 1, self_mode: p.self_mode });
    if (p.ghost) { out.push({ pid: p.id, ghost: true, pw: r.ghost_power * am, hp: 0 }); continue; }
    const c = front(p); if (!c) continue;
    const hp1 = ctx.preHp(c) - lossOf(c);
    if (hp1 > 0) {
      const used = usedNow.has(c.uid), cnt = used ? c.skill_turn - 1 : ctx.cntOf(c) - 1;
      out.push({ pid: p.id, c, hp: hp1, max: c.max_hp, pw: c.power * Math.pow(r.survival_mult, c.survived + 1) * am, attrs: b.effective_attrs(c), t: mainType(c), e: mainEff(c),
        ready: !!(c.skill && cnt <= 0 && c.uses + (used ? 1 : 0) < r.max_skill_uses), surv: true });
      continue;
    }
    if (leftOf(p) <= 1) { out.push({ pid: p.id, ghost: true, pw: r.ghost_power * am, hp: 0, fresh: true }); continue; }
    if (p.id === ownPid) {
      const x = p.deck.find((y) => y.alive && y.idx > c.idx);
      if (x) { out.push({ pid: p.id, c: x, hp: x.hp, max: x.max_hp, pw: x.power * am, attrs: x.base_attrs, t: mainType(x), e: mainEff(x), ready: !!(x.skill && x.count - 1 <= 0 && x.uses < r.max_skill_uses), fresh: true }); continue; }
    }
    const nx = ctx.predictNext(p);
    out.push({ pid: p.id, hp: nx ? nx.hp : 4000, max: nx ? nx.hp : 4000, pw: (nx ? nx.pw : 3500) * am, attrs: null, t: null, pRev: nx ? nx.revive : 0, pStrong: nx ? nx.strong : 0, fresh: true, guess: true });
  }
  return out;
}
/* 攻撃側 A が守り側 D に1ターンで与えるダメージの見込みと、倒せる数(倒せる相手を優先する単純な割り当て) */
function nextFight(ctx, A, D, mods) {
  const b = ctx.b, r = b.rules, hp = D.map((d) => (d.ghost ? 0 : d.hp)), alive = D.map((d) => !d.ghost && d.hp > 0);
  const m = mods || {};
  let cover = -1, coverCut = 0;
  if (m.cover != null) { cover = D.findIndex((d) => d.pid === m.cover); coverCut = m.coverCut || 0; }
  const dmgOf = (a, k) => {
    let d = a.pw * r.damage_const * (a.ghost ? r.ghost_attr_mult : a.attrs && D[k].attrs ? b.attr_mult(a.attrs, D[k].attrs) : 1);
    if (!a.ghost) { d *= (1 + (a.up || 0)); if (m.cut && m.cut[k]) d *= 1 - m.cut[k]; }
    return d * SIM_F;
  };
  const att = A.filter((a) => a.ghost || a.hp > 0).map((a) => Object.assign({}, a, a.mod || {}));
  att.sort((x, y) => y.pw * (y.hits || 1) - x.pw * (x.hits || 1));
  for (const a of att) {
    const hits = a.hits || 1;
    for (let h = 0; h < hits; h++) {
      if (a.all) { for (let k = 0; k < D.length; k++) if (alive[k]) { const kk = cover >= 0 && alive[cover] && !a.ghost ? cover : k; hp[kk] -= dmgOf(a, kk) * (kk === cover ? 1 - coverCut : 1); if (hp[kk] <= 0) alive[kk] = false; } continue; }
      if (cover >= 0 && alive[cover] && !a.ghost) { hp[cover] -= dmgOf(a, cover) * (1 - coverCut); if (hp[cover] <= 0) alive[cover] = false; continue; }
      let best = -1, bv = -1;
      for (let k = 0; k < D.length; k++) { if (!alive[k]) continue; const d = dmgOf(a, k); const v = d >= hp[k] ? 2 + hp[k] / Math.max(1, D[k].max || hp[k]) : d / Math.max(1, hp[k]); if (v > bv) { bv = v; best = k; } }
      if (best < 0) break;
      hp[best] -= dmgOf(a, best); if (hp[best] <= 0) alive[best] = false;
    }
  }
  let kills = 0; D.forEach((d, k) => { if (!d.ghost && d.hp > 0 && !alive[k]) kills++; });
  return kills;
}
/* 次のターンに使えるスキルを攻撃・守りに入れる(攻撃UP・連撃・全体は使い手の攻撃に、シールドは守り側のカット、かばうは使い手が全部受ける) */
function readyMods(side, other, skip) {
  const cut = {}; let cover = null, coverCut = 0;
  for (const u of side) {
    if (!u.ready || !u.e || (skip && skip === u.c)) continue;
    if (u.t === "atk_up") { const tg = (u.e.scope || "self") === "self" ? [u] : side; for (const v of tg) v.mod = Object.assign(v.mod || {}, { up: ((v.mod && v.mod.up) || 0) + Number(u.e.bonus || 0) }); }
    else if (u.t === "multi_attack") u.mod = Object.assign(u.mod || {}, { hits: Number(u.e.hits || 2) });
    else if (u.t === "all_attack") u.mod = Object.assign(u.mod || {}, { all: true });
    else if (u.t === "shield") side.forEach((v, k) => { cut[k] = 1 - (1 - (cut[k] || 0)) * (1 - Number(u.e.cut || 0)); });
    else if (u.t === "cover") { cover = u.pid; coverCut = Number(u.e.cut || 0); }
  }
  return { cut, cover, coverCut };
}
function projectNext(ctx, ev, ownPid, usedNow, extra) {
  const lossMy = (c) => ev.inc.get(c.uid) || 0, lossEn = (c) => (ev.rem && ev.rem.has(c.uid) ? ctx.preHp(c) - Math.max(0, ev.rem.get(c.uid)) : 0);
  const my = nextSide(ctx, ctx.my, lossMy, ownPid, usedNow), en = nextSide(ctx, ctx.en, lossEn, null, new Set());
  const myDef = readyMods(my, en, extra && extra.skip), enDef = readyMods(en, my, null);
  if (extra && extra.apply) extra.apply(my, myDef);
  const deaths = nextFight(ctx, en, my, myDef), kills = nextFight(ctx, my, en, enDef);
  const cnt = (S, f) => S.filter(f).length;
  return { my, en, deaths, kills,
    enOff: cnt(en, (u) => u.ready && OFF3T.has(u.t)), enDef: cnt(en, (u) => u.ready && (u.t === "cover" || u.t === "shield" || u.t === "heal" || u.t === "revive")),
    myOff: cnt(my, (u) => u.ready && OFF3T.has(u.t)), myDefN: cnt(my, (u) => u.ready && (u.t === "cover" || u.t === "shield" || u.t === "heal" || u.t === "revive")),
    enNew: cnt(en, (u) => u.fresh && !u.ghost), enRev: en.reduce((a, u) => a + (u.pRev || 0), 0), myNew: cnt(my, (u) => u.fresh && !u.ghost) };
}
/* 温存したスキルを次のターンに使った場合の上積み(持ち主が生き残る場合) */
/* スキル u の効果を次のターンの見積もりに入れる */
function effApply(u) {
  const e = mainEff(u.c), t = u.t;
  return (my, def) => {
    const me = my.find((v) => v.c === u.c); if (!me) return;
    if (t === "atk_up") { const tg = (e.scope || "self") === "self" ? [me] : my; for (const v of tg) v.mod = Object.assign(v.mod || {}, { up: ((v.mod && v.mod.up) || 0) + Number(e.bonus || 0) }); }
    else if (t === "multi_attack") me.mod = Object.assign(me.mod || {}, { hits: Number(e.hits || 2) });
    else if (t === "all_attack") me.mod = Object.assign(me.mod || {}, { all: true });
    else if (t === "shield") my.forEach((v, k) => { if (!e.attr || (v.attrs && v.attrs.includes(e.attr))) def.cut[k] = 1 - (1 - (def.cut[k] || 0)) * (1 - Number(e.cut || 0)); });
    else if (t === "cover") { def.cover = me.pid; def.coverCut = Number(e.cut || 0); }
    else if (t === "heal") { const tg = (e.scope || "self") === "self" ? [me] : my.filter((v) => !v.ghost && (!e.attr || (v.attrs && v.attrs.includes(e.attr)))); for (const v of tg) v.hp = Math.min((v.max || v.hp) * 2, v.hp + (v.max || v.hp) * Number(e.rate || 0.3)); }
  };
}
/* 温存したスキルを次のターンに使った場合の上積み(持ち主が生き残る場合)。P0 = 温存して次のターンも使わない場合の見積もり */
function holdNextGain(ctx, ev, u, usedNow) {
  const own = u.p.id, t = u.t;
  const P0 = projectNext(ctx, ev, own, usedNow, { skip: u.c });
  const me0 = P0.my.find((v) => v.c === u.c);
  if (!me0 || !me0.surv) return { gain: 0, P0, surv: 0 };
  let gain;
  if (t === "delay") gain = P0.enOff * 0.5 + P0.enDef * 0.3;          // 次のターンに使えるようになる相手のスキルを止められる
  else if (t === "revive") gain = Math.min(1, P0.deaths);             // 次のターンに倒されそうな味方を戻せる
  else if (t === "shorten" || t === "color_change") gain = 0;
  else { const P1 = projectNext(ctx, ev, own, usedNow, { skip: u.c, apply: effApply(u) }); gain = (P0.deaths - P1.deaths) + (P1.kills - P0.kills); }
  return { gain, P0, surv: 1 };
}
/* 1つのスキルを、いまの予定 S に足したときの効果(適用 → 計算 → 外す) */
function applyU(ctx, u) {
  if (u.t === "delay") { ctx.pushCancel(delayHits(ctx, u.c).filter((h) => h.stops).map((h) => h.x.uid)); return () => ctx.popCancel(); }
  if (u.t === "revive" || u.t === "shorten") return () => {};
  ctx.pushPlan(ctx.side, ctx.mkEff(ctx.side, u.t, mainEff(u.c), u.c));
  return () => ctx.popPlan(ctx.side);
}
function skillFeatures7(ctx, P, u, S, ev0, plan, usedNow, base) {
  const b = ctx.b, c = u.c, e = mainEff(c), t = u.t;
  const f = skillFeatures(ctx, u.p, c, base).slice(0, 34);
  while (f.length < NF7) f.push(0);
  const undo = applyU(ctx, u);
  const ev1 = t === "revive" || t === "shorten" ? ev0 : teamEval(ctx, plan);
  undo();
  const dK = ev1.kills - ev0.kills, dE = ev1.eff - ev0.eff, dDead = ev0.dead - ev1.dead, dDmg = ev0.dmg - ev1.dmg;
  f[34] = dK / 3; f[35] = clamp(dE, -3, 3) / 3; f[36] = dDead / 3; f[37] = clamp(dDmg, -1, 1);
  const incH = ev0.inc.get(c.uid) || 0, hp = Math.max(1, ctx.preHp(c));
  f[38] = clamp(incH / hp, 0, 2); const dies = incH >= hp ? 1 : 0; f[39] = dies;
  let tgtd = 0; if (ctx.pred) for (const q of ctx.en.players) { const a = ctx.pred.players[q.id]; if (a && a.target === c.pid) tgtd++; }
  f[40] = tgtd / 5;
  const turns = Number(e.turns || 1);
  f[41] = (turns - 1) / 2 * (Math.max(0, dE) + Math.max(0, dDmg));
  let soonOff = 0, soonDef = 0;
  for (const q of ctx.en.players) { const x = front(q); if (!x || !x.skill || x.uses >= b.rules.max_skill_uses || x.count <= 0) continue; const w = x.count === 1 ? 1 : x.count === 2 ? 0.5 : 0; const tx = mainType(x); if (OFF3T.has(tx)) soonOff += w; else if (tx === "cover" || tx === "shield" || tx === "heal" || tx === "revive") soonDef += w; }
  f[42] = soonOff / 3; f[43] = soonDef / 3;
  if (t === "delay") {
    const hits = delayHits(ctx, c);
    let st = 0, perm = 0, push = 0;
    for (const h of hits) {
      const pu = ctx.pred && ctx.pred.players[h.q.id] && ctx.pred.players[h.q.id].use_skill;
      if (h.stops && pu) { st++; if (ev1.rem && ev1.rem.has(h.x.uid) && ev1.rem.get(h.x.uid) <= 0) perm++; }
      else if (h.x.count > 0) push++;
    }
    f[44] = st / 3; f[45] = perm / 3; f[46] = push / 3;
    f[47] = S.some((v) => v.t === "delay") ? 1 : 0;
  }
  const tl = (tm) => tm.players.reduce((a, q) => a + (q.ghost ? 0 : leftOf(q)), 0);
  f[48] = tl(ctx.my) / 25; f[49] = tl(ctx.en) / 25;
  f[50] = ev0.nEn > 0 && ev0.kills >= ev0.nEn ? 1 : 0;
  f[51] = ev0.dead === 0 ? 1 : 0;
  f[52] = !dies && dK === 0 && dDead === 0 && dE < 0.02 && dDmg < 0.01 && t !== "delay" && t !== "revive" && t !== "shorten" ? 1 : 0;
  if (t === "revive") {
    let n = 0; for (const p of ctx.my.players) { const x = front(p); if (!x || x.revived_used) continue; if (!ctx.applies({ kind: "revive", data: { scope: e.scope, attr: e.attr }, owner: c, team: ctx.side }, x)) continue; if ((ev0.inc.get(x.uid) || 0) >= ctx.preHp(x)) n++; }
    f[53] = n / 3;
  }
  f[54] = !dies && c.uses === b.rules.max_skill_uses - 1 ? 1 : 0;
  // ---- 次のターンの見積もり
  const hg = holdNextGain(ctx, ev0, u, usedNow), PH = hg.P0;
  const usedU = new Set(usedNow); usedU.add(c.uid);
  const PU = t === "revive" || t === "shorten" ? PH : projectNext(ctx, ev1, u.p.id, usedU, turns >= 2 && !["delay", "revive", "shorten", "color_change"].includes(t) ? { apply: effApply(u) } : null);
  f[55] = PH.deaths / 3; f[56] = (PU.deaths - PH.deaths) / 3; f[57] = PH.kills / 3; f[58] = (PU.kills - PH.kills) / 3;
  f[59] = clamp(hg.gain, -3, 3) / 3; f[60] = hg.surv;
  f[61] = PH.enOff / 3; f[62] = PH.enDef / 3; f[63] = PH.enNew / 5; f[64] = clamp(PH.enRev, 0, 3) / 3;
  f[65] = PH.myOff / 3; f[66] = PH.myDefN / 3;
  f[67] = Math.min(4, c.survived) / 4;
  f[68] = leftOf(u.p) <= 1 ? 1 : 0;
  const nxt = u.p.deck.find((y) => y.alive && y.idx > c.idx); f[69] = nxt ? clamp(nxt.power / Math.max(1, c.power * Math.pow(b.rules.survival_mult, c.survived)), 0, 3) : 0;
  f[70] = (tl(ctx.en) - tl(ctx.my)) / 25;
  f[71] = ctx.my.players.filter((q) => q.ghost).length / 5 - ctx.en.players.filter((q) => q.ghost).length / 5;
  if (t === "delay") {
    // 止まるスキルの危険度、止めた相手が次のターンまでに倒れそうか(このターンの残りHPが、次のターンの味方1人の攻撃で削れる程度)、遅延の量の相対的な大きさ
    const amt = Number(e.amount || 1);
    let dang = 0, gone = 0, rel = 0, ns = 0;
    let avgDmg = 0, na = 0; for (const v of PH.my) if (!v.ghost) { avgDmg += v.pw * b.rules.damage_const; na++; } avgDmg = na ? avgDmg / na : 0;
    for (const h of delayHits(ctx, c)) {
      if (!h.stops) continue;
      const pu = ctx.pred && ctx.pred.players[h.q.id] && ctx.pred.players[h.q.id].use_skill;
      if (!pu && h.x.count > 1) continue;
      ns++; dang += (SKILL_DANGER[mainType(h.x)] || 0.5) * clamp(magOf(mainEff(h.x)), 0, 2);
      const rm = ev1.rem && ev1.rem.has(h.x.uid) ? ev1.rem.get(h.x.uid) : ctx.preHp(h.x);
      if (rm > 0 && rm <= avgDmg * 1.2) gone++;
      rel += amt / Math.max(1, h.x.skill_turn);
    }
    f[72] = dang / 3; f[73] = gone / 3; f[74] = ns ? clamp(rel / ns, 0, 2) : 0;
  }
  return f;
}
/* 温存の条件(P.hold7[種類] = [[[特徴番号, ">=" | "<=", しきい値], ...], ...]: どれかの組の条件がすべて成り立てば温存) */
function holdRule(P, t, f) {
  const R = P.hold7 && P.hold7[t]; if (!R) return false;
  return R.some((g) => g.every(([j, op, th]) => (op === ">=" ? f[j] >= th : f[j] <= th)));
}
/* 学習前の初期値: 第6版の重み(f[0..33]) + 「持ち主が生き残り、上積みがない」なら温存寄り・撃破数/倒される味方の上積みは使う寄り */
function use7Default(P) {
  const w = {};
  for (const t of TYPES) {
    const v = (P.use[t] || []).slice(0, 34); while (v.length < NF7) v.push(0);
    if (t !== "delay" && t !== "revive" && t !== "shorten") { v[52] = -1.0; v[34] = 1.0; v[36] = 1.0; }
    if (t === "delay") { v[44] += 0.5; v[45] += 0.5; v[47] = -1.0; }
    if (t === "revive") v[53] = 1.0;
    w[t] = v;
  }
  return w;
}
function decideSkills(ctx, P, base, out) {
  if (ctx.opt.policy === "v6" || ctx.opt.hold2 === true) return decideSkills6(ctx, P, base, out);   // 比較用(第6版の判断 / 例のルールの温存)
  const b = ctx.b, maxU = b.rules.max_skill_uses, W = P.use7 || (P._use7 || (P._use7 = use7Default(P)));
  const forced = ctx.opt.forceUse || null;
  out.held = [];
  const attackers = ctx.my.players.filter((p) => p.ghost || front(p));
  const S = [], undo = [], useFlags = {}, cands = [], seen = new Set(), usedNow = new Set();
  const addCand = (p, c) => { if (seen.has(c.uid)) return; seen.add(c.uid); const t = mainType(c); if (W[t]) cands.push({ p, c, t }); };
  for (const p of ctx.my.players) { const c = front(p); if (c && isReady(b, c)) addCand(p, c); }
  if (!cands.length) { registerUses(ctx, P, base, out, S); return; }
  // 攻撃の計画(狙い・攻撃順)は1回だけ決め、スキルを足した見込みはその計画で当て直す
  const plan = basePlan(ctx, P, attackers, useFlags);
  // 1) 短縮(押した時点で味方のカウントが減る)を先に決め、0以下になった味方を候補に足す(連鎖も)
  ctx.cnt = new Map();
  let ev0 = teamEval(ctx, plan);
  const doneSh = new Set();
  for (let again = true; again;) {
    again = false;
    for (const u of cands) {
      if (u.t !== "shorten" || u.done) continue;
      u.done = true;
      u.f = skillFeatures7(ctx, P, u, S, ev0, plan, usedNow, base); u.z = dot(W[u.t], u.f);
      let use = u.z > 0 && (!strictFor(ctx, u.t) || skillNeeded(u.t, u.f));
      if (forced && u.p.id in forced) use = !!forced[u.p.id];
      if (!use) { out.held.push({ pid: u.p.id, t: u.t, f: u.f, z: u.z }); continue; }
      S.push(u); useFlags[u.p.id] = true; usedNow.add(u.c.uid); doneSh.add(u.c.uid);
      for (const eff of u.c.skill.effects) {
        if (eff.type !== "shorten") continue;
        const probe = { kind: "shorten", data: eff, owner: u.c, team: ctx.side };
        for (const p of ctx.my.players) {
          const x = front(p);
          if (!x || doneSh.has(x.uid) || !x.skill || x.uses >= maxU || x.used_now || !ctx.applies(probe, x)) continue;
          ctx.cnt.set(x.uid, ctx.cntOf(x) - Number(eff.amount ?? 1));
        }
      }
      for (const p of ctx.my.players) { const c = front(p); if (c && !seen.has(c.uid) && c.skill && c.uses < maxU && !c.used_now && ctx.cntOf(c) <= 0) addCand(p, c); }
      again = true;
    }
  }
  // 2) 残りのスキル: 指定(検証用)のものを先に入れ、あとは予測の大きいものから1つずつ足す
  let rest = cands.filter((u) => u.t !== "shorten");
  const take = (u) => { S.push(u); useFlags[u.p.id] = true; usedNow.add(u.c.uid); undo.push(applyU(ctx, u)); rest = rest.filter((v) => v !== u); };
  for (const u of rest.slice()) if (forced && forced[u.p.id] === true) { u.f = skillFeatures7(ctx, P, u, S, ev0, plan, usedNow, base); u.z = dot(W[u.t], u.f); take(u); ev0 = teamEval(ctx, plan); }
  const offHeld = rest.filter((u) => forced && forced[u.p.id] === false);
  rest = rest.filter((u) => !(forced && u.p.id in forced));
  while (rest.length) {
    let best = null;
    for (const u of rest) {
      u.f = skillFeatures7(ctx, P, u, S, ev0, plan, usedNow, base); u.z = dot(W[u.t], u.f);
      if (strictFor(ctx, u.t) && !skillNeeded(u.t, u.f)) u.z = Math.min(u.z, -1e-6);
      if (holdRule(P, u.t, u.f)) { u.z = Math.min(u.z, -1e-6); u.rule = true; }   // 学習で確かめた「温存した方が良い場面」
      if (!best || u.z > best.z) best = u;
    }
    if (best.z <= 0) break;
    take(best);
    ev0 = teamEval(ctx, plan);
  }
  for (const u of rest) out.held.push({ pid: u.p.id, t: u.t, f: u.f, z: u.z });
  for (const u of offHeld) { u.f = skillFeatures7(ctx, P, u, S, ev0, plan, usedNow, base); u.z = dot(W[u.t], u.f); out.held.push({ pid: u.p.id, t: u.t, f: u.f, z: u.z }); }
  // 学習用の記録: 使ったものは「それ以外の予定」に足した場合の特徴に取り直す(使わなかったものは全部の予定に足した場合)
  if (ctx.opt.logFeats) {
    for (let k = undo.length - 1; k >= 0; k--) undo[k]();
    undo.length = 0;
    const nonSh = S.filter((v) => v.t !== "shorten");
    for (const u of nonSh) {
      const others = nonSh.filter((v) => v !== u), un = [];
      for (const v of others) un.push(applyU(ctx, v));
      const un2 = new Set(usedNow); un2.delete(u.c.uid);
      const e0 = teamEval(ctx, plan);
      u.f = skillFeatures7(ctx, P, u, others, e0, plan, un2, base); u.z = dot(W[u.t], u.f);
      for (let k = un.length - 1; k >= 0; k--) un[k]();
    }
  }
  for (let k = undo.length - 1; k >= 0; k--) undo[k]();
  registerUses(ctx, P, base, out, S);
}
/* 決めたスキルを予定の効果として登録し、同じ種類の中の発動順を決める */
function registerUses(ctx, P, base, out, uses) {
  for (const u of uses) {
    const e = mainEff(u.c);
    if (u.t === "delay" || u.t === "revive" || u.t === "shorten") continue;
    ctx.addEff(ctx.side, u.t, e, u.c);
  }
  // 遅延: 止まる相手の予測スキルを不発にする
  for (const u of uses) if (u.t === "delay") for (const h of delayHits(ctx, u.c)) if (h.stops) ctx.addCancel(h.x.uid);
  // 同じ種類のスキルの発動順(種類の順は実機で固定。種類内の順をルールで決める)
  for (const u of uses) {
    const e = mainEff(u.c), c = u.c;
    const inc = base.inc.get(c.uid) || 0;
    const fo = [magOf(e), u.f[2], c.hp / c.max_hp, c.power / 10000, clamp((inc / Math.max(1, c.hp) - 0.7) / 0.6, 0, 1), c.pid === ctx.my.leader ? 1 : 0, c.hp / 10000,
      (Number(e.turns || 1) - 1) / 2, u.f[26] || 0, leftOf(u.p) / 5, u.f[28] || 0];
    u.fo = fo; u.key = dot(P.ord[u.t] || [], fo);
    if (u.t === "shorten") u.key += 10;
  }
  uses.sort((x, y) => (TYPE_PHASE[x.t] - TYPE_PHASE[y.t]) || (y.key - x.key));
  if (ctx.opt.swapSkill) {   // 検証用: 同じ種類の2人のスキルの発動順を入れ替える
    const [pa, pb] = ctx.opt.swapSkill, ia = uses.findIndex((u) => u.p.id === pa), ib = uses.findIndex((u) => u.p.id === pb);
    if (ia >= 0 && ib >= 0 && uses[ia].t === uses[ib].t) { const tmp = uses[ia]; uses[ia] = uses[ib]; uses[ib] = tmp; }
  }
  out.skill_order = uses.map((u) => u.p.id);
  for (const u of uses) out.players[u.p.id].use_skill = true;
  out.uses = uses;
}

/* 第6版の判断(比較用)。opt.policy="v6" で使う。opt.hold2=true なら例のルールで温存(第7版の途中の版) */
function decideSkills6(ctx, P, base, out) {
  const b = ctx.b, uses = [], maxU = b.rules.max_skill_uses;
  out.held = [];
  const evaluated = new Set();
  const decideOne = (p, c) => {
    evaluated.add(c.uid);
    const t = mainType(c); if (!P.use[t]) return;
    const f = skillFeatures(ctx, p, c, base);
    const z = dot(P.use[t], f);
    const need = skillNeeded(t, f);
    let use = z > 0 && (!strictFor(ctx, t) || need);
    if (ctx.opt.forceUse && p.id in ctx.opt.forceUse) use = !!ctx.opt.forceUse[p.id];   // 検証用: この人のスキルを使う/使わないを指定
    if (use) uses.push({ p, c, t, f, z });
    else out.held.push({ pid: p.id, t, f, z, need });
  };
  for (const p of ctx.my.players) { const c = front(p); if (c && isReady(b, c)) decideOne(p, c); }
  // APK: 短縮は押した時点で味方のカウントが減る → 0以下になった味方も同じターンに使うか決める(短縮の連鎖も)
  ctx.cnt = new Map();
  const doneSh = new Set();
  for (let again = true; again;) {
    again = false;
    for (const u of uses) {
      if (u.t !== "shorten" || doneSh.has(u.c.uid)) continue;
      doneSh.add(u.c.uid); again = true;
      for (const eff of u.c.skill.effects) {
        if (eff.type !== "shorten") continue;
        const probe = { kind: "shorten", data: eff, owner: u.c, team: ctx.side };
        for (const p of ctx.my.players) {
          const x = front(p);
          if (!x || doneSh.has(x.uid) || !x.skill || x.uses >= maxU || x.used_now || !ctx.applies(probe, x)) continue;
          ctx.cnt.set(x.uid, ctx.cntOf(x) - Number(eff.amount ?? 1));
        }
      }
    }
    for (const p of ctx.my.players) {
      const c = front(p);
      if (!c || evaluated.has(c.uid) || !c.skill || c.uses >= maxU || c.used_now || ctx.cntOf(c) > 0) continue;
      decideOne(p, c); again = true;
    }
  }
  // 温存ルール(ユーザー指定): 足りているスキルは使わずに残す
  if (ctx.opt.hold2 === true) applyHold(ctx, P, uses, out);
  // 予定の効果として登録(以降の狙い・攻撃順の計算に使う)
  for (const u of uses) {
    const e = mainEff(u.c);
    if (u.t === "delay" || u.t === "revive" || u.t === "shorten") continue;
    ctx.addEff(ctx.side, u.t, e, u.c);
  }
  // 遅延: 相手の予測スキルを不発にする
  for (const u of uses) if (u.t === "delay") {
    const e = mainEff(u.c);
    for (const q of ctx.en.players) { const x = front(q); const tx = mainType(x); if (x && tx !== "shorten" && tx !== "color_change" && tx !== "delay" && (!e.attr || ctx.attrs(x).includes(e.attr))) ctx.addCancel(x.uid); }
  }
  // 同じ種類のスキルの発動順(種類の順は実機で固定。種類内の順をルールで決める)
  for (const u of uses) {
    const e = mainEff(u.c), c = u.c;
    const inc = base.inc.get(c.uid) || 0;
    const fo = [magOf(e), u.f[2], c.hp / c.max_hp, c.power / 10000, clamp((inc / Math.max(1, c.hp) - 0.7) / 0.6, 0, 1), c.pid === ctx.my.leader ? 1 : 0, c.hp / 10000,
      (Number(e.turns || 1) - 1) / 2, u.f[26] || 0, leftOf(u.p) / 5, u.f[28] || 0];
    u.fo = fo; u.key = dot(P.ord[u.t] || [], fo);
    if (u.t === "shorten") u.key += 10;
  }
  uses.sort((x, y) => (TYPE_PHASE[x.t] - TYPE_PHASE[y.t]) || (y.key - x.key));
  if (ctx.opt.swapSkill) {   // 検証用: 同じ種類の2人のスキルの発動順を入れ替える
    const [pa, pb] = ctx.opt.swapSkill, ia = uses.findIndex((u) => u.p.id === pa), ib = uses.findIndex((u) => u.p.id === pb);
    if (ia >= 0 && ib >= 0 && uses[ia].t === uses[ib].t) { const tmp = uses[ia]; uses[ia] = uses[ib]; uses[ib] = tmp; }
  }
  out.skill_order = uses.map((u) => u.p.id);
  for (const u of uses) out.players[u.p.id].use_skill = true;
  out.uses = uses;
}

/* ---------- 攻撃順と狙い ---------- */
function attackFeatures(ctx, p, ai, theirs, maxD) {
  const f = new Array(10).fill(0);
  f[0] = 1; f[1] = ai.ghost ? 1 : 0; f[2] = (ai.hits - 1) / 2; f[3] = ai.all ? 1 : 0;
  let best = 0, kill = 0, adv = 0;
  for (const y of theirs) {
    const d = ai.hits * ctx.hit(ai, y, null); best = Math.max(best, d);
    if (d >= ctx.preHp(y)) kill = 1;
    if (!ai.ghost && ctx.b.attr_mult(ai.attrs, ctx.attrs(y)) > 1) adv++;
  }
  f[4] = maxD > 0 ? best / maxD : 0; f[5] = kill;
  f[6] = ctx.cover(ai, ctx.os) ? 1 : 0;
  f[7] = theirs.length ? adv / theirs.length : 0;
  f[8] = ai.ups.length ? 1 : 0;
  f[9] = theirs.length <= 1 ? 1 : 0;
  return f;
}
const SKILL_DANGER = { all_attack: 1, multi_attack: 1, atk_up: 1, revive: 1, cover: 0.9, shield: 0.7, heal: 0.6, color_change: 0.5, delay: 0.5, shorten: 0.4 };
/* スキルが次のターンまでに発動しそうか(カウント1以下で使用回数が残っている)。カウント2なら少し */
function skillSoon(b, y) {
  if (!y.skill || y.uses >= b.rules.max_skill_uses) return 0;
  return y.count <= 1 ? 1 : y.count === 2 ? 0.4 : 0;
}
function targetFeatures(ctx, ai, y, rem, thr, maxThr, revivable, kanpai) {
  const b = ctx.b, f = new Array(30).fill(0);
  const q = b.players[y.pid], hp = rem.get(y.uid), d = ai.hits * ctx.hit(ai, y, null);
  f[0] = hp > 0 && d >= hp ? 1 : 0;
  f[1] = hp > 0 ? Math.min(1, d / hp) : 0;
  f[2] = hp <= 0 ? 1 : 0;
  f[3] = maxThr > 0 ? thr.get(y.pid) / maxThr : 0;
  const rd = isReady(b, y), t = mainType(y);
  f[4] = rd ? 1 : 0; f[5] = rd && OFF.has(t) ? 1 : 0; f[6] = rd && !OFF.has(t) ? 1 : 0;
  f[7] = leftOf(q) / 5; f[8] = leftOf(q) <= 1 ? 1 : 0;
  f[9] = maxThr > 0 ? (ctx.nextThreat(q) - thr.get(y.pid)) / maxThr : 0;
  const m = ai.ghost ? 1 : b.attr_mult(ai.attrs, ctx.attrs(y));
  f[10] = m > 1 ? 1 : 0; f[11] = m < 1 ? 1 : 0;
  f[12] = Math.max(0, hp) / y.max_hp;
  f[13] = y.pid === ctx.en.leader ? 1 : 0;
  f[14] = revivable.has(y.uid) ? 1 : 0;
  f[15] = 1;
  f[16] = (kanpai || 0) * (1 - (leftOf(q) - 1) / 4);
  const soon = skillSoon(b, y);
  f[17] = soon; f[18] = soon * (SKILL_DANGER[t] || 0.5);
  let mx = 0; for (const p of ctx.en.players) if (front(p)) mx = Math.max(mx, leftOf(p));
  f[19] = leftOf(q) >= mx ? 1 : 0;
  f[20] = soon * f[0];
  f[21] = soon && (t === "atk_up" || t === "multi_attack" || t === "all_attack") ? soon : 0;
  f[22] = soon && (t === "revive" || t === "cover" || t === "shield") ? soon : 0;
  f[23] = f[19] * f[0];
  f[24] = ctx.effects(ctx.os).some((e) => e.kind === "cover" && !e.data.to_leader && e.owner && e.owner.pid === y.pid) ? 1 : 0;
  f[25] = ctx.pred && ctx.pred.players[y.pid] && ctx.pred.players[y.pid].use_skill ? 1 : 0;
  const ey = mainEff(y);
  f[26] = soon && ey ? soon * clamp(magOf(ey), 0, 2) : 0;
  f[27] = soon && ey ? soon * clamp((Number(ey.turns || 1) - 1) / 2, 0, 2) : 0;
  f[28] = f[0] && (ai.ups.length > 0 || ai.hits > 1) ? 1 : 0;
  f[29] = f[25] && (t === "shield" || t === "cover" || t === "heal") ? 1 : 0;
  return f;
}
/* 攻撃の順番どおりに当てたときの見込み(かばう役が途中で倒れたら、以降の攻撃はかばわれない: エンジンの _cover_for と同じ)
   seq = [{ x: {p, ai}, tgt: 相手キャラ or null }]。ダメージは乱数の下ぶれを見て少し控えめ(SIM_F)に見積もる */
const SIM_F = 0.95;
const NEXTW_DEF = { d: 0.5, k: 0.3 };
function simAttack(ctx, theirs, seq) {
  const rem = new Map(); for (const y of theirs) rem.set(y.uid, ctx.preHp(y));
  const covers = ctx.effects(ctx.os).filter((e) => e.kind === "cover" && !(e.owner && ctx.cancel.has(e.owner.uid) && e.seq >= 1e6)).sort((x, y) => y.seq - x.seq);
  const coverDyn = (ai) => {
    if (ai.ghost) return null;
    for (const e of covers) {
      let o = e.owner ? front(ctx.b.players[e.owner.pid]) : null;
      if (e.data.to_leader) o = front(ctx.b.players[ctx.b.teams[e.team].leader]);
      if (!o || !rem.has(o.uid) || rem.get(o.uid) <= 0) continue;
      const vs = e.data.vs_attr || null;
      if (vs === null || ai.attrs.includes(vs)) return { c: o, cut: Number(e.data.cut || 0) };
    }
    return null;
  };
  const alive = () => theirs.filter((y) => rem.get(y.uid) > 0);
  const dmgTo = (ai, y, cut) => SIM_F * ctx.hit(ai, y, cut);
  let stray = 0;
  for (const { x, tgt } of seq) {
    const ai = x.ai;
    for (let h = 0; h < ai.hits; h++) {
      const al = alive(); if (!al.length) break;
      const cv = coverDyn(ai);
      if (ai.all) {
        for (let k = 0; k < al.length; k++) {
          if (cv) { if (rem.get(cv.c.uid) <= 0) break; rem.set(cv.c.uid, rem.get(cv.c.uid) - dmgTo(ai, cv.c, cv.cut)); }
          else rem.set(al[k].uid, rem.get(al[k].uid) - dmgTo(ai, al[k], null));
        }
        continue;
      }
      if (cv) { rem.set(cv.c.uid, rem.get(cv.c.uid) - dmgTo(ai, cv.c, cv.cut)); continue; }
      if (tgt && rem.get(tgt.uid) > 0) { rem.set(tgt.uid, rem.get(tgt.uid) - dmgTo(ai, tgt, null)); continue; }
      // 狙いが既に倒れている: 生きている相手からランダムに当たる。撃破を当てにしないよう、残りHPの最も多い相手に当たるとみなす
      let y0 = al[0]; for (const y of al) if (rem.get(y.uid) > rem.get(y0.uid)) y0 = y;
      rem.set(y0.uid, rem.get(y0.uid) - dmgTo(ai, y0, null)); stray++;
    }
  }
  let kills = 0, eff = 0;
  for (const y of theirs) { const s = ctx.preHp(y), r = rem.get(y.uid); if (r <= 0) kills++; eff += (s - Math.max(0, r)) / Math.max(1, s); }
  return { rem, kills, eff, stray };
}

function assign(ctx, P, out, attackers, quiet) {
  const forced = [];
  const b = ctx.b;
  const theirs = ctx.en.players.map(front).filter(Boolean);
  const rem = new Map(); for (const y of theirs) rem.set(y.uid, ctx.preHp(y));
  const thr = new Map(); let maxThr = 0;
  for (const q of ctx.en.players) { const v = ctx.threat(q, ctx.side); thr.set(q.id, v); maxThr = Math.max(maxThr, v); }
  // 相手が蘇生を使えそうなら、倒しても戻される
  const revivable = new Set();
  for (const q of ctx.en.players) {
    const x = front(q); if (!x || !isReady(b, x) || mainType(x) !== "revive" || ctx.cancel.has(x.uid)) continue;
    const e = mainEff(x);
    for (const y of theirs) if (!y.revived_used && ctx.applies({ kind: "revive", data: { scope: e.scope, attr: e.attr }, owner: x, team: ctx.os }, y)) revivable.add(y.uid);
  }
  const leftT = (tm) => tm.players.reduce((s2, p) => s2 + (p.ghost ? 0 : leftOf(p)), 0);
  const kanpai = ctx.en.players.some((p) => p.ghost) ? 0 : clamp((leftT(ctx.en) - leftT(ctx.my)) / 8, 0, 1);   // 完敗の危険度
  const infos = attackers.map((p) => ({ p, ai: ctx.atkInfo(p) })).filter((x) => x.ai);
  let maxD = 0;
  for (const x of infos) for (const y of theirs) maxD = Math.max(maxD, x.ai.hits * ctx.hit(x.ai, y, null));
  for (const x of infos) { x.fa = attackFeatures(ctx, x.p, x.ai, theirs, maxD); x.key = dot(P.att.slice(0, 10), x.fa); }
  infos.sort((u, v) => v.key - u.key);
  const log = [];
  for (const x of infos) {
    const ai = x.ai;
    if (!theirs.length) { out.players[x.p.id].target = null; continue; }
    if (ai.all) {
      const cv = ctx.cover(ai, ctx.os);
      const hitsOn = theirs.map((y) => { const tc = cv ? cv.c : y; return [tc, ai.hits * ctx.hit(ai, tc, cv ? cv.cut : null)]; });
      for (const [tc, d] of hitsOn) { const before = rem.get(tc.uid); rem.set(tc.uid, before - d); if (before > 0 && before - d <= 0) log.push({ x, y: tc, kill: true, before, d, all: true }); }
      out.players[x.p.id].target = null; log.push({ x, y: null, kill: false }); continue;
    }
    const cv = ctx.cover(ai, ctx.os);
    if (cv) {
      const before = rem.get(cv.c.uid), d = ai.hits * ctx.hit(ai, cv.c, cv.cut);
      rem.set(cv.c.uid, before - d);
      out.players[x.p.id].target = cv.c.pid; log.push({ x, y: cv.c, kill: before > 0 && rem.get(cv.c.uid) <= 0, before, d, cover: true }); continue;
    }
    let best = null, bs = -1e9, bf = null;
    const tlog = !quiet && ctx.opt.tgtLog ? (out.tgtFeats = out.tgtFeats || {})[x.p.id] = [] : null;   // 検証用: 狙いの候補ごとの特徴
    for (const y of theirs) {
      const f = targetFeatures(ctx, ai, y, rem, thr, maxThr, revivable, kanpai);
      const s = dot(P.tgt, f);
      if (tlog) tlog.push([y.pid, f, s]);
      if (s > bs) { bs = s; best = y; bf = f; }
    }
    if (ctx.opt.forceTarget && x.p.id in ctx.opt.forceTarget) {   // 検証用: この人の狙いを指定
      const fy = theirs.find((y) => y.pid === ctx.opt.forceTarget[x.p.id]);
      if (fy) best = fy;
    }
    if (!best) { forced.push(x.p.id); continue; }
    const before = rem.get(best.uid), d = ai.hits * ctx.hit(ai, best, null);
    rem.set(best.uid, before - d);
    // 倒しきった後の余り(連撃)は他の相手にばらける
    if (before > 0 && d > before && ai.hits > 1) {
      const others = theirs.filter((y) => y !== best && rem.get(y.uid) > 0);
      const spill = (d - before) / ai.hits * (ai.hits - 1) * 0.5;
      for (const y of others) rem.set(y.uid, rem.get(y.uid) - spill / others.length);
    }
    out.players[x.p.id].target = best.pid;
    log.push({ x, y: best, kill: before > 0 && before - d <= 0, before, d });
  }
  // 2回目: 狙いが決まった後の関係(同じ相手を狙う人数・1人で倒せるか・味方と合わせて倒すか)で攻撃順を並べ直す
  const start = new Map(); for (const y of theirs) start.set(y.uid, ctx.preHp(y));
  for (const e of log) {
    if (e.all) continue;
    const me = e.x.ai.c, incMe = me && ctx.base ? (ctx.base.inc.get(me.uid) || 0) : 0;
    const post = [0, 0, 0, 0, out.players[e.x.p.id].use_skill ? 1 : 0, 0, 0, 0, e.cover ? 1 : 0, me && incMe >= ctx.preHp(me) ? 1 : 0, 0];
    if (e.y) {
      post[5] = skillSoon(b, e.y);
      post[6] = !e.x.ai.ghost && b.attr_mult(e.x.ai.attrs, ctx.attrs(e.y)) > 1 ? 1 : 0;
      post[7] = (start.get(e.y.uid) || 0) / e.y.max_hp;
      post[0] = log.filter((o) => o !== e && o.y === e.y).length / 4;
      const hp0 = start.get(e.y.uid) || 1, d = e.d != null ? e.d : (e.before != null ? e.before - rem.get(e.y.uid) : 0);
      post[1] = d >= hp0 ? 1 : 0;
      post[2] = d < hp0 && rem.get(e.y.uid) <= 0 ? 1 : 0;
      post[3] = clamp(d / hp0, 0, 2);
      post[10] = e.x.ai.hits > 1 && post[1] ? 1 : 0;
    }
    e.x.fa = e.x.fa.concat(post);
    e.x.key2 = dot(P.att, e.x.fa);
  }
  for (const x of infos) if (x.key2 === undefined) { const me = x.ai.c, incMe = me && ctx.base ? (ctx.base.inc.get(me.uid) || 0) : 0; x.fa = x.fa.concat([0, 0, 0, 0, out.players[x.p.id].use_skill ? 1 : 0, 0, 0, 0, 0, me && incMe >= ctx.preHp(me) ? 1 : 0, 0]); x.key2 = dot(P.att, x.fa); }
  const ordered = infos.filter((x) => !forced.includes(x.p.id)).sort((u, v) => v.key2 - u.key2);
  out.order = ordered.map((x) => x.p.id);
  // ---- かばう崩し(ユーザー指定): かばう役が倒れると、それ以降の攻撃はかばわれない(エンジンと同じ)。
  //   例: 風属性の攻撃をかばう相手がいる → 風を含まない味方を攻撃順の先頭にしてかばう役を狙い、倒せたら残りの風を含まない味方は別の相手へ。
  //   風を含む味方は最初から別の相手を狙う(かばう役が倒れた後に攻撃する)。
  //   かばう役を倒す組(B)を全部試し、学習した狙い・攻撃順より撃破数(同じなら削り)が多い案だけ採用する
  const byPid = new Map(ordered.map((x) => [x.p.id, x]));
  const tgtOf = (pid) => { const tp = out.players[pid].target; return tp ? front(b.players[tp]) : null; };
  let chosen = simAttack(ctx, theirs, out.order.map((pid) => ({ x: byPid.get(pid), tgt: tgtOf(pid) })));
  const score = (r) => r.kills + 0.15 * r.eff - 0.05 * r.stray;   // 空振り後のランダムな当たりは少しだけ割り引く
  const coverChars = [];
  for (const e of ctx.effects(ctx.os)) {
    if (e.kind !== "cover" || (e.owner && ctx.cancel.has(e.owner.uid) && e.seq >= 1e6)) continue;
    const o = e.data.to_leader ? front(b.players[ctx.en.leader]) : e.owner ? front(b.players[e.owner.pid]) : null;
    if (o && theirs.includes(o) && !coverChars.includes(o)) coverChars.push(o);
  }
  if (coverChars.length && theirs.length > 1 && ctx.opt.coverBreak !== false) {
    const single = ordered.filter((x) => !x.ai.all), alls = ordered.filter((x) => x.ai.all);
    let best = null;
    for (const C of coverChars) {
      const hpC = ctx.preHp(C);
      const cvOf = new Map(ordered.map((x) => { const cv = ctx.cover(x.ai, ctx.os); return [x.p.id, cv && cv.c === C ? cv.cut : null]; }));   // C にかばわれる人はそのカット
      const onC = (x) => SIM_F * x.ai.hits * ctx.hit(x.ai, C, cvOf.get(x.p.id));
      const n = single.length;
      for (let mask = 1; mask < (1 << n); mask++) {
        const B = single.filter((_, i) => mask & (1 << i)), R = single.filter((_, i) => !(mask & (1 << i)));
        if (B.reduce((s2, x) => s2 + onC(x), 0) < hpC) continue;
        B.sort((u, v) => ((cvOf.get(u.p.id) != null) - (cvOf.get(v.p.id) != null)) || (onC(v) - onC(u)));   // かばわれない人が先
        const remR = new Map(); for (const y of theirs) remR.set(y.uid, ctx.preHp(y)); remR.set(C.uid, 0);
        const tg = new Map();
        for (const x of R) {
          let by = null, bs = -1e9;
          for (const y of theirs) { if (y === C) continue; const s2 = dot(P.tgt, targetFeatures(ctx, x.ai, y, remR, thr, maxThr, revivable, kanpai)); if (s2 > bs) { bs = s2; by = y; } }
          if (!by) continue;
          tg.set(x.p.id, by); remR.set(by.uid, remR.get(by.uid) - x.ai.hits * ctx.hit(x.ai, by, null));
        }
        const allFree = alls.filter((x) => cvOf.get(x.p.id) == null), allInt = alls.filter((x) => cvOf.get(x.p.id) != null);
        const seq = [...allFree.map((x) => ({ x, tgt: null })), ...B.map((x) => ({ x, tgt: C })), ...R.map((x) => ({ x, tgt: tg.get(x.p.id) || null })), ...allInt.map((x) => ({ x, tgt: null }))];
        const r = simAttack(ctx, theirs, seq);
        if (r.rem.get(C.uid) > 0) continue;
        if (!best || score(r) > score(best.r) + 1e-9) best = { r, seq };
      }
    }
    if (best && score(best.r) > score(chosen) + 1e-9) {
      for (const { x, tgt } of best.seq) out.players[x.p.id].target = tgt ? tgt.pid : null;
      out.order = best.seq.map((s2) => s2.x.p.id);
      out.coverBreak = true;
      chosen = best.r;
    }
  }
  // ---- 撃破数を増やす狙いの付け替え: 1人ずつ狙いを別の相手に替えてみて、攻撃順どおりに当てた見込みの撃破数が増えるなら替える
  //   (撃破数が同じなら学習した狙いのまま。opt.killSearch=false で切る。仮想対戦 5000試合で +0.055±0.015)
  // 次のターンの見積もりも入れて狙い・攻撃順を探す({d: 次のターンに倒される見込みの重み, k: 倒せる見込みの重み}。false で撃破数だけの付け替え)
  //   仮想対戦 5000試合: d0.5・k0.3 は撃破数だけの付け替えより +0.050±0.015、d1・k0.5 は +0.005±0.015
  const NX = ctx.opt.nextW === undefined ? NEXTW_DEF : ctx.opt.nextW || null;
  if (ctx.opt.killSearch !== false && theirs.length > 1 && !quiet && !NX) {
    let cur = out.order.map((pid) => ({ x: byPid.get(pid), tgt: out.players[pid].target ? front(b.players[out.players[pid].target]) : null }));
    for (let it = 0; it < 6; it++) {
      let bestMove = null, bk = chosen.kills, be = chosen.eff;
      for (let i = 0; i < cur.length; i++) {
        const s0 = cur[i];
        if (s0.x.ai.all || !s0.tgt) continue;
        for (const y of theirs) {
          if (y === s0.tgt) continue;
          const seq = cur.slice(); seq[i] = { x: s0.x, tgt: y };
          const r = simAttack(ctx, theirs, seq);
          if (r.kills > bk || (r.kills === bk && bestMove && r.eff > be + 1e-9)) { bk = r.kills; be = r.eff; bestMove = { i, y, r }; }
        }
      }
      if (!bestMove || bestMove.r.kills <= chosen.kills) break;
      cur[bestMove.i] = { x: cur[bestMove.i].x, tgt: bestMove.y };
      out.players[cur[bestMove.i].x.p.id].target = bestMove.y.pid;
      chosen = bestMove.r; out.killSearch = (out.killSearch || 0) + 1;
    }
  }
  // ---- 次のターンまで見た狙い・攻撃順の探索: このターンの撃破・削りに加え、倒した相手の後ろから出てくるキャラ(予想)、
  //   生き残った相手の伸びた攻撃力・次のターンに使えるスキル、こちらの残りHPから、次のターンに倒される見込み・倒せる見込みを見積もる。
  //   狙いの付け替え(誰を狙うか)と攻撃順の移動(先頭・最後へ)を、見積もりが良くなる限り繰り返す
  if (NX && theirs.length > 1 && !quiet) {
    const usedNow = new Set((out.uses || []).map((u) => u.c.uid));
    const incNow = incoming(ctx, ctx.pred || null).inc;
    const evalSeq = (seq) => {
      const r = simAttack(ctx, theirs, seq);
      const pj = projectNext(ctx, { inc: incNow, rem: r.rem }, null, usedNow, null);
      return { r, v: r.kills + 0.15 * r.eff - 0.05 * r.stray - NX.d * pj.deaths + NX.k * pj.kills };
    };
    let cur = out.order.map((pid) => ({ x: byPid.get(pid), tgt: out.players[pid].target ? front(b.players[out.players[pid].target]) : null }));
    let cv = evalSeq(cur);
    for (let it = 0; it < 8; it++) {
      let bm = null;
      for (let i = 0; i < cur.length; i++) {
        const s0 = cur[i];
        if (!s0.x.ai.all) for (const y of theirs) {
          if (y === s0.tgt) continue;
          const seq = cur.slice(); seq[i] = { x: s0.x, tgt: y };
          const e2 = evalSeq(seq); if (e2.v > (bm ? bm.e.v : cv.v + 0.02)) bm = { seq, e: e2 };
        }
        for (const pos of [0, cur.length - 1]) {
          if (pos === i) continue;
          const seq = cur.slice(); const [mv] = seq.splice(i, 1); seq.splice(pos, 0, mv);
          const e2 = evalSeq(seq); if (e2.v > (bm ? bm.e.v : cv.v + 0.02)) bm = { seq, e: e2 };
        }
      }
      if (!bm) break;
      cur = bm.seq; cv = bm.e; out.killSearch = (out.killSearch || 0) + 1;
    }
    for (const { x, tgt } of cur) if (!x.ai.all) out.players[x.p.id].target = tgt ? tgt.pid : null;
    out.order = cur.map((q) => q.x.p.id);
    chosen = cv.r;
  }
  if (ctx.opt.swapOrder) {   // 検証用: 2人の攻撃順を入れ替える
    const [pa, pb] = ctx.opt.swapOrder, ia = out.order.indexOf(pa), ib = out.order.indexOf(pb);
    if (ia >= 0 && ib >= 0) { out.order[ia] = pb; out.order[ib] = pa; }
  }
  out.attFeats = Object.fromEntries(infos.map((x) => [x.p.id, x.fa]));
  // rem は攻撃順どおりに当てた見込み(かばう役が倒れた後の攻撃も反映)
  return { log, rem: chosen.rem, theirs, thr, maxThr, forced };
}

/* ---------- 1チーム分の判断 ---------- */
function decideCore(b, side, opt) {
  const P = opt.params || PARAMS;
  if (opt.hold) setHold(opt.hold);
  const ctx = new Ctx(b, side, opt);
  const out = { players: {}, skill_order: [], order: [], wrong: [], uses: [] };
  for (const p of ctx.my.players) out.players[p.id] = { correct: true, answer_code: 1, priority: "normal", target: null, use_skill: false };
  // 相手の予測(相手の立場で同じルール)
  if ((opt.level ?? 1) >= 1) {
    const pred = predictEnemy(b, side, opt);
    ctx.pred = pred;
    for (const u of pred.uses || []) {
      if (u.t === "delay" || u.t === "revive" || u.t === "shorten") continue;
      ctx.addEff(ctx.os, u.t, mainEff(u.c), u.c);
    }
  } else {
    // 予測なし(相手の予測に使う簡易版): 相手は準備済みの攻撃系スキルを使うと見る
    for (const q of ctx.en.players) { const x = front(q); if (x && isReady(b, x) && (mainType(x) === "atk_up" || mainType(x) === "multi_attack" || mainType(x) === "all_attack")) ctx.addEff(ctx.os, mainType(x), mainEff(x), x); }
  }
  const base = incoming(ctx, ctx.pred || null);
  ctx.base = base;
  decideSkills(ctx, P, base, out);
  const attackers = ctx.my.players.filter((p) => p.ghost || front(p));
  let res = assign(ctx, P, out, attackers);
  out.kills = res.log.filter((e) => e.kill && e.y).map((e) => e.x.p.id);
  out.order = out.order.filter((pid) => !out.wrong.includes(pid));
  if (opt.seatOrder) out.order = ctx.my.players.map((p) => p.id).filter((pid) => out.order.includes(pid));   // 比較用: 攻撃順を席順に
  out.pred = ctx.pred ? { players: ctx.pred.players, skill_order: ctx.pred.skill_order, order: ctx.pred.order, wrong: ctx.pred.wrong } : null;
  out.ctxPlan = ctx.plan[side].map((e) => ({ kind: e.kind, owner: e.owner && e.owner.pid }));
  return out;
}
function decide(b, side, opt) { return decideCore(b, side, Object.assign({ level: 1 }, opt || {})); }

/* 両チームの入力を1ターン分にまとめる(チーム内の攻撃順は各チームのまま、チーム間はランダムに混ぜる) */
function merge(b, outA, outB, rnd) {
  const players = {};
  const qa = outA.order.slice(), qb = outB.order.slice(), seq = [];
  while (qa.length || qb.length) {
    if (!qb.length || (qa.length && rnd() < qa.length / (qa.length + qb.length))) seq.push(qa.shift()); else seq.push(qb.shift());
  }
  let r = 1;
  for (const pid of seq) players[pid] = Object.assign({}, (outA.players[pid] || outB.players[pid]), { rank: r++ });
  for (const o of [outA, outB]) for (const pid in o.players) if (!players[pid]) players[pid] = Object.assign({}, o.players[pid], { rank: 100 + r++ });
  const so = [], sa = outA.skill_order.slice(), sb = outB.skill_order.slice();
  while (sa.length || sb.length) { if (!sb.length || (sa.length && rnd() < 0.5)) so.push(sa.shift()); else so.push(sb.shift()); }
  return { players, skill_order: so };
}

/* 結果のランク点(APK確定: 完勝=勝利かつ味方プレイヤー全員生存 / 完敗=敗北かつ撃破数0) */
function rankPoint(b, side) {
  if (!b.finished) return 0;
  const w = b.result.winner, os = side === "A" ? "B" : "A";
  if (w === "draw") return 0;
  if (w === side) return b.teams[side].players.every((p) => !p.ghost) ? 2 : 1;
  return b.teams[os].players.some((p) => p.ghost) ? -1 : -2;
}
function resultName(pt) { return { 2: "完勝", 1: "勝利", 0: "引き分け", "-1": "敗北", "-2": "完敗" }[pt]; }

const predictNextFor = (b, side, pid, band) => new Ctx(b, side, { band }).predictNext(b.players[pid]);
const api = { sampleTail, decide, decideCore, merge, predictNextFor, skillNeeded, setHold, rankPoint, resultName, setParams, setMeta, defaultParams, flatten, unflatten, mergeParams, use7Default, NF7, F_USE7,
  get PARAMS() { return PARAMS; }, TYPES, F_USE, F_ORD, F_ATT, F_TGT, F_WRONG };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.EigoBrain = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

try { EigoBrain.setMeta(null); EigoBrain.setParams({"use": {"atk_up": [-1.48791, 0.776, 3.07241, 1.88937, 5.99253, 1.74832, -1.79874, 3.3001, -0.95808, -1.16325, 0.12503, -0.16602, 0.38963, -0.23972, -0.49226, 1.61123, 1.56381, 1.62196, 0.5423, 1.27522, -0.59823, 0.2777, 0.34313, 1.04809, 0.22299, 0.81043, -1.76519, 0.21618, -0.19459, 0.45099, 0.30406, 0.0, -0.31322, 0.0], "multi_attack": [-1.85257, 1.30108, -0.29506, 3.33962, 3.01101, 0.17741, -0.81888, 1.1097, 0.35221, -0.60366, -0.46114, 0.3838, 1.36947, -0.81258, 0.63181, 0.39271, -0.73819, 2.38211, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], "all_attack": [-0.13485, 0.68306, 1.46255, 2.41782, 1.77976, -0.72739, -1.61938, 1.45928, -1.27458, 0.2401, 0.42888, 1.23029, -0.46904, -0.56771, 0.26795, -0.02853, -0.05395, 1.26678, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], "shield": [-2.4123, 0.58587, -0.37008, -0.1189, 0.08626, 2.23169, 1.92489, 1.17515, -1.74869, 0.7164, 0.2211, 2.3265, 0.61951, 0.05002, -0.21737, -0.08315, 1.58238, 2.30818, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], "cover": [-2.70267, -0.20691, 0.10214, -0.73981, -0.90232, 1.88896, 1.6868, -0.64444, 0.37986, -0.2877, 1.04932, 1.08356, 0.14991, 0.65148, 0.59843, 0.69727, -0.224, 1.9956, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], "heal": [2.04547, -0.2746, 0.43345, 0.0, 0.0, -1.03147, 3.7877, -0.07536, -0.56758, -1.4815, 1.62679, 2.46716, -0.38251, 1.14933, 0.19864, 0.01567, 0.0, -0.02713, 0.91633, 0.62937, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], "color_change": [-1.49651, 0.0, -1.11549, 1.25528, 0.18747, -0.35905, 0.0, 0.99253, 0.46705, -2.00985, 1.33569, -0.80132, -0.05049, 2.81584, 0.76205, -0.04208, 2.20433, 0.51333, 0.61104, 0.17625, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], "shorten": [-1.80734, 0.06708, -0.28861, 1.34473, 0.58953, -0.49146, -0.00685, 0.60793, -0.4942, 1.72141, 0.68475, 4.48955, -1.25496, -0.43037, 0.1804, -0.63384, -0.79607, 3.02408, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], "delay": [-3.22892, 0.3096, 1.28288, -0.1001, -0.93455, -1.2253, 0.1327, 2.6346, -0.86811, -0.10564, 1.37596, 4.25648, 0.96778, -1.52087, 0.09474, -0.10243, -0.05659, 3.39804, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], "revive": [-0.05252, 1.5049, -0.26067, -0.10963, 0.18472, 2.36779, 0.105, 0.01766, -0.316, 0.97594, -0.24473, 2.58755, 0.73115, -0.09674, 0.25766, 0.40824, -0.00291, 1.74722, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]}, "ord": {"atk_up": [0, 0, 0, 0, 0, 0, 0], "multi_attack": [0, 0, 0, 0, 0, 0, 0], "all_attack": [0, 0, 0, 0, 0, 0, 0], "shield": [0, 0, 0, 0, 0, 0, 0], "cover": [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, -0.3, 0.0, 0.0, 0.0, 0.0], "heal": [1, 0, 0, 0, 0, 0, 0], "color_change": [0.0, 2.19, 1.208, 0.994, 0.628, -0.352, 0.0, 0.0, 0.0, 0.0, 0.0], "shorten": [0.472, 0.558, 0.73, -0.528, 0.052, -0.318, 0], "delay": [5.232, -0.56, -0.022, 1.288, -0.582, -0.27, 0.0, 0.0, 0.0, 0.0, 0.0], "revive": [2.22528, -1.88655, -4.76893, 1.92451, 1.80866, 0.03816, -0.18834, 0.0, 4.48732, 1.30491, 3.07228]}, "att": [-1.00294, -0.0888, -1.76642, 3.12973, -1.09462, 0.24969, 0.65391, 0.06553, -0.1256, -1.30751, 1.03486, 0.24151, -0.55819, 2.16987, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], "tgt": [3.5668975760462702, 3.8691399534375823, -3.0952271867521883, 2.5335319468845015, -0.023429588967616575, -1.0415051789001457, -0.492241697876331, 2.703151910720221, 0.3007823640106551, 0.32238954803599157, 0.601095837826466, -1.3004458292276306, 1.5687664594493151, 0.3146670724729055, -0.6935866872428986, 0.02803542271690443, 0.3665191707230846, 3.8049158378916883, 0.8829900451681192, 4.422782089895084, 0.16795286060651765, -0.5431036601128751, 0.2104065351383963, 0.8677750979262944, 1.2468580707180101, -0.3819745699673567], "wrong": [-99, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "hold7": {"cover": [[[51, ">=", 0.5]]], "shield": [[[51, ">=", 0.5]]]}}); } catch (e) {}
