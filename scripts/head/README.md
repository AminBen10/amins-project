# Practice head pipeline

Offline build of `src/three/headAsset.js`, the cage of the practice head the site subdivides at
runtime. Source data: the MakeHuman 1.x base mesh (hm08) and targets, CC0 1.0
(github.com/makehumancommunity/makehuman, `LICENSE.md` section C). No npm dependencies.

```
git clone --filter=blob:none --sparse https://github.com/makehumancommunity/makehuman mh
(cd mh && git sparse-checkout set makehuman/data/3dobjs makehuman/data/targets)
python3 scripts/head/build_head.py --mh mh/makehuman/data [--preview <dir>]
```

Needs Python 3 with numpy and scipy (`cKDTree`). About 50 s on 4 cores, deterministic.
`--preview` also writes the level-2 OBJ, AO/mask preview meshes and `meta.json`.

## Steps

1. `sculpt.py`: the neutral man. Macro targets as MakeHuman computes them (male, 30 years,
   average muscle and weight, 1/3 African + 1/3 Asian + 1/3 Caucasian) plus a few generic detail
   sliders (jaw, chin, cheekbones, neck) for a firmer plaster read. Head + neck and the two eye
   helper spheres (the sculpted eyeballs) are cropped and moved into the head-local frame:
   Y up, face +Z, crown y 1.10, menton y -1.00, cranium centred at z -0.07 (the frame of the
   retired SDF head, so scene, camera and tools keep their numbers). The neck is eased into a
   slightly flared ellipse below `bounds.neck` (hidden by the cape) and cut flat at y -1.55.
2. `anatomy.py`: points measured on the level-2 Catmull-Clark surface: ear extremes (from the
   ear targets), nasion, glabella, nose tip, lips, stomion, chin, throat, Adam's apple.
3. `masks.py`: hair and beard growth zones drawn from that anatomy (hairline with slightly
   matured temples, sideburns to mid-tragus hugging the ear, nape line; full beard with cheek
   line, moustache, chin and a neckline down to the Adam's apple). Stored as signed surface
   distances in head units (+ inside), so the runtime can feather or cut any edge.
4. `bake.py`: AO (64 cosine rays, sphere-traced against a dense level-4 sampling), cavity and
   thickness, per cage vertex. A soft line is added along the lip slit.
5. `build_head.py`: landmarks (S7: MM, DEDO_MM, NUCA, OREJA, SIEN, ESQUINA, CORONILLA, PATILLA,
   FLEQUILLO, NUEZ, with the strict ordering check), anchors, bounds, a radius grid for
   `hairField.surfaceAt`, then `encode.py` packs everything.

## Asset layout

`HEAD_META` (JSON: MM, DEDO_MM, LANDMARKS, ANCHORS, bounds, eyes, measured points, encoding) and
`HEAD_CAGE` (base64 of raw-deflated binary, see the docstring of `encode.py`): 12-bit delta
positions, varint quad indices, six byte planes per vertex (ao, cavity, thickness, edgeH, edgeB,
part) and the radius grid. `src/three/headWorker.js` decodes it, runs Catmull-Clark (2 levels on
the high tier, 1 on low) and interpolates the attributes with the same rule.
