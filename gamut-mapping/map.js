import { to, deltaE, OKLCH } from "colorjs.io/fn";
import methods from "./methods.js";
import stats, { time } from "./stats.js";

// Map a color through every method in `methodSet` (the full registry by
// default), timing each. Writes reactive state, so call from an effect, not a
// computed. The benchmark passes a reduced set (one variant per base GMA).
export function mapColor (color, methodSet = methods) {
	let colors = {};
	for (let id in methodSet) {
		colors[id] = time(id, () => methodSet[id].compute(color));
	}
	stats.totalColors++;
	return colors;
}

// Default per-axis weights for the Error metric: hue > lightness > chroma.
// Consumers spread this into their own reactive copy so live edits don't mutate
// the shared constant.
export const defaultWeights = {H: 8, L: 4, C: 1};

/**
 * Raw (unrounded) deltas between an input color and one of its gamut-mapped
 * results. Takes the input's OKLCh coords so callers mapping one color through
 * many methods convert it once rather than per method.
 * @param {import("colorjs.io/fn").ColorTypes} color - the input color
 * @param {import("colorjs.io/fn").ColorTypes} mapped - the gamut-mapped color
 * @param {[number, number, number]} oklch - the input color's OKLCh coords [L, C, h]
 * @param {{L: number, C: number, H: number}} weights - per-axis Error weights
 * @returns {{error: number, E2K: number, EOK: number, L: number, C: number, H: number}}
 */
export function getDeltas (color, mapped, [L1, C1, h1], weights) {
	let [L2, C2, h2] = to(mapped, OKLCH).coords;

	// Raw OKLCh differences. Δh is wrapped to the shortest signed arc, in degrees.
	let ΔL = L2 - L1;
	let ΔC = C2 - C1;
	let Δh = ((h2 - h1 + 540) % 360) - 180;

	// ΔH turns that hue angle into a perceptual distance: the chord
	// 2√(C₁C₂)·sin(Δh/2), which scales with the chroma it spans and fades
	// toward black/white (×4·L·(1−L)) where hue is invisible. C=0 ⇒ no hue.
	let meanL = (L1 + L2) / 2;
	let hueFade = 4 * meanL * (1 - meanL);
	let ΔH = C1 && C2 ? hueFade * 2 * Math.sqrt(C1 * C2) * Math.sin((Δh / 2) * Math.PI / 180) : 0;

	// Error: weighted sum of the absolute OKLCh deltas — hue > lightness >
	// chroma (weights). Deliberately L1, not Euclidean: ΔEOK already gives the
	// straight-line OKLab distance, so this is a different lens. `|| 0` keeps a
	// half-typed (empty) weight input from poisoning it.
	let error = (weights.L || 0) * Math.abs(ΔL) + (weights.C || 0) * Math.abs(ΔC) + (weights.H || 0) * Math.abs(ΔH);

	return {
		error,
		E2K: deltaE(color, mapped, { method: "2000" }),
		EOK: deltaE(color, mapped, { method: "OK" }),
		// Signed values for display (direction matters); the consumer compares
		// their magnitudes for best/worst highlighting. L in percentage points;
		// hue as the signed shortest arc in degrees.
		L: ΔL * 100,
		C: ΔC,
		H: Δh,
	};
}
