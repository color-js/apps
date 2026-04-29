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

// Pick the widest gamut the device claims to support. matchMedia("color-gamut: x")
// matches if the display covers x or wider, so probe from widest to narrowest.
function detectGamut () {
	if (matchMedia("(color-gamut: rec2020)").matches) {
		return "rec2020";
	}
	if (matchMedia("(color-gamut: p3)").matches) {
		return "p3";
	}
	return "srgb";
}

// Cache the most recent (L, gamut, maxC) so consecutive renders at the same L
// do no work, and so drag updates can probe outward/inward from the previous
// L's boundary. Changing the target gamut invalidates the cache entirely.
let cachedL = null;
let cachedGamut = null;
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
			dragging: false,
			// (c, h) snapshot at pointerdown, used to lock the constrained axis
			// when shift/alt is held during the drag.
			dragLockC: 0,
			dragLockH: 0,
			// When true, lifts the clip and lets the browser render OOG OKLCH
			// values natively. When false, the disc is clipped to the gamut polygon.
			paintOOG: false,
			// Target gamut for the boundary; defaults to the device's widest support.
			gamut: detectGamut(),
		};
	},

	computed: {
		/**
		 * One-way binding into <color-picker>. The picker re-emits `colorchange`
		 * whenever its `color` prop is set; `onColorChange` writes the same values
		 * back into our state, so Vue sees no diff and the loop terminates.
		 */
		pickerColor () {
			return `oklch(${this.lightness} ${this.markerC} ${this.markerH})`;
		},

		/**
		 * Per-L gamut boundary as `maxC[h]`. On a drag, the previous L's curve is a
		 * stone's throw away — `updateMaxC` walks from each prev value outward or
		 * inward until it crosses the new boundary, then refines. For a fresh L
		 * (no cache), full binary search.
		 */
		maxC () {
			const L = this.lightness;
			const gamut = this.gamut;
			if (cachedL === L && cachedGamut === gamut && cachedMaxC) {
				return cachedMaxC;
			}
			// Reuse the previous boundary as a warm start only when the target gamut
			// is unchanged; a different gamut wants a fresh full search.
			const warmStart = cachedMaxC && cachedGamut === gamut;
			const arr = warmStart ? updateMaxC(L, cachedMaxC, gamut) : computeMaxC(L, gamut);
			cachedL = L;
			cachedGamut = gamut;
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
		 * The gamut boundary as a CSS `polygon(...)` string in percentage coordinates.
		 * One vertex per hue bucket; published as `--gamut-shape` on the wheel so
		 * both the layer clip and the "auto"-mode boundary overlay can reuse the
		 * exact same shape via `clip-path: var(--gamut-shape)`.
		 */
		gamutShape () {
			const maxC = this.maxC;
			const n = maxC.length;
			const points = new Array(n);
			for (let i = 0; i < n; i++) {
				const h = (i / n) * 360;
				const r = maxC[i] / MAX_CHROMA;
				const hRad = (h * Math.PI) / 180;
				const x = 50 + r * 50 * Math.cos(hRad);
				const y = 50 - r * 50 * Math.sin(hRad); // screen y is flipped
				points[i] = `${x.toFixed(2)}% ${y.toFixed(2)}%`;
			}
			return `polygon(${points.join(", ")})`;
		},
	},

	methods: {
		onColorChange (e) {
			// Picker may be in any space; convert so our (L, C, H) state stays in oklch.
			let [l, c, h] = e.target.color.to("oklch").coords;
			this.lightness = l;
			this.markerC = c || 0;
			this.markerH = h || 0;
		},

		onPointerDown (e) {
			if (e.button !== 0) {
				return;
			}
			e.preventDefault();
			this.dragging = true;
			this.dragLockC = this.markerC;
			this.dragLockH = this.markerH;
			e.currentTarget.setPointerCapture(e.pointerId);
			this.updateMarkerFromPointer(e);
		},

		onPointerMove (e) {
			if (!this.dragging) {
				return;
			}
			this.updateMarkerFromPointer(e);
		},

		onPointerUp (e) {
			if (!this.dragging) {
				return;
			}
			this.dragging = false;
			if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
				e.currentTarget.releasePointerCapture(e.pointerId);
			}
		},

		/**
		 * Pointer → polar (c, h) on the wheel. Shift locks chroma to the value at
		 * pointerdown (drag along the ring); Alt locks hue (drag along the radius).
		 */
		updateMarkerFromPointer (e) {
			const rect = this.$refs.wheel.getBoundingClientRect();
			const radius = rect.width / 2;
			const dx = e.clientX - (rect.left + radius);
			const dy = e.clientY - (rect.top + radius);
			const r = Math.min(Math.hypot(dx, dy) / radius, 1);
			let c = r * MAX_CHROMA;
			let h = (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360;

			if (e.shiftKey) {
				c = this.dragLockC;
			}
			if (e.altKey) {
				h = this.dragLockH;
			}

			this.markerC = c;
			this.markerH = h;
		},
	},
}).mount(document.body);

/** Full binary search per hue. Used the first time we see a given (L, gamut). */
function computeMaxC (L, gamut) {
	const arr = new Float32Array(HUE_BUCKETS);
	for (let i = 0; i < HUE_BUCKETS; i++) {
		const h = (i / HUE_BUCKETS) * 360;
		let lo = 0;
		let hi = MAX_CHROMA;
		for (let iter = 0; iter < SEARCH_ITERS; iter++) {
			const mid = (lo + hi) / 2;
			if (inGamut({ space: "oklch", coords: [L, mid, h] }, gamut)) {
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
function updateMaxC (L, prevMaxC, gamut) {
	const n = prevMaxC.length;
	const arr = new Float32Array(n);

	for (let i = 0; i < n; i++) {
		const h = (i / n) * 360;
		const startC = prevMaxC[i];
		let lo;
		let hi;

		const startInGamut = inGamut({ space: "oklch", coords: [L, startC, h] }, gamut);

		if (startInGamut) {
			// Boundary is at startC or above. Walk outward.
			lo = startC;
			hi = MAX_CHROMA;
			let step = 0.005;
			while (lo + step <= MAX_CHROMA && inGamut({ space: "oklch", coords: [L, lo + step, h] }, gamut)) {
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
			while (hi - step >= 0 && !inGamut({ space: "oklch", coords: [L, hi - step, h] }, gamut)) {
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
			if (inGamut({ space: "oklch", coords: [L, mid, h] }, gamut)) {
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
