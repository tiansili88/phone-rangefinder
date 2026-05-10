// Human Rangefinder — single-file app, no dependencies.
// Math:
//   parallax tick from "infinity" end:  x_mm = E_mm * L_mm / D_mm
//   "0" tick (closest measurable) at:   x_mm = E_mm   (parallax = eye separation)
//   hyperfocal distance:                H_mm = f^2 / (N * c)
//   default circle of confusion:        c = film_diagonal_mm / 1500
//
// Rendering: the rangefinder scale is an SVG with viewBox in millimetres,
// sized in pixels using the calibrated px/mm so it appears at exact physical
// size. The hyperfocal table is plain HTML.

const CAL_KEY = "rfcard.pxPerMm";

const FILM_DIAG = {
  "811":  Math.hypot(8, 11),
  "110":  Math.hypot(13, 17),
  "half": Math.hypot(18, 24),    // half-frame 35mm
  "135":  Math.hypot(24, 36),
  "645":  Math.hypot(42, 56),
  "66":   Math.hypot(56, 56),
  "67":   Math.hypot(56, 70),
  "69":   Math.hypot(56, 84),
  "612":  Math.hypot(56, 118),
  "617":  Math.hypot(56, 168),
  "45":   Math.hypot(102, 127),
  "57":   Math.hypot(127, 178),
  "810":  Math.hypot(203, 254),
};

const FONT_SIZE_MM = 3.4;   // always-large; previously a user setting

const DEFAULT_DIS = {
  meter: "0.8, 1, 1.5, 2, 3, 5, 10",
  feet:  "2, 3, 4, 6, 10, 20",
};

// Standard f-stops: each entry is {name (displayed), exact (= √2ⁿ)}.
// The exact value matters for hyperfocal accuracy — "f/11" is really 11.314.
const STD_STOPS = (() => {
  const sqrt2 = Math.SQRT2;
  return Array.from({ length: 14 }, (_, n) => {
    const exact = Math.pow(sqrt2, n);
    const name = [1, 1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22, 32, 45, 64, 90][n];
    return { name, exact };
  });
})();

const $ = (id) => document.getElementById(id);

// ───────────────────── calibration ─────────────────────

function getPxPerMm() {
  const v = parseFloat(localStorage.getItem(CAL_KEY));
  return Number.isFinite(v) && v > 0 ? v : null;
}

function setPxPerMm(v) {
  localStorage.setItem(CAL_KEY, String(v));
}

let calWired = false;
function showCalibration() {
  $("calibration").hidden = false;
  const slider = $("cal-slider");
  const card = $("cal-card");
  const lbl = $("cal-pxmm");
  slider.value = String(getPxPerMm() || 3.78);
  applySlider();
  function applySlider() {
    const px = parseFloat(slider.value);
    card.style.width = (85.6 * px) + "px";
    lbl.textContent = px.toFixed(2);
  }
  if (!calWired) {
    slider.addEventListener("input", applySlider);
    $("cal-save").addEventListener("click", () => {
      setPxPerMm(parseFloat(slider.value));
      $("calibration").hidden = true;
      render();
    });
    calWired = true;
  }
}

// ───────────────────── parsing & math ─────────────────────

function parseDistances(str, units) {
  const factor = units === "feet" ? 304.8 : 1000;  // → mm
  return str.split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => parseFloat(s))
    .filter(n => Number.isFinite(n) && n > 0)
    .map(n => ({ label: trimNum(n), mm: n * factor }));
}

function trimNum(n) {
  return Number.isInteger(n) ? String(n) : String(+n.toFixed(2));
}

function fStopList(maxN, minN) {
  const out = [];
  if (Number.isFinite(maxN) && maxN > 0) out.push({ name: maxN, exact: maxN });
  for (const s of STD_STOPS) {
    if (s.name > maxN + 0.01 && s.name <= minN + 0.01) out.push(s);
  }
  return out;
}

function fmtStop(n) {
  return "f/" + (Number.isInteger(n) ? String(n) : String(+n.toFixed(1)));
}

function fmtDistance(mm, units) {
  if (units === "feet") return Math.round(mm / 304.8) + "ft";
  const m = mm / 1000;
  if (m >= 10) return Math.round(m) + "m";
  return (Math.round(m * 10) / 10) + "m";
}

// ───────────────────── SVG render ─────────────────────

const SVG_NS = "http://www.w3.org/2000/svg";

function el(name, attrs, text) {
  const e = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

// Builds just the rangefinder scale (no business-card frame).
// Returns { svg, widthMm, heightMm }.
function buildScale(opts) {
  const { eyeMm, armMm, distances, units, fontSize } = opts;

  const scaleLen = Math.max(eyeMm, ...distances.map(d => eyeMm * armMm / d.mm));
  const leftMargin = Math.max(2, fontSize * 1.2);
  const rightMargin = Math.max(2, fontSize * 2.6);   // room for ∞ glyph + unit
  const widthMm = scaleLen + leftMargin + rightMargin;

  const yTop = 0.4;
  const yBase = yTop + 2.2;            // short tick bottom = scale baseline
  const yLong = yBase + 0.6;           // long-tick bottom (0 and ∞)
  const yLabel = yLong + fontSize + 0.6;
  const heightMm = yLabel + 1.0;

  const xLeft = leftMargin;            // "0"
  const xRight = leftMargin + scaleLen; // "∞"
  const tickPos = (mm) => xRight - (eyeMm * armMm / mm);

  const svg = el("svg", {
    xmlns: SVG_NS,
    viewBox: `0 0 ${widthMm} ${heightMm}`,
    "shape-rendering": "geometricPrecision",
    "text-rendering": "geometricPrecision",
  });

  const ink = "#f1f1f1";

  svg.appendChild(el("line", {
    x1: xLeft, y1: yBase, x2: xRight, y2: yBase,
    stroke: ink, "stroke-width": 0.25,
  }));

  function drawTick(x, label, isAnchor) {
    const y2 = isAnchor ? yLong : yBase;
    svg.appendChild(el("line", {
      x1: x, y1: yTop, x2: x, y2: y2,
      stroke: ink, "stroke-width": isAnchor ? 0.45 : 0.25,
    }));
    svg.appendChild(el("text", {
      x, y: yLabel, "text-anchor": "middle",
      "font-size": fontSize, fill: ink,
      "font-family": "Helvetica, Arial, sans-serif",
    }, label));
  }

  // Hide "0" if a user distance falls within one label-width of it —
  // otherwise the closest user tick (e.g. "2 ft" with a 60 cm arm) and
  // the "0" mark sit on top of each other.
  const labelGap = fontSize * 1.2;
  const userTicks = distances
    .map(d => ({ x: tickPos(d.mm), label: d.label }))
    .filter(t => t.x >= xLeft - 0.1 && t.x <= xRight + 0.1);
  const showZero = !userTicks.some(t => Math.abs(t.x - xLeft) < labelGap);

  if (showZero) drawTick(xLeft, "0", true);
  for (const t of userTicks) drawTick(t.x, t.label, false);
  drawTick(xRight, "∞", true);

  // Unit suffix next to ∞ (with extra clearance — ∞ glyph is wide).
  svg.appendChild(el("text", {
    x: xRight + fontSize * 1.3, y: yLabel,
    "text-anchor": "start",
    "font-size": fontSize * 0.75,
    fill: "#9a9a9a",
    "font-style": "italic",
    "font-family": "Helvetica, Arial, sans-serif",
  }, units === "feet" ? "ft" : "m"));

  return { svg, widthMm, heightMm };
}

// Standard whole-stop range used for the flash exposure table.
const FLASH_STOPS = STD_STOPS.filter(s => s.name >= 2 && s.name <= 22);

function makeRow(stopName, distText) {
  const row = document.createElement("div");
  row.className = "hfd-row";
  const stop = document.createElement("span");
  stop.className = "stop";
  stop.textContent = fmtStop(stopName);
  const dist = document.createElement("span");
  dist.className = "dist";
  dist.textContent = distText;
  row.appendChild(stop);
  row.appendChild(dist);
  return row;
}

function makeSectionTitle(text) {
  const el = document.createElement("div");
  el.className = "hfd-title";
  el.textContent = text;
  return el;
}

// Builds the right-hand panel content: stitches together optional HFD
// and flash sections.
function buildSidePanel(opts) {
  const wrap = document.createElement("div");
  const hfd = buildHfdHtml(opts);
  if (hfd) wrap.appendChild(hfd);
  const flash = buildFlashHtml(opts);
  if (flash) {
    if (hfd) {
      const sep = document.createElement("hr");
      sep.className = "hfd-sep";
      wrap.appendChild(sep);
    }
    wrap.appendChild(flash);
  }
  return wrap.children.length ? wrap : null;
}

// Builds the hyperfocal table as plain HTML.
function buildHfdHtml(opts) {
  const { hfd, foclen, maxN, minN, film, cocOverride, units } = opts;
  if (!hfd) return null;

  const c = (cocOverride && cocOverride > 0)
    ? cocOverride
    : (FILM_DIAG[film] || FILM_DIAG["135"]) / 1500;
  const stops = fStopList(maxN, minN);

  const wrap = document.createElement("div");
  wrap.appendChild(makeSectionTitle(
    `Hyperfocal — ${trimNum(foclen)} mm  ${fmtStop(maxN)}–${fmtStop(minN)}`
  ));
  for (const N of stops) {
    const Hmm = (foclen * foclen) / (N.exact * c);
    wrap.appendChild(makeRow(N.name, fmtDistance(Hmm, units)));
  }
  return wrap;
}

// Flash exposure table.
//   gn_eff = gn_base × √(ISO / 100)
//   distance = gn_eff / aperture
// gn is entered in the user's chosen distance unit (feet or metres).
function buildFlashHtml(opts) {
  const { flash, iso, gn, units } = opts;
  if (!flash || !(gn > 0) || !(iso > 0)) return null;

  const gnEff = gn * Math.sqrt(iso / 100);
  const factor = units === "feet" ? 304.8 : 1000;
  const wrap = document.createElement("div");
  wrap.appendChild(makeSectionTitle(
    `Flash — ISO ${iso}, GN ${trimNum(+gnEff.toFixed(1))}`
  ));
  for (const N of FLASH_STOPS) {
    const distUserUnits = gnEff / N.exact;
    wrap.appendChild(makeRow(N.name, fmtDistance(distUserUnits * factor, units)));
  }
  return wrap;
}

// ───────────────────── form wiring ─────────────────────

// Read either an <input>/<select>'s .value or a .seg-toggle's dataset.value.
function fieldValue(id) {
  const node = $(id);
  if (node.classList && node.classList.contains("seg-toggle")) {
    return node.dataset.value;
  }
  return node.value;
}

function readForm() {
  const units = fieldValue("units");
  return {
    eyeMm: parseFloat($("eye").value) * 10,
    armMm: parseFloat($("arm").value) * 10,
    distances: parseDistances($("dis").value, units),
    units,
    fontSize: FONT_SIZE_MM,
    hfd: $("hfd").checked,
    foclen: parseFloat($("foclen").value),
    maxN: parseFloat($("maxf").value),
    minN: parseFloat($("minf").value),
    film: fieldValue("film"),
    cocOverride: parseFloat($("coc").value) || 0,
    flash: $("flash").checked,
    iso: parseFloat($("iso").value),
    gn: parseFloat($("gn").value) || 0,
  };
}

function render() {
  const pxPerMm = getPxPerMm();
  if (!pxPerMm) { showCalibration(); return; }

  const opts = readForm();

  // Scale SVG
  const host = $("scale-host");
  host.innerHTML = "";
  const { svg, widthMm, heightMm } = buildScale(opts);
  const wPx = widthMm * pxPerMm;
  const hPx = heightMm * pxPerMm;
  svg.setAttribute("width", wPx);
  svg.setAttribute("height", hPx);
  host.style.width = wPx + "px";
  host.style.height = hPx + "px";
  host.appendChild(svg);

  // Right-hand panel (HFD + flash sections, shown only when their
  // checkboxes are on)
  const sidePanel = $("hfd-panel");
  sidePanel.innerHTML = "";
  const panelContent = buildSidePanel(opts);
  if (panelContent) sidePanel.appendChild(panelContent);
}

// Always-landscape: when viewport is portrait, rotate #rotwrap 90° (CW)
// and size it to viewport-height × viewport-width. Done in JS rather than
// CSS @media because Safari's handling of vh/vw on a transformed element
// is unreliable.
function applyRotation() {
  const wrap = $("rotwrap");
  if (!wrap) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w < h) {
    wrap.style.position = "absolute";
    wrap.style.top = "0";
    wrap.style.left = "0";
    wrap.style.width = h + "px";
    wrap.style.height = w + "px";
    wrap.style.transformOrigin = "0 0";
    wrap.style.transform = `translateX(${w}px) rotate(90deg)`;
  } else {
    wrap.style.cssText = "";
  }
}

// Wire segmented toggles: clicking an option updates active class +
// dataset.value, then dispatches a "change" event so the rest of the
// form-wiring picks it up.
function wireToggle(group) {
  group.addEventListener("click", e => {
    const opt = e.target.closest(".seg-opt");
    if (!opt || opt.classList.contains("active")) return;
    group.querySelectorAll(".seg-opt").forEach(o => o.classList.remove("active"));
    opt.classList.add("active");
    group.dataset.value = opt.dataset.value;
    group.dispatchEvent(new Event("change"));
  });
}

function init() {
  document.querySelectorAll(".seg-toggle").forEach(wireToggle);

  document.querySelectorAll("#rfform input, #rfform select, #rfform .seg-toggle").forEach(node => {
    node.addEventListener("input", render);
    node.addEventListener("change", render);
  });

  function refreshFieldsetDimming() {
    $("hfd-fields").style.opacity = $("hfd").checked ? "1" : "0.4";
    $("flash-fields").style.opacity = $("flash").checked ? "1" : "0.4";
  }
  $("hfd").addEventListener("change", refreshFieldsetDimming);
  $("flash").addEventListener("change", refreshFieldsetDimming);
  refreshFieldsetDimming();

  // Keep the GN-unit hint in sync with the distance unit selector
  function refreshGnUnit() {
    $("gn-unit").textContent = fieldValue("units") === "feet" ? "ft" : "m";
  }
  $("units").addEventListener("change", refreshGnUnit);
  refreshGnUnit();

  $("use-defaults").addEventListener("click", () => {
    $("dis").value = DEFAULT_DIS[fieldValue("units")] || DEFAULT_DIS.meter;
    render();
  });

  $("units").addEventListener("change", () => {
    const cur = $("dis").value.replace(/\s/g, "");
    const u = fieldValue("units");
    const other = u === "meter" ? "feet" : "meter";
    if (cur === DEFAULT_DIS[other].replace(/\s/g, "")) {
      $("dis").value = DEFAULT_DIS[u];
    }
    render();
  });

  $("recalibrate").addEventListener("click", showCalibration);

  applyRotation();
  window.addEventListener("resize", applyRotation);
  window.addEventListener("orientationchange", applyRotation);

  render();
}

document.addEventListener("DOMContentLoaded", init);
