"""Step 1: the neutral man. MakeHuman base mesh + macro targets (+ a few CC0 detail targets),
cropped to head and neck and moved into the site's head-local frame."""
import os
import numpy as np
from meshlib import load_obj, load_target, subdivide

# Macro sliders, as MakeHuman computes them (apps/human.py): male, 30 years, average muscle
# and weight, the default equal African/Asian/Caucasian mix, average height and proportions
# (which add no target).
AGE_YEARS = 30
AGE = 0.5 + (AGE_YEARS - 25) / ((90 - 25) * 2)
OLD = max(0.0, AGE * 2 - 1)
YOUNG = 1 - OLD
RACES = ('african', 'asian', 'caucasian')

# Small detail-target touches (weights 0..1), all generic MakeHuman sliders. They firm up the
# plaster read (jaw, chin, brow, neck) without moving the face towards anyone in particular.
DETAIL = {
    "head/head-square": 0.15,
    "chin/chin-width-incr": 0.2,
    "chin/chin-prominent-incr": 0.25,
    "chin/chin-bones-incr": 0.25,
    "neck/neck-scale-horiz-incr": 0.3,
    "neck/neck-scale-depth-incr": 0.15,
    "eyebrows/eyebrows-trans-forward": 0.15,
    "cheek/l-cheek-bones-incr": 0.35,
    "cheek/r-cheek-bones-incr": 0.35,
    "cheek/l-cheek-volume-decr": 0.3,
    "cheek/r-cheek-volume-decr": 0.3,
}


def macro_targets():
    t = {}
    for r in RACES:
        t[f'macrodetails/{r}-male-young'] = YOUNG / 3
        t[f'macrodetails/{r}-male-old'] = OLD / 3
    t['macrodetails/universal-male-young-averagemuscle-averageweight'] = YOUNG
    t['macrodetails/universal-male-old-averagemuscle-averageweight'] = OLD
    return t


def build_body(mh, detail=None):
    V, F, G = load_obj(os.path.join(mh, '3dobjs', 'base.obj'))
    targets = macro_targets()
    targets.update(DETAIL if detail is None else detail)
    for name, w in targets.items():
        if w:
            V = V + load_target(os.path.join(mh, 'targets', name + '.target'), len(V)) * w
    return V, F, G


def group_center(V, F, G, name):
    idx = sorted({i for f, g in zip(F, G) if g == name for i in f})
    return V[idx].mean(0)


def crop(V, F, G, cut_y):
    """Head + neck of the body group and the two eye helper spheres. Faces that reach below
    cut_y keep one ring and are flattened onto the plane, so the open neck ends in a clean ring.
    Returns cage positions, quads, part (0 skin, 1 eye) and the base-mesh index of each vertex."""
    eyes, body = [], []
    for f, g in zip(F, G):
        if g in ('helper-l-eye', 'helper-r-eye'):
            eyes.append(f)
        elif g == 'body' and max(V[i, 1] for i in f) > cut_y:
            body.append(f)
    Q = np.array(body + eyes, dtype=np.int64)
    used = np.unique(Q)
    remap = -np.ones(len(V), np.int64)
    remap[used] = np.arange(len(used))
    P = V[used].copy()
    P[:, 1] = np.maximum(P[:, 1], cut_y)
    Q = remap[Q]
    part = np.zeros(len(P), np.uint8)  # 0 skin, 1 eye
    part[np.unique(Q[len(body):])] = 1
    return P, Q, part, used


# The site's head-local frame (measured on the retired SDF head so scene, camera and tools keep
# their numbers): Y up, face towards +Z, crown top at y 1.10, chin (menton) at y -1.00,
# cranium centred at z -0.07, symmetric in x. 1 unit is about 11 cm.
FRAME_TOP = 1.10
FRAME_CHIN = -1.00
FRAME_ZMID = -0.07


def measure_frame(P, N, eye_y, jaw):
    """Crown top, menton and the mid-depth of the cranium on the smooth surface (MakeHuman units).
    The menton is the midline point whose normal points 45 degrees down and forward, searched
    in a window around MakeHuman's jaw joint (which sits in the chin), below the lower lip and
    in front of the throat."""
    crown = P[:, 1].max()
    mid = np.abs(P[:, 0]) < 0.015
    down_fwd = N @ np.array([0.0, -0.7071, 0.7071])
    cand = mid & (P[:, 1] > jaw[1] - 0.35) & (P[:, 1] < jaw[1] + 0.08) & (P[:, 2] > jaw[2] - 0.3)
    chin = P[np.argmax(np.where(cand, down_fwd, -9))]
    best = None
    for y in np.arange(eye_y + 0.2, crown - 0.4, 0.02):
        s = mid & (np.abs(P[:, 1] - y) < 0.02)
        if s.sum() < 2:
            continue
        length = P[s, 2].max() - P[s, 2].min()
        if best is None or length > best[0]:
            best = (length, (P[s, 2].max() + P[s, 2].min()) / 2)
    return crown, chin[1], best[1]


def frame_transform(crown, chin, zmid):
    s = (FRAME_TOP - FRAME_CHIN) / (crown - chin)
    offset = np.array([0.0, FRAME_TOP - crown * s, FRAME_ZMID - zmid * s])
    return s, offset


# Bust neck: the cape is a cone from bounds.neck down to the shoulders, so the neck is eased
# into a slightly flared elliptic cylinder (no trapezius) from just above that ring, and cut flat
# a little lower. Everything that changes here sits under the cape.
NECK_FIT_Y = -1.26
NECK_RING_Y = -1.32
NECK_CUT_Y = -1.55
NECK_FLARE = 0.06


def fit_ring(P, y, band=0.02):
    """Ellipse (cx, cz, rx, rz) of the surface slab around height y (symmetric in x)."""
    s = P[np.abs(P[:, 1] - y) < band]
    cz = (s[:, 2].max() + s[:, 2].min()) / 2
    return 0.0, cz, np.abs(s[:, 0]).max(), (s[:, 2].max() - s[:, 2].min()) / 2


def neck_ellipse(ring, y):
    cx, cz, rx, rz = ring
    g = 1 + NECK_FLARE * np.clip((NECK_FIT_Y - y) / (NECK_FIT_Y - NECK_CUT_Y), 0, 1)
    return cx, cz, rx * g, rz * g


def taper_neck(P, ring, part):
    """Blend skin vertices below NECK_FIT_Y onto the flared cylinder through the fitted ellipse."""
    out = P.copy()
    sel = (P[:, 1] < NECK_FIT_Y + 0.03) & (part == 0)
    y = P[sel, 1]
    t = np.clip((NECK_FIT_Y + 0.03 - y) / 0.22, 0, 1)
    w = t * t * (3 - 2 * t)
    cx, cz, rx, rz = neck_ellipse(ring, y)
    ang = np.arctan2((P[sel, 2] - cz) / rz, (P[sel, 0] - cx) / rx)
    cyl_x = cx + rx * np.cos(ang)
    cyl_z = cz + rz * np.sin(ang)
    out[sel, 0] = P[sel, 0] + (cyl_x - P[sel, 0]) * w
    out[sel, 2] = P[sel, 2] + (cyl_z - P[sel, 2]) * w
    out[:, 1] = np.maximum(out[:, 1], NECK_CUT_Y)
    return out
