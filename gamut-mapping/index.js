import { createApp } from "vue";
import Color from "colorjs.io";
import methods from "./methods.js";
import MapColor from "./map-color.js";
import { defaultWeights } from "./map.js";
import stats from "./stats.js";

globalThis.Color = Color;

const favicon = document.querySelector('link[rel="shortcut icon"]');

let app = createApp({
	data () {
		let params = new URLSearchParams(location.search);
		let urlColors = params.getAll("color").filter(Boolean);
		let defaultValue = "oklch(90% 0.4 255)";
		let colors = urlColors.length > 0 ? urlColors : [defaultValue];

		return {
			colors,
			defaultValue,
			methods,
			params,
			Color,
			lch: ["L", "C", "H"],

			// Filter: hide gamut-mapping methods that don't preserve L resp. H.
			hide: {L: false, H: false},

			// Metric the methods are ordered by.
			sort: "error",

			// Per-axis weights for the Error metric, live-editable via the formula
			// in the header. Copied so edits stay local to this app instance.
			errorWeights: {...defaultWeights},

			// Background switcher. `theme` is the user's choice; "auto" (the
			// default) derives the background from the first color's lightness.
			theme: localStorage.getItem("theme") ?? "auto",
			themes: [
				{id: "auto", label: "Auto background (match color lightness)"},
				{id: "light", label: "Light background"},
				{id: "mid", label: "Mid-gray background"},
				{id: "dark", label: "Dark background"},
			],
		};
	},

	// Share the Error weights with every <map-color> without prop-drilling. We
	// only ever mutate the object's properties (never reassign it), so injecting
	// the reactive object directly stays reactive.
	provide () {
		return {
			errorWeights: this.errorWeights,
		};
	},

	computed: {
		// The background actually applied to the page. When the user picks
		// "auto", we choose one of the three backgrounds from the first color's
		// lightness so colors sit on a matching surround: light colors on a light
		// page, dark colors on a dark one, mid colors on mid gray.
		background () {
			if (this.theme !== "auto") {
				return this.theme;
			}

			let L = this.firstLightness;
			if (L === null) {
				return "mid";
			}

			return L > 2 / 3 ? "light" : L > 1 / 3 ? "mid" : "dark";
		},

		// Running total of colors gamut mapped across all cards, for the footer.
		totalColors () {
			return stats.totalColors;
		},

		// OKLch lightness (0–1) of the first color, or null if unparseable.
		firstLightness () {
			try {
				return new Color(this.colors[0]).oklch.l;
			}
			catch {
				return null;
			}
		},
	},

	methods: {
		toPrecision: Color.util.toPrecision,
		abs: Math.abs,
	},

	watch: {
		colors: {
			handler (value) {
				// Update URL to create a permalink
				let hadColor = this.params.has("color");
				this.params.delete("color");
				let colors = value.filter(c => c && c !== this.defaultValue);

				if (colors.length > 0) {
					colors.forEach(c => this.params.append("color", c));
				}

				history[hadColor == this.params.has("color") ? "replaceState" : "pushState"](null, "", "?" + this.params.toString());

				// Update favicon
				let rects = colors.map((c, i) => `<rect y="${ i * 100 / colors.length }%" width="100%" height="${ 100 / colors.length }%" fill="${ encodeURIComponent(c) }" />`);
				favicon.href = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg">${ rects }</svg>`;

				// Update title
				document.title = value.join(", ") + " • Gamut Mapping Playground";
			},
			immediate: true,
			deep: true,
		},

		// Remember the user's choice across visits.
		theme (value) {
			localStorage.setItem("theme", value);
		},

		// Apply the resolved background to <html> (immediately on mount too, so
		// auto picks up the first color's lightness right away).
		background: {
			handler (value) {
				document.documentElement.dataset.theme = value;
			},
			immediate: true,
		},
	},

	components: {
		"map-color": MapColor,
	},
});

// color-swatch and color-picker register themselves asynchronously (their
// define() awaits dependencies before customElements.define). If we mount before
// they're upgraded, Vue's first patch sets :color — a Color *object* — as an
// attribute instead of a property, and the swatch (color reflects from property
// only) ignores it, so swatches stay blank until a re-render re-patches them.
// createApp() doesn't render — only mount() does — so we gate just the mount on
// the elements being defined. Done with .then() rather than top-level await to
// steer clear of WebKit bug 242740 (TLA mishandled under concurrent imports).
Promise.all([
	customElements.whenDefined("color-swatch"),
	customElements.whenDefined("color-picker"),
]).then(() => {
	globalThis.app = app.mount(document.body);
});
