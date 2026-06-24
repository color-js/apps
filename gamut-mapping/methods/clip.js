import { toGamut, clone, P3 } from "colorjs.io/fn";

export function compute (color) {
	// Clone so we never mutate the shared input; toGamut maps it in place.
	return toGamut(clone(color), { space: P3, method: "clip" });
}

export default {
	label: "Clip",
	description: "Naïve clipping to the P3 gamut.",
	compute,
};
