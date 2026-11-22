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
