export function compute (color) {
	return color.clone().toGamut({ space: "p3", method: "clip" });
}

export default {
	label: "Clip",
	description: "Naïve clipping to the P3 gamut.",
	compute,
};
