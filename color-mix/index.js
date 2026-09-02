import Color from "colorjs.io";
import { computeColorMix, componentNames, toColor, DEFAULT_SPACE } from "./colormix.js";

const PRECISION = 5;

/* ------------------------------------------------------------- formatting -- */

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

/**
 * Write a color out longhand, without the clipping or renormalization that
 * Color.js applies when it serializes a color outside its own reference range.
 */
function longhand (c) {
	let coords = c.coords;
	let alpha = c.alpha === 1 ? "" : ` / ${ fmt(c.alpha) }`;

	if (c.spaceId === "hsl" || c.spaceId === "hwb") {
		return `${ c.spaceId }(${ fmt(coords[0]) } ${ fmt(coords[1]) }% ${ fmt(coords[2]) }%${ alpha })`;
	}

	return `color(${ c.space.cssId ?? c.spaceId } ${ coords.map(fmt).join(" ") }${ alpha })`;
}

function serialize (color, precision = PRECISION) {
	let c;

	try {
		c = toColor(color);
	}
	catch (error) {
		return "(cannot be serialized)";
	}

	// Only the sRGB-based spaces have a reference range that Color.js enforces when
	// serializing; a mix in one of those can land outside it, and clipping would show
	// a different color from the one in the component tables.
	try {
		if (!c.inGamut(c.spaceId)) {
			return longhand(c);
		}
	}
	catch (error) {
		// A space with no gamut of its own; nothing to clip
	}

	return c.toString({ precision });
}

/**
 * A CSS color the browser can actually paint, in the color's own color space
 * wherever possible, so that the browser does the gamut mapping for the display.
 * Missing components render as zero, which is what CSS does with none.
 */
function cssColor (color) {
	let c;

	try {
		c = toColor({
			spaceId: color.spaceId,
			coords: color.coords.map(v => v ?? 0),
			alpha: color.alpha ?? 0,
		});
	}
	catch (error) {
		return "transparent";
	}

	// Color.js clips or renormalizes when it serializes an sRGB-based space, which would
	// paint a different color from the one described alongside it. OkLCh survives
	// serialization intact, so hand the browser that and let it map to the display gamut.
	try {
		if (!c.inGamut(c.spaceId)) {
			c = c.to("oklch");
		}
	}
	catch (error) {
		// A space with no gamut of its own; nothing is clipped
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

/* ----------------------------------------------------------- component tables -- */

/**
 * A table of component values: one column per component of `space` plus alpha,
 * one row per stage.
 * rows: [{label, color, note, muted, swatch}]
 */
function componentsTable (space, rows, caption) {
	let names = componentNames(space);
	let head = names.map(name => `<th scope="col">${ esc(name) }</th>`).join("");

	let body = rows.map(row => {
		let cells = row.color.coords.map(v => {
			return `<td class="${ v === null ? "missing" : "" }">${ fmt(v) }</td>`;
		}).join("");
		let alpha = `<td class="${ row.color.alpha === null ? "missing" : "" }">${ fmt(row.color.alpha) }</td>`;
		let label = (row.swatch ? swatch(row.color) : "") + esc(row.label)
			+ (row.note ? ` <span class="note">(${ esc(row.note) })</span>` : "");

		return `<tr class="${ row.muted ? "muted" : "" }"><th scope="row">${ label }</th>${ cells }${ alpha }</tr>`;
	}).join("");

	return `<div class="scroller"><table class="components">
		${ caption ? `<caption>${ caption }</caption>` : "" }
		<thead><tr><th scope="col"></th>${ head }<th scope="col">alpha</th></tr></thead>
		<tbody>${ body }</tbody>
	</table></div>`;
}

function sameColor (a, b) {
	return a.alpha === b.alpha && a.coords.every((v, i) => v === b.coords[i]);
}

/* ------------------------------------------------------------------ sections -- */

function renderResult (mix, input) {
	let result = toColor(mix.color);
	let inSRGB = result.inGamut("srgb");
	let srgb = result.to("srgb");
	let srgbString = serialize({ spaceId: "srgb", coords: srgb.coords, alpha: srgb.alpha });
	let inP3 = result.inGamut("p3");
	let p3 = result.to("p3");
	let p3String = serialize({ spaceId: "p3", coords: p3.coords, alpha: p3.alpha });

	let browser = compareWithBrowser(mix, input);

	return `<section class="result">
		<h2>Result</h2>
		<div class="result-grid">
			<div class="swatch huge" style="--color: ${ esc(cssColor(mix.color)) }"></div>
			<dl>
				<dt>In the mixing color space (${ esc(mix.space.name) })</dt>
				<dd><code>${ esc(serialize(mix.color)) }</code></dd>
				<dt>In sRGB</dt>
				<dd>
					<code>${ esc(srgbString) }</code>
					${ inSRGB ? "" : ` <span class="note">outside the sRGB gamut</span>` }
				</dd>
				<dt>In Display P3</dt>
				<dd>
					<code>${ esc(p3String) }</code>
					${ inP3 ? "" : ` <span class="note">outside the Display P3 gamut</span>` }
				</dd>
			</dl>
		</div>
		${ browser }
	</section>`;
}

/** Ask the browser to compute the same color-mix(), as a cross-check */
function compareWithBrowser (mix, input) {
	let probe = document.getElementById("probe");
	probe.style.color = "";
	probe.style.color = input;

	if (probe.style.color === "") {
		return `<p class="browser">Your browser does not accept this value, so there is nothing to compare against.
			CSS Color 5 allows any number of colors in <code>color-mix()</code>, but implementations currently only take two.</p>`;
	}

	let computed = getComputedStyle(probe).color;
	let theirs;

	try {
		theirs = new Color(computed);
	}
	catch (error) {
		return `<p class="browser">Your browser computed <code>${ esc(computed) }</code>, which could not be parsed for comparison.</p>`;
	}

	let ours = toColor(mix.color);
	let ΔE = ours.deltaE(theirs, "2000");
	// Well below a just-noticeable difference: this only has to absorb the rounding in
	// the browser's serialization, which grows for colors far outside the sRGB gamut.
	let close = ΔE < 0.1;

	return `<p class="browser ${ close ? "agrees" : "differs" }">
		${ swatch({ spaceId: theirs.spaceId, coords: theirs.coords, alpha: theirs.alpha }) }
		Your browser computes this as <code>${ esc(computed) }</code>,
		which is ΔE<sub>00</sub> ${ fmt(ΔE) } away from the result above${ close ? " — they agree" : "" }.
	</p>`;
}

function renderParse (mix) {
	let { parsed } = mix;
	let hue = parsed.isPolar
		? `<dt>Hue interpolation method</dt><dd><code>${ esc(parsed.hueArc) } hue</code>${ parsed.hueMethod ? "" : ` <span class="note">not specified, so <code>shorter</code> is assumed</span>` }</dd>`
		: `<dt>Hue interpolation method</dt><dd>not applicable: ${ esc(parsed.space) } is a <code>&lt;rectangular-color-space&gt;</code></dd>`;

	return `<section>
		<h2>1. The parsed function</h2>
		<p class="grammar"><code>color-mix() = color-mix( &lt;color-interpolation-method&gt;? , [ &lt;color&gt; &amp;&amp; &lt;percentage [0,100]&gt;? ]# )</code></p>
		<dl class="parse">
			<dt>Mixing color space</dt>
			<dd>
				<code>${ esc(parsed.space) }</code> (${ esc(mix.space.name) }), a
				<code>&lt;${ parsed.isPolar ? "polar" : "rectangular" }-color-space&gt;</code>
				${ parsed.methodGiven ? "" : `<span class="note">no <code>&lt;color-interpolation-method&gt;</code> was given, so ${ DEFAULT_SPACE } is assumed</span>` }
			</dd>
			${ hue }
			<dt>Colors to mix</dt>
			<dd>${ parsed.items.length }</dd>
		</dl>
	</section>`;
}

function renderColors (mix) {
	let cards = mix.items.map((item, i) => {
		let origin = item.color;
		let conversion = item.conversion;
		let notes = [];

		if (item.nested) {
			notes.push("This argument is itself a <code>color-mix()</code>, resolved first.");
		}

		if (conversion.carried.length > 0) {
			let carried = [...new Set(conversion.carried)].map(j => componentNames(mix.space)[j]);
			notes.push(`Missing component${ carried.length > 1 ? "s" : "" } carried forward into ${ esc(mix.space.name) } as analogous: <b>${ carried.map(esc).join(", ") }</b>.`);
		}

		if (conversion.powerless.length > 0) {
			let powerless = conversion.powerless.map(j => componentNames(mix.space)[j]);
			notes.push(`Became missing during conversion because ${ powerless.length > 1 ? "they are" : "it is" } <a href="https://www.w3.org/TR/css-color-4/#powerless">powerless</a> for this color: <b>${ powerless.map(esc).join(", ") }</b>.`);
		}

		let sameSpace = origin.spaceId === mix.space.id;
		let carriedAnything = conversion.carried.length > 0;
		let interpolationRows = carriedAnything
			? [
				{ label: `in ${ mix.space.name }`, color: conversion.converted, note: "straight conversion", muted: true },
				{ label: `in ${ mix.space.name }`, color: conversion.result, note: "missing components carried forward" },
			]
			: [{ label: `in ${ mix.space.name }`, color: conversion.result }];

		return `<div class="color-card">
			<div class="color-card-head">
				<span class="swatch big" style="--color: ${ esc(cssColor(origin)) }"></span>
				<div>
					<code class="written">${ esc(item.colorString) }</code>
					<p class="pct">
						Specified percentage: <b>${ item.percentage === null ? "omitted" : fmt(item.percentage) + "%" }</b>
						&middot; after normalization: <b>${ fmt(mix.normalization.normalized[i]) }%</b>
					</p>
				</div>
			</div>
			${ componentsTable(origin.space, [
				{ label: `in ${ origin.space.name }`, color: origin },
			], `Origin color space, ${ esc(origin.space.name) }: <code>${ esc(serialize(origin)) }</code>`) }
			${ sameSpace
				? `<p class="note same-space">Already in the mixing color space, so there is nothing to convert.</p>`
				: componentsTable(mix.space, interpolationRows,
					`Mixing color space, ${ esc(mix.space.name) }: <code>${ esc(serialize(conversion.result)) }</code>`) }
			${ notes.length ? `<ul class="notes">${ notes.map(n => `<li>${ n }</li>`).join("") }</ul>` : "" }
		</div>`;
	}).join("");

	return `<section>
		<h2>2. The colors, in their own color space and in ${ esc(mix.space.name) }</h2>
		<p>
			Each color is converted to the mixing color space. Missing components (<code>none</code>) are
			<a href="https://www.w3.org/TR/css-color-4/#interpolation-missing">carried forward</a> into any
			analogous component rather than being converted to zero.
		</p>
		<div class="color-cards">${ cards }</div>
	</section>`;
}

function renderNormalization (mix) {
	let { normalization: n, parsed } = mix;
	let steps = [];

	steps.push(`<li>The <b>specified sum</b> is ${ fmt(n.specifiedSum) }%${ n.specifiedSum === 100 && parsed.items.some(i => i.percentage !== null) ? " (clamped to 100%)" : "" }.</li>`);

	if (n.omittedCount > 0) {
		steps.push(`<li>${ n.omittedCount } percentage${ n.omittedCount > 1 ? "s were" : " was" } omitted, so each is set to
			(100% &minus; ${ fmt(n.specifiedSum) }%) / ${ n.omittedCount } = <b>${ fmt(n.share) }%</b>.</li>`);
	}
	else {
		steps.push(`<li>No percentage was omitted, so there is nothing to distribute.</li>`);
	}

	steps.push(`<li>The <b>total</b> is now ${ fmt(n.total) }%.</li>`);

	if (n.scaled && n.factor !== 1) {
		steps.push(`<li>color-mix() sets the <b>force normalization</b> flag, so every percentage is multiplied by
			100% / ${ fmt(n.total) }% = <b>${ fmt(n.factor) }</b>, bringing the sum to 100%.</li>`);
	}
	else if (n.scaled) {
		steps.push(`<li>The percentages already sum to 100%, so scaling by 100% / ${ fmt(n.total) }% leaves them alone.</li>`);
	}
	else {
		steps.push(`<li>The total is 0%, which is neither greater than 100% nor greater than 0%, so no scaling happens.</li>`);
	}

	steps.push(n.leftover > 0
		? `<li>The total was less than 100%, so the <b>leftover</b> is 100% &minus; ${ fmt(n.total) }% = <b>${ fmt(n.leftover) }%</b>.</li>`
		: `<li>The total was not less than 100%, so the <b>leftover</b> is <b>0%</b>.</li>`);

	let rows = mix.items.map((item, i) => `<tr>
		<th scope="row">${ swatch(item.color) }<code>${ esc(item.colorString) }</code></th>
		<td>${ item.percentage === null ? "<i>omitted</i>" : fmt(item.percentage) + "%" }</td>
		<td>${ fmt(n.filled[i]) }%</td>
		<td>${ fmt(n.normalized[i]) }%</td>
	</tr>`).join("");

	return `<section>
		<h2>3. Normalize the mix percentages</h2>
		<p>
			<a href="https://drafts.csswg.org/css-values-5/#mix-percentage-normalization">Normalizing mix percentages</a>
			fills in any omitted percentage, scales the percentages so they sum to 100%,
			and reports whatever percentage is left over.
		</p>
		<ol class="steps">${ steps.join("") }</ol>
		<div class="scroller"><table class="components">
			<thead><tr><th scope="col">Color</th><th scope="col">Specified</th><th scope="col">After filling omitted</th><th scope="col">Normalized</th></tr></thead>
			<tbody>${ rows }</tbody>
		</table></div>
		<p class="callout"><b>alpha mult</b> = 1 &minus; leftover = 1 &minus; ${ fmt(n.leftover / 100) } = <b>${ fmt(mix.alphaMult) }</b>${ mix.alphaMult === 1 ? "" : `, so the mixed color ends up ${ fmt(mix.alphaMult * 100) }% as opaque as the colors it was mixed from` }</p>
	</section>`;
}

function renderIterations (mix) {
	if (mix.iterations.length === 0) {
		return `<section>
			<h2>4. Mix the colors</h2>
			<p>Only one color was given, so the result is simply that color converted to ${ esc(mix.space.name) }. There is nothing to interpolate.</p>
		</section>`;
	}

	let intro = `<p>
		The mix items are pushed onto a stack in the order they were written. Two are popped at a time,
		interpolated, and the result pushed back with their combined percentage. In a polar color space this
		makes mixing order-dependent, since which way round the hue circle is “shorter” can change as the mix proceeds.
	</p>`;

	let blocks = mix.iterations.map((iteration, index) => {
		let { a, b, combined, p, trace } = iteration;
		let rows = [];
		let notes = [];

		rows.push({ label: `a — ${ a.label } (${ fmt(a.percentage) }%)`, color: a.color, swatch: true });
		rows.push({ label: `b — ${ b.label } (${ fmt(b.percentage) }%)`, color: b.color, swatch: true });

		// Each stage only gets its own rows if it actually changed something
		if (!sameColor(trace.filled[0], a.color) || !sameColor(trace.filled[1], b.color)) {
			rows.push({
				label: "a, missing components filled in",
				color: trace.filled[0],
				muted: true,
				note: sameColor(trace.filled[0], a.color) ? "unchanged" : "takes b’s value",
			});
			rows.push({
				label: "b, missing components filled in",
				color: trace.filled[1],
				muted: true,
				note: sameColor(trace.filled[1], b.color) ? "unchanged" : "takes a’s value",
			});
		}
		else {
			notes.push("Neither color has a missing component that the other supplies.");
		}

		if (trace.hues) {
			let { arc, before, after } = trace.hues;

			if (before.some((v, i) => v !== after[i])) {
				rows.push({ label: `a, hue fixed up for ${ arc } hue`, color: trace.adjusted[0], muted: true });
				rows.push({ label: `b, hue fixed up for ${ arc } hue`, color: trace.adjusted[1], muted: true });
				notes.push(`The <code>${ esc(arc) } hue</code> fix-up turns ${ fmt(before[0]) } and ${ fmt(before[1]) }
					into ${ fmt(after[0]) } and ${ fmt(after[1]) }, so that interpolating between them takes the intended arc.`);
			}
			else {
				notes.push(`The <code>${ esc(arc) } hue</code> fix-up leaves both hues unchanged.`);
			}
		}

		if (trace.premultiplied.some((c, i) => !sameColor(c, trace.adjusted[i]))) {
			rows.push({ label: "a, premultiplied by its alpha", color: trace.premultiplied[0], muted: true });
			rows.push({ label: "b, premultiplied by its alpha", color: trace.premultiplied[1], muted: true });
		}
		else {
			notes.push("Both colors are fully opaque, so premultiplying changes nothing.");
		}

		rows.push({ label: `interpolated at p = ${ fmt(p) }`, color: trace.mixed, muted: true, note: "still premultiplied" });
		rows.push({ label: "un-premultiplied", color: trace.result, swatch: true });

		return `<div class="iteration">
			<h3>Iteration ${ index + 1 }: mix ${ esc(a.label) } with ${ esc(b.label) }</h3>
			<p class="calc">
				combined percentage = ${ fmt(a.percentage) }% + ${ fmt(b.percentage) }% = <b>${ fmt(combined) }%</b><br>
				progress p = ${ combined > 0
					? `b’s percentage / combined percentage = ${ fmt(b.percentage) } / ${ fmt(combined) } = <b>${ fmt(p) }</b>`
					: `<b>0.5</b>, because the combined percentage is 0%` }
			</p>
			${ notes.length ? `<ul class="notes">${ notes.map(n => `<li>${ n }</li>`).join("") }</ul>` : "" }
			${ componentsTable(mix.space, rows) }
			<p class="pushed">
				Pushed back onto the stack:
				${ swatch(trace.result) }<code>${ esc(serialize(trace.result)) }</code> at ${ fmt(combined) }%.
			</p>
		</div>`;
	}).join("");

	return `<section>
		<h2>4. Mix the colors, two at a time</h2>
		${ intro }
		${ blocks }
	</section>`;
}

function renderFinal (mix) {
	let last = mix.iterations.length
		? mix.iterations[mix.iterations.length - 1].trace.result
		: mix.items[0].interpolated;

	let note;

	if (last.alpha === null) {
		note = `<p class="note">The alpha of the mixed color is missing, so there is no value to scale; it stays <code>none</code>.</p>`;
	}
	else if (mix.alphaMult === 1) {
		note = `<p class="note">alpha mult is 1, so the alpha is unchanged.</p>`;
	}
	else {
		note = `<p class="calc">alpha = ${ fmt(last.alpha) } &times; ${ fmt(mix.alphaMult) } = <b>${ fmt(mix.color.alpha) }</b></p>`;
	}

	return `<section>
		<h2>5. Multiply the alpha by alpha mult, and return</h2>
		${ note }
		${ componentsTable(mix.space, [
			{ label: "before", color: last, muted: true },
			{ label: "returned color", color: mix.color, swatch: true },
		]) }
	</section>`;
}

/* --------------------------------------------------------------------- app -- */

let input = document.getElementById("input");
let output = document.getElementById("output");
let error = document.getElementById("error");
let permalink = document.getElementById("permalink");

function update () {
	let value = input.value.trim();
	let query = `?mix=${ encodeURIComponent(value) }`;
	permalink.href = query;
	history.replaceState(null, "", query);

	let mix;

	try {
		mix = computeColorMix(value);
	}
	catch (e) {
		error.textContent = e.message;
		error.hidden = false;
		output.hidden = true;
		input.setCustomValidity(e.message);
		return;
	}

	error.hidden = true;
	input.setCustomValidity("");

	output.innerHTML = renderResult(mix, value)
		+ renderParse(mix)
		+ renderColors(mix)
		+ renderNormalization(mix)
		+ renderIterations(mix)
		+ renderFinal(mix);
	output.hidden = false;
}

document.getElementById("form").addEventListener("submit", event => event.preventDefault());
input.addEventListener("input", update);

document.querySelector(".examples").addEventListener("click", event => {
	if (event.target.matches("button")) {
		input.value = event.target.textContent.trim();
		update();
	}
});

let params = new URL(location).searchParams;

if (params.get("mix")) {
	input.value = params.get("mix");
}

update();
