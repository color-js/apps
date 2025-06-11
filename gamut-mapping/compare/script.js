// @ts-check
const worker = new Worker("./worker.js", { type: "module" });

const output = document.getElementById("output");
worker.onmessage = (message) => {
	const data = JSON.parse(message.data);
	if (data.results) {
		output.innerHTML = JSON.stringify(data, null, 2) + "<br/><br/><br/><br/>";
	}
};
worker.onerror = (...error) => {
	console.error("Worker error:", error);
	output.innerHTML = "Error: " + error.message;
};

const run = document.getElementById("run");
run.addEventListener("click", () => {
	const delta = parseFloat(document.getElementById("delta").value);
	console.log("Running worker");
	worker.postMessage(["run", { delta }]);
});
