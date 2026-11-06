// demo.html 的脚本：组件目录的交互（调光台、轨道切换、级联菜单、键盘阵列、运镜按钮）。
// 只演示用法，不属于库；库的全部入口见 glacier.js 顶部注释与 README。
  // ---- 晶格示例：8×4 的信标矩阵，坐标轴是标签，一个 .on ----
  const lattice = document.getElementById("lattice");
  for (let c = 0; c < 8; c++) { const s = document.createElement("span"); s.className = "gl-lattice-label"; s.textContent = String.fromCharCode(65 + c); lattice.appendChild(s); }
  for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) {
    const b = document.createElement("button"); b.className = "gl-brick" + (r === 1 && c === 3 ? " on" : "");
    b.textContent = `${r + 1}${c + 1}`; lattice.appendChild(b);
  }

  // ---- 填充内部滚动容器 ----
  const scroller = document.getElementById("scroller");
  for (let i = 0; i < 16; i++) {
    const b = document.createElement("button");
    b.className = "gl-brick";
    b.textContent = `会话 ${String(i + 1).padStart(2, "0")}`;
    scroller.appendChild(b);
  }

  // ---- 初始化：URL 里可带 ?bg=photo&photo=<图片URL>&time=9&drifter=0 之类 ----
  const q = new URLSearchParams(location.search);
  if (q.get("drifter") === "0") document.querySelector(".drifter").remove(); // 测基线用：一个常动的元素会逼整页 60fps 合成
  // photo 模式的底片：母星那张（卡西尼拍的土星新月，灰阶，出处见 photos/README.md）；?photo=<URL> 换
  const photoUrl = () => q.get("photo") || "photos/home.jpg";
  const initOptions = () => ({
    background: q.get("bg") || "none", // 舷窗默认是空的（DESIGN.md §4.2）；工程面板里切到 photo 看底片
    photo: photoUrl(),
    time: q.has("time") ? Number(q.get("time")) : (q.get("mode") || "realtime"),
    onUpdate: () => render()
  });
  var gl = Glacier.init(initOptions()); // var：onUpdate 在 init 返回前就会被调一次，render 里要能看到 gl 还没赋值
  window.gl = gl; // 控制台里玩：gl.setHour(18)

  // ---- 计数（只是 demo 的仪表，库里没有这些） ----
  // relights：扫描手电目标轮数（relightNow）；measures：纯读矩形给手电用的轮数（measureRects）
  const stats = { since: performance.now(), relights: 0, measures: 0 };
  const instrument = () => {
    if (gl.__wrapped) return;
    const relight = gl.relightNow.bind(gl), measure = gl.measureRects.bind(gl);
    gl.relightNow = () => { stats.relights++; relight(); };
    gl.measureRects = () => { stats.measures++; measure(); };
    gl.__wrapped = true;
  };
  window.glStats = () => {
    const out = { seconds: +((performance.now() - stats.since) / 1000).toFixed(1), relights: stats.relights, measures: stats.measures };
    stats.since = performance.now();
    return out;
  };

  // ---- 轨道：试验用的三条曲线（库里不留预设）。曲线必须是钟：单环闭合，一圈就是一天；光色、游标、底片探照灯、太阳手电全跟着表走 ----
  let orbitSel = "formula", preTourOrbit = "formula";
  const ORBITS = {
    formula: () => null, // 内置天穹抛物线
    circle: () => {
      // 卡西尼 18° 倾角星环：对齐土星环视倾角，向阳前弧实亮、背阳蚀相暗丝
      const tilt = -18 * (Math.PI / 180), ct = Math.cos(tilt), st = Math.sin(tilt);
      return Glacier.sun.tableFromPath((t) => {
        const a = 2 * Math.PI * t - Math.PI;
        const x = 0.42 * Math.cos(a), y = 0.19 * Math.sin(a);
        const front = Math.sin(a) <= 0.15;
        return { u: 0.5 + x * ct - y * st, v: 0.48 + x * st + y * ct, isDay: front, glow: front ? 0.95 : 0.48 };
      }, 96);
    },
    flat: () => Glacier.sun.tableFromPath((t) => {
      // 掠日低弧：折返顶点落在视口外（u = -0.08 / 1.08），舷窗内只见两道舒展的掠地长弧，绝不在屏幕内急转弯
      const a = 2 * Math.PI * t;
      const day = Math.sin(a) >= 0;
      return { u: 0.5 - 0.58 * Math.cos(a), v: day ? (0.76 - 0.14 * Math.sin(a)) : (0.76 + 0.09 * Math.sin(a)), isDay: day, glow: day ? 0.92 : 0.45 };
    }, 96)
  };

  // ---- 控件 ----
  const $ = (id) => document.getElementById(id);
  const hourInput = $("hour");
  const mark = (group, v) => document.querySelectorAll(`[data-group="${group}"] .gl-brick`).forEach((b) => b.classList.toggle("on", b.dataset.v === v));
  const fmt = (h) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;
  function render() {
    if (!gl) return;
    const s = gl.sun;
    if (!s) { $("clock").textContent = "—"; $("readout").textContent = "（已 destroy）"; return; }
    $("clock").textContent = `${s.isDay ? "☀" : "☾"} ${fmt(s.h)}`;
    $("hourLabel").textContent = fmt(s.h);
    if (document.activeElement !== hourInput) hourInput.value = s.h.toFixed(2);
    // 按钮的 data-v 和时钟模式对不上一一对应：loop 要分"延时（整天）"和"落日（区间）"，fixed 对应"手动"
    const modeKey = gl.mode === "loop" ? (gl.clock?.loop && gl.clock.loop.span < 24 ? "sunset" : "timelapse") : gl.mode === "fixed" ? "manual" : gl.mode;
    if (!gl.options.sunTable?.open && orbitSel.startsWith("tour")) orbitSel = preTourOrbit;
    mark("mode", modeKey); mark("background", gl.background); mark("orbit", orbitSel);
    const camState = gl.focusEl ? `focus(${gl.focusEl.id || gl.focusEl.tagName.toLowerCase()})` : (s.offOrbit ? "returning" : (gl.options.sunTable?.open ? "tour(spline)" : "orbit"));
    const brickInfo = "locked 1px ring (100%×100% @ 0% 0% in oklab · #FFD89B → #E6F4FF → 暮光紫 → transparent 88% · inset -1.5px #06080E · 0 inline vars)";
    $("readout").innerHTML =
      `lamp <b>${Math.round(s.sunX)}, ${Math.round(s.sunY)}</b> / ${s.W}×${s.H}   glow <b>${s.lampGlow.toFixed(2)}</b>   camera <b>${camState}</b>   photo mask <b>${document.body.style.getPropertyValue("--gl-sun-x")} ${document.body.style.getPropertyValue("--gl-sun-y")}</b> × <b>${document.body.style.getPropertyValue("--gl-sun-exposure")}</b>\n` +
      `background <b>${gl.background}</b>   mode <b>${gl.mode}</b>   relights <b>${stats.relights}</b>   measures <b>${stats.measures}</b>\n` +
      `brick[0] <b>${brickInfo}</b>`;
  }
  hourInput.addEventListener("input", () => { gl.setHour(Number(hourInput.value)); $("hourLabel").textContent = fmt(Number(hourInput.value)); });
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-group] .gl-brick");
    if (!b || !gl || gl.destroyed) return;
    const g = b.closest("[data-group]").dataset.group, v = b.dataset.v;
    if (g === "mode") { if (v === "sunset") gl.setLoop({ from: 16, to: 19, duration: 12000, bounce: true }); else gl.setMode(v); }
    else if (g === "background") { gl.setBackground(v); instrument(); }
    else if (g === "orbit") { orbitSel = preTourOrbit = v; gl.setSunTable(ORBITS[v] ? ORBITS[v]() : null); }
    render();
  });
  $("btnStop").onclick = () => { gl.stop(); render(); };
  $("btnStart").onclick = () => { gl.start(); render(); };
  $("btnDestroy").onclick = () => { gl.destroy(); render(); };
  $("btnInit").onclick = () => { gl = window.gl = Glacier.init({ ...initOptions(), background: gl.options.background, time: gl.options.time }); instrument(); render(); };
  let added = 0;
  $("btnAdd").onclick = () => { // 新节点：不注册、不调 relight()，observe 看见它就打光
    const b = document.createElement("button"); b.className = "gl-brick"; b.textContent = `新砖 ${String(++added).padStart(2, "0")}`;
    document.querySelector(".hero .bricks").appendChild(b);
  };
  // 光学运镜演示：1) DOM 属性 data-gl-focus；2) gl.focus()；3) glacier:light 事件 2 点天桥弧与 3 点向心样条巡航
  $("btnFocusAttr").onclick = () => {
    const target = document.querySelector('[data-group="mode"] [data-v="sunset"]');
    target.removeAttribute("data-gl-focus");
    target.setAttribute("data-gl-focus", ""); // MutationObserver 自动捕获并启动 8s 临界阻尼借光
  };
  $("btnFocusSub").onclick = () => gl.focus("#btnAdd");
  $("btnTour2").onclick = () => {
    if (!orbitSel.startsWith("tour")) preTourOrbit = orbitSel;
    orbitSel = "tour2";
    window.dispatchEvent(new CustomEvent("glacier:light", { detail: { path: ['[data-group="mode"]', '[data-group="background"]'], duration: 6000 } }));
  };
  $("btnTour3").onclick = () => {
    if (!orbitSel.startsWith("tour")) preTourOrbit = orbitSel;
    orbitSel = "tour3";
    window.dispatchEvent(new CustomEvent("glacier:light", { detail: { path: ['[data-group="mode"]', '[data-group="orbit"]', "#btnAdd"], duration: 8000 } }));
  };
  $("btnLightReset").onclick = () => {
    orbitSel = preTourOrbit;
    document.querySelectorAll("[data-gl-focus]").forEach((el) => el.removeAttribute("data-gl-focus"));
    window.dispatchEvent(new CustomEvent("glacier:light", { detail: { clear: true } }));
  };
  document.addEventListener("scroll", () => render(), { capture: true, passive: true }); // 只刷读数

  // ---- 目录里的砖都能按（playground 的本分）：同一个容器里单选 .on；告警点一下算"看过了"；漂移节点点一下停 ----
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".gl-brick");
    if (!b || b.closest("[data-group]") || b.id || b.tagName === "A") return; // 工程面板、生命周期按钮、链接各有各的
    if (b.classList.contains("drifter")) { b.classList.toggle("paused"); return; }
    if (b.classList.contains("gl-alert")) { // 红只给"要你看"：看过了就不红了
      b.classList.remove("gl-alert");
      b.textContent = "✓ " + b.textContent.replace(/^[⚠✓]\s*/, "");
      return;
    }
    const group = b.closest(".gl-louver, .gl-lattice, .gl-track, .gl-popover, .bricks, .states, .scroller, .topbar, .kb-chassis, .depth-l3-row");
    if (!group) return;
    if (group.id === "parentPopover" || group.id === "subPopover") return; // 级联菜单由下方专用逻辑接管
    const was = b.classList.contains("on");
    group.querySelectorAll(".gl-brick.on").forEach((x) => x.classList.remove("on"));
    if (!was) b.classList.add("on");
  });

  // ---- 级联菜单 + 右键实操菜单 + 键盘巡航 & 物理机械键盘联动 ----
  const parentPop = $("parentPopover"), subPop = $("subPopover"), ctxFloat = $("ctxFloat"), ctxStatus = $("ctxStatus");
  let activeMenu = subPop; // 当前方向键控制的菜单（默认停在二级子菜单，直观展示双层景深）
  // 方向键只在级联展柜露在视口里（或右键菜单打开）时接管，其余时候整页照常用键盘滚动。只在按方向键时读一次矩形
  const cascadeSection = $("demoCascade").closest("section");
  const cascadeInView = () => { const r = cascadeSection.getBoundingClientRect(); return r.bottom > innerHeight * 0.25 && r.top < innerHeight * 0.75; };

  const setCascadeFocus = (menu, item) => {
    activeMenu = menu;
    const items = [...menu.querySelectorAll(".gl-brick")];
    const target = item || items[0];
    items.forEach((x) => x.classList.toggle("on", x === target));
    if (menu === subPop) {
      subPop.classList.remove("is-hidden");
      parentPop.classList.add("is-receded");
      parentPop.querySelectorAll(".gl-brick").forEach((x) => {
        x.classList.remove("on");
        x.classList.toggle("gl-sub-open", x.dataset.hasSub === "1");
      });
      ctxStatus.textContent = `当前焦点：二级子菜单「${target.querySelector("span")?.textContent || target.textContent}」（父菜单退后半档 .is-receded）。按 ↑/↓ 巡航，按 ← 退回父菜单。`;
    } else if (menu === parentPop) {
      parentPop.classList.remove("is-receded");
      parentPop.querySelectorAll(".gl-brick").forEach((x) => x.classList.remove("gl-sub-open"));
      if (target.dataset.hasSub === "1") {
        subPop.classList.remove("is-hidden");
        subPop.querySelectorAll(".gl-brick.on").forEach((x) => x.classList.remove("on"));
      } else {
        subPop.classList.add("is-hidden");
      }
      ctxStatus.textContent = `当前焦点：一级父菜单「${target.querySelector("span")?.textContent || target.textContent}」${target.dataset.hasSub === "1" ? "（按 → 进入二级子菜单）" : ""}。`;
    } else if (menu === ctxFloat) {
      ctxStatus.textContent = `右键浮动菜单已弹出：「${target.querySelector("span")?.textContent || target.textContent}」。按 ↑/↓ 巡航，Esc 关闭。`;
    }
    gl?.relight();
  };

  $("demoCascade").addEventListener("click", (e) => {
    const b = e.target.closest(".gl-brick");
    if (!b) return;
    const menu = b.closest(".gl-popover");
    if (menu === parentPop && b.dataset.hasSub === "1") {
      setCascadeFocus(subPop, subPop.querySelector(".gl-brick.on") || subPop.querySelector(".gl-brick"));
    } else if (menu) {
      setCascadeFocus(menu, b);
    }
  });

  // 右键弹出实操菜单（在 #ctxZone 或页面非输入框区域右键）
  $("ctxZone").addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const w = 210, h = 190;
    const x = Math.min(e.clientX, window.innerWidth - w - 12);
    const y = Math.min(e.clientY, window.innerHeight - h - 12);
    ctxFloat.style.left = `${Math.max(12, x)}px`;
    ctxFloat.style.top = `${Math.max(12, y)}px`;
    ctxFloat.classList.remove("gl-pop-in");
    void ctxFloat.offsetWidth;
    ctxFloat.classList.add("open", "gl-pop-in");
    setCascadeFocus(ctxFloat, ctxFloat.querySelector(".gl-brick.on") || ctxFloat.querySelector(".gl-brick"));
  });
  document.addEventListener("pointerdown", (e) => {
    if (ctxFloat.classList.contains("open") && !ctxFloat.contains(e.target)) {
      ctxFloat.classList.remove("open");
      activeMenu = subPop.classList.contains("is-hidden") ? parentPop : subPop;
    }
  });

  // 键盘联动：1) 机械键盘阵列同步点亮（120ms 亮 / 240ms 余晖熄）；2) 菜单 ↑ ↓ ← → Esc 巡航
  const findKeycap = (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    return document.querySelector(`#kbChassis .kb-key[data-key="${CSS.escape(k)}"]`);
  };
  // 按下只加 is-pressed 并临时点亮；松开按 data-was-on 还原，别把 L 键这种本来就选中的键帽按灭
  const pressCap = (cap) => {
    if (cap.classList.contains("is-pressed")) return; // 自动重复的 keydown
    cap.dataset.wasOn = cap.classList.contains("on") ? "1" : "";
    cap.classList.add("on", "is-pressed");
  };
  const releaseCap = (cap) => {
    cap.classList.remove("is-pressed");
    if (cap.dataset.wasOn !== "1") cap.classList.remove("on");
    delete cap.dataset.wasOn;
  };
  const releaseAllCaps = () => document.querySelectorAll("#kbChassis .kb-key.is-pressed").forEach(releaseCap);
  // Win 键会弹开始菜单、Alt+Tab 会切窗口：页面失焦后 keyup 永远收不到，这里兜底清掉
  window.addEventListener("blur", releaseAllCaps);
  document.addEventListener("visibilitychange", () => { if (document.hidden) releaseAllCaps(); });
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea")) return;
    const cap = findKeycap(e);
    if (cap) pressCap(cap);
    if (e.key === "Escape" && ctxFloat.classList.contains("open")) {
      ctxFloat.classList.remove("open");
      activeMenu = subPop.classList.contains("is-hidden") ? parentPop : subPop;
      ctxStatus.textContent = "已关闭右键菜单，焦点回到级联展柜。";
      return;
    }
    const ctxOpen = ctxFloat.classList.contains("open");
    if ((ctxOpen || cascadeInView()) && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault();
      const menu = ctxOpen ? ctxFloat : activeMenu;
      const items = [...menu.querySelectorAll(".gl-brick")];
      const idx = Math.max(0, items.findIndex((x) => x.classList.contains("on")));
      if (e.key === "ArrowDown") {
        setCascadeFocus(menu, items[(idx + 1) % items.length]);
      } else if (e.key === "ArrowUp") {
        setCascadeFocus(menu, items[(idx - 1 + items.length) % items.length]);
      } else if (e.key === "ArrowRight" && menu === parentPop) {
        const subTrigger = parentPop.querySelector('[data-has-sub="1"]');
        if (items[idx] === subTrigger) setCascadeFocus(subPop, subPop.querySelector(".gl-brick"));
      } else if (e.key === "ArrowLeft" && menu === subPop) {
        setCascadeFocus(parentPop, parentPop.querySelector('[data-has-sub="1"]'));
      }
    }
  });
  document.addEventListener("keyup", (e) => {
    const cap = findKeycap(e);
    if (cap) releaseCap(cap);
  });

  instrument();
  render();
