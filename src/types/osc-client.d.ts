// Stand-in for the wasm bindings package until ../open-servo-core/client/web has a pkg/ to link.
declare module "@openservocore/client" {
  export default function init(): Promise<void>;
  export function requestDevice(): Promise<USBDevice>;
  export function unpackVersion(fw: number): [number, number, number];
  export const VID: number;
  export const PID: number;
  export type BaudRate = "b500k" | "b1m" | "b2m" | "b3m";
  export interface LinkInfo {
    version: number;
    ticksPerUs: number;
  }
  export interface Rails {
    v3v3: boolean;
    v5: boolean;
  }
  export interface Found {
    id: number;
    uid: string;
    model: number;
    fw: number;
  }
  export interface Ping {
    model: number;
    fw: number;
    alert: boolean;
  }
  export interface Identity {
    model: number;
    fw: number;
    hw: number;
    capabilities: number;
  }
  export interface Health {
    faultFlags: number;
    statusFlags: number;
    trimSteps: number;
    crcFailCount: number;
    framingDropCount: number;
  }
  export interface TelBurst {
    frames: Uint8Array[];
  }
  export class OscClient {
    static connect(device: USBDevice): Promise<OscClient>;
    close(): Promise<void>;
    linkInfo(): LinkInfo;
    rails(): Promise<Rails>;
    setRails(v3v3: boolean, v5: boolean): Promise<void>;
    busPresent(): Promise<boolean>;
    findBusBaud(): Promise<BaudRate | undefined>;
    hostBaud(rate: BaudRate): Promise<void>;
    discover(): Promise<Found[]>;
    ping(id: number): Promise<Ping>;
    identity(id: number): Promise<Identity>;
    health(id: number): Promise<Health>;
    clearCounters(id: number): Promise<void>;
    read(id: number, addr: number, count: number): Promise<Uint8Array>;
    write(id: number, addr: number, data: Uint8Array): Promise<void>;
    writeHold(id: number, addr: number, data: Uint8Array): Promise<void>;
    commit(): Promise<void>;
    assign(uid: string, newId: number): Promise<void>;
    setBaud(ids: number[], rate: BaudRate): Promise<void>;
    save(id: number): Promise<void>;
    reboot(id: number): Promise<void>;
    factory(id: number): Promise<void>;
    telBurst(id: number, mask: number, count: number, windowUs: number): Promise<TelBurst>;
  }
  export type Access = "ro" | "rw";
  export type Kind = "uint" | "int" | "bool" | "enum" | "bytes";
  export interface Variant {
    name: string;
    value: number;
  }
  export interface Field {
    name: string;
    addr: number;
    width: number;
    access: Access;
    kind: Kind;
    min?: number;
    max?: number;
    variants: Variant[];
  }
  export type Value =
    | { kind: "uint"; value: number }
    | { kind: "int"; value: number }
    | { kind: "bool"; value: boolean }
    | { kind: "enum"; value: number }
    | { kind: "bytes"; value: Uint8Array };
  export class Descriptor {
    static parse(json: string): Descriptor;
    readonly model: string;
    readonly modelNumber: number;
    readonly firmwareMajor: number;
    readonly firmwareMinor: number;
    readonly tableSize: number;
    fields(): Field[];
    decode(name: string, bytes: Uint8Array): Value;
    encode(name: string, value: Value): Uint8Array;
  }
  export type Selection =
    | { kind: "exact"; descriptor: Descriptor }
    | { kind: "olderMinor"; descriptor: Descriptor }
    | { kind: "incompatible"; newest: [number, number] }
    | { kind: "unknownModel" };
  export class Registry {
    constructor();
    push(d: Descriptor): void;
    select(model: number, fw: number): Selection;
  }
}
