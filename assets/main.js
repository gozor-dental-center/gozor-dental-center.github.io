// DOM, motion and booking. The 3D world lives in earth.js and is loaded separately,
// so the page keeps working if WebGL or the three.js CDN is unavailable.

const root = document.documentElement;
root.classList.add("js");

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;
const hasGsap = Boolean(gsap && ScrollTrigger);
if (hasGsap) gsap.registerPlugin(ScrollTrigger);

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- Clinic details from config.js ---------- */
const clinic = window.JOZOUR || {};
const toDigits = (s) => String(s || "").replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[^\d+]/g, "");

$$("[data-clinic]").forEach((el) => {
  const key = el.dataset.clinic;
  const value = (clinic[key] || "").trim();
  if (!value) {
    el.textContent = el.dataset.placeholder;
    el.classList.add("is-missing");
    if (el.tagName === "A") el.removeAttribute("href");
    return;
  }
  el.textContent = value;
  if (el.tagName !== "A") return;
  if (key === "phone") { el.href = `tel:${toDigits(value)}`; el.dir = "ltr"; }
  if (key === "whatsapp") { el.href = `https://wa.me/${toDigits(value).replace(/^\+/, "")}`; el.target = "_blank"; el.rel = "noopener"; el.dir = "ltr"; }
  if (key === "address") {
    if (clinic.mapUrl) { el.href = clinic.mapUrl; el.target = "_blank"; el.rel = "noopener"; }
    else el.removeAttribute("href");
  }
});
// Before / after sliders: the range input moves the dividing line.
$$(".ba-range").forEach((r) => {
  const set = () => r.parentElement.style.setProperty("--p", `${r.value}%`);
  r.addEventListener("input", set);
  set();
});
// Map buttons (the rating card and the location button) open Google Maps, or hide without a link.
$$("[data-map-link]").forEach((el) => {
  if (clinic.mapUrl) { el.href = clinic.mapUrl; el.target = "_blank"; el.rel = "noopener"; }
  else if (el.hasAttribute("data-map-only")) el.hidden = true;
  else el.removeAttribute("href");
});

/* ---------- Scrolling ----------
   The browser's own scrolling, so the page keeps moving smoothly even when the 3D frame is slow
   (a smooth-scroll library would only move the page as fast as the 3D can draw). */
const lenis = null;

const header = $("#header");
const nav = $("#nav");
const menuBtn = $(".menu-btn");
const headerOffset = () => header.offsetHeight + 8;

function closeMenu() {
  nav.classList.remove("is-open");
  menuBtn.setAttribute("aria-expanded", "false");
}
menuBtn.addEventListener("click", () => {
  const open = !nav.classList.contains("is-open");
  nav.classList.toggle("is-open", open);
  menuBtn.setAttribute("aria-expanded", String(open));
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && nav.classList.contains("is-open")) { closeMenu(); menuBtn.focus(); }
});

function goTo(target) {
  if (lenis) lenis.scrollTo(target, { offset: target.id === "top" ? 0 : -headerOffset(), duration: 1.4 });
  else target.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
  target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
}
document.addEventListener("click", (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  const id = a.getAttribute("href").slice(1);
  const target = id && document.getElementById(id);
  if (!target) return;
  e.preventDefault();
  closeMenu();
  goTo(target);
});

/* ---------- Light / dark ---------- */
const themeBtn = $(".theme-btn");
const isLight = () => root.classList.contains("theme-light");
let themeT = 0;
function syncThemeBtn() {
  const t = isLight() ? "التبديل إلى الوضع الداكن" : "التبديل إلى الوضع الفاتح";
  themeBtn.setAttribute("aria-label", t);
  themeBtn.title = t;
}
themeBtn.addEventListener("click", () => {
  // Colours fade across for a moment instead of jumping.
  root.classList.add("theme-anim");
  clearTimeout(themeT);
  themeT = setTimeout(() => root.classList.remove("theme-anim"), 700);
  root.classList.toggle("theme-light");
  try { localStorage.setItem("jozour-theme", isLight() ? "light" : "dark"); } catch {}
  syncThemeBtn();
});
syncThemeBtn();

const onScrollHeader = () => header.classList.toggle("is-scrolled", window.scrollY > 24);
addEventListener("scroll", onScrollHeader, { passive: true });
onScrollHeader();

/* ---------- Above / below ground: header and colours switch once the hero scrolls away ---------- */
const onScrollGround = () => root.classList.toggle("is-under", window.scrollY > innerHeight * 0.55);
addEventListener("scroll", onScrollGround, { passive: true });
onScrollGround();

/* ---------- Word splitting (accessible copy stays unsplit) ---------- */
function splitWords(el, inner = true) {
  const text = el.textContent.trim().replace(/\s+/g, " ");
  const words = text.split(" ").map((w) =>
    inner ? `<span class="w"><span class="wi">${escapeHtml(w)}</span></span>` : `<span class="sw">${escapeHtml(w)}</span>`
  );
  el.innerHTML = `<span class="sr-only">${escapeHtml(text)}</span><span aria-hidden="true">${words.join(" ")}</span>`;
  return $$(inner ? ".wi" : ".sw", el);
}

/* ---------- Motion ---------- */
if (hasGsap && !reduce) {
  // Hero intro: short, and the CTA is usable from the first frame.
  const heroWords = splitWords($(".hero-title"));
  gsap.timeline({ defaults: { ease: "expo.out" } })
    .from(".site-header", { y: -16, opacity: 0, duration: 0.9 })
    .from(".kicker", { y: 14, opacity: 0, duration: 0.8 }, 0.1)
    .from(heroWords, { yPercent: 110, duration: 1.1, stagger: 0.08 }, 0.15)
    .from("[data-hero-in]", { y: 18, opacity: 0, duration: 0.9, stagger: 0.08 }, 0.45);

  $$("[data-split]").forEach((el) => {
    if (el.classList.contains("hero-title")) return;
    const words = splitWords(el);
    gsap.from(words, {
      yPercent: 110, duration: 1, ease: "expo.out", stagger: 0.06,
      scrollTrigger: { trigger: el, start: "top 85%", once: true },
    });
  });

  $$("[data-scrub]").forEach((el) => {
    const words = splitWords(el, false);
    gsap.fromTo(words, { opacity: 0.16 }, {
      opacity: 1, ease: "none", stagger: 0.12,
      scrollTrigger: { trigger: el, start: "top 78%", end: "bottom 42%", scrub: true },
    });
  });

  $$("[data-reveal]").forEach((el) => {
    gsap.from(el, {
      y: 26, opacity: 0, duration: 0.8, ease: "power3.out",
      scrollTrigger: { trigger: el, start: "top 88%", once: true },
    });
  });

  gsap.from(".svc", {
    y: 36, opacity: 0, duration: 0.9, ease: "power3.out",
    scrollTrigger: { trigger: ".svc", start: "top 85%", once: true },
  });
}

/* ---------- Process timeline: the line fills as you scroll through it ---------- */
const steps = $$(".step");
const fill = $(".timeline-fill");
function setProgress(p) {
  const vertical = matchMedia("(max-width: 960px)").matches;
  fill.style.transform = vertical ? `scaleY(${p})` : `scaleX(${p})`;
  steps.forEach((s, i) => s.classList.toggle("is-active", p >= (vertical ? i / steps.length + 0.02 : i / (steps.length - 1) - 0.01)));
}
if (hasGsap && !reduce) {
  ScrollTrigger.create({
    trigger: ".timeline", start: "top 75%", end: "bottom 55%", scrub: true,
    onUpdate: (self) => setProgress(self.progress),
  });
} else {
  setProgress(1);
}

/* ---------- Services tabs ---------- */
const tabs = $$('[role="tab"]');
const panels = $$('[role="tabpanel"]');
let scene = null;

function selectTab(i, focus = false) {
  tabs.forEach((t, k) => {
    const on = k === i;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    panels[k].hidden = !on;
  });
  if (focus) tabs[i].focus();
  tabs[i].scrollIntoView({ block: "nearest", inline: "nearest" });
  if (hasGsap && !reduce) gsap.fromTo(panels[i], { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" });
}
tabs.forEach((t, i) => {
  t.addEventListener("click", () => selectTab(i));
  t.addEventListener("keydown", (e) => {
    const n = tabs.length;
    const map = { ArrowDown: i + 1, ArrowLeft: i + 1, ArrowUp: i - 1, ArrowRight: i - 1, Home: 0, End: n - 1 };
    if (!(e.key in map)) return;
    e.preventDefault();
    selectTab((map[e.key] + n) % n, true);
  });
});
panels.forEach((p, i) => { p.hidden = i !== 0; });

/* ---------- Booking ---------- */
const form = $("#book-form");
const status = $("#form-status");
const serviceSelect = $("#f-service");

$$("[data-book]").forEach((btn) => btn.addEventListener("click", () => {
  serviceSelect.value = btn.dataset.book;
  setTimeout(() => $("#f-name").focus({ preventScroll: true }), 50);
}));

function setError(input, msg) {
  const err = document.getElementById(input.getAttribute("aria-describedby"));
  err.textContent = msg;
  input.setAttribute("aria-invalid", msg ? "true" : "false");
  return !msg;
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  status.textContent = "";
  status.classList.remove("is-ok");
  const name = form.name.value.trim();
  const phone = toDigits(form.phone.value);
  const service = form.service.value;

  const okName = setError(form.name, name.length >= 2 ? "" : "اكتب اسمك.");
  const okPhone = setError(form.phone, /^(\+?20)?0?1[0125]\d{8}$/.test(phone) || /^\+\d{8,15}$/.test(phone) ? "" : "اكتب رقم هاتف محمول صحيحًا، مثل 01012345678.");
  const okService = setError(form.service, service ? "" : "اختر الخدمة.");
  if (!okName) return form.name.focus();
  if (!okPhone) return form.phone.focus();
  if (!okService) return form.service.focus();

  const note = form.note.value.trim();
  const msg = [
    "مرحبًا مركز جذور، أريد حجز موعد:",
    `الاسم: ${name}`,
    `رقم الهاتف: ${phone}`,
    `الخدمة: ${service}`,
    `الوقت المناسب: ${form.time.value}`,
    note && `ملاحظات: ${note}`,
  ].filter(Boolean).join("\n");

  const wa = toDigits(clinic.whatsapp).replace(/^\+/, "");
  if (wa) {
    // Some embedded viewers block window.open, so always leave a real link to tap as well.
    const url = `https://wa.me/${wa}?text=${encodeURIComponent(msg)}`;
    const win = window.open(url, "_blank", "noopener");
    status.innerHTML = "";
    status.append(win ? "فُتح واتساب برسالة الحجز، أرسلها وسنؤكد لك الموعد. إن لم يُفتح: " : "رسالة الحجز جاهزة: ");
    const a = Object.assign(document.createElement("a"), { href: url, target: "_blank", rel: "noopener", textContent: "افتح واتساب وأرسلها" });
    status.append(a);
    // Fallback for viewers that block WhatsApp (e.g. an embedded preview): copy the message and show the number.
    const alt = document.createElement("p");
    alt.className = "form-alt";
    alt.append("إن لم يعمل الرابط: انسخ الرسالة وأرسلها على واتساب إلى ");
    alt.append(Object.assign(document.createElement("bdi"), { dir: "ltr", textContent: clinic.whatsapp }));
    alt.append(" ");
    const copy = Object.assign(document.createElement("button"), { type: "button", className: "copy-btn", textContent: "انسخ الرسالة" });
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(msg); copy.textContent = "تم النسخ ✓"; }
      catch {
        let ta = status.querySelector(".copy-fallback");
        if (!ta) { ta = Object.assign(document.createElement("textarea"), { value: msg, readOnly: true, className: "copy-fallback" }); alt.after(ta); }
        ta.focus(); ta.select();
        copy.textContent = "حدّد النص وانسخه";
      }
    });
    alt.append(copy);
    status.append(alt);
    status.classList.add("is-ok");
  } else {
    status.textContent = "طلبك جاهز، لكن رقم واتساب المركز لم يُضف إلى الموقع بعد.";
  }
});
[form.name, form.phone, form.service].forEach((el) =>
  el.addEventListener("input", () => el.getAttribute("aria-invalid") === "true" && setError(el, ""))
);

/* ---------- 3D world ---------- */
// ?bench scrolls the page by itself and reports how smooth it was (for testing on real devices).
if (location.search.includes("bench")) import("./bench.js");
const canvas = $("#gl");
const docHeight = () => document.documentElement.scrollHeight;

import("./earth.js")
  .then(({ createScene }) => {
    scene = createScene(canvas, {
      reduce,
      getScroll: () => window.scrollY,
      getDocHeight: docHeight,
      getLight: isLight,
      onReady: () => root.classList.add("gl-ready"),
      onLost: () => root.classList.remove("gl-ready"),
    });
    // Its own loop, separate from scrolling and from the page animations.
    const loop = (t) => { scene.frame(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    // The root network is grown to the page length, so re-grow it when the page height settles.
    // Several of these fire close together on load; collapse them into one.
    let rt = 0;
    const relayout = () => { clearTimeout(rt); rt = setTimeout(() => scene.relayout(), 300); };
    if (hasGsap) ScrollTrigger.addEventListener("refresh", relayout);
    document.fonts?.ready.then(relayout);
    addEventListener("load", relayout);
  })
  .catch((err) => {
    console.warn("3D world unavailable, keeping the static poster.", err);
  });

if (hasGsap) {
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
  addEventListener("load", () => ScrollTrigger.refresh());
}
