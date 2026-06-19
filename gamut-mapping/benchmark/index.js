import Color from "colorjs.io";
import { representatives } from "../methods.js";
import { mapColor, getDeltas, defaultWeights as weights } from "../map.js";
import stats, { average } from "../stats.js";

// ── Config ───────────────────────────────────────────────────────────────────

// Fixed out-of-gamut input chroma; 0.4 = the app's MAX_CHROMA cap, so every
// sample starts already at the cap (the "C clip" is a no-op, as in the app).
const CHROMA = 0.4;

// Grid resolution and swept ranges, overridable via URL params: hs / ls are the
// hue (°) and lightness steps; h / l are "min-max" ranges (inclusive). E.g.
// ?hs=5&ls=0.1 for a quick coarse pass, or ?h=100-160&l=0.4-0.6 to zoom a band.
const params = new URLSearchParams(location.search);
// Numeric URL param, falling back to a default when absent or invalid.
const num = (name, fallback) => {
	let value = parseFloat(params.get(name));
	return Number.isFinite(value) ? value : fallback;
};
// Like num, but rejects non-positive steps so the sweep loops can't run forever.
const step = (name, fallback) => Math.max(num(name, fallback), 0) || fallback;
// Parse a "min-max" range param into [min, max], or null when absent/invalid.
const range = name => {
	let [min, max] = (params.get(name) ?? "").split("-").map(v => parseFloat(v));
	return Number.isFinite(min) && Number.isFinite(max) ? [min, max] : null;
};

// Hue defaults to the full circle (0–359; 360 ≡ 0). Lightness runs from lMax
// (top) down to lMin, defaulting to one step inside 0 and 1 so pure black/white
// (whose chroma collapses) are excluded even when the step changes.
let hueStep = step("hs", 1);
let lStep = step("ls", 0.01);
let [hueMin, hueMax] = range("h") ?? [0, 359];
let [lMin, lMax] = range("l") ?? [lStep, 1 - lStep];

// Keep each field roughly this tall regardless of resolution, so rows get
// thinner as the grid densifies rather than the page growing taller.
const FIELD_HEIGHT = 140; // px

// Per-frame compute budget; we yield to the browser past this so the page stays
// responsive and the fill animates row by row.
const FRAME_BUDGET = 12; // ms

const prec = Color.util.toPrecision;

// Delta metrics the avg/min/max/median stats can report on (keys match getDeltas).
const METRICS = {
	error: "Error",
	E2K: "ΔE2000",
	EOK: "ΔEOK",
};

// Keys the rows can be sorted by. "time" reads the shared timing average; the
// rest read the active metric's summary. All are smaller-is-better.
const SORTS = {
	time: "Time",
	avg: "Average",
	min: "Min",
	max: "Max",
	median: "Median",
};

// ── State ────────────────────────────────────────────────────────────────────

// What the rows are sorted by, and which delta the stats summarize. Sort by
// timing by default.
let view = {sort: "time", metric: "error"};

let fields = document.querySelector("#fields");
let inspector = document.querySelector("#inspector");
let progress = document.querySelector("#progress");
let statusEl = document.querySelector("#status");

let gmas = []; // per-GMA state: {id, config, gutter, fieldWrap, table, statEls, samples, n}
let axes; // {hues, lightnesses}
let rafId = null;
let lastRender = 0; // throttle for the live stats render during a sweep

// ── DOM helpers ──────────────────────────────────────────────────────────────

function el (tag, attrs = {}, ...children) {
	let node = document.createElement(tag);
	for (let [name, value] of Object.entries(attrs)) {
		name === "class" ? (node.className = value) : node.setAttribute(name, value);
	}
	node.append(...children.flat().map(c => (typeof c === "string" ? document.createTextNode(c) : c)));
	return node;
}

// Hue values across, lightness values down (lightest first → top row).
function buildAxes () {
	let hues = [];
	for (let h = hueMin; h <= hueMax; h += hueStep) {
		hues.push(h);
	}
	// Step over integer multiples of lStep to avoid float accumulation.
	let lDen = Math.round(1 / lStep); // 10 for 0.1, 100 for 0.01
	let lightnesses = [];
	for (let i = Math.round(lMax * lDen); i >= Math.round(lMin * lDen); i--) {
		lightnesses.push(i / lDen);
	}
	return {hues, lightnesses};
}

// Build the per-GMA rows (gutter + empty field table) and the hover inspector.
function buildUI () {
	axes = buildAxes();
	fields.replaceChildren();
	let total = axes.hues.length * axes.lightnesses.length;

	gmas = Object.entries(representatives).map(([id, config]) => {
		let stat = cls => el("dd", {class: cls}, "—");
		let statEls = {avg: stat("avg"), min: stat("min"), max: stat("max"), median: stat("median"), time: stat("time")};
		let dl = el("dl", {class: "stats"},
			el("div", {}, el("dt", {}, "avg"), statEls.avg),
			el("div", {}, el("dt", {}, "min"), statEls.min),
			el("div", {}, el("dt", {}, "max"), statEls.max),
			el("div", {}, el("dt", {}, "med"), statEls.median),
			el("div", {}, el("dt", {}, "Δt"), statEls.time),
		);
		let gutter = el("div", {class: "gutter"}, el("h2", {}, config.label ?? id), dl);

		let table = el("table", {class: "field"});
		table.style.setProperty("--row-h", FIELD_HEIGHT / axes.lightnesses.length + "px");
		let fieldWrap = el("div", {class: "field-wrap"}, table);

		fields.append(gutter, fieldWrap);

		// Per-patch deltas, kept so the metric/sort controls (and the median) can
		// recompute without re-running the sweep.
		let samples = Object.fromEntries(Object.keys(METRICS).map(m => [m, new Float32Array(total)]));
		return {id, config, gutter, fieldWrap, table, statEls, samples, n: 0};
	});

	buildInspector();
}

// The hovered patch's coordinates + one mapped-color swatch per GMA. The input
// itself isn't shown: it's out of gamut, so the browser's rendering of it is
// wrong. Swatches are plain divs — we only ever set their background.
function buildInspector () {
	let coords = el("span", {class: "coords"}, "Hover a patch to inspect");
	let list = el("div", {class: "inspect-gmas"});

	for (let g of gmas) {
		g.inspectSwatch = el("div", {class: "swatch"});
		g.inspectErr = el("span", {class: "gerr"}, "");
		list.append(el("div", {class: "inspect-gma"},
			g.inspectSwatch,
			el("span", {class: "gname"}, g.config.label ?? g.id),
			g.inspectErr,
		));
	}

	inspector.replaceChildren(coords, list);
	inspector._coords = coords;
}

// ── Inspector: all GMAs for one patch ────────────────────────────────────────

// Recompute a single patch across every GMA. Calls compute() directly (not
// mapColor) so hovering never adds to the timing stats.
function inspect (l, h) {
	let color = new Color("oklch", [l, CHROMA, h]);
	let oklch = [l, CHROMA, h];
	inspector._coords.textContent = `oklch(${prec(l, 3)} ${CHROMA} ${h})`;

	for (let g of gmas) {
		let mapped = g.config.compute(color);
		let deltas = getDeltas(color, mapped, oklch, weights);
		g.inspectSwatch.style.background = mapped.to("p3").toString({precision: 3});
		g.inspectErr.textContent = prec(deltas[view.metric], 2);
	}
}

fields.addEventListener("pointerover", e => {
	let td = e.target.closest("td");
	if (!td) {
		return;
	}
	let h = axes.hues[td.cellIndex];
	let l = axes.lightnesses[td.parentElement.rowIndex];
	if (h !== undefined && l !== undefined) {
		inspect(l, h);
	}
});

// ── Sweep ────────────────────────────────────────────────────────────────────

function run () {
	cancelAnimationFrame(rafId);

	// Fresh timing for this run (stats is a shared singleton across the app).
	Object.keys(stats.methods).forEach(id => delete stats.methods[id]);
	stats.totalColors = 0;

	buildUI();

	let {hues, lightnesses} = axes;
	let row = 0;
	let start = performance.now();
	lastRender = 0;

	function frame () {
		let frameStart = performance.now();

		// At least one full lightness row per frame; more until the budget runs out.
		do {
			let l = lightnesses[row];
			let cells = gmas.map(() => "");

			for (let h of hues) {
				let color = new Color("oklch", [l, CHROMA, h]);
				let oklch = [l, CHROMA, h];
				let mapped = mapColor(color, representatives); // timed (incl. final P3 clip)

				gmas.forEach((g, gi) => {
					let mc = mapped[g.id];
					// Deltas are measured outside the timed region.
					let deltas = getDeltas(color, mc, oklch, weights);
					for (let m in METRICS) {
						g.samples[m][g.n] = deltas[m];
					}
					g.n++;
					cells[gi] += `<td style="background:${mc.to("p3").toString({precision: 3})}"></td>`;
				});
			}

			gmas.forEach((g, gi) => g.table.insertAdjacentHTML("beforeend", `<tr>${cells[gi]}</tr>`));
			row++;
		}
		while (row < lightnesses.length && performance.now() - frameStart < FRAME_BUDGET);

		progress.value = row / lightnesses.length;
		let done = row >= lightnesses.length;
		let now = performance.now();

		// Stats recompute sorts each metric's samples (for the median), so throttle
		// it rather than running it every frame.
		if (done || now - lastRender > 150) {
			renderStats();
			lastRender = now;
		}

		statusEl.textContent = `${stats.totalColors.toLocaleString()} colors × ${gmas.length} GMAs · ${prec((now - start) / 1000, 2)}s${done ? " · done" : ""}`;

		if (!done) {
			rafId = requestAnimationFrame(frame);
		}
	}

	rafId = requestAnimationFrame(frame);
}

// ── Stats display ────────────────────────────────────────────────────────────

function formatTime (ms) {
	return ms < 1 ? `${prec(ms * 1000, 3)} µs` : `${prec(ms, 3)} ms`;
}

// avg/min/max/median over the first n entries of a metric's samples. The typed
// array sorts numerically, so the median is exact.
function summarize (values, n) {
	if (!n) {
		return null;
	}
	let sum = 0, min = Infinity, max = -Infinity;
	for (let i = 0; i < n; i++) {
		let v = values[i];
		sum += v;
		min = Math.min(min, v);
		max = Math.max(max, v);
	}
	let sorted = values.slice(0, n).sort();
	let mid = n >> 1;
	let median = n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
	return {avg: sum / n, min, max, median};
}

// The value a GMA is ranked by under the active sort (smaller = better).
function sortValue (g, summary) {
	if (view.sort === "time") {
		return average(g.id) ?? Infinity;
	}
	return summary ? summary[view.sort] : Infinity;
}

// Recompute every GMA's summary for the active metric, write the stats, order
// the rows by the active sort, and flag the best/worst.
function renderStats () {
	let summaries = gmas.map(g => summarize(g.samples[view.metric], g.n));
	let keys = gmas.map((g, i) => sortValue(g, summaries[i]));

	// Order rows via CSS `order` (gutter + field share a value, so the pair moves
	// together) rather than moving DOM nodes.
	gmas.map((_, i) => i).sort((a, b) => keys[a] - keys[b]).forEach((gi, rank) => {
		gmas[gi].gutter.style.order = rank;
		gmas[gi].fieldWrap.style.order = rank;
	});

	let valid = keys.filter(Number.isFinite);
	let best = Math.min(...valid), worst = Math.max(...valid);

	gmas.forEach((g, i) => {
		let s = summaries[i];
		g.statEls.avg.textContent = s ? prec(s.avg, 3) : "—";
		g.statEls.min.textContent = s ? prec(s.min, 3) : "—";
		g.statEls.max.textContent = s ? prec(s.max, 3) : "—";
		g.statEls.median.textContent = s ? prec(s.median, 3) : "—";
		let t = average(g.id);
		g.statEls.time.textContent = t !== null ? formatTime(t) : "—";

		// Best/worst on the active sort key (skip "worst" when everything ties).
		g.gutter.classList.toggle("best", keys[i] === best);
		g.gutter.classList.toggle("worst", keys[i] === worst && worst !== best);
	});
}

// Sort + metric pickers, populated from SORTS / METRICS.
function buildControls () {
	let picker = (text, options, current, onChange) => {
		let select = el("select");
		for (let [value, label] of Object.entries(options)) {
			let option = el("option", {value}, label);
			option.selected = value === current;
			select.append(option);
		}
		select.addEventListener("change", () => {
			onChange(select.value);
			renderStats();
		});
		return el("label", {}, text + " ", select);
	};

	document.querySelector("#view-controls").append(
		picker("Sort by", SORTS, view.sort, v => (view.sort = v)),
		picker("Metric", METRICS, view.metric, v => (view.metric = v)),
	);
}

// ── Init ─────────────────────────────────────────────────────────────────────

document.querySelector("#restart").addEventListener("click", run);
buildControls();
run();
