import { to, HSL_P3, OKLCH } from "colorjs.io/fn";

// One atomic clip: clamp HSL-P3 saturation into [0, 100] and return. Iterating
// this and restoring the original L,H between steps is the converge harness's
// job (see methods.js), so the method itself stays a single operation.
export function compute (color) {
	let hsl = to(color, HSL_P3);
	hsl.coords[1] = Math.max(0, Math.min(hsl.coords[1], 100));
	return to(hsl, OKLCH);
}

export default {
	label: "HSL Clip",
	description: "Clip HSL saturation (in HSL-P3).",
	compute,
	converge: [1, 2],
};
