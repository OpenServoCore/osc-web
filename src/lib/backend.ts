import init, { OscClient, pid, requestDevice, vid } from "@openservocore/client";

const ID_MIN = 1;
const ID_MAX = 0xf9;

/** `?sim` alone is a two-servo fleet; `?sim=1,2,3` names the ids. */
export function parseSimIds(search: string): number[] | undefined {
  const raw = new URLSearchParams(search).get("sim");
  if (raw === null) return undefined;
  if (raw === "") return [1, 2];
  const ids = new Set<number>();
  for (const part of raw.split(",")) {
    if (!/^\d+$/.test(part)) continue;
    const id = Number(part);
    if (id >= ID_MIN && id <= ID_MAX) ids.add(id);
  }
  return [...ids];
}

export function simRequested(): boolean {
  return parseSimIds(window.location.search) !== undefined;
}

/** The first device already permitted for this origin that is an osc-adapter. */
export function permittedAdapter<T extends { vendorId: number; productId: number }>(
  devices: readonly T[],
  vendor: number,
  product: number,
): T | undefined {
  return devices.find((d) => d.vendorId === vendor && d.productId === product);
}

let wasmReady: Promise<unknown> | undefined;

export async function openClient(): Promise<OscClient> {
  wasmReady ??= init();
  await wasmReady;
  const ids = parseSimIds(window.location.search);
  if (ids !== undefined) return OscClient.fake(ids);
  const device = permittedAdapter(await navigator.usb.getDevices(), vid(), pid());
  return OscClient.connect(device ?? (await requestDevice()));
}
