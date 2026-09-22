// Raw device counts to engineering units. The servo publishes counts plus the
// calibration primitives that make them interpretable (protocol sec 5.5) and
// the host converts; these are the notebooks' formulas (notebooks/oscnb/boards.py
// `Board`) and the ident host's (`ident/src/units.rs`), ported verbatim.

/** ADC full scale: 12-bit converter referenced to VDD. */
export const ADC_FULL_SCALE = 4096;
/** Highest code the converter can return. */
export const ADC_MAX_COUNT = ADC_FULL_SCALE - 1;

const KELVIN_25C = 298.15;
const KELVIN_0C = 273.15;
const FULL_TURN_CDEG = 36000;
/** gear_ratio_centi is motor revs per output rev x100, so 100 is a direct drive. */
const MIN_GEAR_RATIO_CENTI = 100;
/** gear_ratio_centi is a u16 on the wire. */
const MAX_GEAR_RATIO_CENTI = 65535;

/** Reads one control-table register by descriptor name. */
export type ReadRegister = (name: string) => number;

/** Board sense-chain constants, from the CALIB sense and sense_ext blocks. */
export interface Sense {
  shuntMohm: number;
  gainMilli: number;
  vddMv: number;
  vmotorDivTop: number;
  vmotorDivBot: number;
  vbusDivTopOhm: number;
  vbusDivBotOhm: number;
  ntcPullupOhm: number;
  ntcR25Ohm: number;
  ntcBeta: number;
  /** Nominal motor-terminal divider bias; telemetry publishes the boot-measured one. */
  vmotorBiasNomCounts: number;
}

/** Count-to-angle calibration, from the CALIB pot_lut and kinematics blocks. */
export interface Calibration {
  rawMin: number;
  rawMax: number;
  angleMinCdeg: number;
  angleMaxCdeg: number;
  gearRatioCenti: number;
}

/** Bias counts the servo measures for itself; both live in TELEMETRY, not CALIB. */
export interface Biases {
  currentBiasCounts: number;
  vmotorBiasCounts: number;
}

export function senseFromTable(read: ReadRegister): Sense {
  return {
    shuntMohm: read("shunt_r_mohm"),
    gainMilli: read("gain_milli"),
    vddMv: read("vdd_mv"),
    vmotorDivTop: read("vmotor_div_top"),
    vmotorDivBot: read("vmotor_div_bot"),
    vbusDivTopOhm: read("vbus_div_top_ohm"),
    vbusDivBotOhm: read("vbus_div_bot_ohm"),
    ntcPullupOhm: read("ntc_pullup_ohm"),
    ntcR25Ohm: read("ntc_r25_ohm"),
    ntcBeta: read("ntc_beta"),
    vmotorBiasNomCounts: read("vmotor_bias_nom_counts"),
  };
}

export function calibrationFromTable(read: ReadRegister): Calibration {
  return {
    rawMin: read("raw_min"),
    rawMax: read("raw_max"),
    angleMinCdeg: read("angle_min_cdeg"),
    angleMaxCdeg: read("angle_max_cdeg"),
    gearRatioCenti: read("gear_ratio_centi"),
  };
}

export function biasesFromTable(read: ReadRegister): Biases {
  return {
    currentBiasCounts: read("current_bias_counts"),
    vmotorBiasCounts: read("vmotor_bias_counts"),
  };
}

export interface CalibrationStatus {
  valid: boolean;
  reason?: string;
}

interface Check {
  ok: (cal: Calibration) => boolean;
  reason: string;
}

const CHECKS: readonly Check[] = [
  { ok: (c) => c.rawMin < c.rawMax, reason: "sensor lowest must be below sensor highest" },
  {
    ok: (c) => c.rawMin >= 0 && c.rawMax <= ADC_MAX_COUNT,
    reason: `sensor range must sit inside 0 to ${ADC_MAX_COUNT} counts`,
  },
  { ok: (c) => angleSpanCdeg(c) !== 0, reason: "angle lowest and highest must differ" },
  {
    ok: (c) => Math.abs(angleSpanCdeg(c)) <= FULL_TURN_CDEG,
    reason: "angle span must be at most one full turn",
  },
  {
    ok: (c) => c.gearRatioCenti >= MIN_GEAR_RATIO_CENTI,
    reason: "gear ratio must be at least 1.00",
  },
  {
    ok: (c) => c.gearRatioCenti <= MAX_GEAR_RATIO_CENTI,
    reason: "gear ratio must be at most 655.35",
  },
];

/** Every failing check's reason, in check order. */
export function calibrationIssues(cal: Calibration): string[] {
  return CHECKS.filter((check) => !check.ok(cal)).map((check) => check.reason);
}

/**
 * Derived calibration status: the servo keeps no calibrated flag, so the five
 * numbers are judged on their own. The first failing check names the issue.
 */
export function calibrationStatus(cal: Calibration): CalibrationStatus {
  const [reason] = calibrationIssues(cal);
  return reason === undefined ? { valid: true } : { valid: false, reason };
}

function angleSpanCdeg(cal: Calibration): number {
  return cal.angleMaxCdeg - cal.angleMinCdeg;
}

// --- scale factors ---------------------------------------------------------
// Degenerate denominators give 0 rather than Infinity, as ident/src/units.rs does.

/** ADC lsb in volts; the v006 reference is VDD itself. Mirrors Board.v_adc_per_count. */
export function adcLsbV(sense: Sense): number {
  return sense.vddMv / 1000 / ADC_FULL_SCALE;
}

/** Mirrors Board.a_per_count. */
export function ampsPerCount(sense: Sense): number {
  const denom = (sense.gainMilli / 1000) * (sense.shuntMohm / 1000);
  return denom > 0 ? adcLsbV(sense) / denom : 0;
}

/** Volts per count behind a resistive divider on the same ADC reference. */
function dividerVoltsPerCount(sense: Sense, topOhm: number, botOhm: number): number {
  return botOhm > 0 ? adcLsbV(sense) * ((topOhm + botOhm) / botOhm) : 0;
}

/** Mirrors Board.v_term_per_count: volts per count of terminal tap DIFFERENCE. */
export function motorVoltsPerCount(sense: Sense): number {
  return dividerVoltsPerCount(sense, sense.vmotorDivTop, sense.vmotorDivBot);
}

/** Mirrors Board.vbus_ratio applied to the lsb: the direct rail tap, unbiased. */
export function busVoltsPerCount(sense: Sense): number {
  return dividerVoltsPerCount(sense, sense.vbusDivTopOhm, sense.vbusDivBotOhm);
}

/**
 * Degrees of output travel per pot count, mirroring ident kinematics::deg_per_count.
 * Gearing is not in it: angle_min/max_cdeg are already output-shaft angles and
 * gear_ratio_centi only divides torque constants.
 */
export function degPerCount(cal: Calibration): number {
  const countSpan = cal.rawMax - cal.rawMin;
  return countSpan === 0 ? 0 : angleSpanCdeg(cal) / 100 / countSpan;
}

// --- converters ------------------------------------------------------------

export function positionDeg(counts: number, cal: Calibration): number {
  return cal.angleMinCdeg / 100 + (counts - cal.rawMin) * degPerCount(cal);
}

/** Inverse of positionDeg, for goal-position edits. Counts are whole. */
export function degToCounts(deg: number, cal: Calibration): number {
  const perCount = degPerCount(cal);
  if (perCount === 0) return cal.rawMin;
  return Math.round(cal.rawMin + (deg - cal.angleMinCdeg / 100) / perCount);
}

/** omega_hat is counts/second, so deg/s per c/s is deg/count with no tick term. */
export function velocityDegPerS(countsPerS: number, cal: Calibration): number {
  return countsPerS * degPerCount(cal);
}

/**
 * Mirrors Board.amps. `biasCounts` is the shunt reading at zero current: the
 * app passes the servo's own `current_bias_counts`, where the notebooks instead
 * take the mean of `current_raw` over the capture's bridge-off baseline segment.
 */
export function currentMa(counts: number, biasCounts: number, sense: Sense): number {
  return (counts - biasCounts) * ampsPerCount(sense) * 1000;
}

/** Mirrors Board.vsys_v. Takes `vbus_raw`, never the estimator's `vbus_counts`. */
export function busV(vbusRawCounts: number, sense: Sense): number {
  return vbusRawCounts * busVoltsPerCount(sense);
}

/** Mirrors Board.diff_v: terminal to terminal, bias free by construction. */
export function vdiffV(tapACounts: number, tapBCounts: number, sense: Sense): number {
  return (tapACounts - tapBCounts) * motorVoltsPerCount(sense);
}

/**
 * Mirrors Board.term_v: absolute volts at one terminal. A terminal driven low
 * does not read zero, it reads (r-1)/r of the bias, so the bias must come out.
 */
export function motorV(tapCounts: number, biasCounts: number, sense: Sense): number {
  const r =
    sense.vmotorDivBot > 0 ? (sense.vmotorDivTop + sense.vmotorDivBot) / sense.vmotorDivBot : 0;
  return (r * tapCounts - (r - 1) * biasCounts) * adcLsbV(sense);
}

/**
 * NTC to GND under a pull-up to VDD (firmware cfg::board_wiring::Ntc), then the
 * beta equation. Ratiometric, so VDD cancels and only the count ratio matters.
 */
export function temperatureC(ntcRawCounts: number, sense: Sense): number {
  const headroom = ADC_FULL_SCALE - ntcRawCounts;
  if (headroom <= 0 || ntcRawCounts <= 0 || sense.ntcBeta <= 0 || sense.ntcR25Ohm <= 0) return NaN;
  const rNtc = (sense.ntcPullupOhm * ntcRawCounts) / headroom;
  const invT = 1 / KELVIN_25C + Math.log(rNtc / sense.ntcR25Ohm) / sense.ntcBeta;
  return 1 / invT - KELVIN_0C;
}

// --- display metadata ------------------------------------------------------

export interface Display {
  unit: string;
  digits: number;
}

export const DISPLAY = {
  position: { unit: "deg", digits: 1 },
  goal: { unit: "deg", digits: 1 },
  velocity: { unit: "deg/s", digits: 0 },
  current: { unit: "mA", digits: 0 },
  busVoltage: { unit: "V", digits: 2 },
  motorVoltage: { unit: "V", digits: 2 },
  temperature: { unit: "C", digits: 1 },
  raw: { unit: "counts", digits: 0 },
} as const satisfies Record<string, Display>;

export type Quantity = keyof typeof DISPLAY;
