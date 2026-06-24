import { toGamut, clone, P3 } from "colorjs.io/fn";

export function compute (color) {
	return toGamut(clone(color), { space: P3, method: "css" });
}

export default {
	label: "CSS",
	description: "CSS Color 4 gamut mapping method.",
	compute,
};
