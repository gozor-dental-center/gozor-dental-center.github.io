// The whole page as one place: a green field with trees and a tooth planted at the edge of the ground,
// cut open like a diorama. Scrolling takes the camera down through the cut, past the tooth's roots,
// and the root network keeps branching down the page. Below the hero the camera moves 1:1 with the
// page, so the roots sit still relative to the content.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/+esm";
import { RoomEnvironment } from "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/environments/RoomEnvironment.js/+esm";
import { mergeVertices } from "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/utils/BufferGeometryUtils.js/+esm";
import { toothShellAsync, toothSDF, pause } from "./tooth3d.js";
import { growNetwork, networkGeometry, networkGeometriesAsync, rootMaterials } from "./roots.js";
import { decodeTeeth, loadTeeth } from "./teethbin.js";

const FOV = 40;
const D = 14; // camera distance from the cut face (z = 0)
const TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2));

function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.min(1, Math.max(0, t));

// Tileable value noise for the canvas textures.
function periodicNoise(period, rand) {
  const g = Float32Array.from({ length: period * period }, () => rand());
  const at = (x, y) => g[(((y % period) + period) % period) * period + (((x % period) + period) % period)];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = smooth(x - xi), yf = smooth(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}

// ---------- damaged teeth (same molar, with a cavity or a broken, cracked crown) ----------
const sph = (x, y, z, r) => Math.sqrt(x * x + y * y + z * z) - r;
const smaxJ = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };
const CAV = [[0.2, 1.3, 0.32, 0.36], [-0.38, 1.22, 0.24, 0.2]];
const cavitySDF = (x, y, z) => {
  let d = toothSDF(x, y, z);
  for (const [cx, cy, cz, r] of CAV) d = smaxJ(d, -sph(x - cx, y - cy, z - cz, r), 0.06);
  return d;
};
const crackRegion = (x, y, z) => Math.max(Math.abs(x * 0.95 - y * 0.3 + 0.05) - 0.04, 0.35 - y, 0.12 - z);
const brokenPlane = (x, y, z) => x * 0.6 + y * 0.75 + z * 0.28 - 1.15;
const crackedSDF = (x, y, z) => {
  let d = toothSDF(x, y, z);
  d = smaxJ(d, brokenPlane(x, y, z), 0.05);      // a corner of the crown broken off
  d = smaxJ(d, -crackRegion(x, y, z), 0.015);   // a crack down the front
  return d;
};
// Grey-blue enamel, darkened inside the cavities, along the crack and on the broken face.
function stainGeometry(g, darkAt) {
  const p = g.getAttribute("position"), col = new Float32Array(p.count * 3);
  const base = new THREE.Color("#c3d1d5"), dark = new THREE.Color("#22394a"), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const k = darkAt(p.getX(i), p.getY(i), p.getZ(i));
    c.copy(base).lerp(dark, k);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

// Smooth normals straight from the shape function (marching-cubes normals show faint rings).
async function sdfNormals(g, sdf) {
  const p = g.getAttribute("position"), n = g.getAttribute("normal"), e = 0.003;
  let t = performance.now();
  for (let i = 0; i < p.count; i++) {
    if ((i & 1023) === 0 && performance.now() - t > 8) { await pause(); t = performance.now(); }
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const nx = sdf(x + e, y, z) - sdf(x - e, y, z), ny = sdf(x, y + e, z) - sdf(x, y - e, z), nz = sdf(x, y, z + e) - sdf(x, y, z - e);
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    n.setXYZ(i, nx / l, ny / l, nz / l);
  }
  n.needsUpdate = true;
  return g;
}

function soilTexture() {
  const S = 512, rand = rng(5);
  const n1 = periodicNoise(16, rand), n2 = periodicNoise(64, rand), n3 = periodicNoise(128, rand);
  const pebbles = Array.from({ length: 46 }, () => ({ x: rand() * S, y: rand() * S, rx: 3 + rand() * 11, ry: 2 + rand() * 6, a: rand() * Math.PI }));
  const img = new ImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    const grain = 0.45 * n1(u * 16, v * 16) + 0.35 * n2(u * 64, v * 64) + 0.2 * n3(u * 128, v * 128);
    const i = (y * S + x) * 4;
    img.data[i] = grain * 255; img.data[i + 1] = n1(u * 16 + 7, v * 16 + 3) * 255; img.data[i + 3] = 255;
  }
  // Pebbles: each one only touches the pixels inside its own box (wrapping at the edges).
  for (const p of pebbles) {
    const c = Math.cos(p.a), sn = Math.sin(p.a), R = Math.ceil(p.rx) + 1;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const qx = (dx * c + dy * sn) / p.rx, qy = (-dx * sn + dy * c) / p.ry, r = qx * qx + qy * qy;
      if (r >= 1) continue;
      const x = ((Math.round(p.x) + dx) % S + S) % S, y = ((Math.round(p.y) + dy) % S + S) % S;
      const i = (y * S + x) * 4;
      img.data[i + 2] = Math.max(img.data[i + 2], ((1 - r) * 0.8 + 0.2) * 255);
    }
  }
  const cv = document.createElement("canvas"); cv.width = cv.height = S;
  cv.getContext("2d").putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

function grassTexture() {
  const S = 256, rand = rng(9);
  const n1 = periodicNoise(8, rand), n2 = periodicNoise(32, rand);
  const img = new ImageData(S, S);
  const a = [0.36, 0.76, 0.6], b = [0.25, 0.62, 0.47], c = [0.55, 0.85, 0.71];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    const m = 0.6 * n1(u * 8, v * 8) + 0.4 * n2(u * 32, v * 32);
    const sp = rand() < 0.05 ? 0.5 : 0;
    const i = (y * S + x) * 4;
    for (let k = 0; k < 3; k++) img.data[i + k] = 255 * ((a[k] + (b[k] - a[k]) * m) * (1 - sp) + c[k] * sp);
    img.data[i + 3] = 255;
  }
  const cv = document.createElement("canvas"); cv.width = cv.height = S;
  cv.getContext("2d").putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function cloudTexture() {
  const cv = document.createElement("canvas"); cv.width = 256; cv.height = 128;
  const g = cv.getContext("2d"), rand = rng(3);
  for (let i = 0; i < 14; i++) {
    const x = 50 + rand() * 156, y = 58 + (rand() - 0.5) * 30, r = 22 + rand() * 30;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, "rgba(255,255,255,0.95)"); grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Phones start in light mode: no anti-aliasing, no shadows, a simpler tooth material, fewer small details.
// Computers start at full quality and only step down if this device is actually measured to be slow
// (see the quality ladder in frame()). ?lite / ?full force one or the other.
function detectLite() {
  const q = location.search;
  if (q.includes("full")) return false;
  if (q.includes("lite")) return true;
  return matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 900;
}

export function createScene(canvas, { reduce = false, getScroll, getDocHeight, getLight, onReady, onLost, computeTeeth = false } = {}) {
  const lite = detectLite();
  // Ready-made teeth (see teethbin.js). index.html preloads the file, so it is usually here already.
  const teethFile = computeTeeth ? Promise.resolve(null) : loadTeeth(new URL("./teeth.bin.gz", import.meta.url));
  // Each setting can be overridden from the address for testing, e.g. ?q-aa=1&q-pr=1&q-glow=0
  const P = new URLSearchParams(location.search);
  const opt = (k, d) => (P.has("q-" + k) ? Number(P.get("q-" + k)) : d);
  const Q = {
    // Phones keep edge smoothing and draw at up to 2× (they were at 1.5× with no smoothing, which
    // looked pixelated on 3× screens). If a phone turns out slow, the quality ladder lowers it.
    aa: opt("aa", 1), shadow: opt("shadow", lite ? 0 : 1), glow: opt("glow", 1),
    phys: opt("phys", lite ? 0 : 1), pr: opt("pr", lite ? 2 : 1.5), flora: opt("flora", lite ? 0.7 : 1), adapt: opt("adapt", location.search.includes("zone") ? 0 : 1),
  };
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !!Q.aa, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = !!Q.shadow;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const scene = new THREE.Scene();
  const HORIZON = new THREE.Color("#e2f2f4");
  scene.fog = new THREE.Fog(HORIZON, 45, 200);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 500);
  const time = { value: 0 };

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // ---------- above ground ----------
  const above = new THREE.Group();
  scene.add(above);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(320, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: /* glsl */ `varying vec3 vP;
        void main(){
          float h = clamp(vP.y, 0.0, 1.0);
          vec3 horizon = vec3(0.886, 0.949, 0.957);
          vec3 mid = vec3(0.62, 0.82, 0.93);
          vec3 top = vec3(0.30, 0.60, 0.84);
          vec3 c = mix(horizon, mid, smoothstep(0.0, 0.18, h));
          c = mix(c, top, smoothstep(0.15, 0.7, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
  );
  above.add(sky);

  const cloudTex = cloudTexture();
  const clouds = [];
  {
    const rand = rng(21);
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, fog: false, transparent: true, opacity: 0.75 + rand() * 0.2, depthWrite: false }));
      const s = 30 + rand() * 40;
      m.scale.set(s, s * 0.45, 1);
      m.position.set((rand() - 0.5) * 320, 26 + rand() * 34, -170 - rand() * 90);
      m.userData.v = 0.4 + rand() * 0.6;
      clouds.push(m); above.add(m);
    }
  }

  const grassTex = grassTexture();
  grassTex.repeat.set(80, 35);
  const field = new THREE.Mesh(new THREE.PlaneGeometry(600, 260), new THREE.MeshLambertMaterial({ map: grassTex }));
  field.rotation.x = -Math.PI / 2;
  field.position.set(0, 0, -130);
  field.receiveShadow = true;
  above.add(field);

  // Distant hills
  {
    const rand = rng(4);
    const hillGeo = new THREE.SphereGeometry(1, 40, 20);
    const cols = ["#6fcaa6", "#5ab994", "#83d3b4", "#4fae8b", "#79c9ad"];
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(hillGeo, new THREE.MeshLambertMaterial({ color: cols[i % cols.length] }));
      m.scale.set(38 + rand() * 40, 7 + rand() * 9, 22 + rand() * 14);
      m.position.set(-170 + i * 56 + (rand() - 0.5) * 20, -2, -115 - rand() * 55);
      above.add(m);
    }
  }

  const hemi = new THREE.HemisphereLight("#e3f3fb", "#3f9e7d", 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight("#fff8ec", 2.4);
  sun.position.set(18, 26, 16);
  sun.target.position.set(0, 0, -18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 130 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // Wind for grass and leaves
  const addWind = (mat, amount, axis = "y") => {
    if (reduce) return;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = time;
      sh.vertexShader = "uniform float uTime;\n" + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
        float ph = instanceMatrix[3].x * 0.9 + instanceMatrix[3].z * 0.55;
        float h = max(position.${axis}, 0.0);
        transformed.x += sin(uTime * 1.6 + ph) * ${amount.toFixed(3)} * h;
        transformed.z += cos(uTime * 1.2 + ph) * ${(amount * 0.5).toFixed(3)} * h;`);
    };
  };

  // Trees, grass and flowers are rebuilt with the layout (they depend on the screen shape).
  const trunkGeo = new THREE.CylinderGeometry(0.09, 0.16, 1, 7).translate(0, 0.5, 0);
  const blobGeo = new THREE.IcosahedronGeometry(1, 1);
  const coneGeo = new THREE.ConeGeometry(1, 1.6, 8).translate(0, 0.8, 0);
  const bladeGeo = new THREE.BufferGeometry();
  bladeGeo.setAttribute("position", new THREE.Float32BufferAttribute([-0.035, 0, 0, 0.035, 0, 0, 0.004, 0.34, 0.01], 3));
  bladeGeo.computeVertexNormals();
  const flowerGeo = new THREE.IcosahedronGeometry(0.05, 0).translate(0, 0.16, 0);
  const trunkMat = new THREE.MeshLambertMaterial({ color: "#2f5d52" });
  const leafMat = new THREE.MeshLambertMaterial({ flatShading: true });
  addWind(leafMat, 0.03);
  const bladeMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  addWind(bladeMat, 0.32);
  const flowerMat = new THREE.MeshLambertMaterial({ color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.15 });
  addWind(flowerMat, 0.25);
  let flora = null;

  // ---------- the tooth ----------
  const toothMat = !Q.phys
    ? new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.26, envMap: envTex, envMapIntensity: 1.05 })
    : new THREE.MeshPhysicalMaterial({
      color: "#ffffff", roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.18,
      sheen: 0.5, sheenColor: new THREE.Color("#dff7ee"), envMap: envTex, envMapIntensity: 0.9,
    });
  // The tooth meshes are built in small steps (see buildTeeth) so the page never freezes.
  const tooth = new THREE.Mesh(new THREE.BufferGeometry(), toothMat);
  let toothReady = false;
  tooth.castShadow = true;
  scene.add(tooth);
  const mound = new THREE.Mesh(new THREE.CircleGeometry(1, 40, 0, Math.PI), new THREE.MeshLambertMaterial({ color: "#2c6b55" }));
  mound.rotation.x = -Math.PI / 2; // the half disc lies behind the cut (z < 0)
  mound.receiveShadow = true;
  above.add(mound);
  const rootLight = new THREE.PointLight("#5fd1a8", 0, 9, 1.6);
  scene.add(rootLight);

  // Two damaged teeth planted beside the healthy one: their roots are thin, grey and withered.
  const sickMat = !Q.phys
    ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, envMap: envTex, envMapIntensity: 0.45 })
    : new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.62, clearcoat: 0.15, envMap: envTex, envMapIntensity: 0.45 });
  const sickShapes = [
    [cavitySDF, (x, y, z) => Math.max(...CAV.map(([cx, cy, cz, r]) => clamp01(1 - sph(x - cx, y - cy, z - cz, r) / 0.09)))],
    [crackedSDF, (x, y, z) => Math.max(clamp01(1 - crackRegion(x, y, z) / 0.06), clamp01(1 - Math.abs(brokenPlane(x, y, z)) / 0.08) * 0.75)],
  ];
  const sick = sickShapes.map(() => new THREE.Mesh(new THREE.BufferGeometry(), sickMat));
  const sickMounds = sick.map(() => new THREE.Mesh(mound.geometry, mound.material));
  sick.forEach((m, i) => { m.castShadow = true; scene.add(m); sickMounds[i].rotation.x = -Math.PI / 2; above.add(sickMounds[i]); });
  const witherMat = new THREE.MeshLambertMaterial({ color: "#46606b" });
  let withered = [];

  // Healthy tooth first (the canvas fades in once it is there), then the two damaged ones.
  // Marching cubes gives every triangle its own three corners; merging shared corners cuts the
  // vertex work about six times (measured: the teeth were the most expensive thing on Intel HD).
  async function shell(resolution, sdf) {
    const g = await toothShellAsync({ resolution, sdf });
    await sdfNormals(g, sdf);
    await pause();
    const m = mergeVertices(g, 1e-4);
    g.dispose();
    return m;
  }
  async function buildTeeth() {
    let baked = null;
    try { const buf = await teethFile; if (buf) baked = decodeTeeth(buf); } catch (e) { console.warn("teeth.bin unreadable, building the teeth here.", e); }
    if (baked) {
      tooth.geometry = baked.tooth;
      for (const f of floaters) f.geometry = baked.float;
      sick.forEach((m, i) => { m.geometry.dispose(); m.geometry = baked["sick" + i]; });
      toothReady = true;
      renderer.shadowMap.needsUpdate = true;
      return;
    }
    tooth.geometry = await shell(72, toothSDF);
    toothReady = true;
    renderer.shadowMap.needsUpdate = true;
    // The floating teeth are small on screen: a lighter mesh is enough.
    const fg = await shell(40, toothSDF);
    for (const f of floaters) f.geometry = fg;
    for (let i = 0; i < sickShapes.length; i++) {
      const [sdf, darkAt] = sickShapes[i];
      const sg = await toothShellAsync({ resolution: 56, sdf });
      await sdfNormals(sg, sdf);
      stainGeometry(sg, darkAt);
      await pause();
      sick[i].geometry.dispose();
      sick[i].geometry = mergeVertices(sg, 1e-4);
      sg.dispose();
      renderer.shadowMap.needsUpdate = true;
    }
  }

  // Small teeth floating in the sky (a simpler material: at their size the extra gloss does not show)
  const floatMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.28, envMap: envTex, envMapIntensity: 1.05 });
  const floaters = [
    [-0.5, 7.6, -10, 0.5], [-0.25, 9.8, -17, 0.42], [-0.66, 5.2, -6, 0.34], [0.06, 11.2, -24, 0.46],
    [-0.1, 6.6, -8, 0.28], [0.42, 12.6, -34, 0.55], [-0.4, 12.4, -28, 0.5],
  ].map(([fx, y, z, s], i) => {
    const m = new THREE.Mesh(tooth.geometry, floatMat);
    m.userData = { fx, y, z, s, ph: i * 1.7, spin: (i % 2 ? 1 : -1) * (0.25 + 0.1 * i) };
    m.rotation.set(0.3 * i, i, 0.2);
    above.add(m);
    return m;
  });

  // ---------- below ground ----------
  const below = new THREE.Group();
  scene.add(below);
  const soilTex = soilTexture();
  const faceMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: soilTex }, uLight: { value: 0 } },
    vertexShader: "varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex; uniform float uLight; varying vec3 vW;
      void main(){
        float d = -vW.y;
        vec4 t = texture2D(uTex, vW.xy / 6.5);
        vec4 t2 = texture2D(uTex, vW.xy / 21.0 + vec2(0.37, 0.11));
        // Lighter soil (the user found the old one too dark); still the logo's blue-green.
        vec3 top  = vec3(0.205, 0.400, 0.345);
        vec3 mid  = vec3(0.135, 0.300, 0.320);
        vec3 deep = vec3(0.100, 0.240, 0.290);
        vec3 c = mix(top, mid, smoothstep(0.3, 3.5, d));
        c = mix(c, deep, smoothstep(3.5, 14.0, d));
        float band = sin(d * 1.55 + sin(vW.x * 0.33) * 1.1 + t2.g * 2.0) * 0.5 + 0.5;
        c *= 0.84 + 0.22 * band;
        c *= 0.62 + 0.75 * t.r * (0.75 + 0.35 * t2.r);
        c = mix(c, vec3(0.22, 0.38, 0.40) * (0.7 + 0.5 * t.g), t.b * 0.75);
        // grass-root mat right under the surface
        c = mix(vec3(0.11, 0.25, 0.19) * (0.7 + 0.6 * t.r), c, smoothstep(0.0, 0.5, d));
        // Light mode: pale blue-green soil, same layers and grain but much softer contrast.
        vec3 l = mix(vec3(0.78, 0.89, 0.84), vec3(0.72, 0.86, 0.86), smoothstep(0.3, 3.5, d));
        l = mix(l, vec3(0.66, 0.81, 0.86), smoothstep(3.5, 14.0, d));
        l *= 0.94 + 0.07 * band;
        l *= 0.86 + 0.22 * t.r * (0.75 + 0.35 * t2.r);
        l = mix(l, vec3(0.70, 0.82, 0.83) * (0.9 + 0.2 * t.g), t.b * 0.5);
        l = mix(vec3(0.50, 0.71, 0.59) * (0.85 + 0.3 * t.r), l, smoothstep(0.0, 0.5, d));
        c = mix(c, l, uLight);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), faceMat);
  below.add(face);

  const pebbleMat = new THREE.MeshLambertMaterial({ color: "#3f6e77", flatShading: true });
  const pebbleDark = new THREE.Color("#3f6e77"), pebbleLight = new THREE.Color("#8fb9bd");
  const pebbleGeo = new THREE.IcosahedronGeometry(1, 0);
  let pebbles = null;

  const moteMat = new THREE.ShaderMaterial({
    uniforms: { uTime: time, uPx: { value: 1 } },
    vertexShader: /* glsl */ `attribute float aSeed; uniform float uTime; uniform float uPx; varying float vA;
      void main(){
        vec3 p = position;
        p.y += sin(uTime * 0.35 + aSeed * 6.28) * 0.25;
        p.x += cos(uTime * 0.25 + aSeed * 12.0) * 0.18;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uPx * (2.0 + aSeed * 3.0) * (14.0 / -mv.z);
        vA = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * 1.3 + aSeed * 40.0));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: "varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA * 0.55; gl_FragColor = vec4(vec3(0.55, 0.92, 0.78) * a, a); }",
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  let motes = null;

  const roots = rootMaterials();
  if (!Q.glow) roots.glow.visible = false;
  let rootMeshes = [], rootsToken = 0, rootsReady = false, warmRoots = false;

  // ---------- layout ----------
  const L = { vh: 1, h: 1, wv: 1, k: 1, depth: 10, toothX: 0, S: 1.6, heroY: 3.6, heroPitch: -0.105, wide: true, fKey: 0, gKey: 0, gDepth: 0 };
  // Pixel density: capped, and lowered by itself if frames take too long on this device.
  let maxPR = Q.pr;
  const perf = { n: 0, sum: 0, slow: 0, jank: 0 };
  let readyAt = 0;
  const setPR = (v) => {
    maxPR = v;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, v));
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    moteMat.uniforms.uPx.value = renderer.getPixelRatio();
  };
  // Quality ladder: when this device is measured slow, give up the least visible thing first.
  const effPR = () => Math.min(devicePixelRatio || 1, maxPR);
  const ladder = [
    () => effPR() > 1 && (setPR(Math.max(1, effPR() - 0.5)), true),        // retina screens: fewer pixels
    () => renderer.shadowMap.enabled && ((renderer.shadowMap.enabled = false), scene.traverse((o) => o.material && (o.material.needsUpdate = true)), true),
    () => tooth.material.isMeshPhysicalMaterial && (swapToStandard(), true), // simpler gloss on the teeth
    () => roots.glow.visible && ((roots.glow.visible = false), true),       // the soft glow around the roots
    () => Q.flora > 0.45 && ((Q.flora *= 0.6), buildFlora(), (renderer.shadowMap.needsUpdate = true), true), // thinner grass
    // No step below 1×: drawing fewer pixels than the screen has made the whole scene look blurry.
  ];
  const stepNames = ["pixels", "shadows", "gloss", "glow", "grass"];
  const stepDown = () => {
    for (let i = 0; i < ladder.length; i++) if (ladder[i]()) {
      const d = document.documentElement.dataset; // read by bench.js
      d.quality = (d.quality ? d.quality + "," : "") + stepNames[i];
      return;
    }
  };
  function swapToStandard() {
    const t = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.26, envMap: tooth.material.envMap, envMapIntensity: 1.05 });
    const sm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, envMap: tooth.material.envMap, envMapIntensity: 0.45 });
    tooth.material = t; sick.forEach((m) => (m.material = sm));
  }

  function buildFlora() {
    if (flora) { above.remove(flora); flora.traverse((o) => o.isInstancedMesh && o.dispose()); }
    flora = new THREE.Group();
    const rand = rng(31);
    const half = L.wv / 2;
    // Trees
    const trees = [];
    for (let tries = 0; trees.length < Math.round(150 * Math.max(0.6, Q.flora)) && tries < 3000; tries++) {
      const z = -3 - Math.pow(rand(), 1.35) * 115;
      const span = (D - z) * TAN * (L.wv / L.h) * 1.25;
      const x = (rand() * 2 - 1) * span;
      if (Math.abs(x - L.toothX) < (L.wide ? 5 : 3.2) && z > -9) continue;  // keep the teeth clear
      if (L.wide && z > -60 && x > -1.5 - z * 0.12) continue; // keep the hero copy clear (right side)
      if (!L.wide && z > -14 && Math.abs(x) < 2.6) continue;
      trees.push({ x, z, s: 0.75 + rand() * 0.95, pine: rand() < 0.38, r: rand() });
    }
    // A pair of larger trees framing the tooth
    trees.push({ x: L.toothX - (L.wide ? 4.2 : 2.6), z: -7.5, s: 1.9, pine: false, r: 0.3 });
    trees.push({ x: L.toothX + (L.wide ? 3.6 : 2.4), z: -12, s: 1.6, pine: true, r: 0.7 });

    const leafCols = ["#49b794", "#3ba480", "#2e8a6c", "#5cc4a0", "#7fd3b6", "#43ad8a"].map((c) => new THREE.Color(c));
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
    const blobs = new THREE.InstancedMesh(blobGeo, leafMat, trees.length * 3);
    const cones = new THREE.InstancedMesh(coneGeo, leafMat, trees.length * 3);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    let nb = 0, nc = 0;
    trees.forEach((t, i) => {
      const th = (t.pine ? 0.9 : 1.35) * t.s;
      m.compose(p.set(t.x, 0, t.z), q.identity(), sc.set(t.s, th, t.s)); trunks.setMatrixAt(i, m);
      const col = leafCols[Math.floor(t.r * leafCols.length) % leafCols.length];
      if (t.pine) {
        [[0.75, 1.0, 1.0], [1.35, 0.78, 0.85], [1.85, 0.55, 0.7]].forEach(([y, r, hh]) => {
          m.compose(p.set(t.x, y * t.s, t.z), q.setFromEuler(e.set(0, t.r * 6, 0)), sc.set(r * t.s, hh * t.s, r * t.s));
          cones.setMatrixAt(nc, m); cones.setColorAt(nc++, col);
        });
      } else {
        [[0, 1.75, 0, 0.95], [-0.5, 1.45, 0.2, 0.7], [0.5, 1.5, -0.15, 0.72]].forEach(([dx, y, dz, r], k) => {
          m.compose(p.set(t.x + dx * t.s, y * t.s, t.z + dz * t.s), q.setFromEuler(e.set(t.r * 3, t.r * 5 + k, 0)), sc.set(r * t.s, r * t.s * 0.92, r * t.s));
          blobs.setMatrixAt(nb, m); blobs.setColorAt(nb++, col);
        });
      }
    });
    blobs.count = nb; cones.count = nc;
    [trunks, blobs, cones].forEach((im) => { im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; flora.add(im); });

    // Grass along the cut, hanging slightly over the edge
    const width = L.wv * 1.5;
    const nBlades = Math.round(width * (L.wide ? 330 : 420) * Q.flora);
    const blades = new THREE.InstancedMesh(bladeGeo, bladeMat, nBlades);
    const g1 = new THREE.Color("#49b794"), g2 = new THREE.Color("#2e8a6c"), g3 = new THREE.Color("#8adbbd"), c = new THREE.Color();
    for (let i = 0; i < nBlades; i++) {
      const z = 0.16 - Math.pow(rand(), 1.6) * 6;
      const x = (rand() - 0.5) * width * (1 + (-z) * 0.06);
      const s = 0.6 + rand() * 0.9;
      m.compose(p.set(x, 0, z), q.setFromEuler(e.set((rand() - 0.5) * 0.5, rand() * Math.PI, (rand() - 0.5) * 0.5)), sc.set(s, s * (0.8 + rand() * 0.7), s));
      blades.setMatrixAt(i, m);
      c.copy(g1).lerp(rand() < 0.5 ? g2 : g3, rand() * 0.7);
      blades.setColorAt(i, c);
    }
    blades.frustumCulled = false;
    flora.add(blades);

    const nFlowers = Math.round(width * 9);
    const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, nFlowers);
    for (let i = 0; i < nFlowers; i++) {
      const z = -0.2 - rand() * 7;
      m.compose(p.set((rand() - 0.5) * width, 0, z), q.identity(), sc.setScalar(0.7 + rand() * 0.8));
      flowers.setMatrixAt(i, m);
    }
    flowers.frustumCulled = false;
    flora.add(flowers);
    above.add(flora);
  }

  function buildUnderground() {
    const fw = L.wv * 1.8 + 8, fh = L.depth + 30;
    face.geometry.dispose();
    face.geometry = new THREE.PlaneGeometry(fw, fh);
    face.position.set(0, -fh / 2, 0);

    const rand = rng(77);
    if (pebbles) { below.remove(pebbles); pebbles.dispose(); }
    const nP = Math.round(L.depth * L.wv * 0.09);
    pebbles = new THREE.InstancedMesh(pebbleGeo, pebbleMat, nP);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let i = 0; i < nP; i++) {
      const s = 0.06 + Math.pow(rand(), 2.2) * 0.32;
      m.compose(p.set((rand() - 0.5) * L.wv * 1.1, -0.6 - rand() * L.depth, s * 0.2), q.setFromEuler(e.set(rand() * 3, rand() * 3, rand() * 3)), sc.set(s * 1.3, s * 0.8, s * 0.6));
      pebbles.setMatrixAt(i, m);
    }
    below.add(pebbles);

    if (motes) { below.remove(motes); motes.geometry.dispose(); }
    const nM = Math.round(L.depth * L.wv * (lite ? 0.15 : 0.35));
    const mp = new Float32Array(nM * 3), ms = new Float32Array(nM);
    for (let i = 0; i < nM; i++) {
      mp[i * 3] = (rand() - 0.5) * L.wv * 1.2; mp[i * 3 + 1] = -0.4 - rand() * L.depth; mp[i * 3 + 2] = 0.4 + rand() * 4.5; ms[i] = rand();
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute("position", new THREE.BufferAttribute(mp, 3));
    mg.setAttribute("aSeed", new THREE.BufferAttribute(ms, 1));
    motes = new THREE.Points(mg, moteMat);
    motes.frustumCulled = false;
    below.add(motes);

    // Root network from the tooth's root tips
    tooth.updateMatrixWorld(true);
    const seeds = [-1, 1].map((s) => {
      const v = new THREE.Vector3(s * 0.4, -1.4, 0).applyMatrix4(tooth.matrixWorld);
      return { x: v.x, y: v.y, ang: s * 0.25, r: 0.12 * (L.S / 1.4) };
    });
    const net = growNetwork({ seeds, width: L.wv - (L.wide ? 0.8 : 0.4), depth: L.depth - Math.abs(seeds[0].y) });
    // Built in steps; a newer build (after a resize) wins over an older one still running.
    const tok = ++rootsToken;
    networkGeometriesAsync(net, L.wide ? 5 : 4, L.h, pause).then((geos) => {
      if (tok !== rootsToken) { geos.forEach((g) => g.dispose()); return; }
      for (const m of rootMeshes) { below.remove(m); m.geometry.dispose(); }
      // One band per screen height: only the bands in view get drawn.
      rootMeshes = geos.flatMap((g) => {
        const core = new THREE.Mesh(g, roots.core), glow = new THREE.Mesh(g, roots.glow);
        glow.renderOrder = 2;
        return [core, glow];
      });
      below.add(...rootMeshes);
      rootsReady = true;
      warmRoots = true;
    });

    // Withered roots of the damaged teeth: short, thin, no glow.
    for (const w of withered) { below.remove(w); w.geometry.dispose(); }
    withered = sick.map((m, i) => {
      m.updateMatrixWorld(true);
      const s = m.scale.x;
      const tips = [-1, 1].map((k) => {
        const v = new THREE.Vector3(k * 0.4, -1.4, 0).applyMatrix4(m.matrixWorld);
        return { x: v.x, y: v.y, ang: k * 0.35, r: 0.05 * s };
      });
      const net = growNetwork({ seeds: tips, width: 1.6 * s, depth: 1.1 * s, seed: 40 + i, scale: 0.28, sideRoots: 1, cx: m.position.x });
      const mesh = new THREE.Mesh(networkGeometry(net, 5), witherMat);
      below.add(mesh);
      return mesh;
    });
  }

  let lastSize = "";
  function layout(force = false) {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    // Phones fire resize whenever the address bar slides in or out while scrolling. The stage is
    // sized to the tallest viewport (styles.css), so its size does not change then: skip the work,
    // which used to resize the canvas and regrow the whole root network mid-scroll.
    const size = `${w}x${h}@${devicePixelRatio}/${getDocHeight ? getDocHeight() : 0}`;
    if (!force && size === lastSize) return;
    lastSize = size;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, maxPR));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    moteMat.uniforms.uPx.value = renderer.getPixelRatio();

    L.vh = h;
    L.h = 2 * D * TAN;
    L.wv = L.h * camera.aspect;
    L.k = L.h / h;
    L.wide = camera.aspect > 1.05;
    const docH = getDocHeight ? getDocHeight() : h * 6;
    L.depth = L.h * 0.15 + Math.max(0, docH - 2 * h) * L.k + L.h * 0.5 + 1.5;
    L.S = L.wide ? 1.2 : Math.min(1.05, L.wv * 0.22);
    L.toothX = L.wide ? -L.wv * 0.24 : 0;
    L.heroY = L.wide ? 3.6 : 4.4;
    L.heroPitch = L.wide ? -0.105 : -0.06;

    tooth.scale.setScalar(L.S);
    tooth.position.set(L.toothX, -0.26 * L.S, 0.5);
    tooth.rotation.set(0.04, 0.55, 0);
    mound.scale.setScalar(L.S * 1.1);
    mound.position.set(L.toothX, 0.012, 0.0);
    rootLight.position.set(L.toothX, -1.6 * L.S, 2.2);

    const ss = L.S * 0.72;
    const off = L.wide ? L.S * 2.1 : L.wv * 0.34;
    [[-off, -0.14, -0.4], [off * 0.95, 0.12, 0.9]].forEach(([dx, tilt, ry], i) => {
      sick[i].scale.setScalar(ss);
      sick[i].position.set(L.toothX + dx, -0.3 * ss, 0.42);
      sick[i].rotation.set(0.05, ry, tilt);
      sickMounds[i].scale.setScalar(ss * 1.1);
      sickMounds[i].position.set(L.toothX + dx, 0.011, 0);
    });
    for (const f of floaters) {
      const u = f.userData;
      f.scale.setScalar(u.s * (L.wide ? 1 : 0.8));
      u.x = L.wide ? u.fx * L.wv : u.fx * L.wv * 1.6;
    }

    // Rebuild only what the new size actually changes: the field when the width changes,
    // the underground when the width changes or the page length moves by more than a few percent.
    const fKey = Math.round(L.wv * 10);
    if (force || fKey !== L.fKey) { L.fKey = fKey; buildFlora(); renderer.shadowMap.needsUpdate = true; }
    if (force || fKey !== L.gKey || Math.abs(L.depth - L.gDepth) > L.gDepth * 0.04) {
      L.gKey = fKey; L.gDepth = L.depth;
      buildUnderground();
    }
  }

  // ---------- camera path ----------
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  if (!reduce) addEventListener("pointermove", (e) => { pointer.x = e.clientX / innerWidth - 0.5; pointer.y = e.clientY / innerHeight - 0.5; }, { passive: true });

  function camY(scroll) {
    const yB = -L.h * 0.15;
    if (scroll >= L.vh) return yB - (scroll - L.vh) * L.k;
    // Hermite from the hero pose down to the 1:1 track, arriving at the track's speed.
    const t = clamp01(scroll / L.vh);
    const h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h01 = -2 * t ** 3 + 3 * t ** 2, h11 = t ** 3 - t ** 2;
    return L.heroY * h00 + yB * h01 + -L.h * h11;
  }

  let reveal = reduce ? 1e6 : 0;
  // Shaders are compiled ahead of the first frame (in parallel where the browser can), so the
  // first frame does not stall the page.
  let compile = 0; // 0 not started, 1 compiling, 2 done
  let last = performance.now(), ready = false, lost = false;
  const state = { depth: 0 };
  let lightV = 0;

  function frame(now = performance.now()) {
    if (lost) return;
    const raw = (now - last) / 1000;
    const dt = Math.min(0.05, raw); last = now;
    // Measure once the page has settled, in windows of 60 frames. A window is slow when the average is
    // under ~48 fps, or when more than 1 frame in 8 stutters (over 25 ms). Stutter counts on its own:
    // on Intel HD + Firefox the first screen averaged 46 fps with 30% stuttering frames, which the
    // old average-only rule (under 38 fps, twice in a row) never caught. Two slow windows in a row
    // step the quality down, so one hiccup does not.
    if (ready && now - readyAt > 2000 && document.visibilityState === "visible" && raw < 0.5) {
      perf.sum += raw;
      if (raw > 0.025) perf.jank++;
      if (++perf.n === 60) {
        const slow = perf.sum / perf.n > 0.021 || perf.jank / perf.n > 0.125;
        perf.slow = Q.adapt && slow ? perf.slow + 1 : 0;
        if (perf.slow >= 2) { perf.slow = 0; stepDown(); }
        perf.n = 0; perf.sum = 0; perf.jank = 0;
      }
    }
    if (!reduce) time.value += dt;
    const scroll = getScroll ? getScroll() : scrollY;
    const t = clamp01(scroll / L.vh);
    const y = camY(scroll);
    pointer.sx += (pointer.x - pointer.sx) * Math.min(1, dt * 3);
    pointer.sy += (pointer.y - pointer.sy) * Math.min(1, dt * 3);
    camera.position.set(pointer.sx * 0.5, y, D);
    camera.rotation.set(L.heroPitch * (1 - smooth(t)) - pointer.sy * 0.012, -pointer.sx * 0.02, 0);

    // Roots grow just ahead of the bottom of the screen, and pull back up when scrolling back up.
    const front = -(y - L.h * 0.34) + 0.6;
    const target = Math.max(2.4, front);
    // Growth follows real time (not frame count), so slow devices are not left with half-grown roots.
    if (!reduce) reveal += (target - reveal) * Math.min(1, Math.min(raw, 0.5) * 1.9);
    roots.uniforms.uReveal.value = reveal;
    roots.uniforms.uTime.value = time.value;

    // Light / dark: the underground colours cross-fade over about half a second.
    const lightTarget = getLight && getLight() ? 1 : 0;
    if (lightV !== lightTarget) {
      lightV = reduce || compile < 2 ? lightTarget : lightV + (lightTarget - lightV) * Math.min(1, Math.min(raw, 0.5) * 6);
      if (Math.abs(lightV - lightTarget) < 0.002) lightV = lightTarget;
      faceMat.uniforms.uLight.value = lightV;
      roots.uniforms.uLight.value = lightV;
      pebbleMat.color.lerpColors(pebbleDark, pebbleLight, lightV);
    }

    const underground = clamp01(-y / (L.h * 0.6));
    rootLight.intensity = 2 + underground * 10;
    above.visible = y + L.h * 0.62 > 0;
    for (const c of clouds) { c.position.x += c.userData.v * dt * 0.8; if (c.position.x > 200) c.position.x = -200; }
    if (!reduce) tooth.rotation.y = 0.55 + Math.sin(time.value * 0.5) * 0.05;
    if (above.visible) for (const f of floaters) {
      const u = f.userData, tt = time.value;
      f.position.set(u.x + Math.sin(tt * 0.3 + u.ph) * 0.3, u.y + Math.sin(tt * 0.8 + u.ph) * 0.28, u.z);
      f.rotation.y += dt * u.spin;
      f.rotation.z = 0.2 + Math.sin(tt * 0.6 + u.ph) * 0.15;
    }
    state.depth = Math.max(0, -(y));

    if (compile < 2) {
      if (compile === 0 && toothReady && rootsReady) {
        compile = 1;
        const done = () => { compile = 2; };
        renderer.compileAsync ? renderer.compileAsync(scene, camera).then(done, done) : done();
      }
      return;
    }
    if (window.__earth?.paused) return; // ?bench&zone measures the page with no 3D drawing
    if (warmRoots) {
      // Draw every root band once, while the page is still at the top, so the browser uploads them
      // all now. Otherwise each band was uploaded the moment it first scrolled into view, which
      // made a visible hitch right where the camera goes below the ground (seen on iPhone).
      warmRoots = false;
      const culled = rootMeshes.filter((m) => m.frustumCulled);
      culled.forEach((m) => (m.frustumCulled = false));
      renderer.render(scene, camera);
      culled.forEach((m) => (m.frustumCulled = true));
    } else {
      renderer.render(scene, camera);
    }
    if (!ready) { ready = true; readyAt = now; onReady?.(); }
  }

  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); lost = true; onLost?.(); });

  layout(true);
  buildTeeth();
  let rt = 0;
  const onResize = () => { layout(false); clearTimeout(rt); rt = setTimeout(() => layout(false), 250); };
  addEventListener("resize", onResize);

  if (/debug|bench/.test(location.search)) window.__earth = { lite, Q, renderer, scene, roots, sun, above, below, tooth, sick, floaters, get flora() { return flora; }, face, L };
  return {
    frame,
    relayout: () => layout(false),
    get depth() { return state.depth; },
    get worldPerPx() { return L.k; },
  };
}
