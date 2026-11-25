// Screen mode, loaded only with ?tv (see main.js): for the display outside the clinic. Once the 3D is
// ready, the page scrolls down to the end by itself, rests, scrolls back up, rests, and repeats forever.
// No clicks needed. Add &speed=N to change the speed (pixels per second, default 70).
const root = document.documentElement;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const speed = Number(new URLSearchParams(location.search).get("speed")) || 70;

// No mouse pointer on the screen.
const style = document.createElement("style");
style.textContent = "html.tv, html.tv * { cursor: none !important; }";
document.head.append(style);
root.classList.add("tv");

// Keep the screen awake while the page is showing (where the browser allows it).
const keepAwake = async () => {
  try { if (document.visibilityState === "visible") await navigator.wakeLock?.request("screen"); } catch {}
};
keepAwake();
document.addEventListener("visibilitychange", keepAwake);

// Reload every hour at the top, so the screen picks up site updates and starts fresh.
const startedAt = Date.now();
let updated = false;
const reloadDue = () => (updated || Date.now() - startedAt > 3600 * 1000) && navigator.onLine;

// Every 2 minutes, ask the server when the site last changed; after a new deploy, reload right away
// (the scroll loop above checks this too, but this one does not wait for the end of a pass).
let stamp = null;
setInterval(async () => {
  try {
    const r = await fetch(location.pathname, { method: "HEAD", cache: "no-store" });
    const now = r.headers.get("last-modified") || r.headers.get("etag");
    if (stamp && now && now !== stamp) { updated = true; location.reload(); }
    stamp = now || stamp;
  } catch {}
}, 120000);

// Moves the page from one point to another at an even speed, easing in and out at the ends.
const glide = (from, to) => new Promise((done) => {
  const dist = Math.abs(to - from), dur = Math.max(1500, (dist / speed) * 1000);
  let start = 0;
  const step = (now) => {
    if (!start) start = now;
    const p = Math.min(1, (now - start) / dur);
    const e = p < 0.5 ? 2 * p * p : 1 - (2 - 2 * p) ** 2 / 2; // ease in-out
    scrollTo(0, from + (to - from) * e);
    if (p < 1) requestAnimationFrame(step); else done();
  };
  requestAnimationFrame(step);
});

(async () => {
  scrollTo(0, 0);
  const t0 = performance.now();
  while (!root.classList.contains("gl-ready") && performance.now() - t0 < 30000) await wait(200);
  await wait(6000); // let the first screen be seen
  for (;;) {
    const bottom = root.scrollHeight - innerHeight;
    await glide(scrollY, bottom);
    await wait(5000);
    await glide(scrollY, 0);
    if (reloadDue()) return location.reload();
    await wait(8000);
  }
})();
