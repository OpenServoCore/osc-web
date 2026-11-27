import init from "@openservocore/client";

let ready: Promise<unknown> | undefined;

/** Loads the client's wasm once for every page, connected or not. */
export async function loadWasm(): Promise<void> {
  ready ??= init();
  await ready;
}
