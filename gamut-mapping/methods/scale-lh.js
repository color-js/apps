import { compute as scale } from "./scale.js";

export function compute (color) {
	let mappedColor = scale(color);
	let lch = color.to("oklch").coords;
	mappedColor.set({
		"oklch.l": lch[0],
		"oklch.h": lch[2],
	});
	return scale(mappedColor);
}

export default {
	label: "Scale LH",
	description: "Runs Scale, sets L, H to those of the original color, then runs Scale again.",
	compute,
};
