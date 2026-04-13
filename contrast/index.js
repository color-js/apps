import { createApp } from "vue";
import "color-elements/color-picker";
import Color from "colorjs.io";

/**
 * Composite a foreground color over an opaque background using alpha blending.
 * Blends in gamma-encoded sRGB to match default browser compositing behavior
 * (CSS color-interpolation defaults to sRGB, not linearRGB).
 * Returns a new opaque Color in sRGB.
 */
function compositeOver (fg, bg) {
	let a = fg.alpha;

	if (a >= 1) {
		return fg.to("srgb").set("alpha", 1);
	}

	let fgSRGB = fg.to("srgb");
	let bgSRGB = bg.to("srgb");
	let coords = fgSRGB.coords.map((fc, i) => {
		return (fc || 0) * a + (bgSRGB.coords[i] || 0) * (1 - a);
	});
	return new Color("srgb", coords);
}

/**
 * Resolve a pair of possibly semi-transparent colors into opaque pairs
 * suitable for contrast calculation. If the background is semi-transparent,
 * returns two scenarios (over black and over white) to show a range.
 */
function resolveColors (textColor, bgColor) {
	if (bgColor.alpha >= 1) {
		// Opaque background — composite text over it if needed
		let text = textColor.alpha < 1
			? compositeOver(textColor, bgColor)
			: textColor;
		return { pairs: [{ text, bg: bgColor }] };
	}

	// Semi-transparent background: test over black and white extremes
	let black = new Color("srgb", [0, 0, 0]);
	let white = new Color("srgb", [1, 1, 1]);

	let bgOnBlack = compositeOver(bgColor, black);
	let bgOnWhite = compositeOver(bgColor, white);

	let textOnBlack = compositeOver(textColor, bgOnBlack);
	let textOnWhite = compositeOver(textColor, bgOnWhite);

	return {
		pairs: [
			{ text: textOnBlack, bg: bgOnBlack },
			{ text: textOnWhite, bg: bgOnWhite },
		],
		isRange: true,
	};
}

const WCAG_LEVELS = [
	{ id: "aaa", label: "AAA", min: 7, description: "Enhanced (all text)" },
	{ id: "aa", label: "AA", min: 4.5, description: "Minimum (all text)" },
	{ id: "aa-large", label: "AA Large", min: 3, description: "Large text only (≥18pt / 14pt bold)" },
];

const APCA_LEVELS = [
	{ min: 90, label: "Preferred body text", font: "≥14px" },
	{ min: 75, label: "Body text", font: "≥18px" },
	{ min: 60, label: "Large / bold text", font: "≥24px / ≥18px bold" },
	{ min: 45, label: "Larger text, non-text UI", font: "≥36px" },
	{ min: 30, label: "Non-essential text", font: "" },
];

globalThis.app = createApp({
	compilerOptions: {
		isCustomElement (tag) {
			return tag.startsWith("color-");
		},
	},

	data () {
		return {
			textColor: null,
			bgColor: null,
		};
	},

	computed: {
		hasAlpha () {
			if (!this.textColor || !this.bgColor) {
				return false;
			}
			return this.textColor.alpha < 1 || this.bgColor.alpha < 1;
		},

		bgIsTranslucent () {
			return this.bgColor && this.bgColor.alpha < 1;
		},

		resolved () {
			if (!this.textColor || !this.bgColor) {
				return null;
			}
			return resolveColors(this.textColor, this.bgColor);
		},

		wcag () {
			if (!this.resolved) {
				return null;
			}

			let ratios = this.resolved.pairs.map(({ text, bg }) => text.contrast(bg, "WCAG21"));
			let min = Math.min(...ratios);
			let max = Math.max(...ratios);
			let isRange = this.resolved.isRange;

			let levels = WCAG_LEVELS.map(level => {
				let pass = min >= level.min;
				let partial = isRange && !pass && max >= level.min;
				let pct = partial ? Math.round((max - level.min) / (max - min) * 100) : null;
				return { ...level, pass, partial, pct };
			});

			let highestLevel = levels.find(l => l.pass)?.id ?? "fail";

			return {
				ratio: isRange ? { min, max } : { value: min },
				levels,
				isRange,
				highestLevel,
			};
		},

		wcagDisplay () {
			if (!this.wcag) {
				return "";
			}
			let r = this.wcag.ratio;
			if (r.value !== undefined) {
				return r.value.toFixed(2) + " : 1";
			}
			return r.min.toFixed(2) + " – " + r.max.toFixed(2) + " : 1";
		},

		apca () {
			if (!this.resolved) {
				return null;
			}

			// APCA is asymmetric: bg.contrast(text, "APCA") matches contrastAPCA(bg, text)
			let values = this.resolved.pairs.map(({ text, bg }) => Math.abs(bg.contrast(text, "APCA")));
			let min = Math.min(...values);
			let max = Math.max(...values);
			let isRange = this.resolved.isRange;

			let levels = APCA_LEVELS.map(level => {
				let pass = min >= level.min;
				let partial = isRange && !pass && max >= level.min;
				let pct = partial ? Math.round((max - level.min) / (max - min) * 100) : null;
				return { ...level, pass, partial, pct };
			});

			return {
				value: isRange ? { min, max } : { value: min },
				levels,
				isRange,
			};
		},

		apcaDisplay () {
			if (!this.apca) {
				return "";
			}
			let v = this.apca.value;
			if (v.value !== undefined) {
				return "Lc " + v.value.toFixed(1);
			}
			return "Lc " + v.min.toFixed(1) + " – " + v.max.toFixed(1);
		},

		previewStyle () {
			if (!this.textColor || !this.bgColor) {
				return {};
			}
			return {
				color: this.textColor.display(),
				backgroundColor: this.bgColor.display(),
			};
		},

		/**
		 * Maps the highest passing WCAG level to a color
		 * for the result indicator, from red (fail) to green (AAA).
		 */
		wcagIndicator () {
			if (!this.wcag) {
				return "";
			}
			switch (this.wcag.highestLevel) {
				case "aaa": return "oklch(72% 0.19 145)";
				case "aa": return "oklch(80% 0.14 95)";
				case "aa-large": return "oklch(75% 0.15 65)";
				default: return "oklch(63% 0.22 27)";
			}
		},

		/** Maps the highest passing APCA level to a color. */
		apcaIndicator () {
			if (!this.apca) {
				return "";
			}
			let best = this.apca.levels.find(l => l.pass);
			if (!best) {
				return "oklch(63% 0.22 27)";
			}
			if (best.min >= 75) {
				return "oklch(72% 0.19 145)";
			}
			if (best.min >= 60) {
				return "oklch(80% 0.14 95)";
			}
			return "oklch(75% 0.15 65)";
		},
	},

	mounted () {
		// Read initial colors from the picker elements in case
		// colorchange fired before Vue compiled the template
		this.textColor ??= this.$refs.textPicker?.color;
		this.bgColor ??= this.$refs.bgPicker?.color;
	},

	methods: {
		onTextColorChange (e) {
			this.textColor = e.target.color;
		},

		onBgColorChange (e) {
			this.bgColor = e.target.color;
		},

		swap () {
			[this.textColor, this.bgColor] = [this.bgColor, this.textColor];
			this.$refs.textPicker.color = this.textColor;
			this.$refs.bgPicker.color = this.bgColor;
		},
	},
}).mount(document.body);
