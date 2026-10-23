import { expect, test } from "vitest";
import fixture from "../../tests/fixtures/stall-24mhz.json";
import {
  accelDegPerS2,
  ADC_FULL_SCALE,
  ADC_MAX_COUNT,
  busV,
  calibrationFromTable,
  calibrationStatus,
  currentMa,
  degPerCount,
  degToCounts,
  gearClassFromTable,
  motorV,
  positionDeg,
  senseFromTable,
  temperatureC,
  vbAlpha,
  vbSteady,
  vdiffV,
  velocityDegPerS,
  type Calibration,
  type Sense,
} from "./units";

// The recording predates the published bias divider: 0 reads as no divider.
const sense = senseFromTable(
  readFrom({ ...fixture.meta.sense, vmotor_bias_top_ohm: 0, vmotor_bias_bot_ohm: 0 }),
);
const { track, converted } = fixture;
const bias = fixture.meta.current_bias_counts;

// The oracle rounds to `digits` decimals, so its rounding (half an ulp, 5e-7
// here) is the whole expected gap and one ulp is the bound: the formulas either
// agree to float64 noise or they disagree by a visible amount. For scale, 1e-6 A
// is about 1/1000 of this board's 0.9 uA current lsb.
const TOL = 10 ** -fixture.meta.digits;

function readFrom(regs: Record<string, number>): (name: string) => number {
  return (name) => {
    const v = regs[name];
    if (v === undefined) throw new Error(`fixture carries no ${name}`);
    return v;
  };
}

function zip(a: readonly number[], b: readonly number[]): [number, number][] {
  if (a.length !== b.length) throw new Error(`length mismatch: ${a.length} vs ${b.length}`);
  return a.map((v, i) => [v, b[i] ?? NaN]);
}

function maxDeviation(got: readonly number[], want: readonly number[]): number {
  let worst = 0;
  for (const [g, w] of zip(got, want)) worst = Math.max(worst, Math.abs(g - w));
  return worst;
}

test("currentMa matches the notebook Board.amps over the capture", () => {
  const got = track.currentRaw.map((c) => currentMa(c, bias, sense) / 1000);
  expect(maxDeviation(got, converted.current)).toBeLessThan(TOL);
});

test("busV matches the notebook Board.vsys_v over the capture", () => {
  const got = track.vbusRaw.map((v) => busV(v, sense));
  expect(maxDeviation(got, converted.vbus)).toBeLessThan(TOL);
});

test("vdiffV matches the notebook Board.diff_v over the capture", () => {
  const got = zip(track.vmotorA, track.vmotorB).map(([a, b]) => vdiffV(a, b, sense));
  expect(maxDeviation(got, converted.vdiff)).toBeLessThan(TOL);
});

test("a tap sitting on the bias node reads the bias voltage", () => {
  const vb = sense.vmotorBiasNomCounts;
  expect(motorV(vb, vb, sense)).toBeCloseTo(vb * (sense.vddMv / 1000 / ADC_FULL_SCALE), 12);
});

// A terminal driven low reads (r-1)/r of the bias, not zero (Board.term_v).
test("motorV subtracts the divider bias", () => {
  const r = (sense.vmotorDivTop + sense.vmotorDivBot) / sense.vmotorDivBot;
  const drivenLow = ((r - 1) / r) * sense.vmotorBiasNomCounts;
  expect(motorV(drivenLow, sense.vmotorBiasNomCounts, sense)).toBeCloseTo(0, 12);
});

const CAL: Calibration = {
  rawMin: 118,
  rawMax: 3990,
  angleMinCdeg: -9500,
  angleMaxCdeg: 9500,
  gearRatioCenti: 29000,
};

test("calibrationStatus accepts a sane block", () => {
  expect(calibrationStatus(CAL)).toEqual({ valid: true });
});

test("calibrationStatus rejects an inverted sensor range", () => {
  const got = calibrationStatus({ ...CAL, rawMin: 3990, rawMax: 118 });
  expect(got.valid).toBe(false);
  expect(got.reason).toMatch(/below/);
});

test("calibrationStatus rejects a sensor range outside the ADC", () => {
  const got = calibrationStatus({ ...CAL, rawMax: ADC_FULL_SCALE });
  expect(got.valid).toBe(false);
  expect(got.reason).toMatch(/inside/);
  expect(calibrationStatus({ ...CAL, rawMax: ADC_MAX_COUNT }).valid).toBe(true);
});

test("calibrationStatus rejects a zero angle span", () => {
  const got = calibrationStatus({ ...CAL, angleMinCdeg: 9500 });
  expect(got.valid).toBe(false);
  expect(got.reason).toMatch(/differ/);
});

test("calibrationStatus rejects an angle span beyond one turn", () => {
  expect(calibrationStatus({ ...CAL, angleMinCdeg: -26501 }).valid).toBe(false);
  expect(calibrationStatus({ ...CAL, angleMinCdeg: -26500 }).valid).toBe(true);
});

test("calibrationStatus rejects an unset gear ratio", () => {
  const got = calibrationStatus({ ...CAL, gearRatioCenti: 0 });
  expect(got.valid).toBe(false);
  expect(got.reason).toMatch(/gear/);
});

test("gear_class names plastic and metal and reads anything else as unknown", () => {
  const named = [0, 1, 2, 3, 255].map((code) => gearClassFromTable(readFrom({ gear_class: code })));
  expect(named).toEqual(["unknown", "plastic", "metal", "unknown", "unknown"]);
});

test("positionDeg maps the calibrated span onto the angle endpoints", () => {
  expect(positionDeg(CAL.rawMin, CAL)).toBeCloseTo(-95, 10);
  expect(positionDeg(CAL.rawMax, CAL)).toBeCloseTo(95, 10);
  expect(positionDeg((CAL.rawMin + CAL.rawMax) / 2, CAL)).toBeCloseTo(0, 10);
});

test("degToCounts round trips through positionDeg", () => {
  for (let counts = CAL.rawMin; counts <= CAL.rawMax; counts += 37) {
    expect(degToCounts(positionDeg(counts, CAL), CAL)).toBe(counts);
  }
});

// omega_hat is counts/second, so deg/s per c/s is deg/count with no tick term.
test("velocityDegPerS shares the position scale", () => {
  expect(velocityDegPerS(1000, CAL)).toBeCloseTo(1000 * degPerCount(CAL), 10);
  expect(velocityDegPerS(0, CAL)).toBe(0);
});

test("degenerate calibration gives zero scale instead of infinity", () => {
  const flat: Calibration = { ...CAL, rawMax: CAL.rawMin };
  expect(degPerCount(flat)).toBe(0);
  expect(degToCounts(10, flat)).toBe(flat.rawMin);
});

// No firmware math to mirror: the firmware reads ntc_raw through the
// host-written quadratic in CALIB, so the divider plus beta lives only here.
test("temperatureC reads 25 C when the NTC equals its R25", () => {
  expect(temperatureC(ADC_FULL_SCALE / 2, sense)).toBeCloseTo(25, 9);
});

test("temperatureC follows the beta equation", () => {
  const raw = 1200;
  const rNtc = (sense.ntcPullupOhm * raw) / (ADC_FULL_SCALE - raw);
  const want = 1 / (1 / 298.15 + Math.log(rNtc / sense.ntcR25Ohm) / sense.ntcBeta) - 273.15;
  expect(temperatureC(raw, sense)).toBeCloseTo(want, 9);
});

test("temperatureC falls as the NTC tap rises", () => {
  expect(temperatureC(1200, sense)).toBeGreaterThan(temperatureC(2048, sense));
  expect(temperatureC(2048, sense)).toBeGreaterThan(temperatureC(3000, sense));
  expect(temperatureC(0, sense)).toBeNaN();
  expect(temperatureC(ADC_FULL_SCALE, sense)).toBeNaN();
});

test("calibrationFromTable binds the five calibration registers", () => {
  const regs = {
    raw_min: 118,
    raw_max: 3990,
    angle_min_cdeg: -9500,
    angle_max_cdeg: 9500,
    gear_ratio_centi: 29000,
  };
  expect(calibrationFromTable(readFrom(regs))).toEqual(CAL);
});

test("accelDegPerS2 reads Q8.8 counts/s per 2 kHz medium tick through the position scale", () => {
  const cal: Calibration = {
    rawMin: 200,
    rawMax: 3800,
    angleMinCdeg: 0,
    angleMaxCdeg: 18000,
    gearRatioCenti: 100,
  };
  // 3840 / 256 = 15 counts/s per tick, 30000 counts/s^2, 0.05 deg per count.
  expect(accelDegPerS2(3840, cal)).toBeCloseTo(1500, 9);
  expect(accelDegPerS2(0, cal)).toBe(0);
  expect(accelDegPerS2(3840, { ...cal, rawMax: cal.rawMin })).toBe(0);
});

const REV_2A: Sense = {
  shuntMohm: 60,
  gainMilli: 14_884,
  vddMv: 3300,
  vmotorDivTop: 6400,
  vmotorDivBot: 1600,
  vbusDivTopOhm: 6400,
  vbusDivBotOhm: 1600,
  ntcPullupOhm: 10_000,
  ntcR25Ohm: 10_000,
  ntcBeta: 3950,
  vmotorBiasNomCounts: 773,
  vmotorBiasTopOhm: 430,
  vmotorBiasBotOhm: 100,
};
const LSB_2A = 3.3 / ADC_FULL_SCALE;
const VB0_2A = (ADC_FULL_SCALE * 100) / 530;
const CV_2A = (430 * 100) / 530 / 8000;

/** The settled node and its crest taps with terminal A at `vr`, B low, ON fraction `d`. */
function taps2A(vr: number, d: number): [number, number, number] {
  const vb = (VB0_2A + (CV_2A * d * vr) / LSB_2A) / (1 + 2 * CV_2A);
  return [vb, (0.2 * vr) / LSB_2A + 0.8 * vb, 0.8 * vb];
}

test("VB under drive matches the bias plan's 430/100 rows at 4.5 and 8.4 V", () => {
  const duties = [0, 0.1, 0.15, 0.25, 0.5, 0.75, 0.87, 1];
  const rows: [number, number[]][] = [
    [4.5, [-12.4, -7.9, -5.7, -1.2, 10.0, 21.2, 26.5, 32.4]],
    [8.4, [-12.4, -4.0, 0.1, 8.5, 29.4, 50.2, 60.3, 71.1]],
  ];
  for (const [vr, mv] of rows) {
    duties.forEach((d, i) => {
      const [vb, a, b] = taps2A(vr, d);
      const got = vbSteady(VB0_2A, d, a, b, REV_2A) ?? NaN;
      expect(got).toBeCloseTo(vb, 9);
      expect(Math.abs((got - VB0_2A) * LSB_2A * 1000 - (mv[i] ?? NaN))).toBeLessThan(0.06);
    });
  }
});

test("one terminal read against the boot bias carries four times the VB move", () => {
  const [vb, a] = taps2A(8.4, 1);
  expect(motorV(a, vb, REV_2A)).toBeCloseTo(8.4, 9);
  expect((motorV(a, VB0_2A, REV_2A) - 8.4) * 1000).toBeCloseTo(284.5, 0);
});

test("VB follows 0.060 of a step per 50 us tick", () => {
  expect(vbAlpha(REV_2A, 20_000)).toBeCloseTo(0.06, 3);
});

test("without the bias divider there is no live VB", () => {
  expect(vbSteady(VB0_2A, 1, 3000, 600, { ...REV_2A, vmotorBiasTopOhm: 0 })).toBeUndefined();
});
