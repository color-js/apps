import { createApp, markRaw } from "vue";
import Color from "colorjs.io";
import "color-elements/color-picker";
import "color-elements/space-picker";
import "color-elements/color-swatch";

globalThis.Color = Color;

// Cube edge length in px. Must match --size in style.css; used to locate the black
// corner that the rotation pivots around.
const SIZE = 300;

// Translation that moves the cube's black corner (0,0,0) to the rotation origin.
// Wrapping a rotation as pivot · R · pivot⁻¹ turns the cube around an axis through
// that corner instead of around the cube's center.
function blackCornerPivot () {
	let h = SIZE / 2;
	return new DOMMatrix().translate(-h, h, -h);
}

// The RGB working spaces the cube can plot. These are exactly the spaces whose
// coordinates are an RGB triad, so a unit cube is a faithful diagram of them.
const RGB_SPACES = ["srgb", "srgb-linear", "p3", "a98rgb", "prophoto", "rec2020"];

let app = createApp({
	data () {
		return {
			// The single source of truth: a list of color values (any CSS color).
			// Both the cube dots and the editor pickers are views of this list.
			colors: ["red", "lime", "blue"],

			// The cube's coordinate space. Colors are positioned by their channels
			// in this space, so switching it re-plots every dot.
			space: "srgb",

			// The cube's full transform, accumulated. Each rotation slider jogs the cube
			// around its color axis — the line through the black corner (0,0,0) in the
			// cube's current frame — by post-multiplying a pivoted rotation. So the
			// color axis stays pinned and the cube turns around it, instead of spinning
			// about its center (which is all absolute Euler angles can offer).
			orientation: markRaw(blackCornerPivot().rotateAxisAngle(1, 0, 0, -24).rotateAxisAngle(0, 1, 0, 36).translate(SIZE / 2, -SIZE / 2, SIZE / 2)),

			// Each rotation slider is a relative jog: track its last value to apply
			// deltas, and spring it back to 0 on release.
			lastRot: { r: 0, g: 0, b: 0 },
		};
	},

	computed: {
		// id → Space, limited to the RGB working spaces, for the <space-picker>.
		rgbSpaces () {
			return Object.fromEntries(RGB_SPACES.map(id => [id, Color.Space.get(id)]));
		},

		// The cube's 12 wireframe edges. Each connects two corners that differ in one
		// channel, so we draw it as a gradient between those two corner colors — making
		// the wireframe itself the color interpolation. Corners are expressed in the
		// cube's current space, so the gradients track the space.
		edges () {
			let space = Color.Space.get(this.space);
			let cssSpace = space.cssId ?? space.id;
			let corner = (r, g, b) => `color(${cssSpace} ${r} ${g} ${b})`;

			let edges = [];
			// The four parallel edges along each axis sit at the 2×2 combinations of
			// the other two channels (each 0 or 1). `--p*` are the fixed channels; the
			// gradient runs from the 0 end (`--c0`) to the 1 end (`--c1`).
			for (let [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
				edges.push(
					{ axis: "r", style: { "--pg": u, "--pb": v, "--c0": corner(0, u, v), "--c1": corner(1, u, v) } },
					{ axis: "g", style: { "--pr": u, "--pb": v, "--c0": corner(u, 0, v), "--c1": corner(u, 1, v) } },
					{ axis: "b", style: { "--pr": u, "--pg": v, "--c0": corner(u, v, 0), "--c1": corner(u, v, 1) } },
				);
			}
			return edges;
		},

		// The cube's accumulated transform, plus the billboard for points/labels. The
		// transform carries the pivoted rotations (so it has a translation component);
		// the billboard is the inverse of just its rotation part, so points/labels face
		// the camera while still following the cube's pinned-corner motion.
		cubeStyle () {
			let space = Color.Space.get(this.space);
			let M = this.orientation;
			// Rotation part of M (translation zeroed) → billboard is its inverse.
			let rotation = new DOMMatrix(M.toString());
			rotation.m41 = rotation.m42 = rotation.m43 = 0;
			return {
				transform: M.toString(),
				"--billboard": rotation.inverse().toString(),
				// The CSS color() keyword for the current space, so the axes can draw
				// their black→primary gradients with the space's actual primaries.
				"--space-css": space.cssId ?? space.id,
			};
		},

		// Each color's coordinates in the cube's space, ready to plot. Invalid or
		// unparseable colors drop out (filtered to null). Out-of-gamut colors keep
		// coordinates outside [0,1], so their dot lands outside the wireframe.
		points () {
			let space = this.space;
			return this.colors
				.map((value, i) => {
					try {
						let coords = new Color(value).to(space).coords;
						if (coords.some(c => Number.isNaN(c))) {
							return null;
						}
						return { value, i, coords };
					}
					catch (e) {
						return null;
					}
				})
				.filter(Boolean);
		},
	},

	methods: {
		// Turn the cube around a color axis — the line through the black corner along
		// the cube's local x/y/z — by the slider's delta since the last input. Post-
		// multiplying a corner-pivoted rotation keeps that axis pinned in place.
		rotate (axis, value) {
			let delta = value - this.lastRot[axis];
			this.lastRot[axis] = value;
			let [x, y, z] = { r: [1, 0, 0], g: [0, 1, 0], b: [0, 0, 1] }[axis];
			let h = SIZE / 2;
			let jog = blackCornerPivot().rotateAxisAngle(x, y, z, delta).translate(h, -h, h);
			this.orientation = markRaw(this.orientation.multiply(jog));
		},

		// Spring a rotation slider back to center when released, ready for the next jog.
		resetRotation (axis, event) {
			this.lastRot[axis] = 0;
			event.target.value = 0;
		},

		// Add a fresh color, nudging the hue each time so successive adds differ.
		addColor () {
			let hue = (this.colors.length * 60) % 360;
			this.colors.push(`oklch(70% 0.15 ${hue})`);
		},

		// Push a picker edit back into the model. We listen to `input` (genuine user
		// actions only), never `colorchange`, so our own binding writing back to the
		// picker doesn't echo into an infinite loop. See the gamut-mapping app for the
		// same rationale.
		onPickerInput (i, event) {
			this.colors[i] = event.target.color.toString();
		},
	},
});

// The color-elements web components are custom elements, not Vue components.
app.config.compilerOptions.isCustomElement = tag =>
	tag === "color-swatch" || tag === "color-picker" || tag === "space-picker";

app.mount("#app");
