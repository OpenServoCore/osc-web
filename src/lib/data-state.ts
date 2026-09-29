// The servo's data state (protocol sec 5.7): `data_flags` names every reason
// the saved images and the identified set are not the servo's own, and the
// kernel latches the `data` fault when an enable asks for a loop those reasons
// refuse. Pure: the bits mirror the servo core, the words are the GUI's.

export interface DataState {
  flags: number;
  /** `fault_code`: the latest newly-latched fault kind. */
  faultCode: number;
}

export interface Reason {
  name: string;
  /** Consequence first, then what to do about it. */
  text: string;
}

/** `fault_code` of an enable the data state refused. */
export const FAULT_DATA = 7;
/** `fault_flags` bit of the same fault. */
export const FAULT_DATA_BIT = 6;

const CONFIG_CORRUPT = 1 << 1;

const NEXT = "Run osc cal and osc ident, then save.";

/** Most urgent first: the order the servo core's host half reports them in. */
const REASONS: readonly (Reason & { bit: number })[] = [
  {
    bit: 1 << 1,
    name: "CONFIG_CORRUPT",
    text: `Torque is refused: the saved settings are unreadable, so board defaults are running. Factory reset the servo, then run osc cal and osc ident, or osc recover from a backup.`,
  },
  {
    bit: 1 << 3,
    name: "CALIB_CORRUPT",
    text: `Closed loop is off: the calibration is unreadable. ${NEXT}`,
  },
  {
    bit: 1 << 6,
    name: "CONFIG_STALE",
    text: `Closed loop is off: the saved settings are from another firmware, so board defaults are running. ${NEXT}`,
  },
  {
    bit: 1 << 7,
    name: "CALIB_STALE",
    text: `Closed loop is off: the calibration is from another firmware. ${NEXT}`,
  },
  {
    bit: 1 << 0,
    name: "CONFIG_VIRGIN",
    text: `Closed loop is off: this servo has never been set up. ${NEXT}`,
  },
  {
    bit: 1 << 2,
    name: "CALIB_VIRGIN",
    text: `Closed loop is off: this servo has never been calibrated. ${NEXT}`,
  },
  {
    bit: 1 << 4,
    name: "STAMP_MISMATCH",
    text: "Closed loop is off: the pot table and the identified values are not one set (edited, rebuilt or partly written). Run osc ident, or re-run the tool that was interrupted.",
  },
  {
    bit: 1 << 5,
    name: "PLANT_UNSET",
    text: "Closed loop is off: the motor has not been identified. Run osc ident, then save.",
  },
];

/** The reasons set in `flags`, most urgent first. */
export function reasons(flags: number): Reason[] {
  return REASONS.filter((r) => (flags & r.bit) !== 0).map(({ name, text }) => ({ name, text }));
}

/** The kernel's entry verdict: OpenLoop and Current stay open unless CONFIG is corrupt. */
export function openLoopAllowed(flags: number): boolean {
  return (flags & CONFIG_CORRUPT) === 0;
}

/** Velocity and Position open only when nothing is wrong. */
export function closedLoopAllowed(flags: number): boolean {
  return flags === 0;
}

/**
 * The banner's headline: the most urgent reason, prefixed when the kernel
 * refused an enable over it; undefined when nothing is wrong.
 */
export function headline(state: DataState): string | undefined {
  const [first] = reasons(state.flags);
  if (first === undefined) return undefined;
  return state.faultCode === FAULT_DATA ? `Closed loop refused. ${first.text}` : first.text;
}
