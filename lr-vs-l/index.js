import Color from "colorjs.io";

const STEPS = 128;

function getURLParams () {
	return Object.fromEntries(new URL(location).searchParams);
}

function getColor (str) {
	try {
		return new Color(str);
	}
	catch (e) {
		return null;
	}
}

function renderGradient (el, c1, c2, space) {
	let colors = c1.steps(c2, {space, outputSpace: "srgb", steps: STEPS});
	let stops = colors.map((c, i) => `${c.toString({precision: 3})} ${(i / (colors.length - 1) * 100).toFixed(2)}%`);
	el.style.background = `linear-gradient(to right, ${stops.join(", ")})`;
}

function update () {
	let c1 = getColor(color1.value);
	let c2 = getColor(color2.value);

	color1.setCustomValidity(c1 ? "" : "Cannot parse color");
	color2.setCustomValidity(c2 ? "" : "Cannot parse color");
	color1.style.setProperty("--color", c1 ? c1.toString({precision: 3}) : "");
	color2.style.setProperty("--color", c2 ? c2.toString({precision: 3}) : "");

	if (!c1 || !c2) {
		return;
	}

	renderGradient(gradientOklab, c1, c2, "oklab");
	renderGradient(gradientOklrab, c1, c2, "oklrab");

	let query = `?color1=${encodeURIComponent(color1.value)}&color2=${encodeURIComponent(color2.value)}`;
	history.replaceState(null, "", query);
	permalink.href = query;
}

function updateBg () {
	document.body.classList.toggle("bg-black", bgToggle.checked);
}

document.body.addEventListener("input", evt => {
	if (evt.target === bgToggle) {
		updateBg();
	}
	else {
		update();
	}
});

let params = getURLParams();
if (params.color1) {
	color1.value = params.color1;
}
if (params.color2) {
	color2.value = params.color2;
}

update();
updateBg();
