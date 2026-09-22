# osc-web mockup revision 3: layout spec

Approved by the owner. Implemented in the mockup; the sections below are the spec the app follows.

## Decisions (fixed)

- Audience: intermediate-to-advanced hobbyists with a newbie-friendly surface. Friendly look (rounded corners, 16px base, plain sentences, "?" help popovers) lowers the barrier but never strips information. Layered disclosure: [surface] visible at once; [intermediate] one scroll, hover, or drill away, in grey text or tooltips (hex addresses, register names, uid, clock trim, counters are PRESENT, washed out); [advanced] the control table page.
- Desktop only, 1440 px reference width. No responsive collapsing, no mobile breakpoints, no bottom sheets. Below 1024 px viewport width, show a single centred line "Use a larger window" over the app (no adapting).
- Unsupported browser: if `navigator.usb` is missing, render only a single centred card in place of the app body (no tabs, no pane): title "This browser cannot talk to USB", two sentences ("osc-web uses WebUSB, which only Chromium browsers provide." "Use the latest Chrome or Edge on a computer."), and a link. For the mockup, add a query flag `?nousb` that forces this state so it can be reviewed.
- Editing = ONE anchored popover under the clicked value, used by the calibration card and the control table alike: label, "Current: x" grey, control with unit suffix (number input / select / switch), live preview line ("= 1.50 (raw 384)"), validation line reserved at fixed height (red when set), [Cancel] [Save] with Save primary. Enter saves, Escape cancels, click outside cancels, one open at a time, focus moves into the control and returns to the value button on close; value button has aria-expanded. The row under it never changes size or content until Save. Elevation el-2, max-width 22rem. No inline-in-place editors. No dialogs for simple values.
- NO stage/commit batching. Every Save writes immediately; the row flashes green on success.
- Control table = FOUR tabs (Settings, Calibration, Board, Live values) with collapsible groups; quick search pop-under that navigates; id and bus speed read-only there with links; calibration read-only there with a link to the Servo page; byte blobs = summary + Download button.
- Calibration values editable on the Servo page with validation; calibrated status derived; Live units toggle disabled until valid; raw mode applies to position family only (position, goal, velocity), electrical and temperature always real units.
- Live telemetry chart = three fixed panels, max two axes each: Motion (position solid + goal dashed in deg on the left, velocity deg/s on the right), Electrical (current mA left, bus voltage + motor voltage V right), Temperature alone (off by default; when off the panel disappears and the others take the height). Series toggles double as readouts. Keep Stream tab.
- Left pane collapsible (state persisted in localStorage); hidden entirely on the Connect page where servos render as cards.
- Coast/brake not in the GUI. Fleet baud on Connect. Health = parsed statements; keep clock trim and error counters in the grey intermediate layer.
- Keep hex in tooltips and register-name grey subtitles. Keep the Theme page reachable from the settings gear as "Design tokens" (dev), not as a nav tab.
- Theme preference and units preference persist in localStorage (osc-theme, osc-units).

## 0. App shell

Top bar: brand, four tabs (Connect, Servo, Control table, Live). Servo/Control table/Live are disabled (grey, not clickable, tooltip "Connect the adapter first") while not connected, and disabled with tooltip "Pick a servo" while connected but nothing selected. Connection badge top right: dot + "Connected at 1 M" / "Not connected" / "Looking for servos .."; it links to #/connect; hover tooltip lists adapter name, servos found, rails state. Settings gear (icon button): small menu with Theme (auto / dark / light segmented) and a "Design tokens" link to #/theme (the Theme page leaves the tab bar).

Left pane: header "SERVOS", one item per servo, collapse chevron on the divider between pane and main. Collapsed = 44 px rail showing only health dot + id number; clicking the rail expands. Hidden entirely on #/connect (single-column layout); present on the other pages. Pane item expanded: row 1 = health dot + "Servo 2" bold + calibration mini-chip right-aligned (green "cal" tick or grey dashed "raw"); row 2 = grey subtitle showing the most important state, priority: fault text ("Stall detected"), then "Unsaved changes", then "Not calibrated", else nothing. Hover tooltip: model, firmware, hardware revision, serial prefix. Pane footer: "Rescan" link-button and grey "3 servos". Empty pane: not connected = "Connect the adapter to see servos" with link; none found = "No servos found" + Rescan.

Behaviour: selecting a servo keeps the current page and re-renders it; any open popover closes and any open inline confirm collapses on selection change. On disconnect: route to #/connect, clear selection, disable the three servo tabs. Page title row shows "Servo 2" in grey as a link to #/servo.

## 1. Connect page

Layout: two cards side by side (Adapter, Bus), then a full-width Servos section of cards.

Adapter card [surface]: title "Adapter" + help "?" ("The adapter is the USB box the servos plug into. Chrome asks you to pick it."). Status chip after the title (connected / not connected / connecting). Body: adapter name. Not connected: one big primary "Connect adapter" button and nothing else in the card. Connected: "Disconnect" secondary. Grey subtitle [intermediate]: adapter serial prefix (full in tooltip), adapter firmware.

Bus card [surface], hidden (not greyed) while disconnected: title "Bus" + help "?" ("Every servo on the bus must run at the same speed. Power switches feed the servos from the adapter."). Rows: Speed = select + "Apply" (secondary; triggers the confirm); Power = two switches "3V3 logic" and "5V servo". Grey status line [intermediate]: "3 servos answering at 1 M" or "1 servo not answering after the change" with a Rescan link. Speed-change confirm: inline confirm strip replacing the Speed row's right side (red border-left, danger-soft): sentence with the target speed in bold, [Change speed] (danger filled) [Cancel]; Enter/Escape work.

Servos section [surface]: heading "Servos", grey count, "Rescan" link-button right. Grid of servo cards, 3 per row. Card: health dot + "Servo 2" title, calibration mini-chip top right, one subtitle line (same priority rule as the pane), then "Open" (primary, goes to #/servo and selects) and "Live" (secondary, goes to #/live and selects). Card hover tooltip [intermediate]: model, fw, hw, serial prefix. States: not connected = section hidden; scanning = skeleton row of three grey cards with "Looking for servos ..."; none = one dashed empty card "No servos found. Check the 5V switch and the cable, then Rescan."

## 2. Servo page

Header [surface]: "Servo 2" + chip row: fault chip (red, fault text) if any, calibration chip (green "Calibrated" / amber "Not calibrated"), "Unsaved changes" amber chip if set. This is the single status summary; cards below do not repeat it except the Calibration card keeps its own chip.

Two cards side by side: About, Health. Then Calibration (full width). Then Manage (full width).

About [surface]: kv list Model, Firmware, Hardware, Serial, Features. Serial = 8-char prefix with dotted underline; tooltip = full 32-hex uid; click copies and shows "copied" for a second. Features = one comma sentence with missing ones after "- no" (no chips). Grey [intermediate]: firmware build id line. Help "?": "What this board is. Nothing here can be changed."

Health [surface]: statements, one per line, dot + plain sentence, worst first. Faults red with "Clear fault" secondary button on the same line. Amber "Unsaved changes" with a "Save settings" secondary button on the same line (duplicate of Manage on purpose). Green "No faults" / "No sensor errors" when clean. Below a thin divider, grey [intermediate]: "Clock trim +3 steps", "2 CRC errors, 0 dropped frames" with a "Clear" link-button. Help "?": "Faults latch until cleared. The grey lines are counters for the wire; a few CRC errors are normal."

Calibration [surface]: two-column grid: sensor lowest/highest left, angle lowest/highest right, gear ratio and the correction-table fact in row 3. Each editable value is a value button (mono, pencil on hover) opening the popover (preview line "= 118 counts -> 0.0 deg at this end"; validation line red). Invalid or unset values render "not set" in the value button; the issue text appears ONCE as a grey/amber line under the value, and in full inside the popover. Correction-table row read-only grey with the point count, "written by a calibration run" in a tooltip. Bottom right: "Open in control table ->" link to the Calibration tab [advanced]. Help "?": "Five numbers map the sensor to degrees. Degrees appear everywhere once all five are set and make sense."

Manage [surface]: labelled rows, no nested cards. Servo id row: number input + "Assign" (secondary) + grey "addressed by serial, so it also fixes two servos sharing an id. Ids 1 to 249." Settings row: "Save settings" (primary of this card) + "Reboot" (secondary) + grey "Save keeps changes across power off." Divider, "Danger zone" grey subheading, Factory reset row: danger-outline button + grey "erases settings and calibration; comes back as Servo 1 at 1 M." Feedback sentences ("This servo is now Servo 4.", "Rebooting .. back in a moment.", "Settings saved.") replace that row's grey helper text for a few seconds, then revert. Factory reset confirm: inline strip under the row, full card width, [Erase] (danger filled) [Cancel]; collapses on Cancel, Escape, servo switch, page change.

States: after Reboot/Factory, About and Health show skeletons and the header shows a grey "rebooting" chip for ~1.2 s; a servo that stops answering shows one red "Not answering" statement with a Rescan link (mock: not needed beyond the reboot skeleton).

## 3. Control table page

Header: "Control table", grey "Servo 2" link, and the quick search input on the right. Four sub-tabs: Settings | Calibration | Board | Live values (no wrap; selected tab persists per session in localStorage).

Quick search [surface]: typing opens a pop-under listing up to 8 matches: label (bold) + register name (grey mono) + group chip. Arrow keys move, Enter or click selects: switch tab, expand the group, scroll the row into view, flash it (accent-soft). Escape clears. The table body never filters.

Groups: collapsible header = chevron + group name + grey count + help "?" at the far right with one sentence about the group. Click toggles; expanded state persists per session.

Tab contents (map from the descriptor fields already in the file):

- Settings: Identity and bus (id and baud read-only with links "Change on the Servo page ->" / "Change on the Connect page ->"; response_deadline_us editable), Motion limits, Control loops, Safety, Thermal. Motion limits and Safety expanded by default, others collapsed.
- Calibration: one group, all six rows read-only, status strip at top: calibration chip + "Worked out from the values; the servo keeps no date." + "Edit on the Servo page ->". lut_corr shows "55-point table" + "Download .csv" (secondary, small, mock no-op).
- Board: Board constants (shunt, gain, dividers, tick rate, windows, thermistor) read-only, vdd_mv editable; Motor model group (r0, t0, k_r2t, mu, ke, r, recip_ke, b_i, friction) editable, collapsed by default.
- Live values: Status (faults, status flags, clock trim, counters with Clear), Estimates, Raw samples, Commands (editable: torque_enable, mode, goals, tel_mask, tel_count, boot_mode, duty, arm/page/chans), Profile/capture (collapsed by default). Read-only groups show grey "updated 0.4 s ago" in the tab header (mock: tick it).

Row: label bold in column 1 with grey mono register name beneath [intermediate]; tooltip on the register name "addr 0x020, 4 bytes, int32, rw". Value in column 2 mono; read-only values get a tiny grey "ro" tag right of the value. Editable value = value button with pencil on hover -> popover. Save writes immediately; row flashes green.

States: skeleton group while loading (mock: brief on servo switch), red strip "Could not read the table. [Retry]" (mock: not needed), "Pick a servo in the left pane." when none selected.

## 4. Live / Telemetry

Layout: chart card left (fills), sticky control cluster right (300 px).

Chart card [surface]: title "Telemetry", grey "8 Hz, last" + window select (4 s / 10 s / 30 s), "Pause" toggle button (secondary, becomes "Resume"), "Table" secondary button opening a pop-under with the last 16 rows (chart stays). Help "?": "A rolling view of what the servo reports. Hover the chart to read one instant."

Panels: Motion (position solid, goal dashed same hue, velocity on the right axis, title "Motion deg | deg/s"), Electrical (current left; bus voltage and motor voltage right in the neutral context colour with different dash; title "Electrical mA | V"), Temperature (single axis; hidden entirely when its series is off). Keep end-value labels and the crosshair tooltip; the chart fills the viewport height (max(60vh, 100vh - 18rem)).

Control cluster: Goal position block first: big mono readout, slider + number input, scale labels, "Hold position" switch. Help "?": "Where the servo should go. Hold keeps it there; off lets it turn freely." Then Units segment Real / Raw (disabled, forced Raw, tooltip "Calibrate the servo first" when not calibrated; a grey line "Not calibrated - showing counts" with a link to #/servo replaces the chip). Then Series list: seven rows (position, goal, velocity | current, bus V, motor V | temperature) grouped by panel with thin dividers and tiny grey panel names; checkbox, colour key, label, mono readout right-aligned. Motor V and temperature off by default. Raw applies only to position, goal, velocity.

States: "waiting for data" grey text over an empty grid before the first sample (mock: show briefly on servo switch), page unreachable when disconnected.

## 5. Live / Stream

Layout: Capture card left (360 px), burst chart card right (fills, chart height like Telemetry).

Capture card [surface]: help "?" on the title ("Records every control tick for a few milliseconds, far faster than Telemetry. Pick the fields, arm it, then move the goal."). Field pills (Position, Current, Bus V, Motor A, Motor B). Samples number input + grey "of 120". Start select. "Arm" primary (becomes "Disarm" danger-outline while armed); state chip next to it: ready / armed / capturing / captured. Grey summary sentence under the button ("2 fields x 60 samples = 7.5 ms at 8 kHz"). Grey mono line [intermediate]: resulting tel_mask hex and tel_count.

Burst chart card [surface]: title "Last burst", grey subtitle "60 samples, 7.5 ms, 12:04:31". Actions: "Download .csv" (secondary) and "Table" pop-under. One panel per captured field family; crosshair tooltip. Units follow the Telemetry toggle. States: no capture yet = dashed empty box "Arm a capture to see a burst here"; armed = thin amber strip "Waiting for the goal to change ..." with a Disarm link.

## 6. App-wide widget conventions

Card anatomy: title (fs-md 600) left; status chip directly after the title only when it describes the card's subject; help "?" icon button at the far right of the title row; optional grey subtitle on the title line for one fact. Body: kv lists, grids, statement lists, or a chart; never a nested card. Sub-sections divided by a 1 px border with a small grey uppercase subheading. Actions: the card's primary action left-most in its row; secondary follow; danger alone in a "Danger zone" subsection. Feedback: a grey note under the action row that swaps in the result sentence for a few seconds, then reverts. No toasts.

Secondary text: grey subtitle (text-3, fs-sm) for glance facts; tooltip for long or rare facts (full serial, addr/width/type, tel_mask hex, why a control is disabled); hover reveal only for affordances (pencil, copy icon), never for information. Mono tabular numerals for values; sans for labels and sentences.

Button hierarchy: at most one filled primary per card (Connect adapter, Open, Save in popover, Save settings, Arm). Everything else outlined secondary. Danger outline for Factory reset, Disarm, and the confirm trigger; danger filled only inside a confirm strip. Link-buttons for navigation and counter Clear.

Help "?": 20 px circled question mark right of a title or control label; click opens a small popover (el-2) with one or two plain sentences; hover shows the same as a tooltip. On every card title and every control-table group header.

Confirm pattern: inline strip (danger border-left, danger-soft) expanding under the triggering control, one sentence with the target in bold, [danger verb] [Cancel]; Enter confirms, Escape cancels; collapses on servo switch, page change, disconnect. Used for bus speed change and factory reset only.

Empty / loading / error: loading = skeleton bars; empty = one grey sentence in a dashed box with the fixing action; error = red strip at the top of the card with one sentence and Retry.

## 7. Moves and removals (apply)

- Pane subtitle "osc-servo - 0.1.0" -> tooltip; row shows state instead.
- Identity capability chips -> one Features sentence.
- Clock trim and counters -> grey lines below a divider in Health.
- "Show as table" -> Table pop-under.
- Theme page and theme button -> settings gear menu.
- Profile/capture registers -> collapsed group in Live values. Motor model constants -> collapsed group in Board.
- Bus voltage and motor voltage -> Electrical panel; goal -> dashed Motion series; faults -> header chip and pane subtitle.
- "Not calibrated" -> Servo header chip, servo card on Connect, pane mini-chip. "Unsaved changes" -> carries Save settings next to it.
- REMOVE: stage checkbox, staged row highlight, Commit/Discard footbar; inline-in-place editors; "Open editor" dialog; ten address tabs; editable id and bus speed rows; duplicate "not set" text.

## Mock data

Keep servos 1 (invalid calibration: swapped sensor range), 2 (calibrated, stall fault, unsaved changes), 7 (blank calibration). Keep the simulated telemetry, the seeded step response paused at load, Run/Pause behaviour, and the burst simulation. Add goal, bus voltage and motor voltage series to the buffers.

## Amendments after revision 3

Decided after the mockup review; where these conflict with the sections above, the amendment wins.

- No Connect page. The home route is a Dashboard of clickable servo cards: "ID n", health dot, calibration mini-chip, position / temperature / current / bus voltage, a status line, and a grey footer with serial and model/firmware. The whole card is the link. Empty states: not connected shows a Connect button; scanning shows skeleton cards; none found shows "No servos found" with Rescan.
- Connection lives in a popover, not a page: adapter name and status, serial and firmware in grey, Connect/Disconnect, a Rescan button with a spinner state, the power switches, the speed select with Apply and its inline confirm inside the popover, and a grey "N servos answering" line. It opens from the sidebar's Connection footer row and auto-opens on a disconnected boot.
- One white sidebar sheet on every page: rounded, subtle shadow, inset from the viewport, full height. Top to bottom: brand; nav Dashboard / Servo / Control table / Live with lucide icons; a collapsible "Servos" group listing "ID n" rows with status indicators (fault badge red, unsaved amber, "raw" grey dashed when not calibrated) and a Rescan button under the list; footer rows Connection and Settings (theme segment plus the Design tokens link). A round chevron on the sheet's right edge collapses it to an icon rail with tooltips (shadcn Sidebar, collapsible="icon"). No top bar; page headers carry the titles.
- Naming: "ID n" everywhere a servo is named, always with the servo glyph. More icons overall: status icons on statements and chips, icons on card titles and physical-action buttons, one monochrome line style (lucide).
- No Table pop-unders on Telemetry or Stream. Help "?" only where the content is non-obvious: Calibration, Health, Capture, and the control-table groups Control loops, Safety, Thermal, Motor model, Profile. Tooltips and popovers are positioned by Radix, preferring bottom-right where it matters.
- Desktop only. An unsupported browser (no `navigator.usb`) renders a single full-page card and nothing else.
