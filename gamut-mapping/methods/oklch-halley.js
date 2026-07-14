import { multiplyMatrices, multiply_v3_m3x3 } from "colorjs.io/src/util.js";
import oklab from "colorjs.io/src/spaces/oklab.js";
import srgbLinear from "colorjs.io/src/spaces/srgb-linear.js";
import p3Linear from "colorjs.io/src/spaces/p3-linear.js";
import rec2020Linear from "colorjs.io/src/spaces/rec2020-linear.js";

// Reduce OKLCh chroma to the *exact* gamut boundary, like oklch-cubic.js, but
// two things differ:
//
//   1. The boundary is found with bracketed Halley iteration on the channel
//      cubics instead of the closed-form (Cardano) roots. In JS this is faster
//      (no acos/cbrt) and converges to machine precision.
//
//   2. It resolves the OKLCh "blue fold". Near pure blue in sRGB and Rec.2020
//      (but not P3) the constant-hue slice is disconnected in chroma: the
//      boundary has an inner branch and a more vivid outer branch. A plain
//      first-exit solve like binary search lands on the inner branch and returns
//      a duller blue than the display can show. Here the fold hues are known per
//      gamut, and inside that window we solve a second time from the outside to
//      recover the vivid outer branch. This is the behaviour the LUT-based Edge
//      Seeker method was built to get; this method gets it without a LUT.
//
// Background on the channel cubics (shared with oklch-cubic.js): at fixed L and
// H, each linear-RGB channel is exactly cubic in chroma c,
//
//     channelᵢ(c) = Σₖ Tᵢₖ · (L + Qₖ·c)³
//
// because l'ₖ = L + Qₖ·c is affine in c. The gamut boundary is the smallest c
// at which any channel reaches 0 or 1.

const oklabToLMS = oklab.M.LabtoLMS; // OKLab → LMS'

function makeGamut (linearSpace, fold) {
	// LMS³ → XYZ (D65) → linear-RGB, derived from Color.js's own space matrices
	// so it stays consistent with the library.
	let M = multiplyMatrices(linearSpace.M.fromXYZ, oklab.M.LMStoXYZ);
	return { rows: [M[0], M[1], M[2]], fold };
}

// One entry per destination gamut: the LMS³→linear-RGB rows and the blue-fold
// hue window. The fold window is a geometric property of the gamut (where OKLCh
// hue runs backwards along the cyan→blue cube edge); it was precomputed once by
// sweeping that edge for the hue overshoot, and is padded slightly so a hue that
// rounds to the boundary is still caught. P3's edge is monotonic — no fold.
//
//   sRGB        blue hue 264.0520°   fold ≈ [264.0520, 264.2078]
//   Display P3  blue hue 264.0520°   (no fold)
//   Rec.2020    blue hue 245.0668°   fold ≈ [245.0668, 245.2844]
const GAMUTS = {
	srgb: makeGamut(srgbLinear, [264.03, 264.23]),
	p3: makeGamut(p3Linear, null),
	rec2020: makeGamut(rec2020Linear, [245.04, 245.31]),
};

// The Color.js registry maps into P3, so that is the default target. Switching
// to "srgb" or "rec2020" activates that gamut's fold handling.
const TARGET = "p3";

// Largest OKLCh chroma at (L, H) whose linear-RGB channels all stay within
// [0, 1]. Bracketed Halley: the Halley step is taken only while it stays inside
// the [in-gamut lo, out-of-gamut hi] bracket, otherwise the step is a bisection.
// That makes capture by a spurious cubic root impossible, so it is exact in a
// handful of iterations. `seed`/`lo`/`hi` let the caller start from the outside
// for the fold's second solve; pass seed = NaN for the analytic inside seed.
function solve (L, Q, rows, seed, lo, hi) {
	let [ql, qm, qs] = Q;

	let c = seed;
	if (Number.isNaN(c)) {
		// Earliest linearized crossing of a channel with 0 or 1: channelᵢ(0) = L³
		// with slope 3L²·Aᵢ, so the crossing is (1 − L³)/slope or −L³/slope.
		let L3 = L * L * L;
		let L2x3 = 3 * L * L;
		c = hi;
		for (let i = 0; i < 3; i++) {
			let row = rows[i];
			let A = row[0] * ql + row[1] * qm + row[2] * qs;
			let d1 = L2x3 * A;
			let cross = d1 > 0 ? (1 - L3) / d1 : d1 < 0 ? -L3 / d1 : Infinity;
			if (cross < c) {
				c = cross;
			}
		}
	}

	let best = c;
	let bestErr = Infinity;

	for (let iter = 0; iter < 16; iter++) {
		let l = L + c * ql;
		let m = L + c * qm;
		let s = L + c * qs;
		let l2 = l * l, m2 = m * m, s2 = s * s;
		let l3 = l2 * l, m3 = m2 * m, s3 = s2 * s;

		// The most-violated channel bound is the active constraint.
		let g = -Infinity, g1 = 0, g2 = 0;
		for (let i = 0; i < 3; i++) {
			let row = rows[i];
			let w0 = row[0], w1 = row[1], w2 = row[2];
			let v = w0 * l3 + w1 * m3 + w2 * s3;
			let d1 = 3 * (w0 * ql * l2 + w1 * qm * m2 + w2 * qs * s2);
			let d2 = 6 * (w0 * ql * ql * l + w1 * qm * qm * m + w2 * qs * qs * s);
			if (v - 1 > g) { // channel reaches white (= 1)
				g = v - 1; g1 = d1; g2 = d2;
			}
			if (-v > g) { // channel reaches black (= 0)
				g = -v; g1 = -d1; g2 = -d2;
			}
		}

		if (g > 0) {
			hi = c;
		}
		else {
			lo = c;
		}

		let err = g1 !== 0 ? Math.abs(g / g1) : Math.abs(g);
		if (err < bestErr) {
			bestErr = err;
			best = c;
		}

		// Halley step toward g = 0.
		let denom = 2 * g1 * g1 - g * g2;
		let step = denom !== 0 ? (2 * g * g1) / denom : g1 !== 0 ? g / g1 : 0;

		// Converged: the step is far below any meaningful chroma difference.
		if (step < 1e-9 && step > -1e-9) {
			return c;
		}

		let next = c - step;
		c = next > lo && next < hi ? next : (lo + hi) / 2;
	}

	return best;
}

function getMaxChroma (L, H, gamut) {
	if (L <= 0 || L >= 1) {
		return 0;
	}
	let rad = H * Math.PI / 180;
	// Q = LMS' offset per unit chroma along this hue (the a,b axes → LMS').
	let Q = multiply_v3_m3x3([0, Math.cos(rad), Math.sin(rad)], oklabToLMS);

	// First solve, seeded from inside. 0.5 is above any real gamut chroma.
	let c = solve(L, Q, gamut.rows, NaN, 0, 0.5);

	let fold = gamut.fold;
	if (!fold || H < fold[0] || H > fold[1]) {
		return c;
	}
	// Blue fold: re-solve from the outside (seed high, bracket floored at the
	// inner root) to reach the vivid outer branch.
	return solve(L, Q, gamut.rows, 0.45, c, 0.5);
}

export function compute (color) {
	color = color.to("oklch");
	let [L, C, H] = color.coords;

	if (L <= 0) {
		color.coords[0] = 0;
		color.coords[1] = 0;
		return color;
	}
	if (L >= 1) {
		color.coords[0] = 1;
		color.coords[1] = 0;
		return color;
	}
	if (!(C > 0)) {
		color.coords[1] = 0;
		return color;
	}

	let maxChroma = getMaxChroma(L, H || 0, GAMUTS[TARGET]);
	if (C > maxChroma) {
		// The answer sits on the gamut boundary; any encoding round-off is
		// clipped by the registry, as with the other exact methods.
		color.coords[1] = maxChroma;
	}
	return color;
}

export default {
	label: "OKLCh Halley",
	description: "Reduce OKLCh chroma to the exact gamut boundary with bracketed Halley iteration on the linear-RGB channel cubics, resolving the blue fold to the vivid branch without a lookup table.",
	compute,
};

// Exposed for tests only; the Color.js registry imports just the default export.
export { getMaxChroma, GAMUTS };
