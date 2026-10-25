#!/usr/bin/env python3
"""Aircraft sprite pipeline (v0.10): the player's raster art -> web assets + layout data.

usage: python3 scripts/sprites.py <input-dir> [--out public/aircraft] [--meta src/ui/components/aircraft/sprites.gen.ts]

<input-dir> holds sprites/<id>.png and masks/<id>-mask.png (or both flat in one folder): 4096 x 1640 RGB, nose
right, on a flat #00FF00 background; the mask is the same picture with the fin + rudder solid #FF0000 and every
engine nacelle + pylon solid #0000FF. Needs python3 with Pillow (WebP) and numpy. Re-run it when new sprites
arrive; it rewrites every output.

Per sprite it
  1. checks the mask lines up with the sprite (outside the red / blue areas the pixels must match),
  2. keys the green out to alpha (soft edge from the green excess, solid inside), unmixes the edge colour and
     removes green spill, trims to the aircraft with an even margin,
  3. writes <id>-2048.webp and <id>-1024.webp (lossy colour, lossless alpha) and <id>-mask.png (1024 wide:
     R = fin coverage, B = engine coverage),
  4. measures the layout the renderer and the livery stickers need (nose / tail x, fin outline and quad,
     fuselage crown / belly, sticker zone, window line, title band) in 2048-scale pixels -> sprites.gen.ts.
Identical sprites share one set of files (`same` in the data).
"""
import hashlib
import json
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

WIDTHS = (2048, 1024)
MASK_W = 1024
REF_W = 2048  # layout data is in pixels of the 2048 asset
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
    win = None
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
        cap = min(0.5 * avail, 0.2 * D)
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
        'wing': list(wing) if wing else None,
        'titles': titles,
        'silArea': int(sil.sum()),
    }


def process(sid, sp, mp, out_dir, cache):
    raw = open(sp, 'rb').read()
    digest = hashlib.sha1(raw + (open(mp, 'rb').read() if mp else b'')).hexdigest()
    if digest in cache:
        return {'same': cache[digest]}, None
    rgb = np.asarray(Image.open(sp).convert('RGB'))
    a, fg, ex = key_out(rgb)
    report = {}
    tail = np.zeros(a.shape, np.float32)
    eng = np.zeros(a.shape, np.float32)
    if mp:
        m = np.asarray(Image.open(mp).convert('RGB'))
        if m.shape != rgb.shape:
            report['mask'] = 'size differs: no tint for this sprite'
        else:
            red, blue = classify(m.astype(int))
            colour = np.asarray(Image.fromarray(((red | blue) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9))) > 0
            diff = np.abs(rgb.astype(int) - m.astype(int)).max(axis=2)
            bad = int(((diff > 40) & ~colour).sum())
            report['mismatch'] = bad
            if bad > 2000:
                report['mask'] = 'misaligned: tint areas taken from the hard colour areas only'
                tail = (red & (a > 0)).astype(np.float32)
                eng = (blue & (a > 0)).astype(np.float32)
            else:
                tail = coverage(m, a, gate(red, 0.05), 0)
                eng = coverage(m, a, gate(blue, 0.03), 2)
    else:
        report['mask'] = 'missing: no tint for this sprite'
    # trim with an even margin
    ys, xs = np.nonzero(a > 0.02)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    mg = max(8, int(round(MARGIN * (x1 - x0))))
    H, W = a.shape
    pad = lambda arr, val=0: np.pad(arr, [(mg, mg), (mg, mg)] + [(0, 0)] * (arr.ndim - 2), constant_values=val)
    crop = lambda arr: pad(arr[y0:y1, x0:x1])
    a_c, fg_c, tail_c, eng_c = crop(a), crop(fg), crop(tail), crop(eng)
    rgba = np.dstack([fg_c, a_c[..., None] * 255]).round().clip(0, 255).astype(np.uint8)
    cw, ch = rgba.shape[1], rgba.shape[0]
    files = {}
    for wd in WIDTHS:
        hd = int(round(ch * wd / cw))
        im = resize_rgba(rgba, wd, hd)
        fn = f'{sid}-{wd}.webp'
        im.save(os.path.join(out_dir, fn), 'WEBP', quality=86, alpha_quality=100, method=6)
        files[wd] = os.path.getsize(os.path.join(out_dir, fn))
    mh = int(round(ch * MASK_W / cw))
    mk = np.dstack([tail_c * 255, np.zeros_like(tail_c), eng_c * 255]).round().astype(np.uint8)
    Image.fromarray(mk, 'RGB').resize((MASK_W, mh), Image.BOX).save(os.path.join(out_dir, f'{sid}-mask.png'), optimize=True)
    files['mask'] = os.path.getsize(os.path.join(out_dir, f'{sid}-mask.png'))
    # layout at 2048 scale
    rh = int(round(ch * REF_W / cw))
    sc = lambda arr: np.asarray(Image.fromarray((arr * 255).astype(np.uint8)).resize((REF_W, rh), Image.BOX)).astype(np.float32) / 255
    a2, t2, e2 = sc(a_c), sc(tail_c), sc(eng_c)
    rgb2 = np.asarray(Image.fromarray(fg_c.round().astype(np.uint8)).resize((REF_W, rh), Image.BOX)).astype(np.float32)
    data = {'w': REF_W, 'h': rh}
    data.update(layout(a2, t2, e2, rgb2))
    cache[digest] = sid
    report['bytes'] = files
    return data, report


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)
    src = args[0]
    out_dir = args[args.index('--out') + 1] if '--out' in args else 'public/aircraft'
    meta = args[args.index('--meta') + 1] if '--meta' in args else 'src/ui/components/aircraft/sprites.gen.ts'
    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        if f.endswith('.webp') or f.endswith('-mask.png'):
            os.remove(os.path.join(out_dir, f))
    cache, data, total = {}, {}, 0
    for sid, sp, mp in find_inputs(src):
        d, rep = process(sid, sp, mp, out_dir, cache)
        data[sid] = d
        if rep:
            b = rep.pop('bytes')
            total += sum(b.values())
            print(f'{sid:24s} {b[2048] // 1024:4d} KB + {b[1024] // 1024:3d} KB + mask {b["mask"] // 1024:2d} KB  {rep}')
        else:
            print(f'{sid:24s} same as {d["same"]}')
    print(f'total {total / 1024 / 1024:.2f} MB in {out_dir}')
    body = json.dumps(data, separators=(',', ':'))
    with open(meta, 'w') as fh:
        fh.write('// Generated by scripts/sprites.py from the player\'s sprites: do not edit by hand.\n')
        fh.write('// Pixels of the 2048-wide asset, x right, y down, nose right. See ./sprites.ts.\n')
        fh.write('/* eslint-disable */\n')
        fh.write('import type { SpriteData } from \'./sprites\';\n\n')
        fh.write(f'export const SPRITE_DATA: Record<string, SpriteData> = {body};\n')


if __name__ == '__main__':
    main()
