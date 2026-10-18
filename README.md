# I²C Visualizer

Dependency-free learning tool that generates SCL/SDA waveforms from an I²C transaction configuration. Simulated bus only: no real device is contacted.

## Files
- `index.html` — UI (SVG waveform, annotations, table, cursor, playback, exports, themes)
- `engine.js` — protocol engine, validation, config sanitizing, CSV (no DOM; also loaded by the tests)
- `test/engine.test.js`, `package.json` — automated tests

## Use
Open `index.html` in a browser (`engine.js` must sit beside it). Pick a preset or edit the fields; every change regenerates the waveform, table, annotations and exports. Invalid input hides the waveform, stops playback, disables exports and shows the errors until the input is valid again.

## Test
`npm test` (Node 20+, no packages; uses `node --test`).
Last run: 20 tests, 20 pass, 0 fail (Node v22.22.2). Tests decode the generated SCL/SDA samples with an independent decoder and compare against byte sequences derived by hand from the I²C rules.
Not covered by automated tests: the browser UI, PNG export, clipboard, playback, zoom, cursor dragging and themes. No browser, hardware or simulator testing has been done.

## Supported
7-bit and 10-bit addressing; Write, Read, Write → repeated START → Read; optional STOP; simulated slave address ACK/NACK, NACK of one write byte, custom read data; CSV, PNG, copy summary, saved config.
- 7-bit: transmitted byte = (address << 1) | R/W.
- 10-bit: header `11110 A[9:8] R/W`, then `A[7:0]`. A 10-bit read sends the write-form header and second byte, a repeated START, then the read-form header.
- Reads: master ACKs every byte except the last, which it NACKs. SDA is open-drain: a driver pulls LOW or releases; the pull-up gives HIGH; the ACK bit is shown separately from the 8 data bits.
- An address or data NACK aborts the rest of the transfer and the master issues STOP.

## Timing model
Nominal, not electrical. One bit period = 1/speed; each bit uses quarter-period steps (data changes P/4 after SCL falls, SCL high for P/2, 50% duty). START/STOP edges occur while SCL is HIGH, P/4 before SCL falls / after SCL rises. Speed is limited to 1–1000 kbit/s. Setup/hold times, rise times, bus capacitance and tSU/tHD limits from the I²C specification are not modelled, so no electrical compliance is claimed.

## Unsupported
Clock stretching, multi-controller arbitration, High-speed mode, general call, slave-address-specific behaviour beyond the configured responses.
