export function compute (color) {
	return color
		.clone()
		.toGamut({ space: "rec2020", method: "css" })
		.toGamut({ space: "p3", method: "clip" });
}

export default {
	label: "CSS Rec2020",
	description: "CSS Color 4 gamut mapping to rec2020, then Naïve clipping to the P3 gamut.",
	compute,
};
