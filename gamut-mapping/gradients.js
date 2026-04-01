import { createApp } from "https://unpkg.com/vue@3.2.37/dist/vue.esm-browser.js";
import Color from "https://colorjs.io/dist/color.js";
import Gradient from "./mapped-gradient.js";
import TimingInfo from "./timing-info.js";

globalThis.Color = Color;

let app = createApp({
	data () {
		let params = new URLSearchParams(location.search);
		const urlFromColor = params.get("from");
		const urlToColor = params.get("to");
		const from =  urlFromColor || "oklch(90% .4 250)";
		const to = urlToColor || "oklch(40% .1 20)";
		const methods = ["none", "clip", "scale-lh", "css", "css-rec2020", "raytrace", "raytraceRec2020", "bjorn", "bjornRec2020", "edge-seeker", "edge-seeker-rec2020", "chromium"];
		const enabledMethods = ["clip", "css-rec2020", "raytraceRec2020", "bjornRec2020", "edge-seeker-rec2020", "chromium"];
		const runResults = {};
		enabledMethods.forEach(method => runResults[method] = []);
		return {
			methods,
			enabledMethods,
			from: from,
			to: to,
			parsedFrom: this.tryParse(from),
			parsedTo: this.tryParse(to),
			space: "oklch",
			maxDeltaE: 10,
			flush: false,
			params: params,
			interpolationSpaces: ["oklch", "oklab", "p3", "rec2020", "lab"],
			runResults: runResults,
			refresh: 0,
		};
	},

	computed: {
		steps () {
			if ( !this.parsedFrom || !this.parsedTo) {
				return [];
			}
			const from = new Color(this.parsedFrom);
			let steps = from.steps(this.parsedTo, {
				maxDeltaE: this.maxDeltaE,
				space: this.space,
			});
			return steps;
		},
		oogSteps () {
			return this.steps.map(step => {
				switch (true) {
					case step.inGamut("srgb"):
						return ["in srgb", "yellowgreen"];
					case step.inGamut("p3"):
						return ["in p3", "gold"];
					case step.inGamut("rec2020"):
						return ["in rec2020", "orange"];
					default:
						return ["out of rec2020", "red"];
				}
			});
		},
	},

	methods: {
		colorChangeFrom (event) {
			this.parsedFrom = event.target.color || this.parsedFrom;
		},
		colorChangeTo (event) {
			this.parsedTo = event.target.color || this.parsedTo;
		},
		tryParse (input) {
			try {
				const color = new Color.parse(input);
				return color;
			}
			catch (error) {
				// do nothing
			}
		},
		reportTime ({time, method}) {
			this.runResults[method].push(time);
			this.runResults = {...this.runResults};
		},
	},

	watch: {
		from: {
			handler (value) {
				this.params.set("from", value);
				history.pushState(null, "", "?" + this.params.toString());
			},
			deep: true,
			immediate: true,
		},
		to: {
			handler (value) {
				this.params.set("to", value);
				history.pushState(null, "", "?" + this.params.toString());
			},
			deep: true,
			immediate: true,
		},
		enabledMethods(newValue) {
			const runResults = {};
			newValue.forEach(method => runResults[method] = []);
			this.runResults = runResults;
			this.refresh++;
		}
	},

	components: {
		"mapped-gradient": Gradient,
		"timing-info": TimingInfo,
	},
	compilerOptions: {
		isCustomElement (tag) {
			return tag === "color-swatch";
		},
	},
}).mount(document.body);

globalThis.app = app;
