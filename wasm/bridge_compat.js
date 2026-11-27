/* Rust(rcompat_wasm) を battle-compat.js と同じ使い方で見せる薄い橋。
 * - DeckOpt = { prepare, solve }
 * - CompatAI = { best, vecs, featOf, tag }
 * - CompatSet = { scorer, search, tag }
 * - battle-ui.js / char-diag.js を無改造で動かす。
 */
(function (root) {
"use strict";

function createCompatBridge(wasm, models) {
  const vecModel = models && models.vecModel !== undefined ? models.vecModel : root.VEC_MODEL;
  const setModel = models && models.setModel !== undefined ? models.setModel : root.SET_MODEL;

  const vecTag = vecModel ? wasm.init_vec_model(JSON.stringify(vecModel)) : null;
  const setTag = setModel ? wasm.init_set_model(JSON.stringify(setModel)) : null;
  const vecK = vecModel ? vecModel.k : 32;

  const DeckOpt = {
    prepare(N, K2, E) {
      const eArr = E instanceof Float64Array ? E : Float64Array.from(E);
      const handle = wasm.WasmDeckOpt.prepare(N, K2, eArr);
      return { N, _handle: handle };
    },
    solve(o) {
      const P = o.P;
      if (!P || !P._handle) throw new Error("DeckOpt.solve: P must be created by DeckOpt.prepare");
      const l = o.L instanceof Float64Array ? o.L : Float64Array.from(o.L);
      const cost = o.cost instanceof Int32Array ? o.cost : Int32Array.from(o.cost);
      const leg = o.leg instanceof Uint8Array ? o.leg : Uint8Array.from(o.leg);
      const ok = o.ok instanceof Uint8Array ? o.ok : Uint8Array.from(o.ok);
      const seeds = o.seeds || [];
      const seedsFlat = new Uint32Array(seeds.length * 5);
      for (let i = 0; i < seeds.length; i++) {
        for (let k = 0; k < 5; k++) seedsFlat[i * 5 + k] = seeds[i][k];
      }
      const res = JSON.parse(
        P._handle.solve(l, cost, leg, ok, o.cap, o.top || 1, o.starts ?? 24, seedsFlat)
      );
      const out = res.entries;
      out.nodes = res.nodes;
      out.cands = res.cands;
      return out;
    },
  };

  let cachedRoster = null;
  let cachedIdMap = new Map();

  function syncRoster(roster) {
    if (cachedRoster === roster) return;
    cachedRoster = roster;
    cachedIdMap = new Map();
    for (const r of roster) cachedIdMap.set(r.id, r);
    wasm.set_roster(JSON.stringify(roster));
  }

  function allowMaskOf(allow) {
    if (!allow) return 0;
    let m = 0;
    for (const a of allow) {
      if (a === "火") m |= 1;
      else if (a === "水") m |= 2;
      else if (a === "風") m |= 4;
    }
    return m;
  }

  const CompatAI = vecModel ? {
    tag: vecTag,
    featOf(r, theme) {
      if (cachedRoster && cachedIdMap.get(r.id) === r) {
        return Array.from(wasm.feat_of_id(r.id, !!theme));
      }
      return Array.from(wasm.feat_of_char(JSON.stringify(r), !!theme));
    },
    vecs(r, theme) {
      const flat = (cachedRoster && cachedIdMap.get(r.id) === r)
        ? wasm.vecs_of_id(r.id, !!theme)
        : wasm.vecs_of_char(JSON.stringify(r), !!theme);
      const stride = 1 + 5 * vecK;
      const out = [];
      let p = 0;
      for (let s = 0; s < 5; s++) {
        const pair = [];
        for (let l = 0; l < 2; l++) {
          pair.push(flat.slice(p, p + stride));
          p += stride;
        }
        out.push(pair);
      }
      return out;
    },
    best(roster, cap, allow, others, start, top) {
      syncRoster(roster);
      const allowMask = allowMaskOf(allow);
      const othersIds = others.map((d) => d.map((c) => [c.r.id, !!c.theme]));
      const res = JSON.parse(
        wasm.compat_best(
          cap,
          allowMask,
          JSON.stringify(othersIds),
          JSON.stringify(start || null),
          top || 1
        )
      );
      if (!res) return null;
      const qid = res.quick_id;
      const quick = (ids) => wasm.quick_score(qid, Int32Array.from(ids));
      quick._compatQuickId = qid;
      const ok = res.ok_ids.map((id) => cachedIdMap.get(id));
      return {
        ids: res.ids,
        score: res.score,
        current: res.current,
        list: res.list,
        quick,
        ok,
      };
    },
  } : null;

  const CompatSet = setModel ? {
    tag: setTag,
    scorer(fixed, me) {
      const fixedFlat = new Int32Array(650);
      let mask = 0;
      for (let p = 0; p < 10; p++) {
        if (fixed[p]) {
          mask |= (1 << p);
          for (let k = 0; k < 5; k++) {
            const x = fixed[p][k];
            const off = (p * 5 + k) * 13;
            for (let j = 0; j < 13; j++) fixedFlat[off + j] = x[j];
          }
        }
      }
      const handle = new wasm.WasmSetScorer(fixedFlat, mask, me);
      const deckFlat = new Int32Array(65);
      const f = (deck) => {
        for (let k = 0; k < 5; k++) {
          const x = deck[k];
          const off = k * 13;
          for (let j = 0; j < 13; j++) deckFlat[off + j] = x[j];
        }
        return handle.eval_deck(deckFlat);
      };
      f.all = () => Array.from(handle.eval_all());
      return f;
    },
    async search(o) {
      const t0 = Date.now();
      const det = o._deterministic || null;
      const tEnd = det ? Infinity : t0 + o.ms;
      const topN = o.topN || 40;
      const session = new wasm.WasmSetSearch(
        JSON.stringify(o.layouts),
        JSON.stringify(o.cands),
        o.cap,
        JSON.stringify(o.init),
        topN
      );
      const pause = () => new Promise((r) => setTimeout(r, 0));
      let lastP = 0;
      const prog = (m) => {
        if (o.progress && Date.now() - lastP > 400) {
          lastP = Date.now();
          o.progress(m);
        }
      };

      const initTotal = o.init.length;
      while (true) {
        const done = session.eval_init_step(5);
        const st = JSON.parse(session.status_json());
        if (!det && Date.now() > tEnd) break;
        if (done) break;
        prog(`全体を読む形で候補を採点 ${st.n}/${initTotal}`);
        if (!det) await pause();
      }

      const maxExp = det && det.maxExp != null ? det.maxExp : Infinity;
      let expCount = 0;
      while ((det || Date.now() < tEnd) && expCount < maxExp) {
        let hasMore = false;
        if (o.quick && o.quick._compatQuickId != null) {
          hasMore = session.prepare_expand_with_quick(o.quick._compatQuickId);
        } else {
          const flat = session.prepare_expand_raw();
          if (flat.length > 0 && flat[0] === 1) {
            hasMore = true;
            const nb = [];
            for (let i = 1; i < flat.length; i += 5) {
              const d = [flat[i], flat[i + 1], flat[i + 2], flat[i + 3], flat[i + 4]];
              nb.push([o.quick(d), d]);
            }
            nb.sort((a, b) => b[0] - a[0]);
            const top = nb.slice(0, topN);
            const topFlat = new Int32Array(top.length * 5);
            for (let i = 0; i < top.length; i++) {
              for (let k = 0; k < 5; k++) topFlat[i * 5 + k] = top[i][1][k];
            }
            session.set_pending(topFlat);
          }
        }
        if (!hasMore) break;
        expCount++;

        while (true) {
          const done = session.eval_pending_step(5);
          if (!det && Date.now() > tEnd) break;
          if (done) break;
          const st = JSON.parse(session.status_json());
          prog(`全体を読む形で入れ替えを探しています(${st.nExp}個目・採点 ${st.n} 個・1位 ${st.maxScore.toFixed(3)})`);
          if (!det) await pause();
        }
        if (!det) await pause();
      }

      const fin = JSON.parse(session.status_json());
      if (!fin.best) return null;
      return {
        ids: fin.best.ids,
        score: fin.best.score,
        n: fin.n,
        nExp: fin.nExp,
        sec: (Date.now() - t0) / 1000,
        evalD: (d) => session.eval_deck(Int32Array.from(d)),
      };
    },
  } : null;

  return { DeckOpt, CompatAI, CompatSet };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createCompatBridge };
} else {
  root.createCompatBridge = createCompatBridge;
}
})(typeof window !== "undefined" ? window : globalThis);
