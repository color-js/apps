import { to, inGamut, OKLab, P3 } from "colorjs.io/fn";
// util (clamp) and the Okhsl gamut helpers are internal utilities with no
// dedicated package export, so they come from src/ directly.
import * as util from "colorjs.io/src/util.js";
import { findCusp, findGamutIntersection } from "colorjs.io/src/spaces/okhsl.js";

const lmsToP3Linear = [
	[ 3.1277689713618737, -2.2571357625916377,  0.1293667912297650],
	[-1.0910090184377972,  2.4133317103069207, -0.3223226918691244],
	[-0.0260108019385705, -0.5080413317041667,  1.5340521336427371],
];

const P3Coeff = [
	// Red
	[
		// Limit
		[-1.77234393, -0.82075874],
		// `Kn` coefficients
		[1.19414018, 1.7629812, 0.59585994, 0.75759997, 0.5681685],
	],
	// Green
	[
		// Limit
		[1.80319872, -1.1932814],
		// `Kn` coefficients
		[0.73956682, -0.4595428, 0.08285309, 0.12541165, -0.14503291],
	],
	// Blue
	[
		// Limit
		[0.08970488, 1.90327747],
		// `Kn` coefficients
		[1.36509441, -0.0139623, -1.14523051, -0.50259879, 0.00317471],
	],
];

export function compute (color) {
	// Approach described in https://bottosson.github.io/posts/gamutclipping/
	// For comparison against CSS approaches, constant lightness was used.
	let oklab = to(color, OKLab); // OKLab coords are [l, a, b]

	// Clamp lightness and see if we are in gamut.
	oklab.coords[0] = util.clamp(0.0, oklab.coords[0], 1.0);  // If doing adaptive lightness, this might not be wanted.
	if (inGamut(oklab, P3, { epsilon: 0 })) {
		return to(oklab, P3);
	}

	// Get coordinates and calculate chroma
	let [l, a, b] = oklab.coords;
	// Bjorn used 0.00001, are there issues with 0.0?
	const epsilon = 0.0
	let c = Math.max(epsilon, Math.sqrt(a ** 2 + b ** 2));

	// Normalize a and b
	if (c) {
		a /= c;
		b /= c;
	}

	// Find the lightness and chroma for the cusp.
	let cusp = findCusp(a, b, lmsToP3Linear, P3Coeff);

	// Set the target lightness towards which chroma reduction will take place.
	// `cusp[0]` is approximate lightness of cusp, l is current lightness.
	// One could apply some adaptive lightness if desired.
	const target = l; // cusp[0];
	const t = findGamutIntersection(a, b, l, c, target, lmsToP3Linear, P3Coeff, cusp);

	// Adjust lightness and chroma
	if (target !== l) {
		oklab.coords[0] = target * (1 - t) + t * l;
	}
	c *= t;
	oklab.coords[1] = c * a;
	oklab.coords[2] = c * b;

	// Convert back to P3; any residual out-of-gamut is clipped by the registry.
	return to(oklab, P3);
}

export default {
	label: "Björn Ottosson",
	description: "Approach using Oklab as defined by the creator of Oklab, Bjorn Ottosson. Projected toward constant lightness.",
	compute,
};
