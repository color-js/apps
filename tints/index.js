import { createApp } from "vue";
import "color-elements/color-picker";
import "color-elements/color-scale";

// Preset base colors offered as clickable swatches above the picker.
const swatches = {
	red: "oklch(54% 0.24 25)",
	orange: "oklch(74% 0.19 58)",
	yellow: "oklch(88% 0.2 95)",
	green: "oklch(70% 0.24 135)",
	cyan: "oklch(69% 0.15 205)",
	blue: "oklch(56% 0.24 260)",
	indigo: "oklch(50% 0.27 275)",
	purple: "oklch(57% 0.27 292)",
	magenta: "oklch(60% 0.25 10)",
	gray: "oklch(54% 0.04 250)",
};

const L = {
	90: 0.97,
	80: 0.88,
	70: 0.76,
	60: 0.66,
	50: 0.56,
	40: 0.47,
	30: 0.38,
	20: 0.3,
	10: 0.2,
};

const scaleDefs = {
	raw: {
		name: "Raw",
		getColor: (level, color) => color.set("l", L[level]),
	},
	clipped: {
		name: "Clipped (P3)",
		getColor: (level, color) => scaleDefs.raw.getColor(level, color).toGamut({ space: "p3", method: "clip" }),
	},
	mapped: {
		name: "Gamut mapped (sRGB)",
		getColor: (level, color) => {
			let l = color.get("oklch.l");
			let targetL = L[level];
			color.set("l", L[level]);
			if (targetL <= l + 0.01 && targetL >= l - 0.01) {
				return color;
			}

			return color.toGamut({ space: "srgb", method: "oklch.c" });
		},
	},
	mapped_p3: {
		name: "Gamut mapped (P3)",
		getColor: (level, color) => {
			let l = color.get("oklch.l");
			let targetL = L[level];
			color.set("l", L[level]);
			if (targetL <= l + 0.01 && targetL >= l - 0.01) {
				return color;
			}

			return color.toGamut({ space: "p3", method: "oklch.c" });
		},
	},
	oklchp3: {
		name: "Using (oklch-P3)",
		getColor: (level, color) => {
			color = color.to("oklch-p3");
			color.set("l", L[level]);
			return color.to("oklch");
		},
	},
	colormix: {
		name: "color-mix()",
		getColor: (level, color) => {
			let l = color.get("oklch.l");
			let targetL = L[level];
			let mixWith = targetL > l ? "white" : "black";
			let extremeL = targetL > l ? 1 : 0;
			let mixAmount = (targetL - l) / (extremeL - l);

			return color.mix(mixWith, mixAmount);
		},
	},

};

const params = new URLSearchParams(location.search);

// Set the base color via ?color=… (e.g. ?color=oklch(70% 0.16 205)), falling back
// to the picker's default when absent. Any CSS color the picker understands works.
const initialColor = params.get("color") || "oklch(70% 0.16 205)";

// Restrict the visible scales via ?scales=id1,id2 (e.g. for demos or sharing).
// Unknown ids are ignored; the URL order also defines display order.
let only = params.get("scales");
const scales = only
	? Object.fromEntries(
		only.split(",")
			.map(id => id.trim())
			.filter(id => id in scaleDefs)
			.map(id => [id, scaleDefs[id]]),
	)
	: scaleDefs;

globalThis.app = createApp({
	compilerOptions: {
		isCustomElement (tag) {
			return tag.startsWith("color-");
		},
	},

	data () {
		return {
			swatches,
			initialColor,
			color: null,
			darkMode: false,
			// Maps each selected scale id to its weight (0–100). Weights always sum to 100.
			// Defaults are dropped if their scale is hidden by the ?scales= URL param.
			selected: Object.fromEntries(
				Object.entries({ clipped: 50, colormix: 50 }).filter(([id]) => id in scales),
			),
		};
	},

	computed: {
		scaleEntries () {
			if (!this.color) {
				return [];
			}

			return Object.entries(scales).map(([id, scale]) => {
				let tints = {};
				let cssVars = {};

				for (let level in L) {
					tints[level] = scale.getColor(level, this.color.clone());
					cssVars["--color-" + level] = tints[level].toString();
				}

				return { id, name: scale.name, tints, cssVars };
			});
		},

		selectedScales () {
			return this.scaleEntries.filter(s => s.id in this.selected);
		},

		/** Selected weights rounded to integers summing to exactly 100. */
		normalizedWeights () {
			let ids = Object.keys(this.selected);
			let result = {};
			let assigned = 0;
			ids.forEach((id, i) => {
				let w = i === ids.length - 1 ? 100 - assigned : Math.round(this.selected[id]);
				result[id] = w;
				assigned += w;
			});
			return result;
		},

		/**
		 * Produces a combo scale by weighted-mixing the tints of all selected scales.
		 * Uses sequential weighted mixing: for colors [c1, c2, …] with weights [w1, w2, …],
		 * start with c1, mix c2 at w2/(w1+w2), mix c3 at w3/(w1+w2+w3), etc.
		 */
		comboEntry () {
			if (this.selectedScales.length < 2) {
				return null;
			}

			let nw = this.normalizedWeights;
			let contributors = this.selectedScales.filter(s => nw[s.id] > 0);

			let tints = {};
			let cssVars = {};

			for (let level in L) {
				let result = null;
				let totalWeight = 0;

				for (let scale of contributors) {
					let w = nw[scale.id];

					if (result === null) {
						result = scale.tints[level].clone();
						totalWeight = w;
					}
					else {
						totalWeight += w;
						result = result.mix(scale.tints[level], w / totalWeight);
					}
				}

				tints[level] = result;
				cssVars["--color-" + level] = result.toString();
			}

			let isEqual = new Set(this.selectedScales.map(s => nw[s.id])).size === 1;
			let name = isEqual
				? this.selectedScales.map(s => s.name).join(" + ")
				: this.selectedScales.map(s => `${nw[s.id]}% ${s.name}`).join(" + ");

			return { id: "combo", name, tints, cssVars, isCombo: true };
		},

		/** All scale entries (individual + combo) for a single v-for loop. */
		allScales () {
			if (this.comboEntry) {
				return [...this.scaleEntries, this.comboEntry];
			}
			return this.scaleEntries;
		},
	},

	methods: {
		onColorChange (e) {
			this.color = e.target.color;
		},

		// Apply a preset swatch by setting the picker's color; it then emits colorchange.
		pickSwatch (value) {
			this.$refs.input.color = value;
		},

		toggleScale (id) {
			if (id in this.selected) {
				delete this.selected[id];
				this.rescale(this.selected, 100);
			}
			else {
				let share = 100 / (Object.keys(this.selected).length + 1);
				this.rescale(this.selected, 100 - share);
				this.selected[id] = share;
			}
		},

		/** The dragged slider is authoritative; siblings rescale to fill the remainder. */
		setWeight (id, weight) {
			let { [id]: _, ...others } = this.selected;
			this.rescale(others, 100 - weight);
			Object.assign(this.selected, others, { [id]: weight });
		},

		/** Scales the values of `weights` so they sum to `target`, mutating in place. */
		rescale (weights, target) {
			let keys = Object.keys(weights);
			if (keys.length === 0) {
				return;
			}
			let sum = keys.reduce((s, k) => s + weights[k], 0);
			for (let k of keys) {
				weights[k] = sum > 0 ? weights[k] * target / sum : target / keys.length;
			}
		},
	},

	watch: {
		darkMode (value) {
			document.documentElement.style.colorScheme = value ? "dark" : "";
		},
	},
}).mount(document.body);
