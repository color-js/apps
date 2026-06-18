// Registry of gamut mapping methods. Each method lives in its own file under
// methods/ so their relative sizes are easy to compare. A method is a config
// object with `label`, `description`, and optionally `compute`; methods without
// `compute` fall back to the built-in toGamut in map-color.js.
import clip from "./methods/clip.js";
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

export default methods;
