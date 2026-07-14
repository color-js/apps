export function compute (color) {
	// Implementation difference: The reference algorithm does not appear to
	// return early for in-gamut colors.
	if (color.inGamut("rec2020")) {
		return color;
	}
	const oklab = color.to("oklab");
	const [l, a, b] = oklab.coords;
	// Constants for the normal vector of the plane formed by white, black, and
	// the specified vertex of the gamut.
	const normal_R = [0.409702, -0.912219];
	const normal_M = [-0.397919, -0.917421];
	const normal_B = [-0.906800, 0.421562];
	const normal_C = [-0.171122, 0.985250];
	const normal_G = [0.460276, 0.887776];
	const normal_Y = [0.947925, 0.318495];

	// For the triangles formed by white (W) or black (K) with the vertices
	// of Yellow and Red (YR), Red and Magenta (RM), etc, the constants to be
	// used to compute the intersection of a line of constant hue and luminance
	// with that plane.
	const c0_YR = 0.091132;
	const cW_YR = [0.070370, 0.034139];
	const cK_YR = [0.018170, 0.378550];
	const c0_RM = 0.113902;
	const cW_RM = [0.090836, 0.036251];
	const cK_RM = [0.226781, 0.018764];
	const c0_MB = 0.161739;
	const cW_MB = [-0.008202, -0.264819];
	const cK_MB = [0.187156, -0.284304];
	const c0_BC = 0.102047;
	const cW_BC = [-0.014804, -0.162608];
	const cK_BC = [-0.276786, 0.004193];
	const c0_CG = 0.092029;
	const cW_CG = [-0.038533, -0.001650];
	const cK_CG = [-0.232572, -0.094331];
	const c0_GY = 0.081709;
	const cW_GY = [-0.034601, -0.002215];
	const cK_GY = [0.012185, 0.338031];

	const L = l;
	const one_minus_L = 1.0 - L;
	const ab = [a, b];

	// Find the planes to intersect with and set the constants based on those
	// planes.
	let c0 = 0;
	let cW = [0, 0];
	let cK = [0, 0];
	const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

	if (dot(ab, normal_R) < 0.0) {
		if (dot(ab, normal_G) < 0.0) {
			if (dot(ab, normal_C) < 0.0) {
				c0 = c0_BC;
				cW = cW_BC;
				cK = cK_BC;
			}
			else {
				c0 = c0_CG;
				cW = cW_CG;
				cK = cK_CG;
			}
		}
		else {
			if (dot(ab, normal_Y) < 0.0) {
				c0 = c0_GY;
				cW = cW_GY;
				cK = cK_GY;
			}
			else {
				c0 = c0_YR;
				cW = cW_YR;
				cK = cK_YR;
			}
		}
	}
	else {
		if (dot(ab, normal_B) < 0.0) {
			if (dot(ab, normal_M) < 0.0) {
				c0 = c0_RM;
				cW = cW_RM;
				cK = cK_RM;
			}
			else {
				c0 = c0_MB;
				cW = cW_MB;
				cK = cK_MB;
			}
		}
		else {
			c0 = c0_BC;
			cW = cW_BC;
			cK = cK_BC;
		}
	}

	// Perform the intersection.
	let alpha = 1;

	// Intersect with the plane with white.
	const w_denom = dot(cW, ab);
	if (w_denom > 0) {
		const w_num = c0 * one_minus_L;
		if (w_num < w_denom) {
			alpha = Math.min(alpha, w_num / w_denom);
		}
	}

	// Intersect with the plane with black.
	let k_denom = dot(cK, ab);
	if (k_denom > 0) {
		const k_num = c0 * L;
		if (k_num < k_denom) {
			alpha = Math.min(alpha, k_num / k_denom);
		}
	}

	// Attenuate the ab coordinate by alpha.
	// Implementation difference: The reference algorithm does not include a
	// final clip, so some resulting colors may be outside of `rec2020`. The
	// out-of-gamut result is clipped to P3 by the registry's final step.
	return oklab.set({a: alpha * a, b: alpha * b});
}

export default {
	label: "Baked-in",
	description: "A port of the 'baked-in' GMA that was tested in Chromium, mapping to an approximation of the rec2020 gamut.",
	compute,
};
