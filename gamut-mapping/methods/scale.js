import { to, P3, P3_Linear } from "colorjs.io/fn";

export function compute (color) {
	let plinear = to(color, P3_Linear);

	// Make in gamut range symmetrical around 0 [-0.5, 0.5] instead of [0, 1]
	let deltas = plinear.coords.map(c => c - .5);

	let maxDistance = Math.max(...deltas.map(c => Math.abs(c)));
	let scalingFactor = maxDistance / .5;

	// Scale every channel back into [0, 1]; reuse the same color for the P3 conversion.
	plinear.coords = deltas.map(delta => delta / scalingFactor + .5);

	return to(plinear, P3);
}

export default {
	label: "Scale",
	description: "Using a midpoint of 0.5, scale the color to fit within the linear P3 gamut.",
	compute,
	converge: [1, 2, 3],
};
