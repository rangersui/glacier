# Windhawk × Glacier（星舰冰川）—— 让 Windows 11 系统壳与冰川同源

> 用 [Windhawk](https://windhawk.net)（Ramen Software 的开源 Windows 壳层改造工具）把 Windows 11 的任务栏、开始菜单、通知中心、资源管理器与右键菜单刷成 `DESIGN.md` 里的星舰冰川：**深空黑曜石底、金星带三色光谱高光、毛玻璃、冰砖受光边**。所有修改完全可逆，见第 5 节「怎么撤销」。

## 1. Windows 11 壳的哪些部分能改、靠哪个 Mod

Windows 11 的壳有两种底层：**XAML**（任务栏、开始菜单、通知中心、资源管理器命令栏、新版右键菜单）和 **Win32**（传统窗口、经典右键菜单、文件列表、工具提示）。
Windhawk 对 XAML 部分提供了一组 "Styler" mod（选择器 `target` + 样式 `styles`，支持 `WindhawkBlur`、`LinearGradientBrush` 与 `themeResourceVariables`），对 Win32 部分提供 "Translucent Windows" mod 做亚克力毛玻璃。

| 壳的部分 | 支持度 | 对应 Mod | 光学效果 |
|---|---|---|---|
| 任务栏底、顶边线、按钮悬停/激活态、运行指示条、托盘文字色、托盘溢出面板、任务栏右键菜单 | ✅ 完整 | `windows-11-taskbar-styler` | 深空毛玻璃底、顶边 `1px` 金星带渐变线（晨昏琥珀 → 正午冰白 → 暮光紫）、按钮为冰砖（左上琥珀金迎光边 + 右下深海蓝内墙） |
| Alt+Tab、任务视图（Win+Tab）：底板、窗口卡片、桌面卡片、标题、关闭按钮 | ✅ 完整 | `windows-11-taskbar-styler` | 底板毛玻璃 + 深空压暗；窗口 / 桌面卡片为冰砖（选中点亮、悬停亮边、按下变暗），标题冷白，当前桌面指示条电光青 |
| 任务栏悬停缩略图面板：外框、标题、关闭按钮 | ✅ 完整 | `windows-11-taskbar-styler` | 外框冰砖（悬停亮边）、标题冷白、关闭按钮悬停冰砖 |
| 开始菜单（含 24H2/25H2 单页布局）、搜索框、所有应用、电源 / 头像按钮、文件夹弹窗、右键菜单 | ✅ 完整 | `windows-11-start-menu-styler` | 整块冰川玻璃 + 3% 哑光待机底片 + 点亮冰砖按钮 |
| 通知中心、日历、快速设置（Win+A 磁贴、亮度/音量滑块、底栏按钮）、媒体控件、Toast 弹窗 | ✅ 完整 | `windows-11-notification-center-styler` | 磁贴开启态为点亮冰砖（通过覆盖 `ToggleButton*` 主题资源绕过 Storyboard 动画抢写），滑块冰蓝 `#7AA2F7` |
| 资源管理器上半截：标签栏、地址栏、搜索框、命令栏下沉暗槽与按钮、下拉菜单、工具提示 | ✅ 完整 | `windows-11-file-explorer-styler` | 标签与命令栏按钮为冰砖（当前标签点亮，命令栏整体为下沉暗槽，面包屑路径段平躺在地址栏凹槽内） |
| 资源管理器窗口底、文件列表 / 导航树、经典右键菜单、系统面板宿主窗口 | ✅ 白名单 | `translucent-windows` | 默认白名单模式：仅给 `explorer.exe` 和系统壳进程开启深空亚克力（避免污染第三方 Win32 程序的 GDI 光标与文字） |
| 用户目录文件夹图标（`desktop.ini`） | ✅ 完整 | `icons/` 脚本 | 四级暗舱光学文件夹图标（T1 领航键帽 / T2 标准座舱键 / T3 静默暗槽 / Alert 红巨星沙盒） |

## 2. 目录结构

| 文件 | 对应的 Windhawk Mod ID | 作用 |
|---|---|---|
| `01-taskbar-styler.yaml` | `windows-11-taskbar-styler` | 任务栏、悬停缩略图、Alt+Tab、任务视图 |
| `02-start-menu-styler.yaml` | `windows-11-start-menu-styler` | 开始菜单、搜索框、应用列表 |
| `03-notification-center-styler.yaml` | `windows-11-notification-center-styler` | 通知中心、日历、快速设置（Win+A）、Toast、媒体控件 |
| `04-translucent-windows.yaml` | `translucent-windows` | Win32 资源管理器与系统面板亚克力毛玻璃（进程白名单） |
| `05-file-explorer-styler.yaml` | `windows-11-file-explorer-styler` | 资源管理器标签栏、地址栏、搜索框、命令栏、下拉菜单 |
| `apply-glacier.ps1` | — | 一键将以上 5 个 `.yaml` 写入 Windhawk 注册表设置并触发热重载 |
| `dbwin-capture.ps1` | — | 调试辅助：只读抓取 Windhawk mod 的 `OutputDebugString` 可视树日志 |
| `icons/generate_glacier_icons.py` | — | 生成全套 Glacier 四级暗舱光学文件夹图标（真 Oklab `1px` 金星带刀锋，多尺寸自适应 `.ico`） |
| `icons/apply_glacier_desktop_ini.py` | — | 将生成的 `.ico` 批量应用到用户目录文件夹的 `desktop.ini` 并刷新 Shell 缓存 |

## 3. 怎么套用

### 第一步：安装 Windhawk 与对应 Mod

1. 安装 Windhawk（`winget install RamenSoftware.Windhawk`）。
2. 打开 Windhawk → **Explore**，搜索并安装以下 5 个官方社区 mod：
   - **Windows 11 Taskbar Styler** (`windows-11-taskbar-styler`)
   - **Windows 11 Start Menu Styler** (`windows-11-start-menu-styler`)
   - **Windows 11 Notification Center Styler** (`windows-11-notification-center-styler`)
   - **Translucent Windows** (`translucent-windows`)
   - **Windows 11 File Explorer Styler** (`windows-11-file-explorer-styler`)

### 第二步：一键写入主题

以**管理员身份**打开 PowerShell，进入本目录执行：

```powershell
# 先预览将写入的键值（无需管理员权限）
.\apply-glacier.ps1 -DryRun

# 写入全部 5 个 mod 设置并热重载（需管理员权限）
.\apply-glacier.ps1

# 或仅更新单个 mod
.\apply-glacier.ps1 -Only windows-11-taskbar-styler
```

也可以手动粘贴：打开 Windhawk → **Installed** → 对应 mod → **Settings** → 右上角切换到 **Textual mode** → 粘贴对应 `.yaml` 全文 → **Save settings**。

## 4. 颜色与光学常量对照（`glacier.css` ↔ Windhawk XAML）

| 光学部件 | `glacier.css` / `DESIGN.md` | Windhawk XAML 常量 |
|---|---|---|
| 主底深空玻璃 | `rgba(18, 19, 29, .74)` | `GlacierGlass` = `WindhawkBlur` 模糊 24–28，`TintColor="#B812131D"` |
| 浮层面板底 | `rgba(16, 20, 36, .78)` | `GlacierPanel` = `TintColor="#CC101424"` |
| 迎光刀锋起点（香槟暖金） | `--gl-gold` (`#FFD89B` / `#FFCE91`) | `GlacierEdge` 起点 `#E8FFCE91` |
| 刀锋中段（冰晶白） | `--gl-ice` (`#E6F4FF` / `#F0FCFF`) | `GlacierEdge` 中段 `#36F0FCFF`；顶边线中点 `#D0F0FCFF` |
| 刀锋尾段（金星带暮光紫） | `--gl-violet` (`#BB9AF7`) | `GlacierCrestLine` 右端 `#A0BB9AF7` |
| 右下内暗槽沉降 | `--gl-trench` (`#06080E`) | `BorderThickness=1,1,2,2`（左上 1px 迎光刃，右下 2px `#F0050A18` 内暗墙） |
| 激活指示条 | `--gl-accent-cyan` (`#64E8E5` / `#25F4EE`) | 当前窗口指示条 `#25F4EE`，后台运行短条 `#7AA2F7` |
| 告警红（红巨星频段） | `#FE2C55` | 需注意窗口指示 `#FE2C55` |

## 5. 怎么撤销

- **临时关闭单个 mod**：Windhawk → **Installed** → 关闭对应 mod 右上角开关，立即恢复系统默认外观。
- **回退上一次配置**：`apply-glacier.ps1` 每次写入前都会把原注册表项备份到 `HKLM\SOFTWARE\Windhawk\Engine\Mods\<mod id>\Settings.glacier-backup`。
- **安全模式**：若系统更新后某个 XAML target 不兼容导致异常，可执行 `"C:\Program Files\Windhawk\windhawk.exe" -safe-mode` 进入安全模式禁用对应 mod。

## 6. 核心实现要点与避坑记录

1. **冰砖三律在 XAML 里的落地**：
   - **静止态是哑光底片而非全员皆砖**：未选中磁贴与标签仅保留 3% 哑光底片 `#08FFFFFF`（槽内按钮彻底透明），同时保持 `BorderThickness=1,1,2,2` 且 `BorderBrush=Transparent`，确保悬停点亮时零像素跳动。
   - **凹凸分离**：资源管理器命令栏整体作为下沉暗槽（`#24050A18`），地址栏内部的面包屑路径段平躺在凹槽内，不叠凸砖。
2. **文件级常量隔离**：每个 `.yaml` 的 `styleConstants` 独立解析，`$常量` 不跨文件共享；新增引用前必须确认本文件顶部已定义，否则未解析的字面量传给 XAML 解析器会触发 `0xc000027b`。
3. **资源管理器 XAML 岛防撑高（避免 `…` 溢出菜单向上翻）**：标签、地址栏与命令栏位于固定高度的 XAML 岛内，切勿给外层按钮加垂直 `Margin` 或改标签 `Height`；通过 `explorerFrameContainerHeight: 144`（默认 136）预留 8px 余量即可容纳内层 `1,1,2,2` 边框。
4. **快速设置（Win+A）开启态防天蓝反扑**：开启态背景由 XAML `Storyboard` 状态动画驱动，优先级高于元素本地属性；必须在 `themeResourceVariables` 中覆盖 `ToggleButtonBackgroundChecked*` / `ToggleButtonBorderBrushChecked*` 资源。
5. **任务栏多窗口叠影**：多窗口状态（`MultiWindowNormal / PointerOver / Pressed / Active`）背后的叠影元素 `Border#MultiWindowElement` 需设 `Opacity=0`（不可设 `Visibility=Collapsed`，否则会破坏 `IconPanel` 布局导致图标偏移）。
6. **Translucent Windows 默认进程白名单**：全局关闭 `ThemeBackground` 与 `BackgroundEffects`，仅在 `RuledPrograms` 中对 `explorer.exe` 及系统壳宿主进程（`StartMenuExperienceHost.exe`、`SearchHost.exe`、`ShellExperienceHost.exe`、`ShellHost.exe`）开启深空亚克力，彻底避免第三方 Win32 程序的 GDI XOR 光标与文字选中态被 Direct2D 合成吞没。
7. **免 UWPSpy 抓取 XAML 可视树**：将注册表 `HKLM\SOFTWARE\Windhawk\Engine\Mods\<mod id>` 下 `LoggingEnabled` 设为 `1` 并更新 `SettingsChangeTime`，运行 `.\dbwin-capture.ps1 -OutFile tree.txt -Seconds 60` 即可抓出完整的元素类型与名称树，抓完将 `LoggingEnabled` 改回 `0`。
