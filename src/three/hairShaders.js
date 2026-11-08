// GLSL for the fur-shell hair (hair.js) and the shaved-skin tint on the plaster head (head.js).
//
// Strands are 3D Worley points in the head's rest space: one jittered point per cell, kept when it
// lies in a thin slab around the scalp, so the roots are evenly spread on the surface with no
// parameterisation, no lattice and no seam at the nape. Every shell looks its strands up at the
// ROOT (the undisplaced vertex), so a strand slants continuously as the shells slide along the comb.

export const NOISE_GLSL = /* glsl */ `
  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }

  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash33(i).x, hash33(i + vec3(1, 0, 0)).x, u.x),
                   mix(hash33(i + vec3(0, 1, 0)).x, hash33(i + vec3(1, 1, 0)).x, u.x), u.y),
               mix(mix(hash33(i + vec3(0, 0, 1)).x, hash33(i + vec3(1, 0, 1)).x, u.x),
                   mix(hash33(i + vec3(0, 1, 1)).x, hash33(i + vec3(1, 1, 1)).x, u.x), u.y), u.z);
  }

  // Root points near the surface at cell coords c (n = surface normal). Only points within
  // |dn| < SLAB of the surface count, and every footprint stays inside |dv| < 0.5, so the
  // 2x2x2 search always finds them (no cut discs along cell planes). Surface density is
  // 2*SLAB = 0.7 roots per cell^2. Returns the strand coverage; rid = that strand's randoms.
  #define SLAB 0.35
  float rootField(vec3 c, vec3 n, vec3 dir, float elong, float r0, float hf, float ragged,
                  float lenK, float edgeT, float aa, float taper, out vec3 rid) {
    vec3 b = floor(c - 0.5);
    float best = 0.0;
    rid = vec3(0.5);
    for (int k = 0; k < 8; k++) {
      vec3 cell = b + vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
      vec3 h = hash33(cell);
      vec3 dv = c - cell - h;
      float dn = dot(dv, n);
      if (abs(dn) > SLAB) continue;
      vec3 rn = hash33(h * 97.31 + cell.zxy);
      // hairline: strands drop out one by one towards the edge, and get shorter and finer
      if (rn.x * 0.9 >= edgeT) continue;
      float sLen = mix(1.0 - ragged, 1.0, rn.y) * lenK;
      float t = 1.0 - hf / sLen;
      if (t <= 0.0) continue;
      vec3 dt = dv - n * dn;
      float a = dot(dt, dir);
      float perp2 = max(dot(dt, dt) - a * a, 0.0);
      float ax = max(abs(a) - elong, 0.0);
      float d = sqrt(perp2 + ax * ax);
      float r = r0 * pow(t, taper);
      float cov = 1.0 - smoothstep(r - aa, r + aa, d);
      if (cov > best) { best = cov; rid = rn; }
    }
    return best;
  }
`;

// ------------------------------------------------------------ shell vertex
export const HAIR_VERT = /* glsl */ `
  attribute float aLayer;
  attribute vec4 aFrom;      // state before the step: length, lift, foam, line-up
  attribute vec4 aTo;        // state after the step
  attribute float aSweep;    // where the tool front reaches this vertex (0..1)
  attribute vec3 aCombFrom;  // comb direction, tangent to the scalp
  attribute vec3 aCombTo;
  attribute vec2 aEdge;      // signed edge distance (hair, beard), + inside
  attribute vec2 aMask;
  attribute vec4 aClump;     // xyz: rest-space offset to the lock centre, w: lock random
  attribute float aTop;      // 0 sides/beard .. 1 top of the head
  attribute vec3 aZoneL;     // legacy looks: tool ownership and per-tool sweep
  attribute vec3 aSweepL;

  uniform vec3 uProg;
  uniform float uWidth;
  uniform float uLegacy;
  uniform float uFront;
  uniform float uStepW;
  uniform float uFoamIn;
  uniform vec4 uLift;        // xyz centre (head-local), w radius
  uniform vec3 uLiftDir;
  uniform float uLiftAmt;
  uniform vec4 uContact;     // xyz centre, w radius (0 = off)
  uniform float uGrow;
  uniform float uBend;
  uniform float uCurv;
  uniform float uLayers;

  varying vec3 vRest;
  varying vec3 vNrm;
  varying vec3 vComb;
  varying vec4 vClump;
  varying vec3 vNormalW;
  varying vec3 vFibreW;
  varying vec3 vPosW;
  varying vec2 vEdge;
  varying vec2 vMask;
  varying float vLen;
  varying float vThick;
  varying float vF;
  varying float vStep;
  varying float vLift;
  varying float vFoam;
  varying float vLine;

  void main() {
    float t;
    if (uLegacy > 0.5) {
      vec3 tz = clamp((uProg * (1.0 + uWidth) - aSweepL) / uWidth, 0.0, 1.0);
      t = dot(aZoneL, tz);
    } else {
      // the tool front: vertices behind it are cut, a narrow band is being cut
      t = clamp((uFront - aSweep) / uStepW + 0.5, 0.0, 1.0);
    }
    vec4 L = mix(aFrom * vec4(1.0, 1.0, uFoamIn, 1.0), aTo, t);
    float len = L.x * uGrow;
    float lift = L.y;
    vFoam = L.z;
    vLine = L.w;

    // comb: shortest arc around the normal between the two looks (never a lerp of
    // opposed vectors, which collapses to zero and flips)
    vec3 a = aCombFrom;
    float ang = atan(dot(cross(a, aCombTo), normal), dot(a, aCombTo)) * t;
    vec3 comb = a * cos(ang) + cross(normal, a) * sin(ang);

    // the cutting comb lifts a section: it stands up towards the comb
    if (uLiftAmt > 0.0 && uLift.w > 0.0) {
      float fl = uLiftAmt * (1.0 - smoothstep(0.55 * uLift.w, uLift.w, distance(position, uLift.xyz)));
      vec3 ld = uLiftDir - normal * dot(uLiftDir, normal);
      if (dot(ld, ld) > 1e-6) comb = normalize(mix(comb, normalize(ld), 0.6 * fl));
      lift = max(lift, fl);
    }

    float f = aLayer;
    float bend = uBend * mix(0.8, 1.0, aTop);
    // volume is decoupled from length: long hair lies down along the comb and follows
    // the curve of the skull (lie); lift turns gravity into volume
    float thick = min(len, 0.016 + 0.24 * len) * (1.0 + 1.4 * lift);
    // a guard or comb resting on the hair presses it down
    if (uContact.w > 0.0) thick *= 1.0 - 0.6 * (1.0 - smoothstep(0.6 * uContact.w, uContact.w, distance(position, uContact.xyz)));
    float s = len * bend * f * f;
    float ds = 2.0 * len * bend * f;
    float lie = uCurv * (1.0 - lift);
    float h = 0.001 + thick * f - 0.5 * lie * s * s;
    vec3 g = vec3(0.0, -1.0, 0.0);
    g -= normal * min(dot(g, normal), 0.0);
    float gk = len * 0.15 * (1.0 - lift);
    vec3 p = position + normal * h + comb * s + g * (gk * f * f * f);
    vec3 dp = normal * (thick - lie * s * ds) + comb * ds + g * (gk * 3.0 * f * f);

    vRest = position;
    vNrm = normal;
    vComb = comb;
    vClump = aClump;
    vEdge = aEdge;
    vMask = aMask;
    vLen = len;
    vThick = thick;
    vF = f;
    vStep = ds / max(uLayers, 1.0);
    vLift = lift;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vPosW = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vFibreW = mat3(modelMatrix) * normalize(dp + comb * 0.35);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

// ---------------------------------------------------------- shell fragment
export const HAIR_FRAG = /* glsl */ `
  uniform vec3 uRoot;
  uniform vec3 uTip;
  uniform vec3 uBeard;
  uniform vec3 uKeyDir;
  uniform vec3 uKeyCol;
  uniform vec3 uFillDir;
  uniform vec3 uFillCol;
  uniform vec3 uAmb;
  uniform float uDensity;
  uniform float uClump;
  uniform float uRagged;
  uniform float uGrey;
  uniform float uShine;
  uniform float uBShine;

  varying vec3 vRest;
  varying vec3 vNrm;
  varying vec3 vComb;
  varying vec4 vClump;
  varying vec3 vNormalW;
  varying vec3 vFibreW;
  varying vec3 vPosW;
  varying vec2 vEdge;
  varying vec2 vMask;
  varying float vLen;
  varying float vThick;
  varying float vF;
  varying float vStep;
  varying float vLift;
  varying float vFoam;
  varying float vLine;

  ${NOISE_GLSL}

  // sin(T, H)^e: the fibre highlight; shift tilts the tangent along the normal (cuticle scales)
  float lobe(vec3 T, vec3 N, vec3 H, float shift, float e) {
    float th = dot(normalize(T + N * shift), H);
    return pow(max(1.0 - th * th, 0.0), 0.5 * e);
  }

  void main() {
    // derivatives first, outside any branch
    float aaB = max(fwidth(vEdge.y), 1e-5);
    float aaH = max(fwidth(vEdge.x), 1e-5);
    vec3 c = vRest * uDensity;
    float px = length(fwidth(c));
    vec3 Tw = normalize(vFibreW);
    float tv = length(fwidth(Tw));
    if (vLen < 0.016) discard;

    float hf = vF;
    vec3 n = normalize(vNrm);
    float beardW = smoothstep(0.35, 0.65, vMask.y / max(vMask.x + vMask.y, 1e-3));
    // natural hairline: feathered over ~1 cm, an untrimmed beard over a few mm; once lined up
    // (trimmer, razor: vLine) both are one crisp edge
    float featherH = smoothstep(0.0, 0.10, vEdge.x + 0.014 * (vnoise(vRest * 26.0) - 0.5));
    float featherB = smoothstep(0.0, 0.035, vEdge.y + 0.01 * (vnoise(vRest * 31.0) - 0.5));
    float edgeT = mix(mix(featherH, 1.0, vLine), mix(featherB, 1.0, vLine), beardW);
    float razor = mix(mix(1.0, smoothstep(-aaH, aaH, vEdge.x), vLine), mix(1.0, smoothstep(-aaB, aaB, vEdge.y), vLine), beardW);
    // very short hair is painted on the skin (head.js); the shells take over from ~2 mm
    float shortK = smoothstep(0.016, 0.04, vLen);

    // locks: the lookup moves away from the lock centre with height, so the strands
    // gather towards it at the tips (longer hair only)
    float k = uClump * smoothstep(0.04, 0.14, vLen) * hf;
    vec3 q = vRest - vClump.xyz * (k * 0.35);
    c = q * uDensity;

    vec3 dir = normalize(vComb);
    float stepC = vStep * uDensity;                // slide between shells, in cells
    float elong = clamp(stepC * 0.5, 0.0, 0.24);
    float aa = clamp(px * 0.6, 1e-3, 0.08);
    float r0 = min(0.2, 0.357 - elong - aa);
    r0 *= mix(0.45, 1.0, edgeT);
    float lenK = mix(0.5, 1.0, edgeT);

    // LOD: single strands, then bundles of ~9 strands (same coverage, a third of the
    // frequency), then the analytic average. A level fades out when its discs get smaller
    // than a pixel, or when consecutive shells would draw a lying strand as dots.
    // groomed (longer) hair keeps its width to the tip; short hair tapers to a point
    float groomed = smoothstep(0.06, 0.2, vLen);
    float taper = mix(0.4, 0.12, groomed);
    float lod0 = max(smoothstep(0.55, 0.95, px), smoothstep(0.35, 0.8, stepC));
    float lod1 = max(smoothstep(0.55, 0.95, px / 3.0), smoothstep(0.35, 0.8, stepC / 3.0));
    float lod = lod0;
    vec3 rid = vec3(0.5), rid1 = vec3(0.5);
    float a0 = 0.0, a1 = 0.0, cover = 0.0;
    if (lod0 < 0.999) a0 = rootField(c, n, dir, elong, r0, hf, uRagged, lenK, edgeT, aa, taper, rid);
    if (lod0 > 0.001 && lod1 < 0.999) {
      float el1 = clamp(stepC / 6.0, 0.0, 0.24);
      float aa1 = clamp(px * 0.2, 1e-3, 0.08);
      float r1 = min(0.2, 0.357 - el1 - aa1) * mix(0.45, 1.0, edgeT);
      a1 = rootField(c / 3.0 + 7.31, n, dir, el1, r1, hf, uRagged, lenK, edgeT, aa1, taper, rid1);
    }
    if (lod1 > 0.001) {
      float tm = max(1.0 - hf / ((1.0 - 0.5 * uRagged) * lenK), 0.0);
      float rm = 0.2 * mix(0.45, 1.0, edgeT) * pow(tm, taper);
      cover = 0.7 * 3.14159 * rm * rm * 1.6 * clamp(edgeT / 0.9, 0.0, 1.0);
      // a sheet seen from afar: streaks along the comb carry the texture
      vec3 sq = q * uDensity * 0.3;
      sq -= dir * dot(sq, dir) * 0.86;
      cover *= 0.3 + 1.4 * vnoise(sq + vClump.w * 13.0);
      cover = min(cover, 0.95);
    }
    float strand = mix(a0, mix(a1, cover, lod1), lod0);
    rid = lod0 < 0.5 ? rid : rid1;
    // long hair is a dense mass: its lower shells are nearly opaque, so lifted hair keeps
    // its volume in silhouette
    float mass = groomed * (1.0 - 0.6 * hf);
    float alpha = min(strand * (1.0 + 3.0 * mass), 1.0) * razor * shortK;
    // under lather the strands are hidden (the skin shader draws the foam)
    alpha *= 1.0 - smoothstep(0.2, 0.5, vFoam);

    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPosW);
    float nv = abs(dot(N, V));
    // only the outermost tips thin out at the outline: clean silhouette, no fuzzy halo
    alpha *= mix(1.0, smoothstep(0.04, 0.25, nv), smoothstep(0.6, 1.0, hf));
    if (alpha < 0.02) discard;

    // ---- shading: wrapped Kajiya diffuse, neutral R lobe, warm TRT lobe, self-shadow
    #ifdef HAIR_LOW
      float eR0 = 120.0;
    #else
      float eR0 = 220.0;
    #endif
    // exponents widen where the fibre direction changes within a pixel (no sparkle crawl)
    float eR = eR0 / (1.0 + eR0 * tv * tv);
    float eT = 40.0 / (1.0 + 40.0 * tv * tv);
    float nR = sqrt(eR / eR0), nT = sqrt(eT / 40.0);

    vec3 rnd = mix(rid, vec3(fract(vClump.w * 7.13), fract(vClump.w * 3.71), fract(vClump.w * 5.37)), lod1);
    vec3 lockR = vec3(fract(vClump.w * 11.7), fract(vClump.w * 17.3), fract(vClump.w * 23.9));
    vec3 T = normalize(Tw + (rnd.zxy - 0.5) * 0.12 + (lockR - 0.5) * 0.18 * k);

    vec3 root = mix(uRoot, uBeard, beardW);
    vec3 tip = mix(uTip, uBeard * 1.15, beardW);
    float hue = 0.03 * (rnd.y * 2.0 - 1.0);
    float val = 1.0 + 0.1 * (rnd.z * 2.0 - 1.0) + 0.12 * (lockR.x - 0.5) * smoothstep(0.0, 0.3, k);
    vec3 albedo = mix(root, tip, hf) * val * vec3(1.0 + hue, 1.0, 1.0 - hue);
    // a few white strands in a full beard
    if (beardW > 0.5 && rnd.x > 1.0 - uGrey) albedo = mix(albedo, vec3(0.32, 0.30, 0.28), 0.7 * (1.0 - lod1));

    // light reaches into a thin coat, not into a thick one
    float depth = clamp(vThick / 0.035, 0.25, 1.0) * mix(0.35, 1.0, edgeT);
    float shadow = exp(-(1.0 - hf) * 2.0 * depth);

    float sparkle = 1.0;
    #ifndef HAIR_LOW
      sparkle = mix(0.6, 1.0, rnd.z);
    #endif

    vec3 col = albedo * uAmb * mix(0.4, 1.0, hf);
    for (int i = 0; i < 2; i++) {
      vec3 Ld = i == 0 ? uKeyDir : uFillDir;
      vec3 lc = i == 0 ? uKeyCol : uFillCol;
      float nl = dot(N, Ld);
      float wrap = clamp((nl + 0.3) / 1.3, 0.0, 1.0);
      float tl = dot(T, Ld);
      float kaj = sqrt(max(1.0 - tl * tl, 0.0));
      vec3 H = normalize(Ld + V);
      float vis = smoothstep(-0.15, 0.25, nl);
      // R: white, untinted (a cool key never turns dark hair blue: it uses the light's luminance)
      float lum = dot(lc, vec3(0.2126, 0.7152, 0.0722));
      // pomade / oil: a stronger, slightly tighter fibre highlight
      float shine = mix(uShine, uBShine, beardW);
      vec3 spec = vec3(1.0, 0.98, 0.95) * lum * lobe(T, N, H, 0.07, eR * (1.0 + shine)) * 0.12 * nR * (1.0 + 2.2 * shine);
      #ifndef HAIR_LOW
        // TRT: the light comes back through the fibre, tinted by it (kept close to neutral)
        vec3 tint = mix(vec3(1.0), albedo / max(dot(albedo, vec3(0.333)), 1e-3), 0.3);
        spec += lc * tint * dot(albedo, vec3(0.333)) * 1.6 * lobe(T, N, H, -0.12, eT) * 0.4 * nT * sparkle;
      #endif
      col += lc * albedo * kaj * wrap * shadow + spec * vis * mix(0.35, 1.0, shadow) * shortK;
    }
    gl_FragColor = vec4(min(col, vec3(1.0)), alpha);
  }
`;

// ------------------------------------------------------- shaved skin (head)
// Hair shorter than the shells (0..~4 mm) is painted on the plaster: a soft shadow that
// deepens with length, a follicle stipple prefiltered by its pixel footprint (never black dots),
// and under denser hair the scalp takes the hair's root colour.
export const SHAVED_GLSL = /* glsl */ `
  ${NOISE_GLSL.replace(/hash33/g, 'hash33s').replace(/vnoise/g, 'vnoiseS').replace(/rootField/g, 'rootFieldS').replace('#define SLAB 0.35', '#define SLAB_S 0.35').replace(/SLAB\b/g, 'SLAB_S')}

  // follicles: Worley points like the strands, density 160 / unit, radius 0.12 cell
  float follicles(vec3 rest, vec3 n, out float px) {
    vec3 c = rest * 160.0;
    px = length(fwidth(c));
    vec3 b = floor(c - 0.5);
    float best = 0.0;
    float aa = max(px * 0.7, 1e-3);
    for (int k = 0; k < 8; k++) {
      vec3 cell = b + vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
      vec3 h = hash33s(cell);
      vec3 dv = c - cell - h;
      float dn = dot(dv, n);
      if (abs(dn) > 0.35) continue;
      float d = length(dv - n * dn);
      best = max(best, 1.0 - smoothstep(0.12 - aa, 0.12 + aa, d));
    }
    // analytic mean (0.7 * pi * r^2) once a follicle is smaller than half a pixel
    return mix(best, 0.032, smoothstep(0.25, 0.5, px));
  }

  // skin: plaster albedo; len: hair length (head units); mask: zone masks; cut: signed edges
  // (hair, beard; + inside); root: hair root colour (linear); mm: head units per millimetre;
  // line: 0 natural hairline, 1 lined up (trimmer / razor)
  vec3 shavedSkin(vec3 skin, vec3 rest, vec3 n, float len, vec2 mask, vec2 cut, vec3 root, float mm, float line) {
    float aa = max(fwidth(cut.y), 1e-5);
    float aaH = max(fwidth(cut.x), 1e-5);
    if (max(mask.x, mask.y) < 0.001 || len < 0.02 * mm) return skin;
    float beardW = smoothstep(0.35, 0.65, mask.y / max(mask.x + mask.y, 1e-3));
    // natural hairline: soft and irregular; lined up: one crisp edge; beard lines: razor crisp
    float zh = mix(smoothstep(-0.004, 0.05, cut.x + 0.014 * (vnoiseS(rest * 26.0) - 0.5)), smoothstep(-aaH, aaH, cut.x), line);
    // stubble has no line: the razor edge only appears once there is a beard to line up
    float zb = mix(smoothstep(-0.008, 0.045, cut.y + 0.014 * (vnoiseS(rest * 23.0) - 0.5)),
                   smoothstep(-aa, aa, cut.y), smoothstep(1.6 * mm, 3.0 * mm, len));
    float zone = mix(zh, zb, beardW);
    // how much of the skin the hair hides: ~1/3 at 1 mm, ~2/3 at 3 mm, almost all from 6 mm
    float d = (1.0 - exp(-len / (2.2 * mm))) * zone;
    // the pile is never perfectly even: a soft mottling a few mm across
    d *= 0.82 + 0.36 * vnoiseS(rest * 85.0);
    // a shaved pile shows its colour; under longer hair the scalp is in the hair's shadow
    vec3 col = mix(skin, root * mix(1.25, 0.6, smoothstep(2.0 * mm, 6.0 * mm, len)), d * 0.94);
    float px;
    float fol = follicles(rest, n, px) * smoothstep(0.05 * mm, 0.8 * mm, len) * zone * (1.0 - d);
    return mix(col, mix(col, root, 0.5), fol);
  }
`;
