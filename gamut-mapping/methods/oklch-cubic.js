import Color from "colorjs.io";
import { multiplyMatrices, multiply_v3_m3x3 } from "colorjs.io/src/util.js";
import oklab from "colorjs.io/src/spaces/oklab.js";
import p3linear from "colorjs.io/src/spaces/p3-linear.js";

// ─── TEMPORARY ───────────────────────────────────────────────────────────────
// Spaces expose their matrices as `space.M.<name>` only from the next color.js
// release (PR merged, not yet published). These `??=` writes create/fill `.M` on
// the current release and become no-ops once it ships, so the code below already
// references the native mechanism.
// TODO(upgrade): delete this whole block after bumping color.js — nothing else
// changes, the `oklab.M.*` / `p3linear.M.*` references resolve natively.
oklab.M ??= {};
oklab.M.LabtoLMS ??= [
	[1,  0.3963377773761749,  0.2158037573099136],
	[1, -0.1055613458156586, -0.0638541728258133],
	[1, -0.0894841775298119, -1.2914855480194092],
];
oklab.M.LMStoXYZ ??= [
	[ 1.2268798758459243, -0.5578149944602171,  0.2813910456659647],
	[-0.0405757452148008,  1.1122868032803170, -0.0717110580655164],
	[-0.0763729366746601, -0.4214933324022432,  1.5869240198367816],
];
p3linear.M ??= {};
p3linear.M.fromXYZ ??= [
	[ 2.493496911941425,   -0.9313836179191239, -0.40271078445071684],
	[-0.8294889695615747,   1.7626640603183463,  0.023624685841943577],
	[ 0.03584583024378447, -0.07617238926804182, 0.9568845240076872],
];
// ─── end TEMPORARY ───────────────────────────────────────────────────────────

const oklabToLMS = oklab.M.LabtoLMS;                                  // OKLab → LMS'
const lmsToRGB = multiplyMatrices(p3linear.M.fromXYZ, oklab.M.LMStoXYZ); // LMS³ → linear P3

// Real roots of ax³ + bx² + cx + d = 0 (closed form, no iteration).
function solveCubic (a, b, c, d) {
	if (Math.abs(a) < 1e-12) {
		// Degenerate: quadratic or linear.
		if (Math.abs(b) < 1e-12) {
			return Math.abs(c) < 1e-12 ? [] : [-d / c];
		}
		let disc = c * c - 4 * b * d;
		if (disc < 0) {
			return [];
		}
		let s = Math.sqrt(disc);
		return [(-c + s) / (2 * b), (-c - s) / (2 * b)];
	}

	// Depress to t³ + pt + q = 0 via x = t − b/3.
	b /= a; c /= a; d /= a;
	let p = c - b * b / 3;
	let q = 2 * b ** 3 / 27 - b * c / 3 + d;
	let off = -b / 3;
	let disc = q * q / 4 + p ** 3 / 27;

	if (disc > 1e-14) {
		// One real root (Cardano).
		let s = Math.sqrt(disc);
		return [Math.cbrt(-q / 2 + s) + Math.cbrt(-q / 2 - s) + off];
	}
	else if (disc > -1e-14) {
		// Repeated roots.
		let u = Math.cbrt(-q / 2);
		return [2 * u + off, -u + off];
	}
	else {
		// Three distinct real roots (trigonometric form).
		let m = 2 * Math.sqrt(-p / 3);
		let phi = Math.acos(Math.max(-1, Math.min(1, 3 * q / (p * m))));
		return [0, 1, 2].map(k => m * Math.cos((phi - 2 * Math.PI * k) / 3) + off);
	}
}

let QABDCache = new Map(); // H → [Q, A, B, D] (see getQABD)

function getQABD (H) {
	if (QABDCache.has(H)) {
		return QABDCache.get(H);
	}
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

	QABDCache.set(H, [Q, A, B, D]);
	return [Q, A, B, D];
}

export function compute (color) {
	color = color.to("oklch");
	let [L, C, H] = color.coords;

	// Achromatic (or NaN chroma) is always in gamut: nothing to reduce.
	if (!(C > 0)) {
		return color;
	}

	let [Q, A, B, D] = getQABD(H);

	// Max in-gamut chroma = the first chroma (≤ C) at which any channel reaches a
	// gamut bound, scanning up from gray (c = 0, in gamut). We avoid solving all
	// six cubics: each channel's derivative f'(c) = 3D·c² + 6LB·c + 3L²A is a
	// quadratic, so if it has no critical point in (0, maxC] the channel is
	// monotonic there and can only exit through its slope-direction bound (sign of
	// the c¹ term) — the other bound is skipped. And a monotonic channel still
	// inside [0,1] at the running maxC can't exit any sooner, so it needs no solve
	// at all. Both bounds appear only in the low-L non-monotonic case (~1.8
	// Cardano solves/color vs 6, and identical to the exhaustive result).
	let maxC = C;
	for (let i = 0; i < 3; i++) {
		let a = D[i];
		let b = 3 * L * B[i];
		let lin = 3 * L * L * A[i];

		// Monotonic on (0, maxC]? (No root of f' in range.)
		let monotonic = true;
		let ddisc = 4 * b * b - 12 * a * lin;
		if (ddisc >= 0 && Math.abs(a) > 1e-15) {
			let s = Math.sqrt(ddisc);
			for (let cc of [(-2 * b + s) / (6 * a), (-2 * b - s) / (6 * a)]) {
				if (cc > 1e-12 && cc <= maxC) {
					monotonic = false;
				}
			}
		}

		let bounds = monotonic ? [lin > 0 ? 1 : 0] : [0, 1];
		for (let bound of bounds) {
			// A monotonic channel still interior at maxC never exited earlier.
			if (monotonic) {
				let v = ((a * maxC + b) * maxC + lin) * maxC + L ** 3;
				if (v >= 0 && v <= 1) {
					continue;
				}
			}
			for (let root of solveCubic(a, b, lin, L ** 3 - bound)) {
				if (root > 1e-9 && root < maxC) {
					maxC = root;
				}
			}
		}
	}

	color.coords[1] = maxC; // replace input chroma with the reduced value
	return color;
}

export default {
	label: "OKLCh cubic",
	description: "Reduce OKLCh chroma to the exact P3 gamut boundary by solving, in closed form, the cubic that each linear-P3 channel traces as a function of chroma.",
	compute,
};
