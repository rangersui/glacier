/**
 * glacier.js — Glacier（星舰冰川）设计语言的独立浏览器库
 *
 * 一盏灯，三个消费者，加一个把它们装到页面上的 init()：
 *   Glacier.sun          太阳模型：时间 → 位置（横跨整个视口的轨道）→ 四组光色；关键帧表 sampleTable / stateFromTable
 *   Glacier.Scene        背景：深空 + 星点 + 沙丘行星 + 日冕（960×600 画布）、解析山体阴影（480×320 画布）
 *   Glacier.Lamp         灯 overlay：柔光球 + 轨迹弧 + 刻度 + 当前时间
 *   Glacier.lightWidget  控件受光解算器：按光的方向给一个元素写刀锋向量 / 墙向量 / 光锥角（五个 --ice-* 变量）
 *   Glacier.applySunVars 把四组光色和字影浓度写到一个元素（通常是 body）上
 *   Glacier.init(options) 建画布、起太阳、画灯、给所有 .gl-brick / .gl-card 打光、鼠标手电，
 *                         返回句柄 { setHour, setMode, setLoop, setSunTable, setSector, setShip, setBackground, relight, stop, destroy, sun … }
 *   挂上总线即受光：root 里新出现的 .gl-* 节点自动纳入（observe），会动的节点加 data-gl-track 逐帧跟着被手电探测
 *
 * 性能守则同 DESIGN.md §13：画布只在灯动了才重画、渐变 / 贴图缓存、同值不写、读写分离、滚动中不读布局。
 * 默认的平行光（lightDirection: "fixed"）下砖的受光和位置无关，写一次永远对，滚动、对表都不碰砖。
 *
 * 只有一个全局：window.Glacier（CommonJS 环境下同时 module.exports）。除了 init() 创建的画布，
 * 不碰宿主没要求的任何元素；destroy() 把画布、监听器、变量全部收回。
 */
(function (global) {
  "use strict";
  const Glacier = {};

  // ==========================================================================
  // 1. 太阳模型（模块 4）
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

  const computeSunState = (hour, W, H) => {
    const p = lampPointAt(hour, W, H);
    const h = ((hour % 24) + 24) % 24;
    const { u, isDay } = p;
    let sunCrest, sunSheen, sunTint, sunCaustic, orbCore, orbCorona, orbRayColor;
    if (isDay) {
      if (h >= 15.8 || h <= 8.2) {
        sunCrest = "rgba(255, 206, 145, 0.94)";
        sunSheen = "rgba(255, 200, 140, 0.34)";
        sunTint = "rgba(255, 145, 105, 0.42)";
        sunCaustic = "rgba(55, 175, 255, 0.45)";
        orbCore = "#FFFDF5";
        orbCorona = h >= 15.8 ? "#FF9E44" : "#FF9EB5";
        orbRayColor = h >= 15.8 ? "#FFD285" : "#FFC4D6";
      } else {
        sunCrest = "rgba(240, 252, 255, 0.95)";
        sunSheen = "rgba(220, 245, 255, 0.34)";
        sunTint = "rgba(110, 210, 255, 0.40)";
        sunCaustic = "rgba(42, 195, 222, 0.42)";
        orbCore = "#FFFFFF";
        orbCorona = "#7DCFFF";
        orbRayColor = "#E0F7FF";
      }
    } else {
      sunCrest = "rgba(180, 232, 255, 0.88)";
      sunSheen = "rgba(165, 215, 255, 0.26)";
      sunTint = "rgba(187, 154, 247, 0.38)";
      sunCaustic = "rgba(122, 162, 247, 0.34)";
      orbCore = "#F0F8FF";
      orbCorona = "#BB9AF7";
      orbRayColor = "#C4B5FD";
    }
    const horizon = Math.max(0, Math.min(1, (H * 1.02 - p.y) / (H * 0.3)));
    const lampGlow = (isDay ? 1 : 0.45) * horizon;
    return {
      h, u, isDay, hour,
      W, H,
      sunX: p.x, sunY: p.y,
      orbScreenX: p.x, orbScreenY: p.y,
      sunU: p.x / W, sunV: p.y / H,
      lampGlow,
      sunCrest, sunSheen, sunTint, sunCaustic, orbCore, orbCorona, orbRayColor
    };
  };
  Glacier.sun = { lampPointAt, computeSunState };

  // ---- 关键帧表："几点钟长什么样"是一张表，上面的公式只是默认那张 ----------------------
  // 关键帧：{ hour, u, v, glow, isDay, sunCrest, sunSheen, sunTint, sunCaustic, orbCore, orbCorona, orbRayColor }
  //   u / v  灯在视口里的归一化位置（0–1，可超出）；glow 灯的亮度 0–1；颜色是 rgba(...) 或 #hex。
  //   少写的字段用公式在同一小时的值补齐，所以只写想改的就行。相邻两帧之间线性插值（颜色按通道插），
  //   最后一帧到第一帧跨午夜接上。
  const COLOR_KEYS = ["sunCrest", "sunSheen", "sunTint", "sunCaustic", "orbCore", "orbCorona", "orbRayColor"];
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
  const lerpColor = (a, b, t) => {
    const A = parseColor(a), B = parseColor(b);
    if (!A || !B) return t < 0.5 ? a : b;
    const v = A.map((x, i) => lerp(x, B[i], t));
    if (/^#/.test(String(a).trim()) && /^#/.test(String(b).trim()) && v[3] >= 0.999) {
      return "#" + v.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, "0")).join("").toUpperCase();
    }
    return `rgba(${Math.round(v[0])}, ${Math.round(v[1])}, ${Math.round(v[2])}, ${+v[3].toFixed(3)})`;
  };
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
  /** 按表算某个小时的太阳状态（和 computeSunState 同样的返回结构） */
  const stateFromTable = (table, hour, W, H) => {
    if (!Array.isArray(table) || !table.length) return computeSunState(hour, W, H);
    const h = ((hour % 24) + 24) % 24;
    const kf = table
      .filter((k) => Number.isFinite(k?.hour))
      .map((k) => ({ ...frameFromModel(k.hour), ...k, hour: ((k.hour % 24) + 24) % 24 }))
      .sort((a, b) => a.hour - b.hour);
    if (!kf.length) return computeSunState(hour, W, H);
    let a, b, t;
    const i = kf.findIndex((k) => k.hour > h);
    if (i <= 0) {
      a = kf[kf.length - 1]; b = kf[0];
      const span = ((b.hour - a.hour) % 24 + 24) % 24 || 24;
      t = (((h - a.hour) % 24) + 24) % 24 / span;
    } else {
      a = kf[i - 1]; b = kf[i];
      t = (h - a.hour) / ((b.hour - a.hour) || 1);
    }
    if (kf.length === 1) { b = a; t = 0; }
    const u = lerp(a.u, b.u, t), v = lerp(a.v, b.v, t), glow = Math.max(0, Math.min(1, lerp(a.glow, b.glow, t)));
    const isDay = t < 0.5 ? !!a.isDay : !!b.isDay;
    const st = {
      h, u: lampPointAt(h, W, H).u, isDay, hour: h, W, H,
      sunX: u * W, sunY: v * H, orbScreenX: u * W, orbScreenY: v * H,
      sunU: u, sunV: v, lampGlow: glow
    };
    for (const k of COLOR_KEYS) st[k] = lerpColor(a[k], b[k], t);
    return st;
  };
  Glacier.sun = { lampPointAt, computeSunState, sampleTable, stateFromTable, frameFromModel };

  // ==========================================================================
  // 2. 星区配色 + 解析地形 + 山体阴影 + 背景场景（模块 7）
  // ==========================================================================
  const SECTOR_PALETTES = {
    cryo_blend: {
      spaceBg: ["rgba(4, 7, 15, 0.72)", "rgba(8, 15, 30, 0.80)"],
      atmoDay: "rgba(56, 189, 248, 0.62)", atmoTerm: "rgba(255, 168, 76, 0.78)", atmoNight: "rgba(12, 28, 64, 0.30)",
      planetDay: "#88d4f8", planetMid: "#1b4d82", planetNight: "#030712",
      cityLights: "rgba(255, 185, 100, 0.68)",
      nebula1: "rgba(38, 128, 215, 0.20)", nebula2: "rgba(255, 138, 75, 0.16)"
    },
    cryo_pure: {
      spaceBg: ["#03050c", "#070d1c"],
      atmoDay: "rgba(65, 205, 255, 0.85)", atmoTerm: "rgba(255, 175, 85, 0.92)", atmoNight: "rgba(14, 36, 82, 0.42)",
      planetDay: "#aee6ff", planetMid: "#1d5690", planetNight: "#030611",
      cityLights: "rgba(255, 195, 110, 0.82)",
      nebula1: "rgba(42, 145, 235, 0.26)", nebula2: "rgba(255, 140, 72, 0.22)"
    },
    red_giant: {
      spaceBg: ["#090306", "#16070c"],
      atmoDay: "rgba(255, 115, 65, 0.85)", atmoTerm: "rgba(255, 215, 115, 0.94)", atmoNight: "rgba(95, 18, 32, 0.42)",
      planetDay: "#ff9b72", planetMid: "#6e1d2a", planetNight: "#080205",
      cityLights: "rgba(255, 225, 145, 0.82)",
      nebula1: "rgba(225, 58, 45, 0.26)", nebula2: "rgba(255, 165, 65, 0.20)"
    },
    pulsar: {
      spaceBg: ["#04030c", "#0c0720"],
      atmoDay: "rgba(45, 242, 238, 0.85)", atmoTerm: "rgba(192, 132, 252, 0.92)", atmoNight: "rgba(48, 18, 95, 0.42)",
      planetDay: "#8df9f5", planetMid: "#362078", planetNight: "#04020c",
      cityLights: "rgba(45, 245, 238, 0.82)",
      nebula1: "rgba(168, 85, 247, 0.26)", nebula2: "rgba(37, 244, 238, 0.22)"
    }
  };
  Glacier.SECTOR_PALETTES = SECTOR_PALETTES;


  // ---- 背景场景：深空、星点 / 曲速光矛、行星、日冕 ----
  const NUM_STARS = 220;
  const makeStars = () => {
    const stars = [];
    for (let i = 0; i < NUM_STARS; i++) {
      const angle = ((i * 137.508) % 360) * (Math.PI / 180);
      stars.push({
        angle, cos: Math.cos(angle), sin: Math.sin(angle),
        dist: 0.04 + ((i * 73) % 96) / 100,
        speedMult: 0.55 + (i % 7) * 0.22,
        thickness: i % 9 === 0 ? 1.85 : i % 3 === 0 ? 1.25 : 0.85,
        isGold: i % 5 === 0,
        alpha: 0.25 + (i % 5) * 0.14,
        hx: 0, hy: 0
      });
    }
    return stars;
  };
  const NUM_DUST = 55;
  const makeDust = () => {
    const dust = [];
    for (let i = 0; i < NUM_DUST; i++) {
      dust.push({ theta: ((i * 59) % 360) * (Math.PI / 180), rOffset: 0.72 + ((i * 31) % 38) / 100, speed: 0.0005 + (i % 5) * 0.00025, size: 0.8 + (i % 4) * 0.55, alpha: 0.2 + (i % 4) * 0.12 });
    }
    return dust;
  };
  const STREAK_L = 256, STREAK_T = 8;

  class Scene {
    /**
     * @param {HTMLCanvasElement} planetCanvas 960×600 背景画布（深空 + 行星 + 恒星；地形层整个砍了，"控件是地图上的城市"那个隐喻反而让人困惑）
     */
    constructor(planetCanvas, opts = {}) {
      this.planetCanvas = planetCanvas;
      this.sector = opts.sector || "cryo_blend";
      this.idleDivider = opts.idleDivider || 3;
      this.shipState = "IDLE";
      this.stars = makeStars();
      this.dust = makeDust();
      this.dotGroups = (() => {
        const map = new Map();
        for (const st of this.stars) {
          const key = `${st.isGold}:${st.alpha}`;
          if (!map.has(key)) map.set(key, { fill: st.isGold ? `rgba(255, 214, 165, ${st.alpha * 0.85})` : `rgba(195, 235, 255, ${st.alpha * 0.85})`, stars: [] });
          map.get(key).stars.push(st);
        }
        return [...map.values()];
      })();
      this.spriteCache = new Map();
      this.gradCache = new Map();
      this.anim = { speed: 0.06, targetSpeed: 0.06, stretch: 1, targetStretch: 1, planetRotSpeed: 0.002, targetPlanetRotSpeed: 0.002, planetAngle: 0.42, scanAlpha: 0, targetScanAlpha: 0, scanSweepAngle: 0, overdriveAlpha: 0, targetOverdriveAlpha: 0 };
      this.sunState = computeSunState(12, 1280, 800);
      this.lastFrameTime = performance.now();
      this.idleParity = 0;
      this.running = false;
    }
    get palette() { return SECTOR_PALETTES[this.sector] || SECTOR_PALETTES.cryo_blend; }
    setSun(sunState) { this.sunState = sunState; }
    setSector(s) { this.sector = s; }
    setShipState(next) {
      this.shipState = next || "IDLE";
      const a = this.anim;
      if (next === "THINKING") { a.targetSpeed = 15.5; a.targetStretch = 3.2; a.targetPlanetRotSpeed = 0.032; a.targetScanAlpha = 0; a.targetOverdriveAlpha = 0; }
      else if (next === "TOOL") { a.targetSpeed = 0.22; a.targetStretch = 1.15; a.targetPlanetRotSpeed = 0.0045; a.targetScanAlpha = 1; a.targetOverdriveAlpha = 0; }
      else if (next === "STREAM") { a.targetSpeed = 2.8; a.targetStretch = 1.55; a.targetPlanetRotSpeed = 0.0085; a.targetScanAlpha = 0; a.targetOverdriveAlpha = 1; }
      else { a.targetSpeed = 0.06; a.targetStretch = 1; a.targetPlanetRotSpeed = 0.002; a.targetScanAlpha = 0; a.targetOverdriveAlpha = 0; }
    }
    cachedGrad(key, make) {
      let g = this.gradCache.get(key);
      if (!g) { if (this.gradCache.size > 96) this.gradCache.clear(); g = make(); this.gradCache.set(key, g); }
      return g;
    }
    streakSprite(isGold) {
      const key = isGold ? "gold" : "blue";
      let c = this.spriteCache.get(key);
      if (c) return c;
      c = document.createElement("canvas"); c.width = STREAK_L; c.height = STREAK_T;
      const g = c.getContext("2d");
      const grad = g.createLinearGradient(0, 0, STREAK_L, 0);
      grad.addColorStop(0, "rgba(0, 0, 0, 0)");
      grad.addColorStop(0.65, isGold ? "rgba(255, 178, 92, 0.52)" : "rgba(88, 205, 255, 0.52)");
      grad.addColorStop(1, "rgba(255, 252, 245, 1)");
      g.strokeStyle = grad; g.lineWidth = STREAK_T; g.lineCap = "round";
      g.beginPath(); g.moveTo(STREAK_T / 2, STREAK_T / 2); g.lineTo(STREAK_L - STREAK_T / 2, STREAK_T / 2); g.stroke();
      this.spriteCache.set(key, c);
      return c;
    }
    start() {
      if (this.running) return;
      this.running = true;
      const loop = (now) => { if (!this.running) return; requestAnimationFrame(loop); this.renderFrame(now); };
      requestAnimationFrame(loop);
    }
    stop() { this.running = false; }
    /** 不开循环，只画一帧（static 模式：灯动了才调一次） */
    renderOnce() { this.renderFrame(performance.now(), true); }

    renderFrame(now, force = false) {
      const a = this.anim;
      const isIdle = a.targetStretch <= 1 && Math.abs(a.stretch - a.targetStretch) < 0.01 && a.scanAlpha < 0.01 && a.overdriveAlpha < 0.01 && Math.abs(a.speed - a.targetSpeed) < 0.002;
      this.idleParity = (this.idleParity + 1) % this.idleDivider;
      if (!force && isIdle && this.idleParity !== 0) return; // 空闲：每 idleDivider 帧画 1 帧
      const dt = Math.min(2.5, Math.max(0.2, (now - this.lastFrameTime) / 16.667));
      this.lastFrameTime = now;
      const lerp = 0.055 * dt;
      a.speed += (a.targetSpeed - a.speed) * lerp;
      a.stretch += (a.targetStretch - a.stretch) * lerp;
      a.planetRotSpeed += (a.targetPlanetRotSpeed - a.planetRotSpeed) * lerp;
      a.scanAlpha += (a.targetScanAlpha - a.scanAlpha) * lerp;
      a.overdriveAlpha += (a.targetOverdriveAlpha - a.overdriveAlpha) * lerp;
      a.planetAngle = (a.planetAngle + a.planetRotSpeed * dt) % (Math.PI * 2);
      a.scanSweepAngle = (a.scanSweepAngle + 0.022 * dt) % (Math.PI * 2);

      const pal = this.palette;
      const sunState = this.sunState;

      const canvas = this.planetCanvas;
      const W = 960, H = 600;
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      const ctx = canvas.getContext("2d");
      const hour = sunState.hour ?? 12;
      const isGolden = hour >= 15.5 || hour <= 8.5;
      ctx.clearRect(0, 0, W, H);

      // 深空 + 星云
      ctx.fillStyle = this.cachedGrad(`bg:${this.sector}`, () => { const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, pal.spaceBg[0]); g.addColorStop(1, pal.spaceBg[1]); return g; });
      ctx.fillRect(0, 0, W, H);
      const starX = W * sunState.sunU, starY = H * sunState.sunV; // 背景恒星就是那盏灯
      ctx.fillStyle = this.cachedGrad(`neb:${this.sector}`, () => { const g = ctx.createRadialGradient(W * 0.32, H * 0.28, 10, W * 0.32, H * 0.28, W * 0.52); g.addColorStop(0, pal.nebula1); g.addColorStop(1, "rgba(0,0,0,0)"); return g; });
      ctx.fillRect(0, 0, W, H);

      // 星点 / 曲速光矛
      const vanishX = W * 0.48, vanishY = H * 0.44, maxR = Math.hypot(W, H) * 0.72;
      const isWarping = a.stretch > 1.12;
      ctx.save();
      ctx.lineCap = "round";
      for (const s of this.stars) {
        s.dist += a.speed * s.speedMult * 0.0012 * dt;
        if (s.dist > 1) s.dist = 0.03 + (s.dist % 1) * 0.12;
        const headR = s.dist * maxR;
        const streakLen = (a.stretch - 1) * (38 + s.dist * 115) * s.speedMult;
        const tailR = Math.max(4, headR - streakLen);
        const hx = vanishX + s.cos * headR, hy = vanishY + s.sin * headR;
        if (!isWarping) { s.hx = hx; s.hy = hy; }
        else {
          const tx = vanishX + s.cos * tailR, ty = vanishY + s.sin * tailR;
          const len = Math.max(2, headR - tailR);
          const lw = s.thickness * Math.min(2.1, 0.9 + (a.stretch - 1) * 0.35);
          ctx.globalAlpha = Math.min(1, s.alpha * 1.25);
          ctx.setTransform((s.cos * len) / STREAK_L, (s.sin * len) / STREAK_L, (-s.sin * lw) / STREAK_T, (s.cos * lw) / STREAK_T, tx, ty);
          ctx.drawImage(this.streakSprite(s.isGold), 0, -STREAK_T / 2);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
      }
      if (!isWarping) {
        for (const grp of this.dotGroups) {
          ctx.fillStyle = grp.fill; ctx.beginPath();
          for (const st of grp.stars) { const r = st.thickness * 0.85; ctx.moveTo(st.hx + r, st.hy); ctx.arc(st.hx, st.hy, r, 0, Math.PI * 2); }
          ctx.fill();
        }
      }
      ctx.restore();

      // 行星
      const planetX = W * 0.56, planetY = H * 0.78, planetR = H * 0.64;
      const lvx = starX - planetX, lvy = starY - planetY;
      const lDist = Math.max(1, Math.hypot(lvx, lvy));
      const lnx = lvx / lDist, lny = lvy / lDist;
      const lightAngle = Math.atan2(lny, lnx);
      const overdrivePulse = 1 + a.overdriveAlpha * (0.28 + 0.16 * Math.sin(now * 0.016));
      const lightKey = `${Math.round(lnx * 40)}:${Math.round(lny * 40)}`;
      const odKey = Math.round(a.overdriveAlpha * 16);
      ctx.fillStyle = this.cachedGrad(`atmo:${this.sector}:${isGolden}:${lightKey}:${odKey}`, () => {
        const g = ctx.createRadialGradient(planetX + lnx * planetR * 0.14, planetY + lny * planetR * 0.14, planetR * 0.88, planetX, planetY, planetR * (1.16 + (odKey / 16) * 0.05));
        g.addColorStop(0, pal.atmoDay); g.addColorStop(0.46, isGolden ? pal.atmoTerm : pal.atmoDay); g.addColorStop(0.76, pal.atmoNight); g.addColorStop(1, "rgba(0,0,0,0)");
        return g;
      });
      ctx.beginPath(); ctx.arc(planetX, planetY, planetR * 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.beginPath(); ctx.arc(planetX, planetY, planetR, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = this.cachedGrad(`surf:${this.sector}:${isGolden}:${lightKey}`, () => {
        const g = ctx.createRadialGradient(planetX + lnx * planetR * 0.54, planetY + lny * planetR * 0.54, planetR * 0.05, planetX - lnx * planetR * 0.25, planetY - lny * planetR * 0.25, planetR * 1.18);
        g.addColorStop(0, pal.planetDay); g.addColorStop(0.35, isGolden ? pal.atmoTerm : pal.planetMid); g.addColorStop(0.56, pal.planetMid); g.addColorStop(0.78, pal.planetNight); g.addColorStop(1, "#010206");
        return g;
      });
      ctx.fillRect(planetX - planetR, planetY - planetR, planetR * 2, planetR * 2);
      ctx.save(); ctx.translate(planetX, planetY); ctx.rotate(-0.42);
      for (let m = 0; m < 9; m++) {
        const lon = ((m / 9) * Math.PI * 2 + a.planetAngle) % (Math.PI * 2);
        const wavePhase = Math.sin(lon), depthZ = Math.cos(lon);
        if (depthZ > -0.25) {
          const alpha = Math.max(0, (depthZ + 0.25) * 0.16) * overdrivePulse;
          ctx.strokeStyle = m % 2 === 0 ? `rgba(255, 198, 125, ${alpha})` : `rgba(88, 210, 255, ${alpha * 0.9})`;
          ctx.lineWidth = 1.5 + depthZ * 2.2;
          ctx.beginPath(); ctx.ellipse(0, 0, Math.abs(wavePhase * planetR * 0.88), planetR * 0.98, 0, -Math.PI * 0.5, Math.PI * 0.5); ctx.stroke();
        }
      }
      ctx.restore();
      ctx.strokeStyle = pal.cityLights; ctx.lineWidth = 1.1;
      for (let c = 0; c < 14; c++) {
        const ca = lightAngle + Math.PI + (c - 6.5) * 0.14 + Math.sin(a.planetAngle * 0.35 + c) * 0.05;
        const cr = planetR * (0.42 + ((c * 19) % 42) / 100);
        const cx = planetX + Math.cos(ca) * cr, cy = planetY + Math.sin(ca) * cr;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ca + 0.45) * 26, cy + Math.sin(ca + 0.45) * 16); ctx.lineTo(cx + Math.cos(ca - 0.25) * 42, cy + Math.sin(ca - 0.25) * 28); ctx.stroke();
      }
      if (a.scanAlpha > 0.01) {
        ctx.save(); ctx.translate(planetX, planetY); ctx.rotate(-0.42);
        ctx.strokeStyle = `rgba(37, 244, 238, ${0.28 * a.scanAlpha})`; ctx.lineWidth = 1;
        for (let lat = -3; lat <= 3; lat++) { const yLat = (lat / 4) * planetR * 0.9; const rLat = Math.sqrt(Math.max(10, planetR * planetR - yLat * yLat)); ctx.beginPath(); ctx.ellipse(0, yLat, rLat, rLat * 0.22, 0, 0, Math.PI * 2); ctx.stroke(); }
        const sweepX = Math.sin(a.scanSweepAngle) * planetR * 0.85;
        const sg = ctx.createLinearGradient(sweepX - 45, -planetR, sweepX + 45, -planetR);
        sg.addColorStop(0, "rgba(37, 244, 238, 0)"); sg.addColorStop(0.5, `rgba(16, 245, 195, ${0.42 * a.scanAlpha})`); sg.addColorStop(1, "rgba(37, 244, 238, 0)");
        ctx.fillStyle = sg; ctx.fillRect(sweepX - 45, -planetR, 90, planetR * 2);
        ctx.restore();
      }
      ctx.restore();
      // 晨昏线弧光
      ctx.save();
      ctx.strokeStyle = isGolden ? `rgba(255, 205, 130, ${Math.min(1, 0.78 * overdrivePulse)})` : pal.atmoDay;
      ctx.lineWidth = 3.2 * overdrivePulse; ctx.shadowColor = isGolden ? "rgba(255, 150, 60, 0.95)" : pal.atmoDay; ctx.shadowBlur = 24 * overdrivePulse;
      ctx.beginPath(); ctx.arc(planetX, planetY, planetR, lightAngle - 1.18, lightAngle + 1.18); ctx.stroke();
      ctx.restore();
      // 高层微尘
      ctx.save();
      this.dust.forEach((d, i) => {
        d.theta = (d.theta + d.speed * (1 + a.speed * 0.25) * dt) % (Math.PI * 2);
        const arcAngle = lightAngle - 1.05 + Math.sin(d.theta) * 1.05;
        const r = planetR * d.rOffset;
        ctx.fillStyle = i % 2 === 0 ? `rgba(255, 210, 140, ${d.alpha * overdrivePulse})` : `rgba(110, 225, 255, ${d.alpha * overdrivePulse})`;
        ctx.beginPath(); ctx.arc(planetX + Math.cos(arcAngle) * r, planetY + Math.sin(arcAngle) * r, d.size, 0, Math.PI * 2); ctx.fill();
      });
      ctx.restore();
      // 日冕（就是灯）
      ctx.save();
      ctx.globalAlpha = sunState.lampGlow ?? 1;
      ctx.fillStyle = this.cachedGrad(`sun:${this.sector}:${Math.round(starX)}:${Math.round(starY)}`, () => {
        const g = ctx.createRadialGradient(starX, starY, 2, starX, starY, W * 0.36);
        g.addColorStop(0, "rgba(255, 250, 238, 0.94)"); g.addColorStop(0.14, pal.atmoTerm); g.addColorStop(0.45, pal.nebula2); g.addColorStop(1, "rgba(0, 0, 0, 0)");
        return g;
      });
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }
  Glacier.Scene = Scene;

  // ==========================================================================
  // 3. 灯 overlay：轨迹就是「几点钟灯在哪」那张表画出来的线
  //    静态层（轨迹 + loop 段 + 整点刻度，表 / 区间 / 昼夜 / 尺寸变了才重建）+ 游标（小柔光 + 点 + 时间，只重画脏矩形）
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
  const PATH_STEP = 0.5;   // 轨迹按表采样的步长（小时）：48 段
  const CURSOR_R = 22;     // 游标柔光半径
  const CURSOR_DIRTY = 96; // 游标脏矩形半边（柔光 + 刻度线 + 时间文字都在里面）

  class Lamp {
    constructor(canvas) { this.canvas = canvas; this.lastKey = ""; this.staticKey = ""; this.staticLayer = null; this.glowCache = new Map(); this.prevRect = null; }
    /** 默认路径：内置公式。init() 有表时传表的采样器进来（hour → { x, y, isDay }） */
    static formulaPath(W, H) { return (h) => lampPointAt(h, W, H); }
    // 静态层：轨迹（按表每 PATH_STEP 小时采一个点，0 → 24 闭合）+ loop 段加亮 + 整点刻度。
    // 表换了、区间换了、昼夜换了、尺寸换了才重建。
    buildStatic(W, H, dpr, state, path, pathKey, loop) {
      // 颜色量化进 key（每通道 24 一档）：关键帧表插值出来的 crest 每一步都在变，按原字符串算会每次都整层重建
      const crest = toRgb(state.sunCrest);
      const key = `${W}x${H}@${dpr}:${state.isDay}:${crest.map((c) => Math.round(c / 24)).join()}:${pathKey}:${loop ? `${loop.from}+${loop.span}` : ""}`;
      if (this.staticLayer && this.staticKey === key) return this.staticLayer;
      this.staticKey = key;
      const off = document.createElement("canvas"); off.width = Math.round(W * dpr); off.height = Math.round(H * dpr);
      const ctx = off.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const visible = (p) => p.y <= H + 40;
      // 轨迹：同一昼夜的连续点连成一条折线；白天实线、夜里虚线；和当前昼夜相反的那段淡
      const pts = [];
      for (let h = 0; h <= 24 + 1e-9; h += PATH_STEP) pts.push(path(h));
      const strokeRun = (run) => {
        if (run.length < 2) return;
        const day = !!run[0].isDay;
        ctx.beginPath(); ctx.moveTo(run[0].x, run[0].y);
        for (let i = 1; i < run.length; i++) ctx.lineTo(run[i].x, run[i].y);
        ctx.setLineDash(day ? [] : [3, 7]); ctx.lineWidth = 1;
        ctx.strokeStyle = rgba(crest, day === !!state.isDay ? (day ? 0.22 : 0.18) : (day ? 0.08 : 0.07));
        ctx.stroke();
      };
      let run = [];
      for (const p of pts) {
        if (!visible(p)) { strokeRun(run); run = []; continue; }
        if (run.length && !!run[0].isDay !== !!p.isDay) { run.push(p); strokeRun(run); run = [p]; continue; } // 昼夜交界点两段共用
        run.push(p);
      }
      strokeRun(run);
      ctx.setLineDash([]);
      // loop 段加亮：from → from+span，实线 1.5px
      if (loop) {
        ctx.beginPath(); let started = false;
        for (let t = 0; t <= loop.span + 1e-9; t += PATH_STEP / 2) {
          const p = path((loop.from + t) % 24);
          if (!visible(p)) { started = false; continue; }
          if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
        }
        ctx.lineWidth = 1.5; ctx.strokeStyle = rgba(crest, 0.55); ctx.stroke();
      }
      // 整点刻度：沿路径放，法线取相邻点；每 6 小时一根长的
      ctx.lineWidth = 1;
      for (let h = 0; h < 24; h++) {
        const p = path(h);
        if (p.y > H + 10 || p.y < -10) continue;
        const q = path(h + 0.05);
        const tx = q.x - p.x, ty = q.y - p.y, tl = Math.hypot(tx, ty) || 1;
        const nx = -ty / tl, ny = tx / tl;
        const major = h % 6 === 0, len = major ? 7 : 3.5;
        const alpha = (major ? 0.32 : 0.18) * (!!p.isDay === !!state.isDay ? 1 : 0.35);
        ctx.beginPath(); ctx.moveTo(p.x - nx * len, p.y - ny * len); ctx.lineTo(p.x + nx * len, p.y + ny * len);
        ctx.strokeStyle = rgba(crest, alpha); ctx.stroke();
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
      grad.addColorStop(0, rgba(core, 0.75)); grad.addColorStop(0.1, rgba(corona, 0.5)); grad.addColorStop(0.4, rgba(corona, 0.17)); grad.addColorStop(1, rgba(corona, 0));
      g.fillStyle = grad; g.fillRect(0, 0, R * 2, R * 2);
      this.glowCache.set(key, sp);
      return sp;
    }
    /**
     * @param opts { path?: hour → {x, y, isDay}（默认公式）, pathKey?: 表的版本号（换表要换 key）, loop?: { from, span } 要加亮的区间 }
     * 只有游标位置取整后变了、颜色变了、尺寸变了、表 / 区间变了才重画；游标只重画脏矩形。
     */
    draw(state, hour, W, H, opts = {}) {
      if (!(W > 0 && H > 0)) return false; // 0×0 的视口（隐藏的标签页）没得画
      const path = opts.path || Lamp.formulaPath(W, H), pathKey = opts.pathKey || "formula", loop = opts.loop || null;
      const x = state.sunX, y = state.sunY, glow = state.lampGlow ?? 1;
      const key = `${Math.round(x)}:${Math.round(y)}:${state.orbCorona}:${state.orbCore}:${state.sunCrest}:${W}x${H}:${glow.toFixed(2)}:${state.isDay}:${pathKey}:${loop ? `${loop.from}+${loop.span}` : ""}`;
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
      // 时间文字的 y 被夹在视口里；游标在 05:00 / 19:00 掉到视口下面时文字还留在底边，脏矩形必须把它一起框进去，否则擦不掉
      // 法线先算（时间文字的位置和脏矩形都要用；之前写在后面，触发了 TDZ，整个 init 在这里炸掉）
      const q = path(hour + 0.05);
      const tx = q.x - x, ty = q.y - y, tl = Math.hypot(tx, ty) || 1;
      let nx = -ty / tl, ny = tx / tl;
      if ((W / 2 - x) * nx + (H / 2 - y) * ny > 0) { nx = -nx; ny = -ny; }
      const textY = Math.max(10, Math.min(H - 10, y + ny * 24));
      const ry0 = Math.min(y - D, textY - 12), ry1 = Math.max(y + D, textY + 12);
      const newRect = { x: x - D, y: ry0, w: D * 2, h: ry1 - ry0 }; // 游标 + 刻度线 + 时间文字都在这个框里
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
      // 游标：小小的柔光 + 一个点
      const corona = toRgb(state.orbCorona), core = toRgb(state.orbCore);
      ctx.save(); ctx.globalAlpha = Math.max(0.25, glow);
      ctx.drawImage(this.glowSprite(core, corona, CURSOR_R, dpr), x - CURSOR_R, y - CURSOR_R, CURSOR_R * 2, CURSOR_R * 2);
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fillStyle = rgba(core, 0.95); ctx.fill();
      ctx.restore();
      // 「现在」刻度 + 时间，放在路径外侧（法线背离视口中心的那一侧）
      ctx.beginPath(); ctx.moveTo(x + nx * 9, y + ny * 9); ctx.lineTo(x + nx * 18, y + ny * 18);
      ctx.lineWidth = 1.5; ctx.strokeStyle = rgba(core, 0.55 * glow + 0.15); ctx.stroke();
      const normH = ((hour % 24) + 24) % 24;
      const hh = String(Math.floor(normH)).padStart(2, "0"), mm = String(Math.floor((normH % 1) * 60)).padStart(2, "0");
      ctx.font = '600 10px ui-monospace, "Cascadia Code", Consolas, monospace'; ctx.textBaseline = "middle"; ctx.textAlign = nx >= 0 ? "left" : "right";
      ctx.fillStyle = rgba(core, 0.5 * glow + 0.15);
      ctx.fillText(`${state.isDay ? "☀" : "☾"} ${hh}:${mm}`, x + nx * 24, textY);
      return true;
    }
  }
  Glacier.Lamp = Lamp;

  // ==========================================================================
  // 4. 控件受光解算器
  // ==========================================================================
  // 把"光从哪来"变成三样东西写在元素上（CSS 只读这五个变量）：
  //   刀锋向量 --ice-sx / --ice-sy     迎光边的 inset 高光，指向光
  //   墙向量   --ice-dark-x / -dark-y  背光边的 inset 内倒角，背向光
  //   光锥角   --ice-deg               反光带渐变的角度，从迎光角扫到背光角
  // light 两种写法：
  //   { x, y }   点光：灯在和 rect 同一坐标系里的位置。方向 = 元素中心 − 灯，软符号 lx / hypot(lx, 48) 让灯穿过
  //              元素中心线时在 ±48px 内平滑换边。结果和元素位置有关，位置变了要重算
  //   { dx, dy } 平行光：单位方向（光 → 元素），等价于灯在无穷远。和位置、尺寸都无关：同一个方向下任何元素
  //              写出来的都一样，写一次永远对，rect 可以不给
  const CREST_LEN = 2.4; // 刀锋最长 2.4px（CSS 再 round 到 1px 格）
  const WALL_LEN = 4.5;  // 墙 4.5px（CSS 取一半）
  const lightDirectionAt = (rect, light) => {
    if (light.dx !== undefined) return [light.dx, light.dy];
    const lx = rect.left + rect.width / 2 - light.x, ly = rect.top + rect.height / 2 - light.y;
    return [lx / Math.hypot(lx, 48), ly / Math.hypot(ly, 48)];
  };
  Glacier.lightWidget = (el, rect, light) => {
    const [sx, sy] = lightDirectionAt(rect, light);
    const deg = Math.round(((((Math.atan2(sx, -sy) * 180) / Math.PI) % 360) + 360) % 360);
    const st = el.style;
    const set = (k, val) => { if (st.getPropertyValue(k) !== val) st.setProperty(k, val); };
    set("--ice-sx", `${(sx * CREST_LEN).toFixed(2)}px`); set("--ice-sy", `${(sy * CREST_LEN).toFixed(2)}px`);
    set("--ice-dark-x", `${(-sx * WALL_LEN).toFixed(2)}px`); set("--ice-dark-y", `${(-sy * WALL_LEN).toFixed(2)}px`);
    set("--ice-deg", `${deg}deg`);
  };
  /** 平行光的默认方向：光从左上来、影子往右下（台灯规则，0.8px : 1.6px），归一化 */
  const FIXED_LIGHT = (() => { const n = Math.hypot(0.45, 0.89); return Object.freeze({ dx: 0.45 / n, dy: 0.89 / n }); })();
  Glacier.FIXED_LIGHT = FIXED_LIGHT;

  // 把四组光色和字影浓度写到一个元素（通常是 body）上，同值不写
  Glacier.applySunVars = (el, state) => {
    const st = el.style;
    const set = (k, val) => { if (val && st.getPropertyValue(k) !== val) st.setProperty(k, val); };
    set("--agy-sun-crest", state.sunCrest); set("--agy-sun-sheen", state.sunSheen);
    set("--agy-sun-tint", state.sunTint); set("--agy-sun-caustic", state.sunCaustic);
    set("--agy-sun-ta", (0.3 + 0.3 * (state.lampGlow ?? 1)).toFixed(2)); // 全局字影浓度：白天 0.6，灯落山 / 夜里 0.3–0.45
    // 照片背景用：不透明的太阳色（crest 和 tint 各半，去 alpha：正午冰青、晨昏琥珀、夜里紫蓝）和曝光（灯亮度 → 0.5–1）
    set("--agy-sun-photo", photoColor(state.sunCrest, state.sunTint));
    set("--agy-sun-exposure", (0.5 + 0.5 * (state.lampGlow ?? 1)).toFixed(2));
  };
  const photoColor = (crest, tint) => {
    const A = parseColor(crest) || [255, 206, 145, 1], B = parseColor(tint) || A;
    return `rgb(${Math.round((A[0] + B[0]) / 2)}, ${Math.round((A[1] + B[1]) / 2)}, ${Math.round((A[2] + B[2]) / 2)})`;
  };

  // ==========================================================================
  // 5. init()：把上面四件东西装到一个页面上
  // ==========================================================================
  // 选项（全部可省）：
  //   background   "scene" 跑动画 | "static" 只画一帧（灯动了再画一帧）| "none" 不建背景画布，只有灯 + 冰砖
  //                | "photo" 照片当背景：零画布，两层 div（底片 + 跟太阳走的纯色 color 混合层）
  //   photo        照片 URL（background: "photo" 用）；photoDesaturate 底片先 grayscale（默认 true）
  //   time         "现在几点"的时钟：
  //                  "realtime"  跟真实时间（每 realtimeInterval 对一次表）
  //                  小时数       定住某一帧（fixed）
  //                  "timelapse" 一天循环（= loop 0→24，timelapseStep × timelapseInterval 走完）
  //                  { loop: { from, to, duration, bounce } }  在某个区间来回：from/to 小时、duration 毫秒一圈、bounce 到头折返
  //                  "external"  不自己走，宿主用 setHour() 推（hudd、网关、别的时钟）
  //   sunTable     "几点钟长什么样"的关键帧表（Glacier.sun.sampleTable() 采一张改）；null = 用内置公式
  //   sector       cryo_blend | cryo_pure | red_giant | pulsar
  //   idleDivider  空闲时每 N 帧画 1 帧（IDE 里 3，常驻壁纸 6）
  //   lampOverlay  是否画灯 overlay（轨迹按 sunTable / 公式采样画，loop 区间加亮，游标 + 时间）
  //   lightDirection "fixed" 平行光：控件受光永远从左上来（台灯规则，灯只管色温和浓淡）。一块砖写一次永远对，
  //                          滚动、对表都不碰砖；observe 负责新节点（默认）
  //                  "lamp"  点光：跟着灯的方位转。灯动了、尺寸变了、滚动停下 settleDelay 毫秒后重量一轮
  //   torch        鼠标手电（Win10 Reveal）：待机态的砖平时不画边，鼠标 torchRadius 像素内的砖按远近显出 1px 边缘；
  //                颜色用太阳当时的 crest，不另起光源色；已点亮的砖不参与；键盘焦点等价于手电停在那一格
  //   torchRadius  手电半径（像素，默认 160）；torchSelector 哪些元素受手电（默认 .gl-brick）
  //   observe      监视 root 里的节点增删：新塞进来的 .gl-* 节点自动纳入打光（挂上总线即受光，不用注册）
  //   trackSelector 会自己动的节点（漂移、拖拽、动画）：带这个选择器的元素逐帧重新量矩形、（lamp 模式下）重新受光、
  //                 重新被手电探测；默认 [data-gl-track]。不动的元素别加，省着算
  //   dim          场景压暗 0–1（默认 0.3）：玻璃压在高对比的行星上会"假"，面板后面的背景要安静
  //   root         画布插到哪、冰砖在哪找（默认 document.body）；光色变量也写在它上面
  //   selector     要打光的元素
  //   respectReducedMotion  系统开了「减弱动态效果」时 scene 自动退成 static
  //   onUpdate(state)       每次太阳状态更新后的回调
  const DEFAULTS = {
    background: "scene",
    time: "realtime",
    sunTable: null,
    sector: "cryo_blend",
    idleDivider: 3,
    lampOverlay: true,
    photo: null,
    photoDesaturate: true,
    lightDirection: "fixed",
    torch: true,
    torchRadius: 160,
    torchSelector: ".gl-brick",
    observe: true,
    trackSelector: "[data-gl-track]",
    dim: 0.3,
    root: null,
    selector: ".gl-brick, .gl-nav, .gl-card",
    settleDelay: 160,
    realtimeInterval: 28000,
    timelapseInterval: 80,
    timelapseStep: 0.08,
    respectReducedMotion: true,
    onUpdate: null
  };
  Glacier.DEFAULTS = DEFAULTS;

  const VIEW_MARGIN = 160; // lamp 模式：视口外扩这么多像素以内的元素才打光
  const SUN_VARS = ["--agy-sun-crest", "--agy-sun-sheen", "--agy-sun-tint", "--agy-sun-caustic", "--agy-sun-ta", "--agy-sun-photo", "--agy-sun-exposure"];
  const BACKGROUNDS = ["scene", "static", "none", "photo"];
  const WIDGET_VARS = ["--ice-sx", "--ice-sy", "--ice-dark-x", "--ice-dark-y", "--ice-deg"];
  const TORCH_VARS = ["--torch-x", "--torch-y", "--torch-a"];
  const INSTANCE_KEY = "__glacierInstance";
  const { lightWidget, applySunVars } = Glacier;

  const nowHour = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; };
  const prefersReducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const makeCanvas = (cls) => { const c = document.createElement("canvas"); c.className = `gl-layer ${cls}`; return c; };
  const rectOf = (b) => ({ left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height });
  const sameRect = (a, b) => a && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
  const offscreen = (r, W, H) => r.bottom < -VIEW_MARGIN || r.top > H + VIEW_MARGIN || r.right < -VIEW_MARGIN || r.left > W + VIEW_MARGIN;
  const viewport = () => [window.innerWidth || 1280, window.innerHeight || 800];

  class Instance {
    constructor(options) {
      this.options = { ...DEFAULTS, ...options };
      const o = this.options;
      this.root = o.root || document.body;
      this.lampMode = o.lightDirection === "lamp";
      this.root.style.setProperty("--gl-dim", String(Math.max(0, Math.min(1, Number(o.dim) || 0))));
      this.root.style.setProperty("--torch-r", `${Math.max(0, Number(o.torchRadius) || 0)}px`);
      this.scrollers = new Set();
      this.torched = new Set(); this.torchEls = []; this.torchPos = null; this.torchFocus = null; this.torchRaf = 0;
      this.tracked = []; this.trackRaf = 0; this.observer = null; this.observeTimer = 0;
      this.clock = { mode: "manual", hour: 12 };
      this.setTimeOption(o.time);
      this.reducedMotion = !!o.respectReducedMotion && prefersReducedMotion();
      this.background = "none";
      this.state = null;
      this.scene = null;
      this.lamp = null;
      this.canvases = { planet: null, lamp: null };
      this.photoLayers = [];  // photo 模式的两层 div
      this.tableVersion = 0;  // 换表就加一：灯的静态层按它判断要不要重画
      this.lit = new Set();   // 打过光的元素（destroy 时清变量）
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
    }

    // ---- 背景画布 ----------------------------------------------------------
    mountBackground(mode) {
      if (mode === "scene" && this.reducedMotion) mode = "static";
      if (!BACKGROUNDS.includes(mode)) mode = "none";
      this.background = mode;
      const o = this.options;
      if (mode === "photo") {
        // 照片：零画布。底片铺满视口（可先 grayscale），上面一层纯色用 color 混合，颜色 / 曝光由 root 上的 --agy-sun-photo / --agy-sun-exposure 驱动
        const photo = document.createElement("div");
        photo.className = "gl-layer gl-layer-photo" + (o.photoDesaturate !== false ? " gl-photo-gray" : "");
        if (o.photo) photo.style.backgroundImage = `url("${String(o.photo).replace(/"/g, "%22")}")`;
        const tint = document.createElement("div");
        tint.className = "gl-layer gl-layer-tint";
        this.photoLayers = [photo, tint];
      } else if (mode !== "none") {
        const planet = this.canvases.planet = makeCanvas("gl-layer-planet");
        this.scene = new Scene(planet, { sector: o.sector, idleDivider: o.idleDivider });
        if (this.state) this.scene.setSun(this.state);
        if (mode === "scene" && !this.stopped) this.scene.start();
      }
      this.placeLayers();
    }
    // 层的顺序（从下到上）：照片、色调、行星、灯。都插在 root 最前面
    placeLayers() {
      const order = [...this.photoLayers, this.canvases.planet, this.canvases.lamp].filter(Boolean);
      for (const el of order.reverse()) this.root.prepend(el);
    }
    unmountBackground() {
      if (this.scene) { this.scene.stop(); this.scene = null; }
      this.canvases.planet?.remove(); this.canvases.planet = null;
      for (const el of this.photoLayers) el.remove();
      this.photoLayers = [];
      this.background = "none";
    }

    // ---- 时钟 ----------------------------------------------------------------
    // 时钟只回答"现在几点"，和"几点钟长什么样"（表 / 公式）无关。
    //   realtime  跟真实时间     fixed  定住一帧     loop  区间来回     external  宿主推
    setTimeOption(t) {
      if (typeof t === "number" && Number.isFinite(t)) { this.clock.mode = "fixed"; this.clock.hour = ((t % 24) + 24) % 24; }
      else if (t === "timelapse") this.setLoopSpec({ from: 0, to: 24, duration: (24 / this.options.timelapseStep) * this.options.timelapseInterval, bounce: false }, false);
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
      return (L.from + phase * L.span) % 24;
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
        this.clockTimer = setInterval(() => this.update(), o.timelapseInterval);
      } else if (this.clock.mode === "realtime") {
        this.clockTimer = setInterval(() => this.update(), o.realtimeInterval);
      }
      // fixed / external：不走定时器
    }
    stopClock() { if (this.clockTimer) { clearInterval(this.clockTimer); this.clockTimer = 0; } }

    // ---- 太阳状态：算一次、发给三个消费者 ----------------------------------------
    // 平行光模式下砖不听太阳（方向是常量，颜色在 root 上），所以这里只碰画布和 root；点光模式才重打砖。
    update() {
      if (this.destroyed) return;
      const [W, H] = viewport();
      const hour = this.currentHour();
      this.clock.hour = hour;
      this.state = this.options.sunTable ? stateFromTable(this.options.sunTable, hour, W, H) : computeSunState(hour, W, H);
      if (this.scene) {
        this.scene.setSun(this.state);
        if (this.background === "static") this.scene.renderOnce();
      }
      if (this.lamp && !document.hidden) this.lamp.draw(this.state, hour, W, H, this.lampOpts(W, H));
      applySunVars(this.root, this.state);
      if (this.lampMode) this.scheduleRelight();
      this.options.onUpdate?.(this.state);
    }

    // 灯的轨迹按"几点钟灯在哪"那张表画：有表按表采样，没表用公式；loop 模式把区间传过去加亮
    lampOpts(W, H) {
      const table = this.options.sunTable;
      const path = table
        ? (h) => { const s = stateFromTable(table, h, W, H); return { x: s.sunX, y: s.sunY, isDay: s.isDay }; }
        : Lamp.formulaPath(W, H);
      const L = this.clock.mode === "loop" ? this.clock.loop : null;
      return { path, pathKey: table ? `table${this.tableVersion}` : "formula", loop: L ? { from: L.from, span: L.span } : null };
    }

    // ---- 冰砖打光 ------------------------------------------------------------
    scheduleRelight() {
      if (this.rafId || this.destroyed) return;
      this.rafId = requestAnimationFrame(() => {
        this.rafId = 0;
        if (this.scrolling && this.lampMode) return; // 滚动中不读布局：停下后那一轮会做
        this.relightNow();
      });
    }
    light() { return this.lampMode ? { x: this.state.sunX, y: this.state.sunY } : FIXED_LIGHT; }
    litKey(light, r) { return this.lampMode ? `${Math.round(light.x)}:${Math.round(light.y)}@${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}` : "fixed"; }
    relightNow() {
      if (this.destroyed || !this.state) return;
      const o = this.options;
      const els = Array.from(this.root.querySelectorAll(o.selector));
      this.torchEls = o.torch ? els.filter((el) => el.matches(o.torchSelector)) : [];
      this.tracked = o.trackSelector ? els.filter((el) => el.matches(o.trackSelector)) : [];
      if (this.tracked.length) this.startTracking();
      if (this.lampMode) this.relightLamp(els);
      else this.relightFixed(els);
    }
    // 平行光：不读布局。没打过的元素写一次就永远对。矩形只给手电用，滚动中不量，停下再量
    relightFixed(els) {
      for (const el of els) {
        if (el.__glLit === "fixed") continue;
        el.__glLit = "fixed";
        lightWidget(el, null, FIXED_LIGHT);
        this.lit.add(el);
      }
      if (this.torchEls.length && !this.scrolling) this.measureRects();
    }
    // 点光：一轮 getBoundingClientRect（只打视口外扩 160px 以内的），再一轮写；灯和矩形都没变的跳过
    relightLamp(els) {
      const [W, H] = viewport();
      const light = this.light();
      const measured = [];
      for (const el of els) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        const r = rectOf(b);
        el.__glRect = r;
        if (!offscreen(r, W, H)) measured.push([el, r]);
      }
      for (const [el, r] of measured) {
        const k = this.litKey(light, r);
        if (el.__glLit === k) continue;
        el.__glLit = k;
        lightWidget(el, r, light);
        this.lit.add(el);
      }
      this.syncScrollers();
    }
    // 手电要知道砖在哪：一轮读、零写
    measureRects() {
      for (const el of this.torchEls) if (el.isConnected) el.__glRect = rectOf(el.getBoundingClientRect());
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
    // 挪了半个像素以上就让手电重新探测；点光模式下还重新受光（平行光下位置变了光不变）。一个都没有时循环自动停。
    startTracking() {
      if (this.trackRaf || this.destroyed) return;
      this.trackRaf = requestAnimationFrame(() => this.trackFrame());
    }
    trackFrame() {
      this.trackRaf = 0;
      if (this.destroyed || !this.state) return;
      this.tracked = this.tracked.filter((el) => el.isConnected);
      if (!this.tracked.length) return;
      const moved = [];
      for (const el of this.tracked) { // 读阶段
        const b = el.getBoundingClientRect();
        if (sameRect(el.__glRect, b)) continue;
        moved.push([el, rectOf(b)]);
      }
      if (moved.length) { // 写阶段
        const [W, H] = viewport();
        const light = this.light();
        for (const [el, r] of moved) {
          el.__glRect = r;
          if (!this.lampMode || offscreen(r, W, H)) continue;
          el.__glLit = this.litKey(light, r);
          lightWidget(el, r, light);
          this.lit.add(el);
        }
        if (this.torchPos || this.torchFocus) this.applyTorch();
      }
      this.trackRaf = requestAnimationFrame(() => this.trackFrame());
    }
    // ---- 节点增删：挂上总线即受光 ----------------------------------------------
    // 只看增删的节点本身是不是（或装着）受光元素，不在整棵树里查；命中就隔 120ms 重量一轮。
    observeRoot() {
      const o = this.options;
      const hits = (nodes) => { for (const n of nodes) { if (n.nodeType !== 1) continue; if (n.matches(o.selector) || (n.firstElementChild && n.querySelector(o.selector))) return true; } return false; };
      this.observer = new MutationObserver((records) => {
        for (const m of records) {
          if (hits(m.addedNodes) || hits(m.removedNodes)) { this.scheduleObservedRelight(); return; }
        }
      });
      this.observer.observe(this.root, { childList: true, subtree: true });
    }
    scheduleObservedRelight() {
      clearTimeout(this.observeTimer);
      this.observeTimer = setTimeout(() => { this.observeTimer = 0; this.scheduleRelight(); }, 120);
    }
    // ---- 滚动：期间什么都不做，停下 settleDelay 后 lamp 模式重打一轮光；fixed 模式只给手电刷新矩形 ----
    onScroll(sc) {
      this.scrolling = true;
      // 滚动中不读布局，但手电要跟着砖走：把这个容器里砖的缓存矩形按滚动位移平移（读一次 scrollTop，不触发重排），
      // 然后让手电按新位置重新探测。停下后再真量一轮纠偏。
      if (sc && this.torchEls.length) {
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
            if (this.torchPos || this.torchFocus) this.scheduleTorch();
          }
        }
      }
      clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => {
        this.settleTimer = 0;
        this.scrolling = false;
        if (this.lampMode) this.relightNow();
        else if (this.torchEls.length) this.measureRects();
        if (this.torchPos || this.torchFocus) this.scheduleTorch();
      }, this.options.settleDelay);
    }

    // ---- 监听器 --------------------------------------------------------------
    bind() {
      const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); this.listeners.push([target, type, fn, opts]); };
      on(window, "resize", () => { this.update(); if (!this.lampMode) this.scheduleRelight(); }); // 平行光：砖不变，只刷新手电矩形
      if (this.lampMode || this.options.torch) {
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
            if (this.torchEls.length) this.measureRects(); else this.syncScrollers();
            if (this.torchPos || this.torchFocus) this.scheduleTorch(); // 矩形刚变，这一帧手电就按新位置重探
          }
          this.onScroll(sc);
        }, { capture: true, passive: true });
      }
      if (this.options.observe) this.observeRoot();
      if (this.options.torch) {
        const sel = this.options.torchSelector;
        on(document, "pointermove", (e) => { this.torchPos = { x: e.clientX, y: e.clientY }; this.scheduleTorch(); }, { passive: true });
        on(document, "pointerleave", () => { this.torchPos = null; this.scheduleTorch(); });
        on(this.root, "focusin", (e) => { const el = e.target?.closest?.(sel); this.torchFocus = el || null; this.scheduleTorch(); });
        on(this.root, "focusout", () => { this.torchFocus = null; this.scheduleTorch(); });
      }
      on(document, "visibilitychange", () => {
        if (document.hidden) { this.scene?.stop(); return; }
        if (this.background === "scene" && !this.stopped) this.scene?.start();
        this.update(); // 回前台补一帧
      });
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
      this.torchRaf = requestAnimationFrame(() => { this.torchRaf = 0; this.applyTorch(); });
    }
    applyTorch() {
      if (this.destroyed) return;
      const R = Math.max(0, Number(this.options.torchRadius) || 0), R2 = R * R;
      const p = this.torchPos, f = this.torchFocus;
      const keep = new Set();
      if (p && R > 0) {
        for (const el of this.torchEls) {
          const r = el.__glRect;
          if (!r || !el.isConnected) continue;
          const dx = p.x < r.left ? r.left - p.x : p.x > r.right ? p.x - r.right : 0;
          const dy = p.y < r.top ? r.top - p.y : p.y > r.bottom ? p.y - r.bottom : 0;
          if (dx * dx + dy * dy > R2) continue;
          this.setTorch(el, p.x - r.left, p.y - r.top);
          keep.add(el);
        }
      }
      if (f && f.__glRect && f.isConnected) { this.setTorch(f, f.__glRect.width / 2, f.__glRect.height / 2); keep.add(f); }
      for (const el of this.torched) {
        if (!keep.has(el)) for (const k of TORCH_VARS) el.style.removeProperty(k);
      }
      this.torched = keep;
    }
    setTorch(el, x, y) {
      const st = el.style, vx = `${x.toFixed(1)}px`, vy = `${y.toFixed(1)}px`;
      if (st.getPropertyValue("--torch-x") !== vx) st.setProperty("--torch-x", vx);
      if (st.getPropertyValue("--torch-y") !== vy) st.setProperty("--torch-y", vy);
      if (st.getPropertyValue("--torch-a") !== "1") st.setProperty("--torch-a", "1");
    }

    // ---- 公开句柄 ------------------------------------------------------------
    /** 当前太阳状态（位置、光色） */
    get sun() { return this.state; }
    get hour() { return this.currentHour(); }
    get mode() { return this.clock.mode; }
    get lightDirection() { return this.lampMode ? "lamp" : "fixed"; }
    /** 定在某个小时（fixed）；external 模式下也用它推时间（保持 external） */
    setHour(h) {
      this.clock.hour = ((Number(h) % 24) + 24) % 24;
      if (this.clock.mode !== "external") { this.clock.mode = "fixed"; this.stopClock(); }
      this.update();
      return this.clock.hour;
    }
    /** "realtime" | "fixed" | "loop" | "external" | "timelapse"（= 一天循环）；"manual" 等于 "fixed" */
    setMode(mode) {
      if (mode === "loop" && this.clock.loop) { this.clock.mode = "loop"; this.clock.loop.start = performance.now(); }
      else if (mode === "loop") this.setLoopSpec({ from: 0, to: 24, duration: (24 / this.options.timelapseStep) * this.options.timelapseInterval }, false);
      else this.setTimeOption(mode === "manual" ? "fixed" : mode);
      if (!this.stopped) this.startClock();
      this.update();
      return this.clock.mode;
    }
    /** 在某个区间来回：setLoop({ from: 16, to: 19, duration: 12000, bounce: true }) */
    setLoop(spec) { this.setLoopSpec(spec, true); this.update(); return { ...this.clock.loop }; }
    /** 换"几点钟长什么样"的表；null 回到内置公式。Glacier.sun.sampleTable() 采一张来改 */
    setSunTable(table) { this.options.sunTable = Array.isArray(table) && table.length ? table : null; this.tableVersion++; this.update(); return this.options.sunTable; }
    setSector(s) { this.options.sector = s; this.scene?.setSector(s); this.update(); return s; }
    setShip(s) { this.scene?.setShipState(s); return this.scene ? this.scene.shipState : "IDLE"; }
    /** 换背景模式：scene | static | none | photo（背景层原地重建，冰砖不动） */
    setBackground(mode) {
      this.unmountBackground();
      this.options.background = mode;
      this.mountBackground(mode);
      this.update();
      return this.background;
    }
    /** 重新找一遍元素、补一遍光（宿主自己改了布局且没开 observe 时调）。下一帧做 */
    relight() { this.scheduleRelight(); }
    /** 暂停：背景循环和时钟停，DOM 留着 */
    stop() { this.stopped = true; this.stopClock(); this.scene?.stop(); return this; }
    /** 从 stop() 恢复 */
    start() { this.stopped = false; if (this.background === "scene") this.scene?.start(); this.startClock(); this.update(); return this; }
    /** 全部收回：画布、监听器、定时器、root 和冰砖上的变量 */
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.stopClock();
      this.unbind();
      this.unmountBackground();
      this.canvases.lamp?.remove(); this.canvases.lamp = null; this.lamp = null;
      const rs = this.root.style;
      for (const k of [...SUN_VARS, "--torch-r", "--gl-dim"]) rs.removeProperty(k);
      for (const el of this.lit) {
        for (const k of WIDGET_VARS) el.style.removeProperty(k);
        delete el.__glRect; delete el.__glLit;
      }
      this.lit.clear();
      for (const el of this.torched) for (const k of TORCH_VARS) el.style.removeProperty(k);
      this.torched.clear(); this.torchEls = [];
      if (this.root[INSTANCE_KEY] === this) delete this.root[INSTANCE_KEY];
      this.state = null;
    }
  }

  /**
   * 装到页面上。同一个 root 上重复 init 会先 destroy 上一个（热重载 / 换选项都安全）。
   * @returns {Instance} 句柄：setHour, setMode, setLoop, setSunTable, setSector, setShip, setBackground,
   *                     relight, start, stop, destroy, sun, hour, mode, lightDirection, background, scene, lamp, options
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
