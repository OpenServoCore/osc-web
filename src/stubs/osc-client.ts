// Runtime stand-in for @openservocore/client, aliased in vite.config.ts until client/web has a pkg/.
const missing = () => new Error("@openservocore/client is not built: run npm run wasm");

export default function init(): Promise<void> {
  return Promise.reject(missing());
}
export function requestDevice(): Promise<never> {
  return Promise.reject(missing());
}
export function unpackVersion(): never {
  throw missing();
}
export const VID = 0;
export const PID = 0;
export class OscClient {
  static connect(): Promise<never> {
    return Promise.reject(missing());
  }
  close(): Promise<never> {
    return Promise.reject(missing());
  }
}
export class Descriptor {
  static parse(): never {
    throw missing();
  }
  fields(): never {
    throw missing();
  }
}
export class Registry {
  push(): never {
    throw missing();
  }
  select(): never {
    throw missing();
  }
}
