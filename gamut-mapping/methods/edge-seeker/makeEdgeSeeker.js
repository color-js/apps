import { getLutItem } from "./utils.js";
import { makeLut } from "./lut/makeLut.js";

// Number of slices in the LUT
const SLICES = 400;

/**
 * Creates a function that returns the maximum chroma for a given lightness and hue
 * for an RGB space with non-imaginary primaries (not, for example, ProPhoto RGB)
 * @param rgbToOklch converter from RGB to OKLCH
 * @returns function that returns the maximum chroma for a given lightness and hue
 */
export function makeEdgeSeeker (rgbToOklch) {
	const lut = makeLut(rgbToOklch, SLICES);
	return function getMaxChroma (l, h = 0) {
		if (l <= 0 || l >= 1) {
			return 0;
		}
		h = h < 0 ? (h % 360) + 360 : h % 360;
		const lutItem = getLutItem(h, lut);

		// The bottom (dark) part is always a straight line
		if (l <= lutItem.l) {
			return (l / lutItem.l) * lutItem.c;
		}

		// The top (bright) part is approximated by an arc
		const x = (1 - l) / (1 - lutItem.l); // Normalize l to 0-1 in arc space
		return lutItem.c * normalizedChromaOnArc(x, lutItem.curvature);
	};
}

/**
 * Finds the normalized chroma on the upper gamut boundary arc,
 * the arc through (0,0) and (1,1) with the given signed curvature (|curvature| < 1).
 * Rather than locating the center of the circle, which is very far away
 * when the curvature is close to 0, the circle's equation is multiplied through
 * by the curvature and solved directly:
 * curvature × y² + b × y − d = 0
 * This avoids subtracting large, nearly equal values,
 * and needs no test to choose between the two roots.
 */
function normalizedChromaOnArc (x, curvature) {
	const t = Math.sqrt(2 - curvature ** 2);
	const b = t - curvature;
	const d = x * (t + curvature * (1 - x));
	// Never negative in exact arithmetic for 0 <= x <= 1,
	// because the circle passes through (0,0) and (1,1)
	const disc = Math.max(0, b ** 2 + 4 * curvature * d);
	// The upper root for a positive curvature and the lower root for a negative one;
	// with a curvature of 0 this equals x, a straight line
	return 2 * d / (b + Math.sqrt(disc));
}
