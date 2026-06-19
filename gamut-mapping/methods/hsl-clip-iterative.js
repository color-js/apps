import Color from "colorjs.io";

// Use the ColorSpace class and built-in spaces from the same colorjs.io instance
// that Color uses, so hsl-p3 is registered in the registry that color.to() queries.
const ColorSpace = Color.Space;
const HSL = ColorSpace.get("hsl");
const P3 = ColorSpace.get("p3");

export const HSL_P3 = new ColorSpace({
	id: "hsl-p3",
	name: "HSL P3",
	coords: {
		h: {
			refRange: [0, 360],
			type: "angle",
			name: "Hue",
		},
		s: {
			range: [0, 100],
			name: "Saturation",
		},
		l: {
			range: [0, 100],
			name: "Lightness",
		},
	},

	base: P3,
	rgbGamut: P3,
	fromBase: HSL.fromBase,
	toBase: HSL.toBase,
});

ColorSpace.register("hsl-p3", HSL_P3);

// One atomic clip: clamp HSL-P3 saturation into [0, 100] and return. Iterating
// this and restoring the original L,H between steps is the converge harness's
// job (see methods.js), so the method itself stays a single operation.
export function compute (color) {
	let hsl = color.to("hsl-p3");
	hsl.coords[1] = Math.max(0, Math.min(hsl.coords[1], 100));
	return hsl.to("oklch");
}

export default {
	label: "HSL Clip",
	description: "Clip HSL saturation (in HSL-P3).",
	compute,
	converge: [2, 5],
};
