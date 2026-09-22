import { Descriptor, unpackVersion } from "@openservocore/client";
import { hex16 } from "./format";

const MODEL_NAMES: ReadonlyMap<number, string> = new Map([[0x0101, "osc-servo"]]);

const BASE =
  import.meta.env.VITE_DESCRIPTOR_BASE ??
  (import.meta.env.DEV
    ? "/descriptors"
    : "https://raw.githubusercontent.com/OpenServoCore/open-servo-core/main/descriptors");

export function modelName(model: number): string | undefined {
  return MODEL_NAMES.get(model);
}

export function descriptorUrl(model: number, fw: number): string | undefined {
  const name = modelName(model);
  if (name === undefined) return undefined;
  const [major, minor] = unpackVersion(fw);
  return `${BASE}/${name}/${major}.${minor}.json`;
}

export async function fetchDescriptor(model: number, fw: number): Promise<Descriptor> {
  const url = descriptorUrl(model, fw);
  if (url === undefined) throw new Error(`unknown model ${hex16(model)}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`descriptor fetch failed: ${res.status} ${url}`);
  return Descriptor.parse(await res.text());
}
