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

export default function compute (color) {
	color = color.to("oklch");
	let ret = color;
	for (let i = 0; i < 5; i++) {
		let hsl = ret.to("hsl-p3");
		let s = hsl.coords[1];
		if (s > 100) {
			s = 100;
		}
		else if (s < 0) {
			s = 0;
		}
		else {
			console.log("Settled at iteration", i);
			return ret;
		}

		hsl.coords[1] = Math.max(0, Math.min(hsl.coords[1], 100));
		ret = hsl.to("oklch").set({
			l: color.l,
			h: color.h,
		});
	}
	return ret;
}
