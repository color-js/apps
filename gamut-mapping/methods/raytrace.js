import Color from "colorjs.io";
import { WHITES } from "colorjs.io/src/adapt.js";
import * as util from "colorjs.io/src/util.js";
import { constrain as constrainAngle } from "colorjs.io/src/angles.js";

// Convert from Oklab to linear RGB.
//
// Can be any gamut as long as `lmsToRgb` is a matrix
// that transform the LMS values to the linear RGB space.
function oklchToLinearRGB (lch) {
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
}

// Convert from linear RGB to Oklch.
//
// Can be any gamut as long as `lmsToRgb` is a matrix
// that transform the LMS values to the linear RGB space.
function LinearRGBtoOklch (rgb) {
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
}

// Use slab method to detect intersection of ray and box and return intersect.
// https://en.wikipedia.org/wiki/Slab_method
function raytrace_box (start, end, bmin = [0, 0, 0], bmax = [1, 1, 1]) {
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
		if (Math.abs(d) > 1e-15) {
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

	// A point, or something approaching a single point where start and end are the same.
	if (!isFinite(tnear)) {
		return [];
	}

	// Calculate nearest intersection via interpolation
	return [
		start[0] + direction[0] * tnear,
		start[1] + direction[1] * tnear,
		start[2] + direction[2] * tnear,
	];
}

// Cast a ray from the zero-chroma color to the target color and walk it to the
// P3 RGB cube surface, correcting L and h in OkLCh after each iteration.
function trace (orig) {
	let coords = orig.coords;
	let [light, chroma, hue] = coords;

	// If this were performed within a perceptual space like CAM16, which has achromatics that do not align
	// with the RGB achromatic line, projecting the color onto the RGB achromatic line may be preferable,
	// but since OkLCh's achromatics align with all CSS RGB spaces, just set chroma to zero.
	let anchor = oklchToLinearRGB([light, 0, hue]);
	let mapColor = oklchToLinearRGB(coords);

	// Calculate bounds to adjust the anchor closer to the gamut surface.
	// Assume an RGB range between 0 - 1, but this could be different depending on the RGB max luminance,
	// and could be calculated to be different depending on needs.
	// This is desgined to work with any perceptual space, and some are more senstive to evaluating
	// too close to the surface. OkLCh likely doesn't need a 1e-6 offset, but we keep it for completeness
	// in case anyone desires to use this with a different perceptual space. 1e-6 is also quite generous
	// in a 64 bit double and could likely be smaller.
	let low = 1e-6;
	let high = 1 - low;

	// Cast a ray from the zero chroma color to the target color.
	// Trace the line to the RGB cube edge and find where it intersects.
	// Correct L and h within the perceptual OkLCh after each attempt.
	let last = mapColor;
	for (let i = 0; i < 4; i++) {
		if (i) {
			// For constant luminance, we correct the color by simply setting lightness and hue to
			// match the original color. In a non constant luminance reduction, it is better to
			// project the color onto the reduction path vector.
			const oklch = LinearRGBtoOklch(mapColor);
			oklch[0] = light
			oklch[2] = hue;
			mapColor = oklchToLinearRGB(oklch);
		}
		const intersection = raytrace_box(anchor, mapColor);

		// If we cannot find an intersection, reset to last successful iteration of the color.
		// This is unlikely to happen with gamut reduction in the mapping space of OkLCh (or most target
		// perceptual spaces), especially with constant luminance reduction.
		// This is provided for catastrophic failures where a specific, perceptual mapping space completely
		// breaks down due to ridiculously wide colors (outside the visible spectrum). It is expected that
		// CSS would never trigger this.
		if (intersection.length === 0) {
			mapColor = last;
			break;
		}

		// Adjust anchor point closer to surface, when possible, to improve results for some spaces.
		if (i && mapColor.every((x) => low < x && x < high)) {
			anchor = mapColor;
		}

		// If we have an intersection, update the color.
		last = mapColor = intersection;
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
}

export function compute (color) {
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
	return trace(mapColor);
}

export default {
	label: "Ray Trace",
	description: "CSS Color 4 - Ray Trace: Uses ray tracing to find a color with reduced chroma on the RGB surface.",
	compute,
};
