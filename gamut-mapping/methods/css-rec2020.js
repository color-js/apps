import { toGamut, clone, REC_2020 } from "colorjs.io/fn";

export function compute (color) {
	// CSS-map into rec2020; the out-of-gamut result is clipped to P3 by the registry.
	return toGamut(clone(color), { space: REC_2020, method: "css" });
}

export default {
	label: "CSS Rec2020",
	description: "CSS Color 4 gamut mapping to rec2020, then Naïve clipping to the P3 gamut.",
	compute,
};
