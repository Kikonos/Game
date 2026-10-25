#!/usr/bin/env python3
"""Aircraft sprite pipeline (v0.11): the player's raster art -> web assets, layout data and paint masks.

usage: python3 scripts/sprites.py <input-dir> [--out public/aircraft] [--meta src/ui/components/aircraft/sprites.gen.ts]
                                  [--check <dir>] [--only id,id]

<input-dir> holds sprites/<id>.png and masks/<id>-mask.png (or both flat in one folder): 4096 x 1640 RGB, nose
right, on a flat #00FF00 background. The Gemini masks (fin red, engines + pylons blue) are imprecise: they are only
hints (which piece above the crown is the fin, roughly where the engines are). Needs python3 with numpy, scipy,
scikit-image and Pillow (WebP). Per-sprite engines and hand corrections: scripts/sprites-paint.json. `--check`
writes the check pictures (mask-<id>.png, mask-<id>-2x.png); `--only` redoes some sprites and keeps the others' data.

Per sprite it
  1. keys the green out to alpha (soft edge from the green excess, solid inside), unmixes the edge colour and
     removes green spill, trims to the aircraft with an even margin,
  2. writes <id>-2048.webp and <id>-1024.webp (lossy colour, lossless alpha) -- the art itself is never changed;
     the -shade.webp files are found by the same clean-up (they end in .webp),
  3. finds the paint regions at the art's own resolution (segment): the fin (everything above the fuselage's crown
     curve, rudder and dorsal fillet included, up to the drawn outline), the fuselage (wing-body and belly fairings,
     tail cone, nose and radome included; wing, winglets, stabiliser and flap-track fairings out), each engine's
     cowl (its trailing edge to the intake lip; the exhaust nozzle, plug and fan are not cowl) -- every edge between
     regions is a watershed of the luminance gradient, so it lands on the drawn outline,
  4. writes <id>-mask.png (2048 wide RGB: R fin, G body, B cowl (lip included) coverage, anti-aliased, 0 off the
     silhouette; regions never overlap) and <id>-shade.webp (1024 wide grey, lossy q95: the painting model's smooth light per
     region over its lit white, x 255 / 1.25; the whites go in the data), so the browser only multiplies,
  5. measures the layout the renderer and the stickers need (nose / tail x, fin outline and quad, crown / belly,
     sticker zone, window line, title band, the tube lines for the body paint, the engines' cowl x range and lip
     width) in 2048-scale pixels -> sprites.gen.ts.
Identical sprites share one set of files (`same` in the data).
"""
import hashlib
import json
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi
from skimage.segmentation import watershed

WIDTHS = (2048, 1024)
BODY_STEP = 8  # body lines (crown / belly) are sampled every 8 px of the 2048 asset
HINTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sprites-paint.json')
REF_W = 2048  # layout data and the mask are in pixels of the 2048 asset
MARGIN = 0.012  # of the trimmed width, every side


def find_inputs(src):
    sp = os.path.join(src, 'sprites') if os.path.isdir(os.path.join(src, 'sprites')) else src
    mk = os.path.join(src, 'masks') if os.path.isdir(os.path.join(src, 'masks')) else src
    out = []
    for f in sorted(os.listdir(sp)):
        if not f.endswith('.png') or f.endswith('-mask.png'):
            continue
        sid = f[:-4]
        m = os.path.join(mk, sid + '-mask.png')
        out.append((sid, os.path.join(sp, f), m if os.path.exists(m) else None))
    return out


def classify(rgb):
    """Hard red / blue areas of a mask picture."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    red = (r > 150) & (g < 110) & (b < 110)
    blue = (b > 150) & (r < 110) & (g < 110)
    return red, blue


def components(mask, min_share):
    """Connected components (4-neighbour) of a small boolean grid; keeps those >= min_share of the biggest."""
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    sizes = [0]
    n = 0
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if lab[y0, x0]:
            continue
        n += 1
        q = deque([(y0, x0)])
        lab[y0, x0] = n
        c = 0
        while q:
            y, x = q.popleft()
            c += 1
            for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not lab[yy, xx]:
                    lab[yy, xx] = n
                    q.append((yy, xx))
        sizes.append(c)
    if n == 0:
        return np.zeros_like(mask)
    big = max(sizes)
    keep = [i for i in range(1, n + 1) if sizes[i] >= big * min_share]
    return np.isin(lab, keep)


def gate(hard, min_share):
    """Full-res gate: the hard area's main components (found at 1/4 scale), grown 6 px."""
    h, w = hard.shape
    small = np.asarray(Image.fromarray(hard.astype(np.uint8) * 255).resize((w // 4, h // 4), Image.BOX)) > 40
    keep = components(small, min_share)
    big = np.asarray(Image.fromarray(keep.astype(np.uint8) * 255).resize((w, h), Image.NEAREST)) > 0
    grown = np.asarray(Image.fromarray(big.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(13))) > 0
    return grown


def key_out(rgb):
    """Alpha from the green excess (solid inside the airframe), unmixed and despilled colour."""
    f = rgb.astype(np.float32)
    ex = f[..., 1] - np.maximum(f[..., 0], f[..., 2])
    soft = np.clip(1 - (ex - 4) / (251 - 4), 0, 1)
    core = Image.fromarray(((ex < 128) * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(5))
    inside = np.asarray(core) > 0
    a = np.where(inside, 1.0, soft)
    a[a < 0.03] = 0
    # unmix: C = a F + (1 - a) G with G = pure green
    safe = np.maximum(a, 1e-3)[..., None]
    fg = f.copy()
    fg[..., 1] = f[..., 1] - (1 - a) * 255
    fg = fg / safe
    # spill: green never above the brighter of red / blue (the art is neutral white / grey)
    fg[..., 1] = np.minimum(fg[..., 1], np.maximum(fg[..., 0], fg[..., 2]))
    fg = np.clip(fg, 0, 255)
    fg[a == 0] = 0
    return a, fg, ex


def coverage(mask_rgb, a, gate_area, chan):
    """Soft fin / engine coverage: the mask colour unmixed from the green the same way as the sprite."""
    f = mask_rgb.astype(np.float32)
    safe = np.maximum(a, 1e-3)
    fg = f.copy()
    fg[..., 1] = f[..., 1] - (1 - a) * 255
    fg = fg / safe[..., None]
    other = [c for c in (0, 1, 2) if c != chan]
    v = np.clip((fg[..., chan] - np.maximum(fg[..., other[0]], fg[..., other[1]])) / 200, 0, 1)
    return v * gate_area * (a > 0)


def resize_rgba(rgba, w, h):
    im = Image.fromarray(rgba, 'RGBA').convert('RGBa').resize((w, h), Image.LANCZOS)
    return im.convert('RGBA')


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0], float), np.array(pts[-1], float)
    d = b - a
    nrm = np.hypot(*d) or 1.0
    p = np.array(pts, float)
    dist = np.abs(d[0] * (p[:, 1] - a[1]) - d[1] * (p[:, 0] - a[0])) / nrm
    i = int(np.argmax(dist))
    if dist[i] > eps:
        return rdp(pts[: i + 1], eps)[:-1] + rdp(pts[i:], eps)
    return [pts[0], pts[-1]]


def r1(v):
    return round(float(v), 1)


def layout(alpha, tail, eng, rgb):
    """Layout data in 2048-scale pixels (x right, y down; nose right)."""
    h, w = alpha.shape
    op = alpha > 0.5
    cols = np.nonzero(op.any(axis=0))[0]
    tail_x, nose_x = int(cols.min()), int(cols.max())
    L = nose_x - tail_x
    fin = tail > 0.5
    # fin: per-row spans of the red area
    rows = np.nonzero(fin.any(axis=1))[0]
    fy0, fy1 = int(rows.min()), int(rows.max())
    left, right = [], []
    for y in range(fy0, fy1 + 1):
        xs = np.nonzero(fin[y])[0]
        if len(xs):
            left.append((int(xs.min()), y))
            right.append((int(xs.max()) + 1, y))
    poly = [(left[0][0], fy0)] + [(x, y) for x, y in right] + [(right[-1][0], fy1 + 1)] + [(x, y + 1) for x, y in reversed(left)]
    poly = rdp(poly, 1.2)
    fh = fy1 - fy0

    def span(y):
        xs = np.nonzero(fin[int(round(y))])[0]
        return int(xs.min()), int(xs.max()) + 1

    # crown / run: the longest opaque run in each column outside the (grown) fin, so antennas and the
    # fin's anti-aliased outline never count; then a 31-px running median
    fin_grown = np.asarray(Image.fromarray((fin * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9))) > 0
    crown = np.full(w, -1)
    run = np.full(w, -1)
    for x in range(tail_x, nose_x + 1):
        col = op[:, x] & ~fin_grown[:, x]
        ys = np.nonzero(col)[0]
        if not len(ys):
            continue
        cuts = np.nonzero(np.diff(ys) > 1)[0]
        starts = np.concatenate([[0], cuts + 1])
        ends = np.concatenate([cuts, [len(ys) - 1]])
        i = int(np.argmax(ends - starts))
        crown[x], run[x] = int(ys[starts[i]]), int(ys[ends[i]])
    def med(arr):
        out = arr.copy()
        for x in range(tail_x, nose_x + 1):
            win = arr[max(tail_x, x - 15): x + 16]
            win = win[win >= 0]
            if len(win):
                out[x] = int(np.median(win))
        return out
    crown, run = med(crown), med(run)
    rel = lambda f: int(round(nose_x - f * L))  # x at a share of L from the nose
    fwd = [x for x in range(rel(0.28), rel(0.12)) if crown[x] >= 0]
    belly_ref = float(np.median(run[fwd]))
    aft = [x for x in range(rel(0.5), rel(0.35)) if crown[x] >= 0]
    crown_main = float(np.median(crown[aft]))
    D = belly_ref - crown_main
    # fin root: the crown under the fin's leading edge region
    fin_cols = [x for x in range(w) if fin[:, x].any() and crown[x] >= 0]
    root_y = float(np.median(crown[fin_cols])) if fin_cols else fy1
    root_row = min(fy1, max(fy0 + 1, int(round(root_y)) - 2))
    # the fin's bottom edge can slope (the rudder ends above the dorsal fillet): the root row is the lowest one
    # still about as wide as the fin's widest row
    widths = {y: span(y)[1] - span(y)[0] for y in range(fy0, root_row + 1) if fin[y].any()}
    wmax = max(widths.values())
    root_row = max(y for y, wd in widths.items() if wd >= 0.85 * wmax)
    tip_row = fy0 + max(2, int(0.03 * fh))
    rle, rte = span(root_row)[1], span(root_row)[0]
    tle, tte = span(tip_row)[1], span(tip_row)[0]
    quad = [[rle, root_row], [rte, root_row], [tle, tip_row], [tte, tip_row]]

    # windows: dark pixels on the airframe, rows histogram over the cabin
    lumi = rgb[..., 0] * 0.3 + rgb[..., 1] * 0.59 + rgb[..., 2] * 0.11
    dark = (lumi < 90) & (alpha > 0.9) & (tail < 0.1) & (eng < 0.1)
    xa, xb = rel(0.85), rel(0.12)
    # windows are many small dark blobs in a row: count dark runs per row (a wing shadow is one long run)
    dk = dark[:, xa:xb].astype(np.int8)
    hist = (np.diff(dk, axis=1) == 1).sum(axis=1).astype(float)
    hist[: max(0, int(crown_main - 0.4 * D))] = 0
    hist[int(belly_ref):] = 0
    k = np.convolve(hist, np.ones(3) / 3, 'same')
    win = win_main = None
    if k.max() > 8:
        # bands of rows over 40 % of the peak; the topmost band with >= 55 % of the peak is the title reference
        on = k > 0.4 * k.max()
        bands, y = [], 0
        while y < h:
            if on[y]:
                y2 = y
                while y2 + 1 < h and on[y2 + 1]:
                    y2 += 1
                bands.append((y, y2, k[y:y2 + 1].max()))
                y = y2 + 1
            else:
                y += 1
        good = [b for b in bands if b[2] >= 0.55 * k.max()]
        top = min(good, key=lambda b: b[0])
        win = (top[0], top[1])
        # the main deck's window line (the lowest strong band: the A380's lower deck), for the belly split
        low = max(good, key=lambda b: b[0])
        win_main = (low[0], low[1])

    # the near wing drawn over the fuselage side: broad grey shading (windows and panel lines are sparse)
    grey = ((lumi < 215) & (alpha > 0.9) & (tail < 0.1)).astype(np.uint8) * 255
    shade = np.asarray(Image.fromarray(grey).filter(ImageFilter.BoxBlur(13))).astype(float) / 255
    wingish = np.asarray(Image.fromarray(((shade > 0.5) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9))) > 0

    # wing / engine columns: the airframe hangs below the belly line, or an engine is there
    hang = np.zeros(w, bool)
    for x in range(rel(0.8), rel(0.2)):
        if run[x] > belly_ref + 0.04 * D or eng[:, x].max() > 0.5:
            hang[x] = True
    hx = np.nonzero(hang)[0]
    wing = (int(hx.min() - 0.15 * D), int(hx.max() + 0.15 * D)) if len(hx) else None

    # winglets and blade aerials over the aft cabin are not fuselage: the zone keeps to the crown line there
    for x in range(rel(0.85), rel(0.45)):
        if crown[x] >= 0:
            crown[x] = max(crown[x], int(crown_main - 0.06 * D))

    # sticker zone on the fuselage: crown .. belly, above the windows over the wing
    win_top = win[0] if win else crown_main + 0.42 * D
    top_pts, bot_pts = [], []
    bottom = {}
    step = 4
    for x in list(range(tail_x, nose_x + 1, step)) + [nose_x]:
        if crown[x] < 0:
            continue
        b = min(run[x], belly_ref)
        if wing and wing[0] <= x <= wing[1]:
            b = min(b, win_top - 0.04 * D)
        # stop above the wing where it crosses the fuselage side (its tip can reach the crown)
        if wing and wing[0] - 0.25 * L <= x <= wing[1]:
            wy = np.nonzero(wingish[int(crown[x]) + 3: int(b), x])[0]
            if len(wy):
                b = min(b, int(crown[x]) + 3 + int(wy[0]) - 3)
        # engines overlapping the lower fuselage (737): stop above them
        ey = np.nonzero(eng[:, x] > 0.3)[0]
        if len(ey):
            b = min(b, ey.min() - 2)
        if b - crown[x] < 2:
            continue
        top_pts.append((x, int(crown[x])))
        bot_pts.append((x, int(b)))
        bottom[x] = b
    zone = rdp(top_pts, 1.0) + rdp(list(reversed(bot_pts)), 1.0)

    # title band: between the main crown level and the window line, from 16 % of L behind the nose
    if win:
        avail = win[0] - crown_main
        # modest titles, as real aircraft carry them: cap height about 1.6 window heights (never tiny)
        cap = min(0.5 * avail, 0.2 * D, max(1.6 * (win[1] - win[0] + 1), 0.08 * D))
        ty = (crown_main + win[0]) / 2 + 0.05 * avail
    else:
        cap = 0.18 * D
        ty = crown_main + 0.25 * D
    # the band runs aft from 16 % of L until the zone under it ends (the wing), at most 42 % of L
    x0 = rel(0.16)
    run_w = 0
    for x in sorted((x for x in bottom if x <= x0), reverse=True):
        if bottom[x] < ty + cap / 2 + 3 or crown[x] > ty - cap / 2 - 3 or x0 - x > 0.42 * L:
            break
        run_w = x0 - x
    titles = {'x': r1(0.16 * L), 'y': r1(ty), 'w': r1(max(run_w, 0.12 * L)), 'size': r1(cap / 0.72)}

    sil = alpha > 0.5
    return {
        'nose': nose_x, 'tail': tail_x, 'crown': r1(crown_main), 'belly': r1(belly_ref),
        'fin': [[int(x), int(y)] for x, y in poly], 'finQuad': quad,
        'zone': [[int(x), int(y)] for x, y in zone],
        'win': [int(win[0]), int(win[1])] if win else None,
        'winMain': [int(win_main[0]), int(win_main[1])] if win_main else None,
        'wing': list(wing) if wing else None,
        'titles': titles,
        'silArea': int(sil.sum()),
    }


# ---------- v0.11 paint regions: fin, body, cowl (+ lip), from the art ----------
#
# Labels at the art's own resolution (the cropped 4096-px frame); the mask is their coverage at 2048.
BG, FIN, BODY, UNP, COWL, LIP, METAL, PYLON = range(8)
NAMES = ['bg', 'fin', 'body', 'unp', 'cowl', 'lip', 'metal', 'pylon']


def disk(r):
    r = max(1, int(round(r)))
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def dil(m, r):
    return ndi.binary_dilation(m, structure=disk(r)) if r >= 1 else m


def ero(m, r):
    return ndi.binary_erosion(m, structure=disk(r)) if r >= 1 else m


def poly_mask(shape, polys, k):
    from PIL import ImageDraw
    im = Image.new('L', (shape[1], shape[0]), 0)
    dr = ImageDraw.Draw(im)
    for pts in polys:
        dr.polygon([(x * k, y * k) for x, y in pts], fill=255)
    return np.asarray(im) > 0


def col_runs(op, excl):
    """Per column the longest opaque run outside `excl`: (top y, bottom y), -1 where none."""
    H, W = op.shape
    cr = np.full(W, -1.0)
    bo = np.full(W, -1.0)
    m = op & ~excl
    for x in range(W):
        ys = np.nonzero(m[:, x])[0]
        if not len(ys):
            continue
        cuts = np.nonzero(np.diff(ys) > 1)[0]
        st = np.concatenate([[0], cuts + 1])
        en = np.concatenate([cuts, [len(ys) - 1]])
        i = int(np.argmax(en - st))
        cr[x], bo[x] = ys[st[i]], ys[en[i]]
    return cr, bo


def hermite(x0, y0, m0, x1, y1, m1, x):
    h = x1 - x0
    t = (x - x0) / h
    return (2 * t ** 3 - 3 * t ** 2 + 1) * y0 + (t ** 3 - 2 * t ** 2 + t) * h * m0 + (-2 * t ** 3 + 3 * t ** 2) * y1 + (t ** 3 - t ** 2) * h * m1


def geometry(A, rgb, gfin, geng):
    """The tube: crown line (a smooth curve under the fin, from the tail cone to the cabin crown), belly line (straight
    across the wing root), and the white fuselage's shading by height P(t), measured on clean cabin columns."""
    H, W = A.shape
    k = W / 2048
    op = A > 0.5
    cols = np.nonzero(op.any(axis=0))[0]
    tx, nx = int(cols.min()), int(cols.max())
    L = nx - tx
    rel = lambda f: int(round(nx - f * L))
    cr, bo = col_runs(op, ndi.binary_dilation(gfin, iterations=max(1, int(4 * k))))
    cnt = gfin.sum(axis=0)
    fc = np.nonzero(cnt > 0.2 * cnt.max())[0]
    f0, f1 = int(fc.min()), int(fc.max())
    crown_ref = float(np.median([cr[x] for x in range(rel(0.5), rel(0.35)) if cr[x] >= 0]))
    # the fin root's trailing edge: the aftmost column where the fin runs down unbroken into the fuselage
    ftop = np.nonzero(gfin.any(axis=1))[0].min()

    def attached(x):
        ys = np.nonzero(op[:, x])[0]
        if not len(ys) or ys[0] > crown_ref - 0.3 * (crown_ref - ftop):
            return False
        gaps = np.nonzero(np.diff(ys) > 1)[0]
        end = ys[gaps[0]] if len(gaps) else ys[-1]
        return end > crown_ref - 0.1 * (crown_ref - ftop)
    tall = [x for x in range(max(tx, f0 - int(50 * k)), f1) if attached(x)]
    if tall:
        f0 = int(min(tall))
    # crown: the cabin crown ahead of the fin (a straight fit) joined to the tail cone's top behind it by a cubic
    xf0, xf1 = int(f1 + 0.10 * L), int(f1 + 0.22 * L)
    xs = np.arange(xf0, xf1)
    ok = cr[xs] >= 0
    mf, bf = np.polyfit(xs[ok], cr[xs][ok], 1)
    xa1, xa0 = int(f0 - 0.004 * L), int(tx + 0.006 * L)
    if xa1 - xa0 > 0.012 * L:
        xs2 = np.arange(xa0, xa1)
        ok2 = cr[xs2] >= 0
        ma, ba = np.polyfit(xs2[ok2], cr[xs2][ok2], 1)
        xA = xa1
    else:
        xA = tx
        ma = mf
        ba = cr[tx + 2] - ma * (tx + 2)
    # winglets and blade aerials standing on the crown are not the fuselage: columns whose top is well above the
    # running median (over a fifth of the length) take the crown interpolated from their neighbours
    win = max(3, int(0.1 * L))
    xs_ = np.arange(tx, nx + 1)
    med = np.array([np.median(v[v >= 0]) if (v := cr[max(tx, x - win): x + win + 1])[v >= 0].size else -1 for x in xs_])
    good = (cr[xs_] >= 0) & ((cr[xs_] >= med - 3 * k) | (xs_ > nx - 0.12 * L) | (xs_ < f1 + 0.05 * L))
    cr = cr.copy()
    bad_ = (cr[xs_] >= 0) & ~good
    if bad_.any():
        cr[xs_[bad_]] = np.interp(xs_[bad_], xs_[good], cr[xs_[good]])
    crown = cr.copy()
    xx = np.arange(xA, xf0 + 1)
    crown[xA:xf0 + 1] = hermite(xA, ma * xA + ba, ma, xf0, mf * xf0 + bf, mf, xx)
    # belly: straight across the wing root and the fairing (they hang below it)
    belly_ref = float(np.median([bo[x] for x in range(rel(0.28), rel(0.12)) if bo[x] >= 0]))
    Dt = belly_ref - crown_ref
    ecols = np.nonzero(geng.any(axis=0))[0]
    bad = np.zeros(W, bool)
    for x in range(rel(0.8), rel(0.12)):
        if bo[x] > belly_ref + 0.015 * Dt or geng[:, x].any():
            bad[x] = True
    bx = np.nonzero(bad)[0]
    if len(ecols):
        bx = bx[(bx >= ecols.min() - 0.2 * L) & (bx <= ecols.max() + 0.05 * L)]
    belly = bo.copy()
    w0 = w1 = None
    if len(bx):
        w0, w1 = int(bx.min()) - int(6 * k), int(bx.max()) + int(6 * k)
        belly[w0:w1 + 1] = bo[w0] + (bo[w1] - bo[w0]) * (np.arange(w0, w1 + 1) - w0) / max(1, w1 - w0)
    Y = rgb[..., 0] * 0.3 + rgb[..., 1] * 0.59 + rgb[..., 2] * 0.11
    yy = np.arange(H)[:, None]
    t = (yy - crown[None, :]) / np.maximum(1, (belly - crown)[None, :])
    tube = (t >= 0) & (t <= 1) & (crown[None, :] >= 0) & (belly[None, :] >= 0) & op
    clean = np.zeros(W, bool)
    if w0 is not None:
        clean[rel(0.75): max(rel(0.75), w0 - int(20 * k))] = True
        clean[w1 + int(20 * k): rel(0.12)] = True
    else:
        clean[rel(0.75): rel(0.12)] = True
    NB = 64
    tb = np.clip((t * NB).astype(int), 0, NB - 1)
    P = np.full(NB, 255.0)
    for b in range(NB):
        sel = tube & (tb == b) & clean[None, :]
        if sel.any():
            P[b] = np.percentile(Y[sel], 75)
    return dict(A=A, rgb=rgb, op=op, Y=Y, gfin=gfin, geng=geng, k=k, tx=tx, nx=nx, L=L, cr=cr, crown=crown, belly=belly,
                xF=xf0, f0=f0, f1=f1, w0=w0, w1=w1, Dt=Dt, crown_ref=crown_ref, belly_ref=belly_ref, exp=P[tb], tube=tube)


def fin_region(g):
    """The fin: the airframe above the crown curve, from the tail to where the dorsal fillet meets the cabin crown
    (the piece Gemini's red area touches most)."""
    H, W = g['op'].shape
    yy = np.arange(H)[:, None]
    above = g['op'] & (yy < g['crown'][None, :]) & (np.arange(W)[None, :] <= g['xF'])
    lab, n = ndi.label(above)
    ids = np.unique(lab[g['gfin'] & above])
    ids = ids[ids > 0]
    if not len(ids):
        return above
    sizes = ndi.sum(above, lab, ids)
    return lab == ids[np.argmax(sizes)]


def bottom_line(op, x0, x1, ystart):
    H, W = op.shape
    bot = np.full(W, -1)
    for x in range(max(0, x0), min(W, x1)):
        y = int(ystart)
        if y < 0 or y >= H or not op[y, x]:
            continue
        while y + 1 < H and op[y + 1, x]:
            y += 1
        bot[x] = y
    return bot


def eng_params(g, specs):
    """Engines from the hints [[aft, front, top(, lip)], ...] (2048 px: the cowl's trailing edge, the intake lip's
    front, the cowl's top): the trailing edge snapped to the strongest dark-to-bright step, the bottom line and
    nacelle height from the silhouette."""
    k, op, Y = g['k'], g['op'], g['Y']
    out = []
    for spec in specs:
        aft, front, top = [v * k for v in spec[:3]]
        bot = bottom_line(op, int(aft - 0.8 * (front - aft)), int(front + 4 * k), top + 0.3 * (front - aft))
        fb = [bot[x] for x in range(int(front - 0.3 * (front - aft)), int(front - 0.1 * (front - aft))) if bot[x] >= 0]
        Dn = (float(np.median(fb)) - top) if fb else 0.5 * (front - aft)
        y0, y1 = int(top + 0.3 * Dn), int(top + 0.75 * Dn)
        r = int(6 * k)
        xs = np.arange(int(aft) - r, int(aft) + r + 1)
        step = [np.mean(Y[y0:y1, x + int(2 * k)] - Y[y0:y1, x - int(2 * k)]) for x in xs]
        a2 = int(xs[int(np.argmax(step))])
        lip = spec[3] * k if len(spec) > 3 else 0.075 * (front - aft)
        out.append(dict(aft=a2, front=int(front), top=float(top), lip=float(lip), Dn=Dn, bot=bot))
    return out


def absorb_small(lab, op, area, bodyish=None):
    """Small unpainted pieces framed only by fin / fuselage / sky / intake lip (door and panel outlines, rims,
    a nacelle's shadow just ahead of the intake) -- or by fuselage and exhaust when they are lit like the fuselage
    (a sliver of belly fairing beside a nozzle): painted with the surface around them."""
    ul, n = ndi.label(lab == UNP)
    if not n:
        return
    sz = ndi.sum(lab == UNP, ul, np.arange(1, n + 1))
    for i, sl in enumerate(ndi.find_objects(ul), 1):
        if sz[i - 1] > 0.004 * area:
            continue
        ys_, xs_ = slice(max(0, sl[0].start - 3), sl[0].stop + 3), slice(max(0, sl[1].start - 3), sl[1].stop + 3)
        c = ul[ys_, xs_] == i
        rim = dil(c, 2) & ~c
        nb = lab[ys_, xs_][rim]
        sky = ~op[ys_, xs_][rim]
        nb_b, nb_f, nb_l = int(((nb == BODY) & ~sky).sum()), int(((nb == FIN) & ~sky).sum()), int((nb == LIP).sum())
        if bodyish is not None and bodyish[ys_, xs_][c].mean() > 0.6:
            nb_l += int(np.isin(nb, [METAL, PYLON]).sum())
        if nb_b + nb_f + nb_l + int(sky.sum()) >= 0.97 * len(nb) and nb_b + nb_f > nb_l and sky.sum() < 0.4 * len(nb):
            lab[ys_, xs_][c] = BODY if nb_b >= nb_f else FIN


def segment(g, hints):
    """Labels: watershed of the luminance gradient (so every edge lands on a drawn outline) from seeds: the fin (above
    the crown curve), the fuselage (pixels lit like the white tube at their height; compact bright doors and panels
    too), unpainted parts (much darker than the tube: wing, stabiliser, shadows; anything grey outside the tube) and
    per engine the cowl (between its trailing edge and the lip), the exhaust behind it and what is above it. Then the
    hard limits (no cowl behind its trailing edge or above its top), the nose and radome as fuselage, the lip as the
    front `lip` px of each cowl row, and the hand corrections ('force' polygons)."""
    op, Y, k, exp, tubem = g['op'], g['Y'], g['k'], g['exp'], g['tube']
    H, W = op.shape
    fin = fin_region(g)
    rest = op & ~fin
    ez = dil(g['geng'], 8 * k)
    yy = np.arange(H)[:, None]
    xx = np.arange(W)[None, :]
    mk = np.zeros((H, W), np.int32)
    area = tubem.sum()
    tailz = xx < g['tx'] + 0.2 * g['L']
    bm = ero(tubem & (Y >= exp - np.where(tailz, 30, 16)) & ~ez & rest, 2 * k)
    bl, n = ndi.label(bm)
    keep = np.zeros(n + 1, bool)
    if n:
        sz = ndi.sum(bm, bl, np.arange(1, n + 1))
        objs = ndi.find_objects(bl)
        for i in range(1, n + 1):
            if sz[i - 1] >= 0.004 * area:
                keep[i] = True
                continue
            if sz[i - 1] < 0.00015 * area:
                continue
            sl = objs[i - 1]
            bh, bw = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
            if sz[i - 1] / (bw * bh) > 0.5 and max(bw, bh) / max(1, min(bw, bh)) < 4:
                keep[i] = True
    mk[keep[bl]] = BODY
    um = rest & ~ez & (((Y < exp - 45) & tubem) | (~tubem & (Y < 205)))
    ul, n = ndi.label(ero(um, 1 * k))
    if n:
        sz = ndi.sum(ul > 0, ul, np.arange(1, n + 1))
        ok = np.zeros(n + 1, bool)
        ok[1:] = sz >= 0.0015 * area
        mk[ok[ul]] = UNP
    engs = eng_params(g, hints.get('eng', []))
    bodyish = tubem & (Y >= exp - 16)
    for e in engs:
        xa, xf, top, Dn = e['aft'], e['front'], e['top'], e['Dn']
        bot = e['bot'].astype(float)[None, :]
        e['box'] = (xx >= xa - 0.6 * Dn) & (xx <= xf + 0.1 * Dn) & (yy >= top - 0.45 * Dn) & (yy <= top + 1.2 * Dn)
        mk[e['box'] & (mk != 0)] = 0
        mk[rest & (xx >= xa + 3 * k) & (xx <= xf - 4 * k) & (yy >= top + 0.12 * Dn) & (yy <= bot - 3 * k) & (bot >= 0)] = COWL
        ab = rest & (xx >= xa) & (xx <= xf) & (yy < top - 0.08 * Dn) & (yy > top - 0.4 * Dn)
        ge3 = dil(g['geng'], 3 * k)
        mk[ab & ~bodyish & ge3] = UNP  # the pylon (Gemini's blue covers it), not the windows
        mk[ab & bodyish & ~ge3] = BODY  # white fuselage between the wing and the nacelle
        mk[rest & (xx >= xa - 0.5 * Dn) & (xx <= xa - 3 * k) & (yy >= top) & (yy <= top + 1.1 * Dn)] = METAL
        # the exhaust further aft, as far as Gemini's engine area reaches
        far = rest & ero(g['geng'], 2 * k) & (xx >= xa - 1.2 * Dn) & (xx < xa - 0.5 * Dn) & (yy >= top + 0.1 * Dn) & (yy <= top + 1.1 * Dn)
        for f in engs:
            if f is not e:
                far &= ~((xx >= f['aft'] - 2 * k) & (xx <= f['front'] + 6 * k))
        mk[far] = METAL
    # winglets and aerials standing above the crown are never fuselage
    mk[rest & (yy < g['crown'][None, :] - 4 * k) & (g['crown'][None, :] >= 0) & (mk == 0)] = UNP
    for name, polys in hints.get('seed', {}).items():
        mk[poly_mask((H, W), polys, k) & rest] = NAMES.index(name)
    Ys = ndi.gaussian_filter(Y, 0.8 * k)
    grad = np.hypot(ndi.sobel(Ys, 0), ndi.sobel(Ys, 1))
    lab = watershed(grad, mk, mask=rest).astype(np.uint8)
    lab[rest & (xx > g['nx'] - 0.1 * g['L']) & (lab != COWL)] = BODY
    lab[(lab == BODY) & (yy < g['crown'][None, :] - 2 * k) & (xx < g['nx'] - 0.1 * g['L'])] = UNP
    lab[fin] = FIN
    for e in engs:
        D = e['Dn']
        near = (xx >= e['aft'] - 0.9 * D) & (xx <= e['front'] + 0.4 * D) & (yy >= e['top'] - 0.75 * D) & (yy <= e['top'] + 1.5 * D)
        for f in engs:
            if f is not e:
                near = near & ~f['box']
        bad = (lab == COWL) & near & ((xx < e['aft'] - 1) | (xx > e['front'] + 3 * k) | (yy < e['top'] - 0.1 * D))
        lab[bad & bodyish] = BODY
        lab[bad & ~bodyish] = UNP
    # the nacelle stands in front of the fuselage: no fuselage paint inside its outline
    for e in engs:
        bot = e['bot'].astype(float)[None, :]
        inside = (xx >= e['aft'] + 2 * k) & (xx <= e['front'] - 2 * k) & (yy >= e['top'] + 0.06 * e['Dn']) & (yy <= bot - 2 * k) & (bot >= 0)
        lab[inside & (lab == BODY)] = COWL
    if engs:
        lab[(lab == COWL) & ~np.any([e['box'] for e in engs], axis=0)] = UNP
    cl, n = ndi.label(lab == COWL)
    if n:
        sz = ndi.sum(lab == COWL, cl, np.arange(1, n + 1))
        small = np.zeros(n + 1, bool)
        small[1:] = sz < 0.2 * sz.max()
        lab[small[cl] & bodyish] = BODY
        lab[small[cl] & ~bodyish] = UNP
    # what Gemini called engine but is not cowl: the exhaust behind it, the pylon above it (never painted)
    ge = dil(g['geng'], 2 * k)
    for e in engs:
        m = ge & e['box'] & ((lab == UNP) | (lab == METAL))
        lab[m & (xx < e['aft']) & (yy >= e['top'])] = METAL
        lab[m & (yy < e['top'] + 0.1 * e['Dn']) & (xx >= e['aft'] - 0.3 * e['Dn'])] = PYLON
    lab[(lab == METAL) & ~ge] = UNP
    # the stabiliser's root fairing: lit like the fuselage, joined to it without a drawn outline -> fuselage (grown
    # from the fuselage over such pixels for at most 30 px; thin leading-edge glints are left out)
    tt = (yy - g['crown'][None, :]) / np.maximum(1, (g['belly'] - g['crown'])[None, :])
    tz = rest & tubem & (xx < g['tx'] + 0.25 * g['L']) & (tt < 0.72)
    cand = (lab == UNP) & tz & (Y >= exp - 65)
    cand = dil(ero(cand, 2 * k), 2 * k) & cand
    grown = (lab == BODY) & tz
    for _ in range(int(30 * k)):
        nxt = ndi.binary_dilation(grown) & (cand | grown)
        if (nxt == grown).all():
            break
        grown = nxt
    grown = dil(grown & cand, 1.5 * k) & (lab == UNP) & tz & (Y >= exp - 75)
    lab[grown] = BODY
    # the drawn outline along the silhouette belongs to the surface inside it (not where the wing or stabiliser is)
    rim = (lab == UNP) & (ndi.distance_transform_edt(op) <= 3 * k)
    dens = ndi.uniform_filter((lab == UNP).astype(np.float32), int(12 * k) | 1)
    for l in (BODY, FIN):
        lab[rim & dil(lab == l, 3.5 * k) & (dens < 0.45)] = l
    # thin drawn lines (panel lines, fairing outlines) with paint on both sides belong to that paint
    u = lab == UNP
    thin = u & ~ndi.binary_opening(u, structure=disk(2.5 * k))
    r = int(round(4 * k))
    for l in (BODY, FIN):
        p_ = np.pad(lab == l, r)
        H2, W2 = u.shape
        sh = lambda dy, dx: p_[r + dy:r + dy + H2, r + dx:r + dx + W2]
        both = np.zeros_like(u)
        for d in range(1, r + 1):
            for e in range(1, r + 1):
                both |= (sh(0, -d) & sh(0, e)) | (sh(-d, 0) & sh(e, 0))
        lab[thin & both] = l
    absorb_small(lab, op, area)
    for name, polys in hints.get('force', {}).items():
        pm = poly_mask((H, W), polys, k) & op & ((lab != FIN) | (name == 'fin'))
        lab[pm] = NAMES.index(name)
    # the intake lip: the front `lip` px of every cowl row
    for e in engs:
        c = (lab == COWL) & (xx >= e['aft']) & (xx <= e['front'] + 4 * k)
        for y in np.nonzero(c.any(axis=1))[0]:
            xs_ = np.nonzero(c[y])[0]
            lab[y, xs_[xs_ > xs_.max() - e['lip']]] = LIP
    absorb_small(lab, op, area, bodyish)
    # stray specks of fuselage paint on an engine or pylon (not joined to the fuselage) are not fuselage
    bl, n = ndi.label(lab == BODY)
    if n:
        sz = ndi.sum(lab == BODY, bl, np.arange(1, n + 1))
        eng_lab = dil(np.isin(lab, [COWL, LIP, METAL, PYLON]), 2)
        touch = np.zeros(n + 1, bool)
        touch[np.unique(bl[eng_lab & (bl > 0)])] = True
        small = np.zeros(n + 1, bool)
        small[1:] = sz < 0.002 * area
        lab[(small & touch)[bl]] = UNP
    # the wing-root border as a painter masks it: one clean line, no thin tongues of fuselage paint between the
    # flap-track fairings and no stair steps (an opening of the fuselage, 9 px at 2048, in the lower tube where it
    # meets the wing)
    if g['w0'] is not None:
        tt = (yy - g['crown'][None, :]) / np.maximum(1, (g['belly'] - g['crown'])[None, :])
        zone = (xx >= g['w0'] - 0.12 * g['L']) & (xx <= g['w1']) & (tt > 0.35) & dil(lab == UNP, 14 * k)
        b = lab == BODY
        opened = ndi.binary_opening(b, structure=disk(9 * k))
        cut = b & ~opened & zone
        lab[cut] = UNP
    for name, polys in hints.get('force', {}).items():
        lab[poly_mask((H, W), polys, k) & op & ((lab != FIN) | (name == 'fin'))] = NAMES.index(name)
    # nothing standing above the crown is fuselage (winglets, aerials)
    lab[(lab == BODY) & (yy < g['crown'][None, :] - 2 * k) & (xx < g['nx'] - 0.1 * g['L'])] = UNP
    # the soft outline fringe takes the label of the nearest solid pixel
    fr = (g['A'] > 0) & ~op
    if fr.any():
        _, idx = ndi.distance_transform_edt(~op, return_indices=True)
        lab[fr] = lab[idx[0][fr], idx[1][fr]]
    # last word: no cowl paint behind a cowl's trailing edge (the exhaust)
    for e in engs:
        D = e['Dn']
        box = (xx < e['aft'] - 1) & (xx > e['aft'] - 1.5 * D) & (yy > e['top'] - 0.5 * D) & (yy < e['top'] + 1.5 * D)
        for f in engs:
            if f is not e:
                box &= ~((xx >= f['aft'] - 1) & (xx <= f['front'] + 6 * k))
        lab[box & np.isin(lab, [COWL, LIP])] = METAL
    g['engs'] = engs
    g['fin'] = fin
    return lab


COL = {FIN: (230, 40, 40), BODY: (40, 200, 90), COWL: (40, 90, 255), LIP: (255, 200, 0), METAL: (160, 0, 200), PYLON: (0, 220, 230)}


def overlay(g, lab, alpha=0.4):
    """Check picture: fin red, body green, cowl blue, lip gold, exhaust purple, pylon cyan, unpainted as drawn;
    region edges yellow."""
    A = g['A']
    img = g['rgb'] * A[..., None] + np.array([70, 100, 150.]) * (1 - A[..., None])
    for l, c in COL.items():
        m = (lab == l) & (A > 0)
        img[m] = img[m] * (1 - alpha) + np.array(c) * alpha
    b = np.zeros(lab.shape, bool)
    b[:, 1:] |= lab[:, 1:] != lab[:, :-1]
    b[1:, :] |= lab[1:, :] != lab[:-1, :]
    img[b & g['op']] = [255, 255, 0]
    return img.clip(0, 255).astype(np.uint8)


def grid_crop(img, k, x0, y0, x1, y1, scale):
    """Crop (2048 px coords) of a full-resolution check picture at `scale` per 2048 px, with a 10-px grid."""
    from PIL import ImageDraw
    X0, Y0, X1, Y1 = [int(round(v * k)) for v in (x0, y0, x1, y1)]
    c = Image.fromarray(img[Y0:Y1, X0:X1]).resize((int((x1 - x0) * scale), int((y1 - y0) * scale)), Image.LANCZOS)
    d = ImageDraw.Draw(c, 'RGBA')
    for x in range((x0 // 10 + 1) * 10, x1, 10):
        X = (x - x0) * scale
        d.line([(X, 0), (X, c.height)], fill=(255, 0, 255, 120 if x % 50 == 0 else 35))
        if x % 50 == 0:
            d.text((X + 2, 2), str(x), fill=(255, 255, 0, 255))
    for y in range((y0 // 10 + 1) * 10, y1, 10):
        Y = (y - y0) * scale
        d.line([(0, Y), (c.width, Y)], fill=(255, 0, 255, 120 if y % 50 == 0 else 35))
        if y % 50 == 0:
            d.text((2, Y + 2), str(y), fill=(255, 255, 0, 255))
    return c


def check_pictures(sid, g, lab, out):
    """Whole overlay and a sheet of 2x crops: fin tip, fin root and tail cone, wing-body fairing and belly, each
    engine (exhaust included), nose."""
    from PIL import ImageDraw
    k, L = g['k'], g['L'] / g['k']
    ov = overlay(g, lab)
    H = lab.shape[0]
    Image.fromarray(ov).resize((2048, int(round(H / k))), Image.LANCZOS).save(os.path.join(out, f'mask-{sid}.png'))
    ys, xs = np.nonzero(lab == FIN)
    fx0, fx1, fy0 = xs.min() / k, xs.max() / k, ys.min() / k
    T = [('fin tip', fx0 - 15, fy0 - 10, fx0 + 0.6 * (fx1 - fx0), fy0 + 70)]
    cr = g['crown'][int(g['xF'])] / k
    T.append(('fin root, stabiliser, tail cone', g['tx'] / k - 5, cr - 110, g['xF'] / k + 20, g['belly'][int(g['tx'] + 0.12 * g['L'])] / k + 20))
    if g['w0'] is not None:
        bel = max([(e['top'] + e['Dn']) / k for e in g['engs']] + [g['belly_ref'] / k])
        T.append(('wing-body fairing, belly', g['w0'] / k - 0.06 * L, (g['crown_ref'] + 0.25 * g['Dt']) / k, g['w1'] / k + 0.02 * L, bel + 10))
    for i, e in enumerate(g['engs']):
        D = e['Dn'] / k
        T.append((f'engine {i + 1}', e['aft'] / k - 0.7 * D, e['top'] / k - 0.5 * D, e['front'] / k + 0.2 * D, e['top'] / k + 1.2 * D))
    T.append(('nose', g['nx'] / k - 0.09 * L, g['crown_ref'] / k - 30, g['nx'] / k + 6, g['belly_ref'] / k + 12))
    tiles = []
    for name, x0, y0, x1, y1 in T:
        x0, y0 = max(0, int(x0)), max(0, int(y0))
        x1, y1 = min(2047, int(x1)), min(int(H / k) - 1, int(y1))
        sc = min(2.0, 1900 / max(1, x1 - x0))
        im = grid_crop(ov, k, x0, y0, x1, y1, sc)
        ImageDraw.Draw(im).text((6, im.height - 14), f'{sid}: {name} ({sc:.1f}x)', fill=(255, 255, 0))
        tiles.append(im)
    sh = Image.new('RGB', (max(t.width for t in tiles), sum(t.height + 4 for t in tiles)), (20, 20, 20))
    y = 0
    for t in tiles:
        sh.paste(t, (0, y))
        y += t.height + 4
    sh.save(os.path.join(out, f'mask-{sid}-2x.png'))


_HINTS = None


def hints():
    """Per-sprite paint hints (scripts/sprites-paint.json): engines and hand corrections."""
    global _HINTS
    if _HINTS is None:
        raw = json.load(open(HINTS)) if os.path.exists(HINTS) else {}
        _HINTS = {k: v for k, v in raw.items() if not k.startswith('_')}
    return _HINTS


SHADE_W = 1024  # the shading field is smooth: half the big asset's width is plenty (bilinear in the browser)
SHADE_MAX = 1.25  # encoded range of the normalised shading


def tube_t(body, H, W):
    """Height in the fuselage tube per pixel (crown 0 .. belly 1) from the data's body lines; nan off the tube."""
    xs = np.arange(W)
    f = (xs - body['x0']) / body['step']
    cr = np.array(body['crown'], float)
    bl = np.array(body['belly'], float)
    idx = np.arange(len(cr))
    ok = cr >= 0
    c = np.interp(f, idx[ok], cr[ok], left=np.nan, right=np.nan)
    b = np.interp(f, idx[ok], bl[ok], left=np.nan, right=np.nan)
    return (np.arange(H)[:, None] - c[None, :]) / np.maximum(1, (b - c)[None, :])


def cylinder_shade(Y, cov, t, step=8, deg=4, sig=3):
    """The fuselage's light as a cylinder: per 8-px column band a robust degree-4 fit of the (closed) luminance
    against the height in the tube, the fits smoothed along the length. Airbrush streaks and compression noise run
    along the fuselage, so a fit in height alone leaves them out; drawn lines and shadows are outliers."""
    H, W = Y.shape
    Yc = ndi.grey_closing(Y, size=(9, 9), mode='nearest')
    m = (cov > 0.5) & np.isfinite(t)
    tt = np.clip(np.nan_to_num(t, nan=0.0), -0.05, 1.3)
    nb = (W + step - 1) // step
    coefs = np.zeros((nb, deg + 1))
    wts = np.zeros(nb)
    for i in range(nb):
        x0, x1 = max(0, i * step - 12), min(W, i * step + step + 12)
        mm = m[:, x0:x1]
        if mm.sum() < 30:
            continue
        ty, yv = tt[:, x0:x1][mm], Yc[:, x0:x1][mm]
        p = np.polyfit(ty, yv, deg)
        for _ in range(2):
            r = yv - np.polyval(p, ty)
            keep = np.abs(r) < 2.5 * (np.median(np.abs(r)) * 1.5 + 1e-4)
            if keep.sum() > deg + 5:
                p = np.polyfit(ty[keep], yv[keep], deg)
        coefs[i], wts[i] = p, mm.sum()
    good = wts > 0
    if not good.any():
        return Yc
    gi = np.nonzero(good)[0]
    for j in range(deg + 1):
        coefs[:, j] = np.interp(np.arange(nb), gi, coefs[gi, j])
    wv = np.maximum(wts, 1) * good
    den = np.maximum(ndi.gaussian_filter1d(wv, sig), 1e-6)
    sm = np.stack([ndi.gaussian_filter1d(coefs[:, j] * wv, sig) / den for j in range(deg + 1)], 1)
    xs = (np.arange(W) + 0.5) / step - 0.5
    C = [np.interp(xs, np.arange(nb), sm[:, j]) for j in range(deg + 1)]
    S = np.broadcast_to(C[0][None, :], Y.shape).copy()
    for j in range(1, deg + 1):
        S = S * tt + C[j][None, :]
    return np.maximum(S, 1e-3)


def shading_field(rgb, alpha, covs, t):
    """The painting model's light (paintModel.ts), done once here: the fuselage as a fitted cylinder
    (cylinder_shade), the fin and the cowls as their closed luminance blurred inside the region (sigma 10 / 5 px), each
    over the region's lit white (97th percentile); joined by coverage and grown 6 px past the edges (so a scaled copy
    has no dark rim). Returns (field 0..SHADE_MAX at the asset's size, whites)."""
    c = rgb.astype(np.float32) / 255
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    Y = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    Yc = ndi.grey_closing(Y, size=(13, 13), mode='nearest')
    num_all = np.zeros_like(Y)
    den_all = np.zeros_like(Y)
    whites = []
    for r, cov in enumerate(covs):
        cv = cov * (alpha > 0)
        if r == 1:
            cyl = cylinder_shade(Y, cv, t)
            # big shapes the cylinder does not know (the belly fairing's bulge, the tail cone's taper): the art's
            # residual, heavily smoothed inside the body, small amplitudes (streaks) thresholded away
            res = np.where(cv > 0.5, Yc - cyl, 0)
            den = ndi.gaussian_filter(cv, 8)
            res = np.where(den > 1e-3, ndi.gaussian_filter(res * cv, 8) / np.maximum(den, 1e-3), 0)
            res = np.sign(res) * np.maximum(0, np.abs(res) - 0.04)
            sh = np.maximum(cyl + res, 1e-3)
        else:
            sig = 10 if r == 0 else 5
            num, den = ndi.gaussian_filter(Yc * cv, sig), ndi.gaussian_filter(cv, sig)
            sh = np.where(den > 1e-3, num / np.maximum(den, 1e-3), Y)
        sel = cv > 0.5
        wt = max(0.05, float(np.percentile(sh[sel], 97)) if sel.any() else 1.0)
        whites.append(round(wt, 4))
        num_all += cv * sh / wt
        den_all += cv
    have = den_all > 0.01
    f = np.where(have, num_all / np.maximum(den_all, 1e-4), 0)
    if have.any():
        dist, idx = ndi.distance_transform_edt(~have, return_indices=True)
        f = np.where(dist <= 6, f[idx[0], idx[1]], 0)
    return np.clip(f, 0, SHADE_MAX), whites

def process(job):
    """One sprite: assets, layout data, paint mask (and the check pictures)."""
    sid, sp, mp, out_dir, check = job
    rgb = np.asarray(Image.open(sp).convert('RGB'))
    a, fg, ex = key_out(rgb)
    report = {}
    tail = np.zeros(a.shape, np.float32)
    eng = np.zeros(a.shape, np.float32)
    if mp:
        m = np.asarray(Image.open(mp).convert('RGB'))
        if m.shape != rgb.shape:
            report['gemini'] = 'size differs: no fin / engine hint'
        else:
            red, blue = classify(m.astype(int))
            colour = np.asarray(Image.fromarray(((red | blue) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9))) > 0
            diff = np.abs(rgb.astype(int) - m.astype(int)).max(axis=2)
            bad = int(((diff > 40) & ~colour).sum())
            if bad > 2000:
                tail = (red & (a > 0)).astype(np.float32)
                eng = (blue & (a > 0)).astype(np.float32)
            else:
                tail = coverage(m, a, gate(red, 0.05), 0)
                eng = coverage(m, a, gate(blue, 0.03), 2)
    if not tail.any():
        raise SystemExit(f'{sid}: the fin hint (Gemini mask, red) is needed to find the fin')
    # trim with an even margin
    ys, xs = np.nonzero(a > 0.02)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    mg = max(8, int(round(MARGIN * (x1 - x0))))
    pad = lambda arr: np.pad(arr, [(mg, mg), (mg, mg)] + [(0, 0)] * (arr.ndim - 2))
    crop = lambda arr: pad(arr[y0:y1, x0:x1])
    a_c, fg_c, tail_c, eng_c = crop(a), crop(fg), crop(tail), crop(eng)
    rgba = np.dstack([fg_c, a_c[..., None] * 255]).round().clip(0, 255).astype(np.uint8)
    cw, ch = rgba.shape[1], rgba.shape[0]
    files = {}
    alpha2 = None
    for wd in WIDTHS:
        hd = int(round(ch * wd / cw))
        im = resize_rgba(rgba, wd, hd)
        if wd == REF_W:
            alpha2 = np.asarray(im)[..., 3]
        fn = f'{sid}-{wd}.webp'
        im.save(os.path.join(out_dir, fn), 'WEBP', quality=86, alpha_quality=100, method=6)
        files[wd] = os.path.getsize(os.path.join(out_dir, fn))
    rh = int(round(ch * REF_W / cw))
    sc = lambda arr: np.asarray(Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8)).resize((REF_W, rh), Image.BOX)).astype(np.float32) / 255
    a2, e2 = sc(a_c), sc(eng_c)
    rgb2 = np.asarray(Image.fromarray(fg_c.round().astype(np.uint8)).resize((REF_W, rh), Image.BOX)).astype(np.float32)
    # v0.11 paint regions at the art's own resolution, then their coverage at 2048
    g = geometry(a_c, fg_c, tail_c > 0.5, eng_c > 0.5)
    lab = segment(g, hints().get(sid, {}))
    k = g['k']
    cov = lambda sel: sc(np.isin(lab, sel).astype(np.float32))
    fin2, body2, cowl2 = cov([FIN]), cov([BODY]), cov([COWL, LIP])
    inside = alpha2 > 0
    mk = np.dstack([fin2 * 255 * inside, body2 * 255 * inside, cowl2 * 255 * inside]).round().clip(0, 255).astype(np.uint8)
    Image.fromarray(mk, 'RGB').save(os.path.join(out_dir, f'{sid}-mask.png'), optimize=True)
    files['mask'] = os.path.getsize(os.path.join(out_dir, f'{sid}-mask.png'))
    data = {'w': REF_W, 'h': rh}
    data.update(layout(a2, fin2, e2, rgb2))
    xs2 = list(range(int(round(g['tx'] / k)), int(round(g['nx'] / k)) + 1, BODY_STEP))
    line = lambda arr: [int(round(arr[min(len(arr) - 1, int(round(x * k)))] / k)) if arr[min(len(arr) - 1, int(round(x * k)))] >= 0 else -1 for x in xs2]
    data['body'] = {'x0': xs2[0], 'step': BODY_STEP, 'crown': line(g['crown']), 'belly': line(g['belly'])}
    data['eng'] = [[r1(e['aft'] / k), r1(e['front'] / k), r1(e['lip'] / k), r1(e['top'] / k), r1(e['Dn'] / k)] for e in g['engs']]
    rgb_a = np.asarray(resize_rgba(rgba, REF_W, rh))
    field, whites = shading_field(rgb_a[..., :3], rgb_a[..., 3], [fin2, body2, cowl2], tube_t(data['body'], rh, REF_W))
    sh_h = int(round(rh * SHADE_W / REF_W))
    enc = (field / SHADE_MAX * 255).round().clip(0, 255).astype(np.uint8)
    Image.fromarray(enc, 'L').resize((SHADE_W, sh_h), Image.BOX).convert('RGB').save(os.path.join(out_dir, f'{sid}-shade.webp'), 'WEBP', quality=95, method=6)
    files['shade'] = os.path.getsize(os.path.join(out_dir, f'{sid}-shade.webp'))
    data['white'] = whites
    if check:
        check_pictures(sid, g, lab, check)
    sil = float((a2 > 0.5).sum())
    report['paint'] = f'fin {fin2.sum() / sil:.2f} body {body2.sum() / sil:.2f} cowl {cowl2.sum() / sil:.3f} of the airframe, {len(g["engs"])} engine(s)'
    report['bytes'] = files
    return sid, data, report


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)
    src = args[0]
    out_dir = args[args.index('--out') + 1] if '--out' in args else 'public/aircraft'
    meta = args[args.index('--meta') + 1] if '--meta' in args else 'src/ui/components/aircraft/sprites.gen.ts'
    check = args[args.index('--check') + 1] if '--check' in args else None
    only = args[args.index('--only') + 1].split(',') if '--only' in args else None
    os.makedirs(out_dir, exist_ok=True)
    if check:
        os.makedirs(check, exist_ok=True)
    inputs = find_inputs(src)
    # identical art shares one set of files
    first, same = {}, {}
    for sid, sp, mp in inputs:
        digest = hashlib.sha1(open(sp, 'rb').read() + (open(mp, 'rb').read() if mp else b'')).hexdigest()
        if digest in first:
            same[sid] = first[digest]
        else:
            first[digest] = sid
    jobs = [(sid, sp, mp, out_dir, check) for sid, sp, mp in inputs if sid not in same and (not only or sid in only)]
    if not only:
        for f in os.listdir(out_dir):
            if f.endswith('.webp') or f.endswith('-mask.png') or f.endswith('-shade.png'):
                os.remove(os.path.join(out_dir, f))
    from multiprocessing import Pool
    with Pool(min(len(jobs), max(1, (os.cpu_count() or 2) - 1))) as pool:
        results = pool.map(process, jobs, chunksize=1)
    data = {}
    if only and os.path.exists(meta):
        txt = open(meta).read()
        data = json.loads(txt[txt.index('= ') + 2: txt.rindex(';')])
    total = 0
    for sid, d, rep in sorted(results):
        data[sid] = d
        b = rep.pop('bytes')
        total += sum(b.values())
        print(f'{sid:24s} {b[2048] // 1024:4d} KB + {b[1024] // 1024:3d} KB + mask {b["mask"] // 1024:2d} KB + shade {b["shade"] // 1024:2d} KB  {rep}')
    for sid, s in same.items():
        data[sid] = {'same': s}
        print(f'{sid:24s} same as {s}')
    data = {sid: data[sid] for sid, _, _ in inputs if sid in data}
    print(f'total {total / 1024 / 1024:.2f} MB written to {out_dir}')
    body = json.dumps(data, separators=(',', ':'))
    with open(meta, 'w') as fh:
        fh.write('// Generated by scripts/sprites.py from the player\'s sprites: do not edit by hand.\n')
        fh.write('// Pixels of the 2048-wide asset, x right, y down, nose right. See ./sprites.ts.\n')
        fh.write('/* eslint-disable */\n')
        fh.write('import type { SpriteData } from \'./sprites\';\n\n')
        fh.write(f'export const SPRITE_DATA: Record<string, SpriteData> = {body};\n')


if __name__ == '__main__':
    main()
