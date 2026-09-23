// Everything here is DOM-free, so it runs in Node as well as the browser.
import Color from "colorjs.io";
// The EdgeSeeker in the Gamut Mapping Playground is the implementation CSS Color 4
// cites as the reference for this algorithm (it has no pseudocode in the spec yet).
// The Playground only builds a display-p3 LUT, so build one per destination here.
import { makeEdgeSeeker } from "../gamut-mapping/methods/edge-seeker/makeEdgeSeeker.js";

const SPEC = "https://drafts.csswg.org/css-color-4/";

/**
 * The canvas color spaces a test can paint into.
 * `id` is the Color.js space; `css` is the canvas colorSpace and the CSS name.
 */
export const spaces = {
	p3: { id: "p3", css: "display-p3", label: "display-p3", a: "a" },
	srgb: { id: "srgb", css: "srgb", label: "sRGB", a: "an" },
};

/**
 * An in-gamut color written in each canvas's own color space, so that neither
 * conversion nor gamut mapping should touch it: it must read back unchanged.
 * If it does not, the canvas pipeline alters every color (for example by converting
 * to the display's profile), and the gamut mapping results mean nothing.
 */
const controlColors = {
	p3: "color(display-p3 0.8 0.4 0.2)",
	srgb: "rgb(200 100 50)",
};

/** The control color for `space`, and the bytes it must read back as */
export function control (space = "p3") {
	let color = controlColors[space];
	return { color, expected: toBytes(new Color(color), space).map(Math.round), tolerance: 1 };
}

/** Per-channel clamp into `space`; always a new color */
export function clip (color, space) {
	return color.to(space).toGamut({ space, method: "clip" });
}

// Building a LUT takes a moment, so only for the spaces actually asked for
const edgeSeekers = {};

function edgeSeeker (color, space) {
	edgeSeekers[space] ??= makeEdgeSeeker((r, g, b) => {
		const [l, c, h = 0] = new Color(space, [r, g, b]).to("oklch").coords;
		return { l, c, h };
	});

	let [l, c, h] = color.to("oklch").coords;

	if (l <= 0 || l >= 1) {
		return new Color("oklab", [Math.min(Math.max(l, 0), 1), 0, 0]);
	}

	return new Color("oklch", [l, Math.min(c, edgeSeekers[space](l, h || 0)), h]);
}

/**
 * The three CSS gamut mapping algorithms, CSS Color 4 § 14.2.
 * Each takes an Oklch color and returns a new color in `space`. The final clip
 * is a no-op for MINDE and Ray Trace, which already end with one; EdgeSeeker's LUT
 * is an approximation, and can land a hair outside the gamut.
 */
export const methods = [
	{
		id: "minde",
		label: "Binary search with local MINDE",
		short: "MINDE",
		href: SPEC + "#GMA-Binary-local-MINDE",
		map: (color, space) => clip(color.clone().toGamut({ space, method: "css" }), space),
	},
	{
		id: "edgeseeker",
		label: "EdgeSeeker",
		short: "EdgeSeeker",
		href: SPEC + "#GMA-EdgeSeeker",
		map: (color, space) => clip(edgeSeeker(color, space), space),
	},
	{
		id: "raytrace",
		label: "Ray Trace",
		short: "Ray Trace",
		href: SPEC + "#GMA-Raytrace",
		map: (color, space) => clip(color.clone().toGamut({ space, method: "raytrace" }), space),
	},
];

/** RGB coords 0‥1 in `space` → the 0‥255 scale getImageData() reads back, unrounded */
export function toBytes (color, space) {
	return color.to(space).coords.map(v => v * 255);
}

/** Chebyshev distance: the largest per-channel difference */
export function distance (a, b) {
	return Math.max(...a.map((v, i) => Math.abs(v - b[i])));
}

/**
 * Analyze one color against the gamut of `space` ("p3" or "srgb").
 *
 * All distances are in 8-bit units of `space`, since that is what a unorm8 canvas
 * stores and what the test reads back.
 *
 * `margin` is the slack, in those units, allowed for an implementation whose
 * arithmetic differs slightly from Color.js (float precision, rounding to 8 bits).
 * It is added on both sides: an implementation up to `margin` away from any of the
 * three algorithms must still pass, and one up to `margin` away from the clipped
 * color must still fail.
 */
export function analyze (input, { space = "p3", margin = 1 } = {}) {
	let origin = new Color(input);
	let hadAlpha = origin.alpha < 1;
	origin.alpha = 1;

	let oklch = origin.to("oklch");
	let raw = toBytes(origin, space);
	let inGamut = origin.inGamut(space, { epsilon: 0 });

	let clipped = clip(oklch, space);
	let mapped = methods.map(method => {
		let color = method.map(oklch, space);
		return { ...method, color, bytes: toBytes(color, space), deltaEOK: color.deltaE(origin, "OK") };
	});

	let clipBytes = toBytes(clipped, space);
	let mean = [0, 1, 2].map(i => mapped.reduce((sum, m) => sum + m.bytes[i], 0) / mapped.length);

	// What the test expects to read back, as whole bytes
	let expected = mean.map(Math.round);
	let clippedRead = clipBytes.map(Math.round);

	for (let m of mapped) {
		m.fromExpected = distance(m.bytes, expected);
		m.fromClip = distance(m.bytes, clipBytes);
	}

	// The spread of the three algorithms about the expected value
	let fit = Math.max(...mapped.map(m => m.fromExpected));
	let clipDistance = distance(clipBytes, expected);

	// Smallest tolerance that accepts anything within margin of all three algorithms,
	// and largest that still rejects anything within margin of the clipped color
	let minS = Math.ceil(fit + margin);
	let maxS = Math.ceil(clipDistance - margin) - 1;

	// A method whose result is the clipped color is not something a test can tell apart
	let sameAsClip = mapped.filter(m => m.fromClip < 0.5);

	return {
		input,
		space: spaces[space],
		origin,
		hadAlpha,
		oklch,
		raw,
		inGamut,
		margin,
		clipped: { color: clipped, bytes: clipBytes, deltaEOK: clipped.deltaE(origin, "OK") },
		mapped,
		mean,
		expected,
		clippedRead,
		fit,
		clipDistance,
		minS,
		maxS,
		S: minS,
		headroom: maxS - minS,
		usable: !inGamut && minS <= maxS,
		sameAsClip,
		clipTolerance: Math.max(1, Math.ceil(margin)),
	};
}

/**
 * Classify pixel bytes read back from a canvas against an analysis.
 * Returns "gamut mapped", "clipped" or "neither", plus the nearest single algorithm.
 */
export function classify (pixel, report) {
	let toExpected = distance(pixel, report.expected);
	let toClip = distance(pixel, report.clippedRead);
	let nearest = report.mapped.reduce((best, m) =>
		distance(pixel, m.bytes) < distance(pixel, best.bytes) ? m : best);

	let verdict = toExpected <= report.S ? "gamut mapped"
		: toClip <= report.clipTolerance ? "clipped"
		: "neither";

	return { verdict, toExpected, toClip, nearest, toNearest: distance(pixel, nearest.bytes) };
}

/**
 * Candidate test colors: the display-p3 and Rec. 2020 primaries and secondaries, and
 * round-number Oklch colors across lightness, chroma and hue. The analysis weeds out
 * whichever are inside the destination gamut.
 */
export function* candidates () {
	let corners = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 1, 1], [1, 0, 1], [1, 1, 0]];

	for (let space of ["display-p3", "rec2020"]) {
		for (let channels of corners) {
			yield `color(${ space } ${ channels.join(" ") })`;
		}
	}

	for (let l = 30; l <= 90; l += 10) {
		for (let c of [0.2, 0.25, 0.3, 0.35]) {
			for (let h = 0; h < 360; h += 30) {
				yield `oklch(${ l }% ${ c } ${ h })`;
			}
		}
	}
}

/**
 * Every usable candidate, best first: a tight tolerance that still sits far from the
 * clipped color, measured as how many times over S could grow before admitting clip
 */
export function scan ({ space = "p3", margin = 1 } = {}) {
	let results = [];

	for (let input of candidates()) {
		let report = analyze(input, { space, margin });

		if (report.usable) {
			results.push(report);
		}
	}

	return results.sort((a, b) => b.maxS / b.S - a.maxS / a.S || a.S - b.S);
}

/** Where the generated test would live in web-platform-tests */
export function wptPath (space = "p3") {
	return `css/css-color/canvas-${ spaces[space].css }-gamut-mapping.html`;
}

/**
 * The source of a web-platform-test that paints each case into a unorm8 canvas in
 * `space`, reads it back, and reports whether it was gamut mapped, clipped, or neither.
 * All the reports must be for that same space.
 */
export function wptSource (reports, space = "p3") {
	let { css, label, a } = spaces[space];
	let fmt = bytes => `[${ bytes.map(v => Math.round(v)).join(", ") }]`;
	let fmt2 = bytes => `[${ bytes.map(v => v.toFixed(2)).join(", ") }]`;

	let cases = reports.map(r => {
		let perMethod = r.mapped.map(m => `${ m.short } ${ fmt2(m.bytes) }`).join(", ");
		return `\t// ${ perMethod }\n`
			+ `\t{ color: ${ JSON.stringify(r.input) }, mapped: ${ fmt(r.expected) }, tolerance: ${ r.S }, clipped: ${ fmt(r.clippedRead) }, clipTolerance: ${ r.clipTolerance } },`;
	}).join("\n");

	// sRGB is the default canvas color space, and supporting it does not imply
	// supporting getContextAttributes().colorSpace, so only check for display-p3
	let checkSpace = space === "srgb" ? "" : `
	assert_equals(ctx.getContextAttributes().colorSpace, "${ css }", "canvas colorSpace");`;

	let ctl = control(space);

	return `<!DOCTYPE html>
<meta charset="utf-8">
<title>CSS Color 4: colors outside ${ label } are gamut mapped, not clipped, on ${ a } ${ label } unorm8 canvas</title>
<link rel="help" href="https://drafts.csswg.org/css-color-4/#css-gamut-mapping">
<meta name="assert" content="Painting a color outside the ${ label } gamut into a 2d canvas whose colorSpace is ${ css } and colorType is unorm8 applies one of the three CSS gamut mapping algorithms, which reduce chroma at constant Oklch lightness and hue, rather than clipping each channel.">
<script src="/resources/testharness.js"></script>
<script src="/resources/testharnessreport.js"></script>
<body>
<script>
// Generated by https://apps.colorjs.io/gm-vs-clip/
//   mapped:    the mean of the three CSS gamut mapping algorithms, in 8-bit ${ label }
//   tolerance: per channel; all three algorithms are within it of mapped, and the clipped color is not
//   clipped:   the color clipped per channel, in 8-bit ${ label }, for reporting what happened
// The comment above each case gives the three algorithms' own results.
const cases = [
${ cases }
];

// A color inside the gamut, in the canvas's own color space, which neither conversion
// nor gamut mapping should touch. If it changes, the canvas alters every color (for
// example by converting to the display's color profile) and the cases above cannot be judged.
const control = { color: ${ JSON.stringify(ctl.color) }, expected: ${ fmt(ctl.expected) }, tolerance: ${ ctl.tolerance } };

// Paint a 5×5 patch and sample its center pixel, well clear of any antialiased edge
function paint(color) {
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = 5;
	const ctx = canvas.getContext("2d", { colorSpace: "${ css }", colorType: "unorm8" });${ checkSpace }
	ctx.fillStyle = color;
	ctx.fillRect(0, 0, 5, 5);
	return Array.from(ctx.getImageData(2, 2, 1, 1, { colorSpace: "${ css }" }).data.slice(0, 3));
}

function within(actual, expected, tolerance) {
	return actual.every((value, i) => Math.abs(value - expected[i]) <= tolerance);
}

test(() => {
	const actual = paint(control.color);
	assert_true(within(actual, control.expected, control.tolerance),
		\`read back [\${actual}], expected [\${control.expected}] ± \${control.tolerance}: this canvas changes in-gamut colors, so gamut mapping cannot be judged\`);
}, \`control: in-gamut \${control.color} is unchanged on ${ a } ${ label } canvas\`);

for (const { color, mapped, tolerance, clipped, clipTolerance } of cases) {
	test(() => {
		const actual = paint(color);
		const result = within(actual, mapped, tolerance) ? "gamut mapped"
			: within(actual, clipped, clipTolerance) ? "clipped"
			: "neither gamut mapped nor clipped";
		assert_equals(result, "gamut mapped",
			\`read back [\${actual}]; gamut mapped is [\${mapped}] ± \${tolerance}, clipped is [\${clipped}]\`);
	}, \`\${color} painted on ${ a } ${ label } canvas\`);
}
</script>
`;
}
