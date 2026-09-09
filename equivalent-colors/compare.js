/**
 * Comparing <color> values, implemented from
 * CSS Color 4 § 12 Comparing <color> Values
 * <https://www.w3.org/TR/css-color-4/#comparing-color-values>
 *
 * The algorithm is written out here, rather than delegated to Color.js, so that every
 * intermediate value and every decision can be shown to the reader.
 */

import Color from "colorjs.io";

/**
 * The ε the spec standardizes for the cross-color-space comparison in Oklab.
 * CSS Color 4 § 12, step 4.
 */
export const OKLAB_EPSILON = 0.00001;

/**
 * The ε used when the two colors are in the same <color-space>. The spec leaves this one
 * "implementation-defined"; this app uses the same value as the Oklab one, and shows the
 * actual per-component differences so you can see how close it was.
 */
export const SAME_SPACE_EPSILON = 0.00001;

/**
 * The formats CSS considers to be in the srgb <color-space>. CSS Color 4 § 12:
 * "rgb(), rgba(), hsl(), hsla(), hwb(), hex colors, named colors, and system colors are
 * all considered to be in the srgb <color-space>." See also § 15.1 Resolving sRGB values.
 */
const SRGB_FORMATS = new Set(["keyword", "hex", "rgb", "rgb_number", "hsl", "hwb"]);

/**
 * The "powerless hue ε" each cylindrical color space defines, and the component that
 * decides whether the hue has any effect on the resulting color.
 * CSS Color 4 § 4.4.1 "Powerless" Color Components, plus each space's own table.
 */
const POWERLESS = {
	hsl: {
		hue: 0,
		colorfulness: 1,
		colorfulnessName: "saturation",
		epsilon: 0.001,
		condition: "S ≤ 0.001",
	},
	hwb: {
		hue: 0,
		epsilon: 99.999,
		condition: "W + B ≥ 99.999",
	},
	lch: {
		hue: 2,
		colorfulness: 1,
		colorfulnessName: "chroma",
		epsilon: 0.0015,
		condition: "C ≤ 0.0015",
	},
	oklch: {
		hue: 2,
		colorfulness: 1,
		colorfulnessName: "chroma",
		epsilon: 0.000004,
		condition: "C ≤ 0.000004",
	},
};

/**
 * A <hue> is normalized to the range [0, 360) when it is parsed, so lch(50% 30 360) and
 * lch(50% 30 0) are the same value long before anything is compared.
 * CSS Color 4 § 4.3 <https://www.w3.org/TR/css-color-4/#typedef-hue>
 */
function normalizeHue (hue) {
	if (!Number.isFinite(hue)) {
		// § 4.3: calc(infinity) and calc(-infinity) both normalize to 0deg
		return 0;
	}

	return ((hue % 360) + 360) % 360;
}

/** The index of the hue component, for the cylindrical spaces that have one */
function hueIndex (space) {
	return Object.values(space.coords).findIndex(coord => coord.type === "angle");
}

/** A missing component behaves as a zero value for every purpose but interpolation. § 4.4 */
function zeroed (value) {
	return value === null ? 0 : value;
}

export function componentNames (space) {
	return Object.values(space.coords).map(coord => coord.name);
}

export function spaceOf (spaceId) {
	return new Color(spaceId, [0, 0, 0]).space;
}

export function toColor (color) {
	return new Color(color.spaceId, color.coords.map(zeroed), zeroed(color.alpha));
}

/** The CSS <color-space> a parsed color is considered to be in, for the purposes of § 12. */
function cssColorSpace (spaceId, formatId) {
	if (SRGB_FORMATS.has(formatId)) {
		return "srgb";
	}

	let space = spaceOf(spaceId);

	return space.cssId ?? spaceId;
}

function clone (color) {
	return { spaceId: color.spaceId, coords: [...color.coords], alpha: color.alpha };
}

/**
 * Convert a color into another color space so that its components can be compared.
 * A missing component behaves as zero while converting (§ 4.4), and the conversion result
 * has no missing components of its own. Alpha belongs to no color space, so it is carried
 * across untouched, missing and all.
 */
function convert (color, spaceId) {
	if (color.spaceId === spaceId) {
		return clone(color);
	}

	let converted = new Color(color.spaceId, color.coords.map(zeroed), 1).to(spaceId);

	return { spaceId, coords: [...converted.coords], alpha: color.alpha };
}

/* ------------------------------------------------------------------- step 1 -- */

/**
 * Step 1: "For each of C1 and C2, convert any powerless components to missing components."
 *
 * Only the cylindrical spaces have a powerless component: the hue, when the color is
 * achromatic. When a powerless hue is made missing, the colorfulness component is set to
 * zero as well, so that floating point noise is not amplified later on (§ 4.4.1).
 */
function step1 (color) {
	let rule = POWERLESS[color.spaceId];
	let result = clone(color);

	if (!rule) {
		return {
			color: result,
			rule: null,
			applies: false,
			explanation: `${ spaceOf(color.spaceId).name } has no powerless components, so nothing changes.`,
		};
	}

	let hueWasMissing = color.coords[rule.hue] === null;
	let measured, applies, test;

	if (color.spaceId === "hwb") {
		measured = zeroed(color.coords[1]) + zeroed(color.coords[2]);
		applies = measured >= rule.epsilon;
		test = `W + B = ${ fmtNumber(measured) } ${ applies ? "≥" : "<" } 99.999`;
	}
	else {
		measured = zeroed(color.coords[rule.colorfulness]);
		applies = measured <= rule.epsilon;
		test = `${ rule.colorfulnessName } = ${ fmtNumber(measured) } ${ applies ? "≤" : ">" } ${ rule.epsilon }`;
	}

	if (!applies) {
		return {
			color: result,
			rule,
			applies: false,
			test,
			explanation: `The hue still has an effect on the color (${ test }), so it is not powerless and nothing changes.`,
		};
	}

	result.coords[rule.hue] = null;

	let fixups = [];

	if (color.spaceId === "hwb") {
		// § 4.4.1: renormalize whiteness and blackness so that they still add up to 100,
		// rather than leaving a sum that is merely within ε of it.
		if (measured < 100) {
			let [, w, b] = result.coords;

			if (w !== null && b !== null) {
				result.coords[2] = 100 - w;
				fixups.push(`blackness set to 100 − W = ${ fmtNumber(result.coords[2]) }`);
			}
			else if (w !== null) {
				result.coords[1] = 100;
				fixups.push("whiteness set to 100");
			}
			else if (b !== null) {
				result.coords[2] = 100;
				fixups.push("blackness set to 100");
			}
		}
	}
	else {
		// § 4.4.1: the colorfulness is zeroed only when it is above zero but no larger
		// than ε. A negative chroma is deliberately left alone.
		let c = result.coords[rule.colorfulness];

		if (c !== null && c > 0 && c <= rule.epsilon) {
			result.coords[rule.colorfulness] = 0;
			fixups.push(`${ rule.colorfulnessName } set to 0`);
		}
	}

	let explanation = hueWasMissing
		? `The hue is powerless (${ test }), and it was already missing.`
		: `The hue is powerless (${ test }), so it becomes missing.`;

	if (fixups.length > 0) {
		explanation += ` To avoid amplifying floating point noise, ${ fixups.join(", ") }.`;
	}

	return { color: result, rule, applies: true, test, fixups, explanation, hueWasMissing };
}

/* -------------------------------------------------------------------- parse -- */

function parseColor (input) {
	let str = String(input).trim();

	if (!str) {
		throw new TypeError("Enter a CSS color in both fields.");
	}

	let meta = {};
	let parsed;

	try {
		parsed = Color.parse(str, { parseMeta: meta });
	}
	catch (error) {
		throw new TypeError(`Could not parse “${ str }” as a CSS color.`);
	}

	let space = spaceOf(parsed.spaceId);
	let color = {
		spaceId: parsed.spaceId,
		coords: [...parsed.coords],
		alpha: parsed.alpha === undefined ? 1 : parsed.alpha,
	};

	let hue = hueIndex(space);
	let normalizedHue = null;

	if (hue > -1 && color.coords[hue] !== null) {
		let before = color.coords[hue];
		let after = normalizeHue(before);

		color.coords[hue] = after;

		if (after !== before) {
			normalizedHue = { before, after };
		}
	}

	return {
		input: str,
		formatId: meta.formatId,
		commas: meta.commas,
		space,
		parsed: color,
		normalizedHue,
		// True when the notation the author used is not itself the color space the value
		// is considered to be in: hsl() and hwb() colors are srgb colors.
		legacy: SRGB_FORMATS.has(meta.formatId) && parsed.spaceId !== "srgb",
		srgbFormat: SRGB_FORMATS.has(meta.formatId),
		cssSpaceId: cssColorSpace(parsed.spaceId, meta.formatId),
	};
}

/* --------------------------------------------------------------- comparison -- */

function componentDiff (a, b, epsilon) {
	if (a === null || b === null) {
		// "A missing component is only equal to another missing component."
		return { a, b, equal: a === null && b === null, missing: true, diff: null };
	}

	let diff = Math.abs(a - b);

	return { a, b, equal: diff <= epsilon, missing: false, diff };
}

function compareComponents (space, colorA, colorB, epsilon) {
	let names = [...componentNames(space), "Alpha"];
	let valuesA = [...colorA.coords, colorA.alpha];
	let valuesB = [...colorB.coords, colorB.alpha];

	return names.map((name, i) => ({ name, ...componentDiff(valuesA[i], valuesB[i], epsilon) }));
}

function missingComponents (color) {
	let names = [...componentNames(spaceOf(color.spaceId)), "alpha"];
	let values = [...color.coords, color.alpha];

	return names.filter((name, i) => values[i] === null);
}

/**
 * Run the whole of CSS Color 4 § 12 on two CSS color strings, reporting every step.
 */
export function compareColors (inputA, inputB) {
	let colors = [parseColor(inputA), parseColor(inputB)];

	// Step 1: for each of C1 and C2, powerless components become missing components.
	for (let color of colors) {
		color.step1 = step1(color.parsed);
		color.afterStep1 = color.step1.color;
		color.missing = missingComponents(color.afterStep1);
	}

	let [a, b] = colors;
	let report = {
		inputs: [a.input, b.input],
		colors,
		sameSpace: a.cssSpaceId === b.cssSpaceId,
		notes: [],
	};

	if (report.sameSpace) {
		// Step 2: the same <color-space>, so compare the components one by one. A legacy
		// sRGB format is compared by its sRGB components, since srgb is the <color-space>
		// that format is considered to be in.
		let spaceId = a.legacy || b.legacy ? "srgb" : a.afterStep1.spaceId;
		let space = spaceOf(spaceId);
		let forms = colors.map(color => convert(color.afterStep1, spaceId));
		let rows = compareComponents(space, forms[0], forms[1], SAME_SPACE_EPSILON);
		let unequal = rows.filter(row => !row.equal);

		report.branch = "same-space";
		report.epsilon = SAME_SPACE_EPSILON;
		report.space = space;
		report.forms = forms;
		report.rows = rows;
		report.equivalent = unequal.length === 0;
		report.reason = report.equivalent
			? `Both colors are in the ${ a.cssSpaceId } color space, and every component, alpha included, compares as equal.`
			: `Both colors are in the ${ a.cssSpaceId } color space, but their ${ listNames(unequal.map(row => inProse(row.name))) } ${ unequal.length === 1 ? "component differs" : "components differ" }.`;

		addSameSpaceNotes(report, colors, rows);
	}
	else if (a.missing.length > 0 || b.missing.length > 0) {
		// Step 3: different <color-space>s and at least one missing component.
		report.branch = "missing";
		report.blockers = colors
			.filter(color => color.missing.length > 0)
			.map(color => ({ input: color.input, missing: color.missing }));
		report.equivalent = false;
		report.reason = "The two colors are in different color spaces, and "
			+ listNames(report.blockers.map(blocker => `${ blocker.input } has a missing ${ listNames(blocker.missing.map(inProse)) } component`))
			+ ", so the algorithm returns false without comparing any values.";
	}
	else {
		// Step 4: different <color-space>s and no missing components, so meet in Oklab.
		let space = spaceOf("oklab");
		let forms = colors.map(color => convert(color.afterStep1, "oklab"));
		let rows = compareComponents(space, forms[0], forms[1], OKLAB_EPSILON);
		let unequal = rows.filter(row => !row.equal);

		report.branch = "oklab";
		report.epsilon = OKLAB_EPSILON;
		report.space = space;
		report.forms = forms;
		report.rows = rows;
		report.equivalent = unequal.length === 0;
		report.reason = report.equivalent
			? "The two colors are in different color spaces and neither has a missing component, and they convert to the same Oklab value."
			: `The two colors are in different color spaces and neither has a missing component, but in Oklab their ${ listNames(unequal.map(row => inProse(row.name))) } ${ unequal.length === 1 ? "component differs" : "components differ" } by more than ε.`;
	}

	report.reference = reference(colors);
	addGeneralNotes(report, colors);

	// The same note can be reached once per color; say each thing only once
	report.notes = [...new Set(report.notes)];

	return report;
}

/** Context which is not part of the algorithm, but helps make sense of the answer. */
function reference (colors) {
	let oklab = colors.map(color => convert(color.afterStep1, "oklab"));
	let sameOklab = oklab[0].coords.every((v, i) => Math.abs(v - oklab[1].coords[i]) <= OKLAB_EPSILON)
		&& Math.abs(zeroed(oklab[0].alpha) - zeroed(oklab[1].alpha)) <= OKLAB_EPSILON;

	let deltaEOK = null;

	try {
		deltaEOK = toColor(colors[0].afterStep1).deltaEOK(toColor(colors[1].afterStep1));
	}
	catch (error) {
		// Some spaces have no meaningful ΔE; the answer does not depend on it
	}

	return { deltaEOK, sameOklab, oklab };
}

function fmtNumber (value) {
	return String(Number(value.toPrecision(6)));
}

/** Component names read better lowercased in prose, but X, Y, Z, a and b must not change */
function inProse (name) {
	return name.length > 1 ? name.toLowerCase() : name;
}

function listNames (names) {
	if (names.length <= 1) {
		return names[0] ?? "";
	}

	if (names.length === 2) {
		return `${ names[0] } and ${ names[1] }`;
	}

	return `${ names.slice(0, -1).join(", ") }, and ${ names.at(-1) }`;
}

function addSameSpaceNotes (report, colors, rows) {
	let [a, b] = colors;

	// The note in § 12 offers red vs. color(srgb 1 0 0) as an example of two colors in
	// *different* color spaces meeting at step 4. The paragraph right after it puts named
	// colors in the srgb color space, which takes this pair down step 2 instead. Both
	// routes return the same answer.
	let isSRGBFunction = color => color.formatId === "color" && color.parsed.spaceId === "srgb";

	if (a.srgbFormat && isSRGBFunction(b) || b.srgbFormat && isSRGBFunction(a)) {
		report.notes.push("The note in § 12 offers exactly this pair, <code>red</code> and <code>color(srgb 1 0 0)</code>, as an example of colors “expressed in different <code>&lt;color-space&gt;</code>s” that meet at step 4. The paragraph immediately after it puts named colors in the srgb color space, which is the reading taken here, so the comparison happens at step 2 instead. Both routes give the same answer.");
	}

	for (let color of colors) {
		if (color.legacy && color.step1.applies && !color.step1.hueWasMissing) {
			report.notes.push(`The hue step 1 made missing in <code>${ color.input }</code> is not among the components being compared: <code>${ color.formatId }()</code> is compared by its sRGB components, and the srgb color space has no hue.`);
		}
	}
}

function addGeneralNotes (report, colors) {
	for (let color of colors) {
		if (color.normalizedHue) {
			report.notes.push(`The hue of <code>${ color.input }</code> is normalized to the range [0,&nbsp;360) when it is parsed, so ${ fmtNumber(color.normalizedHue.before) }° becomes ${ fmtNumber(color.normalizedHue.after) }° before the comparison starts. That is the <a href="https://www.w3.org/TR/css-color-4/#typedef-hue"><code>&lt;hue&gt;</code> type</a> doing it, not the comparison algorithm.`);
		}
	}

	if (!report.equivalent && report.reference.sameOklab) {
		report.notes.push("These two colors are colorimetrically identical — they convert to the same Oklab value — and yet the algorithm does not call them equivalent colors.");
	}

	for (let color of colors) {
		if (color.legacy) {
			let names = componentNames(color.space).join(", ").toLowerCase();
			report.notes.push(`<code>${ color.formatId }()</code> is one of the legacy sRGB formats: § 15.1 resolves it to an sRGB color, so it is compared by its red, green and blue components rather than by ${ names }.`);
		}
	}
}
