// Registry of gamut mapping methods. Each method lives in its own file under
// methods/ so their relative sizes are easy to compare. A method is a config
// object with `label`, `description`, and a `compute` function.
import clip, { compute as clipToGamut } from "./methods/clip.js";
import css from "./methods/css.js";
import cssRec2020 from "./methods/css-rec2020.js";
import scaleLH from "./methods/scale-lh.js";
import scale from "./methods/scale.js";
import chromium from "./methods/chromium.js";
import bjorn from "./methods/bjorn.js";
import raytrace from "./methods/raytrace.js";
import edgeSeeker from "./methods/edge-seeker/index.js";
import hslClipIterative from "./methods/hsl-clip-iterative.js";

const methods = {
	"clip": clip,
	"css": css,
	"css-rec2020": cssRec2020,
	"scale-lh": scaleLH,
	"scale": scale,
	"chromium": chromium,
	"bjorn": bjorn,
	"raytrace": raytrace,
	"edge-seeker": edgeSeeker,
	"hsl-clip-iterative max 5": hslClipIterative,
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

export default Object.fromEntries(
	Object.entries(methods).map(([id, method]) => [id, { ...method, compute: normalize(method.compute) }]),
);
