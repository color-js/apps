export default {
	overrides: {
		imports: {
			// Workaround for https://github.com/jspm/jspm/issues/2719
			"color-elements/color-swatch": "./node_modules/color-elements/src/color-swatch/color-swatch.js",
			"color-elements/color-picker": "./node_modules/color-elements/src/color-picker/color-picker.js",
			"color-elements/color-scale": "./node_modules/color-elements/src/color-scale/color-scale.js",
			"color-elements/color-slider": "./node_modules/color-elements/src/color-slider/color-slider.js",
			"color-elements/color-swatch": "./node_modules/color-elements/src/color-swatch/color-swatch.js",
		},
	},
};
