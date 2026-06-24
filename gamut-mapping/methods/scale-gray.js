import { to, P3, P3_Linear, OKLCH } from "colorjs.io/fn";

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
	let plinear = to(color, P3_Linear);
	let p3 = plinear.coords;
	let lch = to(color, OKLCH).coords;
	// Gray with the same L has equal linear-P3 coords; use that value as the midpoint.
	let midpoint = to({ space: OKLCH, coords: [lch[0], 0, 0] }, P3_Linear).coords[0];

	// For each out-of-gamut channel, the fraction (0–1) we must lerp it toward the
	// midpoint to pull it back to the boundary. In-gamut channels naturally yield 0
	// (their numerator is 0); a channel exactly at the midpoint needs no pull either,
	// and guarding it avoids progress()'s 1/(midpoint − c) blowing up to ∞/NaN —
	// which happens at degenerate L≈0/1, where the converge re-runs feed near-gray
	// colors (all channels on the midpoint) back in.
	let maxP = Math.max(0, ...p3.map(c => c === midpoint ? 0 : progress(clamp(0, c, 1), c, midpoint)));

	// Reuse the same linear-P3 color for the result.
	plinear.coords = p3.map(c => lerp(maxP, c, midpoint));

	return to(plinear, P3);
}

export default {
	label: "Scale Gray",
	description: "Like Scale, but midpoint is customized to the C=0 color with the same L,H.",
	compute,
	converge: [1, 2, 3],
};
