/* 相性AIの計算(本体/tools/deck_opt.js・web/compat_ai.js・web/compat_set.js をそのまま並べた物) */
/* 相性表で点数が最大になるデッキを、全組み合わせの中から確実に見つける(ユーザー 2026-11-08: 各枠に全キャラを入れてみて、縛りコスト内で最大になるもの)
 *   点数(デッキ) = Σ枠 L[キャラ, 枠] + Σ(枠の組 i<j) E[キャラi, i]·E[キャラj, j]
 *     L = キャラ単体の値 + 味方・敵(環境 = 加重平均)との相性、E·E = デッキ内の相性(d ベクトルにリーダーの見込みの重みの平方根を掛けて並べたもの)
 *   条件: 合計コスト ≤ 上限、伝は1体まで、同じキャラなし、使えるキャラ(縛り)だけ
 *   方法(分枝限定法。捨てるのは最大になり得ないものだけなので、全組み合わせを調べたのと同じ答え。tools/deck_opt_check.js で総当たりと一致を確認):
 *     ⓪ デッキ内の2体の組の値の表(枠の組10通り × 全キャラ × 全キャラ)。環境によらないので、モデルごとに1回(prepare)
 *     ① 速い探し方(無作為の出発点から1枠ずつ全キャラ・2枠の入れ替え)で、基準の点数(上位 top 個目)を作る
 *     ② 枠ごとに、そのキャラを入れたときの上限が基準に届かないキャラを候補から外す。残った候補で組の上限を計算し直して、外せなくなるまで繰り返す
 *     ③ 残った候補で、枠1から順に全キャラを試す木を、上限が基準に届かない枝を捨てながらたどる
 *     上限 = 決めた分の点数 + 決めたキャラと残りの枠との組の最大 + 残りの枠の(単体 + 残りの枠どうしの組の最大の半分)をコスト内で最大にした値(動的計画法)
 *   node・画面(web/compat_ai.js)の両方で使う:
 *     const P = DeckOpt.prepare(N, K2, E);  DeckOpt.solve({ P, L, cost, leg, ok, cap, top }) → [{deck: [キャラ番号×5], score}](5体の組が違うもの、点数の高い順)
 */
(function (root) {
  "use strict";
  const PAIRS = []; for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) PAIRS.push([i, j]);
  const PI = [0, 1, 2, 3, 4].map((i) => [0, 1, 2, 3, 4].map((j) => PAIRS.findIndex(([a, b]) => (a === Math.min(i, j) && b === Math.max(i, j)))));
  /** ⓪ 組の値の表 T[組][a*N+b] = E[a,i]·E[b,j](i<j) */
  function prepare(N, K2, E) {
    const T = PAIRS.map(([i, j]) => {
      const t = new Float32Array(N * N);
      for (let a = 0; a < N; a++) { const oa = (a * 5 + i) * K2; for (let b = 0; b < N; b++) { const ob = (b * 5 + j) * K2; let s = 0; for (let q = 0; q < K2; q++) s += E[oa + q] * E[ob + q]; t[a * N + b] = s; } }
      return t;
    });
    return { N, T };
  }
  function solve(o) {
    const { P, L, cost, leg, ok, cap } = o, { N, T } = P, top = o.top || 1;
    const dot = (a, i, b, j) => (i < j ? T[PI[i][j]][a * N + b] : T[PI[i][j]][b * N + a]);
    const all = []; for (let c = 0; c < N; c++) if (ok[c] && cost[c] <= cap) all.push(c);
    if (all.length < 5) return [];
    let minC = Infinity; for (const c of all) minC = Math.min(minC, cost[c]);
    const score = (d) => { let s = 0; for (let i = 0; i < 5; i++) { s += L[d[i] * 5 + i]; for (let j = i + 1; j < 5; j++) s += dot(d[i], i, d[j], j); } return s; };
    const res = [];
    const thr = () => (res.length < top ? -Infinity : res[res.length - 1].score);
    const keep = (deck, s) => {
      const key = [...deck].sort((a, b) => a - b).join(",");
      const i = res.findIndex((r) => r.key === key);
      if (i >= 0) { if (res[i].score >= s) return; res.splice(i, 1); }
      res.push({ key, deck: deck.slice(), score: s }); res.sort((a, b) => b.score - a.score); if (res.length > top) res.length = top;
    };
    // ---- ① 速い探し方で基準を作る(出発点は無作為。o.seeds があれば、それも出発点にする) ----
    let seed = 987654321; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    function improve(d0) {
      let d = d0.slice(), bs = score(d);
      for (let it = 0; it < 30; it++) {
        let moved = false;
        for (let k = 0; k < 5; k++) {
          let room = cap, legR = 0; for (let j = 0; j < 5; j++) if (j !== k) { room -= cost[d[j]]; legR += leg[d[j]]; }
          let bc = d[k], bg = -Infinity;
          for (const c of all) {
            if (cost[c] > room || (legR && leg[c]) || (c !== d[k] && d.includes(c))) continue;
            let g = L[c * 5 + k]; for (let j = 0; j < 5; j++) if (j !== k) g += dot(c, k, d[j], j);
            if (g > bg) { bg = g; bc = c; }
          }
          if (bc !== d[k]) { const nd = d.slice(); nd[k] = bc; const s = score(nd); if (s > bs + 1e-12) { d = nd; bs = s; moved = true; } }
        }
        for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) { const nd = d.slice(); [nd[i], nd[j]] = [nd[j], nd[i]]; const s = score(nd); if (s > bs + 1e-12) { d = nd; bs = s; moved = true; } }
        if (!moved) break;
      }
      return [d, bs];
    }
    const valid = (d) => d.length === 5 && new Set(d).size === 5 && d.every((c) => ok[c]) && d.reduce((a, c) => a + cost[c], 0) <= cap && d.reduce((a, c) => a + leg[c], 0) <= 1;
    for (const d of o.seeds || []) if (valid(d)) { const [d2, s2] = improve(d); keep(d2, s2); }
    for (let n = 0; n < (o.starts ?? 24); n++) {
      const d = []; let cs = 0, lg = 0;
      for (let k = 0; k < 5; k++) { const cand = all.filter((c) => !d.includes(c) && cost[c] <= cap - cs - (4 - k) * minC && !(lg && leg[c])); if (!cand.length) break; const c = cand[Math.floor(rnd() * cand.length)]; d.push(c); cs += cost[c]; lg += leg[c]; }
      if (d.length === 5) { const [d2, s2] = improve(d); keep(d2, s2); }
    }
    // ---- ② 枠ごとの候補を絞る ----
    let cand = [0, 1, 2, 3, 4].map(() => all.slice());
    let MX = null;   // MX[i][j][c] = max_{c' ∈ cand[j], c' ≠ c} (組の値)
    const sufDP = (slots, h) => {   // slots の枠を、h(c, u) の和がコスト x 以内で最大になるように埋めた値 D[x](同じキャラ・伝は無視 = 上限)
      let D = new Float64Array(cap + 1).fill(0);
      for (const u of slots) {
        const best = new Map(); for (const c of cand[u]) { const v = h(c, u), k = cost[c]; if (!(best.get(k) >= v)) best.set(k, v); }
        const ks = [...best];
        const ND = new Float64Array(cap + 1).fill(-Infinity);
        for (let x = 0; x <= cap; x++) { let m = -Infinity; for (const [k, v] of ks) if (k <= x && D[x - k] > -Infinity) { const t = v + D[x - k]; if (t > m) m = t; } ND[x] = m; }
        D = ND;
      }
      return D;
    };
    const buildMX = () => [0, 1, 2, 3, 4].map((i) => [0, 1, 2, 3, 4].map((j) => {
      if (i === j) return null;
      const m = new Float64Array(N).fill(-Infinity);
      for (const c of cand[i]) { let mx = -Infinity; for (const c2 of cand[j]) if (c2 !== c) { const t = dot(c, i, c2, j); if (t > mx) mx = t; } m[c] = mx; }
      return m;
    }));
    const hOf = (rest) => (c, u) => { let v = L[c * 5 + u]; for (const w of rest) if (w !== u) v += 0.5 * MX[u][w][c]; return v; };
    for (let round = 0; round < 8; round++) {
      MX = buildMX();
      let removed = 0; const z = thr();
      const nc = [0, 1, 2, 3, 4].map((s) => {
        const rest = [0, 1, 2, 3, 4].filter((u) => u !== s), D = sufDP(rest, hOf(rest));
        return cand[s].filter((c) => {
          let b = L[c * 5 + s] + D[cap - cost[c]]; for (const u of rest) b += MX[s][u][c];
          if (b > z) return true; removed++; return false;
        });
      });
      cand = nc;
      if (!removed || cand.some((x) => !x.length)) break;
    }
    if (cand.some((x) => !x.length)) { res.nodes = 0; res.cands = cand.map((x) => x.length); return res; }
    MX = buildMX();
    // ---- ③ 残った候補で全組み合わせ(上限が基準に届かない枝は捨てる) ----
    const SUF = []; for (let s = 0; s <= 5; s++) { const rest = [0, 1, 2, 3, 4].filter((u) => u >= s); SUF.push(sufDP(rest, hOf(rest))); }
    const deck = [], used = new Uint8Array(N); let nodes = 0;
    function dfs(s, partial, cross, costUsed, legUsed) {
      if (s === 5) { keep(deck, partial); return; }
      const room = cap - costUsed - (4 - s) * minC, kids = [], th = thr();
      for (const c of cand[s]) {
        if (used[c] || cost[c] > room || (legUsed && leg[c])) continue;
        let p = partial + L[c * 5 + s]; for (let t = 0; t < s; t++) p += dot(deck[t], t, c, s);
        let b = p + SUF[s + 1][cap - costUsed - cost[c]];
        for (let u = s + 1; u < 5; u++) b += cross[u] + MX[s][u][c];
        if (b > th) kids.push([b, c, p]);
      }
      kids.sort((x, y) => y[0] - x[0]); nodes += kids.length;
      for (const [b, c, p] of kids) {
        if (b <= thr()) break;
        const nc = cross.slice(); for (let u = s + 1; u < 5; u++) nc[u] += MX[s][u][c];
        deck.push(c); used[c] = 1;
        dfs(s + 1, p, nc, costUsed + cost[c], legUsed + leg[c]);
        deck.pop(); used[c] = 0;
      }
    }
    dfs(0, 0, new Float64Array(5), 0, 0);
    res.nodes = nodes; res.cands = cand.map((x) => x.length);
    return res;
  }
  const api = { prepare, solve };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.DeckOpt = api;
})(typeof window !== "undefined" ? window : globalThis);

/* 相性AI(相性表)の画面版: 1人分の「自動生成」で、周りの9デッキに対して相性表の点数が一番高いデッキを図鑑の全キャラから探す。
 *   モデル = window.VEC_MODEL(web/vec_model.json ← python tools/vec_export.py <tag>)。tools/vec_train.py の VecModel と同じ計算(キャラ1体 → u, d, a, b, e, f)
 *   環境 = 周りの9デッキ(敵5・味方4、同じ重み)をキャラごと(枠・リーダーかごと)に集計した平均(tools/env_sim.js の「9デッキ」と同じ)
 *   点数 = vec_table.py と同じ(自分がリーダーになる見込み 1/5、味方 Bl+3Bn / 4Bn、敵 Fl+4Fn)。探し方 = 全組み合わせの中から最大(tools/deck_opt.js、vec_search.py と同じ)
 */
window.CompatAI = (() => {
  const M = window.VEC_MODEL; if (!M) return null;
  const ATTRS = ["火", "水", "風"], TYPES = M.types, SCALE = M.scale, K = M.k, H = M.h, NO = 1 + 5 * K, WL = [0.8, 0.2];
  const OFFS = [0, 12, 16, 20, 24, 32, 40, 45];
  const Wi = Float32Array.from(M.W["inp.weight"]), bi = Float32Array.from(M.W["inp.bias"]);
  const W1 = Float32Array.from(M.W["mlp.1.weight"]), b1 = Float32Array.from(M.W["mlp.1.bias"]), W3 = Float32Array.from(M.W["mlp.3.weight"]), b3 = Float32Array.from(M.W["mlp.3.bias"]);
  const W5 = Float32Array.from(M.W["mlp.5.weight"]), b5 = Float32Array.from(M.W["mlp.5.bias"]);
  const pyRound = (x) => { const f = Math.floor(x), d = x - f; return d < 0.5 ? f : d > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1; };
  const erf = (x) => { const s = x < 0 ? -1 : 1; x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); };
  const gelu = (x) => 0.5 * x * (1 + erf(x / Math.SQRT2));
  /** 1体の13個の数(tools/vchar.js の encode と同じ。HP・攻撃はエンジンが使う値) */
  function encode(c) {
    const mask = (a) => (a || []).reduce((m, x) => m | (1 << ATTRS.indexOf(x)), 0);
    const e = c.skill ? c.skill.effects[0] : null;
    const key = !e ? "none" : e.type === "cover" && e.to_leader ? "cover_leader" : e.type;
    const amt = !e ? 0 : e.bonus != null ? e.bonus * 100 : e.cut != null ? e.cut * 100 : e.rate != null ? e.rate * 100 : e.hp_rate != null ? e.hp_rate * 100 : e.hits ?? e.amount ?? 0;
    const sc = !e ? 0 : e.scope === "self" ? 0 : e.scope === "leader" ? 3 : e.attr ? 2 : 1;
    return [c.cost, mask(c.attrs), c.hp, c.power, c.skill ? c.skill.turn : 0, TYPES.indexOf(key), sc, e && e.attr ? ATTRS.indexOf(e.attr) + 1 : 0,
      e && e.vs_attr ? ATTRS.indexOf(e.vs_attr) + 1 : 0, Math.round(amt * 100) / 100, e ? e.turns ?? 1 : 0, e && e.to ? mask(e.to) : 0, e && e.to_leader ? 1 : 0].map((x) => Math.max(-32768, Math.min(32767, Math.round(x))));
  }
  /** 図鑑のキャラ(+補正) → エンジンが使う HP・攻撃(完凸。完凸値が無ければ ×1.6。補正は ×1.5) */
  function featOf(r, theme) {
    const lb = r.lhp != null && r.lpw != null; let hp = lb ? r.lhp : pyRound(r.hp * 1.6), pw = lb ? r.lpw : pyRound(r.pw * 1.6);
    if (theme) { hp = pyRound(hp * 1.5); pw = pyRound(pw * 1.5); }
    return encode({ cost: r.cost, attrs: r.attrs, hp, power: pw, skill: r.sk || null });
  }
  /** VecModel.chars: 13個 + 枠 + リーダーか → [u, d(K), a(K), b(K), e(K), f(K)] */
  function forward(x, slot, lead) {
    /* 学習した範囲の外を端で止める(tools/compat_model.py の clip と同じ。2026-11-21。clip が無い vec_model.json は版1) */
    const CL = M.clip || { cmax: 12, cnever: 40, amax: [32767, 5000, 60, 32767, 100, 300, 200, 32767, 10, 10, 100, 100], tmax: [32767, 15, 15, 8, 15, 15, 2, 15, 5, 5, 15, 15] };
    if (x[4] > CL.cnever) { x = x.slice(); for (let j = 4; j < 12; j++) x[j] = 0; }
    const typ = x[5], amt = Math.min(x[9], CL.amax[typ]), cnt = Math.min(x[4], CL.cmax), trn = Math.min(x[10], CL.tmax[typ]);
    const v2 = M.fv === 2;   // 入力の版(tools/compat_model.py の FV。版2 = 効果量は log、6個目は 攻撃×(1+攻撃UP) の log)
    const num = [x[0] / 100, x[2] / 1e4, x[3] / 1e4, cnt / 12, v2 ? Math.log1p(amt / SCALE[typ]) : amt / SCALE[typ], v2 ? Math.log1p(x[3] * (1 + (typ === 1 ? amt : 0) / 100)) / 12 : Math.log1p(amt) / 8, trn / 10, (x[3] / (x[0] + 1)) / 300, (x[2] / (x[0] + 1)) / 300];
    const hot = [typ, x[6], x[7], x[8], x[1], x[11], slot, lead].map((v, i) => OFFS[i] + v);
    const h0 = new Float64Array(H);
    for (let i = 0; i < H; i++) { let s = bi[i]; const o = i * 56; for (let j = 0; j < 9; j++) s += Wi[o + j] * num[j]; for (const q of hot) s += Wi[o + 9 + q]; h0[i] = gelu(s); }
    const lin = (W, b, x0, n, act) => { const y = new Float64Array(n), m = x0.length; for (let i = 0; i < n; i++) { let s = b[i]; const o = i * m; for (let j = 0; j < m; j++) s += W[o + j] * x0[j]; y[i] = act ? gelu(s) : s; } return y; };
    return lin(W5, b5, lin(W3, b3, lin(W1, b1, h0, H, true), H, true), NO, false);
  }
  const cache = new Map();
  /** キャラ(id・補正)の、枠5 × リーダーか2 のベクトル */
  function vecs(r, theme) {
    const k = `${r.id}|${theme ? 1 : 0}`; let v = cache.get(k); if (v) return v;
    const x = featOf(r, theme); v = []; for (let s = 0; s < 5; s++) v.push([forward(x, s, 0), forward(x, s, 1)]);
    cache.set(k, v); return v;
  }
  const add = (acc, v, off, w) => { for (let j = 0; j < K; j++) acc[j] += w * v[off + j]; };
  /** 周りのデッキ([[{r, theme}]×5]…)→ 環境(キャラごとに集計した平均)→ 味方・敵の見込み */
  function envOf(decks) {
    const Bn = new Float64Array(K), Bl = new Float64Array(K), Fn = new Float64Array(K), Fl = new Float64Array(K), w = 1 / decks.length;
    for (const d of decks) d.forEach((c, s) => { const v = vecs(c.r, c.theme)[s]; add(Bn, v[0], 1 + 2 * K, w); add(Bl, v[1], 1 + 2 * K, w); add(Fn, v[0], 1 + 4 * K, w); add(Fl, v[1], 1 + 4 * K, w); });
    return { ALLY: [Bl.map((x, j) => x + 3 * Bn[j]), Bn.map((x) => 4 * x)], ENEMY: Fl.map((x, j) => x + 4 * Fn[j]) };
  }
  /** 一番点数の高いデッキを、図鑑の全キャラの全組み合わせの中から確実に見つける(window.DeckOpt = tools/deck_opt.js。総当たりと同じ答え)。
   *  roster = 図鑑、cap = コスト上限、allow = 縛りの属性(null = 全)、others = 周りのデッキ、start = 今のデッキ(あれば点数を比べる) */
  let prep = null;   // 図鑑の全キャラのベクトルとデッキ内の組の値の表(図鑑が変わらない限り1回)
  function best(roster, cap, allow, others, start, top) {   // top = 上位いくつを返すか(list。全体を読む形の候補用。2026-11-21)
    if (!prep || prep.roster !== roster) {
      const C = roster.filter((r) => r.cost > 0), N = C.length, K2 = 2 * K, V = C.map((r) => vecs(r, false)), E = new Float64Array(N * 5 * K2);
      for (let c = 0; c < N; c++) for (let s = 0; s < 5; s++) for (let l = 0; l < 2; l++) for (let q = 0; q < K; q++) E[(c * 5 + s) * K2 + l * K + q] = Math.sqrt(WL[l]) * V[c][s][l][1 + q];
      prep = { roster, C, N, V, P: window.DeckOpt.prepare(N, K2, E), cost: Int32Array.from(C, (r) => r.cost), leg: Uint8Array.from(C, (r) => (r.r === "伝" ? 1 : 0)), at: new Map(C.map((r, i) => [r.id, i])) };
    }
    const { C, N, V, P, cost, leg, at } = prep, env = envOf(others), L = new Float64Array(N * 5);
    for (let c = 0; c < N; c++) for (let s = 0; s < 5; s++) { let t = 0; for (let l = 0; l < 2; l++) { const v = V[c][s][l]; let x = v[0]; for (let j = 0; j < K; j++) x += v[1 + K + j] * env.ALLY[l][j] + v[1 + 3 * K + j] * env.ENEMY[j]; t += WL[l] * x; } L[c * 5 + s] = t; }
    const ok = Uint8Array.from(C, (r) => (!allow || r.attrs.some((a) => allow.includes(a)) ? 1 : 0));
    const sd = start && start.length === 5 && start.every((id) => at.has(id)) ? start.map((id) => at.get(id)) : null;
    const r = window.DeckOpt.solve({ P, L, cost, leg, ok, cap, top: top || 1, seeds: sd ? [sd] : [] });
    /* デッキ(キャラ番号×5)の点数(この環境で。DeckOpt の点数と同じ式) */
    const val = (d) => { let t = 0; for (let i = 0; i < 5; i++) { t += L[d[i] * 5 + i]; for (let j = i + 1; j < 5; j++) for (let l = 0; l < 2; l++) { const a = V[d[i]][i][l], b = V[d[j]][j][l]; let u = 0; for (let q = 1; q <= K; q++) u += a[q] * b[q]; t += WL[l] * u; } } return t; };
    const cur = sd ? val(sd) : null;
    const quick = (ids) => val(ids.map((id) => at.get(id)));   // id×5 → 点数(全体を読む形の下見用)
    return r.length ? { ids: r[0].deck.map((c) => C[c].id), score: r[0].score, current: cur, list: r.map((x) => ({ ids: x.deck.map((c) => C[c].id), score: x.score })), quick, ok: C.filter((_, i) => ok[i] && cost[i] <= cap) } : null;
  }
  return { best, vecs, featOf, tag: M.tag };
})();

/* 相性AIの「全体を読む形」(tools/compat_model.py の SetModel。線 s1 など)の画面版(2026-11-21)
 *   重み = window.SET_MODEL(web/set_model.json ← python tools/set_export.py <tag>)。一致の確認 = node tools/set_check.js
 *   場面 = 10人 × 5体 = 50体(人 0〜4 = 自分のチーム・0 がリーダー、5〜9 = 敵)。点数 = その人の予想ランク点
 *   CompatSet.scorer(fixed, me): fixed = 10人分の [13個の数 ×5](me の所は null)→ deck(13個の数 ×5)を入れた点数を返す関数(他の人の分は先に計算して使い回す)
 *   CompatSet.search(o): 1人分のデッキ探し(時間まで。tools の deck_finder/server.py の search と同じ考え: 候補を採点 → 一番の物から1体入れ替え・並べ替えを下見して上位を採点、を繰り返す)
 */
(function (root) {
  "use strict";
  const OFF = [0, 12, 16, 20, 24, 32, 40, 45];
  function make(M) {
    const dec = (b64) => {
      let bytes;
      if (typeof Buffer !== "undefined") bytes = Buffer.from(b64, "base64");
      else { const s = atob(b64); bytes = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i); }
      return Float64Array.from(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4));
    };
    const W = {}; for (const k of Object.keys(M.W)) W[k] = dec(M.W[k][1]);
    const D = M.d, H = M.H, G = M.g, DH = D / H, FF = M.ff * D, NB = M.depth, SC = M.scale, CL = M.clip, V2 = M.fv === 2, SQ = 1 / Math.sqrt(DH);
    const erf = (x) => { const s = x < 0 ? -1 : 1; x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); };
    const gelu = (x) => 0.5 * x * (1 + erf(x / Math.SQRT2));
    const blk = []; for (let i = 0; i < NB; i++) { const p = `blocks.${i}.`; blk.push({ n1w: W[p + "n1.weight"], n1b: W[p + "n1.bias"], qw: W[p + "qkv.weight"], qb: W[p + "qkv.bias"], ow: W[p + "o.weight"], ob: W[p + "o.bias"], n2w: W[p + "n2.weight"], n2b: W[p + "n2.bias"], f0w: W[p + "ff.0.weight"], f0b: W[p + "ff.0.bias"], f2w: W[p + "ff.2.weight"], f2b: W[p + "ff.2.bias"] }); }
    const per = (t) => (t / 5) | 0, rel = (i, j) => (per(i) === per(j) ? 0 : ((i / 25) | 0) === ((j / 25) | 0) ? 1 : 2);
    const REL = new Uint8Array(2500); for (let i = 0; i < 50; i++) for (let j = 0; j < 50; j++) REL[i * 50 + j] = rel(i, j);
    /** 1体(13個の数)・場所 t → 入れ物の最初の値(長さ D)。compat_model.tokens(clip)+ inp と同じ */
    function embed(x, t, out, o) {
      x = x.slice();
      if (x[4] > CL.cnever) for (let j = 4; j < 12; j++) x[j] = 0;
      const typ = x[5]; x[4] = Math.min(x[4], CL.cmax); x[9] = Math.min(x[9], CL.amax[typ]); x[10] = Math.min(x[10], CL.tmax[typ]);
      const amt = x[9];
      const num = [x[0] / 100, x[2] / 1e4, x[3] / 1e4, x[4] / 12, V2 ? Math.log1p(amt / SC[typ]) : amt / SC[typ], V2 ? Math.log1p(x[3] * (1 + (typ === 1 ? amt : 0) / 100)) / 12 : Math.log1p(amt) / 8,
        x[10] / 10, (x[3] / (x[0] + 1)) / 300, (x[2] / (x[0] + 1)) / 300];
      const hot = [typ, x[6], x[7], x[8], x[1], x[11], t % 5, (per(t) % 5) === 0 ? 1 : 0].map((v, i) => OFF[i] + v);
      const w = W["inp.weight"], b = W["inp.bias"];
      for (let i = 0; i < D; i++) { let s = b[i]; const r = i * 56; for (let j = 0; j < 9; j++) s += w[r + j] * num[j]; for (const q of hot) s += w[r + 9 + q]; out[o + i] = s; }
    }
    function ln(x, o, w, b, out, oo) {
      let m = 0; for (let i = 0; i < D; i++) m += x[o + i]; m /= D;
      let v = 0; for (let i = 0; i < D; i++) { const d = x[o + i] - m; v += d * d; } v = 1 / Math.sqrt(v / D + 1e-5);
      for (let i = 0; i < D; i++) out[oo + i] = (x[o + i] - m) * v * w[i] + b[i];
    }
    function lin(W0, B0, x, o, n, m, out, oo) { for (let i = 0; i < n; i++) { let s = B0[i]; const r = i * m; for (let j = 0; j < m; j++) s += W0[r + j] * x[o + j]; out[oo + i] = s; } }
    const tmp = new Float64Array(FF), hn = new Float64Array(D), att = new Float64Array(D), sc = new Float64Array(50);
    /** 1つの層(rows = 出力が要る場所。qkv0 = 先に計算した qkv(fixed の場所)) */
    function block(B, x, qkv, rows, need) {
      for (const t of need) { ln(x, t * D, B.n1w, B.n1b, hn, 0); lin(B.qw, B.qb, hn, 0, 3 * D, D, qkv, t * 3 * D); }
      const nx = new Float64Array(rows.length * D);
      rows.forEach((i, ri) => {
        for (let h = 0; h < H; h++) {
          const r = (h / G) | 0, qo = i * 3 * D + h * DH; let mx = -Infinity;
          for (let j = 0; j < 50; j++) { if (REL[i * 50 + j] !== r) { sc[j] = -Infinity; continue; } const ko = j * 3 * D + D + h * DH; let s = 0; for (let q = 0; q < DH; q++) s += qkv[qo + q] * qkv[ko + q]; s *= SQ; sc[j] = s; if (s > mx) mx = s; }
          let z = 0; for (let j = 0; j < 50; j++) { if (sc[j] === -Infinity) { sc[j] = 0; continue; } sc[j] = Math.exp(sc[j] - mx); z += sc[j]; }
          for (let q = 0; q < DH; q++) { let s = 0; for (let j = 0; j < 50; j++) if (sc[j]) s += sc[j] * qkv[j * 3 * D + 2 * D + h * DH + q]; att[h * DH + q] = s / z; }
        }
        const o = ri * D; lin(B.ow, B.ob, att, 0, D, D, nx, o); for (let k = 0; k < D; k++) nx[o + k] += x[i * D + k];
        ln(nx, o, B.n2w, B.n2b, hn, 0); lin(B.f0w, B.f0b, hn, 0, FF, D, tmp, 0); for (let k = 0; k < FF; k++) tmp[k] = gelu(tmp[k]);
        const f = new Float64Array(D); lin(B.f2w, B.f2b, tmp, 0, D, FF, f, 0); for (let k = 0; k < D; k++) nx[o + k] += f[k];
      });
      return nx;
    }
    const ALL = [...Array(50).keys()];
    /** fixed: 10人分([13個×5] か null)、me: 自分の人の番号 → (deck) => 点数。全員そろっていれば deck 無しで 10人の点数も出せる(確認用) */
    function scorer(fixed, me) {
      const x0 = new Float64Array(50 * D), q0 = new Float64Array(50 * 3 * D), mine = [0, 1, 2, 3, 4].map((k) => me * 5 + k);
      for (let p = 0; p < 10; p++) if (p !== me || fixed[p]) for (let k = 0; k < 5; k++) embed(fixed[p][k], p * 5 + k, x0, (p * 5 + k) * D);
      for (let t = 0; t < 50; t++) if (per(t) !== me) { ln(x0, t * D, blk[0].n1w, blk[0].n1b, hn, 0); lin(blk[0].qw, blk[0].qb, hn, 0, 3 * D, D, q0, t * 3 * D); }
      const run = (deck, outPl) => {
        let x = Float64Array.from(x0); const qkv = Float64Array.from(q0);
        if (deck) for (let k = 0; k < 5; k++) embed(deck[k], me * 5 + k, x, (me * 5 + k) * D);
        for (let bi = 0; bi < NB; bi++) {
          const last = bi === NB - 1, rows = last && outPl == null ? mine : ALL;
          const q = bi === 0 ? qkv : new Float64Array(50 * 3 * D);
          const nx = block(blk[bi], x, q, rows, bi === 0 ? mine : ALL);
          if (rows === ALL) x = nx; else { x = new Float64Array(50 * D); rows.forEach((t, ri) => x.set(nx.subarray(ri * D, ri * D + D), t * D)); }
        }
        const pl = outPl == null ? [me] : outPl, res = [];
        for (const p of pl) {
          const m = new Float64Array(D);
          for (let k = 0; k < 5; k++) { ln(x, (p * 5 + k) * D, W["nf.weight"], W["nf.bias"], hn, 0); for (let i = 0; i < D; i++) m[i] += hn[i] / 5; }
          const h1 = new Float64Array(D); lin(W["head.0.weight"], W["head.0.bias"], m, 0, D, D, h1, 0); for (let i = 0; i < D; i++) h1[i] = gelu(h1[i]);
          let s = W["head.2.bias"][0]; for (let i = 0; i < D; i++) s += W["head.2.weight"][i] * h1[i]; res.push(s);
        }
        return outPl == null ? res[0] : res;
      };
      const f = (deck) => run(deck, null); f.all = () => run(null, [...Array(10).keys()]); return f;
    }
    /** 1人分のデッキ探し(非同期。ms まで)。o = {
     *    layouts: [{w, fixed, me}](重みの合計 1)、cands: [{id, x(13個), cost, leg}](使えるキャラ)、cap(コスト上限)、init: [[id×5]...](最初に採点する候補)、
     *    quick(ids) → 下見の点数(速い物。今の線の点数)、ms、progress(msg)(途中の表示) }
     *  → {ids, score, n}(全体を読む形の点数が一番のデッキ)。init が全部採点できないうちに時間が来ても、採点できた中の一番を返す */
    async function search(o) {
      const t0 = Date.now(), tEnd = t0 + o.ms, C = new Map(o.cands.map((c) => [c.id, c])), ids = o.cands.map((c) => c.id);
      const sco = o.layouts.map((L) => ({ w: L.w, f: scorer(L.fixed, L.me) }));
      const full = new Map(), key = (d) => d.join(",");
      const evalD = (d) => { const k = key(d); if (full.has(k)) return full.get(k).s; const X = d.map((i) => C.get(i).x); let s = 0; for (const L of sco) s += L.w * L.f(X); full.set(k, { d: d.slice(), s }); return s; };
      const pause = () => new Promise((r) => setTimeout(r, 0));
      let lastP = 0; const prog = (m) => { if (o.progress && Date.now() - lastP > 400) { lastP = Date.now(); o.progress(m); } };
      for (const d of o.init) { if (d.length !== 5 || !d.every((i) => C.has(i))) continue; evalD(d); if (Date.now() > tEnd) break; if (full.size % 5 === 0) { prog(`全体を読む形で候補を採点 ${full.size}/${o.init.length}`); await pause(); } }
      const done = new Set(); let nExp = 0;
      while (Date.now() < tEnd) {
        const best = [...full.values()].sort((a, b) => b.s - a.s).find((v) => !done.has(key(v.d)));
        if (!best) break;
        const d0 = best.d; done.add(key(d0)); nExp++;
        const cs = d0.reduce((a, i) => a + C.get(i).cost, 0), lg = d0.reduce((a, i) => a + C.get(i).leg, 0), nb = [];
        for (let k = 0; k < 5; k++) for (const c of ids) {
          if (d0.includes(c) || cs - C.get(d0[k]).cost + C.get(c).cost > o.cap || lg - C.get(d0[k]).leg + C.get(c).leg > 1) continue;
          const nd = d0.slice(); nd[k] = c; if (!full.has(key(nd))) nb.push(nd);
        }
        for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) { const nd = d0.slice(); [nd[i], nd[j]] = [nd[j], nd[i]]; if (!full.has(key(nd))) nb.push(nd); }
        const top = nb.map((d) => [o.quick(d), d]).sort((a, b) => b[0] - a[0]).slice(0, o.topN || 40);
        for (const [, d] of top) { evalD(d); if (Date.now() > tEnd) break; if (full.size % 5 === 0) { prog(`全体を読む形で入れ替えを探しています(${nExp}個目・採点 ${full.size} 個・1位 ${Math.max(...[...full.values()].map((v) => v.s)).toFixed(3)})`); await pause(); } }
        await pause();
      }
      const r = [...full.values()].sort((a, b) => b.s - a.s)[0];
      return r ? { ids: r.d, score: r.s, n: full.size, nExp, sec: (Date.now() - t0) / 1000, evalD } : null;
    }
    return { scorer, search, tag: M.tag };
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { make };
  else root.CompatSet = root.SET_MODEL ? make(root.SET_MODEL) : null;
})(typeof window !== "undefined" ? window : this);
