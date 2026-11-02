# Glacier · 星舰冰川 — 独立浏览器库

> 把「一艘停在冰川上的星舰」这套设计语言（规格见上一级的 `DESIGN.md`）打包成两个文件，任何网页 / Electron / WebView 都能直接用。
> 一盏按真实时间走动的灯管色温和浓淡，背后是深空 + 行星（或者一张跟着太阳变色的照片）；页面上的冰砖默认受一束从左上来的平行光（台灯规则），
> 鼠标是一支手电，照到哪块待机的砖，哪块显出一圈边。

```
glacier/
├── glacier.css   令牌、@property 注册、画布层、.gl-brick / .gl-nav / .gl-card / .gl-alert / .gl-track 规则（无 !important、无宿主选择器）
├── glacier.js    Glacier.sun / Scene / Lamp / lightWidget / applySunVars，加 Glacier.init()
├── demo.html     组件目录：每个组件一节（砖的五种状态、暗槽、卡片、光栅、晶格、图标、漂移节点、滚动容器）+ 工程面板（时间 / 时钟 / 背景 / 星区 / 舰态 / 生命周期 / 读数）
├── bridge.html   舰桥：用这套积木搭的暗座舱范例——三个问题（在哪 / 几点 / 有没有事）、两个旋钮（去哪 / 多快）、航点光栅 + 当月日历晶格 + 告警行（A 模拟、Esc 清）
└── README.md     本文件
```

## 1. 怎么引

```html
<link rel="stylesheet" href="glacier.css">
<body class="gl-stage">
  <button class="gl-brick gl-nav">新建对话</button>
  <button class="gl-brick">一块普通冰砖</button>
  <div class="gl-card">一张毛玻璃卡片</div>

  <script src="glacier.js"></script>
  <script>
    const gl = Glacier.init();          // 全默认：scene 背景、实时时钟、平行光、手电
    // gl.setHour(18); gl.setSector("pulsar"); gl.destroy(); …
  </script>
</body>
```

三条规则：

1. **画布后面必须是深色。** 灯用 `mix-blend-mode: screen` 混合，底色一白就糊成一片。给 `<body>` 加 `.gl-stage` 就有默认的 `#13141c`；自己有底色也行，深的就好。
2. **要受光的元素加类名**：`.gl-brick`（冰砖按钮）、`.gl-brick.gl-nav`（顶层 / 侧栏按钮，颜色更亮、圆角更小）、`.gl-card`（大块冰板，带毛玻璃和一圈渐变环）、`.gl-brick.gl-alert`（要你看的红砖）。不认识的元素库一概不碰；后来塞进来的节点自动纳入。
3. **把 `glacier.js` 放在 `<body>` 末尾或 `DOMContentLoaded` 之后再 `init()`**，它要往 `<body>` 里插画布、找冰砖。

`glacier.js` 只声明一个全局 `window.Glacier`（CommonJS 环境下同时 `module.exports`），没有依赖，没有构建步骤。
也可以不用 `init()`，直接拿底层的 `Glacier.sun` / `Scene` / `Lamp` / `lightWidget` 自己拼（hudd 的 overlay 就是这么用的，见 §4）。

### 两个页面

- `demo.html` 是**组件目录**：每个组件一节，各带一行规矩，每块砖都能按（同组单选 `.on`、告警点一下算确认、漂移节点点一下停）；底下是工程面板和压力测试（更多卡片、内部滚动容器、漂移节点）。背景默认空的，工程面板或 `?bg=scene` 叫回那颗球。URL 参数 `?bg=scene|static|photo&photo=<URL>&time=9&light=lamp&idle=6&drifter=0`。
- `bridge.html` 是**舰桥**：用同一套积木搭的暗座舱范例（DESIGN.md §4.2）。一切正常时面板是黑的；左边航点光栅（去哪：母星 / 轨道站 / 红巨星 / 脉冲星 / 深空，每个航点带自己的星区和钟），顶上时钟旋钮（多快：航点时刻 / 实时 / 延时 / 手动拨），右边当月日历晶格（今天 `.on`），底部告警行平时是空的（按 A 模拟一条，Esc 清掉；真宿主接心跳）。舷窗默认是空的（`background: "none"`：深空基底 + 灯的轨道线，不画球——自发光的行星会掀了黑位地板、淹了刀锋）；`?bg=photo&photo=<URL>` 放一张灰阶负片当天体，`?bg=scene` 把球叫回来看对比。

## 2. `Glacier.init(options)` 选项

全部可省。`Glacier.DEFAULTS` 里能看到默认值。

| 选项 | 默认 | 含义 |
|---|---|---|
| `background` | `"scene"` | `"scene"` 跑动画（星点慢漂、行星慢转、舰态特效）；`"static"` 只画一帧，灯动了再画一帧，没有循环；`"none"` 不建背景画布，只有灯 + 冰砖；`"photo"` 照片当背景，零画布（见下面「照片当背景」） |
| `photo` / `photoDesaturate` | `null` / `true` | 照片 URL；底片是否先 `grayscale(1)`（默认是：灰底片 + 太阳色调才是一套，彩色照片会和色调打架） |
| `time` | `"realtime"` | 时钟（现在几点）：`"realtime"` 每 `realtimeInterval` 毫秒对一次表；数字 = 定住这个小时；`"timelapse"` 一天循环（`timelapseStep × timelapseInterval` 走完）；`{ loop: { from, to, duration, bounce } }` 区间来回；`"external"` 不自己走，宿主用 `setHour()` 推 |
| `sunTable` | `null` | 关键帧表（几点钟长什么样，见第 3 节末）；`null` 用内置公式 |
| `sector` | `"cryo_blend"` | 星区配色：`cryo_blend` 沙丘冰星 / `cryo_pure` 纯冰 / `red_giant` 红巨星 / `pulsar` 脉冲星 |
| `idleDivider` | `3` | scene 空闲时每 N 帧画 1 帧。IDE 里 3；常驻页面建议 6（见 §6 实测） |
| `lampOverlay` | `true` | 是否画灯 overlay：轨迹按「几点钟灯在哪」那张表采样画（有 `sunTable` 按表，没有按公式；每 0.5 小时一个点，白天实线、夜里虚线）、整点刻度沿着路径放、`loop` 模式把区间那段加亮、当前时刻是一个小柔光游标 + 时间。换表、换区间、换昼夜、改尺寸才重画静态层，游标只重画脏矩形 |
| `lightDirection` | `"fixed"` | 控件受光：`"fixed"` **平行光**，永远从左上来（台灯规则，光 → 元素的方向是常量 `(0.45, 0.89)`），灯只管色温和浓淡。一块砖的受光和它在哪无关，写一次永远对，滚动、对表、尺寸变化都不碰砖；`"lamp"` **点光**，跟着灯的方位转，灯动了、尺寸变了、滚动停下后重量一轮 |
| `torch` / `torchRadius` / `torchSelector` | `true` / `160` / `".gl-brick"` | 鼠标手电（Win10 Reveal）：待机态的砖平时不画边，鼠标半径内的砖按远近显出 1px 边缘，相邻的砖被余光照到一截；颜色用太阳当时的 crest；已点亮的砖不参与；键盘焦点等价于手电停在那一格。不读布局，只给半径内的砖写变量 |
| `observe` | `true` | 监视 `root` 里的节点增删：新塞进来的 `.gl-*` 节点自动纳入打光，不用注册、不用调 `relight()` |
| `trackSelector` | `"[data-gl-track]"` | 会自己动的节点（漂移、拖拽、动画）逐帧重新量矩形、被手电探测（`lamp` 模式下还重新受光）。这是本库唯一的逐帧布局读取，只给会动的东西加 |
| `dim` | `0.3` | 场景压暗 0–1：行星层按它降透明度并降饱和，玻璃压在安静的背景上才像玻璃 |
| `root` | `document.body` | 画布插到哪、冰砖在哪找、光色变量写在哪 |
| `selector` | `".gl-brick, .gl-nav, .gl-card"` | 要打光的元素 |
| `settleDelay` | `160` | 滚动停下多久算「停下」（毫秒）。`lamp` 模式停下后重打一轮光；`fixed` 模式停下后只给手电刷新矩形 |
| `realtimeInterval` | `28000` | 实时模式对表间隔（毫秒）。实时一小时灯走约 100px，28 秒一次完全够 |
| `timelapseInterval` / `timelapseStep` | `80` / `0.08` | 延时模式：每 80ms 推 0.08 小时，一天 24 秒走完 |
| `respectReducedMotion` | `true` | 系统开了「减弱动态效果」时 `scene` 自动退成 `static`（CSS 那边过渡也会瞬时完成） |
| `onUpdate(state)` | `null` | 每次太阳状态更新后回调（对表、拨时间、尺寸变化、回前台） |

### 照片当背景

`Glacier.init({ background: "photo", photo: "sdo.jpg" })`。两层 `div`，不建任何画布：`.gl-layer-photo` 铺满视口（`cover` 居中，默认先 `grayscale(1)`），上面 `.gl-layer-tint` 一层纯色用 `mix-blend-mode: color` 盖住——色相跟太阳走（`--agy-sun-photo`：crest 和 tint 各半、去掉 alpha，正午冰青 `rgb(175, 231, 255)`、晨昏琥珀 `rgb(255, 176, 125)`、夜里紫蓝 `rgb(184, 193, 251)`），曝光跟灯的亮度走（`--agy-sun-exposure` = 0.5 + 0.5 × `lampGlow`，夜里暗一些），`dim` 照旧压暗。不对照片用 `hue-rotate`：那会把照片里所有颜色一起转，色调层只换色相、留明度。

换成真照片：demo 里没有真照片，用的是把场景渲染一帧 `toDataURL` 得到的占位图（`demo.html` 的 `photoUrl()`，也可以 `?photo=<URL>`）。真要用，NASA SDO 的太阳极紫外图是公有领域，直接拿一张（例如 [sdo.gsfc.nasa.gov/data](https://sdo.gsfc.nasa.gov/data/) 里的 AIA 171 / 193 / 304 全日面图），或者自己选图；深色、大面积、细节不密的图最合适，照片层的 `opacity` 最高 0.7（`dim: 0.3` 时），正文不会被抢。

坐标系：灯的轨道横跨整个**视口**（`window.innerWidth × innerHeight`），`lamp` 模式下冰砖按 `getBoundingClientRect()` 的视口坐标解算。`root` 只决定画布插在哪、冰砖在哪找，不改坐标系。

## 3. 句柄 API

`init()` 返回一个实例，同一个 `root` 上重复 `init()` 会先 `destroy()` 上一个（热重载、换选项都安全）。

| 成员 | 作用 |
|---|---|
| `setHour(h)` | 定在某个小时（0–24，小数可）；`external` 模式下就是宿主推时间的入口 |
| `setMode("realtime" \| "fixed" \| "loop" \| "external" \| "timelapse")` | 切时钟：跟真实时间 / 定住一帧 / 区间来回 / 宿主推 / 一天循环 |
| `setLoop({ from, to, duration, bounce })` | 在某个区间来回：`from`/`to` 小时，`duration` 毫秒走完一圈，`bounce` 到头折返。例：落日 `{ from: 16, to: 19, duration: 12000, bounce: true }` |
| `setSunTable(table \| null)` | 换「几点钟长什么样」的关键帧表；`null` 回内置公式 |
| `setSector(name)` | 换星区，背景和灯一起变 |
| `setShip("IDLE" \| "THINKING" \| "TOOL" \| "STREAM")` | 舰态：曲速光矛 / 扫描束 / 反应堆过载（只影响 scene 背景） |
| `setBackground("scene" \| "static" \| "none")` | 原地换背景模式（画布重建，冰砖不动） |
| `relight()` | 下一帧重新找一遍元素、补一遍光。宿主关了 `observe` 又自己改了 DOM 时才需要 |
| `stop()` / `start()` | 暂停 / 恢复背景循环和时钟，DOM 留着 |
| `destroy()` | 全部收回：画布、监听器、定时器、观察器、`root` 上的变量、每块冰砖上的 `--ice-*` / `--torch-*` 变量 |
| `sun` | 当前太阳状态：`sunX / sunY / sunU / sunV / h / isDay / lampGlow` 和四组光色 |
| `hour` / `mode` / `background` / `lightDirection` | 当前时间、时钟模式、实际生效的背景模式（减弱动态时 scene 会显示为 static）、受光模式 |
| `scene` / `lamp` / `options` | 底层对象和合并后的选项（诊断 / 测速用） |

库往页面上写的东西（也就是 `destroy()` 会收回的东西）：

- `root` 前面的背景层（从下到上）：`photo` 模式两个 `div.gl-layer-photo / .gl-layer-tint`，`scene / static` 模式一张 `canvas.gl-layer-planet`，再加一张 `canvas.gl-layer-lamp`（`lampOverlay: false` 就没有）
- `root.style` 上的 `--agy-sun-crest / sheen / tint / caustic`（四组光色）、`--agy-sun-ta`（全局字影浓度 0.3–0.6）、`--agy-sun-photo`（不透明的太阳色）、`--agy-sun-exposure`（0.5–1）、`--gl-dim`、`--torch-r`
- 每块冰砖 / 卡片自己的五个变量：`--ice-sx / --ice-sy`（刀锋向量，迎光边 inset 高光）、`--ice-dark-x / --ice-dark-y`（墙向量，背光边内倒角）、`--ice-deg`（光锥角，反光带渐变方向）；手电半径内的砖再多三个 `--torch-x / --torch-y / --torch-a`
- `window` 上一个 `resize`，`document` 上一个 `visibilitychange`；开了手电或 `lamp` 模式时 `document` 上一个捕获、被动的 `scroll`；开了手电时 `pointermove / pointerleave` 和 `root` 上的 `focusin / focusout`；开了 `observe` 时一个 `MutationObserver`

### 太阳拆成两层：表 + 时钟

- **表（几点钟长什么样）**：`sunTable` 选项 / `setSunTable()`。关键帧 `{ hour, u, v, glow, isDay, sunCrest, sunSheen, sunTint, sunCaustic, orbCore, orbCorona, orbRayColor }`，`u / v` 是灯在视口里的归一化位置，颜色 `rgba()` 或 `#hex`；少写的字段用内置公式在同一小时的值补齐，相邻帧线性插值（颜色按通道），末帧到首帧跨午夜接上。`Glacier.sun.sampleTable(1)` 把内置公式采成 24 帧，改几帧再喂回去就是自己的一天。
- **时钟（现在几点）**：`time` 选项 / `setMode()` / `setLoop()` / `setHour()`。`realtime` 跟真实时间；数字定住一帧；`loop` 在区间来回（`timelapse` 就是 0→24 的 loop）；`external` 不自己走，由宿主推（hudd 的桌面灯、网关、别的页面的时钟都能当源）。

同一张表配不同时钟：PDF 的台灯、Windhawk 以后按小时换皮、hudd 的桌面灯，都是这个接口。

### 挂上总线即受光

光不属于按钮，属于房间：屏幕里常年飘着两路广播——太阳（色温、浓淡；`lamp` 模式下还有方位）和手电（鼠标坐标、半径）。节点自己是瞎的，一句关于光的代码都没有；只要贴上 `.gl-brick` / `.gl-card`，就等于把插头扣到了总线上：

- 默认的平行光下，一块砖的受光和它在哪无关：`init()` 时写一次，之后滚动、对表、改尺寸都不碰它。
- 动态新建的节点：`observe` 看到它出现就纳入，下一轮它就受光、就能被手电照到。
- 会自己动的节点（漂移、拖拽、动画）：再加 `data-gl-track`，引擎逐帧跟着它量矩形，穿过手电光圈时边缘实时流过高光；`lamp` 模式下太阳打在它身上的方向也实时对。demo 里那颗「🛰 漂移节点」就是这么做的。
- 不动的节点别加 `data-gl-track`：逐帧量矩形是这个库里唯一不省的事，而且一个常动的元素会逼整页每帧重新合成（见 §6）。

## 4. 底层 API（不用 `init()` 也能用）

| 成员 | 作用 |
|---|---|
| `Glacier.sun.lampPointAt(hour, W, H)` | 时间 → 灯在 W×H 里的位置（白天 05–19 抛物线，夜里低轨道从右走回左） |
| `Glacier.sun.computeSunState(hour, W, H)` | 位置 + 四组光色 + `lampGlow`（靠近下沿渐隐） |
| `Glacier.sun.sampleTable(step)` / `stateFromTable(table, hour, W, H)` / `frameFromModel(hour)` | 关键帧表：采样内置公式、按表插值出状态、取公式在某小时的一帧 |
| `new Glacier.Scene(planetCanvas, { sector, idleDivider })` | 背景引擎。`setSun(state)`、`setSector()`、`setShipState()`、`start()` / `stop()`、`renderOnce()` |
| `new Glacier.Lamp(canvas)` → `draw(state, hour, W, H, { path, pathKey, loop })` | 灯 overlay。`path(hour) → { x, y, isDay }` 是轨迹采样器（默认 `Lamp.formulaPath(W, H)`），`pathKey` 换表时要换，`loop = { from, span }` 要加亮的区间。位置取整后没变、颜色没变、尺寸没变就不重画 |
| `Glacier.lightWidget(el, rect, light)` | 给一个元素写五个受光变量（`--ice-sx / sy` 库自己的 CSS 已不读——刀锋并进了环——仍然写着，给 hudd 这类自带 CSS 的宿主用）。`light` 是 `{ x, y }` 点光（和 `rect` 同一坐标系；hudd 里是屏幕坐标，于是多个窗口共享一盏灯）或 `{ dx, dy }` 平行光（单位方向，光 → 元素；`rect` 可以不给） |
| `Glacier.FIXED_LIGHT` | 默认的平行光方向，`(0.45, 0.89)` 归一化 |
| `Glacier.applySunVars(el, state)` | 把四组光色、`--agy-sun-ta`、`--agy-sun-photo`、`--agy-sun-exposure` 写到 `el` 上，同值不写 |
| `Glacier.SECTOR_PALETTES` | 四个星区的配色表 |

## 5. CSS 约定

- 令牌在 `:root`：`--agy-bg`、`--agy-fg`、`--agy-accent*`、`--agy-card-alpha`，动效 `--agy-ease-out / spring / inout`、`--agy-dur-fast / base / slow`。
- 解算器写的五个 `--ice-*` 变量用 `@property` 注册成**不继承**：只在被写的那个元素上用，不在伪元素 / 子元素里读。`--torch-*` 相反，注册成继承且有类型，`::before` 才能读到、`--torch-a` 才能过渡。
- 砖的配方是逐像素量 Windhawk 任务栏那块磁贴抄回来的（DESIGN.md §4.3）：点亮态是**一片比面板亮的玻璃**（透明底 + 沿盒子对角线的浅玻璃渐变），外面一圈 1px 的对角线渐变环（`::before`，迎光角香槟 → 冰白 → 深海蓝 → 近黑），背光侧 1px 深海蓝墙（`box-shadow inset`，由 `--ice-dark-*` 定方向），零外投影。对角线角度 `--ice-diag` 由 `measureRects()` 按盒子尺寸写（宽砖≈横着走，顶边只在左端亮），`lamp` 模式不写、回退到 `--ice-deg`。墙的 `box-shadow` **没有过渡**，别给它加 `transition: box-shadow`；偏移 `round()` 到 1px 格。
- 静止态的砖是哑光底片（比面板亮 3%，零边零渐变）；玻璃 + 环 + 墙只在悬停 / `.gl-fresh` / `.on` / `.gl-alert` / 按下时出现；悬停的环比选中淡一档（62%）。砖的 `::before` 永远是那一圈 1px：静止态归手电，点亮态归太阳，宿主别占它。
- `.on` 不贴指示器：环从悬停的 62% 到 100%，正文暖白，砖里的 `<small>` 读数亮成电光青。红灯芯（`.gl-alert` 的 `::after`）只给"要你看"。
- `.gl-fresh` = 极寒凝结态（和悬停同一套），`.on` = 选中，`.gl-pop-in` = 面板进场动画，`.gl-track` = 一组小开关共用的下沉暗槽，`.gl-icon` = 把彩色图标压成冷银灰。
- `.gl-alert`：告警 / 要你看的砖（红巨星频段）——勃艮第酒红底 + 底部绯红短灯芯，用于后台任务待确认、报错、未读。红只给这类状态，装饰不许用。
- 卡片的边是一圈 1px 渐变环（`::after`，迎光角琥珀 → 冰白 → 淡蓝 → 透明 → 背光角近黑），方向由 `--ice-deg` 决定。
- 圆角用 `--glacier-radius`（默认 6px）覆盖。
- **阵列**（控件是光的传感器，排法决定光场看不看得见，DESIGN.md §4.1）：`.gl-louver` 一维光栅——等高长条竖排、长边朝光，`--gl-louver-gap`（缝，默认 10px）/ `--gl-louver-h`（条高，默认 38px），节距 40–50px 让 160px 的手电里装 3–4 条；`.gl-lattice` 二维晶格——等大方格、缝 ≤ 6px、圆角 2px，`--gl-lattice-cols / -cell / -gap`（默认 7 / 40px / 4px），相邻刀锋融成一道亮缝、交叉点起十字星；格里的 `.gl-lattice-label`（星期、坐标轴）和 `.gl-void`（空位）不是砖、不受光、只占格。
- 背景层类名：`.gl-layer` 公共（fixed 铺满、`z-index: -1`、不吃事件），`.gl-layer-planet`（按 `--gl-dim` 压暗）、`.gl-layer-lamp`（screen 混合）、`.gl-layer-photo`（`cover`，`opacity = exposure × (1 − dim)`，`.gl-photo-gray` 加灰）、`.gl-layer-tint`（`--agy-sun-photo`，color 混合）。

## 6. 性能

设计守则（`DESIGN.md` §13）在库里的体现：画布只在灯动了才重画；渐变 / 贴图按 key 缓存；同值不写；读写分离；**滚动中不读布局**；平行光下砖写一次永远对；页面不可见时背景循环停、回前台补一帧。

实测（2026-11-02，Edge 156 独立配置，1280×900 窗口、DPR 2、60Hz；demo 页 112 个受光元素）：

**整个浏览器的 CPU**（Edge 全部进程合计，页面在前台静止 15 秒，鼠标不动，demo 的漂移节点去掉，Windows 11。每档测了 2–4 次，写范围：Edge 新建配置自己有后台活动，空白页都会在 1–10% 之间漂，所以 10% 以内的差别没有意义）

| 背景模式 | CPU（单核 %） | 说明 |
|---|---|---|
| 空白深色页（基线） | 1–10% | 噪声底 |
| `none` | 2–11% | 只有灯 + 冰砖，在噪声底里 |
| `static` | 1–8% | 画一帧就停，在噪声底里 |
| `photo` | 4–12% | 零画布，两层 div，在噪声底里 |
| `scene`，`idleDivider: 3`（默认） | 33–40% | 空闲每 3 帧画 1 帧 = 20 fps 的 960×600 重绘 + 合成 |
| `scene`，`idleDivider: 6` | 9–30% | 10 fps，肉眼看不出差别（空闲只有星点慢漂、行星慢转）；合成那部分的波动最大 |

同一页面**留着那颗 `data-gl-track` 漂移节点**时：`none` 35%、`static` 39%、`scene` 67%（两档 idleDivider 一样）。一个每帧都在动的元素会逼整页 60 fps 重新合成，而这页有 `mix-blend-mode` 的灯层和 `backdrop-filter` 的卡片，合成不便宜。这是宿主内容的代价，不是库的；但也是「不动的别加 `data-gl-track`」的理由。

**主线程 JS 时间**（页面内 `performance.now()` 包住 `renderFrame`，5 秒窗口）

| 背景模式 | 画了几帧 / 秒 | 每帧 | 每秒占主线程 |
|---|---|---|---|
| `scene` idle 3 | 38.9 | 0.34 ms | 13.1 ms |
| `scene` idle 6 | 19.9 | 0.44 ms | 8.7 ms |
| `static` / `none` | 0 | — | 0 |

所以 CPU 大头不是 JS，是每帧把 960×600 画布合成到屏幕；想省电就 `static`，想要动画又常驻就 `idleDivider: 6`。

**单次操作**（112 个元素）

| 操作 | 耗时 |
|---|---|
| `fixed`：一轮 relight，全部已打过光（找元素 + 给手电量一轮矩形） | 0.48 ms |
| `fixed`：一轮 relight，112 个全部重写变量 | 1.15 ms |
| `fixed`：只给手电量矩形 | 0.27 ms |
| `lamp`：一轮 relight，量 112 个矩形、38 个在视口内、都没变 → 跳过 | 0.86 ms |
| `lamp`：一轮 relight，38 个全部重写 | 1.29 ms |
| 灯游标重画（位置变了，隔任务测；公式或表都一样） | 0.3–0.5 ms |
| 灯静态层重建（换表 / 换区间 / 昼夜切换 / 尺寸变化才做） | 2–6 ms |

**滚动**（窗口滚 900px + 内部容器滚 300px，期间和停下 500ms 后计数）

| 模式 | 滚动中 | 停下 160ms 后 |
|---|---|---|
| `fixed`（默认） | 0 轮打光 | 0 轮打光；手电刷新一轮矩形（0.27 ms），砖上的变量一字不变 |
| `lamp` | 0 轮打光 | 真量一轮、重打一轮 |

建议：

- 普通网站：`background: "static"`。灯照样走、冰砖照样受光，背景一天只重画几十次，CPU 和空白页一样。
- 要动画的页面：`scene` + `idleDivider: 6`；舰态只在真有事做的时候切，`IDLE` 收敛后自动降帧。
- 受光方向用默认的 `fixed`：砖和位置无关，长列表、虚拟滚动、无限加载都不用管。`lamp` 只在「高光跟着灯转」本身是卖点的页面开。
- 不要给 `--ice-*` 驱动的属性加过渡；开着 `observe` 就不用自己调 `relight()`。
- 延时模式（`timelapse`）是演示用的：灯每 80ms 跳一格。

## 7. 已知限制

- 一个 `root` 只能有一个实例；多个实例共存要用不同的 `root`，而且坐标系仍是视口，不是 `root`。
- 晨昏线弧光每帧带 `shadowBlur: 24`，是场景里最贵的一笔。可以烤成贴图。
- 灯画布是全视口 × DPR 的（1280×900 @2x ≈ 9 MB），只有脏矩形重画，但内存在那里。不要灯就 `lampOverlay: false`。
- 手电靠打光那一轮量好的矩形判断远近。滚动**中**不读布局：把正在滚的容器里砖的缓存矩形按滚动位移平移（只读一次 scrollTop），手电照样跟着砖走；停下 160ms 后真量一轮纠偏。
- `data-gl-track` 的元素每帧量一次矩形，而且一个常动的元素会让整页每帧重新合成（§6）。
- `prefers-reduced-motion` 只在 `init()` 时读一次；用户中途改系统设置要重新 `init()`。
- 卡片的 `backdrop-filter` 在 Firefox 旧版本需要开关；`@property`、`round()`、`color-mix()` 需要 Chrome 125+ / Safari 16.4+（`round()` 要 Safari 17.4+）/ Firefox 128+，老浏览器变量照常工作，刀锋偏移不取整。
- 没搬的东西：冰山半衰期（依赖会话列表）、舰态自动检测（依赖 Antigravity 的 DOM 信号）、汉化、终端、飞行日志总线——那些是宿主专属。

## 8. 和别处的关系

- `../DESIGN.md` 是设计语言的源头，改设计先改那里。
- `../custom.css` + `../modules/` 是第一个宿主（Antigravity）的实现，选择器贴着它的 DOM 写，不能直接拿去别处。
- hudd 的 `examples/glacier/` 是第二个宿主：同样的太阳模型、场景、灯，总线换成主进程 IPC，灯横跨整个桌面。本库的 `glacier.js` 第 1–3 节和它的 `glacier-core.js` 相同（去掉了光谱采样和整个地形层），第 4 节的解算器已经换成「刀锋 / 墙 / 角度」三样加平行光，第 5 节的 `init()` 是本库自己的。
- 换到下一个宿主（Web、Electron、WebView、opencode 的 Web UI……）带这两个文件走：宿主要做的只有给深色底、给类名、调 `init()`。
