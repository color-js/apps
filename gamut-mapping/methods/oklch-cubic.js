import { multiplyMatrices, multiply_v3_m3x3 } from "colorjs.io/src/util.js";
import oklab from "colorjs.io/src/spaces/oklab.js";
import p3linear from "colorjs.io/src/spaces/p3-linear.js";

const oklabToLMS = oklab.M.LabtoLMS;                                  // OKLab → LMS'
const lmsToRGB = multiplyMatrices(p3linear.M.fromXYZ, oklab.M.LMStoXYZ); // LMS³ → linear P3

// Smallest real root of a·t³ + b·t² + c·t + d in the open interval (lo, hi), or
// Infinity if none. Closed form (no iteration); returns a scalar, not an array,
// so the per-call solve allocates nothing on the hot path.
function firstRoot (a, b, c, d, lo, hi) {
	// Up to three real roots; default Infinity drops out of the (lo, hi) filter.
	let r0 = Infinity, r1 = Infinity, r2 = Infinity;

	if (Math.abs(a) < 1e-12) {
		// Degenerate: quadratic or linear.
		if (Math.abs(b) < 1e-12) {
			if (Math.abs(c) >= 1e-12) {
				r0 = -d / c;
			}
		}
		else {
			let disc = c * c - 4 * b * d;
			if (disc >= 0) {
				let s = Math.sqrt(disc);
				r0 = (-c + s) / (2 * b);
				r1 = (-c - s) / (2 * b);
			}
		}
	}
	else {
		// Depress to t³ + pt + q = 0 via t = u − b/3.
		b /= a; c /= a; d /= a;
		let p = c - b * b / 3;
		let q = 2 * b ** 3 / 27 - b * c / 3 + d;
		let off = -b / 3;
		let disc = q * q / 4 + p ** 3 / 27;

		if (disc > 1e-14) {
			// One real root (Cardano).
			let s = Math.sqrt(disc);
			r0 = Math.cbrt(-q / 2 + s) + Math.cbrt(-q / 2 - s) + off;
		}
		else if (disc > -1e-14) {
			// Repeated roots.
			let u = Math.cbrt(-q / 2);
			r0 = 2 * u + off;
			r1 = -u + off;
		}
		else {
			// Three distinct real roots (trigonometric form).
			let m = 2 * Math.sqrt(-p / 3);
			let phi = Math.acos(Math.max(-1, Math.min(1, 3 * q / (p * m))));
			r0 = m * Math.cos(phi / 3) + off;
			r1 = m * Math.cos((phi - 2 * Math.PI) / 3) + off;
			r2 = m * Math.cos((phi - 4 * Math.PI) / 3) + off;
		}
	}

	// Smallest root strictly inside (lo, hi).
	let best = Infinity;
	if (r0 > lo && r0 < hi) {
		best = r0;
	}
	if (r1 > lo && r1 < hi && r1 < best) {
		best = r1;
	}
	if (r2 > lo && r2 < hi && r2 < best) {
		best = r2;
	}
	return best;
}

// Smallest t > 0 where a channel turns: the first positive root of its derivative
// D·t² + 2B·t + A, i.e. firstRoot's quadratic branch.
function firstTurn (D, B, A) {
	return firstRoot(0, D, 2 * B, A, 1e-12, Infinity);
}

// The per-hue cubic structure: the part of the solve that depends only on H, so
// compute() is left with just the per-color (white-bound) work.
function getHueData (H) {
	let rad = H * Math.PI / 180;

	// At fixed L and H, each linear-P3 channel is *exactly* cubic in chroma c:
	//
	//   channelᵢ(c) = L³ + 3L²·Aᵢ·c + 3L·Bᵢ·c² + Dᵢ·c³
	//
	// because l'ₖ = L + Qₖ·c is affine in c (the a,b axes enter OKLab→LMS
	// linearly), and channelᵢ = Σₖ Tᵢₖ·l'ₖ³. The constant is L³ since c = 0 is
	// gray and the rows of lmsToRGB sum to 1.
	let Q = multiply_v3_m3x3([0, Math.cos(rad), Math.sin(rad)], oklabToLMS);
	let A = multiply_v3_m3x3(Q, lmsToRGB);
	let B = multiply_v3_m3x3(Q.map(q => q * q), lmsToRGB);
	let D = multiply_v3_m3x3(Q.map(q => q ** 3), lmsToRGB);

	// Substituting c = L·t factors L out entirely: channelᵢ(c) = L³·Pᵢ(t) with
	//
	//   Pᵢ(t) = 1 + 3Aᵢ·t + 3Bᵢ·t² + Dᵢ·t³
	//
	// so Pᵢ — hence the lower-gamut exit and the monotonicity structure — depends
	// only on H and is computed here. Only the white bound stays per color (it
	// lands at Pᵢ = L⁻³); see compute.

	// Lower exit: smallest t > 0 where any channel reaches the black bound
	// (channelᵢ = 0 ⟺ Pᵢ = 0). Every channel starts at Pᵢ(0) = 1, so the first
	// such t is where the gamut is first left downward, whatever the lightness.
	let tLower = Infinity;
	let turn = []; // first turning point of each channel in t-space (Infinity if monotonic)
	for (let i = 0; i < 3; i++) {
		tLower = Math.min(tLower, firstRoot(D[i], 3 * B[i], 3 * A[i], 1, 1e-9, Infinity));
		turn[i] = firstTurn(D[i], B[i], A[i]);
	}

	return {A, B, D, tLower, turn};
}

export function compute (color) {
	color = color.to("oklch");
	let [L, C, H] = color.coords;

	// Return early for achromatic colors or white/black
	let isBlack = L <= 0;
	let isWhite = L >= 1;
	let isGray = C <= 0 || C === null;

	if (isBlack || isWhite || isGray) {
		if (isBlack) {
			color.coords[0] = 0;
		}
		else if (isWhite) {
			color.coords[0] = 1;
		}

		color.coords[1] = 0;
		return color;
	}

	let {A, B, D, tLower, turn} = getHueData(H);

	// Work in t = c/L. The cap starts at the input chroma and the (hue-only) lower
	// exit; the white bound below can only pull it lower.
	let maxT = Math.min(C / L, tLower);

	// White exit: the smallest t > 0 at which any channel reaches 1, i.e.
	// Pᵢ(t) = L⁻³. Same cubic as Pᵢ, only the constant shifts to 1 − L⁻³. This is
	// the one part that depends on L, so it's the only per-color solving left.
	let target = 1 / L ** 3; // Pᵢ value at the white bound
	let d = 1 - target; // constant term of Pᵢ(t) − L⁻³
	for (let i = 0; i < 3; i++) {
		// Monotonic up to the running cap (no turning point before it)? Then it can
		// only reach the white bound if it's rising and not still below it at maxT —
		// otherwise skip the solve. (Its black bound, if any, is already in tLower.)
		if (turn[i] > maxT) {
			if (A[i] <= 0) {
				continue;
			}
			let PmaxT = ((D[i] * maxT + 3 * B[i]) * maxT + 3 * A[i]) * maxT + 1;
			if (PmaxT < target) {
				continue;
			}
		}
		maxT = Math.min(maxT, firstRoot(D[i], 3 * B[i], 3 * A[i], d, 1e-9, maxT));
	}

	color.coords[1] = L * maxT; // replace input chroma with the reduced value
	return color;
}

export default {
	label: "OKLCh cubic",
	description: "Reduce OKLCh chroma to the exact P3 gamut boundary by solving, in closed form, the cubic that each linear-P3 channel traces as a function of chroma.",
	compute,
};
