import Color from "https://colorjs.io/dist/color.js";
import { WHITES } from "https://colorjs.io/src/adapt.js";
import * as util from "https://colorjs.io/src/util.js";
import {findCusp, findGamutIntersection} from "https://colorjs.io/src/spaces/okhsl.js";
import { constrain as constrainAngle } from "https://colorjs.io/src/angles.js";
import { makeEdgeSeeker } from "./edge-seeker/makeEdgeSeeker.js";

// Make a function to get the maximum chroma for a given lightness and hue
// Lookup table is created once and reused
const p3EdgeSeeker = makeEdgeSeeker((r, g, b) => {
	const [l, c, h = 0] = new Color("p3", [r, g, b]).to("oklch").coords;
	return { l, c, h };
});
const rec2020EdgeSeeker = makeEdgeSeeker((r, g, b) => {
	const [l, c, h = 0] = new Color("rec2020", [r, g, b]).to("oklch").coords;
	return { l, c, h };
});

const methods = {
	"clip": {
		label: "Clip",
		description: "Naïve clipping to the P3 gamut.",
	},
	"css": {
		label: "CSS",
		description: "CSS Color 4 gamut mapping method.",
	},
	"css-rec2020": {
		label: "CSS Rec2020",
		description: "CSS Color 4 gamut mapping to rec2020, then Naïve clipping to the P3 gamut.",
		compute: (color) => {
			return color
				.clone()
				.toGamut({ space: "rec2020", method: "css" })
				.toGamut({ space: "p3", method: "clip" });
		},
	},
	"scale-lh": {
		label: "Scale LH",
		description: "Runs Scale, sets L, H to those of the original color, then runs Scale again.",
		compute: (color) => {
			let mappedColor = methods.scale.compute(color);
			let lch = color.to("oklch").coords;
			mappedColor.set({
				"oklch.l": lch[0],
				"oklch.h": lch[2],
			});
			return methods.scale.compute(mappedColor);
		},
	},
	"scale": {
		label: "Scale",
		description: "Using a midpoint of 0.5, scale the color to fit within the linear P3 gamut.",
		compute: (color) => {
			// Make in gamut range symmetrical around 0 [-0.5, 0.5] instead of [0, 1]
			let deltas = color.to("p3-linear").coords.map(c => c - .5);

			let maxDistance = Math.max(...deltas.map(c => Math.abs(c)));
			let scalingFactor = maxDistance / .5;

			let scaledCoords = deltas.map((delta, i) => {
				let scaled = delta / scalingFactor;
				return scaled + .5;
			});

			return new Color("p3-linear", scaledCoords).to("p3");
		},
	},
	"chromium": {
		label: "Chromium",
		description: "A port of the 'baked-in' Chromium implementation, mapping to an approximation of the rec2020 gamut.",
		compute: (color) => {
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
			return oklab.set({a: alpha * a, b: alpha * b})
			// Implementation difference: The reference algorithm does not include a
			// final clip, so some resulting colors may be outside of `rec2020`, and
			// here we clip to p3 for comparison with other methods.
				.toGamut({method: "clip", space: "p3"});
		},
	},
	"bjorn" : {
		label: "Björn Ottosson",
		description: "Approach using Oklab as defined by the creator of Oklab, Bjorn Ottosson. Projected toward constant lightness.",
		lmsToP3Linear: [
			[ 3.1277689713618737, -2.2571357625916377,  0.1293667912297650],
			[-1.0910090184377972,  2.4133317103069207, -0.3223226918691244],
			[-0.0260108019385705, -0.5080413317041667,  1.5340521336427371],
		],
		P3Coeff: [
			// Red
			[
				// Limit
				[-1.77234393, -0.82075874],
				// `Kn` coefficients
				[1.19414018, 1.7629812, 0.59585994, 0.75759997, 0.5681685],
			],
			// Green
			[
				// Limit
				[1.80319872, -1.1932814],
				// `Kn` coefficients
				[0.73956682, -0.4595428, 0.08285309, 0.12541165, -0.14503291],
			],
			// Blue
			[
				// Limit
				[0.08970488, 1.90327747],
				// `Kn` coefficients
				[1.36509441, -0.0139623, -1.14523051, -0.50259879, 0.00317471],
			],
		],
		compute: (color) => {
			// Approach described in https://bottosson.github.io/posts/gamutclipping/
			// For comparison against CSS approaches, constant lightness was used.
			let oklab = color.to("oklab");

			// Clamp lightness and see if we are in gamut.
			oklab.l = util.clamp(0.0, oklab.l, 1.0);  // If doing adaptive lightness, this might not be wanted.
			if (oklab.inGamut("p3", { epsilon: 0 })) {
				return oklab.to("p3");
			}

			// Get coordinates and calculate chroma
			let [l, a, b] = oklab.coords;
			// Bjorn used 0.00001, are there issues with 0.0?
			const epsilon = 0.0
			let c = Math.max(epsilon, Math.sqrt(a ** 2 + b ** 2));

			// Normalize a and b
			if (c) {
				a /= c;
				b /= c;
			}

			// Get gamut specific transform from LMS to RGB and related coefficients
			const lmsToLinear = methods.bjorn.lmsToP3Linear;
			const coeff = methods.bjorn.P3Coeff;

			// Find the lightness and chroma for the cusp.
			let cusp = findCusp(a, b, lmsToLinear, coeff);

			// Set the target lightness towards which chroma reduction will take place.
			// `cusp[0]` is approximate lightness of cusp, l is current lightness.
			// One could apply some adaptive lightness if desired.
			const target = l; // cusp[0];
			const t = findGamutIntersection(a, b, l, c, target, lmsToLinear, coeff, cusp);

			// Adjust lightness and chroma
			if (target !== l) {
				oklab.l = target * (1 - t) + t * l;
			}
			c *= t;
			oklab.a = c * a;
			oklab.b = c * b;

			// Convert back to P3 and clip.
			return oklab.to('p3').toGamut({method: 'clip'});
		},
	},
	"raytrace": {
		label: "Raytrace",
		description: "Uses ray tracing to find a color with reduced chroma on the RGB surface.",
		compute: (color) => {
			// An approached originally designed for ColorAide.
			// https://facelessuser.github.io/coloraide/gamut/#ray-tracing-chroma-reduction
			if (color.inGamut("p3", { epsilon: 0 })) {
				return color.to("p3");
			}

			let mapColor = color.to("oklch");
			let lightness = mapColor.coords[0];

			if (lightness >= 1) {
				return new Color({ space: "xyz-d65", coords: WHITES["D65"] }).to("p3");
			}
			else if (lightness <= 0) {
				return new Color({ space: "xyz-d65", coords: [0, 0, 0] }).to("p3");
			}
			return methods.raytrace.trace(mapColor);
		},

		oklchToLinearRGB (lch) {
			// Convert from Oklab to linear RGB.
			//
			// Can be any gamut as long as `lmsToRgb` is a matrix
			// that transform the LMS values to the linear RGB space.

			let c = lch[1];
			let h = lch[2];
			// to lab
			let result = [
				lch[0],
				c * Math.cos((h * Math.PI) / 180),
				c * Math.sin((h * Math.PI) / 180)
			];

			// To LMS
			util.multiply_v3_m3x3(
				result,
				[
					[ 1.0000000000000000,  0.3963377773761749,  0.2158037573099136 ],
					[ 1.0000000000000000, -0.1055613458156586, -0.0638541728258133 ],
					[ 1.0000000000000000, -0.0894841775298119, -1.2914855480194092 ]
				],
				result
			);
			result[0] = result[0] ** 3;
			result[1] = result[1] ** 3;
			result[2] = result[2] ** 3;

			// To RGB
			util.multiply_v3_m3x3(
				result,
				[
					[3.127768971361874, -2.2571357625916395, 0.12936679122976516],
					[-1.0910090184377979, 2.413331710306922, -0.32232269186912466],
					[-0.02601080193857028, -0.508041331704167, 1.5340521336427373]
				],
				result
			);
			return result;
		},

		LinearRGBtoOklch (rgb) {
			// Convert from Oklch to linear RGB.
			//
			// Can be any gamut as long as `lmsToRgb` is a matrix
			// that transform the LMS values to the linear RGB space.

			// To LMS
			let result = util.multiply_v3_m3x3(
				rgb,
				[
					[0.4813798527499543, 0.4621183710113182, 0.05650177623872754],
					[0.2288319418112447, 0.6532168193835677, 0.11795123880518772],
					[0.08394575232299314, 0.22416527097756647, 0.6918889766994405]
				]
			);

			result[0] = Math.cbrt(result[0]);
			result[1] = Math.cbrt(result[1]);
			result[2] = Math.cbrt(result[2]);

			util.multiply_v3_m3x3(
				result,
				[
					[ 0.2104542683093140,  0.7936177747023054, -0.0040720430116193 ],
					[ 1.9779985324311684, -2.4285922420485799,  0.4505937096174110 ],
					[ 0.0259040424655478,  0.7827717124575296, -0.8086757549230774 ]
				],
				result
			);

			let a = result[1];
			let b = result[2];
			return [
				result[0],
				Math.sqrt(a ** 2 + b ** 2),
				constrainAngle((Math.atan2(b, a) * 180) / Math.PI)
			];
		},

		trace: (orig) => {
			let coords = orig.coords;
			let [light, chroma, hue] = coords;
			coords[1] = 0;

			let anchor = methods.raytrace.oklchToLinearRGB(coords);
			coords[1] = chroma;
			let mapColor = methods.raytrace.oklchToLinearRGB(coords);

			let raytrace = methods.raytrace.raytrace_box;
			// Assume an RGB range between 0 - 1.
			// This could be different depending on the RGB max luminance and could
			// be calculated to be different depending on needs.
			// We'll use this to adjust our anchor point closer to the gamut surface.
			let low = 1e-6;
			let high = 1 - low;

			// Cast a ray from the zero chroma color to the target color.
			// Trace the line to the RGB cube edge and find where it intersects.
			// Correct L and h within the perceptual OkLCh after each attempt.
			for (let i = 0; i < 4; i++) {
				if (i) {
					const oklch = methods.raytrace.LinearRGBtoOklch(mapColor);
					oklch[0] = light
					oklch[2] = hue;
					mapColor = methods.raytrace.oklchToLinearRGB(oklch);
				}
				const current = mapColor.slice();
				const intersection = raytrace(anchor, current);

				// Adjust anchor point closer to surface, when possible, to improve results for some spaces.
				// But not too close to the surface.
				if (i && current.every((x) => low < x && x < high)) {
					anchor = current;
				}

				if (intersection.length) {
					mapColor = intersection.slice();
					continue;
				}

				// If there was no change, we are done
				break;
			}

			// Remove noise from floating point math by clipping
			orig.setAll(
				'p3-linear',
				[
					util.clamp(0.0, mapColor[0], 1.0),
					util.clamp(0.0, mapColor[1], 1.0),
					util.clamp(0.0, mapColor[2], 1.0),
				]
			);

			return orig.to("p3");
		},

		raytrace_box: (start, end, bmin = [0, 0, 0], bmax = [1, 1, 1]) => {
			// Use slab method to detect intersection of ray and box and return intersect.
			// https://en.wikipedia.org/wiki/Slab_method

			// Calculate whether there was a hit
			let tfar = Infinity;
			let tnear = -Infinity;
			let direction = [];

			for (let i = 0; i < 3; i++) {
				const a = start[i];
				const b = end[i];
				const d = b - a;
				const bn = bmin[i];
				const bx = bmax[i];
				direction.push(d);

				// Non parallel cases
				if (d != 0) {
					const inv_d = 1 / d;
					const t1 = (bn - a) * inv_d;
					const t2 = (bx - a) * inv_d;
					tnear = Math.max(Math.min(t1, t2), tnear);
					tfar = Math.min(Math.max(t1, t2), tfar);
				}

				// Impossible parallel case
				else if (a < bn || a > bx) {
					return [];
				}
			}

			// No hit
			if (tnear > tfar || tfar < 0) {
				return [];
			}

			// Favor the intersection first in the direction start -> end
			if (tnear < 0) {
				tnear = tfar;
			}

			// Result should be finite
			if (!isFinite(tnear)) {
				return [];
			}

			// Calculate nearest intersection via interpolation
			return [
				start[0] + direction[0] * tnear,
				start[1] + direction[1] * tnear,
				start[2] + direction[2] * tnear,
			];
		},
	},
	"edge-seeker": {
		label: "Edge Seeker",
		description: "Using a LUT to detect edges of the p3 gamut and reduce chroma accordingly.",
		compute: (color) => {
			let [l, c, h] = color.to("oklch").coords;
			if (l <= 0) {
				return new Color("oklch", [0, 0, h]);
			}
			if (l >= 1) {
				return new Color("oklch", [1, 0, h]);
			}
			let maxChroma = p3EdgeSeeker(l, h || 0);
			if (c > maxChroma) {
				c = maxChroma;
			}
			// At this point it is safe to clip the values
			return new Color("oklch", [l, c, h]).toGamut({ space: "p3", method: "clip" });
		},
	},
	"edge-seeker-rec2020": {
		label: "Edge Seeker rec2020",
		description: "Using a LUT to detect edges of the rec2020 gamut and reduce chroma accordingly.",
		compute: (color) => {
			let [l, c, h] = color.to("oklch").coords;
			if (l <= 0) {
				return new Color("oklch", [0, 0, h]);
			}
			if (l >= 1) {
				return new Color("oklch", [1, 0, h]);
			}
			let maxChroma = rec2020EdgeSeeker(l, h || 0);
			if (c > maxChroma) {
				c = maxChroma;
			}
			// At this point it is safe to clip the values
			return new Color("oklch", [l, c, h]).toGamut({ space: "p3", method: "clip" });
		},
	},
	// "scale125": {
	// 	label: "Scale from 0.125",
	// 	description: "Using a midpoint of 0.125 (perceptual midpoint per Oklab), scale the color to fit within the linear P3 gamut using different scaling factors for values below and above the midpoint.",
	// 	compute: (color) => {
	// 		let p3Linear = color.to("p3-linear");
	// 		let deltas = p3Linear.coords.map(c => c - .125); /* in-gamut range is now -.125 to .875 */
	// 		let max = [Math.min(...deltas.filter(c => c < 0)), Math.max(...deltas.filter(c => c > 0))];
	// 		let factor = [max[0] / .125, max[1] / .875];

	// 		let mapped = deltas.map((delta, i) => {
	// 			if (delta === 0) {
	// 				return .125;
	// 			}
	// 			else if (delta < 0) {
	// 				let scaled = delta / factor[0];
	// 				return scaled + .125;
	// 			}
	// 			else {
	// 				let scaled = delta / factor[1];
	// 				return scaled + .125;
	// 			}
	// 		});

	// 		return new Color("p3-linear", mapped).to("p3");
	// 	}
	// },
};

export default methods;
