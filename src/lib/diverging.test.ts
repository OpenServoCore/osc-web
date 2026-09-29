import { expect, test } from "vitest";
import { diverging } from "./diverging";

const scale = { low: "#2a78d6", zero: "#6b7280", high: "#d4551f" };

test("the sign picks the hue, the magnitude the depth, and zero is neutral", () => {
  expect(diverging(0, scale)).toBe("rgb(107, 114, 128)");
  expect(diverging(1, scale)).toBe("rgb(212, 85, 31)");
  expect(diverging(-1, scale)).toBe("rgb(42, 120, 214)");
  // Half way from the neutral tone toward each end.
  expect(diverging(0.5, scale)).toBe("rgb(160, 100, 80)");
  expect(diverging(-0.5, scale)).toBe("rgb(75, 117, 171)");
  // Equal magnitudes sit equally far from neutral, whichever the sign.
  expect(diverging(0.25, scale)).toBe("rgb(133, 107, 104)");
  expect(diverging(-0.25, scale)).toBe("rgb(91, 116, 150)");
});

test("beyond the ends the scale clamps, alpha carries, and ends that are not hex come back as given", () => {
  expect(diverging(3, scale)).toBe(diverging(1, scale));
  expect(diverging(-3, scale)).toBe(diverging(-1, scale));
  expect(diverging(1, scale, 0.25)).toBe("rgba(212, 85, 31, 0.25)");
  expect(diverging(0, scale, 0.25)).toBe("rgba(107, 114, 128, 0.25)");
  const named = { low: "blue", zero: "grey", high: "orange" };
  expect(diverging(0.5, named)).toBe("orange");
  expect(diverging(-0.5, named)).toBe("blue");
  expect(diverging(0, named)).toBe("grey");
});
