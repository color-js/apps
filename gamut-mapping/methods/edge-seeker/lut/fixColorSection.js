import { lerpColorByHue, isCW } from "../utils.js";

/**
 * Removes hue folds from a section of colors sampled in order of increasing HSL hue.
 * Because the colors are keyed by OkLCh hue, the section can fold back on itself.
 * Simply discarding each color whose hue does not advance would keep the overshoot
 * before the fold and discard the good colors after it, which is worse than doing nothing.
 * Instead, the overshoot is removed, and the section resumes at the end of the backward run.
 */
export function fixColorSection (section) {
	const result = [section[0]];

	for (let i = 1; i < section.length; i++) {
		if (isCW(section[i - 1].h, section[i].h)) {
			// Going in the right direction
			result.push(section[i]);
			continue;
		}

		// The section has folded back on itself; find the end of the backward run.
		// The fold can run to the end of the section (it does, for sRGB and rec2020)
		let j = i;
		while (j < section.length - 1 && !isCW(section[j].h, section[j + 1].h)) {
			j++;
		}
		const resume = section[j];

		// The first kept color past the hue where the section resumes
		const firstFaultyIdx = result.findIndex(
			(addedColor) => !isCW(addedColor.h, resume.h),
		);
		if (firstFaultyIdx < 1) {
			// Happens with imaginary primaries, such as ProPhoto RGB
			throw new Error("EdgeSeeker: cannot repair a hue fold with no color before it");
		}
		const bridge = lerpColorByHue(
			result[firstFaultyIdx - 1],
			result[firstFaultyIdx],
			resume.h - 0.0001,
		);

		// Discard the overshoot
		result.length = firstFaultyIdx;

		// With some sample counts a kept color already lies within 0.0001deg of resume;
		// the bridge would then land behind it, start a new fold, and is not needed
		const last = result[result.length - 1];
		if (isCW(last.h, bridge.h) && bridge.h !== last.h) {
			result.push(bridge);
		}
		result.push(resume);
		i = j;
	}

	return result;
}
