import Color from "colorjs.io";
import methods from "./methods.js";
import stats, { mapColor, average, MIN_RUNS } from "./map.js";
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
		// Metric the cards are ordered by: one of "error", "E2K", "EOK", "L", or
		// "H". Also drives the rank badges.
		sort: {
			type: String,
			default: "error",
		},
	},
	emits: ["update:modelValue"],
	// Per-axis weights for the Error metric (a weighted sum of the absolute OKLCh
	// deltas). App-wide config, not per-card, so it's injected rather than passed
	// as a prop. Defaults encode hue > lightness > chroma; the header's live
	// formula edits the same object, which is how the metric explains itself.
	inject: {
		errorWeights: {
			default: () => ({H: 4, L: 2, C: 1}),
		},
	},
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
			// The signed axes (direction matters), as opposed to the magnitude
			// metrics E2K/EOK/error. Used by the template to decide ± coloring.
			lch,
			// Mapped colors keyed by method, refreshed by the `color` watcher.
			mappedColors: {},
		};
	},

	watch: {
		// Re-map on color change (not weight retunes). mapColor writes stats, so it
		// lives in an effect, not a computed (which would invalidate itself).
		color: {
			handler (color) {
				this.mappedColors = mapColor(color);
			},
			immediate: true,
		},
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

		// Derive the per-method deltas from the mapped colors (produced by the
		// `color` watcher) and the input color. Re-runs when either changes —
		// including on Error-weight retunes, which is cheap since the GMAs
		// themselves don't re-run here.
		mapped () {
			let [L1, C1, h1] = this.colorLCH.coords;
			return Object.fromEntries(Object.entries(this.mappedColors).map(([method, mappedColor]) => {
				let [L2, C2, h2] = mappedColor.to("oklch").coords;

				// Raw OKLCh differences, computed once for both the error and the
				// displayed deltas. Δh is wrapped to the shortest signed arc, in degrees.
				let ΔL = L2 - L1;
				let ΔC = C2 - C1;
				let Δh = ((h2 - h1 + 540) % 360) - 180;

				// ΔH turns that hue angle into a perceptual distance: the chord
				// 2√(C₁C₂)·sin(Δh/2), which scales with the chroma it spans and fades
				// toward black/white (×4·L·(1−L)) where hue is invisible. C=0 ⇒ no hue.
				let meanL = (L1 + L2) / 2;
				let hueFade = 4 * meanL * (1 - meanL);
				let ΔH = C1 && C2 ? hueFade * 2 * Math.sqrt(C1 * C2) * Math.sin((Δh / 2) * Math.PI / 180) : 0;

				// Error: weighted sum of the absolute OKLCh deltas — hue > lightness >
				// chroma (errorWeights). Deliberately L1, not Euclidean: ΔEOK already
				// gives the straight-line OKLab distance, so this is a different lens.
				// `|| 0` keeps a half-typed (empty) weight input from poisoning it.
				let w = this.errorWeights;
				let error = (w.L || 0) * Math.abs(ΔL) + (w.C || 0) * Math.abs(ΔC) + (w.H || 0) * Math.abs(ΔH);

				let deltas = {
					error: this.toPrecision(error, 2),
					E2K: this.toPrecision(this.color.deltaE(mappedColor, { method: "2000" }), 2),
					EOK: this.toPrecision(this.color.deltaE(mappedColor, { method: "OK" }), 2),
					// Signed values for display (direction matters); the best/worst
					// highlighting compares their magnitudes (see `extremes`).
					// L in percentage points; hue as the signed shortest arc in degrees.
					L: this.toPrecision(ΔL * 100, 2),
					C: this.toPrecision(ΔC, 2),
					H: this.toPrecision(Δh, 2),
				};

				return [method, {color: mappedColor, deltas}];
			}));
		},

		// 0→1 as runs approach MIN_RUNS; drives the times' blur/fade-in.
		timingProgress () {
			return Math.min(stats.totalColors / MIN_RUNS, 1);
		},

		// Average run time (ms) per method.
		times () {
			return Object.fromEntries(Object.keys(this.methods).map(method => [method, average(method)]));
		},

		// Fastest and slowest average time across methods, so the best (min) time
		// can be colored green and the worst (max) red, mirroring the deltas.
		timeExtremes () {
			let values = Object.values(this.times).filter(t => t != null);
			return {min: Math.min(...values), max: Math.max(...values)};
		},

		// Methods left after applying the hide filter. Ranking/extremes still
		// consider all methods — this is purely a display filter.
		visibleMethods () {
			return Object.fromEntries(Object.entries(this.methods).filter(([method]) => {
				let {deltas} = this.mapped[method];
				return lch.every(c => !this.hide[c] || Math.abs(deltas[c]) <= epsilon[c]);
			}));
		},

		// Visible methods in ranked (best-first) display order.
		displayMethods () {
			let visible = this.visibleMethods;
			let ordered = this.ranking.filter(method => method in visible);
			return Object.fromEntries(ordered.map(method => [method, visible[method]]));
		},

		// Per-coordinate smallest and largest |Δ| across all methods, so each
		// delta column can highlight just its best (min) and worst (max) value.
		extremes () {
			let min = {}, max = {};
			for (let method in this.mapped) {
				for (let [c, value] of Object.entries(this.mapped[method].deltas)) {
					let delta = Math.abs(value);
					min[c] = c in min ? Math.min(min[c], delta) : delta;
					max[c] = c in max ? Math.max(max[c], delta) : delta;
				}
			}
			return {min, max};
		},

		// All methods sorted best-first by the active metric (smallest value wins),
		// ties broken by ΔEOK — or by ΔE2K when ΔEOK is itself the metric. "time"
		// ranks by average run time (fastest first) and reads from the shared
		// stats rather than the per-color deltas.
		ranking () {
			let primary = this.sort;
			let secondary = primary === "EOK" ? "E2K" : "EOK";
			let key = (method, c) => c === "time" ? (this.times[method] ?? Infinity) : Math.abs(this.mapped[method].deltas[c]);

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

		// Format a millisecond duration compactly: microseconds under 1 ms (GMAs
		// are mostly sub-millisecond), milliseconds otherwise.
		formatTime (ms) {
			return ms < 1 ? `${this.toPrecision(ms * 1000, 3)} µs` : `${this.toPrecision(ms, 3)} ms`;
		},

		// How many times a method has run, for the average's tooltip.
		runs (method) {
			return stats.methods[method]?.runs ?? 0;
		},

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
						<color-picker :space.attr="initialSpace" :color="colorInput" @input="onInput"></color-picker>
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

		<section class="gamut-mapped" :style="{'--timing-progress': timingProgress}">
			<h2>Gamut mapped</h2>

			<ol class="swatches">
				<li v-for="(config, method) in displayMethods" :id="'method-' + method" :data-ranking="rank(method)" :value="rank(method)" :class="{top: topRanks.includes(rank(method)), bottom: bottomRanks.includes(rank(method))}">
					<color-swatch size="large" :color="mapped[method].color"></color-swatch>
					<h3>{{ config.label ?? method[0].toUpperCase() + method.slice(1) }}</h3>
					<small v-if="config.description" class="description">{{ config.description }}</small>
					<dl class="deltas" v-if="!Object.values(mapped[method].deltas).every(d => d === 0)">
						<div v-for="(delta, c) of mapped[method].deltas" :class="'delta-' + c.toLowerCase()">
							<dt>{{ c === 'error' ? 'Error' : 'Δ' + c }}</dt>
							<dd :class="{
								positive: lch.includes(c) && delta > 0,
								min: extremes.min[c] === abs(delta),
								max: extremes.max[c] === abs(delta),
							}">{{ delta }}</dd>
						</div>
						<div v-if="times[method] != null" class="delta-time" :title="runs(method).toLocaleString() + ' runs'">
							<dt>Δt</dt>
							<dd :class="{min: timeExtremes.min === times[method], max: timeExtremes.max === times[method]}">{{ formatTime(times[method]) }}</dd>
						</div>
					</dl>
				</li>
			</ol>
		</section>`,
};
