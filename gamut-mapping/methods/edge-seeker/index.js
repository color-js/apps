import { to, P3, OKLCH } from "colorjs.io/fn";
import { makeEdgeSeeker } from "./makeEdgeSeeker.js";

// Make a function to get the maximum chroma for a given lightness and hue
// Lookup table is created once and reused
const p3EdgeSeeker = makeEdgeSeeker((r, g, b) => {
	const [l, c, h = 0] = to({ space: P3, coords: [r, g, b] }, OKLCH).coords;
	return { l, c, h };
});

export function compute (color) {
	// `to` gives us a fresh OKLCh color object we can reduce in place.
	let result = to(color, OKLCH);
	let [l, c] = result.coords;
	if (l <= 0) {
		result.coords[0] = result.coords[1] = 0; // black, hue preserved
		return result;
	}
	if (l >= 1) {
		result.coords[0] = 1;
		result.coords[1] = 0; // white, hue preserved
		return result;
	}
	let maxChroma = p3EdgeSeeker(l, result.coords[2] || 0);
	if (c > maxChroma) {
		// Any residual out-of-gamut from the LUT approximation is clipped by the registry.
		result.coords[1] = maxChroma;
	}
	return result;
}

export default {
	label: "Edge Seeker",
	description: "Using a LUT to detect edges of the gamut and reduce chroma accordingly.",
	compute,
};
