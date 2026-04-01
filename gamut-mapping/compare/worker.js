// @ts-check
import Color from "https://colorjs.io/dist/color.js";

import {
	xyzColorGenerator,
	deltas,
	edgeSeekerColor,
	clipP3,
	clipSrgb,
	runningAverage,
	chromiumColor,
	bjornColor,
	raytraceColor,
} from "./utils.js";

const settings = (delta)=> ({
	x: { min: 0, max: 1, delta },
	y: { min: 0, max: 1, delta },
	z: { min: 0, max: 1, delta },
});
const results = {
	edgeToP3: { L: 0, C: 0, H: 0, delta2000: 0 },
	edgeToSrgb: { L: 0, C: 0, H: 0, delta2000: 0 },
	chromiumToP3: { L: 0, C: 0, H: 0, delta2000: 0 },
	chromiumToSrgb: { L: 0, C: 0, H: 0, delta2000: 0 },
	bjornToP3: { L: 0, C: 0, H: 0, delta2000: 0 },
	bjornToSrgb: { L: 0, C: 0, H: 0, delta2000: 0 },
	clipToP3: { L: 0, C: 0, H: 0, delta2000: 0 },
	raytraceToP3: { L: 0, C: 0, H: 0, delta2000: 0 },
	raytraceToSrgb: { L: 0, C: 0, H: 0, delta2000: 0 },
	delta: null
};

const rawResults = [];

// methods:
// - edge to rec2020, clip to p3
// - edge to rec2020, clip to srgb
// - clip to p3
// - clip to srgb

const run = ({delta}) => {
	const colors = xyzColorGenerator(settings(delta));
	results.delta = delta;
	let color = colors.next();
	let count = 0;

	while (!color.done) {
		const [colorString, index] = color.value;
		count = index;
		let _color = new Color(colorString);
		if (_color.inGamut("rec2020", { epsilon: 0 })) {
			color = colors.next();
			continue; // Skip colors in rec2020 gamut
		}

		const colorData = processColor(_color);
		// rawResults.push({ colorString, colorData });
		aggregate(colorData, index);

		color = colors.next();
		if (index % 100 === 0) {
			postMessage(JSON.stringify({ results, count: index }));
		}
	}
	postMessage(JSON.stringify({ results, count }));
};

const processColor = (color) => {
	const edgeSeeker = edgeSeekerColor(color);
	const edgeClippedToP3 = clipP3(edgeSeeker);
	const edgeClippedToSrgb = clipSrgb(edgeSeeker);
	const edgeP3Delta = deltas(color, edgeClippedToP3);
	const edgeSrgbDelta = deltas(color, edgeClippedToSrgb);

	const clippedStraightToP3 = clipP3(color);
	const clippedStraightToP3Delta = deltas(color, clippedStraightToP3);

	const chromiumClippedToP3 = chromiumColor(color);
	const chromiumClippedToSrgb = clipSrgb(chromiumClippedToP3);
	const chromiumP3Delta = deltas(color, chromiumClippedToP3);
	const chromiumSrgbDelta = deltas(color, chromiumClippedToSrgb);

	const bjorn = bjornColor(color);
	const bjornClippedToP3 = clipP3(bjorn);
	const bjornClippedToSrgb = clipSrgb(bjorn);
	const bjornP3Delta = deltas(color, bjornClippedToP3);
	const bjornSrgbDelta = deltas(color, bjornClippedToSrgb);

	const raytrace = raytraceColor(color);
	const raytraceClippedToP3 = clipP3(raytrace);
	const raytraceClippedToSrgb = clipSrgb(raytrace);
	const raytraceP3Delta = deltas(color, raytraceClippedToP3);
	const raytraceSrgbDelta = deltas(color, raytraceClippedToSrgb);

	return {
		color,
		edgeSeeker,
		edgeClippedToP3,
		edgeClippedToSrgb,
		clippedStraightToP3,
		edgeP3Delta,
		edgeSrgbDelta,
		clippedStraightToP3Delta,
		chromiumClippedToP3,
		chromiumClippedToSrgb,
		chromiumP3Delta,
		chromiumSrgbDelta,
		bjornClippedToP3,
		bjornClippedToSrgb,
		bjornP3Delta,
		bjornSrgbDelta,
		raytraceP3Delta,
		raytraceSrgbDelta,
	};
};

const aggregate = (colorData, index) => {
	const {
		edgeP3Delta,
		clippedStraightToP3Delta,
		edgeSrgbDelta,
		chromiumP3Delta,
		chromiumSrgbDelta,
		bjornP3Delta,
		bjornSrgbDelta,
		raytraceP3Delta,
		raytraceSrgbDelta,
	} = colorData;

	const map = [
		["edgeToP3", edgeP3Delta],
		["edgeToSrgb", edgeSrgbDelta],
		["chromiumToP3", chromiumP3Delta],
		["chromiumToSrgb", chromiumSrgbDelta],
		["bjornToP3", bjornP3Delta],
		["bjornToSrgb", bjornSrgbDelta],
		["raytraceToP3", raytraceP3Delta],
		["raytraceToSrgb", raytraceSrgbDelta],
		["clipToP3", clippedStraightToP3Delta],
	];

	map.forEach(([key, delta]) => {
		const res = results[key];
		["L", "C", "H", "delta2000"].forEach((d) => {
			res[d] = runningAverage(res[d], delta[d], index);
		});
	});

	return results;
};

onmessage = (event) => {
	console.log("Message received from main script - compare", event, event.data);
	if (event.data[0] === "run") {
		run(event.data[1]);
	}
};
