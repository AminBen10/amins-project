"""Step 4: ambient occlusion, cavity and thickness baked on the smooth surface.
Rays are sphere-traced through the unsigned distance to a dense sampling of the limit
surface (level-4 subdivision), so no ray/triangle code is needed."""
import numpy as np
from scipy.spatial import cKDTree


def hemisphere(n, seed=0):
    """Cosine-weighted unit directions around +Z (Fibonacci spiral)."""
    i = np.arange(n) + 0.5
    r = np.sqrt(i / n)
    a = i * np.pi * (3 - np.sqrt(5)) + seed
    return np.stack([r * np.cos(a), r * np.sin(a), np.sqrt(1 - r * r)], 1)


def frames(N):
    up = np.where(np.abs(N[:, 1:2]) < 0.9, [[0.0, 1.0, 0.0]], [[1.0, 0.0, 0.0]])
    T = np.cross(up, N)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    B = np.cross(N, T)
    return T, B


def trace(tree, O, D, t0, tmax, eps):
    """Distance along each ray to the first surface hit (inf if none within tmax)."""
    t = np.full(len(O), t0)
    hit = np.full(len(O), np.inf)
    live = np.ones(len(O), bool)
    for _ in range(100):
        idx = np.where(live)[0]
        if not len(idx):
            break
        p = O[idx] + D[idx] * t[idx, None]
        d, _ = tree.query(p, workers=-1)
        h = d < eps
        hit[idx[h]] = t[idx[h]]
        t[idx] += np.maximum(d * 0.85, eps * 0.6)
        live[idx[h | (t[idx] > tmax)]] = False
    return hit


def bake(Pq, Nq, dense, rays=64, reach=0.45, eps=0.008):
    """Per query point (on the surface, with normal): AO (1 open .. 0 closed), cavity (0 flat ..
    1 deep crease) and thickness (head units, capped at 0.3)."""
    tree = cKDTree(dense)
    T, B = frames(Nq)
    dirs = hemisphere(rays)
    occl = np.zeros(len(Pq))
    for k, (a, b, c) in enumerate(dirs):
        D = T * a + B * b + Nq * c
        hit = trace(tree, Pq, D, 0.02, reach, eps)
        w = np.where(np.isfinite(hit), 1 - (np.minimum(hit, reach) / reach) ** 2, 0)
        occl += w
    ao = 1 - occl / rays
    cav = np.zeros(len(Pq))
    for h, wgt in ((0.012, 0.6), (0.035, 0.4)):
        d, _ = tree.query(Pq + Nq * h, workers=-1)
        cav += wgt * np.clip((h - d) / h, 0, 1)
    thick = trace(tree, Pq - Nq * 0.004, -Nq, 0.01, 0.3, eps)
    thick = np.where(np.isfinite(thick), thick, 0.3)
    return ao, cav, thick
