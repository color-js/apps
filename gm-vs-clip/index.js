import { analyze, classify, control, distance, scan, spaces, wptPath, wptSource } from "./compute.js";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const colorInput = $("#color");
const spaceInput = $("#space");
const marginInput = $("#margin");

/** The colors added to each canvas's test, as typed */
let cases = { p3: [], srgb: [] };

/* -------------------------------------------------------------- formatting -- */

function esc (str) {
	return String(str).replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[char]);
}

function fmt (value, digits = 4) {
	return String(Number(value.toFixed(digits)));
}

function fmtBytes (bytes, digits = 2) {
	return bytes.map(v => `<td>${ v.toFixed(digits) }</td>`).join("");
}

function margin () {
	let value = Number(marginInput.value);
	return Number.isFinite(value) && value >= 0 ? value : 1;
}

/** The chosen canvas color space, as a key of `spaces` */
function space () {
	return spaces[spaceInput.value] ? spaceInput.value : "p3";
}

/** A CSS color from 0‥255 bytes in `space`, for painting a swatch */
function cssBytes (bytes, space) {
	return `color(${ spaces[space].css } ${ bytes.map(v => fmt(v / 255)).join(" ") })`;
}

function swatch (css, extraClass = "") {
	return `<span class="swatch ${ extraClass }" style="--color: ${ esc(css) }"></span>`;
}

/* -------------------------------------------------------------- the color -- */

function renderOrigin (r) {
	let [l, c, h] = r.oklch.coords;
	let raw = r.raw.map(v => {
		let out = v < -0.5 || v > 255.5;
		return `<span class="${ out ? "out" : "" }">${ fmt(v / 255) }</span>`;
	}).join(" ");

	let notes = [];

	if (r.hadAlpha) {
		notes.push("The alpha was ignored and set to 1, so that no premultiplication gets in the way of reading the pixel back.");
	}

	return `<section class="origin">
		${ swatch(r.origin.display().toString(), "huge") }
		<dl>
			<dt>O</dt><dd><code>${ esc(r.input) }</code></dd>
			<dt>Oklch</dt><dd><code>oklch(${ fmt(l * 100, 2) }% ${ fmt(c) } ${ Number.isFinite(h) ? fmt(h, 2) : "none" })</code></dd>
			<dt>${ r.space.label }</dt><dd><code>color(${ r.space.css } ${ raw })</code>
				${ r.inGamut ? "" : "<span class=\"note\">(out-of-range channels highlighted)</span>" }</dd>
		</dl>
		${ notes.map(note => `<p class="note">${ note }</p>`).join("") }
	</section>`;
}

/* ------------------------------------------------------------------ table -- */

function renderTable (r, space) {
	let row = (label, bytes, { deltaEOK, note = "", cls = "", digits = 2 } = {}) => `<tr class="${ cls }">
		<th scope="row">${ swatch(cssBytes(bytes, space)) }${ label }${ note ? ` <span class="note">${ note }</span>` : "" }</th>
		${ bytes.map(v => `<td>${ fmt(v / 255) }</td>`).join("") }
		${ fmtBytes(bytes, digits) }
		<td>${ fmt(Math.max(...bytes.map((v, i) => Math.abs(v - r.expected[i]))), 2) }</td>
		<td>${ deltaEOK === undefined ? "" : fmt(deltaEOK) }</td>
	</tr>`;

	let mapped = r.mapped.map((m, i) => row(
		`G<sub>${ i + 1 }</sub>`,
		m.bytes,
		{ deltaEOK: m.deltaEOK, note: `<a href="${ m.href }">${ m.label }</a>`, cls: "gm" },
	)).join("");

	return `<div class="scroller"><table class="values">
		<thead>
			<tr><th></th><th colspan="3">${ r.space.label }</th><th colspan="3">8-bit ${ r.space.label }</th><th rowspan="2">distance<br>from E</th><th rowspan="2">ΔE<sub>OK</sub><br>from O</th></tr>
			<tr><th></th><th>r</th><th>g</th><th>b</th><th>r</th><th>g</th><th>b</th></tr>
		</thead>
		<tbody>
			${ row("C", r.clipped.bytes, { deltaEOK: r.clipped.deltaEOK, note: "clipped", cls: "clip" }) }
			${ mapped }
			${ row("G", r.mean, { note: "mean of the three", cls: "mean" }) }
			${ row("E", r.expected, { note: "G rounded: what the test expects to read back", cls: "mean", digits: 0 }) }
		</tbody>
	</table></div>`;
}

/* ---------------------------------------------------------- channel plot -- */

/**
 * One 0‥255 track per channel, with the E ± S band shaded and a mark for C and for
 * each of G₁…G₃, so the gap between the band and C is visible at a glance
 */
function renderPlot (r) {
	let pct = v => `${ (Math.min(255, Math.max(0, v)) / 255 * 100).toFixed(3) }%`;

	let tracks = ["r", "g", "b"].map((name, i) => {
		let lo = r.expected[i] - r.S;
		let hi = r.expected[i] + r.S;
		let marks = r.mapped.map((m, j) =>
			`<span class="mark gm" style="left: ${ pct(m.bytes[i]) }" title="G${ j + 1 } ${ m.short }: ${ m.bytes[i].toFixed(2) }"></span>`).join("");

		return `<div class="track">
			<span class="channel">${ name }</span>
			<div class="rail">
				<span class="band" style="left: ${ pct(lo) }; right: calc(100% - ${ pct(hi) })" title="E ± S: ${ lo } – ${ hi }"></span>
				${ marks }
				<span class="mark clip" style="left: ${ pct(r.clipped.bytes[i]) }" title="C: ${ r.clipped.bytes[i].toFixed(2) }"></span>
			</div>
		</div>`;
	}).join("");

	return `<div class="plot">
		${ tracks }
		<p class="legend">
			<span><span class="key band"></span>E ± S</span>
			<span><span class="key gm"></span>G<sub>1</sub>, G<sub>2</sub>, G<sub>3</sub></span>
			<span><span class="key clip"></span>C</span>
			<span class="note">0 to 255 on each track</span>
		</p>
	</div>`;
}

/* ---------------------------------------------------------------- verdict -- */

function addButton (input, space) {
	let added = cases[space].includes(input);
	return `<button type="button" class="add" data-color="${ esc(input) }" data-space="${ space }" ${ added ? "disabled" : "" }>${ added ? `In the ${ spaces[space].label } test` : `Add to ${ spaces[space].label } test` }</button>`;
}

function renderVerdict (r, space) {
	let reason;

	if (r.inGamut) {
		reason = `O is already inside the ${ r.space.label } gamut, so clipping and all three algorithms leave it unchanged. There is nothing for a test to tell apart.`;
	}
	else if (r.sameAsClip.length) {
		let names = r.sameAsClip.map(m => m.label).join(" and ");
		reason = `${ names } ${ r.sameAsClip.length > 1 ? "return" : "returns" } the clipped color itself
			(clipping O is within one JND of it), so a browser using ${ r.sameAsClip.length > 1 ? "them" : "it" }
			cannot be told apart from one that clips. Pick another color.`;
	}
	else if (!r.usable) {
		reason = `All three algorithms fit only within S = ${ r.minS }, but the clipped color is within that too
			(the largest S that excludes it is ${ r.maxS }). The algorithms disagree too much for this color.`;
	}
	else {
		reason = `All three algorithms fit within <b>S = ${ r.S }</b> of E (the worst is ${ fmt(r.fit, 2) } away, plus the margin of ${ r.margin }),
			and the clipped color does not: it is ${ fmt(r.clipDistance, 2) } away,
			so S could go as high as ${ r.maxS } and, allowing for the margin, still exclude it.`;
	}

	return `<section class="verdict ${ r.usable ? "yes" : "no" }">
		<h2>${ r.usable ? "A good test color" : "Not usable as a test color" } for ${ spaces[space].a } ${ r.space.label } canvas</h2>
		<p>${ reason }</p>
		${ r.usable ? `<dl>
			<dt>E</dt><dd><code>[${ r.expected.join(", ") }]</code> ± ${ r.S }</dd>
			<dt>C</dt><dd><code>[${ r.clippedRead.join(", ") }]</code> ± ${ r.clipTolerance }</dd>
		</dl>
		${ addButton(r.input, space) }` : "" }
	</section>`;
}

/* ----------------------------------------------------------- in this browser -- */

/**
 * Paint a 5×5 patch of a color into a unorm8 canvas in `space` and read back its
 * center pixel, well clear of any antialiased edge, as the test does
 */
function readBack (color, space) {
	let css = spaces[space].css;
	let canvas = document.createElement("canvas");
	canvas.width = canvas.height = 5;
	let ctx = canvas.getContext("2d", { colorSpace: css, colorType: "unorm8" });
	// Browsers without color-managed canvases may not report a colorSpace at all,
	// but their canvas is sRGB
	let colorSpace = ctx.getContextAttributes?.().colorSpace ?? "srgb";
	ctx.fillStyle = color;
	ctx.fillRect(0, 0, 5, 5);
	let data = ctx.getImageData(2, 2, 1, 1, { colorSpace: css }).data;
	return { pixel: Array.from(data.slice(0, 3)), colorSpace };
}

function renderBrowser (r, space) {
	let result;

	try {
		result = readBack(r.origin.toString({ precision: 10 }), space);
	}
	catch (error) {
		return `<p class="error">Could not read back ${ spaces[space].a } ${ r.space.label } canvas: ${ esc(error.message) }</p>`;
	}

	if (result.colorSpace !== r.space.css) {
		return `<p class="error">This browser does not support ${ r.space.label } canvases, so there is nothing to check.</p>`;
	}

	let ctl = control(space);
	let ctlPixel = readBack(ctl.color, space).pixel;
	let ctlOK = distance(ctlPixel, ctl.expected) <= ctl.tolerance;
	let controlLine = `<div class="readback control ${ ctlOK ? "yes" : "no" }">
		${ swatch(cssBytes(ctlPixel, space), "big") }
		<p>Control: the in-gamut <code>${ esc(ctl.color) }</code> should read back as
		<code>[${ ctl.expected.join(", ") }]</code> and did read back as <code>[${ ctlPixel.join(", ") }]</code>:
		<b>${ ctlOK ? "unchanged" : "changed" }</b>.
		${ ctlOK ? "" : `This canvas changes colors that need no gamut mapping (perhaps by converting them to the display’s color profile), so the result above cannot be judged.` }</p>
	</div>`;

	let c = classify(result.pixel, r);
	let detail = {
		"gamut mapped": `within ${ r.S } of E; closest to ${ c.nearest.label } (${ fmt(c.toNearest, 2) } away).`,
		"clipped": `within ${ r.clipTolerance } of the clipped color.`,
		"neither": `${ fmt(c.toExpected, 2) } from E, where S is ${ r.S }, and ${ fmt(c.toClip, 2) } from the clipped color.`,
	}[c.verdict];

	return `<div class="readback ${ c.verdict === "gamut mapped" ? "yes" : "no" }">
		${ swatch(cssBytes(result.pixel, space), "big") }
		<p>On ${ spaces[space].a } ${ r.space.label } canvas, this browser painted O as <code>[${ result.pixel.join(", ") }]</code>: <b>${ c.verdict }</b>, ${ detail }
		${ r.usable ? "" : "<br><span class=\"note\">But this color cannot tell the two apart, so read nothing into it.</span>" }</p>
	</div>
	${ controlLine }`;
}

/* -------------------------------------------------------------------- scan -- */

function renderScan () {
	let s = space();
	let results = scan({ space: s, margin: margin() });

	let rows = results.slice(0, 25).map(r => `<tr>
		<th scope="row">${ swatch(cssBytes(r.expected, s)) }<code>${ esc(r.input) }</code></th>
		<td>${ r.S }</td>
		<td>${ r.maxS }</td>
		<td><code>[${ r.expected.join(", ") }]</code></td>
		<td><code>[${ r.clippedRead.join(", ") }]</code></td>
		<td class="actions">
			<button type="button" class="use" data-color="${ esc(r.input) }">Show</button>
			${ addButton(r.input, s) }
		</td>
	</tr>`).join("");

	$("#scan-output").innerHTML = `<p class="note">${ results.length } usable colors for ${ spaces[s].a } ${ spaces[s].label } canvas; the best 25 are shown.</p>
		<div class="scroller"><table class="values scan">
			<thead><tr><th>O</th><th>S</th><th>max S</th><th>E</th><th>C</th><th></th></tr></thead>
			<tbody>${ rows }</tbody>
		</table></div>`;
}

function rescan () {
	if ($("#scan-output").childElementCount) {
		renderScan();
	}
}

/* ------------------------------------------------------------------- tests -- */

function renderCases () {
	for (let panel of $$(".test")) {
		let s = panel.dataset.space;
		let reports = cases[s].map(input => analyze(input, { space: s, margin: margin() }));

		panel.querySelector(".cases").innerHTML = reports.length
			? reports.map(r => `<li>
				${ swatch(cssBytes(r.expected, s)) }<code>${ esc(r.input) }</code>
				<span class="note">E [${ r.expected.join(", ") }] ± ${ r.S }, C [${ r.clippedRead.join(", ") }]</span>
				<button type="button" class="remove" data-color="${ esc(r.input) }" data-space="${ s }" aria-label="Remove ${ esc(r.input) }">×</button>
			</li>`).join("")
			: `<li class="note">No colors yet.</li>`;

		panel.querySelector(".path").textContent = wptPath(s);
		panel.querySelector(".source").textContent = wptSource(reports, s);
		panel.querySelector(".copy").disabled = !reports.length;
	}
}

/* ------------------------------------------------------------------- state -- */

function updateURL () {
	let params = new URLSearchParams();
	params.set("color", colorInput.value);

	if (space() !== "p3") {
		params.set("space", space());
	}

	if (margin() !== 1) {
		params.set("margin", margin());
	}

	for (let s in cases) {
		if (cases[s].length) {
			// Semicolons never appear in a CSS color
			params.set(`tests-${ s }`, cases[s].join(";"));
		}
	}

	let url = "?" + params;
	history.replaceState(null, "", url);
	$("#permalink").href = url;
}

function update () {
	let s = space();
	let r;

	try {
		r = analyze(colorInput.value, { space: s, margin: margin() });
	}
	catch (error) {
		$("#error").textContent = `Not a color Color.js can parse: ${ error.message }`;
		$("#error").hidden = false;
		$("#output").hidden = $("#browser").hidden = true;
		renderCases();
		updateURL();
		return;
	}

	$("#error").hidden = true;
	$("#output").innerHTML = renderOrigin(r) + renderVerdict(r, s)
		+ (r.inGamut ? "" : renderTable(r, s) + renderPlot(r));
	$("#output").hidden = false;
	$("#browser-output").innerHTML = renderBrowser(r, s);
	$("#browser").hidden = false;

	renderCases();
	updateURL();
}

/* ------------------------------------------------------------------ events -- */

let params = new URLSearchParams(location.search);
colorInput.value = params.get("color") ?? colorInput.value;
spaceInput.value = spaces[params.get("space")] ? params.get("space") : "p3";
marginInput.value = params.get("margin") ?? marginInput.value;

for (let s in cases) {
	// `tests` is what the first, display-p3 only, version of this app wrote
	let list = params.get(`tests-${ s }`) ?? (s === "p3" ? params.get("tests") : null);
	cases[s] = list?.split(";").filter(Boolean) ?? [];
}

colorInput.addEventListener("input", update);

for (let input of [spaceInput, marginInput]) {
	input.addEventListener("input", () => {
		update();
		rescan();
	});
}

$("#form").addEventListener("submit", event => event.preventDefault());

$(".examples").addEventListener("click", event => {
	let button = event.target.closest("button");

	if (button) {
		colorInput.value = button.textContent;
		update();
	}
});

$("#scan").addEventListener("click", renderScan);

document.addEventListener("click", event => {
	let button = event.target.closest("button[data-color]");

	if (!button) {
		return;
	}

	let color = button.dataset.color;
	let s = button.dataset.space;

	if (button.classList.contains("add")) {
		if (!cases[s].includes(color)) {
			cases[s].push(color);
		}

		update();
		rescan();
	}
	else if (button.classList.contains("remove")) {
		cases[s] = cases[s].filter(c => c !== color);
		update();
		rescan();
	}
	else if (button.classList.contains("use")) {
		colorInput.value = color;
		update();
		$("#output").scrollIntoView({ behavior: "smooth" });
	}
});

for (let button of $$(".copy")) {
	button.addEventListener("click", async () => {
		let source = button.closest(".test").querySelector(".source").textContent;

		try {
			await navigator.clipboard.writeText(source);
			button.textContent = "Copied";
		}
		catch (error) {
			button.textContent = "Copy failed";
		}

		setTimeout(() => button.textContent = "Copy", 1500);
	});
}

update();
