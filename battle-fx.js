/* 英語物語 実機エフェクト再生エンジン
   APK のプレハブ(ParticleSystem / ParticleSystemRenderer / SpriteRenderer / Material)の値をそのまま使い、
   Unity Shuriken の挙動(スケーリングモード・シミュレーション空間・各モジュール)と
   実機シェーダー(頂点色×マテリアル色×テクスチャ、ブレンド係数)を WebGL で再現する。
   座標はすべて Unity のワールド単位。画面へは px/ワールド単位(ppw) で写像する。 */
(function () {
  const FX = window.FXDATA;
  if (!FX) return;
  const rnd = Math.random;
  const PI = Math.PI;

  /* ---------- カーブ・グラデーション(Unity と同じ評価) ---------- */
  function curve(c, t) {
    const n = c ? c.length : 0;
    if (!n) return 1;
    if (n === 1 || t <= c[0][0]) return c[0][1];
    if (t >= c[n - 1][0]) return c[n - 1][1];
    let i = 0;
    while (i < n - 2 && t > c[i + 1][0]) i++;
    const a = c[i], b = c[i + 1], dt = b[0] - a[0];
    if (dt <= 0) return b[1];
    const u = (t - a[0]) / dt, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * a[1] + (u3 - 2 * u2 + u) * dt * a[3] + (-2 * u3 + 3 * u2) * b[1] + (u3 - u2) * dt * b[2];
  }
  /* MinMaxCurve: m=0 定数 / 1 カーブ / 2 2カーブ間ランダム / 3 2定数間ランダム */
  function ev(p, t, r) {
    if (!p) return 0;
    switch (p.m) {
      case 0: return p.s;
      case 1: return p.s * curve(p.c, t);
      case 2: { const lo = curve(p.c2, t), hi = curve(p.c, t); return p.s * (lo + (hi - lo) * r); }
      case 3: return p.n + (p.s - p.n) * r;
    }
    return p.s;
  }
  function gradAt(g, t, o) {
    const c = g.c, a = g.a;
    if (c && c.length) {
      if (g.mode === 1) { let k = c[0]; for (const x of c) if (t >= x[0]) k = x; o[0] = k[1]; o[1] = k[2]; o[2] = k[3]; }
      else if (t <= c[0][0]) { o[0] = c[0][1]; o[1] = c[0][2]; o[2] = c[0][3]; }
      else if (t >= c[c.length - 1][0]) { const k = c[c.length - 1]; o[0] = k[1]; o[1] = k[2]; o[2] = k[3]; }
      else for (let i = 0; i < c.length - 1; i++) { const k0 = c[i], k1 = c[i + 1]; if (t <= k1[0]) { const u = (t - k0[0]) / ((k1[0] - k0[0]) || 1e-6); o[0] = k0[1] + (k1[1] - k0[1]) * u; o[1] = k0[2] + (k1[2] - k0[2]) * u; o[2] = k0[3] + (k1[3] - k0[3]) * u; break; } }
    } else { o[0] = o[1] = o[2] = 1; }
    if (a && a.length) {
      if (g.mode === 1) { let k = a[0]; for (const x of a) if (t >= x[0]) k = x; o[3] = k[1]; }
      else if (t <= a[0][0]) o[3] = a[0][1];
      else if (t >= a[a.length - 1][0]) o[3] = a[a.length - 1][1];
      else for (let i = 0; i < a.length - 1; i++) { const k0 = a[i], k1 = a[i + 1]; if (t <= k1[0]) { const u = (t - k0[0]) / ((k1[0] - k0[0]) || 1e-6); o[3] = k0[1] + (k1[1] - k0[1]) * u; break; } }
    } else o[3] = 1;
  }
  const tmpA = [0, 0, 0, 0], tmpB = [0, 0, 0, 0];
  function evc(p, t, r, o) {
    if (!p) { o[0] = o[1] = o[2] = o[3] = 1; return; }
    switch (p.m) {
      case 0: o[0] = p.c[0]; o[1] = p.c[1]; o[2] = p.c[2]; o[3] = p.c[3]; return;
      case 1: gradAt(p.g, t, o); return;
      case 2: for (let i = 0; i < 4; i++) o[i] = p.c[i] + (p.c2[i] - p.c[i]) * r; return;
      case 3: gradAt(p.g, t, tmpA); gradAt(p.g2, t, tmpB); for (let i = 0; i < 4; i++) o[i] = tmpB[i] + (tmpA[i] - tmpB[i]) * r; return;
      case 4: gradAt(p.g, r, o); return;
    }
    o[0] = o[1] = o[2] = o[3] = 1;
  }

  /* ---------- 3D 変換(列ベクトル、3x3 + 平行移動) ---------- */
  function qmat(q) {
    const [x, y, z, w] = q;
    return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
      2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
      2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)]; // 列優先 (col0, col1, col2)
  }
  const mv = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
  const mtv = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
  function mm3(a, b) { const o = new Array(9); for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2]; return o; }
  // Unity のオイラー角(度)は Z→X→Y の順に適用
  function eulerMat(e) {
    const r = PI / 180, cx = Math.cos(e[0] * r), sx = Math.sin(e[0] * r), cy = Math.cos(e[1] * r), sy = Math.sin(e[1] * r), cz = Math.cos(e[2] * r), sz = Math.sin(e[2] * r);
    const X = [1, 0, 0, 0, cx, sx, 0, -sx, cx], Y = [cy, 0, -sy, 0, 1, 0, sy, 0, cy], Z = [cz, sz, 0, -sz, cz, 0, 0, 0, 1];
    return mm3(Y, mm3(X, Z));
  }
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 1]; };
  function randUnit() { const z = rnd() * 2 - 1, a = rnd() * 2 * PI, s = Math.sqrt(1 - z * z); return [s * Math.cos(a), s * Math.sin(a), z]; }

  /* ---------- 形状モジュール ---------- */
  function shapeSample(S) {
    let p, d;
    const R = S.radius, th = S.thick, arc = (S.arc || 360) * PI / 180;
    switch (S.type) {
      case 0: case 1: { // Sphere
        d = randUnit(); const r = R * (1 - th + th * Math.cbrt(rnd())); p = [d[0] * r, d[1] * r, d[2] * r]; break; }
      case 2: case 3: { // Hemisphere(+Z)
        d = randUnit(); d[2] = Math.abs(d[2]); const r = R * (1 - th + th * Math.cbrt(rnd())); p = [d[0] * r, d[1] * r, d[2] * r]; break; }
      case 4: case 7: { // Cone(底面から)
        const a = rnd() * arc, f = (1 - th) + th * Math.sqrt(rnd()), r = R * f, ca = Math.cos(a), sa = Math.sin(a);
        const ang = S.angle * PI / 180;
        p = [ca * r, sa * r, 0];
        d = norm([ca * Math.sin(ang) * f, sa * Math.sin(ang) * f, Math.cos(ang)]);
        if (S.type === 7) { const l = S.len * rnd(); p = [p[0] + d[0] * l, p[1] + d[1] * l, p[2] + d[2] * l]; }
        break; }
      case 5: case 13: case 14: { // Box
        p = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]; d = [0, 0, 1]; break; }
      case 8: case 9: { // Circle(XY 平面、放射方向)
        const a = rnd() * arc, f = S.type === 9 ? 1 : (1 - th) + th * Math.sqrt(rnd()), ca = Math.cos(a), sa = Math.sin(a);
        p = [ca * R * f, sa * R * f, 0]; d = [ca, sa, 0]; break; }
      case 10: { // Edge(X 軸方向の線、+Y へ)
        p = [(rnd() * 2 - 1) * R, 0, 0]; d = [0, 1, 0]; break; }
      case 15: { // Donut
        const a = rnd() * arc, b = rnd() * 2 * PI, rr = S.donut * Math.sqrt(rnd());
        const c = [Math.cos(a) * R, Math.sin(a) * R, 0], n = [Math.cos(a) * Math.cos(b), Math.sin(a) * Math.cos(b), Math.sin(b)];
        p = [c[0] + n[0] * rr, c[1] + n[1] * rr, c[2] + n[2] * rr]; d = n; break; }
      case 16: case 17: { p = [rnd() - 0.5, rnd() - 0.5, 0]; d = [0, 0, 1]; break; }
      default: { d = randUnit(); p = [0, 0, 0]; }
    }
    // 形状自身の位置・回転・スケール
    const sc = S.scl || [1, 1, 1];
    p = [p[0] * sc[0], p[1] * sc[1], p[2] * sc[2]];
    if (S.rot && (S.rot[0] || S.rot[1] || S.rot[2])) { const M = eulerMat(S.rot); p = mv(M, p); d = mv(M, d); }
    if (S.pos) p = [p[0] + S.pos[0], p[1] + S.pos[1], p[2] + S.pos[2]];
    if (S.sdir > 0) { const o = norm([p[0] - (S.pos ? S.pos[0] : 0), p[1] - (S.pos ? S.pos[1] : 0), p[2] - (S.pos ? S.pos[2] : 0)]); d = norm([d[0] + (o[0] - d[0]) * S.sdir, d[1] + (o[1] - d[1]) * S.sdir, d[2] + (o[2] - d[2]) * S.sdir]); }
    if (S.rdir > 0) { const o = randUnit(); d = norm([d[0] + (o[0] - d[0]) * S.rdir, d[1] + (o[1] - d[1]) * S.rdir, d[2] + (o[2] - d[2]) * S.rdir]); }
    if (S.rpos > 0) { const o = randUnit(), k = S.rpos * rnd(); p = [p[0] + o[0] * k, p[1] + o[1] * k, p[2] + o[2] * k]; }
    return { p, d: norm(d) };
  }

  /* ---------- WebGL ---------- */
  let gl = null, cv = null, prog = null, buf = null, loc = {}, texCache = {}, insts = [], raf = 0, lastT = 0, view = null;
  const VS = "attribute vec2 p;attribute vec2 u;attribute vec4 c;uniform vec2 R;varying vec2 vu;varying vec4 vc;void main(){vu=u;vc=c;gl_Position=vec4(p.x/R.x*2.-1.,1.-p.y/R.y*2.,0.,1.);}";
  // 実機シェーダー: out = tex * (頂点色 * K)  (Premultiply は さらに ×頂点色.a)
  const FS = "precision mediump float;uniform sampler2D T;uniform float H;uniform vec4 K;uniform float P;varying vec2 vu;varying vec4 vc;void main(){vec4 t=H>.5?texture2D(T,vu):vec4(1.);vec4 c=vc*K;vec4 o=t*c;if(P>.5)o*=c.a;gl_FragColor=o;}";
  function sh(t, s) { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; }
  function initGL() {
    cv = document.createElement("canvas");
    cv.style.cssText = "position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483000";
    gl = cv.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl) { cv = null; return false; }
    prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog);
    loc = { p: gl.getAttribLocation(prog, "p"), u: gl.getAttribLocation(prog, "u"), c: gl.getAttribLocation(prog, "c"), R: gl.getUniformLocation(prog, "R"), T: gl.getUniformLocation(prog, "T"), H: gl.getUniformLocation(prog, "H"), K: gl.getUniformLocation(prog, "K"), P: gl.getUniformLocation(prog, "P") };
    buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    return true;
  }
  function getTex(id) {
    if (texCache[id]) return texCache[id];
    const t = gl.createTexture(), o = (texCache[id] = { t, ok: false });
    const img = new Image();
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      o.ok = true;
    };
    img.src = "data:image/png;base64," + FX.tex[id];
    return o;
  }
  function preload() { if (!gl) return; for (let i = 0; i < FX.tex.length; i++) getTex(i); }
  function resize() {
    const d = Math.min(window.devicePixelRatio || 1, 2), w = innerWidth, h = innerHeight;
    if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
    cv.style.width = w + "px"; cv.style.height = h + "px";   // スマホでは 100vh がアドレスバー分だけ innerHeight より大きく、効果の位置がずれるため
    gl.viewport(0, 0, cv.width, cv.height); gl.uniform2f(loc.R, w, h);
  }
  // Unity BlendMode → WebGL(背景ページへの合成を考慮し、α チャンネルは別扱い)
  function setBlend(src, dst) {
    const G = gl, map = { 0: G.ZERO, 1: G.ONE, 2: G.DST_COLOR, 3: G.SRC_COLOR, 4: G.ONE_MINUS_DST_COLOR, 5: G.SRC_ALPHA, 6: G.ONE_MINUS_SRC_COLOR, 7: G.DST_ALPHA, 8: G.ONE_MINUS_DST_ALPHA, 9: G.SRC_ALPHA_SATURATE, 10: G.ONE_MINUS_SRC_ALPHA };
    const s = map[src] ?? G.SRC_ALPHA, d = map[dst] ?? G.ONE_MINUS_SRC_ALPHA;
    if (dst === 1) G.blendFuncSeparate(s, d, G.ZERO, G.ONE); // 加算: 背景の不透明度は変えない
    else G.blendFuncSeparate(s, d, G.ONE, G.ONE_MINUS_SRC_ALPHA);
  }

  /* ---------- ノード(プレハブ内の GameObject) ---------- */
  function makeNode(n, parent, inst) {
    const o = { d: n, parent, inst, ch: [], parts: [], t: 0, acc: 0, playing: false, emitting: false, started: false, done: true, active: n.act !== false, alpha: 1 };
    o.lq = qmat(n.q); o.ls = n.s;
    const ps = n.ps;
    if (ps) {
      o.playing = !!ps.awake; o.emitting = o.playing; o.done = !o.playing;
      o.delay = ev(ps.delay, 0, rnd());
      o.bursts = (ps.bursts || []).map((b) => ({ next: b.t, cyc: 0 }));
      o.isSub = false;
    }
    o.ch = (n.ch || []).map((c) => makeNode(c, o, inst));
    return o;
  }
  function forEach(nd, f) { f(nd); nd.ch.forEach((c) => forEach(c, f)); }
  // ワールド変換(R: 回転のみ, L: lossy スケール, T: 位置)
  function updateXform(nd, P) {
    const n = nd.d;
    const pl = [n.p[0] * P.L[0], n.p[1] * P.L[1], n.p[2] * P.L[2]];
    const pw = mv(P.R, pl);
    nd.T = [P.T[0] + pw[0], P.T[1] + pw[1], P.T[2] + pw[2]];
    nd.R = mm3(P.R, nd.lq);
    nd.L = [P.L[0] * n.s[0], P.L[1] * n.s[1], P.L[2] * n.s[2]];
    nd.ch.forEach((c) => updateXform(c, nd));
  }
  function scalesOf(nd) {
    const ps = nd.d.ps;
    if (ps.scaling === 0) return { spawn: nd.L, size: (Math.abs(nd.L[0]) + Math.abs(nd.L[1])) / 2, move: nd.L };
    if (ps.scaling === 1) return { spawn: nd.ls, size: (Math.abs(nd.ls[0]) + Math.abs(nd.ls[1])) / 2, move: nd.ls };
    return { spawn: nd.L, size: 1, move: [1, 1, 1] };
  }

  function emit(nd, tn, at) {
    const ps = nd.d.ps;
    if (nd.parts.length >= ps.max) return null;
    const sc = scalesOf(nd);
    const sp = ps.shape ? shapeSample(ps.shape) : { p: [0, 0, 0], d: [0, 0, 1] };
    const q = { age: 0, r: [rnd(), rnd(), rnd(), rnd(), rnd(), rnd(), rnd(), rnd()] };
    q.life = Math.max(1e-3, ev(ps.life, tn, q.r[0]));
    const spd = ev(ps.speed, tn, q.r[1]);
    let p = [sp.p[0] * sc.spawn[0], sp.p[1] * sc.spawn[1], sp.p[2] * sc.spawn[2]];
    let v = [sp.d[0] * spd * sc.move[0], sp.d[1] * spd * sc.move[1], sp.d[2] * spd * sc.move[2]];
    if (at) p = [p[0] + at[0], p[1] + at[1], p[2] + at[2]];
    q.sz = ev(ps.size, tn, q.r[2]) * sc.size;
    q.szy = ps.size3d ? ev(ps.sizey, tn, q.r[2]) * sc.size : q.sz;
    q.rot = ev(ps.rot, tn, q.r[3]);
    q.rsign = rnd() < (ps.rdir || 0) ? -1 : 1;
    q.rot *= q.rsign;
    if (ps.rot3d) { q.rx = ev(ps.rotx, tn, q.r[3]); q.ry = ev(ps.roty, tn, q.r[3]); }
    q.c0 = [1, 1, 1, 1]; evc(ps.color, tn, q.r[4], q.c0);
    if (ps.space === 1) { // ワールド空間
      const pw = mv(nd.R, p); q.p = [nd.T[0] + pw[0], nd.T[1] + pw[1], nd.T[2] + pw[2]]; q.v = mv(nd.R, v); q.world = true;
    } else { q.p = p; q.v = v; q.world = false; }
    q.flipU = rnd() < (nd.d.r ? nd.d.r.flip[0] : 0); q.flipV = rnd() < (nd.d.r ? nd.d.r.flip[1] : 0);
    if (ps.uv) { q.sf = ev(ps.uv.sf, tn, q.r[5]); q.row = ps.uv.rowMode === 1 ? Math.floor(rnd() * ps.uv.ty) : ps.uv.row; }
    nd.parts.push(q);
    if (ps.sub) for (const s of ps.sub) if (s.type === 0) fireSub(nd, s, q);
    return q;
  }
  function worldPos(nd, q) { if (q.world) return q.p; const w = mv(nd.R, q.p); return [nd.T[0] + w[0], nd.T[1] + w[1], nd.T[2] + w[2]]; }
  function fireSub(nd, s, q) {
    if (s.node == null || rnd() > (s.prob ?? 1)) return;
    let target = null; forEach(nd.inst.root, (x) => { if (x.d.id === s.node) target = x; });
    if (!target || !target.d.ps) return;
    const ps = target.d.ps, wp = worldPos(nd, q);
    target.isSub = true;
    // サブエミッタ: 親粒子の位置でバーストを発生(ローカル空間は emitter 原点からの相対へ変換)
    const at = target.d.ps.space === 1 ? null : mtv(target.R, [wp[0] - target.T[0], wp[1] - target.T[1], wp[2] - target.T[2]]);
    const n = (ps.bursts || []).reduce((a, b) => a + Math.round(ev(b.n, 0, rnd())), 0) || Math.max(1, Math.round(ev(ps.rate, 0, rnd()) * ps.dur));
    for (let i = 0; i < n; i++) {
      const p = emit(target, 0, at);
      if (p && target.d.ps.space === 1) { p.p = [p.p[0] - target.T[0] + wp[0], p.p[1] - target.T[1] + wp[1], p.p[2] - target.T[2] + wp[2]]; }
    }
  }

  function stepPS(nd, dt) {
    const ps = nd.d.ps;
    const sdt = dt * (ps.simspeed || 1);
    if (nd.playing && nd.active && !nd.isSub) {
      nd.t += sdt;
      const t = nd.t - nd.delay;
      if (t >= 0) {
        if (!nd.started) { nd.started = true; if (ps.pre && ps.loop) prewarm(nd); }
        const dur = ps.dur || 1, loopT = ps.loop ? t % dur : Math.min(t, dur), tn = loopT / dur;
        if (nd.emitting && (ps.loop || t <= dur + 1e-6)) {
          if (ps.rate) {
            // ループの周回ごとに発生の端数は持ち越さない(実機: 周期0.1秒・毎秒2個のような設定は発生しない)
            const cyc = ps.loop ? Math.floor(t / dur) : 0;
            if (nd.cyc !== cyc) { nd.cyc = cyc; nd.acc = 0; }
            nd.acc += ev(ps.rate, tn, rnd()) * Math.min(sdt, t + 1e-6); while (nd.acc >= 1) { nd.acc -= 1; emit(nd, tn); }
          }
          (ps.bursts || []).forEach((b, i) => {
            const B = nd.bursts[i];
            const cyc = b.cy > 0 ? b.cy : Infinity;
            // ループ時は周回ごとに先頭へ
            const base = ps.loop ? Math.floor(t / dur) * dur : 0;
            if (ps.loop && B.loopBase !== base) { B.loopBase = base; B.next = base + b.t; B.cyc = 0; }
            while (B.cyc < cyc && t >= B.next) {
              if (rnd() <= b.p) { const n = Math.round(ev(b.n, tn, rnd())); for (let k = 0; k < n; k++) emit(nd, tn); }
              B.cyc++; B.next += Math.max(b.iv, 1e-3);
            }
          });
        }
        if (!ps.loop && t > dur) nd.emitting = false;
      }
    }
    // 粒子の更新
    const g = 9.81, gm = ps.grav;
    for (let i = nd.parts.length - 1; i >= 0; i--) {
      const q = nd.parts[i];
      q.age += sdt;
      if (q.age >= q.life) { if (ps.sub) for (const s of ps.sub) if (s.type === 2) fireSub(nd, s, q); nd.parts.splice(i, 1); continue; }
      const lt = q.age / q.life;
      // 重力(ワールド -Y)
      const gv = ev(gm, nd.started ? Math.min(1, (nd.t - nd.delay) / (ps.dur || 1)) : 0, q.r[6]);
      if (gv) { const gw = [0, -g * gv * sdt, 0]; const gl_ = q.world ? gw : mtv(nd.R, gw); q.v[0] += gl_[0]; q.v[1] += gl_[1]; q.v[2] += gl_[2]; }
      // 力
      if (ps.force) {
        const f = ps.force, rr = f.rpf ? rnd() : q.r[7];
        let fv = [ev(f.x, lt, rr) * sdt, ev(f.y, lt, rr) * sdt, ev(f.z, lt, rr) * sdt];
        if (f.w && !q.world) fv = mtv(nd.R, fv); else if (!f.w && q.world) fv = mv(nd.R, fv);
        q.v[0] += fv[0]; q.v[1] += fv[1]; q.v[2] += fv[2];
      }
      // 速度制限(減衰)
      if (ps.limit && !ps.limit.sep) {
        const lim = ev(ps.limit.mag, lt, q.r[5]), sp = Math.hypot(q.v[0], q.v[1], q.v[2]);
        if (sp > lim && sp > 0) { const k = 1 - Math.pow(1 - ps.limit.damp, sdt * 30), ns = sp - (sp - lim) * k; q.v = [q.v[0] / sp * ns, q.v[1] / sp * ns, q.v[2] / sp * ns]; }
      }
      // 速度(経時変化: 加算、積分しない)
      let vx = q.v[0], vy = q.v[1], vz = q.v[2];
      if (ps.vel) {
        const V = ps.vel; let a = [ev(V.x, lt, q.r[5]), ev(V.y, lt, q.r[5]), ev(V.z, lt, q.r[5])];
        if (V.w && !q.world) a = mtv(nd.R, a); else if (!V.w && q.world) a = mv(nd.R, a);
        const rad = V.radial ? ev(V.radial, lt, q.r[5]) : 0;
        if (rad) { const o = norm(q.world ? [q.p[0] - nd.T[0], q.p[1] - nd.T[1], q.p[2] - nd.T[2]] : q.p); a = [a[0] + o[0] * rad, a[1] + o[1] * rad, a[2] + o[2] * rad]; }
        const smod = V.sm ? ev(V.sm, lt, q.r[5]) : 1;
        vx = (vx + a[0]) * smod; vy = (vy + a[1]) * smod; vz = (vz + a[2]) * smod;
      }
      q.p = [q.p[0] + vx * sdt, q.p[1] + vy * sdt, q.p[2] + vz * sdt];
      q.cv = [vx, vy, vz];
      if (ps.rotOL) q.rot += ev(ps.rotOL, lt, q.r[3]) * q.rsign * sdt;
    }
    if (!nd.emitting && nd.parts.length === 0 && (nd.started || !nd.playing)) nd.done = true; else if (nd.playing || nd.parts.length) nd.done = false;
  }
  function prewarm(nd) {
    const ps = nd.d.ps, step = 1 / 30;
    for (let t = 0; t < ps.dur; t += step) { const save = nd.t; stepPS(nd, step); }
  }

  /* ---------- 描画 ---------- */
  let vbuf = new Float32Array(8 * 6 * 512);
  const col = [1, 1, 1, 1], ctmp = [1, 1, 1, 1];
  // インスタンスの原点はページ座標。描画時に現在のスクロール量を引いて画面座標にする
  function toScreen(I, w) { return [I.ox + w[0] * I.ppw - scrollX, I.oy - w[1] * I.ppw - scrollY]; }
  function pushQuad(n, P, R_, G_, B_, A_) { for (const j of [0, 1, 2, 0, 2, 3]) { const a = P[j]; vbuf[n++] = a[0]; vbuf[n++] = a[1]; vbuf[n++] = a[2]; vbuf[n++] = a[3]; vbuf[n++] = R_; vbuf[n++] = G_; vbuf[n++] = B_; vbuf[n++] = A_; } return n; }
  function collect(nd, list) {
    if (!nd.active) return;
    const r = nd.d.r;
    if (nd.d.ps && r && r.en && nd.parts.length) list.push({ nd, kind: "ps", layer: r.layer || 0, order: r.order || 0, z: nd.T[2] - (r.fudge || 0) * 0.001, seq: list.length });
    if (nd.d.spr && nd.d.spr.en && nd.d.spr.tex != null) list.push({ nd, kind: "spr", layer: 0, order: nd.d.spr.order || 0, z: nd.T[2], seq: list.length });
    nd.ch.forEach((c) => collect(c, list));
  }
  function drawPS(I, nd) {
    const ps = nd.d.ps, r = nd.d.r;
    if (r.mode === 2) return; // 水平ビルボードは正射影カメラでは見えない
    const need = nd.parts.length * 48 * (r.mode === 4 && FX.mesh[r.mesh] ? FX.mesh[r.mesh].f.length : 1);
    if (vbuf.length < need) vbuf = new Float32Array(need * 2);
    let n = 0;
    const viewH = 2 * I.ppw; // 実機のビューポート高さ(正射影サイズ1 → 2ワールド単位)
    let order = nd.parts;
    if (r.sort === 2) order = [...nd.parts].sort((a, b) => b.age - a.age);
    else if (r.sort === 3) order = [...nd.parts].sort((a, b) => a.age - b.age);
    for (const q of order) {
      const lt = q.age / q.life;
      const w = worldPos(nd, q);
      let k = 1, ky = 1;
      if (ps.sizeOL) { k = ev(ps.sizeOL.x, lt, q.r[2]); ky = ps.sizeOL.sep && ps.sizeOL.y ? ev(ps.sizeOL.y, lt, q.r[2]) : k; }
      const speed = Math.hypot(q.cv ? q.cv[0] : 0, q.cv ? q.cv[1] : 0, q.cv ? q.cv[2] : 0);
      if (ps.sizeBS) { const u = Math.min(1, Math.max(0, (speed - ps.sizeBS.r[0]) / ((ps.sizeBS.r[1] - ps.sizeBS.r[0]) || 1))); k *= ev(ps.sizeBS.x, u, q.r[2]); ky *= ev(ps.sizeBS.x, u, q.r[2]); }
      let wpx = q.sz * k * I.ppw, hpx = q.szy * ky * I.ppw;
      const maxPx = (r.maxS ?? 0.5) * viewH, minPx = (r.minS || 0) * viewH;
      if (wpx > maxPx) { hpx *= maxPx / wpx; wpx = maxPx; } if (wpx < minPx) wpx = minPx; if (hpx > maxPx) hpx = maxPx;
      col[0] = q.c0[0]; col[1] = q.c0[1]; col[2] = q.c0[2]; col[3] = q.c0[3];
      if (ps.colOL) { evc(ps.colOL, lt, q.r[4], ctmp); for (let i = 0; i < 4; i++) col[i] *= ctmp[i]; }
      if (ps.colBS) { const u = Math.min(1, Math.max(0, (speed - ps.colBS.r[0]) / ((ps.colBS.r[1] - ps.colBS.r[0]) || 1))); evc(ps.colBS.g, u, q.r[4], ctmp); for (let i = 0; i < 4; i++) col[i] *= ctmp[i]; }
      const A_ = col[3] * I.alpha * nd.alpha;
      if (A_ <= 0.002 || wpx < 0.05) continue;
      const [cx, cy] = toScreen(I, w);
      // UV(テクスチャシート)
      let u0 = 0, v0 = 0, u1 = 1, v1 = 1;
      if (ps.uv && ps.uv.mode === 0 && (ps.uv.tx > 1 || ps.uv.ty > 1)) {
        const U = ps.uv, tx = U.tx, ty = U.ty, total = U.anim === 1 ? tx : tx * ty;
        let f = (ev(U.fot, (lt * (U.cycles || 1)) % 1, q.r[5]) + (q.sf || 0));
        f = Math.floor(f) % total; if (f < 0) f += total;
        const c_ = f % tx, rw = U.anim === 1 ? q.row : Math.floor(f / tx);
        u0 = c_ / tx; u1 = (c_ + 1) / tx; v0 = rw / ty; v1 = (rw + 1) / ty;
      }
      if (r.st) { // _MainTex の Tiling/Offset(テクスチャは上が v=0 で格納)
        const sx = r.st[0], sy = r.st[1], ox = r.st[2], oy = r.st[3];
        const fu = (u) => u * sx + ox, fv = (v) => 1 - ((1 - v) * sy + oy);
        u0 = fu(u0); u1 = fu(u1); v0 = fv(v0); v1 = fv(v1);
      }
      if (q.flipU) { const t_ = u0; u0 = u1; u1 = t_; }
      if (q.flipV) { const t_ = v0; v0 = v1; v1 = t_; }
      if (r.mode === 4 && FX.mesh[r.mesh]) { // メッシュ粒子(XY 投影)
        const M = FX.mesh[r.mesh], ca = Math.cos(q.rot), sa = Math.sin(q.rot);
        const Rm = q.rx != null ? eulerMat([q.rx * 180 / PI, q.ry * 180 / PI, q.rot * 180 / PI]) : [ca, sa, 0, -sa, ca, 0, 0, 0, 1];
        const R2 = nd.d.ps.space === 1 ? Rm : mm3(nd.R, Rm);
        for (const f of M.f) {
          for (const vi of f) {
            const vv = M.v[vi], vt = M.t[vi] || [0, 0];
            const s = mv(R2, [-vv[0] * q.sz * k, vv[1] * q.szy * ky, vv[2] * q.sz * k]);
            vbuf[n++] = cx + s[0] * I.ppw; vbuf[n++] = cy - s[1] * I.ppw; vbuf[n++] = vt[0]; vbuf[n++] = 1 - vt[1];
            vbuf[n++] = col[0]; vbuf[n++] = col[1]; vbuf[n++] = col[2]; vbuf[n++] = A_;
          }
        }
        continue;
      }
      let ax, ay, bx, by, ccx = cx, ccy = cy;
      if (r.mode === 1) { // ストレッチビルボード: 進行方向へ伸ばす(先端が粒子位置)
        const vw = q.world ? q.cv : mv(nd.R, q.cv || [0, 0, 0]);
        const sx_ = vw[0], sy_ = -vw[1], sl = Math.hypot(sx_, sy_);
        const L = wpx * (r.len || 0) + Math.hypot(vw[0], vw[1], vw[2]) * (r.vel || 0) * I.ppw;
        const dx = sl > 1e-6 ? sx_ / sl : 1, dy = sl > 1e-6 ? sy_ / sl : 0;
        ccx = cx - dx * L / 2; ccy = cy - dy * L / 2;
        ax = dx * L / 2; ay = dy * L / 2; bx = -dy * hpx / 2; by = dx * hpx / 2;
        const P = [[ccx - ax - bx, ccy - ay - by, u0, v1], [ccx + ax - bx, ccy + ay - by, u1, v1], [ccx + ax + bx, ccy + ay + by, u1, v0], [ccx - ax + bx, ccy - ay + by, u0, v0]];
        n = pushQuad(n, P, col[0], col[1], col[2], A_);
        continue;
      }
      // ビルボード(正の回転は画面上で時計回り)
      const ang = q.rot + (r.align === 1 ? 0 : 0), cs = Math.cos(ang), sn = Math.sin(ang);
      const hx = wpx / 2, hy = hpx / 2;
      const pvx = (r.pivot ? r.pivot[0] : 0) * wpx, pvy = -(r.pivot ? r.pivot[1] : 0) * hpx;
      ccx = cx + pvx * cs - pvy * sn; ccy = cy + pvx * sn + pvy * cs;
      ax = cs * hx; ay = sn * hx; bx = -sn * hy; by = cs * hy;
      const P = [[ccx - ax - bx, ccy - ay - by, u0, v0], [ccx + ax - bx, ccy + ay - by, u1, v0], [ccx + ax + bx, ccy + ay + by, u1, v1], [ccx - ax + bx, ccy - ay + by, u0, v1]];
      n = pushQuad(n, P, col[0], col[1], col[2], A_);
    }
    if (!n) return;
    flush(n, r.tex, r.blend || [5, 10], r.K || [1, 1, 1, 1], r.pma);
  }
  function drawSprite(I, nd) {
    const s = nd.d.spr, tex = getTex(s.tex); if (!tex.ok) return;
    const w = nd.T, [cx, cy] = toScreen(I, w);
    const wpx = s.w * Math.abs(nd.L[0]) * I.ppw, hpx = s.h * Math.abs(nd.L[1]) * I.ppw;
    const x0 = cx - s.pivot[0] * wpx, y0 = cy - (1 - s.pivot[1]) * hpx;
    const P = [[x0, y0, 0, 0], [x0 + wpx, y0, 1, 0], [x0 + wpx, y0 + hpx, 1, 1], [x0, y0 + hpx, 0, 1]];
    const A_ = s.color[3] * (nd.alpha ?? 1) * I.alpha;
    if (A_ <= 0.002) return;
    const n = pushQuad(0, P, s.color[0], s.color[1], s.color[2], A_);
    flush(n, s.tex, [5, 10], [1, 1, 1, 1], false);
  }
  function flush(n, texId, blend, K, pma) {
    const tex = texId != null ? getTex(texId) : null;
    if (tex && !tex.ok) return;
    if (tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex.t); gl.uniform1i(loc.T, 0); }
    gl.uniform1f(loc.H, tex ? 1 : 0); gl.uniform4f(loc.K, K[0], K[1], K[2], K[3]); gl.uniform1f(loc.P, pma ? 1 : 0);
    setBlend(blend[0], blend[1]);
    gl.bufferData(gl.ARRAY_BUFFER, vbuf.subarray(0, n), gl.STREAM_DRAW);
    gl.enableVertexAttribArray(loc.p); gl.enableVertexAttribArray(loc.u); gl.enableVertexAttribArray(loc.c);
    gl.vertexAttribPointer(loc.p, 2, gl.FLOAT, false, 32, 0); gl.vertexAttribPointer(loc.u, 2, gl.FLOAT, false, 32, 8); gl.vertexAttribPointer(loc.c, 4, gl.FLOAT, false, 32, 16);
    gl.drawArrays(gl.TRIANGLES, 0, n / 8);
  }

  /* ---------- インスタンス ---------- */
  function stepInst(I, dt) {
    I.age += dt;
    // 移動はワールド座標で行う(ワールド空間の粒子が軌跡として残るように、画面上の原点は固定)
    if (I.pathFn) { const p = I.pathFn(I.age); I.wx = (p.x - I.ox) / I.ppw; I.wy = -(p.y - I.oy) / I.ppw; }
    if (I.anim) I.anim(I, I.age);
    updateXform(I.root, { T: [I.wx || 0, I.wy || 0, 0], R: [1, 0, 0, 0, 1, 0, 0, 0, 1], L: [I.scale, I.scale, I.scale] });
    forEach(I.root, (nd) => { if (nd.d.ps && nd.active) stepPS(nd, dt); });
  }
  function instDone(I) { let d = true; forEach(I.root, (nd) => { if (nd.d.ps && (!nd.done || nd.parts.length)) d = false; }); return d; }
  let manual = false;
  function frame(ts, fixedDt) {
    raf = 0; if (!gl) return;
    const dt = fixedDt != null ? fixedDt : Math.min(0.05, lastT ? (ts - lastT) / 1000 : 1 / 60); lastT = ts;
    resize(); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    for (let i = insts.length - 1; i >= 0; i--) {
      const I = insts[i];
      if (I.wait > 0) { I.wait -= dt; continue; }
      stepInst(I, dt);
      if (I.life != null && I.age >= I.life) { insts.splice(i, 1); I.onEnd && I.onEnd(); continue; } // EffectController.AutoDelete(即消去)
      if (I.life == null && I.age > 0.1 && instDone(I) && !I.hold) { insts.splice(i, 1); I.onEnd && I.onEnd(); }
    }
    // 描画順: ソートレイヤー → オーダー → 奥(z大)から
    const list = [];
    for (const I of insts) if (!(I.wait > 0)) { const l = []; collect(I.root, l); for (const e of l) { e.I = I; list.push(e); } }
    list.sort((a, b) => a.layer - b.layer || a.order - b.order || b.z - a.z || a.seq - b.seq);
    for (const e of list) { if (e.kind === "ps") drawPS(e.I, e.nd); else drawSprite(e.I, e.nd); }
    if (manual) return;
    if (insts.length) raf = requestAnimationFrame(frame); else { lastT = 0; if (cv && cv.parentNode) cv.remove(); }
  }

  /* ---------- 公開API ---------- */
  const API = {
    ok: () => !!FX && (gl || (gl === null && initGL() && (preload(), true))),
    has: (name) => !!FX.prefabs[name],
    /* name: プレハブ名 / x,y: 置く位置(ページ座標px = 画面座標 + スクロール量) / ppw: 1ワールド単位の画面px / scale: 親のlossyスケール(ワールド単位/ローカル単位)
       opt.wait: 開始まで秒 / opt.life: この秒数で消去(EffectController.lifeTime) / opt.path(t)→{x,y} / opt.anim(I,t) */
    play(name, x, y, ppw, scale, opt) {
      opt = opt || {};
      const pf = FX.prefabs[name]; if (!pf) return null;
      if (!API.ok()) return null;
      if (!cv.parentNode) document.body.append(cv);
      const I = { name, ox: x, oy: y, ppw, scale, age: 0, wait: opt.wait || 0, life: opt.life, pathFn: opt.path, anim: opt.anim, onEnd: opt.onEnd, alpha: 1, hold: !!opt.hold };
      I.root = makeNode(pf, null, I);
      insts.push(I); if (!raf && !manual) raf = requestAnimationFrame(frame);
      return I;
    },
    remove(I) { const i = insts.indexOf(I); if (i >= 0) insts.splice(i, 1); },
    move(I, x, y) { I.ox = x; I.oy = y; },
    node(I, path) { let f = null; forEach(I.root, (n) => { if (n.d.n === path) f = n; }); return f; },
    clear() { insts = []; if (cv && cv.parentNode) cv.remove(); if (raf) cancelAnimationFrame(raf); raf = 0; lastT = 0; },
    busy: () => insts.length > 0,
    names: () => Object.keys(FX.prefabs),
    /* 検証用: 時間を手動で進める */
    manual(on) { manual = !!on; if (raf) { cancelAnimationFrame(raf); raf = 0; } },
    advance(sec) { const n = Math.max(1, Math.round(sec * 60)); for (let i = 0; i < n; i++) frame(0, sec / n); },
  };
  window.EFX = API;
})();

