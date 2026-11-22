// Scroll benchmark, loaded only with ?bench (see main.js). It waits for the 3D to be ready, scrolls the
// whole page by itself at an even speed, and shows how smooth it was, so it can be measured in any
// browser without touching the page. Add &q-adapt=0 to measure without the automatic quality steps.
const box = document.createElement("pre");
box.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:9999;margin:0;padding:12px 14px;max-width:min(92vw,520px);" +
  "background:rgba(0,0,0,.82);color:#fff;font:15px/1.5 ui-monospace,Consolas,monospace;direction:ltr;text-align:left;border-radius:10px;white-space:pre-wrap";
document.body.append(box);
const say = (t) => (box.textContent = t);
say("bench: waiting for the 3D…");

const root = document.documentElement;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// ?bench&zone: scrolls only the hero → underground stretch (top to one screen down and back), several
// times, each time with one part of the 3D switched off, to find what makes that stretch heavy.
// Needs the scene's debug handle, so earth.js exposes it for ?bench too.
async function zoneTest(readyMs) {
  const E = window.__earth, R = E.renderer, cv = R.domElement;
  const setPR = (v) => { R.setPixelRatio(v); R.setSize(cv.clientWidth, cv.clientHeight, false); };
  const pr0 = R.getPixelRatio();
  const runs = [
    ["as is", () => {}, () => {}],
    ["no root glow", () => (E.roots.glow.visible = false), () => (E.roots.glow.visible = true)],
    ["no trees/grass", () => (E.flora.visible = false), () => (E.flora.visible = true)],
    ["no roots", () => (E.below.visible = false), () => (E.below.visible = true)],
    ["resolution 1x", () => setPR(1), () => setPR(pr0)],
    ["no 3D drawing", () => (cv.style.visibility = "hidden", E.paused = true), () => (cv.style.visibility = "", E.paused = false)],
    ["as is (again)", () => {}, () => {}],
  ];
  const span = innerHeight * 1.1, out = [];
  for (const [name, on, off] of runs) {
    on(); scrollTo(0, 0); await wait(400);
    const d = [];
    let start = 0, prev = 0;
    await new Promise((done) => {
      const step = (now) => {
        if (!start) start = prev = now;
        if (now > prev) d.push(now - prev);
        prev = now;
        const p = (now - start) / 3000, x = p < 1 ? p : 2 - p; // down for 3 s, back up for 3 s
        scrollTo(0, Math.max(0, x) * span);
        say(`zone test: ${name}…`);
        if (p < 2) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
    off();
    const avg = d.reduce((a, b) => a + b, 0) / d.length, jank = d.filter((x) => x > 25).length / d.length;
    out.push(`${name.padEnd(15)} ${String(Math.round(1000 / avg)).padStart(3)} fps  ${String(Math.round(jank * 100)).padStart(3)}% janky`);
  }
  say(["ZONE TEST (top → one screen down)", `gpu: ${gpu}`, `screen: ${innerWidth}x${innerHeight} @${devicePixelRatio}x, 3D at ${pr0}x, ready ${readyMs} ms`, ...out].join("\n"));
}

const gpu = (() => {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const e = gl.getExtension("WEBGL_debug_renderer_info");
    return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch { return "?"; }
})();

(async () => {
  const t0 = performance.now();
  while (!root.classList.contains("gl-ready") && performance.now() - t0 < 30000) await wait(100);
  const readyMs = Math.round(performance.now());
  scrollTo(0, 0);
  await wait(2500);
  if (location.search.includes("zone")) return zoneTest(readyMs);

  const max = root.scrollHeight - innerHeight, dur = 24000, heroEnd = innerHeight;
  const parts = { hero: [], under: [] };
  let start = 0, prev = 0;
  await new Promise((done) => {
    const step = (now) => {
      if (!start) { start = prev = now; }
      const dt = now - prev; prev = now;
      if (dt > 0) (scrollY < heroEnd ? parts.hero : parts.under).push(dt);
      const p = Math.min(1, (now - start) / dur);
      scrollTo(0, p * max);
      say(`bench: scrolling… ${Math.round(p * 100)}%`);
      if (p < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });

  const sum = (a) => {
    if (!a.length) return "n/a";
    const s = [...a].sort((x, y) => x - y), avg = a.reduce((x, y) => x + y, 0) / a.length;
    const p95 = s[Math.floor(s.length * 0.95)], slow = a.filter((d) => d > 25).length / a.length;
    return `${Math.round(1000 / avg)} fps avg, 95% under ${p95.toFixed(0)} ms, ${(slow * 100).toFixed(0)}% janky frames`;
  };
  const all = [...parts.hero, ...parts.under];
  say([
    "BENCH RESULT",
    `browser: ${navigator.userAgent.match(/(Firefox|Edg|Chrome|Safari)\/[\d.]+/)?.[0] ?? "?"}`,
    `gpu: ${gpu}`,
    `screen: ${innerWidth}x${innerHeight} @${devicePixelRatio}x   3D ready at ${readyMs} ms`,
    `hero:  ${sum(parts.hero)}`,
    `below: ${sum(parts.under)}`,
    `all:   ${sum(all)}`,
    `quality now: ${root.dataset.quality ?? "-"}`,
  ].join("\n"));
})();
