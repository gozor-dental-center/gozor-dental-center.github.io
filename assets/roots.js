// The root network under the soil: grown once from the tooth's root tips down the whole page.
// Each node has an "arrival" value (how far underground the growth front must be before it shows),
// so the roots grow down and outwards as the visitor scrolls.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/+esm";

function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }

/**
 * @param {object} o
 * @param {{x:number,y:number,ang:number,r:number,level:number}[]} o.seeds  start points (world units, y<0 underground)
 * @param {number} o.width  usable width, centred on x=0
 * @param {number} o.depth  how deep the main roots go (positive)
 */
export function growNetwork({ seeds, width, depth, seed = 11, scale = 1, sideRoots = 3, cx = 0 }) {
  const rand = rng(seed);
  const px = [], py = [], pz = [], rad = [], arr = [], parent = [], start = [];
  const down = [], len = []; // per node: deepest point on its path, path length
  const half = width / 2;

  const add = (x, y, z, r, par, isStart, step) => {
    const i = px.length;
    const pd = par >= 0 ? down[par] : 0, pl = par >= 0 ? len[par] : 0;
    const d = Math.max(pd, -y), l = pl + step;
    px.push(x); py.push(y); pz.push(z); rad.push(r); parent.push(par); start.push(isStart ? 1 : 0);
    down.push(d); len.push(l);
    // Mostly how deep the path has gone, plus a share of its sideways travel, so side roots grow outwards.
    arr.push(d + 0.32 * Math.max(0, l - d));
    return i;
  };

  const mains = Math.max(3, Math.min(6, Math.round(width / 4.6)));
  const queue = [];

  // Main roots: they leave the tooth, then each settles into its own lane across the page and meanders down.
  for (let m = 0; m < mains; m++) {
    const s = seeds[m % seeds.length];
    const lane = cx - half + width * (m + 0.5) / mains;
    queue.push({
      parent: -1, x: s.x, y: s.y, z: 0.28, ang: s.ang + (rand() - 0.5) * 0.3, r0: s.r, r1: 0.035,
      length: depth * (0.92 + rand() * 0.08) + Math.abs(lane - s.x) * 0.6, level: 0, lane,
      phase: rand() * 6.28, amp: 0.8 + rand() * 1.6,
    });
  }
  // Short side roots straight off the tooth roots.
  for (const s of seeds) for (let k = 0; k < sideRoots; k++) {
    const side = k % 2 ? 1 : -1;
    queue.push({ parent: -1, x: s.x, y: s.y + 0.25 + k * 0.35, z: 0.3, ang: side * (0.9 + rand() * 0.5), r0: s.r * 0.45, r1: 0.01, length: (1.6 + rand() * 2.2) * scale, level: 1 });
  }

  for (let qi = 0; qi < queue.length; qi++) {
    const b = queue[qi];
    const step = b.level === 0 ? 0.2 : b.level === 1 ? 0.16 : 0.12;
    const n = Math.max(2, Math.round(b.length / step));
    let x = b.x, y = b.y, z = b.z, ang = b.ang;
    let prev = b.parent >= 0 ? add(x, y, z, b.r0, b.parent, true, 0) : add(x, y, z, b.r0, -1, true, 0);
    let nextSpawn = b.level === 0 ? 0.6 + rand() * 0.8 : b.level === 1 ? 0.35 + rand() * 0.6 : 0.3 + rand() * 0.4;
    let side = rand() < 0.5 ? 1 : -1;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      // Steering
      ang += (rand() - 0.5) * (b.level === 0 ? 0.16 : 0.3);
      if (b.level === 0) {
        const target = b.lane + Math.sin(-y * 0.16 + b.phase) * b.amp;
        const want = Math.max(-1.0, Math.min(1.0, (target - x) * 0.35));
        ang += (want - ang) * 0.06;
      } else {
        ang += (0 - ang) * (b.level === 1 ? 0.012 : 0.02); // gravity: side roots slowly bend down
      }
      if (x > cx + half - 0.4) ang -= 0.12;
      if (x < cx - half + 0.4) ang += 0.12;
      x += Math.sin(ang) * step;
      y -= Math.cos(ang) * step;
      if (y > -0.15) { y = -0.15; ang *= 0.8; } // never break the surface
      z += (rand() - 0.5) * 0.04;
      z = Math.max(0.06, Math.min(b.level === 0 ? 0.42 : 0.6, z));
      // Radius: mains thin slowly, side roots taper to a point.
      let r;
      if (b.level === 0) {
        r = b.r0 + (b.r1 - b.r0) * Math.pow(t, 0.7);
        if (t > 0.95) r *= 1 - (t - 0.95) / 0.05 * 0.7;
      } else r = b.r0 + (b.r1 - b.r0) * Math.pow(t, 0.8);
      prev = add(x, y, z, r, prev, false, step);

      // Spawning
      if (b.level < 3 && (nextSpawn -= step) <= 0) {
        side = -side;
        const lvl = b.level + 1;
        const spread = lvl === 1 ? 0.95 + rand() * 0.55 : lvl === 2 ? 0.55 + rand() * 0.6 : 0.4 + rand() * 0.5;
        const length = lvl === 1 ? 2.2 + rand() * 4.2 : lvl === 2 ? 0.7 + rand() * 1.6 : 0.25 + rand() * 0.45;
        if (lvl < 3 || rand() < 0.3) queue.push({
          parent: prev, x, y, z, ang: ang + side * spread, r0: Math.max(r * (lvl === 1 ? 0.55 : 0.62), 0.008),
          r1: lvl === 1 ? 0.01 : 0.005, length: length * scale * (1 - 0.4 * t * (b.level ? 1 : 0)), level: lvl,
        });
        nextSpawn = b.level === 0 ? 0.7 + rand() * 1.1 : b.level === 1 ? 0.35 + rand() * 0.6 : 0.25 + rand() * 0.35;
      }
    }
  }

  const N = px.length;
  const kids = Array.from({ length: N }, () => []);
  for (let i = 0; i < N; i++) if (parent[i] >= 0 && !start[i]) kids[parent[i]].push(i);
  // Continuation children (non-start) only, so tips are detected per branch.
  return { N, px, py, pz, rad, arr, parent, start, kids };
}

// Skin the network: one ring per node, joined to the parent's ring (except where a branch starts).
// The triangles are split into horizontal bands that share one vertex buffer, so the renderer only
// draws the bands on screen (the network runs the full length of the page).
function* skinSteps(net, sides, bandH) {
  const { N, px, py, pz, rad, arr, parent, start, kids } = net;
  const pos = new Float32Array(N * (sides + 1) * 3);
  const nor = new Float32Array(N * (sides + 1) * 3);
  const aArr = new Float32Array(N * (sides + 1));
  const aRad = new Float32Array(N * (sides + 1));
  const bands = new Map(); // band -> { idx: [], y0, y1, x0, x1 }
  const ring = new Int32Array(N);
  const normals = new Array(N);
  const d = new THREE.Vector3(), v = new THREE.Vector3(), b = new THREE.Vector3(), off = new THREE.Vector3();
  let vc = 0;
  const push = (x, y, z, nx, ny, nz, a, r) => {
    pos[vc * 3] = x; pos[vc * 3 + 1] = y; pos[vc * 3 + 2] = z;
    nor[vc * 3] = nx; nor[vc * 3 + 1] = ny; nor[vc * 3 + 2] = nz;
    aArr[vc] = a; aRad[vc] = r;
    return vc++;
  };
  const bandOf = (i) => {
    const k = Number.isFinite(bandH) ? Math.floor(-py[i] / bandH) : 0;
    let e = bands.get(k);
    if (!e) bands.set(k, (e = { idx: [], y0: Infinity, y1: -Infinity, x0: Infinity, x1: -Infinity }));
    e.y0 = Math.min(e.y0, py[i] - 0.5); e.y1 = Math.max(e.y1, py[i] + 0.5);
    e.x0 = Math.min(e.x0, px[i] - 0.5); e.x1 = Math.max(e.x1, px[i] + 0.5);
    return e.idx;
  };

  const nb = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    if ((i & 511) === 0) yield;
    const p = parent[i];
    d.set(0, 0, 0);
    if (p >= 0 && !start[i]) d.set(px[i] - px[p], py[i] - py[p], pz[i] - pz[p]);
    if (kids[i].length) { const c = kids[i][0]; d.add(v.set(px[c] - px[i], py[c] - py[i], pz[c] - pz[i])); }
    if (d.lengthSq() < 1e-10) d.set(0, -1, 0);
    d.normalize();
    const n = nb;
    if (p >= 0 && !start[i] && normals[p]) n.copy(normals[p]).addScaledVector(d, -normals[p].dot(d));
    else n.set(0, 0, 0);
    if (n.lengthSq() < 1e-6) n.set(0, 0, 1).cross(d);
    if (n.lengthSq() < 1e-6) n.set(1, 0, 0);
    n.normalize();
    normals[i] = new THREE.Vector3(n.x, n.y, n.z); // children carry this frame on (parallel transport)
    b.crossVectors(d, n);
    ring[i] = vc;
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      off.copy(n).multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a));
      push(px[i] + off.x * rad[i], py[i] + off.y * rad[i], pz[i] + off.z * rad[i], off.x, off.y, off.z, arr[i], rad[i]);
    }
    const joins = p >= 0 && !start[i], tip = !kids[i].length;
    if (!joins && !tip) continue;
    const idx = bandOf(i);
    if (joins) {
      const r0 = ring[p], r1 = ring[i];
      for (let s = 0; s < sides; s++) {
        const s1 = (s + 1) % sides;
        idx.push(r0 + s, r1 + s1, r1 + s, r0 + s, r0 + s1, r1 + s1);
      }
    }
    if (tip) {
      const t = push(px[i] + d.x * rad[i] * 2, py[i] + d.y * rad[i] * 2, pz[i] + d.z * rad[i] * 2, d.x, d.y, d.z, arr[i], 0);
      for (let s = 0; s < sides; s++) idx.push(ring[i] + (s + 1) % sides, t, ring[i] + s);
    }
  }
  const attrs = {
    position: new THREE.BufferAttribute(pos.subarray(0, vc * 3), 3),
    normal: new THREE.BufferAttribute(nor.subarray(0, vc * 3), 3),
    aArr: new THREE.BufferAttribute(aArr.subarray(0, vc), 1),
    aRad: new THREE.BufferAttribute(aRad.subarray(0, vc), 1),
  };
  const big = vc > 65535;
  return [...bands.values()].map((e) => {
    const g = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(attrs)) g.setAttribute(k, a);
    g.setIndex(big ? new THREE.Uint32BufferAttribute(e.idx, 1) : new THREE.Uint16BufferAttribute(e.idx, 1));
    const c = new THREE.Vector3((e.x0 + e.x1) / 2, (e.y0 + e.y1) / 2, 0.3);
    g.boundingSphere = new THREE.Sphere(c, Math.hypot((e.x1 - e.x0) / 2, (e.y1 - e.y0) / 2, 1));
    return g;
  });
}

export function networkGeometries(net, sides = 6, bandH = Infinity) {
  const it = skinSteps(net, sides, bandH);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}
// Same, but hands the page back every few milliseconds.
export async function networkGeometriesAsync(net, sides, bandH, pause, budget = 8) {
  const it = skinSteps(net, sides, bandH);
  let t = performance.now(), r = it.next();
  while (!r.done) {
    if (performance.now() - t > budget) { await pause(); t = performance.now(); }
    r = it.next();
  }
  return r.value;
}

export const networkGeometry = (net, sides = 6) => networkGeometries(net, sides)[0];

// Shared shader for the root core and its soft glow shell.
export function rootMaterials() {
  // uLight: 0 = dark mode (glowing mint roots), 1 = light mode (deeper green roots that read on pale soil).
  const uniforms = { uReveal: { value: 0 }, uTime: { value: 0 }, uFront: { value: 1.2 }, uLight: { value: 0 } };
  const vert = (fat) => /* glsl */ `
    attribute float aArr; attribute float aRad;
    uniform float uReveal; uniform float uTime; uniform float uFront;
    varying vec3 vN; varying vec3 vV; varying float vTip; varying float vArr;
    void main() {
      float g = clamp((uReveal - aArr) / uFront, 0.0, 1.0);   // 0 at the growth front, 1 well behind it
      vec3 c = position - normal * aRad;
      vec3 p = c + normal * aRad * g * ${fat.toFixed(2)};
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      vTip = 1.0 - g;
      vArr = aArr;
      gl_Position = projectionMatrix * mv;
    }`;
  const core = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vert(1),
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uLight;
      varying vec3 vN; varying vec3 vV; varying float vTip; varying float vArr;
      void main() {
        vec3 n = normalize(vN);
        float lam = clamp(dot(n, normalize(vec3(0.35, 0.8, 0.6))), 0.0, 1.0);
        float rim = pow(1.0 - clamp(dot(n, vV), 0.0, 1.0), 2.0);
        vec3 deep = vec3(0.10, 0.46, 0.36);   // #1a755c-ish, darker shade of the logo green
        vec3 green = vec3(0.286, 0.718, 0.580); // #49b794
        vec3 mint = vec3(0.72, 0.95, 0.86);
        vec3 darkBase = mix(deep, green, 0.35 + 0.65 * lam);
        vec3 lightBase = mix(vec3(0.05, 0.33, 0.26), vec3(0.15, 0.52, 0.40), 0.35 + 0.65 * lam);
        vec3 hi = mix(mint, green, uLight);
        vec3 col = mix(darkBase, lightBase, uLight) + hi * rim * mix(0.55, 0.3, uLight);
        // Sap pulses travelling down the roots
        float pulse = smoothstep(0.92, 1.0, sin(vArr * 1.3 - uTime * 1.8));
        col += hi * pulse * 0.35;
        col += hi * vTip * mix(0.9, 0.7, uLight); // bright growing tips
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const glow = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vert(2.6),
    fragmentShader: /* glsl */ `
      uniform float uLight;
      varying vec3 vN; varying vec3 vV; varying float vTip;
      void main() {
        float f = clamp(dot(normalize(vN), vV), 0.0, 1.0);
        // Additive glow washes out on pale soil, so it is mostly turned down in light mode.
        float a = pow(f, 1.6) * (0.16 + vTip * 0.35) * (1.0 - 0.7 * uLight);
        gl_FragColor = vec4(vec3(0.42, 0.86, 0.69) * a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  return { core, glow, uniforms };
}
