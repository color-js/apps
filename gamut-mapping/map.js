import methods from "./methods.js";
import stats, { time } from "./stats.js";

// Map a color through every method, timing each. Writes reactive state, so
// call from an effect, not a computed.
export function mapColor (color) {
	let colors = {};
	for (let id in methods) {
		colors[id] = time(id, () => methods[id].compute(color));
	}
	stats.totalColors++;
	return colors;
}
