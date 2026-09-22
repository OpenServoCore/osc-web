# osc-web

The web GUI for [OpenServoCore](https://github.com/OpenServoCore/open-servo-core) servos. It talks to an osc-adapter over WebUSB through `@openservocore/client`, the wasm build of the host library that lives in the monorepo at `client/web`. Connect the adapter, discover the servos on the bus, and read or write their control tables from the browser.

WebUSB only exists in Chromium-based browsers, so this runs in Chrome (and Edge, Brave, Arc); Firefox and Safari cannot open the adapter. To run it you need Node 26, the Rust nightly toolchain with the `wasm32-unknown-unknown` target, and `wasm-pack`. Clone the monorepo next to this repo as `../open-servo-core`, then `npm run wasm` to build the bindings, `npm ci`, and `npm run dev`. The bindings are a local-path dependency (`file:../open-servo-core/client/web`) until the package is published, which is why the sibling checkout is required and why `npm run wasm` has to run before `npm ci`.

## Without hardware

Open the dev server with `?sim=1,2,3` (any comma-separated list of servo ids; bare `?sim` gives ids 1 and 2) to drive a simulated fleet instead of an adapter. The servos run inside the wasm module, so every page works the same way it does on the bus.

## Tests

`npm test` runs the unit tests, `npm run test:e2e` runs the browser tests headless against the dev server, and `npm run test:e2e:ui` opens the Playwright UI to watch them.

## License

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or [MIT license](LICENSE-MIT) at your option.
