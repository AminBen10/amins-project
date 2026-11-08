"""Step 3: hair and beard zones on the smooth surface, stored as signed surface distances
(head units, + inside the zone). The zones are drawn from the measured anatomy: a natural adult
male hairline with slightly matured temples, sideburns to mid-ear, hair kept a finger's width
off the ear, a soft nape line; a full beard zone with a natural cheek line, moustache, chin
and a neckline above the Adam's apple."""
import numpy as np
from scipy.spatial import cKDTree

Z_AXIS = -0.07  # vertical axis of the head-local azimuth phi = atan2(|x|, z - Z_AXIS)


def azimuth(P):
    return np.arctan2(np.abs(P[:, 0]), P[:, 2] - Z_AXIS)


def curve(points, phi):
    """Piecewise smoothstep curve through (phi, y) control points."""
    px = np.array([p[0] for p in points])
    py = np.array([p[1] for p in points])
    out = np.full_like(phi, py[-1])
    out[phi <= px[0]] = py[0]
    for i in range(1, len(px)):
        m = (phi > px[i - 1]) & (phi <= px[i])
        t = (phi[m] - px[i - 1]) / (px[i] - px[i - 1])
        t = t * t * (3 - 2 * t)
        out[m] = py[i - 1] + (py[i] - py[i - 1]) * t
    return out


def signed_distance(P, edges, f):
    """Distance from each vertex to the zero set of the implicit f (sampled on the vertices,
    crossings found per mesh edge), signed + where f > 0."""
    a, b = edges[:, 0], edges[:, 1]
    m = (f[a] > 0) != (f[b] > 0)
    t = f[a[m]] / (f[a[m]] - f[b[m]])
    pts = P[a[m]] + (P[b[m]] - P[a[m]]) * t[:, None]
    d, _ = cKDTree(pts).query(P)
    return np.where(f > 0, d, -d)


def soft_min(a, b, k=0.02):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b + (a - b) * h - k * h * (1 - h)


def hair_zone(P, A, L, ear_dist):
    """Implicit hair zone (> 0 inside)."""
    phi = azimuth(P)
    tri = L['FLEQUILLO']
    pat = L['PATILLA']
    nuca = L['NUCA']
    hl = [
        (0.00, tri),
        (0.36, tri + 0.01),
        (0.62, tri + 0.025),         # temple corners matured a little at 30
        (0.84, tri - 0.06),
        (0.94, L['SIEN_POINT'] + 0.07),
        (1.00, L['SIEN_POINT']),     # temple point
        (1.05, L['SIEN_POINT'] - 0.15),
        (1.09, pat),                 # front edge of the sideburn, ~15 mm before the tragus
        (1.70, pat),
        (1.98, pat - 0.14),          # behind the ear
        (2.35, nuca + 0.05),         # nape corners
        (np.pi, nuca),
    ]
    f = P[:, 1] - curve(hl, phi)
    # natural growth hugs the ear a few mm off its root (the ear itself is never hair);
    # how far a cut keeps off the ear is the cut-step engine's business
    f = soft_min(f, ear_dist - 0.035, 0.015)
    return f


def beard_top(A, L):
    """Upper edge of the beard zone: (phi, y) control points of the cheek line."""
    pat = L['PATILLA']
    sn, mc = A['subnasale'][1], A['mouth_corner'][1]
    return [
        (0.00, sn - 0.012),
        (0.14, sn - 0.02),            # under the nose wings
        (0.26, mc + 0.10),            # moustache corner, outside the nasolabial fold
        (0.40, mc + 0.12),
        (0.62, mc + 0.20),            # cheek line
        (0.85, pat - 0.16),
        (1.02, pat - 0.06),
        (1.12, pat),
        (1.32, pat),
    ]


def beard_zone(P, A, L, ear_dist, lip_dist, nose_dist):
    phi = azimuth(P)
    y = P[:, 1]
    top = beard_top(A, L)
    # natural growth reaches the Adam's apple; necklines are cut by the cut-step engine
    neck_y = L['NUEZ']
    bottom = [
        (0.00, neck_y),
        (0.55, neck_y + 0.04),
        (1.00, neck_y + 0.30),
        (1.30, A['ear_bottom'][1] - 0.18),
        (1.45, A['ear_bottom'][1] - 0.02),
    ]
    f = curve(top, phi) - y
    f = np.minimum(f, y - curve(bottom, phi))
    f = np.minimum(f, (1.42 - phi) * 0.6)     # back edge behind the jaw
    f = soft_min(f, lip_dist - 0.012, 0.015)  # lips are never beard
    f = soft_min(f, nose_dist - 0.01, 0.015)
    f = soft_min(f, ear_dist - 0.035, 0.015)
    return f
