/**
 * glacier.js — Glacier（星舰冰川）设计语言的独立浏览器库
 *
 * 一盏灯，两个消费者（轨道游标、黑白底片探照灯遮罩），加一个把它们装到页面上的 init()：
 *   Glacier.sun          太阳模型：时间 → 位置（横跨整个视口的轨道）→ 光色与亮度；关键帧表 sampleTable / stateFromTable
 *   Glacier.Lamp         灯 overlay：柔光球 + 三色光谱轨迹弧 + 刻度 + 当前时间（静态层不随时间重建）
 *   Camera（内部）        运镜：弹簧借光 focus / 向心样条巡航 tour / 焦点租期；Instance 持有一个，自己只管钟、灯、手电
 *   Glacier.applySunVars 把底片探照灯坐标与微弱明度呼吸（--gl-sun-x / --gl-sun-y / --gl-sun-exposure）写到一个元素（通常是 body）上
 *   Glacier.init(options) 建画布、起太阳、画灯、鼠标手电（控件材质走 CSS 焊死的 1px 环 + 100% 100% at 0% 0% 归一化三色常量，零内联 --ice-*），
 *                         返回句柄 { setHour, setMode, setLoop, setSunTable, focus, tour, setBackground, setPhoto, relight, stop, destroy, sun … }
 *   Glacier.preloadPhoto(url) 提前取图并解码，之后 setPhoto 零等待
 *   挂上总线即受光：root 里新出现的 .gl-* 节点自动纳入（observe），会动的节点加 data-gl-track 逐帧跟着被手电探测
 *   两支手电：鼠标（快）和太阳（慢，轨道游标经过的砖被擦亮、800ms 暗回去）同一配方；Glacier.sun.tableFromPath / tableFromPoints 造任意轨道表
 *   纯光学运镜（导演接口）：data-gl-focus 属性监听 + glacier:light 窗口事件 + #gl-focus= 地址栏锚点 + focus() 二阶临界阻尼借光 + tour() 向心样条巡航
 *
 * 性能守则同 DESIGN.md §6：灯只在动了才重画、渐变缓存、同值不写、读写分离、滚动中不读布局。
 * 砖与卡片走 CSS 常量，零内联 --ice-* 变量，滚动、对表都不碰砖；measureRects 只给鼠标手电读一轮矩形。
 *
 * 只有一个全局：window.Glacier（CommonJS 环境下同时 module.exports）。除了 init() 创建的画布，
 * 不碰宿主没要求的任何元素；destroy() 把画布、监听器、变量全部收回。
 */
(function (global) {
  "use strict";
  const Glacier = {};

  // ==========================================================================
  // 1. 太阳模型
  // ==========================================================================
  // 轨迹（纯函数）：白天 05–19 点抛物线，06:00 左下边缘升起、正午顶部正中、18:00 右下落下；
  // 夜里 19–05 点低轨道从右走回左。两段在 05:00 / 19:00 处位置相同。
  const lampPointAt = (hour, W, H) => {
    const h = ((hour % 24) + 24) % 24;
    if (h >= 5 && h <= 19) {
      const u = (h - 12) / 7;
      return { x: W * (0.5 + 0.56 * u), y: H * (0.1 + 1.05 * u * u), u, isDay: true };
    }
    const nightH = h > 19 ? h - 24 : h;
    const u = -nightH / 5;
    return { x: W * (0.5 + 0.56 * u), y: H * (0.6 + 0.55 * u * u), u, isDay: false };
  };

  const COLOR_KEYS = ["orbCore", "orbCorona"]; // 只剩星核与日冕两色：其余逐帧颜色自第三刀砍掉 Scene 后再无消费者（第五刀）
  const parseColor = (c) => {
    if (typeof c !== "string") return null;
    const t = c.trim();
    let m = /^#([0-9a-f]{3,8})$/i.exec(t);
    if (m) {
      let hx = m[1];
      if (hx.length === 3 || hx.length === 4) hx = hx.split("").map((ch) => ch + ch).join("");
      const n = parseInt(hx.slice(0, 6), 16);
      const a = hx.length === 8 ? parseInt(hx.slice(6, 8), 16) / 255 : 1;
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
    }
    m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(t);
    if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
    return null;
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  // 连续昼夜权重（0 夜 → 1 昼）：在 04:24–05:36 与 18:24–19:36 平滑过渡，避免 05:00 / 19:00 跨界时抛物线与光色一帧跳变
  const dayBlendAt = (hour) => {
    const h = ((hour % 24) + 24) % 24;
    return smoothstep(4.4, 5.6, h) * (1 - smoothstep(18.4, 19.6, h));
  };
  const lerpColor = (a, b, t) => {
    if (t <= 0) return a;
    if (t >= 1) return b;
    const A = parseColor(a), B = parseColor(b);
    if (!A || !B) return t < 0.5 ? a : b;
    const v = A.map((x, i) => lerp(x, B[i], t));
    if (/^#/.test(String(a).trim()) && /^#/.test(String(b).trim()) && v[3] >= 0.999) {
      return "#" + v.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, "0")).join("").toUpperCase();
    }
    return `rgba(${Math.round(v[0])}, ${Math.round(v[1])}, ${Math.round(v[2])}, ${+v[3].toFixed(3)})`;
  };
  const lerpPalette = (A, B, t) => {
    if (t <= 0) return A;
    if (t >= 1) return B;
    const out = {};
    for (const k of COLOR_KEYS) out[k] = lerpColor(A[k], B[k], t);
    return out;
  };
  const PAL_NIGHT = {
    orbCore: "#F0F8FF", orbCorona: "#BB9AF7"
  };
  const PAL_DAWN = {
    orbCore: "#FFFDF5", orbCorona: "#FF9EB5"
  };
  const PAL_NOON = {
    orbCore: "#FFFFFF", orbCorona: "#7DCFFF"
  };
  const PAL_DUSK = {
    orbCore: "#FFFDF5", orbCorona: "#FF9E44"
  };

  const computeSunState = (hour, W, H) => {
    const p = lampPointAt(hour, W, H);
    const h = ((hour % 24) + 24) % 24;
    const { u, isDay } = p;
    let pal;
    if (h < 6.6) pal = lerpPalette(PAL_NIGHT, PAL_DAWN, smoothstep(4.4, 5.6, h));
    else if (h < 12) pal = lerpPalette(PAL_DAWN, PAL_NOON, smoothstep(7.6, 8.8, h));
    else if (h < 17.4) pal = lerpPalette(PAL_NOON, PAL_DUSK, smoothstep(15.2, 16.4, h));
    else pal = lerpPalette(PAL_DUSK, PAL_NIGHT, smoothstep(18.4, 19.6, h));
    const horizon = Math.max(0, Math.min(1, (H * 1.02 - p.y) / (H * 0.3)));
    const lampGlow = (0.45 + 0.55 * dayBlendAt(h)) * horizon;
    return {
      h, u, isDay, hour,
      W, H,
      sunX: p.x, sunY: p.y,
      orbScreenX: p.x, orbScreenY: p.y,
      sunU: p.x / W, sunV: p.y / H,
      lampGlow,
      ...pal
    };
  };
  Glacier.sun = { lampPointAt, computeSunState };

  // ---- 关键帧表："几点钟长什么样"是一张表，上面的公式只是默认那张 ----------------------
  // 关键帧：{ hour, u, v, glow, isDay, orbCore, orbCorona }
  //   u / v  灯在视口里的归一化位置（0–1，可超出）；glow 灯的亮度 0–1；颜色是 rgba(...) 或 #hex。
  //   少写的字段用公式在同一小时的值补齐，所以只写想改的就行。相邻两帧之间线性插值（颜色按通道插），
  //   最后一帧到第一帧跨午夜接上。
  // 公式在某个小时的一帧（归一化，和视口尺寸无关）
  const frameFromModel = (hour) => {
    const st = computeSunState(hour, 1000, 1000);
    const f = { hour: ((hour % 24) + 24) % 24, u: st.sunU, v: st.sunV, glow: st.lampGlow, isDay: st.isDay };
    for (const k of COLOR_KEYS) f[k] = st[k];
    return f;
  };
  /** 把公式采样成一张表（每 step 小时一帧），拿去改成自己的 */
  const sampleTable = (step = 1) => {
    const t = [];
    for (let h = 0; h < 24 - 1e-9; h += step) t.push(frameFromModel(h));
    return t;
  };
  /** 按表算某个小时的太阳状态（和 computeSunState 同样的返回结构）。
   *  位置 (u, v) 用向心 Catmull-Rom（α = 0.5，Barry-Goldman 金字塔递推）三次样条插值：严格过点、C¹ 连续，
   *  且在任意非均匀 DOM 节点排布或稀疏手写表下绝不产生尖角（Cusps）、自交环或过冲。 */
  const catmullRom = (p0, p1, p2, p3, t) => {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
  const knotDelta = (a, b) => Math.max(1e-4, Math.pow(Math.hypot(b.u - a.u, b.v - a.v), 0.5));
  const centripetalCR = (p0, p1, p2, p3, s) => {
    const dt0 = knotDelta(p0, p1), dt1 = knotDelta(p1, p2), dt2 = knotDelta(p2, p3);
    const t1 = dt0, t2 = t1 + dt1, t3 = t2 + dt2, t = t1 + s * dt1;
    const lp = (a, b, w) => ({ u: lerp(a.u, b.u, w), v: lerp(a.v, b.v, w) });
    const A1 = lp(p0, p1, t / t1), A2 = lp(p1, p2, s), A3 = lp(p2, p3, (t - t2) / dt2);
    const B1 = lp(A1, A2, t / t2), B2 = lp(A2, A3, (t - t1) / (t3 - t1));
    return lp(B1, B2, s);
  };
  // 归一化后的关键帧按表的身份缓存：同一张表第一次用时算一次（每帧要跑 frameFromModel），之后 240 段轨道、
  // 每帧 28 个余晖采样都直接拿。宿主换表是换数组，自然换缓存；原地改表后要 setSunTable 重新喂
  const kfCache = new WeakMap();
  const keyframesOf = (table) => {
    let kf = kfCache.get(table);
    if (kf) return kf;
    const isOpen = !!table.open;
    kf = table
      .filter((k) => Number.isFinite(k?.hour))
      .map((k, idx, arr) => ({
        ...frameFromModel(k.hour),
        ...k,
        hour: isOpen && k.hour === 24 && idx === arr.length - 1 ? 24 : (((k.hour % 24) + 24) % 24)
      }))
      .sort((a, b) => a.hour - b.hour);
    let gmin = Infinity, gmax = 0;
    for (let i = 0; i < (isOpen ? kf.length - 1 : kf.length); i++) {
      const g = isOpen ? (kf[i + 1].hour - kf[i].hour) : (((kf[(i + 1) % kf.length].hour - kf[i].hour) % 24 + 24) % 24 || 24);
      gmin = Math.min(gmin, g); gmax = Math.max(gmax, g);
    }
    kf.open = isOpen;
    kf.uniform = kf.length >= 4 && gmax / gmin <= 1.5;
    kfCache.set(table, kf);
    return kf;
  };
  const stateFromTable = (table, hour, W, H) => {
    if (!Array.isArray(table) || !table.length) return computeSunState(hour, W, H);
    const kf = keyframesOf(table);
    const n = kf.length;
    if (!n) return computeSunState(hour, W, H);
    const h = kf.open ? Math.max(0, Math.min(24, Number(hour) || 0)) : (((hour % 24) + 24) % 24);
    let idx1, idx2, t;
    if (kf.open) {
      const i = kf.findIndex((k) => k.hour > h);
      if (i <= 0) {
        if (h >= kf[n - 1].hour) { idx1 = Math.max(0, n - 2); idx2 = n - 1; t = 1; }
        else { idx1 = 0; idx2 = Math.min(1, n - 1); t = 0; }
      } else {
        idx1 = i - 1; idx2 = i;
        t = (h - kf[idx1].hour) / ((kf[idx2].hour - kf[idx1].hour) || 1);
      }
    } else {
      const i = kf.findIndex((k) => k.hour > h);
      if (i <= 0) {
        idx1 = n - 1; idx2 = 0;
        const span = ((kf[0].hour - kf[n - 1].hour) % 24 + 24) % 24 || 24;
        t = (((h - kf[n - 1].hour) % 24) + 24) % 24 / span;
      } else {
        idx1 = i - 1; idx2 = i;
        t = (h - kf[idx1].hour) / ((kf[idx2].hour - kf[idx1].hour) || 1);
      }
    }
    if (n === 1) { idx2 = idx1; t = 0; }
    const a = kf[idx1], b = kf[idx2];
    let u, v, glow;
    if (n >= 3) {
      const p0 = kf.open
        ? (idx1 > 0 ? kf[idx1 - 1] : { u: 2 * a.u - b.u, v: 2 * a.v - b.v, glow: a.glow })
        : kf[(idx1 - 1 + n) % n];
      const p3 = kf.open
        ? (idx2 + 1 < n ? kf[idx2 + 1] : { u: 2 * b.u - a.u, v: 2 * b.v - a.v, glow: b.glow })
        : kf[(idx2 + 1) % n];
      const pos = centripetalCR(p0, a, b, p3, t);
      u = pos.u;
      v = pos.v;
      glow = kf.uniform
        ? Math.max(0, Math.min(1, catmullRom(p0.glow, a.glow, b.glow, p3.glow, t)))
        : Math.max(0, Math.min(1, lerp(a.glow, b.glow, t)));
    } else {
      u = lerp(a.u, b.u, t);
      v = lerp(a.v, b.v, t);
      glow = Math.max(0, Math.min(1, lerp(a.glow, b.glow, t)));
    }
    const isDay = t < 0.5 ? !!a.isDay : !!b.isDay;
    const hMod = ((h % 24) + 24) % 24;
    const st = {
      h: hMod, u: lampPointAt(hMod, W, H).u, isDay, hour: hMod, W, H,
      sunX: u * W, sunY: v * H, orbScreenX: u * W, orbScreenY: v * H,
      sunU: u, sunV: v, lampGlow: glow
    };
    for (const k of COLOR_KEYS) st[k] = lerpColor(a[k], b[k], t);
    return st;
  };
  /** 从"相位 → 位置"的函数造一张表：fn(t) 返回 { u, v, glow?, isDay? }，t ∈ [0, 1) 是一天的相位，u / v 是视口归一化坐标。
   *  只收标量函数不收像素：曲线必须是钟——单环闭合或单程扫，一圈就是一天；光色从公式同一小时借（DESIGN.md §3 探针五律）。
   *  默认 glow 恒 1、isDay 恒真（闭合轨道没有昼夜，整圈实线）；要呼吸、要虚线段，fn 自己返回 */
  const tableFromPath = (fn, frames = 48) => {
    const t = [];
    for (let i = 0; i < frames; i++) {
      const phase = i / frames, hour = phase * 24, q = fn(phase) || {};
      const f = frameFromModel(hour);
      t.push({ ...f, u: Number.isFinite(q.u) ? q.u : f.u, v: Number.isFinite(q.v) ? q.v : f.v, glow: Number.isFinite(q.glow) ? q.glow : 1, isDay: q.isDay === undefined ? true : !!q.isDay });
    }
    return t;
  };
  /** 从 2 个或以上归一化坐标点 [{ u, v, glow?, isDay? }, ...] 生成向心 Catmull-Rom（α = 0.5）关键帧表。
   *  - 仅 2 个点时自动沿法线（朝屏幕上方或远离中心一侧）偏移 0.08~0.12 跨度合成拱顶控制点 P_mid，画成优雅的天桥弧线；
   *  - 默认开放腰线（open = !opts.closed，首尾反射虚拟端点自然收笔，不拉闭合底弦）；opts.closed = true 时首尾闭合；
   *  - 按向心弦长参数化采样 frames 帧，直接喂给 setSunTable 与 Lamp.buildStatic。 */
  const tableFromPoints = (points, opts = {}) => {
    const raw = (Array.isArray(points) ? points : []).filter((p) => Number.isFinite(p?.u) && Number.isFinite(p?.v));
    if (raw.length < 2) return null;
    const closed = !!opts.closed;
    const frames = Math.max(16, Number(opts.frames) || 48);
    let pts = raw.map((p) => ({ u: Number(p.u), v: Number(p.v), glow: Number.isFinite(p.glow) ? p.glow : 1, isDay: p.isDay === undefined ? true : !!p.isDay }));
    if (pts.length === 2 && !closed) {
      const A = pts[0], B = pts[1];
      const du = B.u - A.u, dv = B.v - A.v, L = Math.hypot(du, dv) || 0.2;
      let nx = -dv / L, ny = du / L;
      if (ny > 0 || (Math.abs(ny) < 1e-4 && ((A.u + B.u) * 0.5 > 0.5 ? nx < 0 : nx > 0))) { nx = -nx; ny = -ny; }
      const arch = Math.max(0.08, Math.min(0.12, L * 0.24));
      pts = [A, { u: (A.u + B.u) * 0.5 + nx * arch, v: (A.v + B.v) * 0.5 + ny * arch, glow: lerp(A.glow, B.glow, 0.5), isDay: true }, B];
    }
    const n = pts.length;
    const segCount = closed ? n : n - 1;
    const cum = [0];
    for (let i = 0; i < segCount; i++) cum.push(cum[i] + knotDelta(pts[i], pts[(i + 1) % n]));
    const total = cum[segCount] || 1;
    const ptAt = (idx) => {
      if (closed) return pts[(idx % n + n) % n];
      if (idx < 0) return { u: 2 * pts[0].u - pts[1].u, v: 2 * pts[0].v - pts[1].v };
      if (idx >= n) return { u: 2 * pts[n - 1].u - pts[n - 2].u, v: 2 * pts[n - 1].v - pts[n - 2].v };
      return pts[idx];
    };
    const out = [];
    for (let i = 0; i < frames; i++) {
      const phase = closed ? i / frames : i / (frames - 1);
      const hour = phase * 24;
      const targetS = phase * total;
      let seg = 0;
      while (seg < segCount - 1 && cum[seg + 1] < targetS) seg++;
      const span = (cum[seg + 1] - cum[seg]) || 1;
      const s = Math.max(0, Math.min(1, (targetS - cum[seg]) / span));
      const p0 = ptAt(seg - 1), p1 = ptAt(seg), p2 = ptAt(seg + 1), p3 = ptAt(seg + 2);
      const pos = centripetalCR(p0, p1, p2, p3, s);
      const f = frameFromModel(hour);
      out.push({ ...f, hour, u: pos.u, v: pos.v, glow: lerp(p1.glow, p2.glow, s), isDay: s < 0.5 ? p1.isDay : p2.isDay });
    }
    if (!closed) out.open = true;
    return out;
  };
  Glacier.sun = { lampPointAt, computeSunState, sampleTable, stateFromTable, frameFromModel, tableFromPath, tableFromPoints, centripetalCR };

  // ==========================================================================
  // 2. 灯 overlay：轨迹就是「几点钟灯在哪」那张表画出来的线
  //    静态层（一根连续的三色游丝 + loop 段加亮，表 / 区间 / 尺寸变了才重建）+ 游标（星核 + 柔和日冕 + 身后余晖，只重画脏矩形）；时间读数在宿主的钟上，不画在画布里
  // ==========================================================================
  const toRgb = (color) => {
    if (!color) return [255, 220, 170];
    const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    const hex = color.replace("#", "");
    if (hex.length === 6) return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
    return [255, 220, 170];
  };
  const rgba = (c, a) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a.toFixed(3)})`;
  const PATH_STEP = 0.1;   // 轨迹按表高密采样步长（小时）：240 段 + 二次平滑样条，彻底消灭折线棱角与锯齿
  const CURSOR_R = 28;     // 游标柔光半径
  const CURSOR_DIRTY = 64; // 游标脏矩形半边
  const TRAIL_H = 1.1, TRAIL_N = 28; // 余晖：游标身后 1.1 小时的平滑光学尾迹

  const traceSmooth = (ctx, run) => {
    ctx.beginPath();
    ctx.moveTo(run[0].x, run[0].y);
    if (run.length === 2) { ctx.lineTo(run[1].x, run[1].y); return; }
    for (let i = 1; i < run.length - 1; i++) {
      ctx.quadraticCurveTo(run[i].x, run[i].y, 0.5 * (run[i].x + run[i + 1].x), 0.5 * (run[i].y + run[i + 1].y));
    }
    const last = run[run.length - 1];
    ctx.lineTo(last.x, last.y);
  };

  class Lamp {
    constructor(canvas) { this.canvas = canvas; this.lastKey = ""; this.staticKey = ""; this.staticLayer = null; this.glowCache = new Map(); this.prevRect = null; this.lastHour = null; }
    /** 默认路径：内置公式。init() 有表时传表的采样器进来（hour → { x, y, isDay }） */
    static formulaPath(W, H) { return (h) => lampPointAt(h, W, H); }
    // 静态层：纯粹的 1px 连续光学游丝（零刻度毛刺、零虚线锯齿、零文字杂讯）。
    // 色散与 .gl-bar / .gl-brick 完全同源（左香槟暖金 #FFD89B → 中冰晶白 #E6F4FF → 右暮光紫 #BB9AF7，两端向视口边缘柔和消隐）：
    // 底层垫一圈 4.5px 极淡折射光晕消解像素阶梯，表层走 1.1px 连续锐利刀锋；背阳段（!isDay）只压低明度，绝不画丑陋的虚线。
    buildStatic(W, H, dpr, state, path, pathKey, loop) {
      const subLoop = loop && loop.span < 24 ? loop : null; // 整天循环（timelapse，span=24）不画局部加亮段
      const key = `${W}x${H}@${dpr}:${pathKey}:${subLoop ? `${subLoop.from}+${subLoop.span}` : ""}`;
      if (this.staticLayer && this.staticKey === key) return this.staticLayer;
      this.staticKey = key;
      const off = document.createElement("canvas"); off.width = Math.round(W * dpr); off.height = Math.round(H * dpr);
      const ctx = off.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      const visible = (p) => p.y <= H + 60 && p.y >= -60 && p.x >= -60 && p.x <= W + 60;
      const spectrumGrad = (a0, a1, a2) => {
        const g = ctx.createLinearGradient(0, 0, W, 0);
        g.addColorStop(0, `rgba(255, 216, 155, ${(a0 * 0.25).toFixed(3)})`);
        g.addColorStop(0.14, `rgba(255, 216, 155, ${a0})`);
        g.addColorStop(0.5, `rgba(230, 244, 255, ${a1})`);
        g.addColorStop(0.86, `rgba(187, 154, 247, ${a2})`);
        g.addColorStop(1, `rgba(187, 154, 247, ${(a2 * 0.25).toFixed(3)})`);
        return g;
      };
      const dayHalo = spectrumGrad(0.055, 0.075, 0.055);
      const dayBlade = spectrumGrad(0.32, 0.42, 0.32);
      const nightBlade = spectrumGrad(0.08, 0.11, 0.09);
      const pts = [];
      for (let h = 0; h <= 24 + 1e-9; h += PATH_STEP) pts.push(path(h));
      const strokeRun = (run) => {
        if (run.length < 2) return;
        const day = !!run[0].isDay;
        if (day) {
          traceSmooth(ctx, run);
          ctx.lineWidth = 4.5; ctx.strokeStyle = dayHalo; ctx.stroke();
        }
        traceSmooth(ctx, run);
        ctx.lineWidth = day ? 1.1 : 0.85;
        ctx.strokeStyle = day ? dayBlade : nightBlade;
        ctx.stroke();
      };
      let run = [];
      for (const p of pts) {
        if (!visible(p)) { strokeRun(run); run = []; continue; }
        if (run.length && !!run[0].isDay !== !!p.isDay) { run.push(p); strokeRun(run); run = [p]; continue; }
        run.push(p);
      }
      strokeRun(run);
      // 区间 loop 段加亮（仅 span < 24 的子区间，如母星 16→19）：双层光学蚀刻（柔光底 + 1.35px 刀锋）
      if (subLoop) {
        const subRun = [];
        for (let t = 0; t <= subLoop.span + 1e-9; t += PATH_STEP) {
          const p = path((subLoop.from + t) % 24);
          if (visible(p)) subRun.push(p);
        }
        if (subRun.length >= 2) {
          traceSmooth(ctx, subRun);
          ctx.lineWidth = 5; ctx.strokeStyle = spectrumGrad(0.09, 0.12, 0.09); ctx.stroke();
          traceSmooth(ctx, subRun);
          ctx.lineWidth = 1.4; ctx.strokeStyle = spectrumGrad(0.56, 0.72, 0.56); ctx.stroke();
        }
      }
      this.staticLayer = off;
      return off;
    }
    glowSprite(core, corona, R, dpr) {
      const key = `${core.join()}|${corona.join()}|${R}|${dpr}`;
      let sp = this.glowCache.get(key);
      if (sp) return sp;
      if (this.glowCache.size > 6) this.glowCache.clear();
      sp = document.createElement("canvas"); sp.width = Math.round(R * 2 * dpr); sp.height = Math.round(R * 2 * dpr);
      const g = sp.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const grad = g.createRadialGradient(R, R, 0, R, R, R);
      grad.addColorStop(0, rgba(core, 0.85));
      grad.addColorStop(0.12, rgba([255, 224, 175], 0.52));
      grad.addColorStop(0.36, rgba(corona, 0.16));
      grad.addColorStop(1, rgba(corona, 0));
      g.fillStyle = grad; g.fillRect(0, 0, R * 2, R * 2);
      this.glowCache.set(key, sp);
      return sp;
    }
    /**
     * @param opts { path?: hour → {x, y, isDay}（默认公式）, pathKey?: 表的版本号（换表要换 key）, loop?: { from, span } 要加亮的区间, open?: 开放样条不跨午夜回绕, trail?: 离轨真实位移轨迹 }
     * 只有游标位置取整后变了、余晖尾端变了、颜色变了、尺寸变了、表 / 区间变了才重画；游标只重画脏矩形。
     */
    draw(state, hour, W, H, opts = {}) {
      if (!(W > 0 && H > 0)) return false; // 0×0 的视口（隐藏的标签页）没得画
      const path = opts.path || Lamp.formulaPath(W, H), pathKey = opts.pathKey || "formula", loop = opts.loop || null;
      const x = state.sunX, y = state.sunY, glow = state.lampGlow ?? 1;
      const extTrail = Array.isArray(opts.trail) ? opts.trail : null;
      const extTail = extTrail && extTrail.length > 1 ? extTrail[extTrail.length - 1] : null;
      const key = `${Math.round(x)}:${Math.round(y)}:${extTail ? `${Math.round(extTail.x)}:${Math.round(extTail.y)}` : ""}:${state.orbCorona}:${state.orbCore}:${W}x${H}:${glow.toFixed(2)}:${state.isDay}:${pathKey}:${loop ? `${loop.from}+${loop.span}` : ""}`;
      if (key === this.lastKey) return false;
      this.lastKey = key;
      const canvas = this.canvas;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      let sizeChanged = false;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); this.glowCache.clear(); sizeChanged = true; }
      const ctx = canvas.getContext("2d");
      const prevStaticKey = this.staticKey;
      const layer = this.buildStatic(W, H, dpr, state, path, pathKey, loop);
      const D = CURSOR_DIRTY;
      // 余晖：在轨时沿轨道画 TRAIL_H 小时的连续渐变光尾；离轨借光（opts.trail）时沿真实位移轨迹画光尾，停稳定格（v → 0）时尾迹自动收进星核（探针第五律）
      let trail;
      if (extTrail) {
        trail = extTrail;
        this.lastHour = hour;
      } else {
        let delta = this.lastHour === null ? 0 : (opts.open ? hour - this.lastHour : (((hour - this.lastHour) % 24 + 24) % 24));
        if (!opts.open && delta > 12) delta -= 24;
        this.lastHour = hour;
        trail = [];
        if (Math.abs(delta) > 1e-4 && Math.abs(delta) <= 2) {
          const dir = delta > 0 ? 1 : -1;
          for (let i = 0; i <= TRAIL_N; i++) {
            const th = hour - dir * TRAIL_H * (i / TRAIL_N);
            trail.push(path(opts.open ? Math.max(0, Math.min(24, th)) : (((th % 24) + 24) % 24)));
          }
        }
      }
      let rx0 = x - D, rx1 = x + D, ry0 = y - D, ry1 = y + D;
      for (const t of trail) { rx0 = Math.min(rx0, t.x - 8); rx1 = Math.max(rx1, t.x + 8); ry0 = Math.min(ry0, t.y - 8); ry1 = Math.max(ry1, t.y + 8); }
      const newRect = { x: rx0, y: ry0, w: rx1 - rx0, h: ry1 - ry0 };
      const full = sizeChanged || !this.prevRect || this.staticKey !== prevStaticKey;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (full) { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(layer, 0, 0); }
      else {
        const pr = this.prevRect;
        const x0 = Math.max(0, Math.floor(Math.min(newRect.x, pr.x) * dpr)), y0 = Math.max(0, Math.floor(Math.min(newRect.y, pr.y) * dpr));
        const x1 = Math.min(canvas.width, Math.ceil(Math.max(newRect.x + newRect.w, pr.x + pr.w) * dpr)), y1 = Math.min(canvas.height, Math.ceil(Math.max(newRect.y + newRect.h, pr.y + pr.h) * dpr));
        if (x1 > x0 && y1 > y0) { ctx.clearRect(x0, y0, x1 - x0, y1 - y0); ctx.drawImage(layer, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0); }
      }
      this.prevRect = newRect;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      // 余晖：单笔连续平滑曲线 + 香槟暖金 → 冰晶白 → 暮光紫渐隐（零结节；首尾间距 < 1.5px 时视为定格不画余晖）
      if (trail.length > 1 && Math.hypot(trail[0].x - trail[trail.length - 1].x, trail[0].y - trail[trail.length - 1].y) >= 1.5) {
        const head = trail[0], tail = trail[trail.length - 1], gFactor = Math.max(0.4, glow);
        const tg = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
        tg.addColorStop(0, `rgba(255, 216, 155, ${(0.82 * gFactor).toFixed(3)})`);
        tg.addColorStop(0.35, `rgba(230, 244, 255, ${(0.45 * gFactor).toFixed(3)})`);
        tg.addColorStop(0.72, `rgba(187, 154, 247, ${(0.16 * gFactor).toFixed(3)})`);
        tg.addColorStop(1, "rgba(187, 154, 247, 0)");
        traceSmooth(ctx, trail);
        ctx.lineWidth = 4; ctx.strokeStyle = tg; ctx.save(); ctx.globalAlpha = 0.24; ctx.stroke(); ctx.restore();
        traceSmooth(ctx, trail);
        ctx.lineWidth = 1.4; ctx.strokeStyle = tg; ctx.stroke();
      }
      // 游标：只画纯粹的光学星点（柔和日冕 + 1.8px 炽白星核），不画刻度棍、靶环和文字
      const corona = toRgb(state.orbCorona), core = toRgb(state.orbCore);
      ctx.save(); ctx.globalAlpha = Math.max(0.3, glow);
      ctx.drawImage(this.glowSprite(core, corona, CURSOR_R, dpr), x - CURSOR_R, y - CURSOR_R, CURSOR_R * 2, CURSOR_R * 2);
      ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fillStyle = "#FFFDF8"; ctx.fill();
      ctx.restore();
      return true;
    }
  }
  Glacier.Lamp = Lamp;

  // ==========================================================================
  // 3. 太阳位置与微弱明度广播（底片 100% 消色差黑白银盐灰阶，零色相染色）
  // ==========================================================================
  // 材质是 CSS 常数，底片是纯黑白银盐负片；太阳只管底片暗房探照灯的坐标（--gl-sun-x / --gl-sun-y）和极克制的明度呼吸（--gl-sun-exposure）
  Glacier.applySunVars = (el, state) => {
    const st = el.style;
    const set = (k, val) => { if (val && st.getPropertyValue(k) !== val) st.setProperty(k, val); };
    set("--gl-sun-x", `${((state.sunU ?? 0.5) * 100).toFixed(1)}%`);
    set("--gl-sun-y", `${((state.sunV ?? 0.25) * 100).toFixed(1)}%`);
    set("--gl-sun-exposure", (0.68 + 0.32 * (state.lampGlow ?? 1)).toFixed(2));
  };

  // ==========================================================================
  // 4. init()：把上面三件东西装到一个页面上
  // ==========================================================================
  // 选项（全部可省）：
  //   background   "none" 不建背景层，只有灯 + 冰砖 | "photo" 照片当背景：零画布，单节点 div.gl-layer-photo（::before 纯黑白灰阶底片 + ::after 太阳探照灯遮罩）
  //   photo        照片 URL（background: "photo" 用）
  //   time         "现在几点"的时钟：
  //                  "realtime"  跟真实时间（每 realtimeInterval 对一次表）
  //                  小时数       定住某一帧（fixed）
  //                  "timelapse" 一天循环（= loop，从当前时刻起一圈 timelapseDuration 毫秒）
  //                  { loop: { from, to, duration, bounce } }  在某个区间来回：from/to 小时、duration 毫秒一圈、bounce 到头折返
  //                  "external"  不自己走，宿主用 setHour() 推（hudd、网关、别的时钟）
  //   sunTable     "几点钟长什么样"的关键帧表（Glacier.sun.sampleTable() 采一张改）；null = 用内置公式
  //   lampOverlay  是否画灯 overlay（轨迹按 sunTable / 公式采样画，loop 区间加亮，游标 + 时间）
  //   torch        鼠标手电（Win10 Reveal）：待机态的砖平时无玻璃无边，鼠标 torchRadius 像素内的砖按远近显出 1px 三色边缘；
  //                已点亮的砖不参与；键盘焦点等价于手电停在那一格
  //   torchRadius  手电半径（像素，默认 160）；torchSelector 哪些元素受手电（默认 .gl-brick）
  //   sunTorch     太阳也是一支手电（默认开，需要 torch 开着）：轨道游标经过的砖，1px 边被它擦亮再在 800ms 里暗回去。
  //                同一配方、半径 1.5 倍、亮度跟 glow 走；只照不动，不改任何状态
  //   observe      监视 root 里的节点增删：新塞进来的 .gl-brick 节点自动纳入手电探测（挂上总线即受光，不用注册）
  //   trackSelector 会自己动的节点（漂移、拖拽、动画）：带这个选择器的元素逐帧重新量矩形、重新被手电探测；
  //                 默认 [data-gl-track]。不动的元素别加，省着算
  //   dim          底片压暗 0–1（默认 0.3）：面板后面的背景要安静
  //   focusLease   data-gl-focus / focus() 默认租期（毫秒，默认 8000）：离轨是租借不是搬家，到期弹簧自动把太阳拉回日晷轨道
  //   root         画布插到哪、冰砖在哪找（默认 document.body）；底片变量也写在它上面
  //   onUpdate(state)       每次太阳状态更新后的回调
  const DEFAULTS = {
    background: "none",
    time: "realtime",
    sunTable: null,
    lampOverlay: true,
    photo: null,
    torch: true,
    torchRadius: 160,
    sunTorch: true,
    torchSelector: ".gl-brick, .gl-input, .gl-slider, .gl-table tbody tr",
    observe: true,
    trackSelector: "[data-gl-track]",
    dim: 0.3,
    focusLease: 8000,
    root: null,
    settleDelay: 160,
    realtimeInterval: 28000,
    timelapseDuration: 24000,
    onUpdate: null
  };
  Glacier.DEFAULTS = DEFAULTS;

  const SUN_VARS = ["--gl-sun-x", "--gl-sun-y", "--gl-sun-exposure"];
  const BACKGROUNDS = ["none", "photo"];
  const LOOP_TICK = 80; // loop / timelapse 模式对表的节拍（毫秒）
  const TORCH_VARS = ["--torch-x", "--torch-y", "--torch-a"];
  const SUN_TORCH_VARS = ["--sun-x", "--sun-y", "--sun-a"];
  const SUN_TORCH_SCALE = 1.5; // 太阳手电半径 = torchRadius × 1.5
  const SPRING_OMEGA = 9.5;    // 二阶临界阻尼弹簧固有频率 ω_n (rad/s，ζ = 1.0)：调节时间 t_s ≈ 4/ω_n ≈ 420ms，零过冲
  const SPRING_TRAIL_N = 20;   // 离轨运动余晖环缓冲点数
  const INSTANCE_KEY = "__glacierInstance";
  const { applySunVars } = Glacier;

  const nowHour = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; };
  // 预取 + 解码一张底片：decode() 在主线程外做，解码完才插进页面，淡入时不会卡那几十毫秒。
  // 兜底：decode() 失败、或者（某些嵌入式 WebView 里）永远不回来，就在 onload 后放行；最多等 1.5s。同一个 URL 只做一次，引用攥着不让缓存丢
  const photoCache = new Map();
  const preloadPhoto = (url) => {
    if (!url) return Promise.resolve();
    if (!photoCache.has(url)) {
      const img = new Image();
      const done = new Promise((resolve) => {
        const ok = () => resolve(img);
        img.onload = () => setTimeout(ok, 30);
        img.onerror = ok;
        setTimeout(ok, 1500);
        img.src = url;
        if (img.decode) img.decode().then(ok, () => {});
      });
      photoCache.set(url, done);
    }
    return photoCache.get(url);
  };
  Glacier.preloadPhoto = preloadPhoto;
  const makeCanvas = (cls) => { const c = document.createElement("canvas"); c.className = `gl-layer ${cls}`; return c; };
  const rectOf = (b) => ({ left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height });
  const sameRect = (a, b) => a && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
  const viewport = () => [window.innerWidth || 1280, window.innerHeight || 800];

  // ==========================================================================
  // 3b. 运镜（Camera）：弹簧（focus 定点借光）+ 向心样条巡航（tour）+ 焦点租期。
  //     Instance 持有一个，自己只管时钟、灯、手电；Camera 借 Instance 的钟和灯，把太阳游标暂时带离轨道，到期还回去。
  //     对外：focus / tour / focusEl；对 Instance：active / parked / trail / stateFor / wake / pause / resume / dispose
  // ==========================================================================
  class Camera {
    constructor(gl) {
      this.gl = gl;
      this.focusEl = null; this.focusTimer = 0; this.tourTimer = 0; this.preTourState = null;
      this.spring = { active: false, parked: false, u: 0.5, v: 0.25, vu: 0, vv: 0, prevTu: null, prevTv: null, glow: 0.85, lastTime: 0, raf: 0, trail: [] };
    }
    get active() { return this.spring.active; }
    get parked() { return this.spring.parked; }
    get trail() { return this.spring.trail; }
    /** stop()：借光中的弹簧一并暂停 */
    pause() { if (this.spring.raf) { cancelAnimationFrame(this.spring.raf); this.spring.raf = 0; } }
    /** start()：暂停前飞到一半的弹簧接着飞 */
    resume() { if (this.spring.active && !this.spring.parked) this.wake(false, false); }
    dispose() {
      clearTimeout(this.focusTimer); this.focusTimer = 0;
      clearTimeout(this.tourTimer); this.tourTimer = 0;
      this.pause();
      if (this.focusEl) { delete this.focusEl.__glRect; this.focusEl = null; }
      this.spring.active = false; this.spring.parked = false; this.spring.trail = [];
    }
    resolveTarget(target) {
      const gl = this.gl;
      if (!target) return null;
      if (target.nodeType === 1) return target;
      if (typeof target === "string") {
        const s = target.trim();
        if (!s) return null;
        try {
          const el = gl.root.querySelector(s) || document.querySelector(s);
          if (el) return el;
        } catch {}
        return document.getElementById(s.replace(/^#/, ""));
      }
      return null;
    }
    springTarget(orb, W, H) {
      const el = this.focusEl;
      if (el && el.isConnected) {
        const r = el.__glRect || (el.__glRect = rectOf(el.getBoundingClientRect()));
        if (r.width > 0 || r.height > 0) {
          return [(r.left + r.width * 0.5) / W, (r.top + r.height * 0.5) / H, Math.max(orb.lampGlow ?? 0.85, 0.92)];
        }
      }
      return [orb.sunU, orb.sunV, orb.lampGlow ?? 0.85];
    }
    // 弹簧此刻的太阳状态：轨道状态打底（钟、昼夜、颜色都照旧），只换位置和亮度
    stateFor(orb, W, H) {
      const sp = this.spring;
      const sx = sp.u * W, sy = sp.v * H;
      return {
        ...orb,
        sunU: sp.u,
        sunV: sp.v,
        sunX: sx,
        sunY: sy,
        orbScreenX: sx,
        orbScreenY: sy,
        lampGlow: sp.glow,
        offOrbit: true
      };
    }
    wake(launchKick = false, resetTargetVel = true) {
      const gl = this.gl;
      if (gl.destroyed) return;
      const [W, H] = viewport();
      const hour = gl.currentHour();
      const orb = gl.computeOrbitalState(hour, W, H);
      const sp = this.spring;
      if (!sp.active) {
        sp.active = true;
        sp.u = gl.state ? gl.state.sunU : orb.sunU;
        sp.v = gl.state ? gl.state.sunV : orb.sunV;
        sp.vu = 0;
        sp.vv = 0;
        sp.glow = gl.state ? (gl.state.lampGlow ?? 0.85) : 0.85;
        sp.trail = [{ x: sp.u * W, y: sp.v * H }];
      }
      if (resetTargetVel) { sp.prevTu = null; sp.prevTv = null; }
      sp.parked = false;
      const [tu, tv] = this.springTarget(orb, W, H);
      // 从静止/低速起跳时，朝目标方向注入初速度并叠加 0.38 倍侧向偏置（取轨道切线朝向），确保静止钟或任意目标方位都能甩出圆润弧线；
      // 若已在飞行中途切换目标（sp.vu/sp.vv 非零），保留实时速度矢量，保证空中变向二阶导数连续
      if (launchKick && Math.hypot(sp.vu, sp.vv) < 0.08) {
        const du = tu - sp.u, dv = tv - sp.v, dist = Math.hypot(du, dv);
        if (dist > 1e-3) {
          const pA = gl.computeOrbitalState(hour - 0.25, W, H);
          const pB = gl.computeOrbitalState(hour + 0.25, W, H);
          let tx = pB.sunU - pA.sunU, ty = pB.sunV - pA.sunV;
          const tLen = Math.hypot(tx, ty) || 1;
          tx /= tLen; ty /= tLen;
          if (tx * du + ty * dv < -0.15 * dist) { tx = -tx; ty = -ty; }
          const cross = tx * dv - ty * du;
          const nx = -ty, ny = tx;
          const sign = cross >= 0 ? -1 : 1;
          const speed = Math.min(2.2, Math.max(0.35, dist * SPRING_OMEGA * 0.48));
          sp.vu = (tx * 0.82 + nx * sign * 0.38) * speed;
          sp.vv = (ty * 0.82 + ny * sign * 0.38) * speed;
        }
      }
      sp.lastTime = 0;
      if (!sp.raf) sp.raf = requestAnimationFrame((now) => this.step(now));
    }
    step(now) {
      const gl = this.gl;
      const sp = this.spring;
      sp.raf = 0;
      if (gl.destroyed || !sp.active) return;
      if (this.focusEl && !this.focusEl.isConnected) { this.focusEl = null; sp.prevTu = null; sp.prevTv = null; }
      // 目标还在树里但量出来是 0×0（弹层关了、display:none）：照不到的东西不算焦点，立刻交还，否则弹簧会按静止目标的判据追一条运动轨道追到租期结束
      const fr = this.focusEl?.__glRect;
      if (this.focusEl && fr && !(fr.width > 0 || fr.height > 0)) { this.focusEl = null; sp.prevTu = null; sp.prevTv = null; }
      const [W, H] = viewport();
      const hour = gl.currentHour();
      gl.clock.hour = hour;
      const orb = gl.computeOrbitalState(hour, W, H);
      const [tu, tv, tGlow] = this.springTarget(orb, W, H);
      const tNow = performance.now();
      const dt = sp.lastTime ? Math.min(0.1, Math.max(0.001, (tNow - sp.lastTime) / 1000)) : (1 / 60);
      sp.lastTime = tNow;
      // 目标速度差分 vt（目标身份切换首帧 prevTu 为 null，vt = 0，避免把位置阶跃当成速度）
      let vtu = 0, vtv = 0, tu0 = tu, tv0 = tv;
      if (sp.prevTu !== null && dt > 1e-4) {
        vtu = (tu - sp.prevTu) / dt;
        vtv = (tv - sp.prevTv) / dt;
        if (Math.hypot(vtu, vtv) <= 4) {
          tu0 = sp.prevTu;
          tv0 = sp.prevTv;
        } else {
          vtu = 0; vtv = 0;
        }
      }
      sp.prevTu = tu;
      sp.prevTv = tv;
      // 二阶临界阻尼状态机（ζ = 1.0, ω_n = SPRING_OMEGA）：a = ω_n² (pt - p) - 2 ω_n (v - vt) 的相对误差闭式解，彻底消除运动轨道的稳态滞后 v/ω 与帧率抖动误差
      const w = SPRING_OMEGA, exp = Math.exp(-w * dt);
      const eu0 = sp.u - tu0, ev0 = sp.v - tv0;
      const evu0 = sp.vu - vtu, evv0 = sp.vv - vtv;
      const cu = evu0 + w * eu0, cv = evv0 + w * ev0;
      const eu = (eu0 + cu * dt) * exp;
      const ev = (ev0 + cv * dt) * exp;
      const evu = (evu0 - w * cu * dt) * exp;
      const evv = (evv0 - w * cv * dt) * exp;
      sp.u = tu + eu;
      sp.v = tv + ev;
      sp.vu = vtu + evu;
      sp.vv = vtv + evv;
      sp.glow = lerp(sp.glow, tGlow, Math.min(1, dt * 8));
      const sx = sp.u * W, sy = sp.v * H;
      sp.trail.unshift({ x: sx, y: sy });
      if (sp.trail.length > SPRING_TRAIL_N) sp.trail.pop();

      this.gl.state = this.stateFor(orb, W, H);
      if (gl.lamp && !document.hidden) gl.lamp.draw(gl.state, hour, W, H, gl.lampOpts(W, H));
      applySunVars(gl.root, gl.state);
      if (gl.options.torch && gl.options.sunTorch) gl.scheduleTorch();
      gl.options.onUpdate?.(gl.state);

      const distPx = Math.hypot((tu - sp.u) * W, (tv - sp.v) * H);
      const relSpeedPx = Math.hypot((sp.vu - vtu) * W, (sp.vv - vtv) * H);
      const targetMoving = Math.hypot(vtu * W, vtv * H) > 2;
      const tail = sp.trail[sp.trail.length - 1];
      const trailSpan = tail ? Math.hypot(sx - tail.x, sy - tail.y) : 0;
      // 交还判定：运动轨道有曲率向心加速度残差（≈ a/ω²，随视口尺寸约 1~5px），误差 < 5.5px 且相对速度收敛即无缝交还；
      // 静止目标/静止轨道则等尾迹收进星核（trailSpan < 1.5px）后退出或定格休眠
      const settled = (!this.focusEl && targetMoving)
        ? (distPx < 5.5 && relSpeedPx < 24)
        : (distPx < 1.2 && relSpeedPx < 4 && trailSpan < 1.5);
      if (settled) {
        sp.u = tu; sp.v = tv; sp.vu = vtu; sp.vv = vtv;
        sp.trail = [{ x: tu * W, y: tv * H }];
        if (!this.focusEl) {
          // 已平顺并入日晷/巡航轨道：退出弹簧态，交还轨道时钟直驱（零后台 rAF）
          sp.active = false;
          sp.parked = false;
          sp.prevTu = null;
          sp.prevTv = null;
          sp.trail = [];
          if (gl.lamp) gl.lamp.lastHour = hour;
          gl.update();
          return;
        }
        // 已停稳在目标元素中心且余晖收尽：进入定格休眠（0 CPU），滚动/缩放/租期到点时再唤醒
        sp.vu = 0; sp.vv = 0;
        sp.parked = true;
        if (gl.lamp && !document.hidden) gl.lamp.draw(gl.state, hour, W, H, gl.lampOpts(W, H));
        return;
      }
      sp.raf = requestAnimationFrame((t) => this.step(t));
    }
    initFocus() {
      const gl = this.gl;
      if (this.applyHashFocus()) return;
      const all = gl.root.querySelectorAll("[data-gl-focus]");
      if (all.length) this.focus(all[all.length - 1]); // 租期从属性里读，focus() 自己会解析
    }
    applyHashFocus() {
      const gl = this.gl;
      if (typeof location === "undefined" || !location.hash) return false;
      const m = /(?:^|[#&])gl-focus=([^&]+)/.exec(location.hash);
      if (!m) return false;
      try {
        const sel = decodeURIComponent(m[1]).trim();
        const el = this.resolveTarget(sel);
        if (!el || !el.isConnected) return false;
        const r = el.getBoundingClientRect();
        const [, H] = viewport();
        if (r.bottom < 0 || r.top > H) {
          el.scrollIntoView({ block: "center" });
          gl.measureRects();
        }
        return !!this.focus(el);
      } catch {}
      return false;
    }

    clearTourLease() {
      clearTimeout(this.tourTimer); this.tourTimer = 0;
      this.preTourState = null;
    }
    /**
     * 定点借光（focus）：太阳游标按二阶临界阻尼弹簧（ζ = 1.0, ω_n = 9.5 rad/s）脱离原日晷轨道滑向 target 中心，
     * 照亮其 1px 金星带刀锋与背后的银盐底片；背景日晷轨道线留在原地，内部时钟一秒不停。
     * @param {Element|string|null} target 目标元素或 CSS 选择器；传 null 立即归还回轨
     * @param {{ lease?: number }} [opts] lease 租期毫秒（默认 options.focusLease = 8000；传 0 或 Infinity 则常驻直到手动释放或移除 data-gl-focus）
     */
    focus(target, opts = {}) {
      const gl = this.gl;
      if (gl.destroyed) return null;
      clearTimeout(this.focusTimer); this.focusTimer = 0;
      const el = this.resolveTarget(target);
      if (!el || !el.isConnected) {
        if (!this.focusEl && !this.spring.active) return null;
        this.focusEl = null;
        this.wake(true, true);
        return null;
      }
      const r = rectOf(el.getBoundingClientRect());
      if (r.width === 0 && r.height === 0) return null;
      el.__glRect = r;
      const launchKick = !this.spring.active || this.spring.parked;
      this.focusEl = el;
      this.wake(launchKick, true);
      const rawAttr = el.getAttribute?.("data-gl-focus");
      const attrLease = rawAttr !== null && rawAttr !== "" && Number.isFinite(Number(rawAttr)) ? Number(rawAttr) : undefined;
      const lease = opts.lease !== undefined ? Number(opts.lease) : (attrLease !== undefined ? attrLease : Number(gl.options.focusLease));
      if (Number.isFinite(lease) && lease > 0) {
        this.focusTimer = setTimeout(() => { this.focusTimer = 0; this.focus(null); }, lease);
      }
      return el;
    }
    /**
     * 多点星轨巡航（tour）：把 2 个或以上 DOM 节点（或选择器 / {u,v} 坐标）用向心 Catmull-Rom（α = 0.5）样条
     * 串成临时 1px 金星带星轨（2 点时自动拱起法向天桥弧），太阳游标平滑切入并沿轨来回巡航；到期自动归还巡航前的日晷轨道。
     * @param {Array<Element|string|{u:number,v:number}>|null} targets 节点或选择器数组；传 null 恢复巡航前的日晷轨道与时钟
     * @param {{ duration?: number, bounce?: boolean, closed?: boolean, frames?: number, lease?: number, loop?: boolean }} [opts]
     */
    tour(targets, opts = {}) {
      const gl = this.gl;
      if (gl.destroyed) return null;
      clearTimeout(this.tourTimer); this.tourTimer = 0;
      if (!targets || (Array.isArray(targets) && !targets.length)) {
        const saved = this.preTourState;
        this.preTourState = null;
        gl.options.sunTable = saved ? saved.sunTable : null;
        gl.tableVersion++;
        if (saved) {
          gl.clock.mode = saved.mode;
          gl.clock.hour = saved.hour;
          if (saved.loop) gl.clock.loop = { ...saved.loop, start: performance.now() };
          if (!gl.stopped) gl.startClock();
        }
        this.focusEl = null;
        this.wake(true, true);
        return null;
      }
      if (!Array.isArray(targets)) return this.focus(targets, opts);
      const [W, H] = viewport();
      const pts = [];
      let singleEl = null;
      for (const item of targets) {
        if (item && typeof item === "object" && Number.isFinite(item.u) && Number.isFinite(item.v)) {
          pts.push({ u: Number(item.u), v: Number(item.v), glow: item.glow, isDay: item.isDay });
        } else {
          const el = this.resolveTarget(item);
          if (!el || !el.isConnected) continue;
          const r = rectOf(el.getBoundingClientRect());
          if (r.width === 0 && r.height === 0) continue;
          el.__glRect = r;
          singleEl = el;
          pts.push({ u: (r.left + r.width * 0.5) / W, v: (r.top + r.height * 0.5) / H });
        }
      }
      if (pts.length === 1 && singleEl) return this.focus(singleEl, opts);
      const table = tableFromPoints(pts, { closed: !!opts.closed, frames: opts.frames || 48 });
      if (!table) return null;
      if (!this.preTourState) {
        this.preTourState = {
          sunTable: gl.options.sunTable,
          mode: gl.clock.mode,
          hour: gl.clock.hour,
          loop: gl.clock.loop ? { ...gl.clock.loop } : null
        };
      }
      clearTimeout(this.focusTimer); this.focusTimer = 0;
      this.focusEl = null;
      const saved = this.preTourState;
      gl.options.sunTable = table;
      gl.tableVersion++;
      const dur = Number(opts.duration) || 10000;
      if (opts.loop !== false) {
        gl.setLoopSpec({
          from: 0,
          to: 24,
          duration: dur,
          bounce: opts.bounce !== undefined ? !!opts.bounce : !opts.closed
        }, true);
      }
      this.preTourState = saved;
      this.wake(true, true);
      const defaultLease = Math.max(Number(gl.options.focusLease) || 8000, dur);
      const lease = opts.lease !== undefined ? Number(opts.lease) : defaultLease;
      if (Number.isFinite(lease) && lease > 0) {
        this.tourTimer = setTimeout(() => { this.tourTimer = 0; this.tour(null); }, lease);
      }
      return table;
    }
  }

  class Instance {
    constructor(options) {
      this.options = { ...DEFAULTS, ...options };
      const o = this.options;
      this.root = o.root || document.body;
      this.root.style.setProperty("--gl-dim", String(Math.max(0, Math.min(1, Number(o.dim) || 0))));
      this.root.style.setProperty("--torch-r", `${Math.max(0, Number(o.torchRadius) || 0)}px`);
      this.root.style.setProperty("--sun-r", `${Math.round(Math.max(0, Number(o.torchRadius) || 0) * SUN_TORCH_SCALE)}px`);
      this.sunTorched = new Set();
      this.scrollers = new Set();
      this.photoFading = []; // setPhoto 正在淡出的旧底片，unmount 时一起收
      this.shownPhoto = null; // 当前挂着的底片 URL（photo 模式）
      this.torched = new Set(); this.torchEls = []; this.torchPos = null; this.torchFocus = null; this.torchRaf = 0;
      this.tracked = []; this.trackRaf = 0; this.observer = null; this.observeTimer = 0;
      this.camera = new Camera(this); // 运镜：弹簧、巡航、焦点租期都在它那
      this.clock = { mode: "manual", hour: 12 };
      this.setTimeOption(o.time);
      this.background = "none";
      this.state = null;
      this.lamp = null;
      this.canvases = { lamp: null };
      this.photoLayers = [];  // photo 模式的单层 div
      this.tableVersion = 0;  // 换表就加一：灯的静态层按它判断要不要重画
      this.scrolling = false;
      this.settleTimer = 0;
      this.rafId = 0;
      this.clockTimer = 0;
      this.stopped = false;
      this.destroyed = false;
      this.listeners = [];
      this.root[INSTANCE_KEY] = this;

      if (o.lampOverlay) this.lamp = new Lamp(this.canvases.lamp = makeCanvas("gl-layer-lamp"));
      this.mountBackground(o.background);
      this.bind();
      this.update();
      this.scheduleRelight();
      this.startClock();
      this.camera.initFocus();
    }

    // ---- 背景层 ------------------------------------------------------------
    mountBackground(mode) {
      if (!BACKGROUNDS.includes(mode)) mode = "none";
      this.background = mode;
      // 照片：零画布、单层 div（::before 纯黑白灰阶底片 + ::after 太阳探照灯遮罩，外层 isolation + screen 叠上黑位地板）
      if (mode === "photo") this.photoLayers = [this.makePhotoLayer(this.options.photo)];
      this.placeLayers();
    }
    makePhotoLayer(url) {
      const photo = document.createElement("div");
      photo.className = "gl-layer gl-layer-photo";
      if (url) photo.style.backgroundImage = `url("${String(url).replace(/"/g, "%22")}")`;
      photo.__glPhotoUrl = url || null;
      this.shownPhoto = url || null;
      return photo;
    }
    // 层的顺序（从下到上）：照片、灯。都插在 root 最前面
    placeLayers() {
      const order = [...this.photoLayers, this.canvases.lamp].filter(Boolean);
      for (const el of order.reverse()) this.root.prepend(el);
    }
    unmountBackground() {
      for (const el of this.photoLayers) { clearTimeout(el.__glFadeTimer); el.remove(); }
      for (const el of this.photoFading) { clearTimeout(el.__glFadeTimer); el.remove(); }
      this.photoLayers = []; this.photoFading = []; this.shownPhoto = null;
      this.background = "none";
    }

    // ---- 时钟 ----------------------------------------------------------------
    // 时钟只回答"现在几点"，和"几点钟长什么样"（表 / 公式）无关。
    //   realtime  跟真实时间     fixed  定住一帧     loop  区间来回     external  宿主推
    setTimeOption(t) {
      if (typeof t === "number" && Number.isFinite(t)) { this.clock.mode = "fixed"; this.clock.hour = ((t % 24) + 24) % 24; }
      else if (t === "timelapse") {
        const cur = Number.isFinite(this.clock.hour) ? this.clock.hour : 0;
        this.setLoopSpec({ from: cur, to: cur, duration: this.options.timelapseDuration, bounce: false }, false);
      }
      else if (t && typeof t === "object" && t.loop) this.setLoopSpec(t.loop, false);
      else if (t === "external") { this.clock.mode = "external"; if (!Number.isFinite(this.clock.hour)) this.clock.hour = nowHour(); }
      else if (t === "fixed" || t === "manual") { this.clock.mode = "fixed"; if (!Number.isFinite(this.clock.hour)) this.clock.hour = nowHour(); }
      else { this.clock.mode = "realtime"; this.clock.hour = nowHour(); }
    }
    setLoopSpec(spec, restart = true) {
      const from = ((Number(spec?.from ?? 0) % 24) + 24) % 24;
      const toRaw = Number(spec?.to ?? 24);
      const span = ((toRaw - from) % 24 + 24) % 24 || 24; // from→to 顺时针跨度，to==from 当一整天
      this.clock.mode = "loop";
      this.clock.loop = { from, span, duration: Math.max(200, Number(spec?.duration) || 24000), bounce: !!spec?.bounce, start: performance.now() };
      this.clock.hour = from;
      if (restart && !this.stopped) this.startClock();
    }
    loopHour(now = performance.now()) {
      const L = this.clock.loop;
      if (!L) return this.clock.hour;
      let phase = ((now - L.start) / L.duration) % 1;
      if (L.bounce) phase = 1 - Math.abs(1 - 2 * phase); // 三角波：去了再回来
      const raw = L.from + phase * L.span;
      return this.options.sunTable?.open && raw <= 24 ? raw : (raw % 24);
    }
    currentHour() {
      if (this.clock.mode === "realtime") return nowHour();
      if (this.clock.mode === "loop") return this.loopHour();
      return this.clock.hour;
    }
    startClock() {
      this.stopClock();
      const o = this.options;
      if (this.clock.mode === "loop") {
        this.clockTimer = setInterval(() => this.update(), LOOP_TICK);
      } else if (this.clock.mode === "realtime") {
        this.clockTimer = setInterval(() => this.update(), o.realtimeInterval);
      }
      // fixed / external：不走定时器
    }
    stopClock() { if (this.clockTimer) { clearInterval(this.clockTimer); this.clockTimer = 0; } }

    // ---- 太阳状态：算一次、发给灯和 root ------------------------------------
    // 砖和卡片的材质直接走 CSS 常数，底片永远纯黑白灰阶，所以这里只碰灯和 root（探照灯坐标、微弱明度呼吸）。
    computeOrbitalState(hour, W, H) {
      return this.options.sunTable ? stateFromTable(this.options.sunTable, hour, W, H) : computeSunState(hour, W, H);
    }
    update() {
      if (this.destroyed) return;
      const [W, H] = viewport();
      const hour = this.currentHour();
      this.clock.hour = hour;
      const orb = this.computeOrbitalState(hour, W, H);
      const cam = this.camera;
      if (cam.active) {
        // 离轨借光期间：若未聚焦元素（回轨途中）且轨道钟本身在走，唤醒弹簧继续追当前轨道位置
        if (!cam.focusEl && cam.parked) cam.wake(false);
        this.state = cam.stateFor(orb, W, H);
      } else {
        this.state = orb;
      }
      if (this.lamp && !document.hidden) this.lamp.draw(this.state, hour, W, H, this.lampOpts(W, H));
      applySunVars(this.root, this.state);
      if (this.options.torch && this.options.sunTorch) this.scheduleTorch(); // 太阳挪了，它那支手电也要重探（rAF 合并）
      this.options.onUpdate?.(this.state);
    }

    // 灯的轨迹按"几点钟灯在哪"那张表画：有表按表采样，没表用公式；loop 模式把区间传过去加亮
    lampOpts(W, H) {
      const table = this.options.sunTable;
      const open = !!table?.open;
      const path = table
        ? (h) => { const s = stateFromTable(table, h, W, H); return { x: s.sunX, y: s.sunY, isDay: s.isDay }; }
        : Lamp.formulaPath(W, H);
      const L = this.clock.mode === "loop" && this.clock.loop?.span < 24 && !open ? this.clock.loop : null;
      return {
        path,
        pathKey: table ? `table${this.tableVersion}` : "formula",
        loop: L ? { from: L.from, span: L.span } : null,
        open,
        trail: this.camera.active ? this.camera.trail : null
      };
    }

    // ---- 手电目标扫描与矩形测量 -----------------------------------------------
    // 控件的 1px 环与玻璃内胆直接焊死在 glacier.css 里，零内联变量写入；
    // 这里只找受手电探测的元素并读一轮矩形（滚动中不量，停下再量）
    scheduleRelight() {
      if (this.rafId || this.destroyed) return;
      this.rafId = requestAnimationFrame(() => {
        this.rafId = 0;
        this.relightNow();
      });
    }
    relightNow() {
      if (this.destroyed) return;
      const o = this.options;
      this.torchEls = o.torch ? Array.from(this.root.querySelectorAll(o.torchSelector)) : [];
      this.tracked = (o.torch && o.trackSelector) ? this.torchEls.filter((el) => el.matches(o.trackSelector)) : [];
      if ((this.torchEls.length || this.camera.focusEl) && !this.scrolling) this.measureRects();
      if (this.tracked.length) this.startTracking();
      if (this.torchEls.length) this.scheduleTorch(); // 矩形刚量好：两支手电（鼠标、太阳）按新矩形探一轮
    }
    // 砖在哪、多大：纯读一轮矩形给手电与离轨焦点用，零 DOM 样式写入
    measureRects() {
      for (const el of this.torchEls) if (el.isConnected) el.__glRect = rectOf(el.getBoundingClientRect());
      if (this.camera.focusEl && this.camera.focusEl.isConnected && !this.torchEls.includes(this.camera.focusEl)) {
        this.camera.focusEl.__glRect = rectOf(this.camera.focusEl.getBoundingClientRect());
      }
      this.syncScrollers();
    }
    // 矩形刚量完，每个滚动容器的基线就是此刻的 scrollTop；砖的归属缓存也作废（可能有新砖）
    syncScrollers() {
      for (const sc of this.scrollers) {
        if (!sc.isConnected) { this.scrollers.delete(sc); continue; }
        sc.__glScrollPos = { x: sc.scrollLeft, y: sc.scrollTop };
        delete sc.__glBricks;
      }
    }
    // ---- 会动的节点：逐帧跟踪 --------------------------------------------------
    // 只对 trackSelector 命中的元素做：每帧量一次矩形（这是本库唯一的逐帧布局读取，所以只给会动的东西用），
    // 挪了半个像素以上就让手电重新探测。一个都没有时循环自动停。
    startTracking() {
      if (this.trackRaf || this.destroyed) return;
      this.trackRaf = requestAnimationFrame(() => this.trackFrame());
    }
    trackFrame() {
      this.trackRaf = 0;
      if (this.destroyed) return;
      this.tracked = this.tracked.filter((el) => el.isConnected);
      if (!this.tracked.length) return;
      let moved = false;
      for (const el of this.tracked) {
        const b = el.getBoundingClientRect();
        if (sameRect(el.__glRect, b)) continue;
        el.__glRect = rectOf(b);
        moved = true;
      }
      if (moved && this.anyTorchLit()) { this.applyTorch(); if (this.options.sunTorch) this.applySunTorch(); }
      if (moved && this.camera.focusEl && this.tracked.includes(this.camera.focusEl)) this.camera.wake(false, false);
      this.trackRaf = requestAnimationFrame(() => this.trackFrame());
    }
    // ---- 节点增删与 data-gl-focus 属性监听：挂上总线即受光，贴上属性即运镜 ----
    // 1. 节点增删：只看增删的节点本身是不是（或装着）手电目标元素，命中就隔 120ms 重量一轮；
    // 2. data-gl-focus：属性变更或新插入带 data-gl-focus 的节点时，太阳游标自动脱离轨道滑向最新那一个（data-gl-alert 只亮红灯芯、绝不抢镜头）。
    observeRoot() {
      const sel = this.options.torchSelector;
      const hits = (nodes) => {
        if (!this.options.torch || !sel) return false;
        for (const n of nodes) { if (n.nodeType !== 1) continue; if (n.matches(sel) || (n.firstElementChild && n.querySelector(sel))) return true; }
        return false;
      };
      const findFocusIn = (nodes) => {
        let found = null;
        for (const n of nodes) {
          if (n.nodeType !== 1) continue;
          if (n.hasAttribute("data-gl-focus")) found = n;
          if (n.firstElementChild) {
            const all = n.querySelectorAll("[data-gl-focus]");
            if (all.length) found = all[all.length - 1];
          }
        }
        return found;
      };
      this.observer = new MutationObserver((records) => {
        let needRelight = false;
        let nextFocus = undefined;
        for (const m of records) {
          if (m.type === "attributes" && m.attributeName === "data-gl-focus") {
            const el = m.target;
            if (el.nodeType === 1 && el.hasAttribute("data-gl-focus")) nextFocus = el;
            else if (el === this.camera.focusEl) nextFocus = null;
          } else if (m.type === "childList") {
            if (hits(m.addedNodes) || hits(m.removedNodes)) needRelight = true;
            const addedFocus = findFocusIn(m.addedNodes);
            if (addedFocus) nextFocus = addedFocus;
            else if (this.camera.focusEl && !this.camera.focusEl.isConnected) nextFocus = null;
          }
        }
        if (needRelight) this.scheduleObservedRelight();
        if (nextFocus !== undefined) {
          if (nextFocus) {
            this.focus(nextFocus); // 租期从属性里读，focus() 自己会解析
          } else {
            this.focus(null);
          }
        }
      });
      this.observer.observe(this.root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-gl-focus"] });
    }
    scheduleObservedRelight() {
      clearTimeout(this.observeTimer);
      this.observeTimer = setTimeout(() => { this.observeTimer = 0; this.scheduleRelight(); }, 120);
    }
    // ---- 滚动：期间不读布局，只平移缓存矩形让手电与离轨焦点跟着砖走；停下 settleDelay 后再真量一轮纠偏 ----
    onScroll(sc) {
      this.scrolling = true;
      if (sc && (this.torchEls.length || this.camera.focusEl)) {
        const prev = sc.__glScrollPos;
        const now = { x: sc.scrollLeft, y: sc.scrollTop };
        sc.__glScrollPos = now;
        if (prev) {
          const dx = now.x - prev.x, dy = now.y - prev.y;
          if (dx || dy) {
            const inside = sc.__glBricks || (sc.__glBricks = this.torchEls.filter((el) => sc === document.scrollingElement || sc.contains(el)));
            for (const el of inside) {
              const r = el.__glRect;
              if (!r) continue;
              r.left -= dx; r.right -= dx; r.top -= dy; r.bottom -= dy;
            }
            if (this.camera.focusEl && this.camera.focusEl.__glRect && !inside.includes(this.camera.focusEl) && (sc === document.scrollingElement || sc.contains(this.camera.focusEl))) {
              const fr = this.camera.focusEl.__glRect;
              fr.left -= dx; fr.right -= dx; fr.top -= dy; fr.bottom -= dy;
            }
            if (this.anyTorchLit()) this.scheduleTorch();
            if (this.camera.focusEl) this.camera.wake(false, false);
          }
        }
      }
      clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => {
        this.settleTimer = 0;
        this.scrolling = false;
        if (this.torchEls.length || this.camera.focusEl) this.measureRects();
        if (this.anyTorchLit()) this.scheduleTorch();
        if (this.camera.focusEl) this.camera.wake(false, false);
      }, this.options.settleDelay);
    }

    // ---- 监听器 --------------------------------------------------------------
    bind() {
      const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); this.listeners.push([target, type, fn, opts]); };
      on(window, "resize", () => {
        this.scheduleRelight();
        if (this.camera.focusEl) this.camera.wake(false, false);
        this.update();
      });
      // 纯前端导演通道：window 自定义事件 glacier:light + 地址栏 #gl-focus=xxx
      on(window, "glacier:light", (e) => {
        const d = e?.detail || {};
        if (Array.isArray(d.path)) this.tour(d.path, d);
        else if ("target" in d) this.focus(d.target, d);
        else if (d.clear || d.reset) { this.focus(null); this.tour(null); }
      });
      on(window, "hashchange", () => this.camera.applyHashFocus());
      if (this.options.observe) this.observeRoot();
      if (this.options.torch) {
        // 整页滚动器先登记：首轮量矩形时就记下基线，第一下滚轮的位移不会丢
        const page = document.scrollingElement || document.documentElement;
        this.scrollers.add(page);
        on(document, "scroll", (e) => {
          const t = e.target;
          const sc = t === document ? page : t;
          if (!sc || sc.nodeType !== 1) { this.onScroll(null); return; }
          if (!this.scrollers.has(sc)) {
            // 第一次见到的子容器：scroll 事件到达时它已经滚完了，没法知道滚了多少，
            // 所以真量一轮当基线（一个容器一辈子只多付这一次），而不是把滚完的位置当起点
            this.scrollers.add(sc);
            if (this.torchEls.length || this.camera.focusEl) this.measureRects(); else this.syncScrollers();
            if (this.anyTorchLit()) this.scheduleTorch(); // 矩形刚变，这一帧手电就按新位置重探
          }
          this.onScroll(sc);
        }, { capture: true, passive: true });
        const sel = this.options.torchSelector;
        on(document, "pointerdown", (e) => { this.torchPos = { x: e.clientX, y: e.clientY }; this.scheduleTorch(); }, { passive: true });
        on(document, "pointermove", (e) => { this.torchPos = { x: e.clientX, y: e.clientY }; this.scheduleTorch(); }, { passive: true });
        on(document, "pointerleave", () => { this.torchPos = null; this.scheduleTorch(); });
        on(this.root, "focusin", (e) => { const el = e.target?.closest?.(sel); this.torchFocus = el || null; this.scheduleTorch(); });
        on(this.root, "focusout", () => { this.torchFocus = null; this.scheduleTorch(); });
        on(this.root, "input", (e) => { if (e.target?.matches?.(sel)) this.scheduleTorch(); }); // 滑块值变了，焦点补光跟到新游标位置
      }
      on(document, "visibilitychange", () => { if (!document.hidden) this.update(); }); // 回前台补一帧
    }
    unbind() {
      for (const [t, type, fn, opts] of this.listeners) t.removeEventListener(type, fn, opts);
      this.listeners.length = 0;
      clearTimeout(this.settleTimer); this.settleTimer = 0;
      if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = 0; }
      if (this.torchRaf) { cancelAnimationFrame(this.torchRaf); this.torchRaf = 0; }
      if (this.trackRaf) { cancelAnimationFrame(this.trackRaf); this.trackRaf = 0; }
      clearTimeout(this.observeTimer); this.observeTimer = 0;
      if (this.observer) { this.observer.disconnect(); this.observer = null; }
      this.tracked = [];
    }

    // ---- 鼠标手电 ------------------------------------------------------------
    // 不读布局：用量好的矩形（el.__glRect）。每帧只给半径内的砖写"鼠标相对我的坐标"，离开半径的砖把变量删掉；
    // 其它砖根本不知道鼠标在动，所以几百块砖也不重绘全页。
    scheduleTorch() {
      if (this.torchRaf || this.destroyed) return;
      this.torchRaf = requestAnimationFrame(() => { this.torchRaf = 0; this.applyTorch(); if (this.options.sunTorch) this.applySunTorch(); });
    }
    // 有没有哪支手电亮着：鼠标在窗口里、有键盘焦点、或者开了太阳手电（它永远在走）。矩形一变就得重探
    anyTorchLit() { return !!(this.torchPos || this.torchFocus || this.options.sunTorch); }
    // 一支手电照一轮：光源 (x, y)、半径 R，半径内的砖写 vars = [x, y, a] 三个变量（相对砖左上角的坐标 + 亮度），
    // 上一轮亮着、这一轮不在半径内的砖把变量删掉。两支手电（鼠标、太阳）都走这里，只是光源、半径、变量名、亮度不同
    lightBricks(x, y, R, vars, alpha, prev) {
      const keep = new Set(), R2 = R * R;
      if (R > 0 && Number.isFinite(x) && Number.isFinite(y)) {
        for (const el of this.torchEls) {
          const r = el.__glRect;
          if (!r || !el.isConnected) continue;
          const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
          const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
          if (dx * dx + dy * dy > R2) continue;
          this.setLight(el, vars, x - r.left, y - r.top, alpha);
          keep.add(el);
        }
      }
      return keep;
    }
    setLight(el, vars, x, y, alpha) {
      const st = el.style, vx = `${x.toFixed(1)}px`, vy = `${y.toFixed(1)}px`;
      if (st.getPropertyValue(vars[0]) !== vx) st.setProperty(vars[0], vx);
      if (st.getPropertyValue(vars[1]) !== vy) st.setProperty(vars[1], vy);
      if (st.getPropertyValue(vars[2]) !== alpha) st.setProperty(vars[2], alpha);
    }
    static release(prev, keep, vars) { for (const el of prev) if (!keep.has(el)) for (const k of vars) el.style.removeProperty(k); }
    static focusPoint(el, r) {
      if (el.type === "range") {
        const min = el.min !== "" && Number.isFinite(Number(el.min)) ? Number(el.min) : 0;
        const max = el.max !== "" && Number.isFinite(Number(el.max)) ? Number(el.max) : 100;
        const val = Number(el.value);
        const t = max > min && Number.isFinite(val) ? Math.max(0, Math.min(1, (val - min) / (max - min))) : 0.5;
        return [7 + t * Math.max(0, r.width - 14), r.height / 2];
      }
      return [r.width / 2, r.height / 2];
    }
    // 太阳手电：光源是轨道游标在视口里的位置，半径 1.5 倍，亮度跟 glow 走，夜里暗一点。
    // 只照不动：不加类、不改状态、不派事件。钟不许停，所以它永远在走
    applySunTorch() {
      if (this.destroyed || !this.state) return;
      const R = Math.max(0, Number(this.options.torchRadius) || 0) * SUN_TORCH_SCALE;
      const a = (0.3 + 0.5 * (this.state.lampGlow ?? 1)).toFixed(2);
      const keep = this.lightBricks(this.state.sunX, this.state.sunY, R, SUN_TORCH_VARS, a);
      Instance.release(this.sunTorched, keep, SUN_TORCH_VARS);
      this.sunTorched = keep;
    }
    // 鼠标手电：光源是指针。键盘焦点（:focus-visible，含容器里聚焦的输入框）且没被指针照到时，把光补在元素中心（滑块补在游标处）；
    // 鼠标点出来的焦点不补光，免得指针走开后元素中间还挂着一团光。每轮当场判断，不缓存状态，键盘一动 :focus-visible 就回来
    applyTorch() {
      if (this.destroyed) return;
      const R = Math.max(0, Number(this.options.torchRadius) || 0);
      const p = this.torchPos, f = this.torchFocus;
      const keep = p ? this.lightBricks(p.x, p.y, R, TORCH_VARS, "1") : new Set();
      const keyboardFocus = (el) => { try { return el.matches(":focus-visible") || !!el.querySelector(":focus-visible"); } catch { return true; } };
      if (f && !keep.has(f) && f.__glRect && f.isConnected && keyboardFocus(f)) {
        const [fx, fy] = Instance.focusPoint(f, f.__glRect);
        this.setLight(f, TORCH_VARS, fx, fy, "1");
        keep.add(f);
      }
      Instance.release(this.torched, keep, TORCH_VARS);
      this.torched = keep;
    }

    // ---- 公开句柄 ------------------------------------------------------------
    /** 当前太阳状态（位置、光色） */
    get sun() { return this.state; }
    get hour() { return this.currentHour(); }
    get mode() { return this.clock.mode; }
    /** 定在某个小时（fixed）；external 模式下也用它推时间（保持 external） */
    setHour(h) {
      this.camera.clearTourLease();
      this.clock.hour = ((Number(h) % 24) + 24) % 24;
      if (this.clock.mode !== "external") { this.clock.mode = "fixed"; this.stopClock(); }
      this.update();
      return this.clock.hour;
    }
    /** "realtime" | "fixed" | "loop" | "external" | "timelapse"（= 一天循环）；"manual" 等于 "fixed" */
    setMode(mode) {
      this.camera.clearTourLease();
      if (mode === "loop" && this.clock.loop) { this.clock.mode = "loop"; this.clock.loop.start = performance.now(); }
      else if (mode === "loop") this.setLoopSpec({ from: 0, to: 24, duration: this.options.timelapseDuration }, false);
      else this.setTimeOption(mode === "manual" ? "fixed" : mode);
      if (!this.stopped) this.startClock();
      this.update();
      return this.clock.mode;
    }
    /** 在某个区间来回：setLoop({ from: 16, to: 19, duration: 12000, bounce: true }) */
    setLoop(spec) { this.camera.clearTourLease(); this.setLoopSpec(spec, true); this.update(); return { ...this.clock.loop }; }
    /** 换"几点钟长什么样"的表；null 回到内置公式。Glacier.sun.sampleTable() 采一张来改 */
    setSunTable(table) { this.camera.clearTourLease(); this.options.sunTable = Array.isArray(table) && table.length ? table : null; this.tableVersion++; this.update(); return this.options.sunTable; }
    /** 焦点元素（借光中）；弹簧内部状态见 camera.spring */
    get focusEl() { return this.camera.focusEl; }
    get spring() { return this.camera.spring; }
    /** 定点借光：见 Camera.focus */
    focus(target, opts) { return this.camera.focus(target, opts); }
    /** 多点星轨巡航：见 Camera.tour */
    tour(targets, opts) { return this.camera.tour(targets, opts); }
    /** 换背景模式：none | photo（背景层原地重建，冰砖不动） */
    setBackground(mode) {
      this.unmountBackground();
      this.options.background = mode;
      this.mountBackground(mode);
      this.update();
      return this.background;
    }
    /** 换底片。photo 模式下先把图解码完（不在主线程上卡那几十毫秒），再把新底片压在旧底片上淡入（CSS 过渡）；
     *  其它模式只记下，下次切到 photo 用。一个航点一张底片。宿主可以提前 Glacier.preloadPhoto(url) 让跃迁零等待 */
    setPhoto(url) {
      const target = url || null;
      this.options.photo = target;
      if (this.background !== "photo" || this.destroyed) return target;
      if (target === this.shownPhoto) return target; // 已经是当前底片：不动
      preloadPhoto(target).then(() => {
        if (this.destroyed || this.background !== "photo" || this.options.photo !== target || target === this.shownPhoto) return;
        const old = this.photoLayers[0];
        // 高频来回切（A → B → A）时，若 A 还在 photoFading 里淡出，直接原地救回（screen 混合满足交换律，不搬动 DOM 节点就不会打断 CSS 过渡）
        let next = this.photoFading.find((el) => el.__glPhotoUrl === target);
        if (next) {
          clearTimeout(next.__glFadeTimer);
          this.photoFading = this.photoFading.filter((el) => el !== next);
          this.shownPhoto = target;
          next.style.opacity = "";
        } else {
          next = this.makePhotoLayer(target);
          next.style.opacity = "0";
          if (old) old.after(next); else this.root.prepend(next);
          void getComputedStyle(next).opacity; // 立即提交 0 初值，同一微任务内直接切回 CSS 目标值，零定时器竞态
          next.style.opacity = "";
        }
        this.photoLayers = [next];
        if (old && old !== next) {
          clearTimeout(old.__glFadeTimer);
          if (!this.photoFading.includes(old)) this.photoFading.push(old);
          old.style.opacity = "0";
          old.__glFadeTimer = setTimeout(() => {
            old.remove();
            this.photoFading = this.photoFading.filter((el) => el !== old);
          }, 750);
        }
      });
      return target;
    }
    /** 重新扫描手电目标并量一轮矩形（宿主自己改了布局且没开 observe 时调）。下一帧做 */
    relight() { this.scheduleRelight(); }
    /** 暂停：时钟停，DOM 留着 */
    stop() {
      this.stopped = true; this.stopClock();
      this.camera.pause();
      return this;
    }
    /** 从 stop() 恢复 */
    start() {
      this.stopped = false; this.startClock(); this.update();
      this.camera.resume();
      return this;
    }
    /** 全部收回：画布、监听器、定时器、root 和冰砖上的手电变量 */
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.stopClock();
      this.unbind();
      this.unmountBackground();
      this.canvases.lamp?.remove(); this.canvases.lamp = null; this.lamp = null;
      const rs = this.root.style;
      for (const k of [...SUN_VARS, "--torch-r", "--sun-r", "--gl-dim"]) rs.removeProperty(k);
      for (const el of this.torchEls) delete el.__glRect;
      this.camera.dispose();
      for (const el of this.torched) for (const k of TORCH_VARS) el.style.removeProperty(k);
      for (const el of this.sunTorched) for (const k of SUN_TORCH_VARS) el.style.removeProperty(k);
      this.torched.clear(); this.sunTorched.clear(); this.torchEls = [];
      if (this.root[INSTANCE_KEY] === this) delete this.root[INSTANCE_KEY];
      this.state = null;
    }
  }

  /**
   * 装到页面上。同一个 root 上重复 init 会先 destroy 上一个（热重载 / 换选项都安全）。
   * @returns {Instance} 句柄：setHour, setMode, setLoop, setSunTable, focus, tour, setBackground, setPhoto,
   *                     relight, start, stop, destroy, sun, hour, mode, background, lamp, options
   */
  Glacier.init = (options = {}) => {
    const root = options.root || document.body;
    root[INSTANCE_KEY]?.destroy?.();
    // 上一个脚本实例（热重载）可能留下画布：清掉
    for (const c of root.querySelectorAll(":scope > .gl-layer")) c.remove();
    return new Instance(options);
  };
  Glacier.Instance = Instance;

  global.Glacier = Glacier;
  if (typeof module !== "undefined" && module.exports) module.exports = Glacier;
})(typeof window !== "undefined" ? window : globalThis);
