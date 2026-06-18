export function compute (color) {
	return color.clone().toGamut({ space: "p3", method: "css" });
}

export default {
	label: "CSS",
	description: "CSS Color 4 gamut mapping method.",
	compute,
};
