#!/usr/bin/env node
// One telemetry capture (open-servo-core notebooks/telemetry/<rig>/<campaign>/capture-N)
// to a units-oracle fixture under tests/fixtures:
//
//   node scripts/make-fixture.mjs <capture-dir> [--name <stem>] [--file <name.csv.gz>]
//                                 [--from <row>] [--rows <n>] [--digits <n>]
//
// The raw track comes from the monorepo's own track-from-capture.mjs (same
// window semantics: rows count from the file's first row, default start is the
// first window_valid row). The `converted` block is the oracle: the notebooks'
// own oscnb/boards.py Board, executed by python3, converting the same rows. So
// the expected values are the analysis series' values, not a second port of the
// formulas. python3 is required; oscnb.boards needs nothing beyond the stdlib,
// so the notebooks' uv environment is not.
//
// Two of the Sense registers the servo publishes are absent from a capture's
// meta.json `sense` block (it carries five keys). They are board constants, so
// they are filled from the board's own firmware config, keyed by the notebook
// Board that meta.json identifies - see BOARD_EXTRA.

import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const CORE = resolve(REPO, "../open-servo-core");
const NOTEBOOKS = join(CORE, "notebooks");
const TRACK_TOOL = join(CORE, "client/web/tools/track-from-capture.mjs");
const OUT_DIR = join(REPO, "tests/fixtures");

const DEFAULT_ROWS = 2000;
const DEFAULT_DIGITS = 6;

// Registers a capture's `sense` block does not carry, per notebook board key.
// firmware/boards/osc-dev-v006/app/src/main.rs is the source for board D; the
// NTC legs never reach meta.json because no capture selects ntc_raw.
const BOARD_EXTRA = {
  "dev-v006-D": {
    vbus_div_top_ohm: 15000,
    vbus_div_bot_ohm: 10000,
    ntc_pullup_ohm: 10000,
    ntc_r25_ohm: 10000,
    ntc_beta: 3950,
    vmotor_bias_nom_counts: 779,
  },
};

function die(msg) {
  console.error(`make-fixture: ${msg}`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = {
    dir: null,
    name: null,
    file: null,
    from: null,
    rows: DEFAULT_ROWS,
    digits: DEFAULT_DIGITS,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) die(`${a} needs a value`);
      return argv[++i];
    };
    if (a === "--name") opts.name = next();
    else if (a === "--file") opts.file = next();
    else if (a === "--from") opts.from = Number(next());
    else if (a === "--rows") opts.rows = Number(next());
    else if (a === "--digits") opts.digits = Number(next());
    else if (a.startsWith("--")) die(`unknown option ${a}`);
    else if (opts.dir === null) opts.dir = a;
    else die(`unexpected argument ${a}`);
  }
  if (opts.dir === null) die("capture directory required");
  return opts;
}

function pickCsv(dir, file) {
  const gz = readdirSync(dir)
    .filter((f) => f.endsWith(".csv.gz"))
    .sort();
  if (file !== null) {
    if (!gz.includes(file)) die(`${file} not in ${dir} (have: ${gz.join(", ") || "none"})`);
    return file;
  }
  if (gz.length === 1) return gz[0];
  die(
    gz.length === 0
      ? `no .csv.gz in ${dir}`
      : `several captures, pick one with --file: ${gz.join(", ")}`,
  );
}

function readMeta(dir, csv) {
  const stem = csv.slice(0, -".csv.gz".length);
  for (const name of [`${stem}.meta.json`, "meta.json"]) {
    const p = join(dir, name);
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  }
  die(`no meta.json beside ${csv}`);
}

function readCsv(dir, csv) {
  const lines = gunzipSync(readFileSync(join(dir, csv)))
    .toString("utf8")
    .split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const header = lines.shift().split(",");
  return { header, lines };
}

// The notebooks' bias: the shunt reading at zero current, taken as the mean of
// `current_raw` over the bridge-off baseline segment (`df[df.seg == 0]`, the
// nb01/nb03/nb04 convention). The servo publishes its own current_bias_counts,
// which the app uses instead; a capture's CSV does not carry that register.
function baselineBias(header, lines) {
  const seg = header.indexOf("seg");
  const cur = header.indexOf("current_raw");
  if (seg < 0 || cur < 0) die("capture needs seg and current_raw columns for the baseline bias");
  let sum = 0;
  let n = 0;
  for (const line of lines) {
    const cells = line.split(",");
    if (cells[seg] !== "0" || cells[cur] === "") continue;
    sum += Number(cells[cur]);
    n++;
  }
  if (n === 0) die("no seg==0 rows to take the baseline bias from");
  return sum / n;
}

// Run the notebooks' own Board over the track. boards.py is loaded by path under
// a private package name so oscnb/__init__.py (pandas, numpy, scipy) stays out.
function notebookConvert(meta, track, bias, digits) {
  const script = `
import importlib.util, json, os, sys, types

nb = sys.argv[1]
pkg = types.ModuleType("oscnb_oracle")
pkg.__path__ = [os.path.join(nb, "oscnb")]
sys.modules["oscnb_oracle"] = pkg
for name in ("servos", "boards"):
    spec = importlib.util.spec_from_file_location(
        "oscnb_oracle." + name, os.path.join(nb, "oscnb", name + ".py")
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules["oscnb_oracle." + name] = mod
    spec.loader.exec_module(mod)
boards = sys.modules["oscnb_oracle.boards"]

req = json.load(sys.stdin)
board = boards.from_meta(req["meta"])
if board is None:
    raise SystemExit("no notebook board matches this capture's sense block")
t, bias, d = req["track"], req["bias"], req["digits"]
rnd = lambda xs: [round(x, d) for x in xs]
json.dump(
    {
        "board": board.key,
        "current": rnd([board.amps(c, bias) for c in t["currentRaw"]]),
        "vbus": rnd([board.vsys_v(v) for v in t["vbusRaw"]]),
        "vdiff": rnd([board.diff_v(a, b) for a, b in zip(t["vmotorA"], t["vmotorB"])]),
    },
    sys.stdout,
)
`;
  const payload = JSON.stringify({ meta, track, bias, digits });
  const out = execFileSync("python3", ["-c", script, NOTEBOOKS], {
    input: payload,
    maxBuffer: 256 * 1024 * 1024,
  });
  return JSON.parse(out.toString("utf8"));
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dir = resolve(opts.dir);
  const csv = pickCsv(dir, opts.file);
  const meta = readMeta(dir, csv);

  const args = [TRACK_TOOL, dir, "--file", csv, "--rows", String(opts.rows)];
  if (opts.from !== null) args.push("--from", String(opts.from));
  const raw = JSON.parse(
    execFileSync("node", args, { maxBuffer: 256 * 1024 * 1024 }).toString("utf8"),
  );

  const { header, lines } = readCsv(dir, csv);
  const bias = baselineBias(header, lines);
  const converted = notebookConvert(meta, raw.track, bias, opts.digits);

  const extra = BOARD_EXTRA[converted.board];
  if (extra === undefined) die(`no BOARD_EXTRA entry for board ${converted.board}`);

  const name = opts.name ?? `${basename(dirname(dir))}-${basename(dir)}`;
  const out = {
    meta: {
      source: raw.meta.source,
      board: converted.board,
      sense: { ...raw.meta.sense, ...extra },
      tick_hz: raw.meta.tick_hz,
      current_bias_counts: bias,
      digits: opts.digits,
    },
    track: raw.track,
    converted: { current: converted.current, vbus: converted.vbus, vdiff: converted.vdiff },
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, `${name}.json`);
  writeFileSync(path, JSON.stringify(out) + "\n");
  const kb = (statSync(path).size / 1024).toFixed(1);
  console.error(`${path}: ${out.track.pos.length} rows, board ${converted.board}, ${kb} KB`);
}

main();
