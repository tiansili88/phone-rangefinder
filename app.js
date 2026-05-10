// Phone Rangefinder Card — single-file app, no dependencies.
// Math:
//   parallax tick from "infinity" end:  x_mm = E_mm * L_mm / D_mm
//   "0" tick (closest measurable) at:   x_mm = E_mm   (parallax = eye separation)
//   hyperfocal distance:                H_mm = f^2 / (N * c)
//   default circle of confusion:         c = film_diagonal_mm / 1500
//
// Rendering: SVG with viewBox in millimetres ("0 0 88.9 50.8"), then sized in
// pixels using the calibrated px/mm so it appears at exact physical size.

const CARD_W = 88.9;   // 3.5"
const CARD_H = 50.8;   // 2"
const CAL_KEY = "rfcard.pxPerMm";

// Film/sensor diagonals in mm
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

const FONT_SIZE = { small: 1.7, medium: 2.2, large: 2.8 };  // mm

const DEFAULT_DIS = {
  meter: "1, 1.5, 2, 3, 5, 10",
  feet:  "3, 4, 6, 10, 20",
};

// Standard f-stops: each entry is [displayed name, exact value = √2ⁿ].
// Using exact values is required for hyperfocal-distance accuracy — e.g.
// "f/11" is actually 11.314, which changes the HFD readout by ~1 unit at
// short focal lengths.
const STD_STOPS = (() => {
  const sqrt2 = Math.SQRT2;
  return Array.from({ length: 14 }, (_, n) => {
    const exact = Math.pow(sqrt2, n);   // n = 0,1,2,...
    const name = [1, 1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22, 32, 45, 64, 90][n];
    return { name, exact };
  });
})();

// ───────────────────── calibration ─────────────────────

const $ = (id) => document.getElementById(id);

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
    // Long side only — height is fixed in CSS.
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
  // "3" not "3.0", "1.5" stays "1.5"
  return Number.isInteger(n) ? String(n) : String(+n.toFixed(2));
}

// Returns objects {name, exact}. The user's max aperture is included as-is
// (it might be non-standard, e.g. f/3.5).
// Inclusion test uses the displayed name (e.g. "22") since that's what users
// type. The exact value (22.627) is what matters for the HFD math.
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
  if (units === "feet") {
    const ft = mm / 304.8;
    return Math.round(ft) + "ft";
  } else {
    const m = mm / 1000;
    if (m >= 10) return Math.round(m) + "m";
    return (Math.round(m * 10) / 10) + "m";
  }
}

// ───────────────────── SVG render ─────────────────────

const SVG_NS = "http://www.w3.org/2000/svg";

function el(name, attrs, text) {
  const e = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

function buildCard(opts) {
  const {
    title, eyeMm, armMm, distances, units, fontSize,
    hfd, foclen, maxN, minN, film, cocOverride,
  } = opts;

  const svg = el("svg", {
    xmlns: SVG_NS,
    viewBox: `0 0 ${CARD_W} ${CARD_H}`,
    "shape-rendering": "geometricPrecision",
    "text-rendering": "geometricPrecision",
  });

  // Card outline
  svg.appendChild(el("rect", {
    x: 0.15, y: 0.15, width: CARD_W - 0.3, height: CARD_H - 0.3,
    fill: "white", stroke: "black", "stroke-width": 0.2,
  }));

  // ── rangefinder scale ──
  // x = E*L/D from "infinity" end. "0" tick at x = E (where parallax = eye sep).
  // Scale length = E_mm. Place scale centred horizontally (with ≥3 mm side margins).
  const scaleLen = Math.max(eyeMm, ...distances.map(d => eyeMm * armMm / d.mm));
  const margin = Math.max(3, (CARD_W - scaleLen) / 2);
  const xLeft = margin;          // "0" position (close end)
  const xRight = margin + scaleLen; // "∞" position
  // Note: tick at distance D sits at  x = xRight - E*L/D  (so ∞ is at xRight, 0 is at xLeft)
  const tickPos = (mm) => xRight - (eyeMm * armMm / mm);

  const yTop = 0.4;            // top of ticks
  const yBase = 3.0;           // short-tick bottom = scale baseline
  const yLong = 3.6;           // long-tick bottom (for 0 and ∞)
  const yLabel = yLong + fontSize + 1.0;  // text baseline; clears yLong by ~1 mm + ascender

  // baseline
  svg.appendChild(el("line", {
    x1: xLeft, y1: yBase, x2: xRight, y2: yBase,
    stroke: "black", "stroke-width": 0.25,
  }));

  const tickGroup = el("g", { fill: "black", "font-family": "Helvetica, Arial, sans-serif" });
  svg.appendChild(tickGroup);

  // Helper to draw a tick + label
  function drawTick(x, label, isAnchor) {
    const y2 = isAnchor ? yLong : yBase;
    tickGroup.appendChild(el("line", {
      x1: x, y1: yTop, x2: x, y2: y2,
      stroke: "black", "stroke-width": isAnchor ? 0.4 : 0.25,
    }));
    tickGroup.appendChild(el("text", {
      x, y: yLabel, "text-anchor": "middle",
      "font-size": fontSize,
    }, label));
  }

  // "0" tick (closest, at x = E from infinity end)
  drawTick(xLeft, "0", true);
  // user distances
  for (const d of distances) {
    const x = tickPos(d.mm);
    if (x < xLeft - 0.1 || x > xRight + 0.1) continue;  // out of range
    drawTick(x, d.label, false);
  }
  // "∞" tick
  drawTick(xRight, "∞", true);

  // Unit indicator next to ∞ tick
  tickGroup.appendChild(el("text", {
    x: xRight + 1.2, y: yLabel,
    "text-anchor": "start",
    "font-size": fontSize * 0.8,
    "font-style": "italic",
  }, units === "feet" ? "ft" : "m"));

  // ── title + body ──
  const xPad = 3;
  let yCur = yLabel + fontSize * 1.6;

  if (title.trim()) {
    svg.appendChild(el("text", {
      x: xPad, y: yCur,
      "font-size": fontSize * 1.2,
      "font-family": "Helvetica, Arial, sans-serif",
      "font-weight": "bold",
    }, title));
    yCur += fontSize * 1.6;
  }

  if (hfd) {
    const c = (cocOverride && cocOverride > 0)
      ? cocOverride
      : (FILM_DIAG[film] || FILM_DIAG["135"]) / 1500;
    const stops = fStopList(maxN, minN);

    svg.appendChild(el("text", {
      x: xPad, y: yCur,
      "font-size": fontSize * 0.95,
      "font-family": "Helvetica, Arial, sans-serif",
      "font-style": "italic",
    }, `HFD: ${trimNum(foclen)}mm  ${fmtStop(maxN)}`));
    yCur += fontSize * 1.4;

    const rowH = fontSize * 1.25;
    const colF = xPad;
    const colD = xPad + fontSize * 5;

    for (const N of stops) {
      if (yCur + rowH > CARD_H - 1) break;
      const Hmm = (foclen * foclen) / (N.exact * c);
      svg.appendChild(el("text", {
        x: colF, y: yCur,
        "font-size": fontSize,
        "font-family": "Helvetica, Arial, sans-serif",
      }, fmtStop(N.name)));
      svg.appendChild(el("text", {
        x: colD, y: yCur,
        "font-size": fontSize,
        "font-family": "Helvetica, Arial, sans-serif",
      }, fmtDistance(Hmm, units)));
      yCur += rowH;
    }
  }

  return svg;
}

// ───────────────────── form wiring ─────────────────────

function readForm() {
  const units = $("units").value;
  return {
    title: $("title").value,
    eyeMm: parseFloat($("eye").value) * 10,
    armMm: parseFloat($("arm").value) * 10,
    distances: parseDistances($("dis").value, units),
    units,
    fontSize: FONT_SIZE[$("font").value] || FONT_SIZE.medium,
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
  const host = $("card-host");
  host.innerHTML = "";
  const svg = buildCard(opts);
  // Set physical size in pixels
  const wPx = CARD_W * pxPerMm;
  const hPx = CARD_H * pxPerMm;
  svg.setAttribute("width", wPx);
  svg.setAttribute("height", hPx);
  host.style.width = wPx + "px";
  host.style.height = hPx + "px";
  host.appendChild(svg);
}

function init() {
  // Wire up live updates
  document.querySelectorAll("#rfform input, #rfform select").forEach(node => {
    node.addEventListener("input", render);
    node.addEventListener("change", render);
  });

  // HFD-fields enable/disable follows checkbox
  const hfdFields = $("hfd-fields");
  $("hfd").addEventListener("change", () => {
    hfdFields.style.opacity = $("hfd").checked ? "1" : "0.4";
  });

  // "Use defaults for unit" button
  $("use-defaults").addEventListener("click", () => {
    $("dis").value = DEFAULT_DIS[$("units").value] || DEFAULT_DIS.meter;
    render();
  });

  // Auto-swap defaults when unit changes if the field still holds the *other* unit's defaults
  $("units").addEventListener("change", () => {
    const cur = $("dis").value.replace(/\s/g, "");
    const other = $("units").value === "meter" ? "feet" : "meter";
    if (cur === DEFAULT_DIS[other].replace(/\s/g, "")) {
      $("dis").value = DEFAULT_DIS[$("units").value];
    }
    render();
  });

  // Recalibrate
  $("recalibrate").addEventListener("click", showCalibration);

  // First render (or calibration if needed)
  render();
}

document.addEventListener("DOMContentLoaded", init);
