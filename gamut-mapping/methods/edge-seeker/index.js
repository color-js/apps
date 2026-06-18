import Color from "colorjs.io";
import { makeEdgeSeeker } from "./makeEdgeSeeker.js";

// Make a function to get the maximum chroma for a given lightness and hue
// Lookup table is created once and reused
const p3EdgeSeeker = makeEdgeSeeker((r, g, b) => {
	const [l, c, h = 0] = new Color("p3", [r, g, b]).to("oklch").coords;
	return { l, c, h };
});

export function compute (color) {
	let [l, c, h] = color.to("oklch").coords;
	if (l <= 0) {
		return new Color("oklch", [0, 0, h]);
	}
	if (l >= 1) {
		return new Color("oklch", [1, 0, h]);
	}
	let maxChroma = p3EdgeSeeker(l, h || 0);
	if (c > maxChroma) {
		c = maxChroma;
	}
	// At this point it is safe to clip the values
	return new Color("oklch", [l, c, h]).toGamut({ space: "p3", method: "clip" });
}

export default {
	label: "Edge Seeker",
	description: "Using a LUT to detect edges of the gamut and reduce chroma accordingly.",
	compute,
};
