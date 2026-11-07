/* 図鑑(zukan_beta.json)→ 画面のキャラデータ(roster.json と同じ形)。eigo_battle/chardb.py の convert_char と同じ変換。
   分類(cat)は参考サイトの pickerCategoryParts と同じ規則(中分類が「伝」なら小分類なし・見出し=見出し||小分類)。 */
function zukanToRoster(zukan) {
  const ATTRS = ["火", "水", "風"];
  const parseAttr = (v) => (!v ? [] : v === "全" ? ATTRS.slice() : [...String(v)].filter((ch) => ATTRS.includes(ch)));
  const applier = (e) => {
    const a = e.applier;
    if (a === "自身") return ["self", null];
    if (a === "全員") return ["team", null];
    if (a === "リーダー") return ["leader", null];
    if (ATTRS.includes(a)) return ["team", a];
    const t = e.sourceText || "";   // applier 欠落は本文から補う
    if (t.includes("自身")) return ["self", null];
    if (t.includes("リーダー")) return ["leader", null];
    return ["team", null];
  };
  const fill = (e) => {   // effect/value 欄が欠けた行を本文から補う(「地震に集中させる」は「自身」の誤記と見なす)
    const t = e.sourceText || "", o = { ...e };
    if (o.effect == null) {
      if (t.includes("集中させる")) o.effect = t.includes("リーダー") ? "かわす" : "かばう";
      else if (t.includes("蘇らせる") || t.includes("甦らせる")) o.effect = "蘇生";
      else if (t.includes("シールド")) o.effect = "シールド";
      else return e;
    }
    if (o.value == null && o.effect !== "全体攻撃") { const m = t.match(/(\d+(?:\.\d+)?)%/); if (m) o.value = parseFloat(m[1]) / 100; }
    if (o.duration == null) { const m = t.match(/^(\d+)ターンの間/); if (m) o.duration = parseInt(m[1], 10); }
    const m = t.match(/(火|水|風)属性の(?:敵からの)?(?:ダメージ|攻撃)/);
    if (m && !o.target) o.target = m[1];
    if (o.effect === "蘇生" && o.applier == null && t.includes("味方全員")) o.applier = "全員";
    if ((o.effect === "かばう" || o.effect === "シールド") && o.applier == null) o.applier = "自身";
    return o;
  };
  const conv = (e) => {
    if (e.effect == null || (e.value == null && !["全体攻撃", "色変"].includes(e.effect))) e = fill(e);
    const kind = e.effect; if (kind == null) return null;
    const [scope, attr] = applier(e), v = e.value, turns = e.duration;
    const tgt = ATTRS.includes(e.target) ? e.target : null, base = turns != null ? { turns: parseInt(turns, 10) } : {};
    const vs = tgt ? { vs_attr: tgt } : {};
    const scoped = (kw) => ({ ...kw, scope, ...base, ...(attr ? { attr } : {}) });
    if (kind === "攻撃力アップ" && v != null) return scoped({ type: "atk_up", bonus: +v, ...vs });
    if (kind === "シールド" && v != null) return scoped({ type: "shield", cut: +v, ...vs });
    if (kind === "かばう" && v != null) return { type: "cover", cut: +v, scope: "self", ...base, ...vs };
    if (kind === "かわす" && v != null) return { type: "cover", cut: +v, scope: "leader", to_leader: true, ...base, ...vs };
    if (kind === "連撃" && v != null) return scoped({ type: "multi_attack", hits: parseInt(v, 10) });
    if (kind === "全体攻撃") return scoped({ type: "all_attack" });
    if (kind === "回復" && v != null) return scoped({ type: "heal", rate: +v });
    if (kind === "蘇生" && v != null) return scoped({ type: "revive", hp_rate: +v });
    if (kind === "短縮" && v != null) return scoped({ type: "shorten", amount: parseInt(v, 10) });
    if (kind === "遅延" && v != null) return { type: "delay", amount: parseInt(v, 10), scope: "team", ...(tgt ? { attr: tgt } : {}) };
    if (kind === "色変" && v != null) return scoped({ type: "color_change", to: parseAttr(String(v)) });
    return null;
  };
  const out = [], seen = new Set(), list = (zukan && zukan.characters) || [];
  list.forEach((rec, zi) => {
    const d = rec.details; if (!d) return;
    const id = d.id ?? rec.id; if (seen.has(id)) return; seen.add(id);
    const attrs = parseAttr(d.attribute);
    const c = { id, n: d.name ?? rec.name, a: attrs.join(""), attrs, cost: d.cost ?? 0, hp: d.hp ?? 1, pw: d.power ?? 1, r: d.rare ?? null };
    if (d.limitHp != null && d.limitPower != null) { c.lhp = d.limitHp; c.lpw = d.limitPower; }
    const ses = d.skillEffects;
    if (ses && ses.length) { const eff = conv(ses[0]); if (eff) c.sk = { name: d.skill || "", turn: parseInt(d.skillTurn || 0, 10), effects: [eff] }; }
    const L = rec.largeCategory || "未分類", M = rec.middleCategory || "その他";
    c.cat = M === "伝" ? [L, M, "__all__", rec.heading || rec.smallCategory || "その他"] : [L, M, rec.smallCategory || "その他", rec.heading || ""];
    c.zi = zi;
    out.push(c);
  });
  return out;
}
window.zukanToRoster = zukanToRoster;


