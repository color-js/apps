import { createApp } from "vue";
import Color from "colorjs.io";
import methods from "./methods.js";
import MapColor from "./map-color.js";

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
			// Metric the methods are ordered by; "default" keeps definition order.
			sort: "default",
			// Background switcher. `theme` is the pinned choice (null = follow
			// system); the three buttons preview the backgrounds they apply.
			theme: localStorage.getItem("theme"),
			systemDark: matchMedia("(prefers-color-scheme: dark)").matches,
			themes: [
				{id: "light", label: "Light background"},
				{id: "mid", label: "Mid-gray background"},
				{id: "dark", label: "Dark background"},
			],
		};
	},

	computed: {
		// Which button reads as active: the pinned theme, or the system default
		// when nothing is pinned yet.
		selected () {
			return this.theme ?? (this.systemDark ? "dark" : "light");
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

		// Pin the chosen background on <html> and remember it across visits.
		theme (value) {
			document.documentElement.dataset.theme = value;
			localStorage.setItem("theme", value);
		},
	},

	mounted () {
		// Keep the unpinned default in sync with the OS preference.
		matchMedia("(prefers-color-scheme: dark)").addEventListener("change", e => {
			this.systemDark = e.matches;
		});
	},

	components: {
		"map-color": MapColor,
	},
}).mount(document.body);

globalThis.app = app;
