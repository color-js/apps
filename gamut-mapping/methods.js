// Registry of gamut mapping methods. Each method lives in its own file under
// methods/ so their relative sizes are easy to compare. A method is a config
// object with `label`, `description`, and a `compute` function.
import clip, { compute as clipToGamut } from "./methods/clip.js";
import css from "./methods/css.js";
import cssRec2020 from "./methods/css-rec2020.js";
import scale from "./methods/scale.js";
import chromium from "./methods/chromium.js";
import bjorn from "./methods/bjorn.js";
import raytrace from "./methods/raytrace.js";
import edgeSeeker from "./methods/edge-seeker/index.js";
import hslClip from "./methods/hsl-clip.js";
import scaleGray from "./methods/scale-gray.js";
import oklchCubic from "./methods/oklch-cubic.js";
import oklchHalley from "./methods/oklch-halley.js";
import { time } from "./stats.js";

const methods = {
	"clip": clip,
	"css": css,
	"css-rec2020": cssRec2020,
	"scale": scale,
	"chromium": chromium,
	"bjorn": bjorn,
	"raytrace": raytrace,
	"edge-seeker": edgeSeeker,
	"hsl-clip": hslClip,
	"scale-gray": scaleGray,
	"oklch-cubic": oklchCubic,
	"oklch-halley": oklchHalley,
};

// The maximum OkLCh chroma we feed any method, roughly the widest chroma of the
// gamuts we map into. Capping the input here puts every method on the same
// footing, so wildly out-of-gamut inputs don't hand some methods more room to
// diverge than others.
const MAX_CHROMA = 0.4;

// Wrap a method's compute so it's normalized on both ends: cap the input chroma
// before mapping, and after mapping fall back to a naïve P3 clip whenever the
// result is still out of gamut. A method that returns an out-of-gamut color
// implicitly consents to this clip; it keeps the reported deltas honest, since
// they're measured against the color the browser can actually display rather
// than an out-of-gamut value the swatch would silently clip.
function normalize (compute) {
	return (color) => {
		let input = color.to("oklch").set({ c: c => Math.min(c, MAX_CHROMA) });
		let result = compute(input);
		return result.inGamut("p3") ? result : clipToGamut(result);
	};
}

// ── Converge ────────────────────────────────────────────────────────────────
// Expand a method's `converge` array (iteration counts) into a family that
// alternately re-runs compute (c) and restores the original L,H (p):
//   i=1 → c    i=2 → c p c    i=3 → c p c p    i=4 → c p c p c

// Restore the original L,H onto a mapped color (chroma kept; out-of-gamut
// results are clipped by normalize downstream).
function restoreLH (mapped, original) {
	let {l, h} = original.to("oklch");
	return mapped.set({"oklch.l": l, "oklch.h": h});
}

// The color after n converge iterations (n ≥ 2; see the c/p sketch above).
function iterate (compute, color, n) {
	let result = compute(color);
	for (let k = 0; k < n; k++) {
		result = k % 2 === 0 ? restoreLH(result, color) : compute(result);
	}
	return result;
}

// Variant label: Scale, Scale LH, Scale LH 3, Scale LH 4, … (the number is i).
function label (base, i) {
	if (i === 1) {
		return base;
	}
	return i === 2 ? `${base} LH` : `${base} LH ${i}`;
}

// Variant description: base text plus what the extra iterations do.
function describe (base, i) {
	if (i === 1) {
		return base;
	}
	let rounds = Math.floor(i / 2);
	let suffix = `restore the original L and H and re-run the mapping${rounds > 1 ? ` over ${rounds} rounds` : ""}`;
	if (i % 2 === 1) {
		suffix += ", and finally restore L and H once more (chroma clipped into gamut)";
	}
	return `${base} Then ${suffix}.`;
}

// One registry entry per iteration count. Every base run is timed under the
// base id, so its totals cover the whole family.
function converge (id, method) {
	let {converge: counts, ...config} = method;
	let raw = method.compute;
	let timed = color => time(id, () => raw(color));
	return counts.map(i => {
		// `base` (the family-root id) and `iteration` make the family relationship
		// explicit, so consumers can group variants or pick one per base.
		let entry = {...config, base: id, iteration: i, label: label(method.label, i), description: describe(method.description, i)};
		if (i === 1) {
			// Iteration 1 is the base method itself: keep its id, and let mapColor
			// time it (going through `timed` here would double-count).
			return [id, {...entry, compute: normalize(raw)}];
		}
		let slug = entry.label.toLowerCase().replaceAll(" ", "-");
		return [slug, {...entry, compute: normalize(color => iterate(timed, color, i))}];
	});
}

// Build the registry: a method with a `converge` array expands into its
// iteration variants; the rest just get normalized (and tagged as their own
// single-iteration family, so grouping needs no special-casing). mapColor times
// the runs.
const entries = Object.entries(methods).flatMap(([id, method]) =>
	method.converge
		? converge(id, method)
		: [[id, { ...method, base: id, iteration: 1, compute: normalize(method.compute) }]],
);

const registry = Object.fromEntries(entries);

export default registry;

// One representative per base GMA — its highest-iteration variant — for the
// benchmark, which tests each GMA once (e.g. Scale LH 3, not Scale / Scale LH).
export const representatives = Object.fromEntries(
	Object.values(Object.entries(registry).reduce((best, [id, m]) => {
		if (!best[m.base] || m.iteration > best[m.base][1].iteration) {
			best[m.base] = [id, m];
		}
		return best;
	}, {})),
);
