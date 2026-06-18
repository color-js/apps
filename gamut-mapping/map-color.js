import Color from "colorjs.io";
import methods from "./methods.js";
import "color-elements/color-picker";

const lch = ["L", "C", "H"];
let spacesToShow = [Color.spaces.oklch, Color.spaces.p3, Color.spaces["p3-linear"]];

// Per-coordinate tolerance for the "preserves L/H" filter: 1 ppm of each
// coordinate's full range. ΔL is stored in percentage points (L range 0–100),
// ΔH in degrees (range 0–360).
const epsilon = {
	L: 100 / 1e6, // 1e-4 percentage points (= 1e-6 in 0–1 L)
	H: 360 / 1e6, // 3.6e-4°
};

export default {
	props: {
		modelValue: String,
		// Which coordinates to filter on: hide methods whose |Δ| exceeds the
		// per-coordinate epsilon for any enabled coordinate.
		hide: {
			type: Object,
			default: () => ({L: false, H: false}),
		},
		// Metric the cards are ordered by: one of "E2K", "EOK", "L", "H", or
		// "default" (methods.js definition order). Also drives the rank badges.
		sort: {
			type: String,
			default: "default",
		},
	},
	emits: ["update:modelValue"],
	data () {
		// The space the picker opens in. We seed it from the input color so the
		// picker shows the color in its own space rather than the registry's
		// first space. It's a one-time snapshot, not reactive: the display space
		// is a view concern the picker owns afterwards, so we don't fight the
		// user when they type a color whose space differs from the one on screen.
		let space;
		try {
			space = new Color(this.modelValue).space.id;
		}
		catch (e) {
			space = "oklch";
		}

		return {
			methods,
			initialSpace: space,
		};
	},

	computed: {
		colorInput: {
			get () {
				return this.modelValue;
			},
			set (value) {
				this.$emit("update:modelValue", value);
			},
		},
		/**
		 * The parsed input color, derived straight from the model value. Every
		 * downstream computation (raw coordinates, gamut-mapped variants) reads
		 * from here, so updating the model value is the single source of truth.
		 */
		color () {
			try {
				return new Color(this.modelValue);
			}
			catch (e) {
				return new Color("transparent");
			}
		},
		colorLCH () {
			return this.color.to("oklch");
		},

		spaces () {
			return spacesToShow.map(space => {
				let coordInfo = Object.entries(space.coords);
				let coords = this.color.to(space).coords.map(c => this.toPrecision(c, 3));
				return {
					name: space.name,
					coords: Object.fromEntries(coordInfo.map(([c, info], i) => [c, {value: coords[i], name: info.name, id: c}])),
				};
			});
		},

		mapped () {
			return Object.fromEntries(Object.entries(this.methods).map(([method, config]) => {
				let mappedColor = config.compute(this.color);
				let mappedColorLCH = mappedColor.to("oklch");
				let deltas = {
					E2K: this.toPrecision(this.color.deltaE(mappedColor, { method: "2000" }), 2),
					EOK: this.toPrecision(this.color.deltaE(mappedColor, { method: "OK" }), 2),
				};

				lch.forEach((c, i) => {
					let delta = mappedColorLCH.coords[i] - this.colorLCH.coords[i];

					if (c === "L") {
						// L is percentage
						delta *= 100;
					}
					else if (c === "H") {
						// Hue is angular, so we need to normalize it
						delta = ((delta % 360) + 720) % 360;
						delta = Math.min(360 - delta, delta);
					}

					delta = this.toPrecision(delta, 2);
					deltas[c] = delta;
				});

				return [method, {color: mappedColor, deltas}];
			}));
		},

		// Methods left after applying the hide filter. Rankings/minDeltas still
		// consider all methods — this is purely a display filter.
		visibleMethods () {
			return Object.fromEntries(Object.entries(this.methods).filter(([method]) => {
				let {deltas} = this.mapped[method];
				return lch.every(c => !this.hide[c] || Math.abs(deltas[c]) <= epsilon[c]);
			}));
		},

		// Visible methods in display order: definition order when sort is
		// "default", otherwise the ranked order.
		displayMethods () {
			if (this.sort === "default") {
				return this.visibleMethods;
			}

			let visible = this.visibleMethods;
			let ordered = this.ranking.filter(method => method in visible);
			return Object.fromEntries(ordered.map(method => [method, visible[method]]));
		},

		minDeltas () {
			let ret = {};
			for (let method in this.mapped) {
				let {deltas} = this.mapped[method];

				for (let c in deltas) {
					let delta = Math.abs(deltas[c]);
					let minDelta = ret[c];

					if (!minDelta || minDelta >= delta) {
						ret[c] = delta;
					}
				}
			}
			return ret;
		},

		// All methods sorted best-first by the active metric (smallest |Δ| wins),
		// ties broken by ΔEOK — or by ΔE2K when ΔEOK is itself the metric. The
		// "default" sort still ranks by ΔE2K so the badges stay meaningful.
		ranking () {
			let primary = this.sort === "default" ? "E2K" : this.sort;
			let secondary = primary === "EOK" ? "E2K" : "EOK";
			let key = (method, c) => Math.abs(this.mapped[method].deltas[c]);

			return Object.keys(this.mapped).sort((a, b) => {
				return key(a, primary) - key(b, primary) || key(a, secondary) - key(b, secondary);
			});
		},

		// Sorted unique ranks currently shown, so the top/bottom ranks can be
		// highlighted by membership — robust to ties sharing a rank.
		ranks () {
			let ranks = Object.keys(this.visibleMethods).map(method => this.rank(method));
			return [...new Set(ranks)].sort((a, b) => a - b);
		},

		// How many of the best/worst ranks to highlight: grows with the number of
		// ranks as clamp(1, floor(N/3), 3), so top and bottom never overlap.
		highlightCount () {
			return Math.max(1, Math.min(Math.floor(this.ranks.length / 3), 3));
		},

		topRanks () {
			return this.ranks.slice(0, this.highlightCount);
		},

		bottomRanks () {
			return this.ranks.slice(-this.highlightCount);
		},
	},

	methods: {
		toPrecision: Color.util.toPrecision,
		abs: Math.abs,

		// 1-based rank of a method in the active sort order.
		rank (method) {
			return this.ranking.indexOf(method) + 1;
		},

		/**
		 * Push user edits back into the model value. We listen to `input` rather
		 * than `colorchange` on purpose: the picker fires `input` only for genuine
		 * user actions (sliders, swatch field, space picker), and never for
		 * programmatic `color`/`space` sets. That breaks the data-flow loop (our
		 * own binding writing back to the picker doesn't echo) and stops the
		 * picker's setup transients from clobbering the model. Invalid/mid-typing
		 * input never re-dispatches, so `color` is always a valid color here.
		 */
		onInput (e) {
			this.colorInput = e.target.color.toString();
		},
	},

	compilerOptions: {
		isCustomElement (tag) {
			return tag === "color-swatch" || tag === "color-picker";
		},
	},

	template: `
		<section class="rendering">
			<h2>Browser rendering</h2>

			<dl class="swatches">
				<div>
					<dt>Input
						<small class="description">The color as displayed directly by the browser.</small>
					</dt>
					<dd>
						<color-picker :space.attr="initialSpace" :color="colorInput" @input="onInput" alpha></color-picker>
						<details class="space-coords">
							<summary>Raw coordinates</summary>
							<dl class="space-coords">
								<div v-for="(space, spaceIndex) of spaces">
									<dt>{{ space.name }}</dt>
									<dd>
										<dl class="coords">
											<div v-for="(info, c) of space.coords">
												<dt :title="info.name">{{ c.toUpperCase() }}</dt>
												<dd>{{ toPrecision(info.value, 3) }}</dd>
											</div>
										</dl>
									</dd>
								</div>
							</dl>
						</details>
					</dd>
				</div>
			</dl>
		</section>

		<section class="gamut-mapped">
			<h2>Gamut mapped</h2>

			<ol class="swatches">
				<li v-for="(config, method) in displayMethods" :id="'method-' + method" :data-ranking="rank(method)" :value="rank(method)" :class="{top: topRanks.includes(rank(method)), bottom: bottomRanks.includes(rank(method))}">
					<color-swatch size="large" :color="mapped[method].color"></color-swatch>
					<h3>{{ config.label ?? method[0].toUpperCase() + method.slice(1) }}</h3>
					<small v-if="config.description" class="description">{{ config.description }}</small>
					<dl class="deltas" v-if="!Object.values(mapped[method].deltas).every(d => d === 0)">
						<div v-for="(delta, c) of mapped[method].deltas" :class="'delta-' + c.toLowerCase()">
							<dt>Δ{{ c }}</dt>
							<dd :class="{
								positive: !c.startsWith('E') && delta > 0,
								negative: delta < 0,
								zero: delta === 0,
								min: minDeltas[c] === abs(delta),
							}">{{ delta }}</dd>
						</div>
					</dl>
				</li>
			</ol>
		</section>`,
};
