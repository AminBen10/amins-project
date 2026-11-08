"""Mesh helpers for the head pipeline: OBJ/target IO, Catmull-Clark, normals."""
import numpy as np


def load_obj(path):
    """Return vertices (n,3), faces (list of index lists) and the group name of each face."""
    verts, faces, groups = [], [], []
    group = None
    with open(path) as fh:
        for line in fh:
            if line.startswith('v '):
                verts.append([float(x) for x in line.split()[1:4]])
            elif line.startswith('g '):
                group = line.split()[1]
            elif line.startswith('f '):
                faces.append([int(t.split('/')[0]) - 1 for t in line.split()[1:]])
                groups.append(group)
    return np.array(verts, dtype=np.float64), faces, groups


def load_target(path, n):
    """A MakeHuman .target file: lines 'index dx dy dz' added to the base mesh."""
    d = np.zeros((n, 3))
    with open(path) as fh:
        for line in fh:
            if line.startswith('#') or not line.strip():
                continue
            p = line.split()
            d[int(p[0])] = [float(p[1]), float(p[2]), float(p[3])]
    return d


def edge_table(quads):
    """Unique undirected edges of a quad mesh plus, per face corner, the edge index of (v[i], v[i+1])."""
    a = quads.reshape(-1)
    b = np.roll(quads, -1, axis=1).reshape(-1)
    key = np.minimum(a, b).astype(np.int64) * (1 << 32) + np.maximum(a, b)
    uniq, inv = np.unique(key, return_inverse=True)
    edges = np.stack([uniq >> 32, uniq & 0xFFFFFFFF], 1).astype(np.int64)
    return edges, inv.reshape(quads.shape)


def catmull_clark(P, quads, attrs=None):
    """One Catmull-Clark step on a quad mesh with open boundaries (boundary = crease).
    attrs (n,k) are interpolated with the same rule as positions.
    Returns (P, quads, attrs); new vertex order = old verts, face points, edge points."""
    n = len(P)
    nf = len(quads)
    X = P if attrs is None else np.hstack([P, attrs])
    edges, fe = edge_table(quads)
    ne = len(edges)
    # faces per edge
    ecount = np.bincount(fe.reshape(-1), minlength=ne)
    fp = X[quads].mean(1)
    esum_f = np.zeros((ne, X.shape[1]))
    np.add.at(esum_f, fe.reshape(-1), np.repeat(fp, 4, axis=0))
    mid = (X[edges[:, 0]] + X[edges[:, 1]]) * 0.5
    boundary_e = ecount == 1
    ep = np.where(boundary_e[:, None], mid, (mid * 2 + esum_f) / 4)
    # vertex points
    valence_f = np.bincount(quads.reshape(-1), minlength=n).astype(float)
    Q = np.zeros_like(X)
    np.add.at(Q, quads.reshape(-1), np.repeat(fp, 4, axis=0))
    R = np.zeros_like(X)
    valence_e = np.zeros(n)
    for c in (0, 1):
        np.add.at(R, edges[:, c], mid)
        np.add.at(valence_e, edges[:, c], 1)
    bnd_v = np.zeros(n, bool)
    bnd_v[edges[boundary_e].reshape(-1)] = True
    Rb = np.zeros_like(X)
    for c in (0, 1):
        np.add.at(Rb, edges[boundary_e, c], X[edges[boundary_e, 1 - c]])
    with np.errstate(invalid='ignore', divide='ignore'):
        k = valence_f[:, None]
        interior = (Q / k + 2 * R / valence_e[:, None] + (k - 3) * X) / k
        bpts = 0.75 * X + 0.125 * Rb
    VP = np.where(bnd_v[:, None], bpts, interior)
    VP = np.where((valence_f == 0)[:, None], X, VP)
    NX = np.vstack([VP, fp, ep])
    fidx = n + np.arange(nf)
    eidx = n + nf + fe
    q = np.empty((nf * 4, 4), dtype=np.int64)
    for i in range(4):
        q[i::4, 0] = quads[:, i]
        q[i::4, 1] = eidx[:, i]
        q[i::4, 2] = fidx
        q[i::4, 3] = eidx[:, (i - 1) % 4]
    if attrs is None:
        return NX, q, None
    return NX[:, :3], q, NX[:, 3:]


def subdivide(P, quads, levels, attrs=None):
    for _ in range(levels):
        P, quads, attrs = catmull_clark(P, quads, attrs)
    return P, quads, attrs


def quad_tris(quads):
    return np.concatenate([quads[:, [0, 1, 2]], quads[:, [0, 2, 3]]])


def vertex_normals(P, tris):
    n = np.zeros_like(P)
    fn = np.cross(P[tris[:, 1]] - P[tris[:, 0]], P[tris[:, 2]] - P[tris[:, 0]])
    for c in range(3):
        np.add.at(n, tris[:, c], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def write_preview(path, P, tris, col=None):
    """Binary for the node preview rasterizer: nv, nt, pos f32, col f32, tri u32."""
    col = np.ones(len(P)) if col is None else col
    with open(path, 'wb') as fh:
        fh.write(np.array([len(P), len(tris)], np.uint32).tobytes())
        fh.write(P.astype(np.float32).tobytes())
        fh.write(np.asarray(col, np.float32).tobytes())
        fh.write(tris.astype(np.uint32).tobytes())


def write_obj(path, P, faces):
    with open(path, 'w') as fh:
        for p in P:
            fh.write('v %.5f %.5f %.5f\n' % tuple(p))
        for f in faces:
            fh.write('f ' + ' '.join(str(i + 1) for i in f) + '\n')
