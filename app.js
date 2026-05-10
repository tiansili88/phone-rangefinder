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
  "811": Math.hypot(8, 11),
  "110": Math.hypot(13, 17),
  "43":  Math.hypot(13.5, 18),
  "aps": Math.hypot(15.6, 23.6),
  "apsh":Math.hypot(19, 28.7),
  "135": Math.hypot(24, 36),
  "645": Math.hypot(42, 56),
  "66":  Math.hypot(56, 56),
  "67":  Math.hypot(56, 70),
  "69":  Math.hypot(56, 84),
  "612": Math.hypot(56, 118),
  "617": Math.hypot(56, 168),
  "45":  Math.hypot(102, 127),
  "57":  Math.hypot(127, 178),
  "810": Math.hypot(203, 254),
};

const FONT_SIZE = { small: 2.2, medium: 2.8, large: 3.4 };  // mm

const DEFAULT_DIS = {
  meter: "1, 1.5, 2, 3, 5, 10",
  feet:  "3, 4, 6, 10, 20",
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
  const sideMargin = Math.max(2, fontSize * 1.2);   // room for end labels
  const widthMm = scaleLen + sideMargin * 2;

  const yTop = 0.4;
  const yBase = yTop + 2.2;            // short tick bottom = scale baseline
  const yLong = yBase + 0.6;           // long-tick bottom (0 and ∞)
  const yLabel = yLong + fontSize + 0.6;
  const heightMm = yLabel + 1.0;

  const xLeft = sideMargin;            // "0"
  const xRight = sideMargin + scaleLen; // "∞"
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

  drawTick(xLeft, "0", true);
  for (const d of distances) {
    const x = tickPos(d.mm);
    if (x < xLeft - 0.1 || x > xRight + 0.1) continue;
    drawTick(x, d.label, false);
  }
  drawTick(xRight, "∞", true);

  // Unit suffix next to ∞
  svg.appendChild(el("text", {
    x: xRight + 0.6, y: yLabel,
    "text-anchor": "start",
    "font-size": fontSize * 0.75,
    fill: "#9a9a9a",
    "font-style": "italic",
    "font-family": "Helvetica, Arial, sans-serif",
  }, units === "feet" ? "ft" : "m"));

  return { svg, widthMm, heightMm };
}

// Builds the hyperfocal table as plain HTML in the right-hand panel.
function buildHfdHtml(opts) {
  const { hfd, foclen, maxN, minN, film, cocOverride, units } = opts;
  if (!hfd) return null;

  const c = (cocOverride && cocOverride > 0)
    ? cocOverride
    : (FILM_DIAG[film] || FILM_DIAG["135"]) / 1500;
  const stops = fStopList(maxN, minN);

  const wrap = document.createElement("div");

  const title = document.createElement("div");
  title.className = "hfd-title";
  title.textContent = `${trimNum(foclen)} mm  ${fmtStop(maxN)} – ${fmtStop(minN)}`;
  wrap.appendChild(title);

  for (const N of stops) {
    const Hmm = (foclen * foclen) / (N.exact * c);
    const row = document.createElement("div");
    row.className = "hfd-row";

    const stop = document.createElement("span");
    stop.className = "stop";
    stop.textContent = fmtStop(N.name);

    const dist = document.createElement("span");
    dist.className = "dist";
    dist.textContent = fmtDistance(Hmm, units);

    row.appendChild(stop);
    row.appendChild(dist);
    wrap.appendChild(row);
  }
  return wrap;
}

// ───────────────────── form wiring ─────────────────────

function readForm() {
  const units = $("units").value;
  return {
    eyeMm: parseFloat($("eye").value) * 10,
    armMm: parseFloat($("arm").value) * 10,
    distances: parseDistances($("dis").value, units),
    units,
    fontSize: FONT_SIZE[$("font").value] || FONT_SIZE.large,
    hfd: $("hfd").checked,
    foclen: parseFloat($("foclen").value),
    maxN: parseFloat($("maxf").value),
    minN: parseFloat($("minf").value),
    film: $("film").value,
    cocOverride: parseFloat($("coc").value) || 0,
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

  // HFD table
  const hfdPanel = $("hfd-panel");
  hfdPanel.innerHTML = "";
  const hfdHtml = buildHfdHtml(opts);
  if (hfdHtml) hfdPanel.appendChild(hfdHtml);
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

function init() {
  document.querySelectorAll("#rfform input, #rfform select").forEach(node => {
    node.addEventListener("input", render);
    node.addEventListener("change", render);
  });

  $("hfd").addEventListener("change", () => {
    $("hfd-fields").style.opacity = $("hfd").checked ? "1" : "0.4";
  });

  $("use-defaults").addEventListener("click", () => {
    $("dis").value = DEFAULT_DIS[$("units").value] || DEFAULT_DIS.meter;
    render();
  });

  $("units").addEventListener("change", () => {
    const cur = $("dis").value.replace(/\s/g, "");
    const other = $("units").value === "meter" ? "feet" : "meter";
    if (cur === DEFAULT_DIS[other].replace(/\s/g, "")) {
      $("dis").value = DEFAULT_DIS[$("units").value];
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
