import { computeHueData, makeCompute } from "./oklch-cubic.js";

// Identical to oklch-cubic, but the per-hue cubic data is recomputed on every
// call instead of being memoized. Feeding makeCompute the raw computeHueData
// (rather than the cached lookup) isolates the hue-setup cost the cache hides
// when many colors share a hue — exactly what the benchmark sweep does.
export const compute = makeCompute(computeHueData);

export default {
	label: "OKLCh cubic (no cache)",
	description: "OKLCh cubic without per-hue memoization: every color recomputes the cubic's hue-dependent coefficients, so the timing reflects the full per-call cost rather than the cache's amortized one.",
	compute,
};
