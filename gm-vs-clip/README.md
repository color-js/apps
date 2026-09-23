# Gamut mapped, or clipped?

Given a color **O** outside the gamut of a canvas color space, `display-p3` or `srgb`, this app computes:

- **C**, O naïvely clipped into that space, channel by channel
- **G₁, G₂, G₃**, O mapped into that space by each of the three [CSS gamut mapping algorithms](https://drafts.csswg.org/css-color-4/#css-gamut-mapping) (CSS Color 4 § 14.2): Binary Search with Local MINDE, EdgeSeeker and Ray Trace
- **G**, their mean, and **S**, a per-channel tolerance around it within which all three fit but C does not

and generates [web-platform-tests](https://web-platform-tests.org/) from them: one for a `display-p3` canvas and one for an `srgb` canvas, since a browser can gamut map on one without supporting the other. Each test paints each color as a 5×5 patch into a canvas with `colorType: "unorm8"`, reads back the center pixel (clear of any antialiasing at the edges), and reports whether the browser gamut mapped it, clipped it, or did neither. The same readback is run live, in whichever browser is viewing the app.

Each test starts with a **control**: an in-gamut color written in the canvas's own color space (`rgb(200 100 50)` or `color(display-p3 0.8 0.4 0.2)`), which neither conversion nor gamut mapping should touch, and which must read back unchanged, ±1. If it fails, the canvas is changing every color — for example by converting to the display's color profile — and the gamut mapping results cannot be judged. The live check in the app runs the same control.

The `display-p3` test also checks that the canvas really is `display-p3`, via `getContextAttributes()`. The `srgb` test does not, since `srgb` is the default and a browser without color-managed canvases may not report a color space at all.

## How S is chosen

Everything is measured in 8-bit units of the canvas color space, since that is what a `unorm8` canvas stores, and distances are the largest per-channel difference, as with `assert_array_approx_equals`.

The expected value E is G rounded to whole bytes. A margin (1 by default, adjustable) allows for implementations whose arithmetic differs slightly from Color.js. S is then the smallest whole number that accepts anything within the margin of any of the three algorithms. A color is only usable if S still rejects anything within the margin of the clipped color.

## What makes a good test color

The three algorithms do not always agree. EdgeSeeker and Ray Trace nearly always land within a fraction of a byte of each other, but Binary Search with Local MINDE accepts a clipped color whenever it is within one JND (ΔE<sub>OK</sub> 0.02) of the chroma-reduced one, so it can differ from them by tens of bytes. For some colors, such as `color(rec2020 1 1 0)` on a `display-p3` canvas or `color(display-p3 0 0 1)` on an `srgb` one, it returns the clipped color itself, and then no test can tell a browser that uses it from one that clips. The app detects these and says so.

**Find test colors** scans the `display-p3` and Rec. 2020 primaries and secondaries and a grid of round-number Oklch colors, and ranks those outside the chosen canvas's gamut by how many times over S could grow before it admitted the clipped color.

## Implementations

Binary Search with Local MINDE and Ray Trace are Color.js’s own `toGamut()` methods `"css"` and `"raytrace"`. EdgeSeeker uses `makeEdgeSeeker()` from the [Gamut Mapping Playground](../gamut-mapping/methods/edge-seeker/), which CSS Color 4 cites as its reference implementation, since the spec has no pseudocode for it yet. The Playground only builds a `display-p3` lookup table; this app builds one for each canvas color space, and its `display-p3` results match the Playground's exactly. Unlike the Playground, the input chroma is not capped before mapping.

[`compute.js`](compute.js) has no DOM dependencies and runs in Node too.
