import { createApp } from "vue";
import { ColorSpace, inGamut, spaces } from "colorjs.io/fn";
import "color-elements/color-picker";

// The fn API doesn't auto-register spaces in the global ColorSpace registry —
// it leaves that to the caller so unused spaces stay tree-shakable.
for (let space of Object.values(spaces)) {
	ColorSpace.register(space);
}

const MAX_CHROMA = 0.4;
const LAYERS = 80;             // concentric layers — chroma resolution = MAX_CHROMA / LAYERS
const HUE_BUCKETS = 360;       // 1° resolution for the gamut boundary polygon
const SEARCH_ITERS = 12;       // binary-search iterations per hue (precision ≈ MAX_CHROMA / 2^12)
const PROBE_ITERS = 6;         // refine iterations after optimistic walk

const PAINT_OPTIONS = [
	{ value: "srgb",    label: "sRGB" },
	{ value: "p3",      label: "P3" },
	{ value: "rec2020", label: "Rec2020" },
	{ value: "all",     label: "All" },
];

const SHOW_OPTIONS = [
	{ value: "srgb",     label: "sRGB" },
	{ value: "p3",       label: "P3" },
	{ value: "rec2020",  label: "Rec2020" },
	{ value: "prophoto", label: "ProPhoto" },
];

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

// Per-gamut cache: gamut → { L, maxC }. Keeping it per-gamut means switching
// between gamuts (or showing several outlines at once) doesn't invalidate
// each other's warm-start data.
const gamutCache = new Map();

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
			dragging: false,
			// (c, h) snapshot at pointerdown, used to lock the constrained axis
			// when shift/alt is held during the drag.
			dragLockC: 0,
			dragLockH: 0,
			// Single-choice: which gamut the wheel disc is clipped to. "all"
			// removes the clip and lets OOG OKLCH paint natively.
			paintGamut: detectGamut(),
			// Multi-choice: which gamut boundaries to render as overlay outlines.
			// State is preserved per-gamut even when temporarily disabled (because
			// it equals paintGamut), so toggling paintGamut restores the prior set.
			shownGamuts: {
				srgb: true,
				p3: true,
				rec2020: false,
				prophoto: false,
			},
			paintOptions: PAINT_OPTIONS,
			showOptions: SHOW_OPTIONS,
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
		 * Gamuts whose maxC we actually need this render: the paint gamut (unless
		 * "all") plus every gamut currently shown as an outline. Excluding
		 * paintGamut from the shown set is enforced by the disable rule in the UI,
		 * so an outline is never drawn redundantly over the disc edge.
		 */
		requiredGamuts () {
			const set = new Set();
			if (this.paintGamut !== "all") {
				set.add(this.paintGamut);
			}
			for (const [g, on] of Object.entries(this.shownGamuts)) {
				if (on && g !== this.paintGamut) {
					set.add(g);
				}
			}
			return [...set];
		},

		/**
		 * Map of gamut → maxC[h]. For each required gamut: reuse the cached
		 * boundary if L matches, warm-start from the cached one if not, full
		 * binary search if we've never seen this gamut.
		 */
		maxC () {
			const L = this.lightness;
			const out = {};
			for (const g of this.requiredGamuts) {
				const cached = gamutCache.get(g);
				let arr;
				if (cached && cached.L === L) {
					arr = cached.maxC;
				}
				else {
					arr = cached ? updateMaxC(L, cached.maxC, g) : computeMaxC(L, g);
					gamutCache.set(g, { L, maxC: arr });
				}
				out[g] = arr;
			}
			return out;
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
		 * Per-gamut polygon strings, exposed as CSS custom properties on the wheel
		 * wrapper. A single string per gamut serves both consumers — `clip-path`
		 * on the layer stack and `border-shape` (or fallback `clip-path`) on the
		 * matching outline element — so the shape data lives in exactly one place
		 * in the DOM per gamut.
		 */
		shapeVars () {
			const out = {};
			for (const [g, arr] of Object.entries(this.maxC)) {
				out[`--shape-${g}`] = polygonString(arr);
			}
			return out;
		},

		/**
		 * Layer clip-path. "all" mode removes the clip entirely; otherwise we
		 * point at the paint gamut's shape variable.
		 */
		layerClip () {
			return this.paintGamut === "all" ? "none" : `var(--shape-${this.paintGamut})`;
		},

		/** Outlines to render, in declaration order. */
		shownList () {
			return SHOW_OPTIONS.filter(opt => this.shownGamuts[opt.value] && opt.value !== this.paintGamut);
		},

		/**
		 * Two reference rings driven by reactive state: the outermost (max chroma
		 * the wheel covers) and the paint gamut's outermost reach at this L
		 * (skipped in "all" mode, where no single gamut is being painted). The
		 * pointer ring is a separate static element whose position is updated
		 * directly via CSS custom properties from the pointer handler.
		 */
		tickRings () {
			const out = [
				{ key: "outer", c: MAX_CHROMA },
			];
			if (this.paintGamut !== "all") {
				const arr = this.maxC[this.paintGamut];
				let max = 0;
				for (let i = 0; i < arr.length; i++) {
					if (arr[i] > max) {
						max = arr[i];
					}
				}
				out.push({ key: "gamut", c: max });
			}
			return out;
		},

	},

	mounted () {
		this.applyShapeVars(this.shapeVars);
	},

	watch: {
		shapeVars (vars) {
			this.applyShapeVars(vars);
		},
	},

	methods: {
		/**
		 * Push the gamut polygon strings straight to the wheel element via
		 * setProperty, only when they actually change. Bound through Vue's
		 * `:style` they'd get re-evaluated and diffed on every render —
		 * including every pointer move while dragging. Keys removed from the
		 * new map (gamut toggled off) are removed from the element.
		 */
		applyShapeVars (vars) {
			const wheel = this.$refs.wheel;
			if (!wheel) {
				return;
			}
			for (const opt of SHOW_OPTIONS) {
				const key = `--shape-${opt.value}`;
				if (key in vars) {
					wheel.style.setProperty(key, vars[key]);
				}
				else {
					wheel.style.removeProperty(key);
				}
			}
		},

		onColorChange (e) {
			// Picker may be in any space; convert so our (L, C, H) state stays in oklch.
			let [l, c, h] = e.target.color.to("oklch").coords;
			this.lightness = l;
			this.markerC = c || 0;
			this.markerH = h || 0;
		},

		/**
		 * Capture the pointer the moment it enters the wheel, not just on
		 * pointerdown. While captured, the browser short-circuits hit-testing
		 * and routes events straight to .wheel-wrap, so hover gets the same
		 * cheap event path that drag has via the implicit capture from
		 * setPointerCapture in onPointerDown. Released on leave so other
		 * elements (the picker controls) still receive hover normally.
		 */
		onPointerEnter (e) {
			e.currentTarget.setPointerCapture(e.pointerId);
		},

		onPointerLeave (e) {
			if (!this.dragging && e.currentTarget.hasPointerCapture?.(e.pointerId)) {
				e.currentTarget.releasePointerCapture(e.pointerId);
			}
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
			this.handlePointer(e);
		},

		onPointerMove (e) {
			this.handlePointer(e);
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
		 * Pushes the pointer's pixel offset within the wheel into CSS custom
		 * properties on the .tick-pointer element itself (not the wrapper, so
		 * other descendants reading the gamut polygon vars don't get their
		 * styles invalidated by the pointer update). Bypasses Vue so the hot
		 * pointermove path stays cheap; CSS does the geometry to position the
		 * pointer ring. Marker state (which the picker observes) is only
		 * committed while dragging — Shift locks chroma to the value at
		 * pointerdown, Alt locks hue.
		 */
		handlePointer (e) {
			const wheel = e.currentTarget;
			const rect = wheel.getBoundingClientRect();
			const radius = rect.width / 2;
			const dx = e.clientX - rect.left - radius;
			const dy = e.clientY - rect.top - radius;
			const r = Math.min(Math.hypot(dx, dy) / radius, 1);
			const c = r * MAX_CHROMA;

			const pointer = this.$refs.pointerTick;
			pointer.style.setProperty("--pointer-x", `${dx + radius}px`);
			pointer.style.setProperty("--pointer-y", `${dy + radius}px`);
			pointer.dataset.label = c.toFixed(2);

			if (this.dragging) {
				const h = (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360;
				this.markerC = e.shiftKey ? this.dragLockC : c;
				this.markerH = e.altKey ? this.dragLockH : h;
			}
		},
	},
}).mount(document.body);

/** CSS `polygon(...)` string in percentage coordinates from a maxC[h] array. */
function polygonString (maxC) {
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
}

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
