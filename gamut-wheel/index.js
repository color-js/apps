import { createApp } from "vue";
import { ColorSpace, inGamut, spaces } from "colorjs.io/fn";
import "color-elements/color-picker";

// The fn API doesn't auto-register spaces in the global ColorSpace registry —
// it leaves that to the caller so unused spaces stay tree-shakable. We need
// `oklch` (for inGamut input) and `p3` (for the gamut check) resolvable by id.
for (let space of Object.values(spaces)) {
	ColorSpace.register(space);
}

const CSS_SIZE = 520;
const MAX_CHROMA = 0.4;
const HUE_BUCKETS = 720;        // resolution of the per-L gamut boundary
const SEARCH_ITERS = 12;        // binary-search iterations per hue (precision ≈ MAX_CHROMA / 2^12)
const PASSES = [32, 64, 128, 256]; // each pass renders an N×N rect grid; pass k+1 is 2× pass k
const CELLS_PER_CHUNK = 4000;   // yield rAF after this many cells, for cancel responsiveness

let renderToken = 0;

// Cache the last computed maxC per L — same L = no work to redo.
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
		};
	},

	computed: {
		chromaTicks () {
			let radius = CSS_SIZE / 2;
			return [0.1, 0.2, 0.3, 0.4].map(value => ({
				value,
				radius: (value / MAX_CHROMA) * radius,
			}));
		},

		markerPos () {
			let r = Math.min(this.markerC / MAX_CHROMA, 1) * (CSS_SIZE / 2);
			let hRad = (this.markerH * Math.PI) / 180;
			return {
				x: r * Math.cos(hRad),
				y: -r * Math.sin(hRad),
			};
		},

		markerColor () {
			return `oklch(${this.lightness} ${this.markerC} ${this.markerH})`;
		},
	},

	mounted () {
		let dpr = window.devicePixelRatio || 1;
		let physical = Math.round(CSS_SIZE * dpr);
		this.$refs.canvas.width = physical;
		this.$refs.canvas.height = physical;
		this.$refs.canvas.style.width = CSS_SIZE + "px";
		this.$refs.canvas.style.height = CSS_SIZE + "px";
		this.render();
	},

	watch: {
		lightness () {
			this.render();
		},
	},

	methods: {
		onColorChange (e) {
			let [l, c, h] = e.target.color.coords;
			this.lightness = l;
			this.markerC = c || 0;
			this.markerH = h || 0;
		},

		/**
		 * Render strategy:
		 *
		 * 1. For the current L, compute (or reuse cached) `maxC[h]` — the largest in-P3
		 *    chroma at each of HUE_BUCKETS sampled hues. Build a closed polygon along
		 *    that curve as a Path2D — this is the gamut boundary.
		 *
		 * 2. Render progressive rect-grid passes (32², 64², 128², 256²) directly to the
		 *    display canvas. Cell color = the top-left corner's `oklab(L a b)` — so each
		 *    finer pass's (even, even) cells reuse the parent pass's color and can be
		 *    skipped (the 3/4 trick). Opaque colors mean we just overdraw, no swap.
		 *
		 * 3. In-gamut cells fillRect immediately. OOG cells (top-left outside the polygon
		 *    or outside the chroma disk) accumulate into a Path2D. At pass end:
		 *      a. destination-out fill the OOG path → clears stale paint from coarser passes
		 *      b. destination-out fill (canvas-rect ∪ boundary, even-odd) → trims the cell-
		 *         resolution stairstep along the gamut boundary to sub-pixel anti-aliasing.
		 *    Composite mode reset to source-over right after.
		 *
		 * Cancellation: between chunks (~CELLS_PER_CHUNK cells) we yield rAF and check the
		 * render token. A new L abandons the in-flight pass within ~one frame.
		 */
		async render () {
			const myToken = ++renderToken;
			const canvas = this.$refs.canvas;
			const ctx = canvas.getContext("2d", { colorSpace: "display-p3" });
			const N = canvas.width;
			const cx = N / 2;
			const cy = N / 2;
			const R = N / 2;
			const L = this.lightness;

			// 1. Per-L gamut boundary: maxC[h], cached across renders at the same L.
			let maxC;
			if (cachedL === L && cachedMaxC) {
				maxC = cachedMaxC;
			}
			else {
				maxC = computeMaxC(L);
				if (myToken !== renderToken) {
					return;
				}
				cachedL = L;
				cachedMaxC = maxC;
			}

			// "Outside the gamut polygon, inside the canvas." Even-odd fill rule on
			// {full-canvas-rect ∪ boundary-polygon} gives us exactly that region.
			const outsidePath = new Path2D();
			outsidePath.rect(0, 0, N, N);
			tracePolygonInto(outsidePath, maxC, cx, cy, R);

			// 2. Progressive rect-grid passes.
			for (let passIdx = 0; passIdx < PASSES.length; passIdx++) {
				if (myToken !== renderToken) {
					return;
				}

				const grid = PASSES[passIdx];
				const cellSize = N / grid;
				const isFirstPass = passIdx === 0;
				const oogPath = new Path2D();
				let chunk = 0;

				for (let j = 0; j < grid; j++) {
					if (myToken !== renderToken) {
						return;
					}
					const yPx = j * cellSize;
					const v = -(yPx - cy) / R;
					const b = v * MAX_CHROMA;

					for (let i = 0; i < grid; i++) {
						// (even, even) cells share their top-left with the previous pass —
						// already painted there with the same color, skip.
						if (!isFirstPass && (i & 1) === 0 && (j & 1) === 0) {
							continue;
						}

						const xPx = i * cellSize;
						const u = (xPx - cx) / R;
						const a = u * MAX_CHROMA;
						const r2 = u * u + v * v;

						let inside = false;
						if (r2 <= 1) {
							const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
							const cMax = maxCAtHue(maxC, h);
							if (r2 * MAX_CHROMA * MAX_CHROMA <= cMax * cMax) {
								inside = true;
							}
						}

						if (inside) {
							ctx.fillStyle = `oklab(${L} ${a} ${b})`;
							ctx.fillRect(xPx, yPx, cellSize, cellSize);
						}
						else {
							oogPath.rect(xPx, yPx, cellSize, cellSize);
						}

						if (++chunk >= CELLS_PER_CHUNK) {
							await frame();
							if (myToken !== renderToken) {
								return;
							}
							chunk = 0;
						}
					}
				}

				// 3. End of pass: clear stale OOG cells, then sub-pixel-trim the boundary.
				ctx.globalCompositeOperation = "destination-out";
				ctx.fillStyle = "black";
				ctx.fill(oogPath);
				ctx.fill(outsidePath, "evenodd");
				ctx.globalCompositeOperation = "source-over";
			}
		},
	},
}).mount(document.body);

function frame () {
	return new Promise(r => requestAnimationFrame(r));
}

/**
 * For a given lightness, find the largest in-P3 chroma at each of HUE_BUCKETS hues
 * via binary search on `inGamut`. Returns a Float32Array indexed 0..HUE_BUCKETS-1
 * (with `maxCAtHue` interpolating + wrapping at 360°).
 */
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

function maxCAtHue (maxC, h) {
	let f = (h / 360) * HUE_BUCKETS;
	f = ((f % HUE_BUCKETS) + HUE_BUCKETS) % HUE_BUCKETS;
	const i0 = Math.floor(f) % HUE_BUCKETS;
	const i1 = (i0 + 1) % HUE_BUCKETS;
	const t = f - Math.floor(f);
	return maxC[i0] * (1 - t) + maxC[i1] * t;
}

/** Add the gamut boundary polygon (closed) as a subpath into `path`. */
function tracePolygonInto (path, maxC, cx, cy, R) {
	const n = maxC.length;
	for (let i = 0; i < n; i++) {
		const h = (i / n) * 360;
		const c = maxC[i];
		// Canvas y is down; our hue convention is math-CCW (0° at right, 90° at top),
		// so screen-angle = -h.
		const angle = (-h * Math.PI) / 180;
		const radius = (c / MAX_CHROMA) * R;
		const x = cx + radius * Math.cos(angle);
		const y = cy + radius * Math.sin(angle);
		if (i === 0) {
			path.moveTo(x, y);
		}
		else {
			path.lineTo(x, y);
		}
	}
	path.closePath();
}
