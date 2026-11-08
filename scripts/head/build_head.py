#!/usr/bin/env python3
"""Build the practice head asset (src/three/headAsset.js) from MakeHuman CC0 data.

usage: python3 scripts/head/build_head.py --mh <makehuman/data> [--out src/three/headAsset.js]
       [--preview <dir>]   (also writes OBJ + mask/AO preview meshes)

See scripts/head/README.md for the steps and the asset layout."""
import argparse
import json
import os
import sys
import time

import numpy as np
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(__file__))
from meshlib import subdivide, quad_tris, vertex_normals, edge_table, write_obj, write_preview  # noqa: E402
from sculpt import (build_body, crop, group_center, measure_frame, frame_transform, fit_ring,  # noqa: E402
                    taper_neck, neck_ellipse, NECK_FIT_Y, NECK_RING_Y, NECK_CUT_Y, FRAME_TOP, FRAME_CHIN)
from anatomy import measure, region  # noqa: E402
from masks import hair_zone, beard_zone, beard_top, curve, signed_distance, azimuth, Z_AXIS  # noqa: E402
from bake import bake, trace  # noqa: E402
from encode import encode_asset  # noqa: E402

MM = (FRAME_TOP - FRAME_CHIN) / 230.0  # crown to chin is 230 mm on an adult man
DEDO_MM = 15.0


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def log(*a):
    print('[head]', *a, flush=True)


def radius_grid(P, T, n_phi=65, y0=-1.5, y1=1.1, dy=0.02):
    """Outermost surface radius around the head axis (x=0, z=Z_AXIS) for phi in [0, pi]
    (the +x side; the head is symmetric) and y rows: exact horizontal cross-sections."""
    phis = np.linspace(0, np.pi, n_phi)
    ys = np.arange(y0, y1 + 1e-9, dy)
    r = np.zeros((len(ys), n_phi))
    dirs = np.stack([np.sin(phis), np.cos(phis)], 1)  # (x, z) direction of each ray
    for j, y in enumerate(ys):
        h = P[:, 1] - y + 1e-9
        segs = []
        for a, b in ((0, 1), (1, 2), (2, 0)):
            u, v = T[:, a], T[:, b]
            m = (h[u] > 0) != (h[v] > 0)
            t = h[u[m]] / (h[u[m]] - h[v[m]])
            q = P[u[m]] + (P[v[m]] - P[u[m]]) * t[:, None]
            segs.append((np.where(m)[0], q[:, [0, 2]] - [0, Z_AXIS]))
        ids = np.concatenate([s_[0] for s_ in segs])
        pts = np.concatenate([s_[1] for s_ in segs])
        order = np.argsort(ids, kind='stable')
        ids, pts = ids[order], pts[order]
        pair = ids[:-1] == ids[1:]
        A, B = pts[:-1][pair], pts[1:][pair]
        if not len(A):
            continue
        # ray p = s * dir (s >= 0) against segment A + w (B - A)
        E = B - A
        for k, (dx, dz) in enumerate(dirs):
            den = dx * E[:, 1] - dz * E[:, 0]
            ok = np.abs(den) > 1e-12
            w = (dz * A[:, 0] - dx * A[:, 1])[ok] / den[ok]
            s_ = (A[ok, 0] * E[ok, 1] - A[ok, 1] * E[ok, 0]) / den[ok]
            hit = (w >= 0) & (w <= 1) & (s_ > 0)
            if hit.any():
                r[j, k] = s_[hit].max()
    return phis, ys, r


def grid_point(phis, ys, r, phi, y):
    """Bilinear surface point from the radius grid (python twin of hairField.surfaceAt)."""
    fp = np.clip(phi / np.pi * (len(phis) - 1), 0, len(phis) - 1.001)
    fy = np.clip((y - ys[0]) / (ys[1] - ys[0]), 0, len(ys) - 1.001)
    i, j = int(fp), int(fy)
    u, v = fp - i, fy - j
    rr = (r[j, i] * (1 - u) + r[j, i + 1] * u) * (1 - v) + (r[j + 1, i] * (1 - u) + r[j + 1, i + 1] * u) * v
    return np.array([np.sin(phi) * rr, y, Z_AXIS + np.cos(phi) * rr])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mh', required=True, help='path to makehuman/data')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'three', 'headAsset.js'))
    ap.add_argument('--preview', default=None)
    args = ap.parse_args()
    t0 = time.time()

    # 1. the neutral man, in MakeHuman units
    V, F, G = build_body(args.mh)
    eye_l = group_center(V, F, G, 'helper-l-eye')
    jaw = group_center(V, F, G, 'joint-jaw')
    crown_mh = max(V[i, 1] for f, g in zip(F, G) if g == 'body' for i in f)
    Pm, Qm, _, _ = crop(V, F, G, crown_mh - 3.0)
    Ps, Qs, _ = subdivide(Pm, Qm, 2)
    crown, chin, zmid = measure_frame(Ps, vertex_normals(Ps, quad_tris(Qs)), eye_l[1], jaw)
    scale, offset = frame_transform(crown, chin, zmid)
    log(f'MakeHuman crown-chin {crown - chin:.3f} dm -> scale {scale:.4f}')

    # 2. head frame, crop, bust neck
    V = V * scale + offset
    P, Q, part, used = crop(V, F, G, NECK_CUT_Y)
    P2, Q2, _ = subdivide(P, Q, 2)
    fit = fit_ring(P2, NECK_FIT_Y)
    P = taper_neck(P, fit, part)
    P2, Q2, _ = subdivide(P, Q, 2)
    T2 = quad_tris(Q2)
    N2 = vertex_normals(P2, T2)
    n = len(P)
    ring = neck_ellipse(fit, NECK_RING_Y)
    log(f'cage {n} verts {len(Q)} quads; level 2 {len(P2)} verts')

    # 3. anatomy
    eyes = [group_center(V, F, G, 'helper-l-eye'), group_center(V, F, G, 'helper-r-eye')]
    eye_idx = sorted({i for f, g in zip(F, G) if g == 'helper-l-eye' for i in f})
    eye_radius = float(np.linalg.norm(V[eye_idx] - eyes[0], axis=1).mean())
    A = measure(args.mh, used, P2, N2, T2, n, part, eyes)

    # regions on the level-2 surface (subdivide the cage indicators)
    ind = np.stack([A['auricle'], region(args.mh, 'mouth/mouth-upperlip-volume-incr.target', used, 0.12)
                    | region(args.mh, 'mouth/mouth-lowerlip-volume-incr.target', used, 0.12),
                    region(args.mh, 'nose/nose-trans-forward.target', used, 0.6), part == 1], 1).astype(float)
    _, _, ind2 = subdivide(P, Q, 2, ind)
    ear_d = cKDTree(P2[ind2[:, 0] > 0.5]).query(P2)[0]
    lip_d = cKDTree(P2[ind2[:, 1] > 0.5]).query(P2)[0]
    nose_d = cKDTree(P2[ind2[:, 2] > 0.5]).query(P2)[0]

    # 4. landmarks (heights in head units; S7 of the plan)
    side = (P2[:, 0] > 0.2) & (np.abs(P2[:, 2] - A['ear_top'][2]) < 0.012) & (ear_d > 0.05) & (P2[:, 1] > 0.2)
    a = np.radians(25)
    esq = np.where(side)[0][np.argmax(N2[side] @ np.array([np.cos(a), np.sin(a), 0]))]
    mid = (np.abs(P2[:, 0]) < 0.002) & (P2[:, 1] > 0.3)
    a = np.radians(40)
    cor = np.where(mid)[0][np.argmax(N2[mid] @ np.array([0, np.cos(a), -np.sin(a)]))]
    L = {
        'NUCA': -0.68,                                  # nape hairline at the back
        'OREJA': float(A['ear_top'][1]),                # top of the ear
        'ESQUINA': float(P2[esq, 1]),                   # parietal ridge (normal 25 deg above horizontal)
        'CORONILLA': [0.0, float(P2[cor, 1]), float(P2[cor, 2])],  # crown (normal 40 deg back from vertical)
        'PATILLA': float(A['ear_front'][1] - 0.08),     # sideburn bottom, mid-tragus
        'FLEQUILLO': float(A['glabella'][1] + 0.50),    # front hairline (trichion)
        'NUEZ': float(A['adams_apple'][1]),             # Adam's apple
    }
    L['SIEN'] = (L['OREJA'] + L['ESQUINA']) / 2         # mid temple, where a mid fade sits
    L['SIEN_POINT'] = float(L['SIEN'] - 0.08)           # the hair's temple point (front of the zone)
    dedo = DEDO_MM * MM
    order = [L['OREJA'], L['OREJA'] + dedo, L['SIEN'], L['ESQUINA'] - dedo, L['ESQUINA']]
    gaps = np.diff(order) / dedo
    log('landmarks', {k: (round(v, 3) if not isinstance(v, list) else [round(x, 3) for x in v]) for k, v in L.items()})
    log('ordering gaps (dedos)', np.round(gaps, 2))
    assert (gaps >= 0.6).all(), 'landmark ordering broken'

    # 5. hair and beard zones as signed surface distances
    edges, _ = edge_table(Q2)
    edge_h = signed_distance(P2, edges, hair_zone(P2, A, L, ear_d))
    edge_b = signed_distance(P2, edges, beard_zone(P2, A, L, ear_d, lip_d, nose_d))
    eye2 = ind2[:, 3] > 0.5
    edge_h[eye2] = -0.5
    edge_b[eye2] = -0.5

    # 6. bake on the smooth surface (dense samples from level 4, spacing under the hit radius)
    P4, _, _ = subdivide(P2, Q2, 2)
    ao, cav, thick = bake(P2[:n], N2[:n], P4)
    ao = np.clip(ao / np.percentile(ao[part == 0], 97), 0, 1)  # open convex areas read as 1
    # lip line: the lips meet in a 1 mm slit that the bake (no direct shadows) leaves lit;
    # darken a soft line along it, from the stomion out to the mouth corners
    mc, st = A['mouth_corner'], A['stomion']
    ax = np.abs(P2[:n, 0])
    u = np.clip(ax / mc[0], 0, 1.3)
    y_slit = st[1] + (mc[1] - st[1]) * u * u
    near = (np.linalg.norm(P2[:n] - np.array([0, st[1], st[2]]), axis=1) < mc[0] + 0.08) & (P2[:n, 2] > mc[2] - 0.12)
    line = (1 - smooth(0.004, 0.022, np.abs(P2[:n, 1] - y_slit))) * (1 - smooth(mc[0] - 0.005, mc[0] + 0.03, ax)) * near
    cav = np.maximum(cav, 0.9 * line)
    ao = np.minimum(ao, 1 - 0.75 * line)
    log(f'baked in {time.time() - t0:.1f}s')

    # 7. surface grid for surfaceAt(phi, y)
    phis, ys, rgrid = radius_grid(P2, T2)

    def surf(phi, y):
        return [round(float(c), 4) for c in grid_point(phis, ys, rgrid, phi, y)]

    # anchors (head-local surface points; lateral ones on the +x side, the head's left)
    cheek_phi = 0.70
    anchors = {
        'flequillo': surf(0.0, L['FLEQUILLO']),
        'sien': surf(1.0, L['SIEN']),
        'esquina': surf(1.62, L['ESQUINA']),
        'coronilla': [round(float(c), 4) for c in P2[cor]],
        'nuca': surf(np.pi, L['NUCA'] + 0.5 * dedo),
        'patilla': surf(1.22, L['PATILLA'] + 0.06),
        'oreja': [round(float(c), 4) for c in A['ear_top']],
        'lineaBarba': surf(cheek_phi, float(curve(beard_top(A, L), np.array([cheek_phi]))[0])),  # on the cheek line
        'bigote': [0.0, round(float((A['subnasale'][1] + A['lip_upper'][1]) / 2), 4), round(float(A['lip_upper'][2] - 0.01), 4)],
        'barbilla': [round(float(c), 4) for c in A['pogonion']],
        'cuello': surf(0.0, L['NUEZ'] + dedo),
    }

    # bounds (head-local): sphere around the head above the chin; the neck is the ring below
    head = P2[P2[:, 1] > FRAME_CHIN]
    c = (head.max(0) + head.min(0)) / 2
    c[0] = 0.0
    bounds = {
        'center': [round(float(v), 4) for v in c],
        'radius': round(float(np.linalg.norm(head - c, axis=1).max()), 4),
        'top': FRAME_TOP, 'chin': FRAME_CHIN,
        'neck': {'y': NECK_RING_Y, 'cx': 0.0, 'cz': round(float(ring[1]), 4), 'rx': round(float(ring[2]), 4), 'rz': round(float(ring[3]), 4)},
    }
    pts = {k: [round(float(x), 4) for x in A[k]] for k in ('ear_top', 'ear_bottom', 'ear_front', 'ear_back', 'nose_tip', 'nasion', 'glabella',
                                                          'subnasale', 'lip_upper', 'stomion', 'lip_lower', 'sulcus', 'pogonion', 'throat',
                                                          'adams_apple', 'mouth_corner')}
    meta = {
        'source': 'MakeHuman 1.x base mesh hm08 + targets (CC0 1.0); male, 30 years, average muscle/weight, 1/3 African, Asian, Caucasian',
        'MM': MM, 'DEDO_MM': DEDO_MM,
        'LANDMARKS': {k: (round(v, 4) if not isinstance(v, list) else [round(x, 4) for x in v]) for k, v in L.items() if k != 'SIEN_POINT'},
        'ANCHORS': anchors,
        'bounds': bounds,
        'eyes': {'l': [round(float(v), 4) for v in eyes[0]], 'r': [round(float(v), 4) for v in eyes[1]], 'radius': round(eye_radius, 4)},
        'points': pts,
        'axisZ': Z_AXIS,
    }
    attrs = {'ao': ao, 'cavity': np.clip(cav, 0, 1), 'thickness': thick, 'edgeH': edge_h[:n], 'edgeB': edge_b[:n], 'part': part}
    size = encode_asset(args.out, P, Q, attrs, (phis, ys, rgrid), meta)
    log(f'wrote {args.out}: {size} bytes deflated, {time.time() - t0:.1f}s total')

    if args.preview:
        os.makedirs(args.preview, exist_ok=True)
        write_obj(os.path.join(args.preview, 'head.obj'), P2, Q2)
        _, _, a2 = subdivide(P, Q, 2, np.stack([ao, cav, edge_h[:n], edge_b[:n]], 1))
        write_preview(os.path.join(args.preview, 'ao.bin'), P2, T2, a2[:, 0] * (1 - 0.5 * a2[:, 1]))
        sm = lambda e: np.clip(e / 0.02 + 0.5, 0, 1)  # noqa: E731
        write_preview(os.path.join(args.preview, 'mask.bin'), P2, T2, np.maximum(sm(a2[:, 2]), 0.6 * sm(a2[:, 3])))
        json.dump(meta, open(os.path.join(args.preview, 'meta.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
