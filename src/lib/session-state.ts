import type { BaudRate, Found, Ping } from "@openservocore/client";

/** `ping` is undefined only when the id was answered by more than one node. */
export interface Servo extends Found {
  ping: Ping | undefined;
  /** Unset until the session reads them from the servo. */
  fault?: string;
  unsaved?: boolean;
  calibrated?: boolean;
}

export type Status = "disconnected" | "connecting" | "scanning" | "ready" | "error";

export interface SessionState {
  status: Status;
  /** The last failure; set only while `status` is "error". */
  error: string | undefined;
  baud: BaudRate | undefined;
  servos: Servo[];
  selected: number | undefined;
}

export type SessionEvent =
  | { type: "connect" }
  | { type: "scan" }
  | { type: "found"; servos: Servo[]; baud: BaudRate | undefined }
  | { type: "fail"; error: string }
  | { type: "select"; id: number | undefined }
  | { type: "disconnect" };

export const idle: SessionState = {
  status: "disconnected",
  error: undefined,
  baud: undefined,
  servos: [],
  selected: undefined,
};

// Events that do not apply in the current status leave it unchanged, so a
// command that resolves after a disconnect cannot revive the session.
export function reduce(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case "connect":
      return state.status === "disconnected" || state.status === "error"
        ? { ...idle, status: "connecting" }
        : state;
    case "scan":
      return state.status === "connecting" || state.status === "ready"
        ? { ...state, status: "scanning" }
        : state;
    case "found":
      return state.status === "scanning"
        ? {
            ...state,
            status: "ready",
            baud: event.baud,
            servos: event.servos,
            selected: event.servos.some((s) => s.id === state.selected)
              ? state.selected
              : undefined,
          }
        : state;
    case "fail":
      return state.status === "disconnected" || state.status === "error"
        ? state
        : { ...idle, status: "error", error: event.error };
    case "select":
      return state.status === "ready" ? { ...state, selected: event.id } : state;
    case "disconnect":
      return idle;
  }
}
