import Color from "colorjs.io";
import { compareColors, componentNames, spaceOf, toColor, OKLAB_EPSILON, SAME_SPACE_EPSILON } from "./compare.js";

/* -------------------------------------------------------------- formatting -- */

function esc (str) {
	return String(str).replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[char]);
}

/** Format one component value; a missing component is the CSS keyword none */
function fmt (value) {
	if (value === null || value === undefined) {
		return "none";
	}

	if (!Number.isFinite(value)) {
		return String(value);
	}

	return String(Number(value.toPrecision(6)));
}

/** A difference, which is worth seeing at more precision than a component value */
function fmtDiff (value) {
	if (value === null) {
		return "—";
	}

	if (value === 0) {
		return "0";
	}

	return value < 0.0001 ? value.toExponential(2) : String(Number(value.toPrecision(4)));
}

/**
 * A CSS color the browser can actually paint, in the color's own color space wherever
 * possible, so that the browser does the gamut mapping for the display. Missing
 * components render as zero, which is what CSS does with none.
 */
function cssColor (color) {
	let c;

	try {
		c = toColor(color);
	}
	catch (error) {
		return "transparent";
	}

	try {
		return String(c.display());
	}
	catch (error) {
		return c.to("srgb").toString();
	}
}

function swatch (color, extraClass = "") {
	return `<span class="swatch ${ extraClass }" style="--color: ${ esc(cssColor(color)) }"></span>`;
}

function label (index) {
	return index === 0 ? "C<sub>1</sub>" : "C<sub>2</sub>";
}

/* ------------------------------------------------------------------ tables -- */

/**
 * A table of component values: one column per component of `space` plus alpha,
 * one row per color or stage.
 * rows: [{label, color, note, muted}]
 */
function componentsTable (space, rows, caption) {
	let head = componentNames(space).map(name => `<th scope="col">${ esc(name) }</th>`).join("");

	let body = rows.map(row => {
		let cells = row.color.coords.map(v => `<td class="${ v === null ? "missing" : "" }">${ fmt(v) }</td>`).join("");
		let alpha = `<td class="${ row.color.alpha === null ? "missing" : "" }">${ fmt(row.color.alpha) }</td>`;
		let head = swatch(row.color) + row.label
			+ (row.note ? ` <span class="note">(${ esc(row.note) })</span>` : "");

		return `<tr class="${ row.muted ? "muted" : "" }"><th scope="row">${ head }</th>${ cells }${ alpha }</tr>`;
	}).join("");

	return `<div class="scroller"><table class="components">
		${ caption ? `<caption>${ caption }</caption>` : "" }
		<thead><tr><th scope="col"></th>${ head }<th scope="col">alpha</th></tr></thead>
		<tbody>${ body }</tbody>
	</table></div>`;
}

/** The component-by-component comparison that decides the answer */
function comparisonTable (report) {
	let body = report.rows.map(row => {
		let verdict = row.equal
			? "<td class=\"equal\">equal</td>"
			: "<td class=\"unequal\">not equal</td>";
		let reason = row.missing
			? (row.equal
				? "both missing"
				: "a missing component is only equal to another missing component")
			: (row.equal ? `≤ ε` : `> ε`);

		return `<tr class="${ row.equal ? "" : "differs" }">
			<th scope="row">${ esc(row.name) }</th>
			<td class="${ row.a === null ? "missing" : "" }">${ fmt(row.a) }</td>
			<td class="${ row.b === null ? "missing" : "" }">${ fmt(row.b) }</td>
			<td>${ fmtDiff(row.diff) }</td>
			${ verdict }
			<td class="why">${ esc(reason) }</td>
		</tr>`;
	}).join("");

	return `<div class="scroller"><table class="components compare">
		<thead><tr>
			<th scope="col">Component</th>
			<th scope="col">C<sub>1</sub></th>
			<th scope="col">C<sub>2</sub></th>
			<th scope="col">difference</th>
			<th scope="col"></th>
			<th scope="col"></th>
		</tr></thead>
		<tbody>${ body }</tbody>
	</table></div>`;
}

/* ---------------------------------------------------------------- sections -- */

function renderResult (report) {
	let cards = report.colors.map((color, i) => `<div class="verdict-color">
		${ swatch(color.parsed, "huge") }
		<p class="written"><span class="tag">${ label(i) }</span> <code>${ esc(color.input) }</code></p>
	</div>`).join("");

	let deltaE = report.reference.deltaEOK === null
		? ""
		: `<dt>ΔE<sub>OK</sub></dt><dd>${ fmtDiff(report.reference.deltaEOK) } <span class="note">(not part of the algorithm, just for context)</span></dd>`;

	return `<section class="result ${ report.equivalent ? "yes" : "no" }">
		<h2>${ report.equivalent ? "Equivalent colors" : "Not equivalent colors" }</h2>
		<div class="verdict-grid">
			<div class="verdict-colors">${ cards }</div>
			<div>
				<p class="reason">${ report.reason }</p>
				<dl>
					<dt>Decided at</dt><dd>${ decidedAt(report) }</dd>
					${ deltaE }
				</dl>
			</div>
		</div>
	</section>`;
}

function decidedAt (report) {
	if (report.branch === "same-space") {
		return "step 2, comparing components within one color space";
	}

	if (report.branch === "missing") {
		return "step 3, a missing component in different color spaces";
	}

	return "step 4, comparing the two colors in Oklab";
}

/** The algorithm itself, with the path this pair took through it marked */
function renderAlgorithm (report) {
	let steps = [
		{
			html: "For each of C<sub>1</sub> and C<sub>2</sub>, convert any powerless components to missing components.",
			taken: true,
		},
		{
			html: "If C<sub>1</sub> and C<sub>2</sub> share the same <code>&lt;color-space&gt;</code>, compare their components one by one, including the alpha channel. A missing component is only equal to another missing component. Two numeric components are considered equal if they differ by no more than a small implementation-defined ε. Return true if and only if all components compare as equal.",
			taken: report.branch === "same-space",
		},
		{
			html: "Otherwise, C<sub>1</sub> and C<sub>2</sub> are in different <code>&lt;color-space&gt;</code>s. If either color has at least one missing component, return false.",
			taken: report.branch === "missing" || report.branch === "oklab",
		},
		{
			html: "Otherwise, neither color has any missing component. Convert both C<sub>1</sub> and C<sub>2</sub> to oklab, then return true if and only if all components (including alpha) of the converted colors compare as equal, using a standardized Oklab ε of 0.00001.",
			taken: report.branch === "oklab",
		},
	];

	let items = steps.map(step => `<li class="${ step.taken ? "taken" : "skipped" }">${ step.html }</li>`).join("");

	return `<section>
		<h2>The algorithm</h2>
		<p>Two <code>&lt;color&gt;</code> values are <b>equivalent colors</b> when
		<a href="https://www.w3.org/TR/css-color-4/#comparing-color-values">this algorithm</a> returns true.
		The steps this pair actually went through are highlighted.</p>
		<ol class="algorithm">${ items }</ol>
	</section>`;
}

function renderParsed (report) {
	let cards = report.colors.map((color, i) => {
		let names = componentNames(color.space);
		let items = names.map((name, j) => `<dt>${ esc(name) }</dt><dd class="${ color.parsed.coords[j] === null ? "missing" : "" }">${ fmt(color.parsed.coords[j]) }</dd>`).join("")
			+ `<dt>alpha</dt><dd class="${ color.parsed.alpha === null ? "missing" : "" }">${ fmt(color.parsed.alpha) }</dd>`;

		let spaceNote = color.legacy
			? `<p class="pct">Written as <code>${ esc(color.formatId) }()</code>, which CSS resolves to an <b>srgb</b> color
			   (<a href="https://www.w3.org/TR/css-color-4/#resolving-sRGB-values">§ 15.1</a>),
			   so for this comparison it counts as being in the srgb color space.</p>`
			: color.srgbFormat && color.formatId !== "color"
				? `<p class="pct">Written as ${ color.formatId === "keyword" ? "a named color" : `a <code>${ esc(color.formatId) }</code> color` }, which is in the <b>srgb</b> color space.</p>`
				: "";

		return `<div class="color-card">
			<div class="color-card-head">
				${ swatch(color.parsed, "big") }
				<div>
					<p class="written"><span class="tag">${ label(i) }</span> <code>${ esc(color.input) }</code></p>
					<p class="pct">Parsed in <b>${ esc(color.space.name) }</b> · compared as
					<code>&lt;color-space&gt;</code> <b>${ esc(color.cssSpaceId) }</b></p>
				</div>
			</div>
			${ spaceNote }
			<dl class="components-list">${ items }</dl>
		</div>`;
	}).join("");

	return `<section>
		<h2>The two colors, as parsed</h2>
		<p>Each value is parsed by Color.js, in the color space its notation names. The
		<code>&lt;color-space&gt;</code> the algorithm compares them by is not always that one:
		<code>rgb()</code>, <code>hsl()</code>, <code>hwb()</code>, hex colors and named colors
		are all considered to be in the srgb color space.</p>
		<div class="color-cards two">${ cards }</div>
	</section>`;
}

function renderStep1 (report) {
	let blocks = report.colors.map((color, i) => {
		let changed = color.step1.applies
			&& color.afterStep1.coords.some((v, j) => v !== color.parsed.coords[j]);

		let table = changed
			? componentsTable(color.space, [
				{ label: "as written", color: color.parsed, muted: true },
				{ label: "after step 1", color: color.afterStep1 },
			])
			: "";

		return `<div class="step-color">
			<h3>${ label(i) } <code>${ esc(color.input) }</code></h3>
			<p>${ esc(color.step1.explanation) }</p>
			${ table }
		</div>`;
	}).join("");

	return `<section>
		<h2>Step 1: powerless components become missing</h2>
		<p>A component is <a href="https://www.w3.org/TR/css-color-4/#powerless-color-component">powerless</a>
		when its value has no effect on the color that gets displayed. Only the cylindrical spaces
		have one: the hue, when the color is achromatic. Each space sets its own ε for how close to
		achromatic is close enough — <code>hsl()</code> S&nbsp;≤&nbsp;0.001,
		<code>hwb()</code> W&nbsp;+&nbsp;B&nbsp;≥&nbsp;99.999,
		<code>lch()</code> C&nbsp;≤&nbsp;0.0015, <code>oklch()</code> C&nbsp;≤&nbsp;0.000004.
		When a powerless hue is made missing, the chroma or saturation is set to zero as well, so that
		floating point noise is not amplified later.</p>
		<div class="step-colors">${ blocks }</div>
	</section>`;
}

function renderStep2 (report) {
	let list = report.colors.map((color, i) => `<li>${ label(i) } <code>${ esc(color.input) }</code>
		is in the <b>${ esc(color.cssSpaceId) }</b> <code>&lt;color-space&gt;</code></li>`).join("");

	return `<section>
		<h2>Step 2: are they in the same <code>&lt;color-space&gt;</code>?</h2>
		<ul class="spaces">${ list }</ul>
		<p class="callout">${ report.sameSpace
			? "<b>Yes</b> — so the components are compared one by one, in that color space."
			: "<b>No</b> — so the algorithm moves on to step 3, which first rules out any color with a missing component." }</p>
	</section>`;
}

function renderSameSpace (report) {
	let converted = report.colors.some((color, i) => color.afterStep1.spaceId !== report.forms[i].spaceId);

	let conversion = converted
		? `<p>The values compared are the components of the srgb color space, since that is the
		   <code>&lt;color-space&gt;</code> these colors are in. A missing component
		   <a href="https://www.w3.org/TR/css-color-4/#missing-color-components">behaves as zero</a>
		   when converting, and a hue has no counterpart among red, green and blue.</p>`
		+ componentsTable(report.space, report.colors.map((color, i) => ({
			label: label(i) + " " + esc(color.input),
			color: report.forms[i],
		})), "The two colors as srgb")
		: "";

	return `<section>
		<h2>Step 2, continued: compare the components, one by one</h2>
		<p>Every component is compared, alpha included. A missing component is only equal to another
		missing component; two numbers are equal if they differ by no more than ε. The spec leaves
		this ε implementation-defined, and this app uses ${ SAME_SPACE_EPSILON }, the same value the
		spec standardizes for Oklab.</p>
		${ conversion }
		${ comparisonTable(report) }
	</section>`;
}

function renderMissing (report) {
	let list = report.blockers.map(blocker => `<li><code>${ esc(blocker.input) }</code> is missing its
		<b>${ esc(blocker.missing.join(", ")) }</b> component${ blocker.missing.length === 1 ? "" : "s" }</li>`).join("");

	return `<section>
		<h2>Step 3: a missing component, in different color spaces</h2>
		<p>The two colors are in different <code>&lt;color-space&gt;</code>s, so their components cannot be
		lined up against each other. A missing component has no counterpart in another color space at all,
		so the algorithm stops here and returns false, without looking at any values.</p>
		<ul class="spaces">${ list }</ul>
		<p class="callout"><b>Not equivalent</b> — and note that this says nothing about what the two colors
		look like. They may well be the same color.</p>
	</section>`;
}

function renderOklab (report) {
	let table = componentsTable(report.space, report.colors.map((color, i) => ({
		label: label(i) + " " + esc(color.input),
		color: report.forms[i],
	})), "The two colors converted to Oklab");

	return `<section>
		<h2>Step 4: meet in Oklab</h2>
		<p>The two colors are in different <code>&lt;color-space&gt;</code>s and neither has a missing
		component, so both are converted to Oklab and compared there, with the standardized
		ε of ${ OKLAB_EPSILON }. This is what makes colors that are colorimetrically identical but written
		in different color spaces come out equivalent.</p>
		${ table }
		${ comparisonTable(report) }
	</section>`;
}

function renderNotes (report) {
	if (report.notes.length === 0) {
		return "";
	}

	return `<section>
		<h2>Worth noticing</h2>
		<ul class="notes-list">${ report.notes.map(note => `<li>${ note }</li>`).join("") }</ul>
	</section>`;
}

/* --------------------------------------------------------- browser check -- */

/**
 * What the browser itself thinks. Style container queries on a custom property registered
 * as a <color> compare their computed values with this very algorithm, which is one of the
 * two uses § 12 names, so the browser can be asked the same question directly.
 */
let probe = document.getElementById("probe");
let probeInner = document.getElementById("probe-inner");
let probeSheet = new CSSStyleSheet();
let styleQueriesWork = null;

document.adoptedStyleSheets = [...document.adoptedStyleSheets, probeSheet];

try {
	CSS.registerProperty({
		name: "--equivalent-probe",
		syntax: "<color>",
		inherits: true,
		initialValue: "rgb(0 0 0 / 0)",
	});
}
catch (error) {
	// Already registered by a previous run, or @property is unsupported; the control
	// probes below will find out which
}

function askBrowser (a, b) {
	probe.style.setProperty("--equivalent-probe", a);

	try {
		probeSheet.replaceSync(`@container style(--equivalent-probe: ${ b }) { #probe-inner { order: 1 } }`);
	}
	catch (error) {
		return null;
	}

	// Force a style recalculation before reading the result back
	let matched = getComputedStyle(probeInner).order === "1";

	probeSheet.replaceSync("");
	probe.style.removeProperty("--equivalent-probe");

	return matched;
}

/** A positive and a negative control, so a browser without style queries is not misread */
function supportsStyleQueries () {
	if (styleQueriesWork === null) {
		try {
			styleQueriesWork = askBrowser("red", "rgb(255 0 0)") === true
				&& askBrowser("red", "rgb(0 255 0)") === false;
		}
		catch (error) {
			styleQueriesWork = false;
		}
	}

	return styleQueriesWork;
}

function renderBrowser (report) {
	let [a, b] = report.inputs;

	if (!supportsStyleQueries()) {
		return `<p class="browser">Your browser does not support
		<code>style()</code> container queries on a registered <code>&lt;color&gt;</code> custom property,
		so there is nothing to compare this answer against here.</p>`;
	}

	if (!CSS.supports("color", a) || !CSS.supports("color", b)) {
		let unsupported = [a, b].filter(value => !CSS.supports("color", value));

		return `<p class="browser">Your browser cannot parse
		${ unsupported.map(value => `<code>${ esc(value) }</code>`).join(" or ") }, so it has no opinion
		on this pair. Color.js can parse ${ unsupported.length === 1 ? "it" : "them" } anyway.</p>`;
	}

	let matched = askBrowser(a, b);

	if (matched === null) {
		return "";
	}

	let agrees = matched === report.equivalent;

	return `<p class="browser ${ agrees ? "agrees" : "differs" }">
		Your browser ${ agrees ? "agrees" : "<b>disagrees</b>" }: asked whether
		<code>--c: ${ esc(a) }</code> matches <code>@container style(--c: ${ esc(b) })</code>
		with <code>--c</code> registered as a <code>&lt;color&gt;</code>, it says
		<b>${ matched ? "yes" : "no" }</b>.
		${ agrees ? "" : disagreement(matched) }</p>`;
}

/** Why the browser and the spec might part company, which depends on which way round it is */
function disagreement (matched) {
	if (matched) {
		return " Implementations of this comparison are still converging: your browser is treating as equal something"
			+ " that the algorithm distinguishes.";
	}

	return " Implementations of this comparison are still converging: a browser may be comparing the two colors in the"
		+ " notation they were written in, which makes two spellings of one color come out as different.";
}

/* ------------------------------------------------------------------- glue -- */

let inputA = document.getElementById("a");
let inputB = document.getElementById("b");
let error = document.getElementById("error");
let output = document.getElementById("output");
let permalink = document.getElementById("permalink");

function update () {
	let a = inputA.value.trim();
	let b = inputB.value.trim();
	let query = `?a=${ encodeURIComponent(a) }&b=${ encodeURIComponent(b) }`;

	permalink.href = query;
	history.replaceState(null, "", query);

	let report;

	try {
		report = compareColors(a, b);
	}
	catch (e) {
		error.textContent = e.message;
		error.hidden = false;
		output.hidden = true;

		for (let field of [inputA, inputB]) {
			let value = field.value.trim();
			field.setCustomValidity(value && !parses(value) ? "Not a CSS color" : "");
		}

		return;
	}

	error.hidden = true;
	inputA.setCustomValidity("");
	inputB.setCustomValidity("");

	let branch = report.branch === "same-space" ? renderSameSpace(report)
		: report.branch === "missing" ? renderMissing(report)
			: renderOklab(report);

	output.innerHTML = renderResult(report)
		+ renderBrowser(report)
		+ renderAlgorithm(report)
		+ renderParsed(report)
		+ renderStep1(report)
		+ renderStep2(report)
		+ branch
		+ renderNotes(report);
	output.hidden = false;
}

function parses (value) {
	try {
		Color.parse(value);
		return true;
	}
	catch (error) {
		return false;
	}
}

document.getElementById("form").addEventListener("submit", event => event.preventDefault());
inputA.addEventListener("input", update);
inputB.addEventListener("input", update);

document.querySelector(".examples").addEventListener("click", event => {
	let button = event.target.closest("button");

	if (button) {
		inputA.value = button.dataset.a;
		inputB.value = button.dataset.b;
		update();
	}
});

let params = new URL(location).searchParams;

if (params.has("a")) {
	inputA.value = params.get("a");
}

if (params.has("b")) {
	inputB.value = params.get("b");
}

update();
