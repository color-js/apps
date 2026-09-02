/**
 * A traced implementation of CSS Color 5 color-mix(),
 * following § 3.3 Calculating the Result of color-mix
 * <https://www.w3.org/TR/css-color-5/#color-mix-result>
 * step by step so that every intermediate value can be displayed.
 *
 * Color.js is used for parsing colors and for color space conversion,
 * but the mixing itself is spelled out here rather than delegated to
 * Color.js' own interpolation, so that each stage can be inspected.
 */
import Color from "colorjs.io";

/** CSS <color-space> keywords, mapped to Color.js space ids */
export const SPACES = {
	"srgb": "srgb",
	"srgb-linear": "srgb-linear",
	"display-p3": "p3",
	"display-p3-linear": "p3-linear",
	"a98-rgb": "a98rgb",
	"prophoto-rgb": "prophoto",
	"rec2020": "rec2020",
	"lab": "lab",
	"oklab": "oklab",
	"xyz": "xyz-d65",
	"xyz-d50": "xyz-d50",
	"xyz-d65": "xyz-d65",
	"hsl": "hsl",
	"hwb": "hwb",
	"lch": "lch",
	"oklch": "oklch",
};

/** <polar-color-space>; everything else in SPACES is a <rectangular-color-space> */
export const POLAR_SPACES = ["hsl", "hwb", "lch", "oklch"];

/** <hue-interpolation-method> */
export const HUE_METHODS = ["shorter", "longer", "increasing", "decreasing"];

/**
 * If no <color-interpolation-method> is given, assume Oklab.
 * CSS Color 5 § 3.1 Colorspace for mixing
 * <https://www.w3.org/TR/css-color-5/#color-mix-space>
 */
export const DEFAULT_SPACE = "oklab";

/**
 * Analogous components.
 * CSS Color 4 § 13.3 Interpolating with Missing Components
 * <https://www.w3.org/TR/css-color-4/#interpolation-missing>
 *
 * Keyed by the component names Color.js uses, which are distinct across spaces
 * (HWB's "Blackness" is deliberately not the same as sRGB's "Blue").
 * Whiteness and Blackness have no analogs, so they are absent here.
 */
const ANALOGOUS = {
	"Red": "Reds",
	"X": "Reds",
	"Green": "Greens",
	"Y": "Greens",
	"Blue": "Blues",
	"Z": "Blues",
	"Lightness": "Lightness",
	"Chroma": "Colorfulness",
	"Saturation": "Colorfulness",
	"Hue": "Hue",
	"a": "Opponent a",
	"b": "Opponent b",
};

const PERCENTAGE = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?%$/i;

/* ---------------------------------------------------------------- parsing -- */

/** Split on a separator, ignoring separators nested inside parentheses */
function splitTopLevel (str, separator = ",") {
	let parts = [];
	let depth = 0;
	let current = "";

	for (let char of str) {
		if (char === "(") {
			depth++;
		}
		else if (char === ")") {
			depth--;
		}

		if (char === separator && depth === 0) {
			parts.push(current);
			current = "";
		}
		else {
			current += char;
		}
	}

	parts.push(current);
	return parts;
}

/** Split on whitespace, keeping parenthesised functions in one piece */
function tokenize (str) {
	let tokens = [];
	let depth = 0;
	let current = "";

	for (let char of str) {
		if (char === "(") {
			depth++;
		}
		else if (char === ")") {
			depth--;
		}

		if (depth === 0 && /\s/.test(char)) {
			if (current) {
				tokens.push(current);
				current = "";
			}
		}
		else {
			current += char;
		}
	}

	if (current) {
		tokens.push(current);
	}

	return tokens;
}

function balanced (str) {
	let depth = 0;

	for (let char of str) {
		if (char === "(") {
			depth++;
		}
		else if (char === ")") {
			depth--;
		}

		if (depth < 0) {
			return false;
		}
	}

	return depth === 0;
}

/** Parse `in <color-space> <hue-interpolation-method>?` */
function parseInterpolationMethod (str) {
	let tokens = tokenize(str);
	tokens.shift(); // the "in" keyword, already matched by the caller

	let space = (tokens.shift() ?? "").toLowerCase();

	if (!space) {
		throw new SyntaxError("“in” must be followed by a color space.");
	}

	if (!(space in SPACES)) {
		throw new SyntaxError(`“${ space }” is not a <color-space> that CSS allows for interpolation. Pick one of: ${ Object.keys(SPACES).join(", ") }.`);
	}

	let hueMethod = null;

	if (tokens.length > 0) {
		if (tokens.length !== 2 || tokens[1].toLowerCase() !== "hue") {
			throw new SyntaxError(`Expected a <hue-interpolation-method> such as “longer hue”, got “${ tokens.join(" ") }”.`);
		}

		hueMethod = tokens[0].toLowerCase();

		if (!HUE_METHODS.includes(hueMethod)) {
			throw new SyntaxError(`“${ hueMethod } hue” is not a <hue-interpolation-method>. Use one of: ${ HUE_METHODS.join(", ") }.`);
		}

		if (!POLAR_SPACES.includes(space)) {
			throw new SyntaxError(`A <hue-interpolation-method> is only allowed with a <polar-color-space>, and ${ space } is rectangular.`);
		}
	}

	return { space, hueMethod };
}

/** Parse one `<color> && <percentage>?` argument */
function parseMixItem (str, index) {
	let tokens = tokenize(str);

	if (tokens.length === 0) {
		throw new SyntaxError("Empty argument: every argument must contain a <color>.");
	}

	let percentageTokens = tokens.filter(token => PERCENTAGE.test(token));

	if (percentageTokens.length > 1) {
		throw new SyntaxError(`Argument ${ index + 1 } has more than one <percentage>: “${ str.trim() }”.`);
	}

	let percentage = null;

	if (percentageTokens.length === 1) {
		let token = percentageTokens[0];
		let position = tokens.indexOf(token);

		if (position !== 0 && position !== tokens.length - 1) {
			throw new SyntaxError(`The <percentage> in argument ${ index + 1 } must come before or after the <color>, not inside it.`);
		}

		percentage = Number(token.slice(0, -1));

		if (percentage < 0) {
			throw new SyntaxError(`Negative percentages are not allowed in color-mix(): “${ token }”.`);
		}

		if (percentage > 100) {
			throw new SyntaxError(`Percentages in color-mix() are restricted to the range [0, 100]: “${ token }”.`);
		}

		tokens.splice(position, 1);
	}

	let colorString = tokens.join(" ");

	if (!colorString) {
		throw new SyntaxError(`Argument ${ index + 1 } is only a <percentage>; it also needs a <color>.`);
	}

	let color;
	let nested = null;

	if (/^color-mix\s*\(/i.test(colorString)) {
		// color-mix() is itself a <color>, so it can be nested
		nested = computeColorMix(colorString);
		color = nested.color;
	}
	else {
		try {
			color = normalizeColor(new Color(colorString));
		}
		catch (error) {
			throw new SyntaxError(`Cannot parse “${ colorString }” as a <color>.`);
		}
	}

	return { colorString, color, percentage, nested };
}

/**
 * Parse a color-mix() function.
 * color-mix() = color-mix( <color-interpolation-method>? , [ <color> && <percentage [0,100]>? ]# )
 */
export function parseColorMix (input) {
	// Tolerate a trailing semicolon, which comes along easily when pasting from a stylesheet
	let str = String(input).trim().replace(/;+$/, "").trim();
	let match = str.match(/^color-mix\s*\(([\s\S]*)\)$/i);

	if (!match || !balanced(match[1])) {
		throw new SyntaxError("Expected a color-mix() function, for example color-mix(in oklch, peru 40%, palegoldenrod).");
	}

	let args = splitTopLevel(match[1]).map(arg => arg.trim());
	let methodGiven = /^in(\s|$)/i.test(args[0]);
	let { space, hueMethod } = methodGiven
		? parseInterpolationMethod(args.shift())
		: { space: DEFAULT_SPACE, hueMethod: null };

	if (args.length === 0 || (args.length === 1 && args[0] === "")) {
		throw new SyntaxError("color-mix() needs at least one <color> to mix.");
	}

	let items = args.map((arg, i) => parseMixItem(arg, i));

	return {
		space,
		spaceId: SPACES[space],
		hueMethod,
		methodGiven,
		hueArc: hueMethod ?? "shorter",
		isPolar: POLAR_SPACES.includes(space),
		items,
	};
}

/* -------------------------------------------------- percentage normalization -- */

/**
 * Normalize mix percentages.
 * CSS Values 5 § 6.1 Normalizing Mix Percentages
 * <https://drafts.csswg.org/css-values-5/#mix-percentage-normalization>
 * Linked to the Editor's Draft because the TR version is stale and does not
 * have this section yet; switch to /TR once it is republished.
 * <https://github.com/w3c/csswg-drafts/issues/14435>
 *
 * color-mix() invokes this with the force normalization flag set.
 * `percentages` holds one number, or null for an omitted percentage, per mix item.
 */
export function normalizeMixPercentages (percentages, force = false) {
	let specified = percentages.filter(p => p !== null);
	let specifiedSum = Math.min(specified.reduce((sum, p) => sum + p, 0), 100);
	let omittedCount = percentages.length - specified.length;
	let share = omittedCount > 0 ? (100 - specifiedSum) / omittedCount : null;
	let filled = percentages.map(p => (p === null ? share : p));
	let total = filled.reduce((sum, p) => sum + p, 0);
	let scaled = total > 100 || (total > 0 && force);
	let factor = scaled ? 100 / total : 1;
	let normalized = filled.map(p => p * factor);
	let leftover = total < 100 ? 100 - total : 0;

	return { specifiedSum, omittedCount, share, filled, total, scaled, factor, normalized, leftover };
}

/* ------------------------------------------------------ missing components -- */

/** Color.js uses null for missing components, but conversions can also yield NaN */
function normalizeColor (color) {
	return {
		space: color.space,
		spaceId: color.spaceId,
		coords: [...color.coords].map(v => (v === null || Number.isNaN(v) ? null : v)),
		alpha: color.alpha === null || Number.isNaN(color.alpha) ? null : color.alpha,
	};
}

/** The analogous category of each component of a space, or null if it has none */
function analogousCategories (space) {
	return Object.values(space.coords).map(coord => ANALOGOUS[coord.name] ?? null);
}

export function componentNames (space) {
	return Object.values(space.coords).map(coord => coord.name);
}

/**
 * Convert a color to the interpolation space, carrying missing components forward.
 * CSS Color 4 § 13.3 Interpolating with Missing Components
 * <https://www.w3.org/TR/css-color-4/#interpolation-missing>
 */
export function convertForInterpolation (color, space) {
	let converted = normalizeColor(new Color(color.spaceId, color.coords, color.alpha).to(space.id));

	// Color.js applies the "powerless component" rule while converting, so an achromatic
	// color arrives here with its hue already missing.
	// CSS Color 4 § 4.4.1 "Powerless" Color Components
	// <https://www.w3.org/TR/css-color-4/#powerless>
	let powerless = converted.coords
		.map((v, i) => (v === null && color.spaceId !== space.id ? i : -1))
		.filter(i => i >= 0);

	let coords = [...converted.coords];
	let carried = [];

	if (color.spaceId === space.id) {
		// Nothing was converted, so every component is trivially analogous to itself
		color.coords.forEach((v, i) => {
			if (v === null) {
				coords[i] = null;
				carried.push(i);
			}
		});
	}
	else {
		let from = analogousCategories(color.space);
		let to = analogousCategories(space);
		let shared = from.filter(category => category !== null && to.includes(category));

		// Individually analogous components
		from.forEach((category, i) => {
			if (shared.includes(category) && color.coords[i] === null) {
				let j = to.indexOf(category);
				coords[j] = null;
				carried.push(j);
			}
		});

		// Whatever remains once the individually analogous components are removed
		// forms an analogous set of its own
		let fromRest = from.map((category, i) => i).filter(i => !shared.includes(from[i]));
		let toRest = to.map((category, i) => i).filter(i => !shared.includes(to[i]));

		if (fromRest.length > 0 && toRest.length > 0 && fromRest.every(i => color.coords[i] === null)) {
			toRest.forEach(j => {
				if (coords[j] !== null) {
					carried.push(j);
				}

				coords[j] = null;
			});
		}
	}

	// Alpha is analogous to alpha
	let alpha = color.alpha === null ? null : converted.alpha;

	return {
		converted,
		result: { space, spaceId: space.id, coords, alpha },
		carried,
		powerless: powerless.filter(i => !carried.includes(i)),
	};
}

/* -------------------------------------------------------------- interpolation -- */

/**
 * Hue fix-up.
 * CSS Color 4 § 13.5 Hue Interpolation
 * <https://www.w3.org/TR/css-color-4/#hue-interpolation>
 */
export function adjustHues (arc, hue1, hue2) {
	if (hue1 === null || hue2 === null) {
		return [hue1, hue2];
	}

	// Constrain to [0deg, 360deg) without a modulo round trip,
	// which would perturb the last bits of an angle that is already in range
	let constrain = angle => (angle >= 0 && angle < 360 ? angle : ((angle % 360) + 360) % 360);
	let θ1 = constrain(hue1);
	let θ2 = constrain(hue2);
	let difference = θ2 - θ1;

	if (arc === "shorter") {
		if (difference > 180) {
			θ1 += 360;
		}
		else if (difference < -180) {
			θ2 += 360;
		}
	}
	else if (arc === "longer") {
		if (-180 < difference && difference < 180) {
			if (difference > 0) {
				θ1 += 360;
			}
			else {
				θ2 += 360;
			}
		}
	}
	else if (arc === "increasing") {
		if (difference < 0) {
			θ2 += 360;
		}
	}
	else if (arc === "decreasing") {
		if (difference > 0) {
			θ1 += 360;
		}
	}

	return [θ1, θ2];
}

/*
 * The quoted rules in premultiply() and unpremultiply() below are from
 * CSS Color 4 § 13.4 Interpolating with Alpha
 * <https://www.w3.org/TR/css-color-4/#interpolation-alpha>
 */

function premultiply (color, hueIndex) {
	// "If the alpha value is none, the premultiplied value is the un-premultiplied value"
	if (color.alpha === null) {
		return { ...color, coords: [...color.coords] };
	}

	return {
		...color,
		coords: color.coords.map((v, i) => (v === null || i === hueIndex ? v : v * color.alpha)),
	};
}

function unpremultiply (color, hueIndex) {
	// "If the interpolated alpha value is zero or none,
	//  the un-premultiplied value is the premultiplied value"
	if (color.alpha === null || color.alpha === 0) {
		return { ...color, coords: [...color.coords] };
	}

	return {
		...color,
		coords: color.coords.map((v, i) => (v === null || i === hueIndex ? v : v / color.alpha)),
	};
}

function lerp (start, end, p) {
	if (start === null) {
		return end;
	}

	if (end === null) {
		return start;
	}

	return start + (end - start) * p;
}

/**
 * Interpolate two colors that are already in the interpolation space,
 * recording the value of every component at each stage.
 */
export function interpolatePair (colorA, colorB, p, space, hueArc) {
	let hueIndex = space.hueIndex;
	let a = { space, spaceId: space.id, coords: [...colorA.coords], alpha: colorA.alpha };
	let b = { space, spaceId: space.id, coords: [...colorB.coords], alpha: colorB.alpha };

	// A missing component takes the other color's value. This has to happen before
	// premultiplication, so that a carried-forward missing alpha premultiplies with
	// the value it inherits rather than with the zero it would otherwise become.
	for (let i = 0; i < a.coords.length; i++) {
		if (a.coords[i] === null && b.coords[i] !== null) {
			a.coords[i] = b.coords[i];
		}
		else if (b.coords[i] === null && a.coords[i] !== null) {
			b.coords[i] = a.coords[i];
		}
	}

	if (a.alpha === null && b.alpha !== null) {
		a.alpha = b.alpha;
	}
	else if (b.alpha === null && a.alpha !== null) {
		b.alpha = a.alpha;
	}

	let filled = [{ ...a, coords: [...a.coords] }, { ...b, coords: [...b.coords] }];
	let hues = null;

	if (hueIndex >= 0) {
		let before = [a.coords[hueIndex], b.coords[hueIndex]];
		let after = adjustHues(hueArc, before[0], before[1]);
		a.coords[hueIndex] = after[0];
		b.coords[hueIndex] = after[1];
		hues = { arc: hueArc, before, after };
	}

	let adjusted = [{ ...a, coords: [...a.coords] }, { ...b, coords: [...b.coords] }];
	let premultiplied = [premultiply(a, hueIndex), premultiply(b, hueIndex)];
	let mixed = {
		space,
		spaceId: space.id,
		coords: premultiplied[0].coords.map((start, i) => lerp(start, premultiplied[1].coords[i], p)),
		alpha: lerp(a.alpha, b.alpha, p),
	};
	let result = unpremultiply(mixed, hueIndex);

	return { hueIndex, filled, hues, adjusted, premultiplied, mixed, result };
}

/* ------------------------------------------------------------------ the mix -- */

/**
 * Compute a color-mix(), returning both the resulting color
 * and a trace of every stage of the algorithm.
 */
export function computeColorMix (input) {
	let parsed = parseColorMix(input);
	let space = Color.spaces[parsed.spaceId];

	// 1. Normalize mix percentages, with the forced normalization flag set to true
	let normalization = normalizeMixPercentages(parsed.items.map(item => item.percentage), true);

	// 2. Let alpha mult be 1 - leftover
	let alphaMult = 1 - normalization.leftover / 100;

	// 3. Convert every color to the specified interpolation color space
	let conversions = parsed.items.map(item => convertForInterpolation(item.color, space));

	let items = parsed.items.map((item, i) => ({
		...item,
		normalized: normalization.normalized[i],
		conversion: conversions[i],
		interpolated: conversions[i].result,
	}));

	// 4. Mix the items pairwise off a stack, in the order they were written
	let stack = items
		.map((item, i) => ({ label: `color ${ i + 1 }`, color: item.interpolated, percentage: item.normalized }))
		.reverse();
	let iterations = [];

	while (stack.length >= 2) {
		let a = stack.pop();
		let b = stack.pop();
		let combined = a.percentage + b.percentage;
		let p = combined > 0 ? b.percentage / combined : 0.5;
		let trace = interpolatePair(a.color, b.color, p, space, parsed.hueArc);
		let pushed = {
			label: `mix of ${ a.label } and ${ b.label }`,
			color: trace.result,
			percentage: combined,
		};

		iterations.push({ a, b, combined, p, trace, pushed });
		stack.push(pushed);
	}

	let mixedColor = stack[0].color;

	// 5. Multiply the alpha component of color by alpha mult
	let color = {
		space,
		spaceId: space.id,
		coords: [...mixedColor.coords],
		// A missing alpha stays missing: there is no value there to scale
		alpha: mixedColor.alpha === null ? null : mixedColor.alpha * alphaMult,
	};

	// 6. Return color
	return { input, parsed, space, normalization, alphaMult, items, iterations, color };
}

/** Turn one of the plain color records used above back into a Color.js object */
export function toColor (color) {
	return new Color(color.spaceId ?? color.space.id, color.coords, color.alpha);
}
