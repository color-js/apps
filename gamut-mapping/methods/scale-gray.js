import Color from "colorjs.io";

function progress (n, min, max) {
	return (n - min) / (max - min);
}

function lerp (p, min, max) {
	return min + p * (max - min);
}

function clamp (min, n, max) {
	return Math.max(min, Math.min(n, max));
}

export function compute (color) {
	let p3 = color.to("p3-linear").coords;
	let lch = color.to("oklch").coords;
	// Gray with the same L has equal linear-P3 coords; use that value as the midpoint.
	let midpoint = new Color("oklch", [lch[0], 0, 0]).to("p3-linear").coords[0];

	// For each out-of-gamut channel, the fraction (0–1) we must lerp it toward the
	// midpoint to pull it back to the boundary. In-gamut channels need none.
	let maxP = Math.max(0, ...p3.map(c => {
		// Naturally returns 0 for in-gamut channels
		return progress(clamp(0, c, 1), c, midpoint);
	}));

	let scaledCoords = p3.map(c => lerp(maxP, c, midpoint));

	return new Color("p3-linear", scaledCoords).to("p3");
}

export default {
	label: "Scale Gray",
	description: "Like Scale, but midpoint is customized to the C=0 color with the same L,H.",
	compute,
	converge: [1, 2, 3],
};
