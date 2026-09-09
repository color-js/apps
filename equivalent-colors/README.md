# Are these two colors equivalent?

This app implements [Comparing `<color>` Values](https://www.w3.org/TR/css-color-4/#comparing-color-values), CSS Color 4 § 12. Type any two legal CSS colors and each step of the algorithm is shown with the values it acted on: powerless components becoming missing, the `<color-space>` each color is considered to be in, and then either a component-by-component comparison within one color space, or the missing-component test and the conversion to Oklab that follow when the two color spaces differ.

This is the comparison that [style container queries](https://www.w3.org/TR/css-conditional-5/#style-container) and [CSS Transitions](https://www.w3.org/TR/css-transitions-1/) use to decide whether a color has changed. It is not the same question as whether the two colors look alike: `oklch(50% 0 none)` and `oklab(50% 0 0)` are the same color on screen, but are not equivalent colors, because they are in different color spaces and one of them has a missing component.

Where the browser supports `style()` container queries on a custom property registered as a `<color>`, the answer is also checked against the browser's own implementation of the same algorithm.

The comparison is implemented from the specification in [`compare.js`](compare.js) rather than being delegated to Color.js, so that every intermediate value can be shown. Color.js does the color parsing and the color space conversions.

System colors are not supported, since they have no value outside a browser.

## The examples as spec text

Every pair offered by the app's *Try:* buttons is also written up in [`color-4-section-12-examples.bs`](color-4-section-12-examples.bs) as Bikeshed `<div class="example">` blocks, grouped by which step of the algorithm decides the answer, for pasting into [CSS Color 4 § 12](https://www.w3.org/TR/css-color-4/#comparing-color-values).
