export function compute (color) {
	return color.clone().toGamut({ space: "p3", method: "css" });
}

export default {
	label: "MINDE",
	description: "CSS Color 4 - Binary Search with Local MINDE",
	compute,
};
