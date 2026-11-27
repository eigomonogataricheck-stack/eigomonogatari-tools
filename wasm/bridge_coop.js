/* rcoop_wasm 薄い JS 橋 (メインスレッド用 + Node 検証用)
 * 協力ダメージ計算の手動判定・バッチ評価を Rust (WASM) へ橋渡しする。
 */
(function (root) {
  'use strict';

  function charKey(c) {
    return String(c?.id ?? c?.details?.id ?? c?.name ?? '');
  }

  function packEnemy(e) {
    return {
      key: charKey(e?.character),
      hp: Math.max(0, Number(e?.hp) || 0),
      attribute: String(e?.attribute || '火'),
    };
  }

  function packState(opts) {
    return JSON.stringify({
      enemies: (opts.enemies || []).slice(0, 15).map(packEnemy),
      decks: (opts.decks || []).slice(0, 5).map(row =>
        Array.from({ length: 5 }, (_, s) => {
          const c = row?.[s];
          if (!c) return null;
          return typeof c === 'object' ? charKey(c) : String(c);
        })
      ),
      deckPowers: (opts.deckPowers || []).slice(0, 5).map(row =>
        Array.from({ length: 5 }, (_, s) => Math.max(0, Number(row?.[s]) || 0))
      ),
      visibleRows: Math.max(1, Math.min(5, Number(opts.visibleRows) || 1)),
      detailMode: !!opts.detailMode,
      targetDecks: Math.max(1, Math.min(5, Number(opts.targetDecks) || 4)),
      enemySecondFixed: !!opts.enemySecondFixed,
      damageBase: Number(opts.damageBase) || (0.81 * 1.2 * 1.99),
      detailCalcActive: !!opts.detailCalcActive,
    });
  }

  function createBridge(wasmMod) {
    let instance = null;
    let keyToIdx = new Map();
    let idxToKey = [];

    function init(chars) {
      if (instance) {
        try { instance.free(); } catch (_) {}
      }
      const json = typeof chars === 'string' ? chars : JSON.stringify(chars || []);
      instance = new wasmMod.CoopWasm(json);
      idxToKey = JSON.parse(instance.char_keys_json());
      keyToIdx = new Map();
      for (let i = 0; i < idxToKey.length; i++) {
        keyToIdx.set(idxToKey[i], i);
      }
      return instance.char_count();
    }

    function ensureInit() {
      if (!instance) throw new Error('CoopWasm not initialized');
      return instance;
    }

    function setState(opts) {
      ensureInit().set_state(packState(opts));
    }

    function evaluateManual(opts) {
      return JSON.parse(ensureInit().evaluate_manual_json(packState(opts)));
    }

    function buildTimeline(opts, lastSlot) {
      return JSON.parse(ensureInit().build_timeline_json(packState(opts), lastSlot));
    }

    function evalStageBatch(pairs, slot, totalDecks) {
      const inst = ensureInit();
      const n = pairs.length;
      const prefixFlat = new Int32Array(n * 5);
      const candIdx = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        const p = pairs[i];
        const pids = p.prefixIds || [];
        const base = i * 5;
        for (let s = 0; s < 5; s++) {
          const k = pids[s] ? String(pids[s]) : '';
          prefixFlat[base + s] = k && keyToIdx.has(k) ? keyToIdx.get(k) : -1;
        }
        const ck = p.candidateId ? String(p.candidateId) : '';
        candIdx[i] = ck && keyToIdx.has(ck) ? keyToIdx.get(ck) : -1;
      }
      return inst.eval_stage_batch_idx(prefixFlat, candIdx, slot, totalDecks);
    }

    function runBruteforceEndToEnd(opts, totalDecks) {
      return JSON.parse(ensureInit().run_bruteforce_end_to_end_json(packState(opts), totalDecks));
    }

    return {
      init,
      setState,
      evaluateManual,
      buildTimeline,
      evalStageBatch,
      runBruteforceEndToEnd,
      get keyToIdx() { return keyToIdx; },
      get idxToKey() { return idxToKey; },
      get raw() { return instance; },
      wasmMod,
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createBridge, packState, charKey };
  }
  if (root) {
    root.CoopWasmBridge = { createBridge, packState, charKey };
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
