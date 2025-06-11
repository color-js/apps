// @ts-check
import Color from "https://colorjs.io/dist/color.js";
import methods from "../methods.js";

export function* xyzColorGenerator(settings) {
	let count = 0;
	for (var x = settings.x.min; x <= settings.x.max; x = x + settings.x.delta) {
		for (
			var y = settings.y.min;
			y <= settings.y.max;
			y = y + settings.y.delta
		) {
			for (
				var z = settings.z.min;
				z <= settings.z.max;
				z = z + settings.z.delta
			) {
				yield [`color(xyz ${x} ${y} ${z})`, count++];
			}
		}
	}
}

export const deltas = (original, mapped) => {
	let deltas = {};
	["L", "C", "H"].forEach((c, i) => {
		let delta = mapped.to("oklch").coords[i] - original.to("oklch").coords[i];

		if (c === "L") {
			// L is percentage
			delta *= 100;
		} else if (c === "H") {
			// Hue is angular, so we need to normalize it
			delta = ((delta % 360) + 720) % 360;
			delta = Math.min(360 - delta, delta);
			// Check: Is this hiding cases where only one value is NaN?
			if (isNaN(delta)) delta = 0;
		} else {
			// debugger;
		}

		// delta = Color.util.toPrecision(delta, 2);
		// Use absolute because we are interested in magnitude, not direction
		deltas[c] = Math.abs(delta);
	});
	deltas.delta2000 = original.deltaE(mapped, { method: "2000" });
	return deltas;
};

export const clipP3 = (color) =>
	color.clone().toGamut({ space: "p3", method: "clip" });
export const clipSrgb = (color) =>
	color.clone().toGamut({ space: "srgb", method: "clip" });

export const edgeSeekerColor = (color) => methods["edge-seeker-rec2020"].compute(color);

export const runningAverage = (average, newValue, count) => {
	if (count === 1) {
		return newValue;
	}
	return (average * (count - 1)) / count + newValue / count;
};

export const chromiumColor = (color) => methods.chromium.compute(color);

export const bjornColor = (color) => methods.bjornRec2020.compute(color);

export const raytraceColor = (color) => methods.raytraceRec2020.compute(color);
