export function compute (color) {
	// CSS-map into rec2020; the out-of-gamut result is clipped to P3 by the registry.
	return color
		.clone()
		.toGamut({ space: "rec2020", method: "css" });
}

export default {
	label: "MINDE Rec2020",
	description: "CSS Color 4 - Binary Search with Local MINDE to rec2020, then Naïve clipping to the P3 gamut.",
	compute,
};
