# color-mix() step by step

This app demonstrates the CSS Color 5 [`color-mix()`](https://www.w3.org/TR/css-color-5/#color-mix) function. Type any legal `color-mix()` value and it is parsed, showing the mixing color space and hue interpolation method, every color both in its own color space and in the mixing color space, and each stage of [the color-mix() algorithm](https://www.w3.org/TR/css-color-5/#color-mix-result): percentage normalization, conversion to the mixing color space, carrying missing components forward, hue fix-up, premultiplication, interpolation, un-premultiplication, and the final alpha multiplier.

The result is also compared with the one your browser computes for the same value.

The mixing is implemented from the specification in [`colormix.js`](colormix.js) rather than being delegated to Color.js, so that every intermediate value can be shown. Color.js does the color parsing and the color space conversions.
