import Color from "colorjs.io";

export function compute (color) {
	// Make in gamut range symmetrical around 0 [-0.5, 0.5] instead of [0, 1]
	let deltas = color.to("p3-linear").coords.map(c => c - .5);

	let maxDistance = Math.max(...deltas.map(c => Math.abs(c)));
	let scalingFactor = maxDistance / .5;

	let scaledCoords = deltas.map((delta, i) => {
		let scaled = delta / scalingFactor;
		return scaled + .5;
	});

	return new Color("p3-linear", scaledCoords).to("p3");
}

export default {
	label: "Scale",
	description: "Using a midpoint of 0.5, scale the color to fit within the linear P3 gamut.",
	compute,
	converge: [1, 2, 3, 4],
};
