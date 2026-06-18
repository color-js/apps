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

		// The URL encodes every picker's color space (e.g. /picker/oklch+p3) so
		// the whole picker configuration can be restored on load.
		let raw = location.pathname.match(/\/picker\/([^/?#]+)/)?.[1]
			?? new URL(location).searchParams.get("space") ?? "";
		let spaceIds = raw.split(/[+ ]/).map(s => s.trim()).filter(id => {
			try { return !!Color.Space.get(id); }
			catch { return false; }
		});

		if (spaceIds.length === 0) {
			spaceIds = [ret.color.space.id];
		}

		// Each picker is fixed to its own color space; they all share `color`.
		// The first picker is "primary": the color is expressed in its space and
		// it drives the page title. `pinned` controls what a pasted color does:
		// pinned pickers convert it into their space, unpinned ones adopt the
		// pasted color's space. The primary starts unpinned, the rest start pinned.
		if (spaceIds[0] !== ret.color.space.id) {
			ret.color = ret.color.to(spaceIds[0], {inGamut: true});
		}

		ret.pickers = spaceIds.map((spaceId, i) => ({id: i, spaceId, pinned: i !== 0}));
		ret.nextId = spaceIds.length;
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
			let entry = this.pickers.find(p => p.id === id);

			// A pasted color in another space: pinned pickers convert it into their
			// own space, unpinned ones adopt the pasted color's space.
			if (newColor.space.id !== picker.spaceId) {
				if (entry?.pinned) {
					// Re-fires colorchange (now in-space), which finishes the update.
					picker.color = newColor.to(picker.spaceId);
					return;
				}
				picker.spaceId = newColor.space.id;
			}

			// Keep our reactive copy of this picker's space in sync (covers both
			// pasted colors above and the picker's own space dropdown).
			if (entry && entry.spaceId !== picker.spaceId) {
				entry.spaceId = picker.spaceId;
				this.updateLocation();
			}

			this.color = newColor;
		},
		addPicker (afterId) {
			let index = this.pickers.findIndex(p => p.id === afterId);
			let source = this.pickers[index] ?? this.pickers[this.pickers.length - 1];
			let spaceId = source ? source.spaceId : "srgb";
			let newIndex = index >= 0 ? index + 1 : this.pickers.length;
			this.pickers.splice(newIndex, 0, {id: this.nextId++, spaceId, pinned: true});
			this.updateLocation();

			this.$nextTick(() => {
				let el = this.pickerElements()[newIndex];
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

			this.pickers = this.pickers.filter(p => p.id !== id);
			this.updateLocation();
		},
		// Encode every picker's space in the URL (e.g. /picker/oklch+p3) and keep
		// the title in sync with the primary (first) picker.
		updateLocation () {
			let spaces = this.pickers.map(p => p.spaceId).join("+");
			if (spaces === this._locationSpaces) {
				return;
			}

			this._locationSpaces = spaces;

			let primary = this.pickers[0];
			if (primary) {
				document.title = `${Color.Space.get(primary.spaceId).name} color picker`;
			}

			let url = new URL(location);
			url.pathname = url.pathname.replace(/\/picker\/[^/?#]*/, `/picker/${spaces}`);
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

		this._locationSpaces = this.pickers.map(p => p.spaceId).join("+");

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
