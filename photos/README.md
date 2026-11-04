# 底片（photos/）

舰桥和 demo 的 `photo` 模式用的灰阶负片。全部来自 NASA 图库（images.nasa.gov），本地处理：转灰阶、裁 16:9、缩到 1920×1080、拉满灰阶、JPEG 82。
压暗不在文件里做——由 `glacier.css` 的亚克力透光平衡基准（`--gl-photo-level: 0.55` + `grayscale(1) contrast(1.32) brightness(0.92)`）在页面上保持 **100% 消色差纯黑白银盐灰阶**，不染任何颜色（把全部色相预算留给前景按钮的 1px 棱镜刀锋与钴蓝暗涌，彻底杜绝彩色底片透进半透明按钮造成色相串味）；动态由跟随太阳游标坐标（`--agy-sun-x / --agy-sun-y`）的径向暗房遮罩做空间局部显影，为毛玻璃卡片与点亮态磁贴提供和 Windhawk 任务栏一致（~28%）的纯明度折射底光。

| 文件 | 航点 | 原图 | 标题 | 出处 / 署名 |
|---|---|---|---|---|
| `home.jpg` | 母星 · 冰星黄昏 | [PIA12654](https://images.nasa.gov/details/PIA12654) | Slender Rings（土星新月与侧视环，2010） | NASA/JPL/Space Science Institute |
| `station.jpg` | 轨道站 · 纯冰 | [PIA08869](https://images.nasa.gov/details/PIA08869)（转 90°，环横着走） | The Inner Rings（C 环与 B 环，2007） | NASA/JPL/Space Science Institute |
| `giant.jpg` | 红巨星 · 日冕边缘 | [GSFC_20171208_Archive_e001769](https://images.nasa.gov/details/GSFC_20171208_Archive_e001769) | Amazing Hi-Def CME（SDO，2012-04-16 东边缘日珥） | NASA/GSFC/SDO |
| `pulsar.jpg` | 脉冲星 · 高频昼夜 | [PIA03606](https://images.nasa.gov/details/PIA03606) | Most Detailed Image of the Crab Nebula（Hubble，2005） | NASA, ESA, J. Hester and A. Loll (Arizona State University) |
| `deep.jpg` | 深空 · 夜航 | [GSFC_20171208_Archive_e001651](https://images.nasa.gov/details/GSFC_20171208_Archive_e001651) | Hubble eXtreme Deep Field（2012） | NASA, ESA, G. Illingworth, D. Magee, P. Oesch (UCSC), R. Bouwens (Leiden), HUDF09 Team |

NASA 自己的影像是公有领域；哈勃的两张含 ESA 署名，按 CC BY 4.0 保留署名（舰桥的 lore 行里也写着）。
原图不进仓库，要重做就按上表的 ID 去 `https://images-api.nasa.gov/asset/<ID>` 取 `~orig`。
