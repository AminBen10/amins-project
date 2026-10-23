"""Step 2: anatomical points measured on the smooth (subdivided) surface, in the head frame.
Regions come from MakeHuman's own regional targets (the ear targets list the ear vertices,
the mouth targets the lips, and so on)."""
import glob
import os
import numpy as np

NBASE = 19158  # vertices in MakeHuman base.obj (hm08)


def target_weights(mh, pattern, n):
    """Largest displacement each base vertex gets from the targets matching pattern."""
    w = np.zeros(n)
    for path in glob.glob(os.path.join(mh, 'targets', pattern)):
        with open(path) as fh:
            for line in fh:
                if line.startswith('#') or not line.strip():
                    continue
                p = line.split()
                i = int(p[0])
                w[i] = max(w[i], np.linalg.norm([float(p[1]), float(p[2]), float(p[3])]))
    return w


def region(mh, pattern, used, frac=0.5):
    """Cage-vertex mask of the part a target moves (vertices moved >= frac of the max)."""
    w = target_weights(mh, pattern, NBASE)[used]
    return w >= frac * w.max()


def front_profile(P, T, ymin=-1.56, ymax=1.1, dy=0.002, zmin=0.0):
    """Front silhouette z(y) of the x=0 cross-section of the surface (triangles T), every dy."""
    x = P[:, 0] + 1e-7  # nudge so midline vertices fall on one side
    a, b, c = T[:, 0], T[:, 1], T[:, 2]
    ys = np.arange(ymax, ymin, -dy)
    z = np.full(len(ys), -np.inf)
    # each triangle that crosses the plane gives a segment between its two crossing points
    tri_pts = {}
    for u, v in ((a, b), (b, c), (c, a)):
        m = np.where((x[u] > 0) != (x[v] > 0))[0]
        t = x[u[m]] / (x[u[m]] - x[v[m]])
        q = P[u[m]] + (P[v[m]] - P[u[m]]) * t[:, None]
        for k, i in enumerate(m):
            tri_pts.setdefault(i, []).append(q[k])
    for seg in tri_pts.values():
        if len(seg) != 2:
            continue
        (y0, z0), (y1, z1) = seg[0][1:], seg[1][1:]
        if y0 < y1:
            y0, z0, y1, z1 = y1, z1, y0, z0
        i0 = int(np.ceil((ymax - y0) / dy))
        i1 = int(np.floor((ymax - y1) / dy))
        for i in range(max(i0, 0), min(i1, len(ys) - 1) + 1):
            yy = ys[i]
            zz = z0 + (z1 - z0) * (yy - y0) / (y1 - y0) if y1 != y0 else max(z0, z1)
            if zz > zmin and zz > z[i]:
                z[i] = zz
    good = np.isfinite(z)
    z = np.interp(np.arange(len(ys)), np.where(good)[0], z[good])
    return ys, z


def measure(mh, used, P2, N2, T2, ncage, part, eye_centers):
    """Return a dict of named points/heights (head frame)."""
    skin = np.zeros(len(P2), bool)
    skin[:ncage] = part == 0
    A = {}
    # ears (+x is the head's left; the site films the left side)
    ear = region(mh, 'ears/l-ear-trans-up.target', used, 0.95)
    ei = np.where(ear)[0]
    E = P2[ei]
    A['ear_top'] = E[np.argmax(E[:, 1])]
    A['ear_bottom'] = E[np.argmin(E[:, 1])]
    A['ear_front'] = E[np.argmax(E[:, 2])]
    A['ear_back'] = E[np.argmin(E[:, 2])]
    A['ear_center'] = E.mean(0)
    A['ear_idx'] = ei
    A['ear_any'] = region(mh, 'ears/*-ear-trans-up.target', used, 0.95)
    # the auricle alone (the wing target leaves the skin around the ear root in place)
    A['auricle'] = region(mh, 'ears/*-ear-wing-incr.target', used, 0.25)
    # eyes
    A['eye_l'] = eye_centers[0]
    A['eye_r'] = eye_centers[1]
    # mouth corner: the vertex the horizontal mouth scale moves furthest, on +x
    w = target_weights(mh, "mouth/mouth-scale-horiz-incr.target", NBASE)[used]
    w[P2[:ncage, 0] < 0] = 0
    A['mouth_corner'] = P2[np.argmax(w)]
    # midline profile: walk down from the nose tip through lips, chin and throat
    ys, z = front_profile(P2, T2)

    def at(i):
        return np.array([0.0, ys[i], z[i]])

    def arg(fn, y0, y1):
        r = np.where((ys <= y0) & (ys >= y1))[0]
        return r[fn(z[r])]

    tip = arg(np.argmax, 0.0, -0.6)
    A['nose_tip'] = at(tip)
    nasion = arg(np.argmin, A['eye_l'][1] + 0.15, A['eye_l'][1] - 0.1)
    A['nasion'] = at(nasion)
    A['glabella'] = at(arg(np.argmax, ys[nasion] + 0.3, ys[nasion]))
    lip_u = arg(np.argmax, ys[tip] - 0.12, ys[tip] - 0.4)
    A['lip_upper'] = at(lip_u)
    A['subnasale'] = at(arg(np.argmin, ys[tip] - 0.02, ys[lip_u]))
    sto = arg(np.argmin, ys[lip_u], ys[lip_u] - 0.12)
    A['stomion'] = at(sto)
    lip_l = arg(np.argmax, ys[sto], ys[sto] - 0.12)
    A['lip_lower'] = at(lip_l)
    sul = arg(np.argmin, ys[lip_l], ys[lip_l] - 0.18)
    A['sulcus'] = at(sul)
    A['pogonion'] = at(arg(np.argmax, ys[sul], -1.0))
    # throat (cervicomental angle): below the menton, where the profile turns 45 degrees from
    # the under-chin shelf to the front of the neck
    r = np.where((ys < -1.02) & (ys > -1.45))[0]
    slope = np.gradient(z[r], ys[r])  # dz per unit of descent: large on the shelf, small on the neck
    shelf = np.argmax(slope > 2.0)
    throat = r[shelf + np.argmax(slope[shelf:] < 1.0)]
    A['throat'] = at(throat)
    # MakeHuman's neck has no marked laryngeal prominence; put it where it sits on an adult man,
    # about 2 cm below the cervicomental angle on the front of the neck
    A['adams_apple'] = at(np.argmin(np.abs(ys - (ys[throat] - 0.18))))
    return A
