import Color from "https://colorjs.io/color.js";
import "https://elements.colorjs.io/src/color-picker/color-picker.js";
import {createApp} from "https://unpkg.com/vue@3.2.37/dist/vue.esm-browser.prod.js";

if (!globalThis.requestIdleCallback) {
	globalThis.requestIdleCallback = globalThis.requestAnimationFrame;
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
		color_srgb () {
			return this.color.to("srgb");
		},
		serialized_color () {
			return this.color.toString({precision: this.precision});
		},
		serialized_color_srgb () {
			return this.color_srgb.toString({precision: this.precision});
		},
		serialized_color_srgb_oog () {
			return this.color_srgb.toString({precision: this.precision, inGamut: false});
		},
	},
	watch: {
		color (newColor, oldColor) {
			let newSpaceId = newColor.space.id;
			let oldSpaceId = oldColor.space.id;

			if (newSpaceId != oldSpaceId) {
				document.title = `${newColor.space.name} color picker`;
				let url = new URL(location);
				url.pathname = url.pathname.replace(/\/picker\/[\w-]*/, `/picker/${newSpaceId}`);
				history.pushState(null, "", url.href);
			}

			requestIdleCallback(() => {
				localStorage.picker_color = JSON.stringify(this.color);
			});
		},
	},
	mounted () {
		// Set <color-picker>'s initial values
		this.$refs.picker.spaceId = this.color.space.id;
		this.$refs.picker.color = this.color;
	},
	compilerOptions: {
		isCustomElement (tag) {
			return tag === "color-picker";
		},
	},
}).mount("#app");

window.CSS_color_to_LCH = function CSS_color_to_LCH (str) {
	str = str || prompt("Enter any CSS color");

	if (!str) {
		return;
	}

	try {
		app.$refs.picker.color = new Color(str).to(app.color.space);
	}
	catch (e) {
		alert(e.message);
		return;
	}
};

// Select text in readonly input fields when you focus them
document.addEventListener("click", evt => {
	if (evt.target.matches("input[readonly]")) {
		evt.target.select();
	}
});

Promise.allSettled([
	customElements.whenDefined("color-picker"),
	customElements.whenDefined("space-picker"),
	customElements.whenDefined("channel-slider"),
	customElements.whenDefined("color-swatch"),
]).then(() => {
	// All components are registered now!
	// Add the `ready` class so the UI fades in.
	// Credit: https://www.abeautifulsite.net/posts/flash-of-undefined-custom-elements/
	document.body.classList.add("ready");
});
