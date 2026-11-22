// The teeth are built once (tools/bake.html) and shipped as assets/teeth.bin.gz, so visitors
// download a small file instead of running marching cubes on their phone (that took seconds).
//
// Layout (little-endian): "JTB2", u32 header length, header JSON (padded to 4 bytes), then per mesh,
// each block on a 4-byte boundary:
//   positions Int16, scaled to the mesh's box, stored as x…, y…, z… with each value minus the previous one
//   normals   Int8, stored as x…, y…, z…
//   colours   Uint8×3 per vertex (damaged teeth only)
//   index     Uint16 (Uint32 for big meshes), each value minus the previous one, zigzag-coded
// The deltas make the file gzip to about half; the server copy is gzipped by tools/bake-server.mjs.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/+esm";

const pad4 = (n) => (n + 3) & ~3;

export function encodeTeeth(meshes) {
  const parts = [], header = { meshes: [] };
  let offset = 0;
  const push = (arr) => { parts.push({ arr, offset }); const at = offset; offset = pad4(offset + arr.byteLength); return at; };
  for (const [name, g] of Object.entries(meshes)) {
    const p = g.getAttribute("position"), n = g.getAttribute("normal"), c = g.getAttribute("color"), idx = g.index;
    const count = p.count;
    g.computeBoundingBox();
    const min = g.boundingBox.min.toArray(), max = g.boundingBox.max.toArray();
    const pos = new Int16Array(count * 3), nor = new Int8Array(count * 3);
    for (let k = 0; k < 3; k++) {
      const span = max[k] - min[k] || 1;
      let prev = 0;
      for (let i = 0; i < count; i++) {
        const q = Math.round(((p.getComponent(i, k) - min[k]) / span) * 65535) - 32768;
        pos[k * count + i] = q - prev; prev = q;
        nor[k * count + i] = Math.round(Math.max(-1, Math.min(1, n.getComponent(i, k))) * 127);
      }
    }
    const m = { name, count, min, max, pos: push(pos), nor: push(nor) };
    if (c) {
      const col = new Uint8Array(count * 3);
      for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) col[i * 3 + k] = Math.round(Math.max(0, Math.min(1, c.getComponent(i, k))) * 255);
      m.col = push(col);
    }
    // Zigzag deltas need one spare bit, so Uint16 only holds meshes under 32768 vertices.
    const wide = count > 32767, ix = wide ? new Uint32Array(idx.count) : new Uint16Array(idx.count);
    let prev = 0;
    for (let i = 0; i < idx.count; i++) { const v = idx.array[i], d = v - prev; prev = v; ix[i] = (d << 1) ^ (d >> 31); }
    m.idx = push(ix); m.idxCount = idx.count; m.wide = wide;
    header.meshes.push(m);
  }
  const json = new TextEncoder().encode(JSON.stringify(header));
  const head = pad4(8 + json.length);
  const out = new Uint8Array(head + offset);
  out.set([74, 84, 66, 50]); // "JTB2"
  new DataView(out.buffer).setUint32(4, json.length, true);
  out.set(json, 8);
  for (const { arr, offset: at } of parts) out.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), head + at);
  return out;
}

export function decodeTeeth(buffer) {
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== 0x3242544a) throw new Error("not a teeth file");
  const len = dv.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, len)));
  const base = pad4(8 + len), out = {};
  for (const m of header.meshes) {
    const n = m.count;
    const q = new Int16Array(buffer, base + m.pos, n * 3), qn = new Int8Array(buffer, base + m.nor, n * 3);
    const pos = new Float32Array(n * 3), nor = new Int8Array(n * 3);
    for (let k = 0; k < 3; k++) {
      const lo = m.min[k], span = m.max[k] - m.min[k];
      let acc = 0;
      for (let i = 0; i < n; i++) {
        acc = (acc + q[k * n + i]) << 16 >> 16; // the deltas wrap like Int16
        pos[i * 3 + k] = lo + ((acc + 32768) / 65535) * span;
        nor[i * 3 + k] = qn[k * n + i];
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3, true));
    if (m.col !== undefined) g.setAttribute("color", new THREE.BufferAttribute(new Uint8Array(buffer, base + m.col, n * 3), 3, true));
    const zz = m.wide ? new Uint32Array(buffer, base + m.idx, m.idxCount) : new Uint16Array(buffer, base + m.idx, m.idxCount);
    const ix = m.wide ? new Uint32Array(m.idxCount) : new Uint16Array(m.idxCount);
    let prev = 0;
    for (let i = 0; i < m.idxCount; i++) {
      const z = zz[i], d = (z >>> 1) ^ -(z & 1);
      prev += d; ix[i] = prev;
    }
    g.setIndex(new THREE.BufferAttribute(ix, 1));
    g.computeBoundingSphere();
    out[m.name] = g;
  }
  return out;
}

// Fetches and unpacks assets/teeth.bin.gz. Resolves to null when anything is missing, so the caller
// can fall back to building the teeth itself (e.g. very old browsers without DecompressionStream).
export async function loadTeeth(url) {
  try {
    if (typeof DecompressionStream === "undefined") return null;
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    return buf;
  } catch {
    return null;
  }
}
