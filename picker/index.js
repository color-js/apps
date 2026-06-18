import Color from "colorjs.io";
import {createApp} from "vue";

if (!globalThis.requestIdleCallback) {
	globalThis.requestIdleCallback = globalThis.requestAnimationFrame;
}

// Widest color gamut the current screen can display.
function detectDeviceGamut () {
	if (matchMedia("(color-gamut: rec2020)").matches) {
		return "rec2020";
	}
	if (matchMedia("(color-gamut: p3)").matches) {
		return "p3";
	}
	return "srgb";
}

let app = createApp({
	data () {
		let ret = {
			color: new Color("lch", [50, 50, 50]),
			precision: 3,
		};

		if (localStorage.picker_color) {
			let o = JSON.parse(localStorage.picker_color);
			ret.color = new Color(o);
		}

		let spaceId = location.pathname.match(/\/picker\/([\w-]*)/)?.[1] || new URL(location).searchParams.get("space");

		if (spaceId && spaceId !== ret.color.space.id) {
			ret.color = ret.color.to(spaceId, {inGamut: true});
		}

		// Each picker is fixed to its own color space; they all share `color`.
		// The first picker is "primary": its space drives the page URL & title.
		ret.pickers = [{id: 0, spaceId: ret.color.space.id}];
		ret.nextId = 1;
		ret.deviceGamut = detectDeviceGamut();

		document.title = `${ret.color.space.name} color picker`;

		return ret;
	},
	computed: {
		css_color () {
			requestIdleCallback(() => {
				let serialized = encodeURIComponent(this.css_color);
				favicon.href = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" r="10" fill="${serialized}" /></svg>`;
			});

			return this.color.display({precision: this.precision}) + "";
		},
		outOfDeviceGamut () {
			return !this.color.inGamut(this.deviceGamut, {epsilon: .00005});
		},
	},
	methods: {
		pickerElements () {
			return [...document.querySelectorAll("color-picker")];
		},
		spaceName (spaceId) {
			return Color.Space.get(spaceId).name;
		},
		// One gamut warning per picker: out-of-space takes priority, and only
		// when the color *is* in this space's gamut do we fall back to flagging
		// that it's out of the screen's gamut. Empty string => no warning.
		gamutWarning (spaceId) {
			// inGamut() is always true for unbounded spaces (lab, lch, oklch…),
			// so this only flags spaces that actually have a gamut (srgb, p3…).
			if (!this.color.inGamut(spaceId, {epsilon: .00005})) {
				return `Color is out of ${this.spaceName(spaceId)} gamut`;
			}
			if (this.outOfDeviceGamut) {
				return "Color is out of device gamut";
			}
			return "";
		},
		// Handle a colorchange coming from the picker with the given id.
		updateColor (event, id) {
			// Ignore the echoes we trigger ourselves while syncing the pickers.
			if (this._syncing) {
				return;
			}

			let picker = event.target;
			let newColor = picker.color;

			// Entering a color in another space makes this picker adopt that space;
			// every other picker stays fixed to its own.
			if (newColor.space.id !== picker.spaceId) {
				picker.spaceId = newColor.space.id;
			}

			// Keep our reactive copy of this picker's space in sync (covers both
			// manual entry above and the picker's own space dropdown).
			let entry = this.pickers.find(p => p.id === id);
			if (entry && entry.spaceId !== picker.spaceId) {
				entry.spaceId = picker.spaceId;
				if (this.pickers[0] === entry) {
					this.updateLocation();
				}
			}

			this.color = newColor;
		},
		addPicker () {
			let last = this.pickers[this.pickers.length - 1];
			let spaceId = last ? last.spaceId : "srgb";
			this.pickers.push({id: this.nextId++, spaceId});

			this.$nextTick(() => {
				let els = this.pickerElements();
				let el = els[els.length - 1];
				if (!el) {
					return;
				}

				this._syncing = true;
				el.spaceId = spaceId;
				el.color = this.color.to(spaceId);
				queueMicrotask(() => {
					this._syncing = false;
				});
			});
		},
		removePicker (id) {
			if (this.pickers.length <= 1) {
				return;
			}

			let wasFirst = this.pickers[0].id === id;
			this.pickers = this.pickers.filter(p => p.id !== id);

			if (wasFirst) {
				// The new first picker becomes primary.
				this.updateLocation();
			}
		},
		updateLocation () {
			let spaceId = this.pickers[0]?.spaceId;
			if (!spaceId || spaceId === this._locationSpaceId) {
				return;
			}

			this._locationSpaceId = spaceId;
			document.title = `${Color.Space.get(spaceId).name} color picker`;
			let url = new URL(location);
			url.pathname = url.pathname.replace(/\/picker\/[\w-]*/, `/picker/${spaceId}`);
			history.pushState(null, "", url.href);
		},
	},
	watch: {
		color (newColor) {
			// Push the new color into every picker, expressed in that picker's own
			// space (so its sliders & swatch stay in its fixed space). colorchange
			// fires synchronously on assignment, so `_syncing` blocks the echoes.
			this._syncing = true;
			for (let el of this.pickerElements()) {
				el.color = newColor.to(el.spaceId);
			}
			this._syncing = false;

			requestIdleCallback(() => {
				localStorage.picker_color = JSON.stringify(this.color);
			});
		},
	},
	mounted () {
		// Re-detect the device gamut if the window moves to another display.
		for (let gamut of ["rec2020", "p3"]) {
			matchMedia(`(color-gamut: ${gamut})`).addEventListener("change", () => {
				this.deviceGamut = detectDeviceGamut();
			});
		}

		this._locationSpaceId = this.pickers[0].spaceId;

		this._syncing = true;
		let els = this.pickerElements();
		this.pickers.forEach((entry, i) => {
			let el = els[i];
			if (el) {
				el.spaceId = entry.spaceId;
				el.color = this.color.to(entry.spaceId);
			}
		});

		// Setting spaceId re-expresses the color in a deferred `updated()`
		// (microtask), emitting a colorchange. Keep the guard up until it settles.
		queueMicrotask(() => {
			this._syncing = false;
		});
	},
	compilerOptions: {
		isCustomElement (tag) {
			return tag === "color-picker";
		},
	},
}).mount("#app");

// Select text in readonly input fields when you focus them
document.addEventListener("click", evt => {
	if (evt.target.matches("input[readonly]")) {
		evt.target.select();
	}
});
