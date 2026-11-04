# Glacier · 星舰冰川 — 独立浏览器库

> 把「一艘停在冰川上的星舰」这套设计语言（规格见上一级的 `DESIGN.md`）打包成两个文件，任何网页 / Electron / WebView 都能直接用。
> **把时间拍扁进空间**：点亮的冰砖、毛玻璃卡片、金星带顶栏（`.gl-bar`）、鼠标手电与太阳轨道弧线，统一锁死 Windhawk 同款的「香槟暖金 `#FFD89B` → 冰晶白 `#E6F4FF` → 金星带暮光紫 + 右下 `inset -1.5px` 深海黑内槽」三色空间光谱；未选中的按钮绝对不带玻璃与边框，一排里只有选中的那一颗是精致的立体玻璃键帽。背后的天体底片则永远锁死 **100% 纯黑白银盐灰阶**（零色相染色、零色相串味），一盏按时间走动的太阳沿横跨视口的轨道推进游标，并用径向暗房探照灯遮罩在黑白底片上局部显影。

```
glacier/
├── glacier.css   令牌与 Windhawk 三色光学常量、@property 注册、画布/底片层、.gl-brick / .gl-nav / .gl-card / .gl-bar / .gl-alert / .gl-track 规则（无 !important、无宿主选择器）
├── glacier.js    Glacier.sun / Lamp / applySunVars，加 Glacier.init()
├── demo.html     组件目录：每个组件一节（砖的五种状态、暗槽、卡片、光栅、晶格、图标、漂移节点、滚动容器）+ 工程面板（时间 / 时钟 / 背景 / 生命周期 / 读数）
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
    const gl = Glacier.init();          // 全默认：无背景层、实时时钟、手电
    // gl.setHour(18); gl.setPhoto("photos/deep.jpg"); gl.destroy(); …
  </script>
</body>
```

三条规则：

1. **画布后面必须是深色。** 灯用 `mix-blend-mode: screen` 混合，底色一白就糊成一片。给 `<body>` 加 `.gl-stage` 就有默认的 `#13141c`；自己有底色也行，深的就好。
2. **要受光的元素加类名**：`.gl-brick`（冰砖按钮）、`.gl-brick.gl-nav`（顶层 / 侧栏按钮，颜色更亮、圆角更小）、`.gl-card`（大块冰板，带毛玻璃和一圈渐变环）、`.gl-brick.gl-alert`（要你看的红砖）。不认识的元素库一概不碰；后来塞进来的节点自动纳入。
3. **把 `glacier.js` 放在 `<body>` 末尾或 `DOMContentLoaded` 之后再 `init()`**，它要往 `<body>` 里插画布、找冰砖。

`glacier.js` 只声明一个全局 `window.Glacier`（CommonJS 环境下同时 `module.exports`），没有依赖，没有构建步骤。
也可以不用 `init()`，直接拿底层的 `Glacier.sun` / `Lamp` / `applySunVars` 自己拼（见 §4）。

### 两个页面

- `demo.html` 是**组件目录**：每个组件一节，各带一行规矩，每块砖都能按（同组单选 `.on`、告警点一下算确认、漂移节点点一下停）；底下是工程面板和压力测试（更多卡片、内部滚动容器、漂移节点）。背景默认空的，工程面板里切 photo 看底片。URL 参数 `?bg=none|photo&photo=<URL>&time=9&drifter=0`。
- `bridge.html` 是**舰桥**（舷窗是当前航点的 NASA 100% 纯黑白银盐灰阶底片，`--gl-photo-level: 0.55` 亚克力透光平衡；`?bg=none` 纯黑）：用同一套积木搭的暗座舱范例（DESIGN.md §4.2）。一切正常时面板是黑的；左边航点光栅（去哪：母星 / 轨道站 / 红巨星 / 脉冲星 / 深空，每个航点带自己的底片和钟），顶上时钟旋钮（多快：航点时刻 / 实时 / 延时 / 手动拨），右边当月日历晶格（今天 `.on`），底部告警行平时是空的（按 A 模拟一条，Esc 清掉；真宿主接心跳）。`?photo=<URL>` 换成自己的灰阶负片（这时航点不再换片）。

## 2. `Glacier.init(options)` 选项

全部可省。`Glacier.DEFAULTS` 里能看到默认值。

| 选项 | 默认 | 含义 |
|---|---|---|
| `background` | `"none"` | `"none"` 不建背景层，只有灯 + 冰砖；`"photo"` 照片当背景（零画布，单节点 `div.gl-layer-photo`，见下面「照片当背景」） |
| `photo` | `null` | 照片 URL（`background: "photo"` 用）。底片永远是 100% 纯黑白银盐灰阶（不染任何彩色），由太阳游标的径向遮罩局部照亮显影 |
| `time` | `"realtime"` | 时钟（现在几点）：`"realtime"` 每 `realtimeInterval` 毫秒对一次表；数字 = 定住这个小时；`"timelapse"` 一天循环（从当前时刻起一圈 `timelapseDuration` 毫秒）；`{ loop: { from, to, duration, bounce } }` 区间来回；`"external"` 不自己走，宿主用 `setHour()` 推 |
| `sunTable` | `null` | 关键帧表（几点钟长什么样，见第 3 节末）；`null` 用内置公式 |
| `lampOverlay` | `true` | 是否画灯 overlay：轨迹按「几点钟灯在哪」那张表采样画（有 `sunTable` 按表，没有按公式；每 0.5 小时一个点，白天实线、夜里虚线）、整点刻度沿着路径放、子区间 `loop` 模式（`span < 24`）把区间那段加亮、当前时刻是一个小柔光游标 + 时间。轨迹与刻度直接用横跨视口的「琥珀 → 冰白 → 金星带暮光紫」水平渐变绘制，静态层与时刻彻底无关（时间走动零重建，换表 / 换子区间 / 改尺寸才重建），游标只重画脏矩形 |
| `torch` / `torchRadius` / `torchSelector` | `true` / `160` / `".gl-brick"` | 鼠标手电（Win10 Reveal）：待机态的砖平时无玻璃无边，鼠标半径内的砖按远近浮现三色径向光圈（琥珀 → 冰白 → 暮光紫），相邻的砖被余光照到一截；已点亮的砖不参与；键盘焦点等价于手电停在那一格。不读布局，只给半径内的砖写 `--torch-*` 变量 |
| `observe` | `true` | 监视 `root` 里的节点增删：新塞进来的 `.gl-brick` 节点自动纳入鼠标手电探测，不用注册、不用调 `relight()` |
| `trackSelector` | `"[data-gl-track]"` | 会自己动的节点（漂移、拖拽、动画）逐帧重新量矩形、被手电探测。这是本库唯一的逐帧布局读取，只给会动的东西加 |
| `dim` | `0.3` | 底片压暗 0–1：照片层不透明度乘 `(1 − dim)`，面板后面的背景要安静 |
| `root` | `document.body` | 画布插到哪、冰砖在哪找、底片变量写在哪 |
| `settleDelay` | `160` | 滚动停下多久算「停下」（毫秒）。停下后给鼠标手电真量一轮矩形纠偏 |
| `realtimeInterval` | `28000` | 实时模式对表间隔（毫秒）。实时一小时灯走约 100px，28 秒一次完全够 |
| `timelapseDuration` | `24000` | 延时模式一天走完的毫秒数（loop 的对表节拍固定 80ms） |
| `onUpdate(state)` | `null` | 每次太阳状态更新后回调（对表、拨时间、尺寸变化、回前台） |

### 照片当背景

底片与玻璃折射的平衡（`--gl-photo-level: 0.55` + 100% 纯黑白银盐灰阶）：天体照片在背景里既不能像自发光的塑料球或跑马灯那样抢正文，又要留出约 28%–35% 的银灰透射率供上面的毛玻璃卡片和点亮冰砖折射（对应 Windhawk `GlacierGlass` 的 `0xB8` 透射率），同时**绝不能给底片染彩色**（一旦底片染上黄昏棕橙或午夜紫蓝，透进半透明 `.gl-brick` 就会把按钮原本的皇家钴蓝搅成脏灰绿）。因此：
- **底片只管纹理与明度（Luminance Only）**：永远锁死 `grayscale(1) contrast(1.32) brightness(0.92)` 纯黑白银盐灰阶，把全部色相预算留给前景按钮的 1px 棱镜刀锋与钴蓝暗涌；
- **太阳探照灯局部显影（Spatial Masking）**：不用全屏一起忽明忽暗的廉价呼吸灯，而是让 `::after` 盖一层以太阳游标坐标（`--agy-sun-x`、`--agy-sun-y`）为圆心的 `85vmax` 径向暗房遮罩——太阳游标所在的星轨扇区把底下的黑白土星环照出 25%–35% 的银白锐度，其余深空压在暗部里；时间推进时，白光探照灯在黑白星环纹理上缓缓滑过。`photos/` 里有五张 NASA 灰阶负片和出处（`photos/README.md`），舰桥一个航点一张。

`Glacier.init({ background: "photo", photo: "photos/home.jpg" })`。一张图一个 `div.gl-layer-photo`，不建任何画布：节点自己是一个独立合成单元（`isolation: isolate` + `screen` 混合叠上黑位地板），`::before` 画高反差纯黑白银盐底片（`cover` 居中），`::after` 叠上跟随太阳坐标 `--agy-sun-x / --agy-sun-y` 的径向暗房遮罩——纯黑在 screen 下恒为 0，黑位地板永远不被污染，700ms 交叉淡化时每一帧都是干净的黑白银盐成品图，中途绝不泛白或串色；外层不透明度 = `--gl-photo-level`（0.55）× `--agy-sun-exposure`（0.68–1.0 微弱呼吸）× `(1 − dim)`。

换成自己的照片：`demo.html` 和 `bridge.html` 默认都用 `photos/home.jpg`（卡西尼拍的土星新月，可带 `?photo=<URL>` 覆盖）。自己选图时，深色、大面积、太空底接近纯黑的图最合适。

坐标系：灯的轨道横跨整个**视口**（`window.innerWidth × innerHeight`），手电按 `getBoundingClientRect()` 的视口坐标探测距离。`root` 只决定画布插在哪、冰砖在哪找，不改坐标系。

## 3. 句柄 API

`init()` 返回一个实例，同一个 `root` 上重复 `init()` 会先 `destroy()` 上一个（热重载、换选项都安全）。

| 成员 | 作用 |
|---|---|
| `setHour(h)` | 定在某个小时（0–24，小数可）；`external` 模式下就是宿主推时间的入口 |
| `setMode("realtime" \| "fixed" \| "loop" \| "external" \| "timelapse")` | 切时钟：跟真实时间 / 定住一帧 / 区间来回 / 宿主推 / 一天循环 |
| `setLoop({ from, to, duration, bounce })` | 在某个区间来回：`from`/`to` 小时，`duration` 毫秒走完一圈，`bounce` 到头折返。例：落日 `{ from: 16, to: 19, duration: 12000, bounce: true }` |
| `setSunTable(table \| null)` | 换「几点钟长什么样」的关键帧表；`null` 回内置公式 |
| `setBackground("none" \| "photo")` | 原地换背景模式（背景层重建，冰砖不动） |
| `setPhoto(url)` | 换底片：`photo` 模式下先解码完，再让新旧底片 700ms 交叉淡化（解码不在主线程上卡，旧的淡出而不是到点拿掉）。每张底片是独立合成单元，染色在单元内部完成，淡的是成品图，中途不会发白；A → B → A 快切时还在淡出的 A 原地救回，不重建节点。其它模式只记下，下次切到 `photo` 用。一个航点一张底片。`Glacier.preloadPhoto(url)` 提前解码，之后零等待 |
| `relight()` | 下一帧重新扫描手电目标并量一轮矩形。宿主关了 `observe` 又自己改了 DOM 时才需要 |
| `stop()` / `start()` | 暂停 / 恢复时钟，DOM 留着 |
| `destroy()` | 全部收回：画布、监听器、定时器、观察器、`root` 上的变量、手电半径内砖上的 `--torch-*` 变量 |
| `sun` | 当前太阳状态：`sunX / sunY / sunU / sunV / h / isDay / lampGlow` 和四组光色 |
| `hour` / `mode` / `background` | 当前时间、时钟模式、背景模式 |
| `lamp` / `options` | 灯对象和合并后的选项（诊断 / 测速用） |

库往页面上写的东西（也就是 `destroy()` 会收回的东西）：

- `root` 前面的背景层（从下到上）：`photo` 模式一个 `div.gl-layer-photo`（淡化期间短暂两个），再加一张 `canvas.gl-layer-lamp`（`lampOverlay: false` 就没有）
- `root.style` 上的 `--agy-sun-x` / `--agy-sun-y`（太阳探照灯在视口里的百分比坐标）、`--agy-sun-exposure`（0.68–1.0，微弱明度呼吸）、`--gl-dim`、`--torch-r`。四组光色、`--agy-sun-photo` 彩色染色和 `--agy-sun-ta` 均已砍掉
- 冰砖和卡片**零常驻内联变量**（全部走 `glacier.css` 焊死的 1px 切边 + `100% 100% at 0% 0%` 归一化三色光学常量）；仅在鼠标手电半径内的砖写三个 `--torch-x / --torch-y / --torch-a`，鼠标移开即删
- `window` 上一个 `resize`，`document` 上一个 `visibilitychange`；开了手电时 `document` 上一个捕获、被动的 `scroll`、`pointermove / pointerleave`、`root` 上的 `focusin / focusout`（以及开了 `observe` 时一个 `MutationObserver`）

### 太阳拆成两层：表 + 时钟

- **表（几点钟长什么样）**：`sunTable` 选项 / `setSunTable()`。关键帧 `{ hour, u, v, glow, isDay, sunCrest, sunSheen, sunTint, sunCaustic, orbCore, orbCorona, orbRayColor }`，`u / v` 是灯在视口里的归一化位置，颜色 `rgba()` 或 `#hex`；少写的字段用内置公式在同一小时的值补齐，相邻帧线性插值（颜色按通道），末帧到首帧跨午夜接上。`Glacier.sun.sampleTable(1)` 把内置公式采成 24 帧，改几帧再喂回去就是自己的一天。
- **时钟（现在几点）**：`time` 选项 / `setMode()` / `setLoop()` / `setHour()`。`realtime` 跟真实时间；数字定住一帧；`loop` 在区间来回（`timelapse` 就是 0→24 的 loop）；`external` 不自己走，由宿主推（hudd 的桌面灯、网关、别的页面的时钟都能当源）。

同一张表配不同时钟：PDF 的台灯、Windhawk 以后按小时换皮、hudd 的桌面灯，都是这个接口。

### 挂上总线即受光

光不属于按钮，属于房间：屏幕里常年飘着两路广播——太阳（轨迹游标、底片曝光）和手电（鼠标坐标、半径）。节点自己是瞎的，一句关于光的代码都没有；只要贴上 `.gl-brick` / `.gl-card`，就等于把插头扣到了总线上：

- 砖与卡片的材质是焊死在 CSS 里的空间三色棱镜（琥珀 `#FFCE91` → 冰白 `#F0FCFF` → 金星带暮光紫 `#BB9AF7`），零内联变量：`init()` 时只找元素、给手电量一次矩形，之后滚动、对表都不碰砖。
- 动态新建的节点：`observe` 看到它出现就纳入，下一轮就能被手电照到。
- 会自己动的节点（漂移、拖拽、动画）：再加 `data-gl-track`，引擎逐帧跟着它量矩形，穿过手电光圈时边缘实时流过高光。demo 里那颗「🛰 漂移节点」就是这么做的。
- 不动的节点别加 `data-gl-track`：逐帧量矩形是这个库里唯一不省的事，而且一个常动的元素会逼整页每帧重新合成（见 §6）。

## 4. 底层 API（不用 `init()` 也能用）

| 成员 | 作用 |
|---|---|
| `Glacier.sun.lampPointAt(hour, W, H)` | 时间 → 灯在 W×H 里的位置（白天 05–19 抛物线，夜里低轨道从右走回左） |
| `Glacier.sun.computeSunState(hour, W, H)` | 位置 + 四组光色 + `lampGlow`（靠近下沿渐隐） |
| `Glacier.sun.sampleTable(step)` / `stateFromTable(table, hour, W, H)` / `frameFromModel(hour)` | 关键帧表：采样内置公式、按表插值出状态、取公式在某小时的一帧 |
| `new Glacier.Lamp(canvas)` → `draw(state, hour, W, H, { path, pathKey, loop })` | 灯 overlay。`path(hour) → { x, y, isDay }` 是轨迹采样器（默认 `Lamp.formulaPath(W, H)`），`pathKey` 换表时要换，`loop = { from, span }` 要加亮的区间。位置取整后没变、颜色没变、尺寸没变就不重画 |
| `Glacier.applySunVars(el, state)` | 把 `--agy-sun-x`、`--agy-sun-y`、`--agy-sun-exposure` 写到 `el` 上，同值不写 |

## 5. CSS 约定

- 令牌在 `:root`：`--agy-bg`、`--agy-fg`、`--agy-accent-cyan`、`--agy-card-alpha`，动效 `--agy-ease-out / spring`、`--agy-dur-base / slow`，底片透射基准 `--gl-photo-level: 0.55`，以及焊死的磁贴光学常量 `--gl-crest-line`（水平 90° `in oklch`：香槟暖金 → 冰晶白 → 金星带暮光紫）、`--gl-edge`（`100% 100% at 0% 0% in oklch` 归一化 1px 单层刀锋，88% 处彻底透明归零）、`--gl-brick-fill`（左上 10% 香槟金微光 + 左下 16% 皇家钴蓝呼吸微光）。
- `--torch-*` 用 `@property` 注册成继承且有类型，`::before` 才能读到、`--torch-a` 才能过渡。不再有任何 `--ice-*` 内联变量（见 `DESIGN.md` §4.3–4.4）。
- `.gl-bar`：金星带顶栏 / 分割栏（复刻 Windhawk 命令栏：左半地球影暗槽 + 右半金星带瑞利散射紫微雾 + 底部 1px `--gl-crest-line` 光谱地平线）。
- **未选中保持烟熏磨砂，点亮态严格对齐 Windows 11 开始菜单磁贴（Word 磁贴）的通透黑曜石结构**（`DESIGN.md` §4.3–4.4）：
  - **静止态**：均匀的烟熏磨砂暗底（`rgba(18, 22, 32, 0.42)`，`.gl-track` 暗槽内完全透明 `transparent`），无边框、无杂斑；静止态 `::before` 仅在鼠标手电靠近时按距离浮现 1px 切边。
  - **点亮态（`.on` / `.gl-fresh` / `:hover`）**：严禁往肚子里灌实心蓝油漆——底色保持 80%+ 深邃黑曜石透明感（`rgba(18, 22, 32, 0.78)` + `backdrop-filter: blur(16px) saturate(160%)`），只叠左上 10% 香槟暖金与左下 16% 皇家钴蓝两团呼吸微光（`--gl-brick-fill`），让背后的土星环底片与星轨清晰穿透；`::before` 严格锁死 `padding: 1px` 物理宽度，用 `radial-gradient(100% 100% at 0% 0% in oklch, #FFD89B 0%, #E6F4FF 36%, rgba(160,140,240,.25) 64%, transparent 88%)` 在右上角与左下角（100%）前彻底透明归零，绝不在右边或底边漏出紫白斑马线；右下沉降只用零模糊的 `box-shadow: inset -1.5px -1.5px 0px #06080E`，文字 `#F0F6FF` 干净锐利无黑阴影。
- `.on` 不贴指示器：环从悬停的 72% 到 100%，正文暖白，砖里的 `<small>` 读数亮成电光青。红灯芯（`.gl-alert` 的 `::after`）只给"要你看"。
- `.gl-fresh` = 极寒凝结态（和选中同一套），`.on` = 选中，`.gl-pop-in` = 面板进场动画，`.gl-track` = 一组小开关共用的下沉暗槽，`.gl-icon` = 把彩色图标压成冷银灰。
- `.gl-alert`：告警 / 要你看的砖（红巨星频段）——勃艮第酒红毛玻璃底 + 底部绯红短灯芯，用于后台任务待确认、报错、未读。红只给这类状态，装饰不许用。
- 卡片的边同样是一圈 1px 的 `--gl-edge` 渐变环（`::after`，85% 不透明：左上香槟暖金 → 冰晶白 → 暮光紫 → 88% 处归零）；厚度靠 `inset -1.5px` 的内暗槽，不在环里。
- 圆角用 `--glacier-radius`（默认 6px）覆盖。
- **阵列**（控件是光的传感器，排法决定光场看不看得见，DESIGN.md §4.1）：`.gl-louver` 一维光栅——等高长条竖排、长边朝光，`--gl-louver-gap`（缝，默认 10px）/ `--gl-louver-h`（条高，默认 38px），节距 40–50px 让 160px 的手电里装 3–4 条；`.gl-lattice` 二维晶格——等大方格、缝 ≤ 6px、圆角 2px，`--gl-lattice-cols / -cell / -gap`（默认 7 / 40px / 4px），相邻刀锋融成一道亮缝、交叉点起十字星；格里的 `.gl-lattice-label`（星期、坐标轴）和 `.gl-void`（空位）不是砖、不受光、只占格。
- 背景层类名：`.gl-layer` 公共（fixed 铺满、`z-index: -1`、不吃事件），`.gl-layer-lamp`（screen 混合）、`.gl-layer-photo`（单节点 `isolation: isolate` + `screen` 混合：`::before` 画 100% 纯黑白银盐底片，`::after` 画跟随 `--agy-sun-x / --agy-sun-y` 的径向暗房遮罩，外层 `opacity = photo-level × exposure × (1 − dim)`）。

## 6. 性能

设计守则（`DESIGN.md` §13）在库里的体现：灯只在动了才重画；渐变按 key 缓存；同值不写；读写分离；**滚动中不读布局**；砖和卡片是 CSS 常数，根本不写；页面不可见时灯不画、回前台补一帧。

实测（2026-11-02，Edge 156 独立配置，1280×900 窗口、DPR 2、60Hz；demo 页 112 个受光元素）：

**整个浏览器的 CPU**（Edge 全部进程合计，页面在前台静止 15 秒，鼠标不动，demo 的漂移节点去掉，Windows 11。每档测了 2–4 次，写范围：Edge 新建配置自己有后台活动，空白页都会在 1–10% 之间漂，所以 10% 以内的差别没有意义）

| 背景模式 | CPU（单核 %） | 说明 |
|---|---|---|
| 空白深色页（基线） | 1–10% | 噪声底 |
| `none` | 2–11% | 只有灯 + 冰砖，在噪声底里 |
| `photo` | 4–12% | 零画布，单层 div，在噪声底里 |

同一页面**留着那颗 `data-gl-track` 漂移节点**时：`none` 35%。一个每帧都在动的元素会逼整页 60 fps 重新合成，而这页有 `mix-blend-mode` 的灯层和 `backdrop-filter` 的卡片，合成不便宜。这是宿主内容的代价，不是库的；但也是「不动的别加 `data-gl-track`」的理由。

**单次操作**（112 个元素）

| 操作 | 耗时 |
|---|---|
| 一轮 `relight`（找手电目标元素 + 给手电量一轮矩形，零 DOM 写操作） | 0.48 ms |
| 只给手电量矩形（`measureRects`） | 0.27 ms |
| 灯游标重画（位置变了，隔任务测；公式或表都一样） | 0.3–0.5 ms |
| 灯静态层重建（仅换表 / 换区间 / 尺寸变化才做，随时间推进 0 重建） | 2–6 ms |

**滚动**（窗口滚 900px + 内部容器滚 300px，期间和停下 500ms 后计数）

| 滚动中 | 停下 160ms 后 |
|---|---|
| 0 次布局读取、0 次 DOM 写入（只按 `scrollTop` 位移平移缓存矩形，让手电跟着砖走） | 手电刷新一轮矩形（0.27 ms），砖上的样式一字不变 |

建议：

- 普通网站：`background: "none"` 或 `"photo"`。灯照样走、冰砖照样受光，`photo` 零画布，CPU 和空白页一样。
- 砖和卡片直接走 CSS 常数，与位置无关，长列表、虚拟滚动、无限加载都不用管；开着 `observe` 就不用自己调 `relight()`。
- 延时模式（`timelapse`）是演示用的：灯每 80ms 跳一格。

## 7. 已知限制

- 一个 `root` 只能有一个实例；多个实例共存要用不同的 `root`，而且坐标系仍是视口，不是 `root`。
- 灯画布是全视口 × DPR 的（1280×900 @2x ≈ 9 MB），只有脏矩形重画，但内存在那里。不要灯就 `lampOverlay: false`。
- 手电靠量好的矩形判断远近。滚动**中**不读布局：把正在滚的容器里砖的缓存矩形按滚动位移平移（只读一次 scrollTop），手电照样跟着砖走；停下 160ms 后真量一轮纠偏。
- `data-gl-track` 的元素每帧量一次矩形，而且一个常动的元素会让整页每帧重新合成（§6）。
- 减弱动态只由 CSS 的 `@media (prefers-reduced-motion)` 管（过渡瞬时完成），JS 侧没有开关，改系统设置实时生效。
- 浏览器特性要求：`@property`（手电变量继承与过渡）、`mask-composite` / `-webkit-mask-composite`（1px 环镂空）、`backdrop-filter`（毛玻璃卡片与点亮态冰砖内胆）、`isolation: isolate`（底片独立合成单元）。
- 没搬的东西：冰山半衰期（依赖会话列表）、舰态自动检测（依赖 Antigravity 的 DOM 信号）、汉化、终端、飞行日志总线——那些是宿主专属。

## 8. 和别处的关系

- `../DESIGN.md` 是设计语言的源头，改设计先改那里。
- `../custom.css` + `../modules/` 是第一个宿主（Antigravity）的实现，选择器贴着它的 DOM 写，不能直接拿去别处。
- hudd 的 `examples/glacier/` 曾是第二个宿主（同样的太阳模型和灯，总线换成主进程 IPC，灯横跨整个桌面）。本库 2026-11-04 已把程序画的行星场景（`Scene` / 星区 / 舰态）和逐元素解算器一起剃掉，那边若还用 `Glacier.Scene`，去 git 历史 `cc67cdd` 拿。本仓库里没有任何东西引用它，这一条没有再验证。
- 换到下一个宿主（Web、Electron、WebView、opencode 的 Web UI……）带这两个文件走：宿主要做的只有给深色底、给类名、调 `init()`。
