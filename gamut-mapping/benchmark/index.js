import Color from "colorjs.io";
import { to, serialize, OKLCH, P3 } from "colorjs.io/fn";
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

// Per-frame compute budget; we yield to the browser past this so the page stays
// responsive and the fill animates row by row.
const FRAME_BUDGET = 12; // ms

const prec = Color.util.toPrecision;

// A plain OKLCh color object for the sweep's fixed input chroma. Procedural
// Color.js consumes these directly, with none of the per-color OOP overhead
// (getter/setter definition, result re-wrapping) that would otherwise skew the
// per-method timings. The space is the OKLCH object (not a string id), so no
// registry lookup happens on the timed path.
let oklchColor = (l, h) => ({space: OKLCH, coords: [l, CHROMA, h], alpha: 1});

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
	iqm: "IQM",
	median: "Median",
	min: "Min",
	max: "Max",
	stdev: "Stdev",
};

// Per-GMA stat rows in display order: timing first, then the active metric's
// summary. [key, label] — labels are terse for the narrow gutter; keys match the
// summarize() output (plus "time", read from the shared timing average).
const STAT_ROWS = [
	["time", "Δt"],
	["avg", "avg"],
	["iqm", "IQM"],
	["median", "med"],
	["min", "min"],
	["max", "max"],
	["stdev", "stdev"],
];

// ── State ────────────────────────────────────────────────────────────────────

// What the rows are sorted by, and which delta the stats summarize. Sort by
// timing by default.
let view = {sort: "time", metric: "error"};

let fields = document.querySelector("#fields");
let inspector = document.querySelector("#inspector");
let coords = inspector.querySelector(".coords"); // hovered patch's coordinates
let progress = document.querySelector("#progress");
let statusEl = document.querySelector("#status");

let gmas = []; // per-GMA state: {id, config, gutter, fieldWrap, table, statEls, samples, n}
let axes; // {hues, lightnesses}
let rafId = null;

// ── DOM helpers ──────────────────────────────────────────────────────────────

function el (tag, attrs = {}, ...children) {
	let node = document.createElement(tag);
	for (let [name, value] of Object.entries(attrs)) {
		name === "class" ? (node.className = value) : node.setAttribute(name, value);
	}
	node.append(...children.flat().map(c => (typeof c === "string" ? document.createTextNode(c) : c)));
	return node;
}

// An axis as a count + an index→value map, so the sweep's values and the form's
// live size estimate come from one definition. count is 0 for a degenerate range
// or step (so the form can't loop forever while you're mid-edit).

// Hue: inclusive values from min to max by step (1e-9 absorbs float drift).
function hueAxis (min, max, step) {
	let count = step > 0 && max >= min ? Math.floor((max - min) / step + 1e-9) + 1 : 0;
	return {count, at: i => min + i * step};
}

// Lightness: integer multiples of the step (avoids float accumulation), lightest
// first so the top row is brightest.
function lightnessAxis (min, max, step) {
	let den = Math.round(1 / step); // 10 for 0.1, 100 for 0.01
	let hi = Math.round(max * den), lo = Math.round(min * den);
	let count = step > 0 && den > 0 ? Math.max(0, hi - lo + 1) : 0;
	return {count, at: i => (hi - i) / den};
}

let axisValues = ({count, at}) => Array.from({length: count}, (_, i) => at(i));

// Hue values across, lightness values down, for the active grid.
function buildAxes () {
	return {
		hues: axisValues(hueAxis(hueMin, hueMax, hueStep)),
		lightnesses: axisValues(lightnessAxis(lMin, lMax, lStep)),
	};
}

// Build the per-GMA rows (gutter + empty field table) and the hover inspector.
function buildUI () {
	axes = buildAxes();
	fields.replaceChildren();
	let total = axes.hues.length * axes.lightnesses.length;

	gmas = Object.entries(representatives).map(([id, config]) => {
		let statEls = {};
		let dl = el("dl", {class: "stats"}, ...STAT_ROWS.map(([key, label]) => {
			let dd = statEls[key] = el("dd", {class: key}, "—");
			return el("div", {}, el("dt", {}, label), dd);
		}));
		let gutter = el("div", {class: "gutter"}, el("h2", {}, config.label ?? id), dl);

		let table = el("table", {class: "field"});
		let fieldWrap = el("div", {class: "field-wrap"}, table);

		fields.append(gutter, fieldWrap);

		// Per-patch deltas, kept so the metric/sort controls (and the median) can
		// recompute without re-running the sweep.
		let samples = Object.fromEntries(Object.keys(METRICS).map(m => [m, new Float32Array(total)]));
		return {id, config, gutter, fieldWrap, table, statEls, samples, n: 0};
	});

	buildInspector();
}

// Fill the inspector's per-GMA list — one swatch we tint to that GMA's mapped
// color plus an error readout. The shell (coords + list container) lives in the
// HTML; only these data-driven rows are built here. Swatches are plain divs: the
// input is out of gamut, so we never render it, only the mapped result.
function buildInspector () {
	let list = inspector.querySelector(".inspect-gmas");
	list.replaceChildren(...gmas.map(g => {
		g.inspectSwatch = el("div", {class: "swatch"});
		g.inspectErr = el("span", {class: "gerr"}, "");
		return el("div", {class: "inspect-gma"},
			g.inspectSwatch,
			el("span", {class: "gname"}, g.config.label ?? g.id),
			g.inspectErr,
		);
	}));
	// Resting state: just the prompt, not the (data-less) GMA list.
	inspector.classList.remove("active");
}

// ── Inspector: all GMAs for one patch ────────────────────────────────────────

// Recompute a single patch across every GMA. Calls compute() directly (not
// mapColor) so hovering never adds to the timing stats.
function inspect (l, h) {
	let color = oklchColor(l, h);
	let oklch = [l, CHROMA, h];
	inspector.classList.add("active");
	coords.textContent = `oklch(${prec(l, 3)} ${CHROMA} ${h})`;

	for (let g of gmas) {
		let mapped = g.config.compute(color);
		let deltas = getDeltas(color, mapped, oklch, weights);
		g.inspectSwatch.style.background = serialize(to(mapped, P3), {precision: 3});
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

// Collapse the per-GMA list when the pointer leaves the fields, but keep the
// last-hovered coordinates so the inspector still reads what you last inspected.
fields.addEventListener("pointerleave", () => {
	inspector.classList.remove("active");
});

// ── Sweep ────────────────────────────────────────────────────────────────────

// Active-run state, or null when idle. `elapsed` banks active time across pauses
// so the clock doesn't count paused time; `lastRender` throttles the live stats.
let sweep = null;

// Pause/Resume button: its label and `data-state` track the sweep, and clicking
// it drives pause()/resume(). (Restarting is just a reload, with or without new
// grid params — see the form's Go button.)
let toggle = document.querySelector("#toggle");
toggle.addEventListener("click", () => {
	if (toggle.dataset.state === "running") {
		pause();
	}
	else if (toggle.dataset.state === "paused") {
		resume();
	}
});

function setRunState (state) {
	toggle.textContent = state === "running" ? "Pause" : state === "paused" ? "Resume" : "Done";
	toggle.disabled = state === "done";
	toggle.dataset.state = state;
}

// Start a fresh sweep: reset timing (stats is a shared singleton across the app),
// rebuild the UI, and run from the top row.
function run () {
	cancelAnimationFrame(rafId);
	Object.keys(stats.methods).forEach(id => delete stats.methods[id]);
	stats.totalColors = 0;

	buildUI();

	sweep = {
		row: 0,
		start: performance.now(),
		elapsed: 0,
		lastRender: 0,
		total: axes.hues.length * axes.lightnesses.length, // target colors per GMA
	};
	setRunState("running");
	rafId = requestAnimationFrame(tick);
}

// One animation frame: map whole lightness rows until the budget runs out, paint
// them, refresh the throttled stats, and reschedule unless finished.
function tick () {
	let frameStart = performance.now();
	let {hues, lightnesses} = axes;

	// At least one full lightness row per frame; more until the budget runs out.
	do {
		let l = lightnesses[sweep.row];
		let cells = gmas.map(() => "");

		for (let h of hues) {
			let color = oklchColor(l, h);
			let oklch = [l, CHROMA, h];
			let mapped = mapColor(color, representatives); // timed (incl. final P3 clip)

			gmas.forEach((g, gi) => {
				let mc = mapped[g.id];
				// Deltas and swatch serialization are measured outside the timed region.
				let deltas = getDeltas(color, mc, oklch, weights);
				for (let m in METRICS) {
					g.samples[m][g.n] = deltas[m];
				}
				g.n++;
				cells[gi] += `<td style="background:${serialize(to(mc, P3), {precision: 3})}"></td>`;
			});
		}

		gmas.forEach((g, gi) => g.table.insertAdjacentHTML("beforeend", `<tr>${cells[gi]}</tr>`));
		sweep.row++;
	}
	while (sweep.row < lightnesses.length && performance.now() - frameStart < FRAME_BUDGET);

	progress.value = sweep.row / lightnesses.length;
	let done = sweep.row >= lightnesses.length;
	let now = performance.now();

	// Stats recompute sorts each metric's samples (for the median), so throttle
	// it rather than running it every frame.
	if (done || now - sweep.lastRender > 150) {
		renderStats();
		sweep.lastRender = now;
	}

	let secs = (sweep.elapsed + now - sweep.start) / 1000;
	statusEl.textContent = `${stats.totalColors.toLocaleString()} / ${sweep.total.toLocaleString()} colors × ${gmas.length} GMAs · ${prec(secs, 2)}s`;

	if (done) {
		setRunState("done");
	}
	else {
		rafId = requestAnimationFrame(tick);
	}
}

// Suspend the sweep, banking elapsed time so the clock ignores the pause.
function pause () {
	cancelAnimationFrame(rafId);
	sweep.elapsed += performance.now() - sweep.start;
	setRunState("paused");
}

// Continue a paused sweep from where it stopped.
function resume () {
	sweep.start = performance.now();
	setRunState("running");
	rafId = requestAnimationFrame(tick);
}

// ── Stats display ────────────────────────────────────────────────────────────

function formatTime (ms) {
	return ms < 1 ? `${prec(ms * 1000, 3)} µs` : `${prec(ms, 3)} ms`;
}

// How much slower a time is than the fastest, as a human-readable string.
// Small gaps read best as a percentage of extra time ("7%"), large ones as a
// multiplier ("10×"); both use 1 significant figure so noise never inflates the
// digits, and so a tiny ratio never collapses to a meaningless "0%" or "1×".
function formatSlower (ratio) {
	if (ratio >= 2) {
		return `${prec(ratio, 2)}× slower`;
	}
	// Round the extra-time percentage to 1 significant figure. `prec` can't do
	// this for values below 1, so round by the percentage's own magnitude.
	let pct = (ratio - 1) * 100;
	let exp = Math.floor(Math.log10(pct));
	let factor = 10 ** exp;
	let rounded = Math.round(pct / factor) * factor;
	// toFixed cleans float noise; unary + strips any trailing zero (1.0 → 1).
	return `${+rounded.toFixed(Math.max(0, -exp))}% slower`;
}

// avg/iqm/median/min/max/stdev over the first n entries of a metric's samples.
// The typed array sorts numerically, so the median and IQM are exact.
function summarize (values, n) {
	if (!n) {
		return null;
	}
	let sum = 0, sumSq = 0, min = Infinity, max = -Infinity;
	for (let i = 0; i < n; i++) {
		let v = values[i];
		sum += v;
		sumSq += v * v;
		min = Math.min(min, v);
		max = Math.max(max, v);
	}
	let avg = sum / n;
	// Population standard deviation; max(0, …) guards tiny negative round-off.
	let stdev = Math.sqrt(Math.max(0, sumSq / n - avg * avg));

	let sorted = values.slice(0, n).sort();
	let mid = n >> 1;
	let median = n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

	return {avg, iqm: interquartileMean(sorted, n), median, min, max, stdev};
}

// Mean of the middle 50% (between the quartiles), with fractional weights at the
// quartile cuts so it's exact for any n — less swayed by outliers than the mean.
// Below n = 4 there's nothing to trim, so it's just the mean.
function interquartileMean (sorted, n) {
	if (n < 4) {
		let sum = 0;
		for (let i = 0; i < n; i++) {
			sum += sorted[i];
		}
		return sum / n;
	}
	let q = n / 4; // observations to trim from each end (may be fractional)
	let edge = Math.floor(q);
	let weight = edge + 1 - q; // partial weight for the two samples at the cuts
	let sum = weight * (sorted[edge] + sorted[n - 1 - edge]);
	for (let i = edge + 1; i < n - 1 - edge; i++) {
		sum += sorted[i];
	}
	return sum / (n / 2);
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
	let times = gmas.map(g => average(g.id) ?? Infinity);

	// A value rounded to the precision it's *printed* at, so rows that display the
	// same number compare equal — for ranking ties and for best/worst highlights.
	// Non-finite (no data yet) sorts last.
	let shown = (col, v) => {
		if (!Number.isFinite(v)) {
			return Infinity;
		}
		// Time prints in µs below 1 ms (see formatTime), so round at that scale;
		// rounding raw ms instead would collapse distinct µs values.
		if (col === "time") {
			return v < 1 ? +prec(v * 1000, 3) / 1000 : +prec(v, 3);
		}
		return +prec(v, 3);
	};
	let keys = gmas.map((g, i) => shown(view.sort, sortValue(g, summaries[i])));

	// Order rows via CSS `order` (gutter + field share a value, so the pair moves
	// together) rather than moving DOM nodes. Ties on the active key fall back to
	// time, so equal-ranked GMAs read fastest-first (a no-op when sorting by time).
	gmas.map((_, i) => i)
		.sort((a, b) => (keys[a] - keys[b]) || (times[a] - times[b]))
		.forEach((gi, rank) => {
			gmas[gi].gutter.style.order = rank;
			gmas[gi].fieldWrap.style.order = rank;
		});

	let valid = keys.filter(Number.isFinite);
	let best = Math.min(...valid), worst = Math.max(...valid);

	// Fastest GMA, to annotate the rest with their slowdown relative to it.
	let minTime = Math.min(...times.filter(Number.isFinite));

	gmas.forEach((g, i) => {
		let s = summaries[i];
		for (let [key] of STAT_ROWS) {
			if (key !== "time") {
				g.statEls[key].textContent = s ? prec(s[key], 3) : "—";
			}
		}
		let t = times[i];
		g.statEls.time.textContent = Number.isFinite(t) ? formatTime(t) : "—";
		// Annotate everything but the fastest with how much slower it is.
		if (Number.isFinite(t) && t > minTime) {
			g.statEls.time.append(" ", el("small", {class: "slower"}, `(${formatSlower(t / minTime)})`));
		}

		// Best/worst on the active sort key (skip "worst" when everything ties).
		g.gutter.classList.toggle("best", keys[i] === best);
		g.gutter.classList.toggle("worst", keys[i] === worst && worst !== best);
	});

	// Highlight the lowest (best → green) and highest (worst → red) value in each
	// stat column independently, so every column is comparable at a glance even
	// when it isn't the active sort key. All stats are smaller-is-better (for
	// stdev, that's least spread).
	for (let [col] of STAT_ROWS) {
		let values = gmas.map((g, i) => shown(col, col === "time" ? times[i] : summaries[i]?.[col]));
		let finite = values.filter(Number.isFinite);
		let lo = Math.min(...finite), hi = Math.max(...finite);
		gmas.forEach((g, i) => {
			g.statEls[col].classList.toggle("best", values[i] === lo && hi !== lo);
			g.statEls[col].classList.toggle("worst", values[i] === hi && hi !== lo);
		});
	}
}

let form = document.querySelector(".range-form");
let colorsCount = form.querySelector(".colors-count");

// Sync the visible inputs to the active grid (separate min/max per axis).
form.hMin.value = hueMin;
form.hMax.value = hueMax;
form.hStep.value = hueStep;
form.lMin.value = prec(lMin, 4);
form.lMax.value = prec(lMax, 4);
form.lStep.value = lStep;

// Show the grid size live as the inputs change, so a sweep can be sized before it
// runs. Reuses the sweep's axis definitions, so the count can't drift from it.
function showCount () {
	let n = hueAxis(+form.hMin.value, +form.hMax.value, +form.hStep.value).count
		* lightnessAxis(+form.lMin.value, +form.lMax.value, +form.lStep.value).count;
	colorsCount.textContent = n ? `${n.toLocaleString()} colors` : "";
}
form.addEventListener("input", showCount);
showCount();

// Build a clean query string — only params that differ from the app defaults —
// then reload; the page re-reads them on load (see top of file). Min/max pairs
// recombine into the "min-max" range params the sweep expects.
form.addEventListener("submit", e => {
	e.preventDefault();
	let p = new URLSearchParams();
	let near = (a, b) => Math.abs(a - b) < 1e-9;

	if (+form.hMin.value !== 0 || +form.hMax.value !== 359) {
		p.set("h", `${form.hMin.value}-${form.hMax.value}`);
	}
	if (+form.hStep.value !== 1) {
		p.set("hs", form.hStep.value);
	}
	if (+form.lStep.value !== 0.01) {
		p.set("ls", form.lStep.value);
	}
	// The lightness range's default derives from the (possibly changed) step.
	let ls = +form.lStep.value || 0.01;
	if (!near(+form.lMin.value, ls) || !near(+form.lMax.value, 1 - ls)) {
		p.set("l", `${form.lMin.value}-${form.lMax.value}`);
	}

	location.search = p.toString();
});

// ── Init ─────────────────────────────────────────────────────────────────────

// Sort + metric pickers, populated from SORTS / METRICS.
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

run();
