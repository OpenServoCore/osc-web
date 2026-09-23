import init, { OscClient, pid, requestDevice, vid, type Track } from "@openservocore/client";

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

/** A device the browser reports is the adapter; `vid`/`pid` need the wasm loaded. */
export function isAdapter(device: { vendorId: number; productId: number }): boolean {
  return device.vendorId === vid() && device.productId === pid();
}

let wasmReady: Promise<unknown> | undefined;

export async function openClient(): Promise<OscClient> {
  wasmReady ??= init();
  await wasmReady;
  const ids = parseSimIds(window.location.search);
  if (ids !== undefined) {
    const track = await simTrack();
    return OscClient.fakeWithTracks(ids.map((id) => ({ id, track })));
  }
  const device = permittedAdapter(await navigator.usb.getDevices(), vid(), pid());
  return OscClient.connect(device ?? (await requestDevice()));
}

// Loaded on demand: the recording is for the simulated fleet only and stays
// out of the bundle a real adapter needs.
async function simTrack(): Promise<Track> {
  const { track } = (await import("../../tests/fixtures/stall-24mhz.json")).default;
  return {
    pos: Uint16Array.from(track.pos),
    current: Int16Array.from(track.current),
    currentTrough: Uint16Array.from(track.currentTrough),
    dutyQ15: Int16Array.from(track.dutyQ15),
    vdiff: Int16Array.from(track.vdiff),
    vbus: Uint16Array.from(track.vbus),
    currentRaw: Uint16Array.from(track.currentRaw),
    vmotorA: Uint16Array.from(track.vmotorA),
    vmotorB: Uint16Array.from(track.vmotorB),
    vbusRaw: Uint16Array.from(track.vbusRaw),
    ntcRaw: Uint16Array.from(track.ntcRaw),
    windowValid: Uint8Array.from(track.windowValid),
  };
}
