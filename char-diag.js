/* 英語物語 非公式ツール: キャラ診断 (現行 k17 相性AIによる既存・未実装キャラ単一スコア診断)
 *   依存: battle-roster.js (zukanToRoster), battle-models.js (SET_MODEL=k17), battle-compat.js (CompatSet), char-diag-data.js (CHAR_DIAG_BASE)
 *   Python版 (本体/tools/char_diag_k17.py) と完全同一の特徴量エンコード・シェル採点・偏差値換算ロジック
 */
(function (root) {
  "use strict";

  const ATTRS3 = ["火", "水", "風"];
  const TYPES = ["none", "atk_up", "multi_attack", "all_attack", "shield", "heal", "revive", "color_change", "shorten", "delay", "cover", "cover_leader"];
  const BANDS = [["低", 150], ["中", 220], ["高", 350], ["超高", 500]];

  /* Python の round() (最近接偶数丸め) と完全一致 */
  function pyRound(x) {
    const f = Math.floor(x), d = x - f;
    return d < 0.5 ? f : d > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1;
  }

  function parseAttrs(val) {
    if (!val) return ["火"];
    if (Array.isArray(val)) {
      const out = val.filter((a) => ATTRS3.includes(a));
      return out.length ? out : ["火"];
    }
    const s = String(val).trim();
    if (s === "全" || s === "火水風") return ATTRS3.slice();
    const out = ATTRS3.filter((ch) => s.includes(ch));
    return out.length ? out : ["火"];
  }

  function attrSelectValue(attrs) {
    const a = parseAttrs(attrs);
    if (a.length >= 3) return "全";
    if (a.length === 2) {
      if (a.includes("火") && a.includes("水")) return "火水";
      if (a.includes("水") && a.includes("風")) return "水風";
      return "風火";
    }
    return a[0] || "火";
  }

  function buildSkillDict(skType, turn, scope, targetAttr, vsAttr, amount, turns, toAttrs) {
    if (!skType || skType === "none") return null;
    if (!TYPES.includes(skType)) return null;
    const eff = { type: skType === "cover_leader" ? "cover" : skType };
    if (skType === "cover") {
      eff.scope = "self";
    } else if (skType === "cover_leader") {
      eff.scope = "leader";
      eff.to_leader = true;
    } else if (skType === "delay") {
      eff.scope = "team";
      if (ATTRS3.includes(targetAttr)) eff.attr = targetAttr;
    } else {
      if (scope === "team_attr" || (scope === "team" && ATTRS3.includes(targetAttr))) {
        eff.scope = "team";
        if (ATTRS3.includes(targetAttr)) eff.attr = targetAttr;
      } else if (scope === "self" || scope === "team" || scope === "leader") {
        eff.scope = scope;
      } else {
        eff.scope = "team";
      }
    }
    if (ATTRS3.includes(vsAttr) && ["atk_up", "shield", "cover", "cover_leader"].includes(skType)) {
      eff.vs_attr = vsAttr;
    }
    const amtNum = Number(amount) || 0;
    if (skType === "atk_up") eff.bonus = amtNum / 100;
    else if (skType === "multi_attack") eff.hits = Math.round(amtNum);
    else if (skType === "shield" || skType === "cover" || skType === "cover_leader") eff.cut = amtNum / 100;
    else if (skType === "heal") eff.rate = amtNum / 100;
    else if (skType === "revive") eff.hp_rate = amtNum / 100;
    else if (skType === "shorten" || skType === "delay") eff.amount = Math.round(amtNum);
    else if (skType === "color_change") eff.to = parseAttrs(toAttrs || targetAttr || "火");

    const tInt = Math.max(1, Math.round(Number(turns) || 1));
    if (tInt >= 2 || !["revive", "shorten", "delay"].includes(skType)) {
      eff.turns = tInt;
    }
    return { name: "", turn: Math.max(0, Math.round(Number(turn) || 0)), effects: [eff] };
  }

  function encodeChar(cost, attrs, hp, power, skill) {
    let mask = 0;
    for (const a of attrs || []) {
      const idx = ATTRS3.indexOf(a);
      if (idx >= 0) mask |= (1 << idx);
    }
    const e = skill && skill.effects && skill.effects[0] ? skill.effects[0] : null;
    let key = !e ? "none" : (e.type === "cover" && e.to_leader ? "cover_leader" : (e.type || "none"));
    if (!TYPES.includes(key)) key = "none";
    let amt = 0;
    if (e) {
      if (e.bonus != null) amt = e.bonus * 100;
      else if (e.cut != null) amt = e.cut * 100;
      else if (e.rate != null) amt = e.rate * 100;
      else if (e.hp_rate != null) amt = e.hp_rate * 100;
      else amt = e.hits != null ? e.hits : (e.amount || 0);
    }
    const sc = !e ? 0 : (e.scope === "self" ? 0 : (e.scope === "leader" ? 3 : (e.attr ? 2 : 1)));
    const attrI = e && ATTRS3.includes(e.attr) ? ATTRS3.indexOf(e.attr) + 1 : 0;
    const vsI = e && ATTRS3.includes(e.vs_attr) ? ATTRS3.indexOf(e.vs_attr) + 1 : 0;
    const turns = e ? (e.turns != null ? e.turns : 1) : 0;
    let toMask = 0;
    if (e && e.to) {
      for (const a of e.to) {
        const idx = ATTRS3.indexOf(a);
        if (idx >= 0) toMask |= (1 << idx);
      }
    }
    const toLead = e && e.to_leader ? 1 : 0;
    const turn = skill ? Math.round(Number(skill.turn) || 0) : 0;
    const raw = [cost, mask, hp, power, turn, TYPES.indexOf(key), sc, attrI, vsI, Math.round(amt * 100) / 100, turns, toMask, toLead];
    return raw.map((v) => Math.max(-32768, Math.min(32767, pyRound(v))));
  }

  function tierOf(score) {
    if (score >= 80.0) return ["SS", "環境支配・最上位クラス（複数帯でトップ編成を更新する水準）", "kill"];
    if (score >= 70.0) return ["S", "環境トップ主力級（実戦の主力として第一線で採用される水準）", "kill"];
    if (score >= 60.0) return ["A", "優秀・環境採用圏（得意コスト帯やシナジー編成で主力になる水準）", "chance"];
    if (score >= 50.0) return ["B", "標準〜準主力級（全キャラ平均以上・縛りやイベント補正で活躍）", "chance"];
    if (score >= 40.0) return ["C", "やや控えめ（資産制限やイベント補正×1.5があれば採用圏）", "safe"];
    return ["D", "対戦では厳しい（コスト過多またはステータス・スキル不足）", "safe"];
  }

  function clipWarnings(feat, setModel) {
    const warns = [];
    const cl = (setModel && setModel.clip) || { cnever: 40, cmax: 40, amax: [32767, 32767, 60, 32767, 100, 300, 200, 32767, 10, 10, 100, 100], tmax: [32767, 15, 15, 8, 15, 15, 2, 15, 5, 5, 15, 15] };
    const cnt = feat[4], typ = feat[5], amt = feat[9], trn = feat[10];
    if (typ > 0 && cnt > cl.cnever) {
      warns.push(`スキル必要ターン(${cnt})が最大ターン(${cl.cnever})を超えているため「スキルなし」として扱われます。`);
    } else if (typ > 0 && cnt > cl.cmax) {
      warns.push(`スキル必要ターン(${cnt})がモデル上限(${cl.cmax})でクリップされます。`);
    }
    if (typ > 0 && amt > cl.amax[typ]) {
      warns.push(`効果量(${amt})が種類別上限(${cl.amax[typ]})でクリップされます。`);
    }
    if (typ > 0 && trn > cl.tmax[typ]) {
      warns.push(`継続ターン(${trn})が種類別上限(${cl.tmax[typ]})でクリップされます。`);
    }
    if (feat[2] > 20000 || feat[3] > 13000) {
      warns.push("HPまたはPowerが架空キャラ学習範囲(HP 19,170 / Power 12,780)を超えており、外挿推論になります。");
    }
    if ((typ === 10 || typ === 11) && amt >= 75 && cnt <= 1) {
      warns.push("1ターン発動の高倍率「かばう／かわす」は、現行 k17 が実戦よりやや高めに評価しやすい傾向があります。");
    }
    return warns;
  }

  /* SetModel (k17) 高速推論器 (Float32Array・アロケーションゼロ・Block0固定45体事前計算・最終層Q5体限定) */
  function makeFastSet(M) {
    const OFF = [0, 12, 16, 20, 24, 32, 40, 45];
    const dec = (b64) => {
      let bytes;
      if (typeof Buffer !== "undefined") bytes = Buffer.from(b64, "base64");
      else {
        const s = atob(b64);
        bytes = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
      }
      return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    };
    const W = {};
    for (const k of Object.keys(M.W)) W[k] = dec(M.W[k][1]);
    const D = M.d, H = M.H, G = M.g, DH = (D / H) | 0, FF = M.ff * D, NB = M.depth;
    const SC = M.scale, CL = M.clip, V2 = M.fv === 2, SQ = 1 / Math.sqrt(DH);
    const gelu = (x) => {
      const s = x < 0 ? -1 : 1, ax = Math.abs(x * 0.7071067811865475);
      const t = 1 / (1 + 0.3275911 * ax);
      const erf = s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax));
      return 0.5 * x * (1 + erf);
    };
    const blk = [];
    for (let i = 0; i < NB; i++) {
      const p = `blocks.${i}.`, qw = W[p + "qkv.weight"], qb = W[p + "qkv.bias"];
      blk.push({
        n1w: W[p + "n1.weight"], n1b: W[p + "n1.bias"],
        qw, qb,
        wq: qw.subarray(0, D * D), bq: qb.subarray(0, D),
        wkv: qw.subarray(D * D), bkv: qb.subarray(D),
        ow: W[p + "o.weight"], ob: W[p + "o.bias"],
        n2w: W[p + "n2.weight"], n2b: W[p + "n2.bias"],
        f0w: W[p + "ff.0.weight"], f0b: W[p + "ff.0.bias"],
        f2w: W[p + "ff.2.weight"], f2b: W[p + "ff.2.bias"],
      });
    }
    const nfw = W["nf.weight"], nfb = W["nf.bias"];
    const h0w = W["head.0.weight"], h0b = W["head.0.bias"], h2w = W["head.2.weight"], h2b = W["head.2.bias"][0];
    const inpw = W["inp.weight"], inpb = W["inp.bias"];

    // 各トークン i と関係 r (0:自デッキ, 1:味方, 2:敵) の対象 j インデックス配列を事前構築 (分岐ゼロ化)
    const relTargets = Array.from({ length: 50 }, () => [[], [], []]);
    for (let i = 0; i < 50; i++) {
      const pi = (i / 5) | 0, ti = (i / 25) | 0;
      for (let j = 0; j < 50; j++) {
        const r = ((j / 5) | 0) === pi ? 0 : (((j / 25) | 0) === ti ? 1 : 2);
        relTargets[i][r].push(j);
      }
    }

    // 再利用ワークバッファ (ヒープ確保ゼロ)
    const xBuf = new Float32Array(50 * D);
    const nxBuf = new Float32Array(50 * D);
    const qkvBuf = new Float32Array(50 * 3 * D);
    const kvLast = new Float32Array(50 * 2 * D);
    const qLast = new Float32Array(5 * D);
    const hn = new Float32Array(D);
    const att = new Float32Array(D);
    const tmpFF = new Float32Array(FF);
    const scBuf = new Float32Array(25);
    const mPool = new Float32Array(D);
    const headH = new Float32Array(D);
    const numTmp = new Float32Array(9);
    const hotTmp = new Int32Array(8);

    function embed(x, t, out, o) {
      let c0 = x[0], c1 = x[1], c2 = x[2], c3 = x[3], c4 = x[4], typ = x[5], c6 = x[6], c7 = x[7], c8 = x[8], amt = x[9], trn = x[10], c11 = x[11];
      if (c4 > CL.cnever) { c4 = 0; typ = 0; c6 = 0; c7 = 0; c8 = 0; amt = 0; trn = 0; c11 = 0; }
      if (c4 > CL.cmax) c4 = CL.cmax;
      if (amt > CL.amax[typ]) amt = CL.amax[typ];
      if (trn > CL.tmax[typ]) trn = CL.tmax[typ];
      numTmp[0] = c0 / 100; numTmp[1] = c2 / 1e4; numTmp[2] = c3 / 1e4; numTmp[3] = c4 / 12;
      numTmp[4] = V2 ? Math.log1p(amt / SC[typ]) : amt / SC[typ];
      numTmp[5] = V2 ? Math.log1p(c3 * (1 + (typ === 1 ? amt : 0) / 100)) / 12 : Math.log1p(amt) / 8;
      numTmp[6] = trn / 10; numTmp[7] = (c3 / (c0 + 1)) / 300; numTmp[8] = (c2 / (c0 + 1)) / 300;
      hotTmp[0] = OFF[0] + typ; hotTmp[1] = OFF[1] + c6; hotTmp[2] = OFF[2] + c7; hotTmp[3] = OFF[3] + c8;
      hotTmp[4] = OFF[4] + c1; hotTmp[5] = OFF[5] + c11; hotTmp[6] = OFF[6] + (t % 5); hotTmp[7] = OFF[7] + ((((t / 5) | 0) % 5) === 0 ? 1 : 0);
      for (let i = 0; i < D; i++) {
        const r = i * 56;
        let s = inpb[i]
          + inpw[r] * numTmp[0] + inpw[r + 1] * numTmp[1] + inpw[r + 2] * numTmp[2]
          + inpw[r + 3] * numTmp[3] + inpw[r + 4] * numTmp[4] + inpw[r + 5] * numTmp[5]
          + inpw[r + 6] * numTmp[6] + inpw[r + 7] * numTmp[7] + inpw[r + 8] * numTmp[8]
          + inpw[r + 9 + hotTmp[0]] + inpw[r + 9 + hotTmp[1]] + inpw[r + 9 + hotTmp[2]] + inpw[r + 9 + hotTmp[3]]
          + inpw[r + 9 + hotTmp[4]] + inpw[r + 9 + hotTmp[5]] + inpw[r + 9 + hotTmp[6]] + inpw[r + 9 + hotTmp[7]];
        out[o + i] = s;
      }
    }

    function ln(x, o, w, b, out, oo) {
      let m = 0;
      for (let i = 0; i < D; i++) m += x[o + i];
      m /= D;
      let v = 0;
      for (let i = 0; i < D; i++) { const d = x[o + i] - m; v += d * d; }
      const inv = 1 / Math.sqrt(v / D + 1e-5);
      for (let i = 0; i < D; i++) out[oo + i] = (x[o + i] - m) * inv * w[i] + b[i];
    }

    function lin(W0, B0, x, o, n, m, out, oo) {
      const m4 = m & ~3;
      for (let i = 0; i < n; i++) {
        const r = i * m;
        let s0 = 0, s1 = 0, s2 = 0, s3 = 0, j = 0;
        for (; j < m4; j += 4) {
          s0 += W0[r + j] * x[o + j];
          s1 += W0[r + j + 1] * x[o + j + 1];
          s2 += W0[r + j + 2] * x[o + j + 2];
          s3 += W0[r + j + 3] * x[o + j + 3];
        }
        let s = B0[i] + (s0 + s1) + (s2 + s3);
        for (; j < m; j++) s += W0[r + j] * x[o + j];
        out[oo + i] = s;
      }
    }

    function runFullBlock(B, xIn, qkv, onlyNeedStart, xOut) {
      if (onlyNeedStart >= 0) {
        for (let k = 0; k < 5; k++) {
          const t = onlyNeedStart + k;
          ln(xIn, t * D, B.n1w, B.n1b, hn, 0);
          lin(B.qw, B.qb, hn, 0, 3 * D, D, qkv, t * 3 * D);
        }
      } else {
        for (let t = 0; t < 50; t++) {
          ln(xIn, t * D, B.n1w, B.n1b, hn, 0);
          lin(B.qw, B.qb, hn, 0, 3 * D, D, qkv, t * 3 * D);
        }
      }
      for (let i = 0; i < 50; i++) {
        for (let h = 0; h < H; h++) {
          const r = (h / G) | 0, js = relTargets[i][r], nj = js.length;
          const qo = i * 3 * D + h * DH;
          let mx = -1e30;
          for (let idx = 0; idx < nj; idx++) {
            const ko = js[idx] * 3 * D + D + h * DH;
            let s = 0;
            for (let q = 0; q < DH; q++) s += qkv[qo + q] * qkv[ko + q];
            s *= SQ;
            scBuf[idx] = s;
            if (s > mx) mx = s;
          }
          let z = 0;
          for (let idx = 0; idx < nj; idx++) {
            const e = Math.exp(scBuf[idx] - mx);
            scBuf[idx] = e;
            z += e;
          }
          const invZ = 1 / z, ao = h * DH;
          for (let q = 0; q < DH; q++) att[ao + q] = 0;
          for (let idx = 0; idx < nj; idx++) {
            const w = scBuf[idx] * invZ, vo = js[idx] * 3 * D + 2 * D + h * DH;
            for (let q = 0; q < DH; q++) att[ao + q] += w * qkv[vo + q];
          }
        }
        const o = i * D;
        lin(B.ow, B.ob, att, 0, D, D, xOut, o);
        for (let k = 0; k < D; k++) xOut[o + k] += xIn[o + k];
        ln(xOut, o, B.n2w, B.n2b, hn, 0);
        lin(B.f0w, B.f0b, hn, 0, FF, D, tmpFF, 0);
        for (let k = 0; k < FF; k++) tmpFF[k] = gelu(tmpFF[k]);
        for (let k = 0; k < D; k++) {
          const r = k * FF;
          let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
          for (let j = 0; j < FF; j += 4) {
            s0 += B.f2w[r + j] * tmpFF[j];
            s1 += B.f2w[r + j + 1] * tmpFF[j + 1];
            s2 += B.f2w[r + j + 2] * tmpFF[j + 2];
            s3 += B.f2w[r + j + 3] * tmpFF[j + 3];
          }
          xOut[o + k] += B.f2b[k] + (s0 + s1) + (s2 + s3);
        }
      }
    }

    function scorer(fixed, me) {
      const x0 = new Float32Array(50 * D), q0 = new Float32Array(50 * 3 * D);
      const mStart = me * 5;
      for (let p = 0; p < 10; p++) {
        if (p !== me && fixed[p]) {
          for (let k = 0; k < 5; k++) embed(fixed[p][k], p * 5 + k, x0, (p * 5 + k) * D);
        }
      }
      for (let t = 0; t < 50; t++) {
        if (((t / 5) | 0) !== me) {
          ln(x0, t * D, blk[0].n1w, blk[0].n1b, hn, 0);
          lin(blk[0].qw, blk[0].qb, hn, 0, 3 * D, D, q0, t * 3 * D);
        }
      }

      return function evalDeck(deck) {
        xBuf.set(x0);
        qkvBuf.set(q0);
        for (let k = 0; k < 5; k++) embed(deck[k], mStart + k, xBuf, (mStart + k) * D);

        // 中間層 (0 .. NB-2)
        let curX = xBuf, nextX = nxBuf;
        for (let bi = 0; bi < NB - 1; bi++) {
          runFullBlock(blk[bi], curX, qkvBuf, bi === 0 ? mStart : -1, nextX);
          const sw = curX; curX = nextX; nextX = sw;
        }

        // 最終層 (NB-1): KV は全50体、Q と FFN は自デッキ5体のみ!
        const BL = blk[NB - 1];
        for (let t = 0; t < 50; t++) {
          ln(curX, t * D, BL.n1w, BL.n1b, hn, 0);
          lin(BL.wkv, BL.bkv, hn, 0, 2 * D, D, kvLast, t * 2 * D);
          if (t >= mStart && t < mStart + 5) {
            lin(BL.wq, BL.bq, hn, 0, D, D, qLast, (t - mStart) * D);
          }
        }
        mPool.fill(0);
        for (let k = 0; k < 5; k++) {
          const i = mStart + k;
          for (let h = 0; h < H; h++) {
            const r = (h / G) | 0, js = relTargets[i][r], nj = js.length;
            const qo = k * D + h * DH;
            let mx = -1e30;
            for (let idx = 0; idx < nj; idx++) {
              const ko = js[idx] * 2 * D + h * DH;
              let s = 0;
              for (let q = 0; q < DH; q++) s += qLast[qo + q] * kvLast[ko + q];
              s *= SQ;
              scBuf[idx] = s;
              if (s > mx) mx = s;
            }
            let z = 0;
            for (let idx = 0; idx < nj; idx++) {
              const e = Math.exp(scBuf[idx] - mx);
              scBuf[idx] = e;
              z += e;
            }
            const invZ = 1 / z, ao = h * DH;
            for (let q = 0; q < DH; q++) att[ao + q] = 0;
            for (let idx = 0; idx < nj; idx++) {
              const w = scBuf[idx] * invZ, vo = js[idx] * 2 * D + D + h * DH;
              for (let q = 0; q < DH; q++) att[ao + q] += w * kvLast[vo + q];
            }
          }
          const o = i * D;
          lin(BL.ow, BL.ob, att, 0, D, D, nextX, k * D);
          for (let d = 0; d < D; d++) nextX[k * D + d] += curX[o + d];
          ln(nextX, k * D, BL.n2w, BL.n2b, hn, 0);
          lin(BL.f0w, BL.f0b, hn, 0, FF, D, tmpFF, 0);
          for (let d = 0; d < FF; d++) tmpFF[d] = gelu(tmpFF[d]);
          for (let d = 0; d < D; d++) {
            const r = d * FF;
            let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
            for (let j = 0; j < FF; j += 4) {
              s0 += BL.f2w[r + j] * tmpFF[j];
              s1 += BL.f2w[r + j + 1] * tmpFF[j + 1];
              s2 += BL.f2w[r + j + 2] * tmpFF[j + 2];
              s3 += BL.f2w[r + j + 3] * tmpFF[j + 3];
            }
            nextX[k * D + d] += BL.f2b[d] + (s0 + s1) + (s2 + s3);
          }
          ln(nextX, k * D, nfw, nfb, hn, 0);
          for (let d = 0; d < D; d++) mPool[d] += hn[d] * 0.2;
        }
        lin(h0w, h0b, mPool, 0, D, D, headH, 0);
        let outS = h2b;
        for (let d = 0; d < D; d++) outS += h2w[d] * gelu(headH[d]);
        return outS;
      };
    }
    return { scorer };
  }

  function createEngine(compatSet, baseData, setModelMeta) {
    const fastSet = setModelMeta ? makeFastSet(setModelMeta) : compatSet;
    const mu = baseData.mu, sd = baseData.sd;
    const refChars = baseData.ref_chars; // { "id": [name, cost, leg, feat13] }
    const ranking = baseData.ranking;   // [[id, name, cost, rare, attrs, score, bq], ...]
    const rankScores = ranking.map((x) => x[5]);

    // ブラウザ快適応答のため各バンド上位2試合 × [seat=0(0.2), seat=1(0.8)] = 4レイアウトを事前構築
    const bandScorers = {};
    for (let bi = 0; bi < 4; bi++) {
      const bd = baseData.bands[String(bi)];
      const draws = bd.env_draws_ids;
      const nEnv = Math.min(2, draws.length);
      const list = [];
      for (let ei = 0; ei < nEnv; ei++) {
        const decks10 = draws[ei].map((dk) => dk.map((cid) => refChars[String(cid)][3]));
        const fixed0 = decks10.slice(); fixed0[0] = null;
        const fixed1 = decks10.slice(); fixed1[1] = null;
        list.push({ w: 0.2 / nEnv, seat: 0, fn: fastSet.scorer(fixed0, 0) });
        list.push({ w: 0.8 / nEnv, seat: 1, fn: fastSet.scorer(fixed1, 1) });
      }
      bandScorers[bi] = list;
    }

    /* 2段採点: まず代表1レイアウト(seat1[0], 非リーダー80%側)で全候補シェル(最大12個)を下見し、上位5シェルを残り3レイアウトで本採点 */
    function scoreShellsTwoStage(bi, shellDecks, envMean) {
      const list = bandScorers[bi];
      const n = shellDecks.length;
      const quick = new Array(n);
      for (let i = 0; i < n; i++) {
        const s1 = list[1].fn(shellDecks[i][1]);
        quick[i] = [i, s1];
      }
      quick.sort((a, b) => b[1] - a[1]);
      const topK = Math.min(n, 5);
      const fullScored = [];
      for (let k = 0; k < topK; k++) {
        const idx = quick[k][0], dk = shellDecks[idx][1];
        let acc = list[1].w * quick[k][1] + list[0].w * list[0].fn(dk);
        for (let li = 2; li < list.length; li++) acc += list[li].w * list[li].fn(dk);
        fullScored.push([shellDecks[idx][0], acc - envMean]);
      }
      fullScored.sort((a, b) => b[1] - a[1]);
      return fullScored;
    }

    function peerBase(bi, shi, cCost) {
      const curve = baseData.bands[String(bi)].peer_curves[shi];
      if (!curve || !curve.length) return 0;
      const idx = Math.max(0, Math.min(curve.length - 1, Math.floor((Math.max(2, cCost) - 2) / 2)));
      return curve[idx];
    }

    function scoreVariant(ch) {
      const cCost = ch.cost | 0;
      const cLeg = ch.rare === "伝";
      const cid = ch.id != null ? ch.id : -1;
      const bandOut = {};

      for (let bi = 0; bi < 4; bi++) {
        const [bname, cap] = BANDS[bi];
        const bd = baseData.bands[String(bi)];
        const shells = bd.shells;
        const maxSlack = Math.max(35, Math.trunc(cap * 0.30));
        const vSh = [];
        for (let shi = 0; shi < shells.length; shi++) {
          const sh = shells[shi];
          if (sh.rem_cost >= cCost && !(cLeg && sh.has_leg) && !sh.core.includes(cid)) {
            vSh.push(shi);
          }
        }
        if (vSh.length < 3) {
          bandOut[bname] = { eligible: false, cap, q: Number(baseData.unusable_pen[String(bi)]) };
          continue;
        }
        const tight = vSh.filter((shi) => shells[shi].rem_cost <= cCost + maxSlack);
        let useSh = tight.length >= 6
          ? tight
          : vSh.slice().sort((a, b) => (shells[a].rem_cost - cCost) - (shells[b].rem_cost - cCost)).slice(0, 12);
        if (useSh.length > 12) {
          useSh = useSh.slice().sort((a, b) => {
            const va = shells[a].base_sc - 0.008 * (shells[a].rem_cost - cCost);
            const vb = shells[b].base_sc - 0.008 * (shells[b].rem_cost - cCost);
            return vb - va;
          }).slice(0, 12);
        }

        const shellDecks = [];
        for (let i = 0; i < useSh.length; i++) {
          const shi = useSh[i], sh = shells[shi], core = sh.core, s = sh.slot;
          const dk = [];
          for (let k = 0; k < s; k++) dk.push(refChars[String(core[k])][3]);
          dk.push(ch.feat);
          for (let k = s; k < 4; k++) dk.push(refChars[String(core[k])][3]);
          shellDecks.push([shi, dk]);
        }
        const scored = scoreShellsTwoStage(bi, shellDecks, bd.env_mean);

        const top4 = [], seenC = new Set();
        for (let i = 0; i < scored.length; i++) {
          const [shi, sc] = scored[i];
          const crKey = shells[shi].core.slice().sort((a, b) => a - b).join(",");
          if (!seenC.has(crKey)) {
            seenC.add(crKey);
            top4.push([shi, sc]);
            if (top4.length >= 4) break;
          }
        }
        let sTop4 = 0, dPeer = 0;
        for (let i = 0; i < top4.length; i++) {
          sTop4 += top4[i][1];
          dPeer += top4[i][1] - peerBase(bi, top4[i][0], cCost);
        }
        sTop4 /= top4.length;
        dPeer /= top4.length;
        const dCeil = sTop4 - bd.ceil;
        const q = 0.5 * dCeil + 0.5 * dPeer;

        const [bestShi, bestSc] = top4[0];
        const bsh = shells[bestShi];
        const deckMembers = [];
        for (let k = 0; k < bsh.slot; k++) deckMembers.push({ id: bsh.core[k], name: refChars[String(bsh.core[k])][0], self: false });
        deckMembers.push({ id: cid, name: ch.name || "診断キャラ", self: true });
        for (let k = bsh.slot; k < 4; k++) deckMembers.push({ id: bsh.core[k], name: refChars[String(bsh.core[k])][0], self: false });

        bandOut[bname] = {
          eligible: true,
          cap,
          q,
          s_top4: sTop4,
          d_ceil: dCeil,
          d_peer: dPeer,
          best_slot: bsh.slot + 1,
          best_deck_score: bestSc,
          best_deck: deckMembers,
        };
      }

      const qf = BANDS.map(([bn]) => bandOut[bn].q);
      const qs = qf.slice().sort((a, b) => b - a);
      const raw = 0.60 * ((qs[0] + qs[1]) / 2) + 0.40 * ((qf[0] + qf[1] + qf[2] + qf[3]) / 4);
      const score = 50.0 + 10.0 * (raw - mu) / sd;
      const scoreR = Math.round(score * 10) / 10;
      let higher = 0;
      for (let i = 0; i < rankScores.length; i++) if (rankScores[i] > score) higher++;
      const rankEq = higher + 1;
      const [tier, tierDesc, state] = tierOf(score);
      return {
        score: scoreR,
        scoreExact: score,
        raw,
        tier,
        tierDesc,
        state,
        rankEq,
        nRoster: rankScores.length,
        topPct: Math.max(0.1, Math.round((rankEq / Math.max(1, rankScores.length)) * 1000) / 10),
        bands: bandOut,
      };
    }

    function diagnose(opts) {
      const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
      const isUnlimit = opts.isUnlimitStat !== false;
      const lhp = isUnlimit ? Math.round(Number(opts.hp) || 1) : pyRound((Number(opts.hp) || 1) * 1.6);
      const lpw = isUnlimit ? Math.round(Number(opts.pw) || 0) : pyRound((Number(opts.pw) || 0) * 1.6);
      const cost = Math.max(1, Math.round(Number(opts.cost) || 1));
      const attrs = parseAttrs(opts.attrs);
      const rare = opts.rare || "ZR";
      const cid = opts.charId != null ? opts.charId : -1;
      const skill = opts.skill || null;

      const featNorm = encodeChar(cost, attrs, lhp, lpw, skill);
      const featTheme = encodeChar(cost, attrs, pyRound(lhp * 1.5), pyRound(lpw * 1.5), skill);

      const normal = scoreVariant({ id: cid, name: opts.name, cost, rare, feat: featNorm });
      const theme15x = scoreVariant({ id: cid, name: opts.name, cost, rare, feat: featTheme });

      const nearExisting = ranking
        .filter((x) => x[0] !== cid)
        .slice()
        .sort((a, b) => Math.abs(a[5] - normal.scoreExact) - Math.abs(b[5] - normal.scoreExact))
        .slice(0, 4)
        .map((x) => ({ id: x[0], name: x[1], cost: x[2], rare: x[3], attrs: x[4], score: x[5] }));

      const dt = ((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0) / 1000;
      return {
        input: { name: opts.name || "未実装キャラ", cost, attrs: attrs.join(""), lhp, lpw, rare, skill, feat: featNorm },
        normal,
        theme15x,
        nearExisting,
        warnings: clipWarnings(featNorm, setModelMeta),
        elapsedSec: dt,
      };
    }

    return { diagnose, ranking, encodeChar, buildSkillDict, parseAttrs };
  }

  const exported = { createEngine, encodeChar, buildSkillDict, parseAttrs, attrSelectValue, pyRound };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exported;
    return;
  }
  root.CharDiagCore = exported;

  /* ========== ブラウザ画面 (#page-diag) 制御 ========== */
  let engine = null;
  let selectedChar = null;   // zukan_beta.json の character オブジェクト (未実装モード時は null)
  let rosterMap = null;      // id -> zukanToRoster 変換済みオブジェクト
  let charByIdMap = null;    // id -> zukan_beta.json の character オブジェクト

  function ensureMaps() {
    if (!rosterMap && root.zukanToRoster && typeof chars !== "undefined" && chars.length) {
      const ros = root.zukanToRoster({ characters: chars });
      rosterMap = new Map(ros.map((r) => [Number(r.id), r]));
      charByIdMap = new Map();
      for (const c of chars) {
        const id = Number(c?.details?.id ?? c?.id);
        if (Number.isFinite(id) && !charByIdMap.has(id)) charByIdMap.set(id, c);
      }
    }
  }

  function syncSelect(id) {
    const el = document.getElementById(id);
    if (el && typeof calculatorSyncStyledSelect === "function") calculatorSyncStyledSelect(el);
  }

  function sgn(v, d = 3) {
    return (v >= 0 ? "+" : "") + Number(v).toFixed(d);
  }

  function syncSkillFieldVisibility() {
    const tp = $("diagSkillType").value;
    const isNone = tp === "none";
    $("diagTurnWrap").hidden = isNone;
    $("diagTurnsWrap").hidden = isNone;

    const noAmt = isNone || tp === "all_attack" || tp === "color_change";
    $("diagAmountWrap").hidden = noAmt;
    if (!noAmt) {
      const lbl = $("diagAmountLabel");
      if (tp === "multi_attack") lbl.textContent = "連撃回数（回）";
      else if (tp === "shorten") lbl.textContent = "短縮量（ターン）";
      else if (tp === "delay") lbl.textContent = "遅延量（ターン）";
      else if (tp === "shield" || tp === "cover" || tp === "cover_leader") lbl.textContent = "軽減率（%）";
      else if (tp === "heal") lbl.textContent = "回復量（%）";
      else if (tp === "revive") lbl.textContent = "蘇生時HP（%）";
      else lbl.textContent = "攻撃力増加（%）";
    }

    // 範囲選択: かばう(自身固定)・かわす(リーダー固定)・遅延(敵固定)では隠す
    const hideScope = isNone || tp === "cover" || tp === "cover_leader" || tp === "delay";
    $("diagScopeWrap").hidden = hideScope;

    // 対象属性 / 色変先
    const showTargetAttr = !isNone && !["cover", "cover_leader"].includes(tp) && (tp === "color_change" || tp === "delay" || $("diagScope").value === "team");
    $("diagTargetAttrWrap").hidden = !showTargetAttr;
    if (showTargetAttr) {
      const sel = $("diagTargetAttr"), prev = sel.value;
      const lbl = $("diagTargetAttrLabel");
      if (tp === "color_change") {
        lbl.textContent = "変化後の属性";
        sel.innerHTML = ["火", "水", "風", "火水", "水風", "風火", "全"].map((v) => `<option value="${v}">${v === "全" ? "全属性" : v + "属性"}</option>`).join("");
        sel.value = ["火", "水", "風", "火水", "水風", "風火", "全"].includes(prev) ? prev : "火";
      } else if (tp === "delay") {
        lbl.textContent = "対象（敵の属性）";
        sel.innerHTML = `<option value="">敵全員</option><option value="火">火属性の敵</option><option value="水">水属性の敵</option><option value="風">風属性の敵</option>`;
        sel.value = ["", "火", "水", "風"].includes(prev) ? prev : "";
      } else {
        lbl.textContent = "味方の属性条件";
        sel.innerHTML = `<option value="">味方全員（全属性）</option><option value="火">火属性の味方のみ</option><option value="水">水属性の味方のみ</option><option value="風">風属性の味方のみ</option>`;
        sel.value = ["", "火", "水", "風"].includes(prev) ? prev : "";
      }
      syncSelect("diagTargetAttr");
    }

    // 対属性（バフ・軽減・かばう・かわす）
    const showVs = ["atk_up", "shield", "cover", "cover_leader"].includes(tp);
    $("diagVsAttrWrap").hidden = !showVs;
  }

  function populateFromExisting(c) {
    ensureMaps();
    selectedChar = c;
    const d = c.details || {};
    const id = Number(d.id ?? c.id);
    const rosEntry = rosterMap ? rosterMap.get(id) : null;

    const p = $("diagPicker");
    p.querySelector(".portrait").style.backgroundImage = c.imageUrl ? `url("${String(c.imageUrl).replace(/"/g, "")}")` : "";
    p.querySelector("strong").textContent = c.name || d.name || "";
    p.querySelector("small").textContent = [d.rare, canon(d.attribute), d.cost != null ? "Cost " + d.cost : null].filter(Boolean).join(" / ");

    $("diagResetToOrig").hidden = false;
    $("diagName").value = c.name || d.name || "";
    $("diagCost").value = Number(d.cost ?? 1);
    $("diagRare").value = ["N", "R", "CR", "ZR", "MZR", "伝"].includes(d.rare) ? d.rare : "CR";
    $("diagAttr").value = attrSelectValue(rosEntry ? rosEntry.attrs : String(d.attribute || "火"));
    syncSelect("diagRare");
    syncSelect("diagAttr");

    // 凸数セレクタ設定
    const maxLb = typeof limitBreakMax === "function" ? limitBreakMax(c) : 0;
    const lbSel = $("diagLimitBreak");
    if (maxLb > 0) {
      $("diagLimitBreakWrap").hidden = false;
      $("diagStatModeWrap").hidden = true;
      const lhp = Number(d.limitHp ?? d.hp ?? 1);
      const lpw = Number(d.limitPower ?? d.power ?? 0);
      $("diagHp").value = lhp;
      $("diagPw").value = lpw;
      lbSel.innerHTML = limitBreakOptions(c, "hp", lhp, { withValue: false, manual: false });
      syncSelect("diagLimitBreak");
    } else {
      $("diagLimitBreakWrap").hidden = true;
      $("diagStatModeWrap").hidden = false;
      const hasLim = d.limitHp != null && d.limitPower != null;
      $("diagStatMode").value = hasLim ? "1" : "0";
      $("diagHp").value = Number(hasLim ? d.limitHp : (d.hp ?? 1));
      $("diagPw").value = Number(hasLim ? d.limitPower : (d.power ?? 0));
      syncSelect("diagStatMode");
    }

    // スキル反映
    $("diagOrigSkillBox").hidden = false;
    $("diagOrigSkillText").textContent = d.skill ? `元のスキル文: ${d.skill}` : "元のスキル: なし";

    const sk = rosEntry && rosEntry.sk ? rosEntry.sk : null;
    const e = sk && sk.effects && sk.effects[0] ? sk.effects[0] : null;
    if (!e) {
      $("diagSkillType").value = "none";
      $("diagTurn").value = 0;
      $("diagAmount").value = 0;
      $("diagTurns").value = 1;
      $("diagScope").value = "team";
      $("diagVsAttr").value = "";
      syncSelect("diagSkillType");
      syncSelect("diagScope");
      syncSelect("diagVsAttr");
      syncSkillFieldVisibility();
    } else {
      const tp = e.type === "cover" && e.to_leader ? "cover_leader" : e.type;
      $("diagSkillType").value = TYPES.includes(tp) ? tp : "none";
      $("diagTurn").value = Number(sk.turn ?? 0);
      let amt = 0;
      if (e.bonus != null) amt = Math.round(e.bonus * 10000) / 100;
      else if (e.cut != null) amt = Math.round(e.cut * 10000) / 100;
      else if (e.rate != null) amt = Math.round(e.rate * 10000) / 100;
      else if (e.hp_rate != null) amt = Math.round(e.hp_rate * 10000) / 100;
      else amt = e.hits != null ? e.hits : (e.amount || 0);
      $("diagAmount").value = amt;
      $("diagTurns").value = Number(e.turns ?? 1);
      $("diagScope").value = ["self", "team", "leader"].includes(e.scope) ? e.scope : "team";
      $("diagVsAttr").value = e.vs_attr || "";
      syncSelect("diagSkillType");
      syncSelect("diagScope");
      syncSelect("diagVsAttr");
      syncSkillFieldVisibility();
      if (!$("diagTargetAttrWrap").hidden) {
        if (tp === "color_change") {
          $("diagTargetAttr").value = attrSelectValue(e.to || ["火"]);
        } else {
          $("diagTargetAttr").value = e.attr || "";
        }
        syncSelect("diagTargetAttr");
      }
    }
    runCurrentDiagnosis();
  }

  function resetToUnimplemented() {
    selectedChar = null;
    const p = $("diagPicker");
    p.querySelector(".portrait").style.backgroundImage = "";
    p.querySelector("strong").textContent = "未選択（未実装・自由入力モード）";
    p.querySelector("small").textContent = "タップして既存キャラを図鑑から読み込むこともできます";
    $("diagResetToOrig").hidden = true;
    $("diagOrigSkillBox").hidden = true;
    $("diagLimitBreakWrap").hidden = true;
    $("diagStatModeWrap").hidden = false;
    $("diagStatMode").value = "1";
    $("diagName").value = "未実装キャラ";
    $("diagRare").value = "ZR";
    $("diagCost").value = 28;
    $("diagAttr").value = "火";
    $("diagHp").value = 4500;
    $("diagPw").value = 2600;
    $("diagSkillType").value = "atk_up";
    $("diagTurn").value = 2;
    $("diagAmount").value = 100;
    $("diagTurns").value = 2;
    $("diagScope").value = "team";
    $("diagVsAttr").value = "";
    ["diagStatMode", "diagRare", "diagAttr", "diagSkillType", "diagScope", "diagVsAttr"].forEach(syncSelect);
    syncSkillFieldVisibility();
    $("diagTargetAttr").value = "";
    syncSelect("diagTargetAttr");
    runCurrentDiagnosis();
  }

  function readFormAndDiagnose() {
    const tp = $("diagSkillType").value;
    const scope = $("diagScope").value;
    const targetAttr = $("diagTargetAttrWrap").hidden ? "" : $("diagTargetAttr").value;
    const vsAttr = $("diagVsAttrWrap").hidden ? "" : $("diagVsAttr").value;
    const sk = buildSkillDict(
      tp,
      Number($("diagTurn").value || 0),
      scope,
      targetAttr,
      vsAttr,
      Number($("diagAmount").value || 0),
      Number($("diagTurns").value || 1),
      targetAttr
    );

    // 既存キャラと完全に同一パラメータか判定 (同一なら本人の重複デッキ除外 ID を使う)
    let cid = -1;
    let isUnlimit = true;
    if (selectedChar) {
      const d = selectedChar.details || {};
      const origId = Number(d.id ?? selectedChar.id);
      const rosEntry = rosterMap ? rosterMap.get(origId) : null;
      if (rosEntry) {
        const curCost = Math.round(Number($("diagCost").value) || 1);
        const curHp = Math.round(Number($("diagHp").value) || 1);
        const curPw = Math.round(Number($("diagPw").value) || 0);
        const curAttrs = parseAttrs($("diagAttr").value);
        const curFeat = encodeChar(curCost, curAttrs, curHp, curPw, sk);
        const origLhp = rosEntry.lhp != null && rosEntry.lpw != null ? rosEntry.lhp : pyRound(rosEntry.hp * 1.6);
        const origLpw = rosEntry.lhp != null && rosEntry.lpw != null ? rosEntry.lpw : pyRound(rosEntry.pw * 1.6);
        const origFeat = encodeChar(rosEntry.cost, rosEntry.attrs, origLhp, origLpw, rosEntry.sk || null);
        if (curFeat.every((v, i) => v === origFeat[i]) && $("diagRare").value === (rosEntry.r || "CR")) {
          cid = origId;
        }
      }
      // 既存キャラ選択時は入力欄にその凸のHP/Powerが直接入っているためそのまま評価する
      if (!$("diagLimitBreakWrap").hidden) isUnlimit = true;
      else isUnlimit = $("diagStatMode").value === "1";
    } else {
      isUnlimit = $("diagStatMode").value === "1";
    }

    return engine.diagnose({
      name: $("diagName").value.trim() || "診断キャラ",
      cost: Number($("diagCost").value || 1),
      attrs: $("diagAttr").value,
      hp: Number($("diagHp").value || 1),
      pw: Number($("diagPw").value || 0),
      rare: $("diagRare").value,
      skill: sk,
      isUnlimitStat: isUnlimit,
      charId: cid,
    });
  }

  function renderDiagnosisResult(res) {
    const nm = res.normal, th = res.theme15x, inp = res.input;
    const scoreEl = $("diagScoreValue");
    scoreEl.textContent = `${nm.score.toFixed(1)} 点`;
    const tierEl = $("diagTierLabel");
    tierEl.textContent = `${nm.tier}ランク｜${nm.tierDesc}`;
    tierEl.dataset.state = nm.state;

    $("diagSubMeta").textContent = `既存${nm.nRoster.toLocaleString()}体中 ${nm.rankEq.toLocaleString()}位相当（上位${nm.topPct}% / 期待寄与 ${sgn(nm.raw, 4)}）`;
    $("diagThemeScore").textContent = `${th.score.toFixed(1)} 点`;
    $("diagThemeMeta").textContent = `${th.tier}ランク / 既存${th.rankEq.toLocaleString()}位相当`;
    $("diagSpecEcho").textContent = `${inp.name}（${inp.attrs} / Cost ${inp.cost} / ${inp.rare} / 評価HP ${inp.lhp.toLocaleString()}・Power ${inp.lpw.toLocaleString()} / ${(res.elapsedSec * 1000).toFixed(0)}ms）`;

    const warnBox = $("diagWarnings");
    if (res.warnings && res.warnings.length) {
      warnBox.hidden = false;
      warnBox.innerHTML = res.warnings.map((w) => `<p>・${esc(w)}</p>`).join("");
    } else {
      warnBox.hidden = true;
      warnBox.innerHTML = "";
    }

    const tbody = $("diagBandsBody");
    tbody.innerHTML = BANDS.map(([bn]) => {
      const b = nm.bands[bn];
      if (!b.eligible) {
        return `<tr><td><b>${esc(bn)}</b><small>〜${b.cap}</small></td><td colspan="4" class="diag-unusable">編成不可（コスト超過・補完基準値 ${sgn(b.q, 3)}）</td></tr>`;
      }
      const chips = b.best_deck.map((m) => {
        if (m.self) return `<span class="diag-deck-chip is-self">★${esc(m.name)}</span>`;
        return `<button type="button" class="diag-deck-chip" data-diag-load="${m.id}">${esc(m.name)}</button>`;
      }).join("");
      return `<tr>
        <td><b>${esc(bn)}</b><small>〜${b.cap}</small></td>
        <td class="diag-num"><b>${sgn(b.q, 3)}</b></td>
        <td class="diag-num"><span>対天井 ${sgn(b.d_ceil, 3)}</span><small>対同コス ${sgn(b.d_peer, 3)}</small></td>
        <td class="diag-slot">${b.best_slot}枠目</td>
        <td><div class="diag-deck-chips">${chips}</div></td>
      </tr>`;
    }).join("");

    const nearBox = $("diagNearList");
    nearBox.innerHTML = res.nearExisting.map((x) =>
      `<button type="button" class="reset-btn diag-near-btn" data-diag-load="${x.id}"><span>${esc(x.name)}</span><small>${x.score.toFixed(1)}点 (C${x.cost} ${esc(x.rare)})</small></button>`
    ).join("");
  }

  let diagTimer = 0;
  function runCurrentDiagnosis() {
    if (!engine) return;
    const btn = $("diagRunBtn");
    if (btn) { btn.disabled = true; btn.textContent = "計算中..."; }
    clearTimeout(diagTimer);
    diagTimer = setTimeout(() => {
      try {
        const res = readFormAndDiagnose();
        renderDiagnosisResult(res);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "この性能で診断する"; }
      }
    }, 16);
  }

  function renderRankingTable() {
    if (!engine) return;
    const q = ($("diagRankSearch").value || "").normalize("NFKC").replace(/[\s　]+/g, "").toLowerCase();
    const rare = $("diagRankRare").value;
    const list = engine.ranking.filter((x) => {
      if (rare && x[3] !== rare) return false;
      if (q && !String(x[1]).normalize("NFKC").replace(/[\s　]+/g, "").toLowerCase().includes(q)) return false;
      return true;
    });
    $("diagRankCount").textContent = `${list.length.toLocaleString()}体`;
    const slice = list.slice(0, 100);
    $("diagRankList").innerHTML = slice.map((x, idx) => {
      const id = x[0], nm = x[1], cost = x[2], rr = x[3], at = x[4], sc = x[5];
      const [tier] = tierOf(sc);
      const origRank = engine.ranking.indexOf(x) + 1;
      return `<button type="button" class="diag-rank-row" data-diag-load="${id}">
        <span class="diag-rank-no">#${origRank}</span>
        <span class="diag-rank-name"><b>${esc(nm)}</b><small>${esc(at)} / Cost ${cost} / ${esc(rr)}</small></span>
        <span class="diag-rank-tier">${tier}</span>
        <span class="diag-rank-sc">${sc.toFixed(1)}点</span>
      </button>`;
    }).join("") + (list.length > 100 ? `<p class="diag-rank-more">上位100件を表示しています（名前検索やレア度で絞り込めます）</p>` : "");
  }

  function loadCharById(id) {
    ensureMaps();
    const c = charByIdMap && charByIdMap.get(Number(id));
    if (c) {
      populateFromExisting(c);
      scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  root.setDiagCharacter = function (c) {
    if (!c) return;
    if (!engine) {
      pendingDiagChar = c;
      return;
    }
    populateFromExisting(c);
  };

  let pendingDiagChar = null;
  let initialized = false;

  root.initCharDiag = function () {
    if (initialized) {
      if (pendingDiagChar) {
        const c = pendingDiagChar;
        pendingDiagChar = null;
        populateFromExisting(c);
      }
      return;
    }
    if (!root.CompatSet || !root.CHAR_DIAG_BASE) {
      throw new Error("相性AIモデルまたは診断基準データが読み込まれていません");
    }
    ensureMaps();
    engine = createEngine(root.CompatSet, root.CHAR_DIAG_BASE, root.SET_MODEL);
    initialized = true;

    $("diagLoading").hidden = true;
    $("diagMount").hidden = false;

    // セレクト初期化
    ["diagRare", "diagAttr", "diagStatMode", "diagSkillType", "diagScope", "diagTargetAttr", "diagVsAttr", "diagRankRare"].forEach(syncSelect);

    $("diagPicker").onclick = () => {
      if (typeof openBattlePicker === "function") {
        openBattlePicker((c) => populateFromExisting(c), "診断するキャラを選択", false);
      }
    };
    if (typeof registerCharDrag === "function") {
      registerCharDrag("diag", {
        get: () => selectedChar,
        place: (_, c) => populateFromExisting(c),
      });
    }

    $("diagNewUnimp").onclick = resetToUnimplemented;
    $("diagResetToOrig").onclick = () => { if (selectedChar) populateFromExisting(selectedChar); };
    $("diagRunBtn").onclick = runCurrentDiagnosis;

    $("diagLimitBreak").onchange = () => {
      if (!selectedChar) return;
      const v = $("diagLimitBreak").value;
      if (v === "manual") return;
      const k = Number(v);
      if (Number.isInteger(k) && typeof limitBreakValue === "function") {
        $("diagHp").value = limitBreakValue(selectedChar, "hp", k);
        $("diagPw").value = limitBreakValue(selectedChar, "power", k);
        runCurrentDiagnosis();
      }
    };
    const markManualLb = () => {
      if (selectedChar && !$("diagLimitBreakWrap").hidden) {
        const d = selectedChar.details || {};
        const hitHp = limitBreakFind(selectedChar, "hp", Number($("diagHp").value));
        const hitPw = limitBreakFind(selectedChar, "power", Number($("diagPw").value));
        $("diagLimitBreak").value = (hitHp >= 0 && hitHp === hitPw) ? String(hitHp) : "manual";
        syncSelect("diagLimitBreak");
      }
    };
    $("diagHp").addEventListener("input", markManualLb);
    $("diagPw").addEventListener("input", markManualLb);

    $("diagSkillType").onchange = () => { syncSkillFieldVisibility(); runCurrentDiagnosis(); };
    $("diagScope").onchange = () => { syncSkillFieldVisibility(); runCurrentDiagnosis(); };
    ["diagRare", "diagAttr", "diagStatMode", "diagTargetAttr", "diagVsAttr"].forEach((id) => {
      $(id).addEventListener("change", runCurrentDiagnosis);
    });
    ["diagCost", "diagHp", "diagPw", "diagTurn", "diagAmount", "diagTurns"].forEach((id) => {
      if (typeof keepNumericViewport === "function") keepNumericViewport($(id));
      $(id).addEventListener("change", runCurrentDiagnosis);
    });

    $("diagRankSearch").oninput = renderRankingTable;
    $("diagRankRare").onchange = renderRankingTable;

    $("page-diag").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-diag-load]");
      if (btn) loadCharById(Number(btn.dataset.diagLoad));
    });

    renderRankingTable();
    const firstChar = pendingDiagChar || root._pendingDiagChar || null;
    pendingDiagChar = null;
    root._pendingDiagChar = null;
    if (firstChar) {
      populateFromExisting(firstChar);
    } else {
      // 初期状態: 未実装入力モードで1回計算して見本を表示
      resetToUnimplemented();
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
