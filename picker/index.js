import Color from "colorjs.io";
import {createApp} from "vue";

if (!globalThis.requestIdleCallback) {
	globalThis.requestIdleCallback = globalThis.requestAnimationFrame;
}

// Color space the secondary picker defaults to, so people can convert between
// formats in real time. The primary picker is the one that drives the URL/title.
const SECONDARY_SPACE = "srgb";

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

		// Space currently shown by the primary picker (drives the URL/title).
		ret.primarySpaceId = ret.color.space.id;

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
		serialized_color () {
			return this.color.toString({precision: this.precision});
		},
	},
	methods: {
		// Handle a colorchange from either picker. `primary` is true for the main
		// picker, which is the only one allowed to change the page's space/URL/title.
		updateColor (event, primary) {
			// Ignore echoes we trigger ourselves while syncing the two pickers,
			// otherwise pushing a color into one picker would bounce straight back
			// into an infinite update loop.
			if (this._syncing) {
				return;
			}

			let newColor = event.target.color;

			if (primary && newColor.space.id !== this.primarySpaceId) {
				this.primarySpaceId = newColor.space.id;
				document.title = `${newColor.space.name} color picker`;
				let url = new URL(location);
				url.pathname = url.pathname.replace(/\/picker\/[\w-]*/, `/picker/${this.primarySpaceId}`);
				history.pushState(null, "", url.href);
			}

			this.color = newColor;
		},
	},
	watch: {
		color (newColor) {
			// Push the new color into both pickers, each converting it to its own
			// space for display. `colorchange` fires synchronously on assignment, so
			// the `_syncing` guard keeps these echoes from looping back.
			this._syncing = true;
			for (let picker of [this.$refs.picker, this.$refs.picker2]) {
				if (picker && picker.color !== newColor) {
					picker.color = newColor;
				}
			}
			this._syncing = false;

			requestIdleCallback(() => {
				localStorage.picker_color = JSON.stringify(this.color);
			});
		},
	},
	mounted () {
		this._syncing = true;

		// Set the primary picker to the active color & space.
		this.$refs.picker.spaceId = this.color.space.id;
		this.$refs.picker.color = this.color;

		// Set up the secondary picker as a synced, real-time conversion view.
		this.$refs.picker2.spaceId = SECONDARY_SPACE;
		this.$refs.picker2.color = this.color;

		// Changing the secondary picker's space re-expresses its color in a
		// deferred `updated()` (microtask), emitting a colorchange. Keep the guard
		// up until that settles so the initial conversion can't hijack the color.
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
