import { expect, test } from "vitest";
import { classify, isDisconnect } from "./stats";

test("the messages a gone adapter produces classify as a disconnect", () => {
  for (const text of [
    "pipe: NotFoundError: Failed to execute 'transferOut' on 'USBDevice': The device was disconnected.",
    "pipe: NetworkError: The device is disconnected",
    "The device has been disconnected",
    "pipe gone",
  ]) {
    expect(isDisconnect(new Error(text))).toBe(true);
  }
});

test("a servo failure, a stall and the detach reason are not disconnects", () => {
  for (const text of [
    "not connected",
    "disconnected",
    "read timeout",
    "pipe stalled past the guard window",
    "NotFoundError: No device selected.",
  ]) {
    expect(isDisconnect(new Error(text))).toBe(false);
  }
});

test("a disconnect still counts as a plain error in the readout", () => {
  expect(classify(new Error("pipe: the device was disconnected"))).toBe("error");
});
