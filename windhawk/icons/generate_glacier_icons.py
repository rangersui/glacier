# -*- coding: utf-8 -*-
"""
Glacier (星舰冰川) Folder Icon Generator for Windows Explorer.
Follows the Glacier Optical Design System (DESIGN.md):
  - 85%+ Obsidian Keycap Shell (#0A0D16 -> #111623)
  - 1px Oklab Belt-of-Venus Top Blade (#FFD89B -> #E6F4FF -> #BB9AF7)
  - 3-Tier Dark Cockpit Hierarchy (T1 Pilot, T2 Standard, T3 Receded) + Alert (Red Giant)
  - Size-adaptive multi-resolution ICO (256 PNG + 64/48/32/24/16 32-bit BGRA DIB)
"""

import io
import math
import pathlib
import struct
import numpy as np
from PIL import Image, ImageDraw, ImageFilter


# ============================================================================
# 1. True Oklab Color Interpolation
# ============================================================================

def _srgb_to_linear(c: np.ndarray) -> np.ndarray:
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _linear_to_srgb(c: np.ndarray) -> np.ndarray:
    c = np.clip(c, 0.0, 1.0)
    s = np.where(c <= 0.0031308, c * 12.92, 1.055 * (c ** (1.0 / 2.4)) - 0.055)
    return np.clip(np.round(s * 255.0), 0, 255).astype(np.uint8)


def rgb_to_oklab(rgb: tuple[int, int, int]) -> np.ndarray:
    lin = _srgb_to_linear(np.array(rgb, dtype=np.float64))
    r, g, b = lin[0], lin[1], lin[2]
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = np.cbrt(l), np.cbrt(m), np.cbrt(s)
    L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
    a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
    b_ = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    return np.array([L, a, b_], dtype=np.float64)


def oklab_to_rgb_array(lab: np.ndarray) -> np.ndarray:
    L, a, b_ = lab[..., 0], lab[..., 1], lab[..., 2]
    l_ = L + 0.3963377774 * a + 0.2158037573 * b_
    m_ = L - 0.1055613458 * a - 0.0638541728 * b_
    s_ = L - 0.0894841775 * a - 1.2914855480 * b_
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    lin = np.stack([r, g, bl], axis=-1)
    return _linear_to_srgb(lin)


def sample_oklab_Stops(t: np.ndarray, stops: list[tuple[float, tuple[int, int, int]]]) -> np.ndarray:
    """Interpolate RGB stops in Oklab space over array t in [0, 1]."""
    labs = [rgb_to_oklab(c) for _, c in stops]
    pos = [p for p, _ in stops]
    out_lab = np.zeros(t.shape + (3,), dtype=np.float64)
    t_clamped = np.clip(t, pos[0], pos[-1])
    for i in range(len(stops) - 1):
        p0, p1 = pos[i], pos[i + 1]
        mask = (t_clamped >= p0) & (t_clamped <= p1 if i == len(stops) - 2 else t_clamped < p1)
        if np.any(mask):
            u = (t_clamped[mask] - p0) / max(1e-9, (p1 - p0))
            out_lab[mask] = labs[i] * (1.0 - u[..., None]) + labs[i + 1] * u[..., None]
    return oklab_to_rgb_array(out_lab)


# Glacier Palette Constants
GL_GOLD = (255, 216, 155)      # #FFD89B
GL_ICE = (230, 244, 255)       # #E6F4FF
GL_VIOLET = (187, 154, 247)    # #BB9AF7
GL_COBALT = (45, 110, 255)     # #2D6EFF
GL_CYAN = (100, 232, 229)      # #64E8E5
GL_SILVER = (200, 220, 245)    # #C8DCF5
GL_CRIMSON = (254, 44, 85)     # #FE2C55
GL_ROSE = (255, 155, 179)      # #FF9BB3


# ============================================================================
# 2. Obsidian Keycap Folder Shell Renderer
# ============================================================================

def _rounded_rect_sdf(x: np.ndarray, y: np.ndarray, x0: float, y0: float, x1: float, y1: float, r: float) -> np.ndarray:
    """Signed distance field for a rounded rectangle (negative inside)."""
    cx = (x0 + x1) * 0.5
    cy = (y0 + y1) * 0.5
    hx = (x1 - x0) * 0.5 - r
    hy = (y1 - y0) * 0.5 - r
    dx = np.maximum(np.abs(x - cx) - hx, 0.0)
    dy = np.maximum(np.abs(y - cy) - hy, 0.0)
    return np.hypot(dx, dy) - r + np.minimum(np.maximum(np.abs(x - cx) - hx, np.abs(y - cy) - hy), 0.0)


def _back_tab_sdf(x: np.ndarray, y: np.ndarray, S: float) -> tuple[np.ndarray, np.ndarray]:
    """
    Machined folder backplate with a C1-smooth cubic Hermite angled tab shoulder.
    Returns (sdf_distance, y_top_curve).
    """
    u = np.clip((x - 0.37 * S) / (0.11 * S), 0.0, 1.0)
    s = u * u * (3.0 - 2.0 * u)
    y_top = (0.132 + 0.078 * s) * S
    d = _rounded_rect_sdf(x, y, 0.065 * S, y_top, 0.935 * S, 0.865 * S, 0.060 * S)
    return d, y_top


def render_folder_shell(size: int, tier: str = "t2") -> Image.Image:
    """
    Render the Glacier Obsidian Folder Shell at target `size` using supersampled SDF + Oklab optics.
    tier in {"t1", "t2", "t3", "alert"}.
    """
    # Supersampling factor: 2x for 256, 4x for smaller sizes so edges are razor-sharp
    ss = 2 if size >= 128 else 4
    S = size * ss
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float64)

    # Scale-adaptive stroke boost for small icon sizes (16, 24, 32)
    # Ensures the 1px Belt-of-Venus blade remains physically >= 1px after downsampling
    blade_px = max(float(ss), (1.35 if size >= 64 else (1.55 if size >= 32 else 1.85)) * ss * (size / 64.0 if size >= 64 else 1.0))
    if size == 256:
        blade_px = 3.2 * ss  # ~3.2px at 256 so it reads as a crisp high-DPI 1.25px blade

    canvas = np.zeros((S, S, 4), dtype=np.float64)

    def blend_over(dst: np.ndarray, src_rgb: np.ndarray, src_a: np.ndarray):
        src_a = np.clip(src_a, 0.0, 1.0)[..., None]
        dst_rgb = dst[..., :3]
        dst_a = dst[..., 3:4]
        out_a = src_a + dst_a * (1.0 - src_a)
        safe_a = np.where(out_a > 1e-6, out_a, 1.0)
        out_rgb = (src_rgb * src_a + dst_rgb * dst_a * (1.0 - src_a)) / safe_a
        dst[..., :3] = out_rgb
        dst[..., 3:4] = out_a

    # ------------------------------------------------------------------------
    # Layer 0: Outer Ambient Drop Shadow (only visible on 48+ to keep 16/24 ultra-clean)
    # ------------------------------------------------------------------------
    if size >= 24:
        d_shadow = _rounded_rect_sdf(xx, yy - 0.028 * S, 0.068 * S, 0.22 * S, 0.932 * S, 0.885 * S, 0.075 * S)
        sigma = 0.042 * S
        sh_alpha = np.exp(-np.maximum(d_shadow, 0.0) ** 2 / (2.0 * sigma ** 2)) * 0.56
        sh_rgb = np.zeros((S, S, 3), dtype=np.float64)
        sh_rgb[..., :] = (2, 4, 9)
        blend_over(canvas, sh_rgb, sh_alpha)

    # ------------------------------------------------------------------------
    # Layer 1: Recessed Backplate + Angled Folder Tab
    # ------------------------------------------------------------------------
    d_back, y_top_curve = _back_tab_sdf(xx, yy, float(S))
    back_cov = np.clip(0.5 - d_back / 1.15, 0.0, 1.0)

    # Backplate base gradient (deep recessed trench #060911 -> #0B101C)
    ny_back = np.clip((yy - 0.13 * S) / (0.74 * S), 0.0, 1.0)
    nx_back = np.clip((xx - 0.065 * S) / (0.87 * S), 0.0, 1.0)
    if tier == "alert":
        back_top = np.array([22.0, 10.0, 16.0])
        back_bot = np.array([9.0, 6.0, 11.0])
    elif tier == "t3":
        back_top = np.array([10.0, 13.0, 20.0])
        back_bot = np.array([5.0, 7.0, 12.0])
    elif tier == "t1":
        back_top = np.array([18.0, 23.0, 36.0])
        back_bot = np.array([8.0, 11.0, 18.0])
    else:
        back_top = np.array([13.0, 17.0, 27.0])
        back_bot = np.array([6.0, 9.0, 15.0])

    back_rgb = back_top * (1.0 - ny_back[..., None]) + back_bot * ny_back[..., None]

    # Subtle warm-gold / cold-silver rim along the top contour of the tab and backplate
    tab_rim_dist = np.abs(d_back + 0.45 * blade_px)
    tab_top_only = np.clip(1.0 - (yy - y_top_curve) / (0.045 * S), 0.0, 1.0)
    tab_left_fade = np.clip(1.15 - nx_back * 0.85, 0.0, 1.0)
    tab_top_mask = np.clip(1.0 - tab_rim_dist / (blade_px * 0.72), 0.0, 1.0) * tab_top_only * tab_left_fade
    tab_rim_strength = {"t1": 0.58, "t2": 0.28, "t3": 0.16, "alert": 0.44}[tier]
    rim_col = np.array(GL_GOLD if tier == "t1" else (GL_ROSE if tier == "alert" else GL_SILVER), dtype=np.float64)
    back_rgb = back_rgb * (1.0 - (tab_top_mask * tab_rim_strength)[..., None]) + rim_col * (tab_top_mask * tab_rim_strength)[..., None]

    blend_over(canvas, back_rgb, back_cov)

    # ------------------------------------------------------------------------
    # Layer 2: Front Obsidian Keycap Plate (.gl-brick / .gl-card optics)
    # ------------------------------------------------------------------------
    fx0, fy0, fx1, fy1 = 0.065 * S, 0.258 * S, 0.935 * S, 0.875 * S
    fr = 0.066 * S
    d_front = _rounded_rect_sdf(xx, yy, fx0, fy0, fx1, fy1, fr)
    front_cov = np.clip(0.5 - d_front / 1.15, 0.0, 1.0)

    # Subtle dark separation shadow cast by the front keycap onto the backplate right above fy0
    pocket_shadow = np.clip(1.0 - np.abs(yy - fy0) / (0.032 * S), 0.0, 1.0) * (yy < fy0) * back_cov * 0.55
    canvas[..., :3] *= (1.0 - pocket_shadow[..., None])

    # Normalized coordinates inside front keycap [0, 1]
    fnx = np.clip((xx - fx0) / (fx1 - fx0), 0.0, 1.0)
    fny = np.clip((yy - fy0) / (fy1 - fy0), 0.0, 1.0)

    # 2a. Base 162-deg obsidian gradient (#121726 -> #0B0E17 -> #070910)
    t_grad = np.clip(0.28 * fnx + 0.72 * fny, 0.0, 1.0)
    if tier == "alert":
        c_top = np.array([26.0, 13.0, 20.0])
        c_bot = np.array([10.0, 7.0, 12.0])
    elif tier == "t3":
        c_top = np.array([12.0, 15.0, 23.0])
        c_bot = np.array([6.0, 8.0, 13.0])
    elif tier == "t1":
        c_top = np.array([21.0, 27.0, 44.0])
        c_bot = np.array([9.0, 12.0, 21.0])
    else:
        c_top = np.array([16.0, 21.0, 33.0])
        c_bot = np.array([8.0, 10.0, 17.0])

    front_rgb = c_top * (1.0 - t_grad[..., None]) + c_bot * t_grad[..., None]

    # 2b. Top-left warm champagne-gold radial glow (at 18%, 0%)
    d_gold = np.hypot((fnx - 0.18) / 0.72, (fny - 0.0) / 0.58)
    gold_glow_strength = {"t1": 0.22, "t2": 0.09, "t3": 0.02, "alert": 0.10}[tier]
    gold_glow = np.clip(1.0 - d_gold, 0.0, 1.0) ** 1.8 * gold_glow_strength
    front_rgb = front_rgb * (1.0 - gold_glow[..., None]) + np.array(GL_GOLD) * gold_glow[..., None]

    # 2c. Bottom-left royal-cobalt radial glow (at 14%, 100%) — or crimson for alert
    d_cobalt = np.hypot((fnx - 0.14) / 0.78, (fny - 1.0) / 0.62)
    cobalt_strength = {"t1": 0.22, "t2": 0.13, "t3": 0.05, "alert": 0.24}[tier]
    cobalt_glow = np.clip(1.0 - d_cobalt, 0.0, 1.0) ** 1.7 * cobalt_strength
    bottom_tint = np.array(GL_CRIMSON if tier == "alert" else GL_COBALT, dtype=np.float64)
    front_rgb = front_rgb * (1.0 - cobalt_glow[..., None]) + bottom_tint * cobalt_glow[..., None]

    # 2d. Bottom-right dark settlement trench (inset -1px -1px 0 rgba(4, 6, 11, 0.85))
    d_trench = np.hypot((fnx - 0.92) / 0.65, (fny - 0.95) / 0.55)
    trench_mask = np.clip(1.0 - d_trench, 0.0, 1.0) ** 1.6 * 0.45
    front_rgb = front_rgb * (1.0 - trench_mask[..., None]) + np.array([4.0, 6.0, 11.0]) * trench_mask[..., None]

    # 2e. Subtle inner glass horizon sheen across the upper 28% of the front plate
    sheen = np.clip(1.0 - fny / 0.28, 0.0, 1.0) ** 2.2 * ({"t1": 0.06, "t2": 0.03, "t3": 0.01, "alert": 0.04}[tier])
    front_rgb = np.clip(front_rgb + 255.0 * sheen[..., None], 0.0, 255.0)

    # ------------------------------------------------------------------------
    # Layer 3: 1px Oklab Belt-of-Venus Blade along Front Plate Top & Left Rim
    # ------------------------------------------------------------------------
    border_band = np.clip(1.0 - np.abs(d_front + 0.5 * blade_px) / (0.58 * blade_px), 0.0, 1.0)

    # Radial distance from the top-left optical anchor (fnx = 0.14, fny = 0.0)
    t_blade = np.hypot((fnx - 0.14) * 0.92, fny * 1.65)
    t_blade_norm = np.clip(t_blade / 0.92, 0.0, 1.0)

    if tier == "alert":
        blade_stops = [
            (0.00, GL_GOLD),
            (0.35, GL_ROSE),
            (0.70, GL_CRIMSON),
            (1.00, (40, 12, 22)),
        ]
    elif tier == "t3":
        blade_stops = [
            (0.00, (195, 208, 228)),
            (0.45, (150, 168, 196)),
            (0.80, (95, 112, 140)),
            (1.00, (20, 26, 40)),
        ]
    else:
        # True Glacier Belt-of-Venus Oklab stops: Gold 0% -> Ice 36% -> Violet 64% -> Abyss 100%
        blade_stops = [
            (0.00, GL_GOLD),
            (0.36, GL_ICE),
            (0.64, GL_VIOLET),
            (1.00, (22, 28, 46)),
        ]

    blade_rgb = sample_oklab_Stops(t_blade_norm, blade_stops).astype(np.float64)

    # Top edge gets the full Belt-of-Venus blade; left/right/bottom fade gracefully into a quiet rim
    top_weight = np.clip(1.0 - fny / 0.16, 0.0, 1.0) ** 1.4
    left_weight = np.clip(1.0 - fnx / 0.12, 0.0, 1.0) * np.clip(1.0 - fny / 0.65, 0.0, 1.0)
    ambient_rim = 0.15 if tier == "t1" else (0.11 if tier == "t2" else (0.14 if tier == "alert" else 0.07))

    tier_blade_gain = {"t1": 1.00, "t2": 0.62, "t3": 0.28, "alert": 0.85}[tier]
    blade_fade = np.clip(1.0 - (t_blade_norm ** 1.65), 0.0, 1.0)
    directional_weight = np.maximum(np.maximum(top_weight, left_weight * 0.72) * blade_fade, ambient_rim)
    blade_alpha = border_band * directional_weight * tier_blade_gain

    front_rgb = front_rgb * (1.0 - blade_alpha[..., None]) + blade_rgb * blade_alpha[..., None]

    # ------------------------------------------------------------------------
    # Layer 4b: T1 Star-Core Specular Glint / Alert Bottom Crimson Short Wick
    # ------------------------------------------------------------------------
    if tier == "t1":
        # Concentrated star-gold specular bloom along the top-left blade (fnx ~ 0.18, fny ~ 0.0)
        d_glint = np.hypot((fnx - 0.20) / 0.18, fny / 0.045)
        glint = np.clip(1.0 - d_glint, 0.0, 1.0) ** 2.0 * border_band * 0.55
        front_rgb = np.clip(front_rgb + np.array([255.0, 240.0, 210.0]) * glint[..., None], 0.0, 255.0)
    elif tier == "alert":
        # Signature .gl-alert bottom crimson short wick (#FE2C55) centered at bottom edge
        wick_x = np.clip(1.0 - np.abs(fnx - 0.50) / 0.24, 0.0, 1.0) ** 1.3
        wick_y = np.clip(1.0 - (1.0 - fny) / 0.06, 0.0, 1.0)
        wick_band = border_band * wick_x * wick_y * 0.95
        front_rgb = front_rgb * (1.0 - wick_band[..., None]) + np.array(GL_CRIMSON, dtype=np.float64) * wick_band[..., None]

    blend_over(canvas, front_rgb, front_cov)

    canvas[..., 3] *= 255.0
    out_u8 = np.clip(np.round(canvas), 0, 255).astype(np.uint8)
    img_ss = Image.fromarray(out_u8)
    if ss > 1:
        return img_ss.resize((size, size), Image.Resampling.LANCZOS)
    return img_ss


# ============================================================================
# 3. Laser-Etched Vector Glyph Renderer
# ============================================================================

def render_glyph_layer(size: int, glyph: str, tier: str, accent: tuple[int, int, int]) -> Image.Image:
    """
    Render the laser-etched glyph inside the front keycap plate at 4x supersampling.
    Front keycap center is at (0.50 * S, 0.575 * S).
    """
    ss = 4
    S = size * ss
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    # Center of the front keycap plate
    cx, cy = 0.50 * S, 0.578 * S
    # Characteristic radius of the glyph
    R = 0.185 * S

    # Stroke width adaptive to icon size so 16x16 and 24x24 remain ultra-crisp
    if size <= 16:
        sw = max(3, int(round(0.068 * S)))
    elif size <= 24:
        sw = max(3, int(round(0.056 * S)))
    elif size <= 32:
        sw = max(3, int(round(0.048 * S)))
    else:
        sw = max(4, int(round(0.038 * S)))

    sw_thin = max(2, int(round(sw * 0.72)))

    # Primary and accent colors by tier
    if tier == "t1":
        pri = (242, 247, 255, 248)        # #F2F7FF bright laser-etched ice white
        sec = (*accent, 255)              # Full saturation focal anchor
        sub = (185, 208, 238, 175)
    elif tier == "t2":
        pri = (218, 232, 250, 228)        # #DAE8FA controlled cockpit white-silver
        sec = (*accent, 230)
        sub = (160, 185, 218, 145)
    elif tier == "alert":
        pri = (255, 236, 242, 242)
        sec = (*GL_CRIMSON, 255)
        sub = (*GL_ROSE, 180)
    else:  # t3 receded
        pri = (148, 168, 196, 172)        # #94A8C4 quiet etched cold-silver
        sec = (
            int(accent[0] * 0.65 + 148 * 0.35),
            int(accent[1] * 0.65 + 168 * 0.35),
            int(accent[2] * 0.65 + 196 * 0.35),
            190,
        )
        sub = (118, 136, 164, 120)

    def line(p0, p1, col=pri, w=sw):
        draw.line([p0, p1], fill=col, width=w, joint="curve")
        # Round caps
        r_cap = w * 0.48
        for px, py in (p0, p1):
            draw.ellipse([px - r_cap, py - r_cap, px + r_cap, py + r_cap], fill=col)

    def polyline(pts, col=pri, w=sw, closed=False):
        if closed:
            pts = list(pts) + [pts[0]]
        for i in range(len(pts) - 1):
            line(pts[i], pts[i + 1], col=col, w=w)

    def circle_outline(x, y, r, col=pri, w=sw):
        draw.ellipse([x - r, y - r, x + r, y + r], outline=col, width=w)

    def dot(x, y, r, col=sec):
        draw.ellipse([x - r, y - r, x + r, y + r], fill=col)

    def star4(x, y, r_outer, r_inner, col=sec):
        pts = []
        for i in range(8):
            ang = i * math.pi / 4.0 - math.pi / 2.0
            rr = r_outer if i % 2 == 0 else r_inner
            pts.append((x + rr * math.cos(ang), y + rr * math.sin(ang)))
        draw.polygon(pts, fill=col)

    # ------------------------------------------------------------------------
    # Glyph Geometries
    # ------------------------------------------------------------------------
    if glyph == "glacier-orbit":
        # Bespoke Glacier emblem: Centripetal Catmull-Rom solar trajectory arc + horizon + 4-point star cursor
        # Horizon baseline
        line((cx - 0.95 * R, cy + 0.42 * R), (cx + 0.95 * R, cy + 0.42 * R), col=sub, w=sw_thin)
        # Parabolic solar orbit arc
        arc_pts = []
        for i in range(25):
            u = -0.92 + 1.84 * (i / 24.0)
            ax = cx + u * R
            ay = cy - 0.58 * R * (1.0 - u * u * 1.15)
            arc_pts.append((ax, ay))
        polyline(arc_pts, col=pri, w=sw)
        # Star cursor at 10:30 position on the orbit (u = -0.28)
        sx = cx - 0.28 * R
        sy = cy - 0.58 * R * (1.0 - (-0.28) ** 2 * 1.15)
        dot(sx, sy, 0.34 * R, col=(*GL_GOLD, 65))
        star4(sx, sy, 0.36 * R, 0.11 * R, col=sec)
        dot(sx, sy, 0.09 * R, col=(255, 250, 240, 255))

    elif glyph == "spark":
        # 4-point AI star + orbital satellite spark
        star4(cx - 0.08 * R, cy + 0.04 * R, 0.92 * R, 0.24 * R, col=pri)
        star4(cx - 0.08 * R, cy + 0.04 * R, 0.42 * R, 0.11 * R, col=sec)
        star4(cx + 0.68 * R, cy - 0.62 * R, 0.34 * R, 0.10 * R, col=sec)

    elif glyph == "code":
        # < / > laser-etched brackets
        polyline([(cx - 0.42 * R, cy - 0.55 * R), (cx - 0.92 * R, cy), (cx - 0.42 * R, cy + 0.55 * R)], col=pri, w=sw)
        polyline([(cx + 0.42 * R, cy - 0.55 * R), (cx + 0.92 * R, cy), (cx + 0.42 * R, cy + 0.55 * R)], col=pri, w=sw)
        line((cx + 0.16 * R, cy - 0.68 * R), (cx - 0.16 * R, cy + 0.68 * R), col=sec, w=sw)

    elif glyph == "terminal":
        # >_ command prompt
        polyline([(cx - 0.78 * R, cy - 0.52 * R), (cx - 0.18 * R, cy + 0.02 * R), (cx - 0.78 * R, cy + 0.56 * R)], col=pri, w=sw)
        line((cx + 0.08 * R, cy + 0.56 * R), (cx + 0.78 * R, cy + 0.56 * R), col=sec, w=sw)

    elif glyph in ("chip", "search-chip"):
        # QFP IC package + pins + internal silicon core
        b = 0.58 * R
        draw.rounded_rectangle([cx - b, cy - b, cx + b, cy + b], radius=0.16 * R, outline=pri, width=sw)
        for off in (-0.32 * R, 0.0, 0.32 * R):
            # Top & bottom pins
            line((cx + off, cy - b), (cx + off, cy - 0.92 * R), col=sub, w=sw_thin)
            line((cx + off, cy + b), (cx + off, cy + 0.92 * R), col=sub, w=sw_thin)
            # Left & right pins
            line((cx - b, cy + off), (cx - 0.92 * R, cy + off), col=sub, w=sw_thin)
            line((cx + b, cy + off), (cx + 0.92 * R, cy + off), col=sub, w=sw_thin)
        if glyph == "search-chip":
            circle_outline(cx, cy, 0.25 * R, col=sec, w=sw_thin)
        else:
            ib = 0.22 * R
            draw.rounded_rectangle([cx - ib, cy - ib, cx + ib, cy + ib], radius=0.06 * R, fill=sec)

    elif glyph == "chart":
        # Quantitative candlestick + ascending trajectory + gold apex node
        line((cx - 0.88 * R, cy + 0.68 * R), (cx + 0.88 * R, cy + 0.68 * R), col=sub, w=sw_thin)
        pts = [
            (cx - 0.82 * R, cy + 0.36 * R),
            (cx - 0.28 * R, cy - 0.12 * R),
            (cx + 0.16 * R, cy + 0.18 * R),
            (cx + 0.78 * R, cy - 0.58 * R),
        ]
        polyline(pts, col=pri, w=sw)
        # Arrowhead / apex star node at top-right
        dot(cx + 0.78 * R, cy - 0.58 * R, 0.18 * R, col=sec)
        dot(cx - 0.28 * R, cy - 0.12 * R, 0.12 * R, col=pri)

    elif glyph == "book":
        # Open technical manual / syllabus
        # Left page & right page
        polyline([
            (cx, cy - 0.52 * R),
            (cx - 0.82 * R, cy - 0.68 * R),
            (cx - 0.82 * R, cy + 0.48 * R),
            (cx, cy + 0.66 * R),
            (cx + 0.82 * R, cy + 0.48 * R),
            (cx + 0.82 * R, cy - 0.68 * R),
            (cx, cy - 0.52 * R),
        ], col=pri, w=sw)
        line((cx, cy - 0.52 * R), (cx, cy + 0.66 * R), col=sec, w=sw)

    elif glyph == "bolt":
        # High-voltage power / edge energy lightning glyph
        pts = [
            (cx + 0.14 * R, cy - 0.88 * R),
            (cx - 0.52 * R, cy + 0.04 * R),
            (cx + 0.04 * R, cy + 0.04 * R),
            (cx - 0.16 * R, cy + 0.88 * R),
            (cx + 0.52 * R, cy - 0.06 * R),
            (cx - 0.04 * R, cy - 0.06 * R),
        ]
        polyline(pts, col=pri, w=sw, closed=True)
        dot(cx + 0.02 * R, cy - 0.01 * R, 0.15 * R, col=sec)

    elif glyph == "building":
        # Architectural twin towers / headquarters
        draw.rounded_rectangle([cx - 0.76 * R, cy - 0.72 * R, cx + 0.06 * R, cy + 0.70 * R], radius=0.08 * R, outline=pri, width=sw)
        draw.rounded_rectangle([cx + 0.06 * R, cy - 0.22 * R, cx + 0.76 * R, cy + 0.70 * R], radius=0.08 * R, outline=sub, width=sw_thin)
        # Beacon windows
        dot(cx - 0.35 * R, cy - 0.36 * R, 0.12 * R, col=sec)
        dot(cx - 0.35 * R, cy + 0.02 * R, 0.12 * R, col=pri)
        dot(cx + 0.41 * R, cy + 0.16 * R, 0.11 * R, col=sec)

    elif glyph == "tools":
        # Precision engineering sliders / control matrix
        for idx, (yy_off, knob_x, is_sec) in enumerate([
            (-0.48 * R, -0.22 * R, True),
            (0.0, +0.30 * R, False),
            (+0.48 * R, -0.08 * R, False),
        ]):
            y_line = cy + yy_off
            line((cx - 0.80 * R, y_line), (cx + 0.80 * R, y_line), col=sub if not is_sec else pri, w=sw_thin)
            dot(cx + knob_x, y_line, 0.20 * R, col=sec if is_sec else pri)

    elif glyph.startswith("cloud"):
        # Clean geometric cloud silhouette + badge
        # Base flat-bottomed cloud arc
        line((cx - 0.62 * R, cy + 0.46 * R), (cx + 0.62 * R, cy + 0.46 * R), col=pri, w=sw)
        draw.arc([cx - 0.92 * R, cy - 0.18 * R, cx - 0.22 * R, cy + 0.46 * R], start=110, end=295, fill=pri, width=sw)
        draw.arc([cx - 0.52 * R, cy - 0.66 * R, cx + 0.42 * R, cy + 0.26 * R], start=185, end=355, fill=pri, width=sw)
        draw.arc([cx + 0.12 * R, cy - 0.26 * R, cx + 0.90 * R, cy + 0.46 * R], start=255, end=85, fill=pri, width=sw)
        if glyph == "cloud-work":
            dot(cx, cy + 0.06 * R, 0.18 * R, col=sec)
        elif glyph == "cloud-study":
            star4(cx, cy + 0.04 * R, 0.28 * R, 0.10 * R, col=sec)
        else:
            dot(cx, cy + 0.08 * R, 0.15 * R, col=sec)

    elif glyph == "key":
        # Cryptographic key
        kr = 0.36 * R
        kx = cx - 0.38 * R
        circle_outline(kx, cy, kr, col=pri, w=sw)
        dot(kx, cy, 0.12 * R, col=sec)
        line((kx + kr, cy), (cx + 0.82 * R, cy), col=pri, w=sw)
        line((cx + 0.48 * R, cy), (cx + 0.48 * R, cy + 0.32 * R), col=sec, w=sw)
        line((cx + 0.76 * R, cy), (cx + 0.76 * R, cy + 0.38 * R), col=sec, w=sw)

    elif glyph == "package":
        # Isometric hexagon cube (.docker, .vcpkg, .gradle, .cache, scoop)
        pts_outer = []
        for i in range(6):
            ang = i * math.pi / 3.0 - math.pi / 2.0
            pts_outer.append((cx + 0.84 * R * math.cos(ang), cy + 0.84 * R * math.sin(ang)))
        polyline(pts_outer, col=pri, w=sw, closed=True)
        # Inner Y seams
        line((cx, cy), pts_outer[1], col=sub, w=sw_thin)
        line((cx, cy), pts_outer[3], col=sub, w=sw_thin)
        line((cx, cy), pts_outer[5], col=sub, w=sw_thin)
        dot(cx, cy, 0.17 * R, col=sec)

    elif glyph == "shield":
        # Security / Sandbox shield (.sbx-denybin, tencent-sandbox, .cisco)
        pts = [
            (cx, cy - 0.82 * R),
            (cx + 0.72 * R, cy - 0.50 * R),
            (cx + 0.62 * R, cy + 0.18 * R),
            (cx, cy + 0.84 * R),
            (cx - 0.62 * R, cy + 0.18 * R),
            (cx - 0.72 * R, cy - 0.50 * R),
        ]
        polyline(pts, col=pri, w=sw, closed=True)
        if tier == "alert":
            line((cx, cy - 0.34 * R), (cx, cy + 0.12 * R), col=sec, w=sw)
            dot(cx, cy + 0.38 * R, 0.13 * R, col=sec)
        else:
            dot(cx, cy - 0.02 * R, 0.18 * R, col=sec)

    elif glyph == "monitor":
        # Cockpit display (Desktop, .windows-mcp)
        draw.rounded_rectangle([cx - 0.82 * R, cy - 0.66 * R, cx + 0.82 * R, cy + 0.36 * R], radius=0.14 * R, outline=pri, width=sw)
        line((cx, cy + 0.38 * R), (cx, cy + 0.72 * R), col=sub, w=sw_thin)
        line((cx - 0.42 * R, cy + 0.72 * R), (cx + 0.42 * R, cy + 0.72 * R), col=pri, w=sw)
        dot(cx - 0.44 * R, cy - 0.30 * R, 0.13 * R, col=sec)

    elif glyph == "document":
        # Folded document sheet (Documents, .crossnote)
        pts = [
            (cx - 0.58 * R, cy - 0.78 * R),
            (cx + 0.22 * R, cy - 0.78 * R),
            (cx + 0.58 * R, cy - 0.42 * R),
            (cx + 0.58 * R, cy + 0.78 * R),
            (cx - 0.58 * R, cy + 0.78 * R),
        ]
        polyline(pts, col=pri, w=sw, closed=True)
        line((cx - 0.28 * R, cy - 0.12 * R), (cx + 0.28 * R, cy - 0.12 * R), col=sec, w=sw_thin)
        line((cx - 0.28 * R, cy + 0.26 * R), (cx + 0.28 * R, cy + 0.26 * R), col=sub, w=sw_thin)

    elif glyph == "download":
        # Precision downward vector arrow into tray (Downloads, .lwe-installer)
        line((cx, cy - 0.76 * R), (cx, cy + 0.32 * R), col=pri, w=sw)
        polyline([(cx - 0.46 * R, cy - 0.10 * R), (cx, cy + 0.36 * R), (cx + 0.46 * R, cy - 0.10 * R)], col=sec, w=sw)
        polyline([
            (cx - 0.74 * R, cy + 0.38 * R),
            (cx - 0.74 * R, cy + 0.72 * R),
            (cx + 0.74 * R, cy + 0.72 * R),
            (cx + 0.74 * R, cy + 0.38 * R),
        ], col=pri, w=sw_thin)

    elif glyph == "star":
        # 5-point or 4-point Polaris star (Favorites)
        star4(cx, cy, 0.88 * R, 0.25 * R, col=sec)
        dot(cx, cy, 0.16 * R, col=pri)

    elif glyph == "link":
        # Interlocking orbital rings (Links)
        circle_outline(cx - 0.28 * R, cy, 0.46 * R, col=pri, w=sw)
        circle_outline(cx + 0.28 * R, cy, 0.46 * R, col=sec, w=sw)

    elif glyph == "people":
        # User silhouette + node (Contacts)
        circle_outline(cx, cy - 0.34 * R, 0.32 * R, col=pri, w=sw)
        draw.arc([cx - 0.72 * R, cy + 0.08 * R, cx + 0.72 * R, cy + 1.15 * R], start=195, end=345, fill=pri, width=sw)
        dot(cx + 0.54 * R, cy - 0.42 * R, 0.14 * R, col=sec)

    elif glyph == "gamepad":
        # Minimalist D-pad + action nodes (Saved Games)
        draw.rounded_rectangle([cx - 0.84 * R, cy - 0.48 * R, cx + 0.84 * R, cy + 0.52 * R], radius=0.38 * R, outline=pri, width=sw)
        line((cx - 0.48 * R, cy + 0.02 * R), (cx - 0.16 * R, cy + 0.02 * R), col=pri, w=sw_thin)
        line((cx - 0.32 * R, cy - 0.14 * R), (cx - 0.32 * R, cy + 0.18 * R), col=pri, w=sw_thin)
        dot(cx + 0.28 * R, cy + 0.12 * R, 0.12 * R, col=pri)
        dot(cx + 0.48 * R, cy - 0.10 * R, 0.13 * R, col=sec)

    elif glyph == "search":
        # Optical lens + focal spark (Searches, .semantic-fs)
        circle_outline(cx - 0.14 * R, cy - 0.14 * R, 0.54 * R, col=pri, w=sw)
        line((cx + 0.26 * R, cy + 0.26 * R), (cx + 0.78 * R, cy + 0.78 * R), col=sec, w=sw)
        dot(cx - 0.30 * R, cy - 0.30 * R, 0.12 * R, col=sec)

    elif glyph == "apps":
        # 2x2 Bento Keycap Grid (savedProgram, .local)
        g = 0.14 * R
        s_box = 0.62 * R
        for ix, iy in [(-1, -1), (1, -1), (-1, 1), (1, 1)]:
            x0 = cx + (g if ix > 0 else -g - s_box)
            y0 = cy + (g if iy > 0 else -g - s_box)
            is_top_right = (ix == 1 and iy == -1)
            draw.rounded_rectangle(
                [x0, y0, x0 + s_box, y0 + s_box],
                radius=0.14 * R,
                outline=sec if is_top_right else pri,
                width=sw if is_top_right else sw_thin,
            )

    elif glyph == "network":
        # Distributed node constellation (.ipfs, .lwe)
        p_top = (cx, cy - 0.68 * R)
        p_bl = (cx - 0.68 * R, cy + 0.48 * R)
        p_br = (cx + 0.68 * R, cy + 0.48 * R)
        line(p_top, p_bl, col=sub, w=sw_thin)
        line(p_top, p_br, col=sub, w=sw_thin)
        line(p_bl, p_br, col=sub, w=sw_thin)
        dot(*p_top, 0.20 * R, col=sec)
        dot(*p_bl, 0.18 * R, col=pri)
        dot(*p_br, 0.18 * R, col=pri)

    elif glyph == "server":
        # Dual rack blades (.pythond)
        for yy_off, is_top in [(-0.34 * R, True), (+0.34 * R, False)]:
            draw.rounded_rectangle(
                [cx - 0.80 * R, cy + yy_off - 0.24 * R, cx + 0.80 * R, cy + yy_off + 0.24 * R],
                radius=0.10 * R,
                outline=pri if is_top else sub,
                width=sw_thin,
            )
            dot(cx - 0.48 * R, cy + yy_off, 0.11 * R, col=sec if is_top else pri)

    elif glyph == "browser":
        # Compass / orbital globe (.cloakbrowser, .cloak_browser)
        circle_outline(cx, cy, 0.74 * R, col=pri, w=sw)
        line((cx - 0.72 * R, cy), (cx + 0.72 * R, cy), col=sub, w=sw_thin)
        star4(cx, cy, 0.44 * R, 0.14 * R, col=sec)

    elif glyph == "wave":
        # Harmonic sine wave (.matlab)
        pts = []
        for i in range(29):
            u = -1.0 + 2.0 * (i / 28.0)
            wx = cx + u * 0.82 * R
            wy = cy - math.sin(u * math.pi) * 0.56 * R
            pts.append((wx, wy))
        polyline(pts, col=pri, w=sw)
        dot(cx + 0.41 * R, cy - 0.56 * R, 0.16 * R, col=sec)

    # Add a subtle optical corona bloom behind the glyph for T1 / Alert at sizes >= 32
    if tier in ("t1", "alert") and size >= 32:
        glow = layer.filter(ImageFilter.GaussianBlur(radius=0.055 * S))
        glow_arr = np.array(glow, dtype=np.float64)
        glow_arr[..., 3] *= 0.34
        glow = Image.fromarray(np.clip(glow_arr, 0, 255).astype(np.uint8))
        combined = Image.alpha_composite(glow, layer)
        return combined.resize((size, size), Image.Resampling.LANCZOS)

    return layer.resize((size, size), Image.Resampling.LANCZOS)


# ============================================================================
# 4. Multi-Resolution Windows .ICO Builder (PNG@256 + 32-bit DIB@64..16)
# ============================================================================

def _rgba_to_dib_bytes(img: Image.Image) -> bytes:
    """Convert an RGBA PIL Image into a 32-bit BGRA BITMAPINFOHEADER + XOR + AND payload for ICO."""
    w, h = img.size
    arr = np.array(img, dtype=np.uint8)
    # Flip vertically (BMP is bottom-up) and convert RGBA -> BGRA
    bgra = arr[::-1, :, [2, 1, 0, 3]].tobytes()
    # 1-bit AND mask padded to 32-bit (4-byte) row boundary
    row_bytes = ((w + 31) // 32) * 4
    and_mask = b"\x00" * (row_bytes * h)
    bih = struct.pack(
        "<IiiHHIIiiII",
        40,             # biSize
        w,              # biWidth
        h * 2,          # biHeight (XOR + AND combined height)
        1,              # biPlanes
        32,             # biBitCount
        0,              # biCompression (BI_RGB)
        len(bgra) + len(and_mask),
        0, 0, 0, 0,
    )
    return bih + bgra + and_mask


def save_glacier_ico(path: pathlib.Path, tier: str, glyph: str, accent: tuple[int, int, int], shell_cache: dict):
    """Render size-adaptive frames (256, 64, 48, 32, 24, 16) and pack into a Windows .ico file."""
    sizes = [256, 64, 48, 32, 24, 16]
    payloads = []

    for sz in sizes:
        key = (sz, tier)
        if key not in shell_cache:
            shell_cache[key] = render_folder_shell(sz, tier=tier)
        base = shell_cache[key]
        glyph_img = render_glyph_layer(sz, glyph=glyph, tier=tier, accent=accent)
        frame = Image.alpha_composite(base, glyph_img)

        if sz == 256:
            buf = io.BytesIO()
            frame.save(buf, format="PNG", optimize=True)
            payloads.append((sz, buf.getvalue()))
        else:
            payloads.append((sz, _rgba_to_dib_bytes(frame)))

    # Write ICONDIR + ICONDIRENTRY[] + payloads
    header = struct.pack("<HHH", 0, 1, len(payloads))
    offset = 6 + 16 * len(payloads)
    entries = []
    for sz, data in payloads:
        w_byte = 0 if sz == 256 else sz
        h_byte = 0 if sz == 256 else sz
        entries.append(struct.pack("<BBBBHHII", w_byte, h_byte, 0, 0, 1, 32, len(data), offset))
        offset += len(data)

    path.write_bytes(header + b"".join(entries) + b"".join(d for _, d in payloads))


# ============================================================================
# 5. Icon Catalog Definition & Generation Entrypoint
# ============================================================================

# Unique icon specifications: icon_filename -> (tier, glyph, accent_rgb, label)
ICON_SPECS: dict[str, tuple[str, str, tuple[int, int, int], str]] = {
    # --- Tier 1: 领航键帽 (.on full 100% Belt-of-Venus blade) ---
    "t1-glacier-orbit.ico":   ("t1", "glacier-orbit", GL_GOLD,   "glacier (Catmull-Rom 太阳轨)"),
    "t1-spark-ai.ico":        ("t1", "spark",         GL_GOLD,   "AI Workspace (星核)"),
    "t1-building-hq.ico":     ("t1", "building",      GL_GOLD,   "Headquarters (研发总部)"),
    "t1-tools-work.ico":      ("t1", "tools",         GL_CYAN,   "Engineering (工程工作区)"),
    "t1-chart-quant.ico":     ("t1", "chart",         GL_GOLD,   "Quant & Trading (量化研究)"),
    "t1-book-courses.ico":    ("t1", "book",          GL_VIOLET, "Courses & Docs (课程与文献)"),
    "t1-bolt-power.ico":      ("t1", "bolt",          GL_CYAN,   "Power & Edge (能源与边缘计算)"),
    "t1-code-project.ico":    ("t1", "code",          GL_VIOLET, "Core Project (核心代码库)"),
    "t1-chip-embedded.ico":   ("t1", "chip",          GL_CYAN,   "Embedded (嵌入式仓库)"),

    # --- Tier 2: 标准座舱键 (62% controlled blade) ---
    "t2-monitor-desktop.ico": ("t2", "monitor",       GL_ICE,    "Desktop (桌面)"),
    "t2-document-docs.ico":   ("t2", "document",      GL_ICE,    "Documents (文档)"),
    "t2-download-inbox.ico":  ("t2", "download",      GL_CYAN,   "Downloads (下载收件箱)"),
    "t2-star-favorites.ico":  ("t2", "star",          GL_GOLD,   "Favorites (收藏夹)"),
    "t2-link-shortcuts.ico":  ("t2", "link",          GL_CYAN,   "Links (快捷链接)"),
    "t2-people-contacts.ico": ("t2", "people",        GL_GOLD,   "Contacts (联系人)"),
    "t2-gamepad-games.ico":   ("t2", "gamepad",       GL_VIOLET, "Saved Games (游戏存档)"),
    "t2-search-index.ico":    ("t2", "search",        GL_ICE,    "Searches (搜索索引)"),
    "t2-cloud-personal.ico":  ("t2", "cloud",         GL_ICE,    "OneDrive (个人云)"),
    "t2-cloud-work.ico":      ("t2", "cloud-work",    GL_GOLD,   "OneDrive Work (企业云)"),
    "t2-cloud-edu.ico":       ("t2", "cloud-study",   GL_VIOLET, "OneDrive Edu (学术云)"),
    "t2-apps-programs.ico":   ("t2", "apps",          GL_GOLD,   "Programs (便携工具箱)"),
    "t2-chip-mcu.ico":        ("t2", "chip",          GL_VIOLET, "MCU SDK (固件包)"),
    "t2-package-scoop.ico":   ("t2", "package",       GL_GOLD,   "Scoop (包管理)"),
    "t2-terminal-go.ico":     ("t2", "terminal",      GL_CYAN,   "Go (工具链)"),
    "t2-spark-claude.ico":    ("t2", "spark",         GL_GOLD,   ".claude (Claude Agent)"),
    "t2-terminal-codex.ico":  ("t2", "terminal",      GL_CYAN,   ".codex (Codex CLI)"),
    "t2-spark-copilot.ico":   ("t2", "spark",         GL_VIOLET, ".copilot (GitHub Copilot)"),
    "t2-code-vscode.ico":     ("t2", "code",          GL_ICE,    ".vscode (VS Code)"),
    "t2-key-ssh.ico":         ("t2", "key",           GL_GOLD,   ".ssh (SSH 密钥)"),
    "t2-tools-config.ico":    ("t2", "tools",         GL_CYAN,   ".config (全局配置)"),
    "t2-package-docker.ico":  ("t2", "package",       GL_ICE,    ".docker (容器运行时)"),

    # --- Alert: 红巨星沙盒 (.gl-alert burgundy obsidian + bottom #FE2C55 crimson wick) ---
    "alert-shield-sandbox.ico": ("alert", "shield",   GL_CRIMSON, "Sandbox (隔离沙盒)"),

    # --- Tier 3: 静默暗槽 (.is-receded 28% cold-silver filament for dotfiles & caches) ---
    "t3-chip.ico":            ("t3", "chip",          GL_SILVER, "T3 芯片配置"),
    "t3-search-chip.ico":     ("t3", "search-chip",   GL_SILVER, "T3 芯片检索"),
    "t3-key.ico":             ("t3", "key",           GL_SILVER, "T3 凭证密钥"),
    "t3-cloud.ico":           ("t3", "cloud",         GL_SILVER, "T3 云端缓存"),
    "t3-package.ico":         ("t3", "package",       GL_SILVER, "T3 构建缓存"),
    "t3-shield.ico":          ("t3", "shield",        GL_SILVER, "T3 安全客户端"),
    "t3-browser.ico":         ("t3", "browser",       GL_SILVER, "T3 浏览器内核"),
    "t3-document.ico":        ("t3", "document",      GL_SILVER, "T3 笔记缓存"),
    "t3-code.ico":            ("t3", "code",          GL_SILVER, "T3 编译扩展"),
    "t3-network.ico":         ("t3", "network",       GL_SILVER, "T3 节点网络"),
    "t3-bolt.ico":            ("t3", "bolt",          GL_SILVER, "T3 加速组件"),
    "t3-apps.ico":            ("t3", "apps",          GL_SILVER, "T3 本地程序"),
    "t3-download.ico":        ("t3", "download",      GL_SILVER, "T3 安装缓存"),
    "t3-wave.ico":            ("t3", "wave",          GL_SILVER, "T3 科学计算"),
    "t3-tools.ico":           ("t3", "tools",         GL_SILVER, "T3 系统数据"),
    "t3-terminal.ico":        ("t3", "terminal",      GL_SILVER, "T3 终端组件"),
    "t3-spark.ico":           ("t3", "spark",         GL_SILVER, "T3 智能体数据"),
    "t3-server.ico":          ("t3", "server",        GL_SILVER, "T3 本地服务"),
    "t3-monitor.ico":         ("t3", "monitor",       GL_SILVER, "T3 桌面服务"),
    "t3-search.ico":          ("t3", "search",        GL_SILVER, "T3 语义索引"),
}


def build_all_icons(out_dir: pathlib.Path, preview_path: pathlib.Path | None = None):
    out_dir.mkdir(parents=True, exist_ok=True)
    shell_cache: dict = {}

    for fname, (tier, glyph, accent, _label) in ICON_SPECS.items():
        save_glacier_ico(out_dir / fname, tier=tier, glyph=glyph, accent=accent, shell_cache=shell_cache)

    print(f"Generated {len(ICON_SPECS)} Glacier .ico files in {out_dir}")
    if preview_path is None:
        return

    showcase = [
        ("t1-glacier-orbit.ico",    "T1 · glacier"),
        ("t1-spark-ai.ico",         "T1 · AI Core"),
        ("t1-building-hq.ico",      "T1 · HQ"),
        ("t1-tools-work.ico",       "T1 · Workspace"),
        ("t1-chart-quant.ico",      "T1 · Quant"),
        ("t1-book-courses.ico",     "T1 · Courses"),
        ("t1-bolt-power.ico",       "T1 · Power"),
        ("t1-code-project.ico",     "T1 · Project"),
        ("t1-chip-embedded.ico",    "T1 · Embedded"),
        ("t2-monitor-desktop.ico",  "T2 · Desktop"),
        ("t2-download-inbox.ico",   "T2 · Downloads"),
        ("t2-cloud-work.ico",       "T2 · OneDrive"),
        ("t2-code-vscode.ico",      "T2 · .vscode"),
        ("t2-key-ssh.ico",          "T2 · .ssh"),
        ("t2-package-docker.ico",   "T2 · .docker"),
        ("alert-shield-sandbox.ico","Alert · Sandbox"),
        ("t3-package.ico",          "T3 · .cache"),
        ("t3-chip.ico",             "T3 · .mcu"),
        ("t3-key.ico",              "T3 · .gnupg"),
        ("t3-tools.ico",            "T3 · AppData"),
    ]

    cols = 5
    rows = 4
    cell_w, cell_h = 220, 210
    # Windows 11 Dark Mode Explorer canvas (#191919)
    sheet = Image.new("RGBA", (cols * cell_w + 40, rows * cell_h + 130), (25, 25, 25, 255))
    sdraw = ImageDraw.Draw(sheet)

    for idx, (fname, title) in enumerate(showcase):
        r, c = divmod(idx, cols)
        x0 = 20 + c * cell_w
        y0 = 20 + r * cell_h
        tier, glyph, accent, _ = ICON_SPECS[fname]
        icon_160 = Image.alpha_composite(
            render_folder_shell(144, tier=tier),
            render_glyph_layer(144, glyph=glyph, tier=tier, accent=accent),
        )
        sheet.alpha_composite(icon_160, (x0 + (cell_w - 144) // 2, y0 + 8))
        label_col = (255, 216, 155, 240) if tier == "t1" else ((254, 90, 120, 240) if tier == "alert" else ((200, 220, 245, 215) if tier == "t2" else (140, 158, 185, 190)))
        sdraw.text((x0 + 44, y0 + 162), title, fill=label_col)

    strip_y = rows * cell_h + 38
    sdraw.text((36, strip_y + 8), "Actual 32x32 & 16x16 Explorer List/Details Crispness:", fill=(200, 220, 245, 210))
    sx = 410
    for fname, _ in showcase[:10]:
        tier, glyph, accent, _ = ICON_SPECS[fname]
        im32 = Image.alpha_composite(shell_cache[(32, tier)], render_glyph_layer(32, glyph=glyph, tier=tier, accent=accent))
        im16 = Image.alpha_composite(shell_cache[(16, tier)], render_glyph_layer(16, glyph=glyph, tier=tier, accent=accent))
        sheet.alpha_composite(im32, (sx, strip_y))
        sheet.alpha_composite(im16, (sx + 38, strip_y + 8))
        sx += 68

    preview_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(preview_path)
    print(f"Saved preview sheet to {preview_path}")


if __name__ == "__main__":
    import os
    local_app_data = pathlib.Path(os.environ.get("LOCALAPPDATA", str(pathlib.Path.home() / "AppData" / "Local")))
    target_dir = local_app_data / "FolderAppearance" / "glacier-icons"
    build_all_icons(target_dir)
