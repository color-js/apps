import methods from "../gamut-mapping/methods.js";
import { serialize } from "colorjs.io/fn";

export default {
	props: {
		method: String | Object,
		steps: Array,
	},

	emits: ["report-time"],

	data () {
		return {
			time: 0,
			mappedSteps: [],
		};
	},

	computed: {
		name () {
			return methods[this.method]?.label || "None";
		},
	},

	methods: {
		mapSteps () {
			const start = performance.now();
			let mapped = this.steps.map(step => {
				if (this.method === "none") {
					return step;
				}
				if (methods[this.method].compute) {
					return methods[this.method].compute(step);
				}
				return step.clone().toGamut({ space: "p3", method: this.method });
			});
			this.time = Color.util.toPrecision(performance.now() - start, 4);
			this.$emit("report-time", {time: this.time, method: this.method});
			// compute() returns plain color objects now; serialize outside the timed
			// region so the gradient's --step-color CSS variable gets a color string.
			this.mappedSteps = mapped.map(color => serialize(color));
		},
	},

	watch: {
		steps: {
			handler () {
				this.mapSteps();
			},
			immediate: true,
		},
	},

	compilerOptions: {
		isCustomElement (tag) {
			return tag === "color-swatch";
		},
	},

	template: `
	<div class="mapped-gradient">
		<div class="info"><strong>{{ name }}</strong> {{time}}ms</div>
		<div class="gradient" :title="name">
			<div v-for="step in mappedSteps" :style="{'--step-color': step}" :title="name + ' ' + step"></div>
		</div>
	</div>
		`,
};
