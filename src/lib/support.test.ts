import { expect, test } from "vitest";
import { usbSupported } from "./support";

test("usbSupported needs navigator.usb", () => {
  expect(usbSupported({ usb: {} }, "")).toBe(true);
  expect(usbSupported({}, "")).toBe(false);
  expect(usbSupported({ usb: undefined }, "")).toBe(false);
});

test("?nousb forces unsupported", () => {
  expect(usbSupported({ usb: {} }, "?nousb")).toBe(false);
  expect(usbSupported({ usb: {} }, "?sim=1&nousb=")).toBe(false);
  expect(usbSupported({ usb: {} }, "?sim=1")).toBe(true);
});
