import { reactive } from "vue";

// Runs to full confidence: the times fade/sharpen in over this many (see CSS).
export const MIN_RUNS = 50;

const stats = reactive({
	methods: {}, // { [id]: { runs, time } }, time in ms total
	totalColors: 0,
});

// Run fn() and add its time and one run to method `id`'s totals. Converge
// variants time each base-method run this way too, so a base method's run
// count can be higher than the number of colors mapped.
export function time (id, fn) {
	let start = performance.now();
	let result = fn();
	let m = (stats.methods[id] ??= { runs: 0, time: 0 });
	m.time += performance.now() - start;
	m.runs++;
	return result;
}

// Mean run time of a method (ms), or null if it hasn't run.
export function average (id) {
	let m = stats.methods[id];
	return m?.runs ? m.time / m.runs : null;
}

export default stats;
