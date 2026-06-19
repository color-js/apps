import { reactive } from "vue";
import methods from "./methods.js";

// Runs to full confidence: the times fade/sharpen in over this many (see CSS).
export const MIN_RUNS = 50;

// Accumulated run record, populated by mapColor(). Reactive for live display.
const stats = reactive({
	methods: {}, // { [method]: { runs, time } }, time in ms total
	totalColors: 0,
});

// Map a color through every method, timing each run into stats; returns the
// mapped colors by method. Writes reactive state, so call from an effect, not a computed.
export function mapColor (color) {
	let colors = {};
	for (let method in methods) {
		let start = performance.now();
		colors[method] = methods[method].compute(color);
		let tally = (stats.methods[method] ??= { runs: 0, time: 0 });
		tally.runs++;
		tally.time += performance.now() - start;
	}
	stats.totalColors++;
	return colors;
}

// Mean run time of a method (ms), or null if it hasn't run.
export function average (method) {
	let tally = stats.methods[method];
	return tally?.runs ? tally.time / tally.runs : null;
}

export default stats;
