import "color-elements/color-picker";
import "color-elements/color-scale";

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

const scales = {
	raw: {
		name: "Raw",
		getColor: (level, color) => color.set('l', L[level])
	},
	clipped: {
		name: "Clipped (P3)",
		getColor: (level, color) => scales.raw.getColor(level, color).toGamut({space: "p3", method: "clip"})
	},
	mapped: {
		name: "Gamut mapped (sRGB)",
		getColor: (level, color) => {
			let l = color.get("oklch.l");
			let targetL = L[level];
			color.set('l', L[level]);
			if (targetL <= l + 0.01 && targetL >= l - 0.01) {
				return color;
			}

			return color.toGamut({space: "srgb", method: "oklch.c"});
		}
	},
	mapped_p3: {
		name: "Gamut mapped (P3)",
		getColor: (level, color) => {
			let l = color.get("oklch.l");
			let targetL = L[level];
			color.set('l', L[level]);
			if (targetL <= l + 0.01 && targetL >= l - 0.01) {
				return color;
			}

			return color.toGamut({space: "p3", method: "oklch.c"});
		}
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
		}
	},
	combo_raw: {
		name: "color-mix() + clipped",
		getColor: (level, color) => {
			let mapped = scales.clipped.getColor(level, color.clone());
			let mixed = scales.colormix.getColor(level, color.clone());
			return mapped.mix(mixed, 0.5);
			// return mapped;
		}
	},
	combo: {
		name: "color-mix() + gamut mapped (sRGB)",
		getColor: (level, color) => {
			let mapped = scales.mapped.getColor(level, color.clone());
			let mixed = scales.colormix.getColor(level, color.clone());
			return mapped.mix(mixed, 0.5);
		}
	},
};

let scalesContainer = document.getElementById("scales");

input.addEventListener("colorchange", e => {
	let color = input.color;

	for (let id in scales) {
		let scale = scales[id];

		if (!scale.element) {
			scalesContainer.insertAdjacentHTML("beforeend", `
				<article class="scale" id="scale_${id}">
					<h3>${scale.name}</h3>
					<color-scale space="oklch"></color-scale>
					<div class="callout">
						<div class="h2">Heading</div>
						<p>Paragraph</p>
					</div>
				</article>
			`);
			scale.container = scalesContainer.lastElementChild;
			scale.element = scale.container.querySelector("color-scale");
			scalesContainer.appendChild(scale.container);
		}

		let tints = {};
		for (let level in L) {
			tints[level] = scale.getColor(level, color.clone());
			scale.container.style.setProperty('--color-' + level, tints[level].toString());
		}
		scale.element.colors = tints;
	}
});

dark_mode.onclick = e => {
	document.documentElement.style.colorScheme = dark_mode.checked ? "dark" : "";
}
