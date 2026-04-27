import { createApp } from "vue";
import { ColorSpace, to, spaces } from "colorjs.io/fn";
import "color-elements/color-picker";

// The fn API doesn't auto-register spaces in the global ColorSpace registry —
// it leaves that to the caller so unused spaces stay tree-shakable. We need
// `oklch`, `p3-linear`, and `p3` resolvable by id, so register the lot.
for (let space of Object.values(spaces)) {
	ColorSpace.register(space);
}

const CSS_SIZE = 520;
const MAX_CHROMA = 0.4;
const PASSES = [256]; // preview pass; final pass = canvas physical size

let renderToken = 0;

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
			status: "",
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
			let [l, c, h] = e.target.color.to("oklch").coords;
			this.lightness = l;
			this.markerC = c || 0;
			this.markerH = h || 0;
		},

		/**
		 * Two-pass progressive render: a small preview, then full resolution.
		 * Cancels in-flight renders via a token so rapid lightness changes don't queue up.
		 */
		async render () {
			let myToken = ++renderToken;
			let canvas = this.$refs.canvas;
			let ctx = canvas.getContext("2d", { colorSpace: "display-p3" });
			let physical = canvas.width;
			let passes = [...PASSES, physical];

			for (let i = 0; i < passes.length; i++) {
				if (myToken !== renderToken) {
					return;
				}
				let N = passes[i];
				let img = renderPass(N, this.lightness);
				if (myToken !== renderToken) {
					return;
				}
				let off = new OffscreenCanvas(N, N);
				let octx = off.getContext("2d", { colorSpace: "display-p3" });
				octx.putImageData(img, 0, 0);
				ctx.imageSmoothingEnabled = false;
				ctx.clearRect(0, 0, physical, physical);
				ctx.drawImage(off, 0, 0, physical, physical);
				await new Promise(r => requestAnimationFrame(r));
			}
		},
	},
}).mount(document.body);

/**
 * Render one pass at N×N samples into a display-p3 ImageData.
 * Out-of-gamut pixels are filled neutral grey so the gamut boundary stays visible.
 *
 * Math is delegated to colorjs.io's declarative `to()` so this stays a Color.js demo
 * rather than a hand-rolled matrix soup.
 */
function renderPass (N, lightness) {
	let img = new ImageData(N, N, { colorSpace: "display-p3" });
	let data = img.data;
	let center = (N - 1) / 2;
	let radius = N / 2;

	const OOG = 200;
	const eps = 1e-4;

	for (let y = 0; y < N; y++) {
		let v = -((y - center) / radius);
		for (let x = 0; x < N; x++) {
			let u = (x - center) / radius;
			let r2 = u * u + v * v;
			let idx = (y * N + x) * 4;

			if (r2 > 1) {
				data[idx] = data[idx + 1] = data[idx + 2] = data[idx + 3] = 0;
				continue;
			}

			let r = Math.sqrt(r2);
			let chroma = r * MAX_CHROMA;
			let hue = (Math.atan2(v, u) * 180) / Math.PI;

			// OKLCh → linear P3 (gamut check on linear coords) → gamma-encoded P3 (display values)
			let lin = to({ space: "oklch", coords: [lightness, chroma, hue] }, "p3-linear").coords;
			let inGamut =
				lin[0] >= -eps && lin[0] <= 1 + eps
				&& lin[1] >= -eps && lin[1] <= 1 + eps
				&& lin[2] >= -eps && lin[2] <= 1 + eps;

			if (inGamut) {
				let p3 = to({ space: "p3-linear", coords: lin }, "p3").coords;
				data[idx]     = Math.round(clamp01(p3[0]) * 255);
				data[idx + 1] = Math.round(clamp01(p3[1]) * 255);
				data[idx + 2] = Math.round(clamp01(p3[2]) * 255);
				data[idx + 3] = 255;
			}
			else {
				data[idx]     = OOG;
				data[idx + 1] = OOG;
				data[idx + 2] = OOG;
				data[idx + 3] = 255;
			}
		}
	}

	return img;
}

function clamp01 (x) {
	return x < 0 ? 0 : x > 1 ? 1 : x;
}
