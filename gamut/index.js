import { createApp } from "vue";
import { ColorSpace, inGamut, spaces } from "colorjs.io/fn";
import "color-elements/color-picker";

// The fn API doesn't auto-register spaces in the global ColorSpace registry —
// it leaves that to the caller so unused spaces stay tree-shakable.
for (let space of Object.values(spaces)) {
	ColorSpace.register(space);
}

const CSS_SIZE = 520;
const MAX_CHROMA = 0.4;
const LAYERS = 80;             // concentric layers — chroma resolution = MAX_CHROMA / LAYERS
const HUE_BUCKETS = 360;       // 1° resolution for the gamut boundary polygon
const SEARCH_ITERS = 12;       // binary-search iterations per hue (precision ≈ MAX_CHROMA / 2^12)
const PROBE_ITERS = 6;         // refine iterations after optimistic walk

// Cache the most recent (L, maxC) so consecutive renders at the same L do no work,
// and so drag updates can probe outward/inward from the previous L's boundary.
let cachedL = null;
let cachedMaxC = null;

globalThis.app = createApp({
	compilerOptions: {
		isCustomElement (tag) {
			return tag.startsWith("color-");
		},
	},

	data () {
		return {
			lightness: 0.5,
			markerC: 0.2,
			markerH: 240,
			maxChroma: MAX_CHROMA,
			cssSize: CSS_SIZE,
			chromaTicks: [0.1, 0.2, 0.3, 0.4],
		};
	},

	computed: {
		/**
		 * Per-L gamut boundary as `maxC[h]`. On a drag, the previous L's curve is a
		 * stone's throw away — `updateMaxC` walks from each prev value outward or
		 * inward until it crosses the new boundary, then refines. For a fresh L
		 * (no cache), full binary search.
		 */
		maxC () {
			const L = this.lightness;
			if (cachedL === L && cachedMaxC) {
				return cachedMaxC;
			}
			const arr = cachedMaxC ? updateMaxC(L, cachedMaxC) : computeMaxC(L);
			cachedL = L;
			cachedMaxC = arr;
			return arr;
		},

		/**
		 * LAYERS overlapping `border-radius: 50%` divs. Layer 0 is largest (c = MAX_CHROMA),
		 * painted first → bottom of stack; the inner-most layer (smallest c) sits on top.
		 * At any pixel the visible disc is the smallest that still covers it — the one whose
		 * c is just above the pixel's chroma — which gives natural radial banding without
		 * any JS per-pixel work. The conic gradient itself is a single static rule in CSS
		 * keyed off `var(--l)` and `var(--c)`, so dragging L only retriggers GPU paint.
		 */
		layers () {
			const out = [];
			for (let i = 0; i < LAYERS; i++) {
				const c = ((LAYERS - i) / LAYERS) * MAX_CHROMA;
				out.push({ idx: i, c });
			}
			return out;
		},

		/**
		 * The gamut boundary as a CSS `polygon(...)` string in percentage coordinates,
		 * to be applied as `clip-path` on the layer stack. One vertex per hue bucket;
		 * the polygon's edges are anti-aliased natively by the browser so the gamut
		 * boundary stays smooth no matter how coarse our `maxC` sampling is.
		 */
		clipPath () {
			const maxC = this.maxC;
			const n = maxC.length;
			const points = [];
			for (let i = 0; i < n; i++) {
				const h = (i / n) * 360;
				const r = maxC[i] / MAX_CHROMA;
				const hRad = (h * Math.PI) / 180;
				const x = 50 + r * 50 * Math.cos(hRad);
				const y = 50 - r * 50 * Math.sin(hRad); // screen y is flipped
				points.push(`${x.toFixed(2)}% ${y.toFixed(2)}%`);
			}
			return `polygon(${points.join(", ")})`;
		},
	},

	methods: {
		onColorChange (e) {
			let [l, c, h] = e.target.color.coords;
			this.lightness = l;
			this.markerC = c || 0;
			this.markerH = h || 0;
		},
	},
}).mount(document.body);

/** Full binary search per hue. Used the first time we see a given L. */
function computeMaxC (L) {
	const arr = new Float32Array(HUE_BUCKETS);
	for (let i = 0; i < HUE_BUCKETS; i++) {
		const h = (i / HUE_BUCKETS) * 360;
		let lo = 0;
		let hi = MAX_CHROMA;
		for (let iter = 0; iter < SEARCH_ITERS; iter++) {
			const mid = (lo + hi) / 2;
			if (inGamut({ space: "oklch", coords: [L, mid, h] }, "p3")) {
				lo = mid;
			}
			else {
				hi = mid;
			}
		}
		arr[i] = lo;
	}
	return arr;
}

/**
 * Optimistic incremental update: probe each hue starting from the previous L's
 * `maxC[h]` and walk outward (if still in gamut at the new L) or inward (if not),
 * doubling the step each time, until the boundary is straddled. Then refine with
 * a few binary-search iterations. For small ΔL each hue takes ~3–7 inGamut calls
 * instead of SEARCH_ITERS (12).
 */
function updateMaxC (L, prevMaxC) {
	const n = prevMaxC.length;
	const arr = new Float32Array(n);

	for (let i = 0; i < n; i++) {
		const h = (i / n) * 360;
		const startC = prevMaxC[i];
		let lo;
		let hi;

		const startInGamut = inGamut({ space: "oklch", coords: [L, startC, h] }, "p3");

		if (startInGamut) {
			// Boundary is at startC or above. Walk outward.
			lo = startC;
			hi = MAX_CHROMA;
			let step = 0.005;
			while (lo + step <= MAX_CHROMA && inGamut({ space: "oklch", coords: [L, lo + step, h] }, "p3")) {
				lo += step;
				step *= 2;
			}
			hi = Math.min(MAX_CHROMA, lo + step);
			if (lo >= MAX_CHROMA - 1e-6) {
				arr[i] = MAX_CHROMA;
				continue;
			}
		}
		else {
			// Boundary is below startC. Walk inward.
			hi = startC;
			lo = 0;
			let step = 0.005;
			while (hi - step >= 0 && !inGamut({ space: "oklch", coords: [L, hi - step, h] }, "p3")) {
				hi -= step;
				step *= 2;
			}
			lo = Math.max(0, hi - step);
			if (hi <= 1e-6) {
				arr[i] = 0;
				continue;
			}
		}

		// Refine the bracket [lo, hi] with binary search.
		for (let iter = 0; iter < PROBE_ITERS; iter++) {
			const mid = (lo + hi) / 2;
			if (inGamut({ space: "oklch", coords: [L, mid, h] }, "p3")) {
				lo = mid;
			}
			else {
				hi = mid;
			}
		}
		arr[i] = lo;
	}

	return arr;
}
