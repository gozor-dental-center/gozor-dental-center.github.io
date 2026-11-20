// Copied from ../jozour-website/assets/tooth3d.js; toothShell() here also takes a custom SDF (for the damaged teeth).
// The logo as a real 3D object:
//  - toothShell(): a hollow molar (crown with four cusps, neck, two roots) as a signed distance field,
//    polygonised with marching cubes into one smooth closed surface.
//  - growBranches(): a 3D tree grown by space colonisation inside that same volume, from a seed under the
//    crown down to the root tips, then skinned into tapered tubes (pipe-model radii).
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/+esm";
import { MarchingCubes } from "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/objects/MarchingCubes.js/+esm";

// ---------- signed distance field of the molar (world units, y up, ~3.9 tall) ----------
// Math.hypot is several times slower than a plain sqrt, and this runs millions of times.
const len3 = (x, y, z = 0) => Math.sqrt(x * x + y * y + z * z);
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);
function roundBox(x, y, z, bx, by, bz, r) {
  const qx = Math.abs(x) - bx + r, qy = Math.abs(y) - by + r, qz = Math.abs(z) - bz + r;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return len3(ox, oy, oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
}
const sphere = (x, y, z, r) => len3(x, y, z) - r;
// Tapered capsule from a (radius ra) to b (radius rb).
function cone(x, y, z, ax, ay, az, bx, by, bz, ra, rb) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / (dx * dx + dy * dy + dz * dz)));
  return len3(x - ax - dx * t, y - ay - dy * t, z - az - dz * t) - (ra + (rb - ra) * t);
}

export function toothSDF(x, y, z) {
  // Crown: a rounded block with four cusps and a central fossa.
  let d = roundBox(x, y - 0.8, z, 0.66, 0.36, 0.54, 0.3);
  for (const [cx, cz] of [[-0.36, -0.27], [0.36, -0.27], [-0.36, 0.27], [0.36, 0.27]]) d = smin(d, sphere(x - cx, y - 1.12, z - cz, 0.32), 0.22);
  d = smax(d, -sphere(x, y - 1.6, z, 0.3), 0.18);
  // Neck: narrower than the crown.
  d = smin(d, roundBox(x, y - 0.2, z, 0.5, 0.32, 0.42, 0.2), 0.3);
  // Two roots, flattened front-to-back like real molar roots. Each follows one smooth curve (no kink),
  // built from short tapered pieces blended together.
  const rz = z * 0.72;
  for (const s of [-1, 1]) {
    let r = Infinity;
    for (let i = 0; i < ROOT.length - 1; i++) {
      const [x0, y0, r0] = ROOT[i], [x1, y1, r1] = ROOT[i + 1];
      r = smin(r, cone(x, y, rz, s * x0, y0, 0, s * x1, y1, 0, r0, r1), 0.13);
    }
    d = smin(d, r, 0.22);
  }
  return d;
}

// Root centre line: a quadratic Bézier from the neck, bowing gently outwards, to the tip.
// Radius tapers slowly at first and faster near the tip.
export const ROOT_CURVE = { p0: [0.36, 0.05], p1: [0.55, -0.68], p2: [0.4, -1.48] };
const ROOT = Array.from({ length: 11 }, (_, i) => {
  const t = i / 10, u = 1 - t, { p0, p1, p2 } = ROOT_CURVE;
  return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1], 0.06 + 0.28 * Math.pow(u, 0.8)];
});
export const TOOTH_BOTTOM = -1.55;

function* shellSteps({ resolution = 104, sdf = toothSDF } = {}) {
  const C = new THREE.Vector3(0, 0, 0), S = 1.8; // grid cube = C ± S
  const mc = new MarchingCubes(resolution, new THREE.MeshBasicMaterial(), false, false, 260000);
  mc.isolation = 0;
  const n = mc.size, half = mc.halfsize;
  for (let k = 0; k < n; k++, yield) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = C.x + ((i - half) / half) * S, y = C.y + ((j - half) / half) * S, z = C.z + ((k - half) / half) * S;
    // Points far outside the tooth skip the SDF; they only need to read as "outside".
    mc.field[i + j * n + k * n * n] = Math.abs(x) > 1.3 || Math.abs(z) > 1.15 ? -0.2 : -sdf(x, y, z); // inside > 0
  }
  mc.update();
  // Copy the used part of the buffers into a plain, static geometry in world units.
  const count = mc.count;
  const src = mc.geometry;
  const pos = src.getAttribute("position").array.slice(0, count * 3);
  const nor = src.getAttribute("normal").array.slice(0, count * 3);
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] = C.x + pos[i] * S; pos[i + 1] = C.y + pos[i + 1] * S; pos[i + 2] = C.z + pos[i + 2] * S;
  }
  mc.geometry.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.computeBoundingSphere();
  return g;
}

// Hand the page back for a moment. A message channel is used instead of setTimeout(0),
// which browsers stretch to 4 ms or more (and to seconds in background tabs).
const chan = new MessageChannel(), waiting = [];
chan.port1.onmessage = () => waiting.shift()?.();
export const pause = () => new Promise((r) => { waiting.push(r); chan.port2.postMessage(0); });

// Sync: runs in one go. Async: same work, but hands the page back every few milliseconds,
// so scrolling stays smooth while the teeth are built.
export function toothShell(opts) {
  const it = shellSteps(opts);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}
export async function toothShellAsync(opts, budget = 8) {
  const it = shellSteps(opts);
  let t = performance.now(), r = it.next();
  while (!r.done) {
    if (performance.now() - t > budget) { await pause(); t = performance.now(); }
    r = it.next();
  }
  return r.value;
}

// ---------- branches by space colonisation ----------
// Seeded random so the tree is the same on every load.
function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Main limbs, as in the logo: one down the middle of each root, one up each crown wall behind the word.
const LIMBS = [
  ...[-1, 1].map((s) => [[s * 0.2, 0.0, 0], ...[0.25, 0.5, 0.75, 0.93].map((t) => {
    const u = 1 - t, { p0, p1, p2 } = ROOT_CURVE; // same curve as the root itself
    return [s * (u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0]), u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1], 0];
  })]),
  ...[-1, 1].map((s) => [[s * 0.3, 0.32, -0.22], [s * 0.5, 0.62, -0.28], [s * 0.52, 1.0, -0.26], [s * 0.42, 1.2, -0.22]]),
];

/**
 * @param {object} o
 * @param {(x:number,y:number,z:number)=>boolean} o.keepOut  attractor exclusion (e.g. the word's space)
 */
export function growBranches({ attractors = 2100, seed = 7, keepOut = () => false, limbs = LIMBS } = {}) {
  const rand = rng(seed);
  const SEG = 0.04, INFLUENCE = 0.4, KILL = 0.08, WALL = 0.07;

  // Attractors: random points well inside the tooth, denser in the roots.
  const ax = [], ay = [], az = [];
  while (ax.length < attractors) {
    const x = (rand() * 2 - 1) * 1.15, y = -2.0 + rand() * 3.6, z = (rand() * 2 - 1) * 0.95;
    if (toothSDF(x, y, z) > -WALL || keepOut(x, y, z)) continue;
    if (y > 0.3 && rand() < 0.35) continue; // thin out the crown a little so the word breathes
    ax.push(x); ay.push(y); az.push(z);
  }
  const alive = new Uint8Array(ax.length).fill(1);

  // Nodes, with a coarse spatial hash for nearest-node queries.
  const px = [0], py = [0.22], pz = [-0.05], parent = [-1];
  const grid = new Map();
  const cell = (v) => Math.floor(v / INFLUENCE);
  const key = (i, j, k) => (i + 64) * 16384 + (j + 64) * 128 + (k + 64);
  const insert = (n) => {
    const kk = key(cell(px[n]), cell(py[n]), cell(pz[n]));
    let b = grid.get(kk); if (!b) grid.set(kk, (b = [])); b.push(n);
  };
  insert(0);

  // Lay down the main limbs first; twigs then grow off them by colonisation.
  for (const pts of limbs) {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(px[0], py[0], pz[0]), ...pts.map((p) => new THREE.Vector3(...p))]);
    const steps = Math.ceil(curve.getLength() / SEG);
    let prev = 0;
    for (let s = 1; s <= steps; s++) {
      const p = curve.getPointAt(s / steps);
      px.push(p.x); py.push(p.y); pz.push(p.z); parent.push(prev);
      prev = px.length - 1;
      insert(prev);
    }
  }

  for (let iter = 0; iter < 260; iter++) {
    const dir = new Map();
    let any = false;
    for (let a = 0; a < ax.length; a++) {
      if (!alive[a]) continue;
      const ci = cell(ax[a]), cj = cell(ay[a]), ck = cell(az[a]);
      let best = -1, bd = INFLUENCE;
      for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) for (let k = ck - 1; k <= ck + 1; k++) {
        const b = grid.get(key(i, j, k)); if (!b) continue;
        for (const n of b) {
          const d = len3(ax[a] - px[n], ay[a] - py[n], az[a] - pz[n]);
          if (d < bd) { bd = d; best = n; }
        }
      }
      if (best < 0) continue;
      if (bd < KILL) { alive[a] = 0; continue; }
      let v = dir.get(best); if (!v) dir.set(best, (v = [0, 0, 0]));
      v[0] += (ax[a] - px[best]) / bd; v[1] += (ay[a] - py[best]) / bd; v[2] += (az[a] - pz[best]) / bd;
    }
    for (const [n, v] of dir) {
      const len = len3(v[0], v[1], v[2]);
      if (len < 1e-3) continue;
      const jx = (rand() - 0.5) * 0.25, jy = (rand() - 0.5) * 0.25, jz = (rand() - 0.5) * 0.25;
      // Below the crown, a pull towards the root tips turns the tangle into long flowing limbs.
      // In the crown, a slight lift so twigs climb the walls.
      const bias = py[n] < 0.1 ? -0.45 : py[n] > 0.35 ? 0.25 : 0;
      let dx = v[0] / len + jx, dy = v[1] / len + jy + bias, dz = v[2] / len + jz;
      const l2 = len3(dx, dy, dz); dx /= l2; dy /= l2; dz /= l2;
      const x = px[n] + dx * SEG, y = py[n] + dy * SEG, z = pz[n] + dz * SEG;
      if (toothSDF(x, y, z) > -0.035 || keepOut(x, y, z)) continue; // never pierce the shell or the word
      px.push(x); py.push(y); pz.push(z); parent.push(n);
      insert(px.length - 1);
      any = true;
    }
    if (!any) break;
  }

  const N = px.length;
  const kids = Array.from({ length: N }, () => []);
  for (let i = 1; i < N; i++) kids[parent[i]].push(i);

  // Relax single-child chains so the branches curve instead of zig-zagging.
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < N; i++) {
      if (kids[i].length !== 1) continue;
      const p = parent[i], c = kids[i][0];
      px[i] = (px[p] + 2 * px[i] + px[c]) / 4; py[i] = (py[p] + 2 * py[i] + py[c]) / 4; pz[i] = (pz[p] + 2 * pz[i] + pz[c]) / 4;
    }
  }

  // Pipe model: a parent's cross-section carries all of its children's.
  const EXP = 2.2, LEAF = 0.009, MAXR = 0.09;
  const acc = new Float64Array(N), radius = new Float32Array(N);
  for (let i = N - 1; i >= 0; i--) {
    radius[i] = Math.min(MAXR, acc[i] > 0 ? Math.pow(acc[i], 1 / EXP) : LEAF);
    if (parent[i] >= 0) acc[parent[i]] += Math.pow(radius[i], EXP);
  }
  // Path distance from the seed, for the growing animation.
  const depth = new Float32Array(N);
  let maxDepth = 0;
  for (let i = 1; i < N; i++) {
    const p = parent[i];
    depth[i] = depth[p] + len3(px[i] - px[p], py[i] - py[p], pz[i] - pz[p]);
    if (depth[i] > maxDepth) maxDepth = depth[i];
  }

  return { N, px, py, pz, parent, kids, radius, depth, maxDepth };
}

// Skin the tree: one ring per node, rings joined to the parent's ring, frames parallel-transported.
export function branchGeometry(tree, sides = 7) {
  const { N, px, py, pz, parent, kids, radius, depth, maxDepth } = tree;
  const pos = [], nor = [], dep = [], idx = [];
  const dirs = new Array(N), normals = new Array(N), ring = new Int32Array(N);
  const v = new THREE.Vector3(), b = new THREE.Vector3(), off = new THREE.Vector3();

  for (let i = 0; i < N; i++) {
    const d = new THREE.Vector3();
    if (parent[i] >= 0) d.set(px[i] - px[parent[i]], py[i] - py[parent[i]], pz[i] - pz[parent[i]]);
    else for (const c of kids[i]) d.add(v.set(px[c] - px[i], py[c] - py[i], pz[c] - pz[i]));
    if (kids[i].length === 1) d.add(v.set(px[kids[i][0]] - px[i], py[kids[i][0]] - py[i], pz[kids[i][0]] - pz[i]));
    d.normalize();
    if (d.lengthSq() === 0) d.set(0, -1, 0);
    dirs[i] = d;
    let n;
    if (parent[i] >= 0) n = normals[parent[i]].clone().addScaledVector(d, -normals[parent[i]].dot(d));
    if (!n || n.lengthSq() < 1e-6) n = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(d) : new THREE.Vector3(1, 0, 0).cross(d);
    normals[i] = n.normalize();
    b.crossVectors(d, n);
    ring[i] = pos.length / 3;
    const g = depth[i] / maxDepth;
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      off.copy(n).multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a));
      pos.push(px[i] + off.x * radius[i], py[i] + off.y * radius[i], pz[i] + off.z * radius[i]);
      nor.push(off.x, off.y, off.z);
      dep.push(g);
    }
  }
  for (let i = 0; i < N; i++) {
    if (parent[i] >= 0) {
      const r0 = ring[parent[i]], r1 = ring[i];
      for (let s = 0; s < sides; s++) {
        const s1 = (s + 1) % sides;
        idx.push(r0 + s, r1 + s1, r1 + s, r0 + s, r0 + s1, r1 + s1);
      }
    }
    // Caps: a rounded point on every twig tip, and under the seed.
    if (kids[i].length === 0 || parent[i] < 0) {
      const d = dirs[i], sign = parent[i] < 0 ? -1 : 1;
      const tip = pos.length / 3;
      pos.push(px[i] + d.x * radius[i] * 1.6 * sign, py[i] + d.y * radius[i] * 1.6 * sign, pz[i] + d.z * radius[i] * 1.6 * sign);
      nor.push(d.x * sign, d.y * sign, d.z * sign);
      dep.push(depth[i] / maxDepth);
      for (let s = 0; s < sides; s++) {
        const s1 = (s + 1) % sides;
        if (sign > 0) idx.push(ring[i] + s1, tip, ring[i] + s); else idx.push(ring[i] + s, tip, ring[i] + s1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("aDepth", new THREE.Float32BufferAttribute(dep, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
