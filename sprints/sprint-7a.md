# Sprint 7a Archive — pokeportal Cart Mode (read-only)

**Status**: PASS (archived 2026-04-22, GBA additions HIL-validated 2026-04-23).
Hardware-validated end-to-end on GBxCart RW v1.4a/b/c PCB R42+L14
firmware reading both Pokemon Red (Gen 1, MBC3) and Pokemon Ruby (JP,
Gen 3 with 128 KB Flash) over CH340 USB-serial bridge on Arch Linux.
**Scope**: GBxCart RW Web Serial protocol layer (BOTH stock insidegadgets
firmware AND Lesserkuma's L-CFW extension), `SaveSource` interface
symmetric to S6a's frozen `SaveSink`, BackupSink decorator with
`showSaveFilePicker`+`<a download>` fallback, Mode toggle (Upload/Cart),
cart-read flow that populates the same source/dest panes as Upload Mode.
Read-only — no flashing, no staging-box (those are S7b).
**Test outcome**: 484 tests passing (384 core + 100 web), 1 permitted
skip. Web bundle 51.7 KB gzipped (cap 200 KB; +9 KB vs S6a transfer-zip
flow).
**Previous sprint**: S6a + transfer-zip polish.
**Next sprint**: S7b — staging-box + cart-write flash flow with mandatory
pre-flash backups.

---

## Retrospective amendments (binding for S7b and any future cart work)

These corrections were learned the hard way during ~2 hours of
hardware-in-the-loop bisection against a real R42+L14 cart. The PLAN
and PLAN_EVAL spec for S7a got the wire format wrong in multiple
places — only HIL testing surfaced the real protocol shape. Anyone
extending the cart code MUST treat these as binding.

### AMEND-S7a-1 (CRITICAL): Stock InsidegadgetsProtocol wire format

The PLAN's `Console_Interface_v1.36/setup.h` opcode table got several
bytes wrong. Verified against upstream:

- `'V'` (0x56) — single-byte command, returns ONE byte (the firmware
  version as uint8). NOT a banner string. Earlier impl waited for a
  newline that never came → 798ms timeout on every probe.
- `'h'` (0x68) — same single-byte pattern, returns PCB version uint8.
- `READ_ROM_RAM` is `'R'` (0x52), NOT `'M'` (0x4d). PLAN had it wrong.
- `GBA_READ_SRAM` is `'m'` (0x6d), NOT `'r'` (0x72) — `'r'` is
  GBA_READ_ROM, a totally different command.
- Multi-byte commands (`A<addr>`, `B<value>`, `W<byte>`) terminate with
  **NUL** (0x00), NOT newline (0x0a). Per upstream `set_number()` in
  setup.c. Using `\n` leaves the firmware waiting for terminator and
  silently dropping subsequent reads.
- Bulk-read continuation byte = `'1'` (0x31), stop = `'0'` (0x30).
  Earlier impl had them reversed — sending '0' as continuation made the
  firmware stop after 64 bytes, then we'd hang waiting for the next 960.
- Firmware streams EXACTLY `FIRMWARE_BLOCK = 64` bytes per continuation
  byte. The bulk-read loop must be: send 'R', read 64, send '1', read
  64, send '1', ... read final 64, send '0'. Asking for 1024 in one
  shot doesn't work — the cart sends 64 then waits.
- For R26+ firmware (PCB v1.4+), voltage byte alone latches the cart
  mode — sending the legacy `'G'`/`'g'` cart-mode byte AFTER the
  voltage byte leaves the cart bus unpowered (subsequent reads return
  all zeros).

### AMEND-S7a-2 (CRITICAL): LK FlashgbxProtocol wire format

Carts running `Rxx+Lyy` CFW respond to V with the stock OFW byte for
back-compat AND respond to LK opcodes. Detect MUST always probe LK
after a successful V byte (don't short-circuit to InsidegadgetsProtocol
just because V worked).

- `QUERY_FW_INFO` (0xA1) is a **SINGLE byte** command. Earlier impl
  sent a 9-byte frame; the firmware interpreted each pad byte as a NUL
  no-op, emitted 8 acks, those polluted subsequent ack reads with stale
  0x01s.
- Response framing: `[size:u8=8][cfw_id:u8 'L'][fw_ver:u16 BE]`
  `[pcb_ver:u8][fw_ts:u32 BE]` then for L>=12 `[name_len:u8][name:bytes]`
  `[cart_power_ctrl:u8][bootloader_reset:u8]` plus undocumented extra
  trailing bytes (3 bytes observed on L14/PCB6). Drain whatever's left
  in the buffer after parsing or the next ack-read sees stale data.
- `SET_VARIABLE` (0xA6) format: `[opcode][size_byte][key u32 BE]`
  `[value u32 BE]` (10 bytes). Value is ALWAYS 4 bytes BE regardless
  of size — `size` only tells the firmware how many of those 4 bytes
  are meaningful.
- `GET_VARIABLE` (0xAD): `[opcode][size_byte][key u32 BE]` (6 bytes),
  reads 4 bytes BE response.
- ACK semantics: 0x01 = ok, 0x03 = ok-with-data-pending, 0x02 =
  firmware error reported, anything else = corruption.

### AMEND-S7a-3 (CRITICAL): LK baud upgrade is mandatory for PCB 5/6/101

PCB 5/6/101 firmware silently drops every SET_VARIABLE issued at 1M
baud — gives no ack, no error, just timeout. The required dance per
FlashGBX `hw_GBxCartRW.Initialize` / `ChangeBaudRate`:

1. Open Web Serial port at 1M
2. V / QUERY_FW_INFO at 1M
3. TX `OFW_USART_1_5M_SPEED` (0x3E) at 1M — no ack
4. **Close + reopen** the host-side Web Serial port at 1.5M
5. Re-acquire the FrameReader on the fresh streams
6. ALL SET_VARIABLE / SET_VOLTAGE / CART_PWR_ON / read traffic at 1.5M

Without the close+reopen, the host sends bytes at 1M but the firmware's
UART is now at 1.5M → all subsequent commands are misframed as garbage.

The reverse downgrade (TX `OFW_USART_1_0M_SPEED` 0x3C + reopen at 1M)
must run during cleanup, otherwise the cart stays at 1.5M after
disconnect and the next session can't handshake without a physical
cart power-cycle.

The Port abstraction grew an optional `reopenAtBaud(baudRate)` method
to support this. Mock ports omit it (the protocol falls back to
single-baud no-op). The browser-side `serialPort.ts` implements it via
`sp.close()` + `sp.open({baudRate})` + 1500ms DTR-reset settle.

### AMEND-S7a-4 (CRITICAL): LK DMG_READ_METHOD/AGB_READ_METHOD aren't optional

Default firmware values are 0 which return interleaved/every-other-byte
data — the Nintendo logo at offset 0x104 comes back with bytes from
addresses 0x105, 0x107, 0x109, ... instead of 0x104, 0x105, 0x106, ...
Cart-header parser then fails with "no Nintendo logo, no GBA game code"
even though the cart is responding correctly.

Required setup BEFORE any read:
- `SET_VAR DMG_READ_METHOD = 1` (standard MBC read path)
- `SET_VAR AGB_READ_METHOD = 2` (FlashGBX's documented value)

### AMEND-S7a-5 (IMPORTANT): Web Serial port lifecycle quirks

- `navigator.serial.requestPort` caches granted permissions per origin.
  On reload mid-session it may hand back a SerialPort that's still
  open from before. Defensive `try { sp.close() } catch {}` BEFORE
  `sp.open()` avoids cryptic "port is already open" errors.
- DTR toggles on `sp.open()` reset the cart's UART firmware. Wait
  ~1500ms after open before sending the first command, otherwise the
  V probe lands during the bootloader window and times out.
- When the host calls `sp.close()` + `sp.open({newBaud})`, the
  SerialPort gets fresh `readable`/`writable` streams. Any outstanding
  reader from the old streams becomes invalid. The Port wrapper uses
  getters (not direct refs) so the protocol layer always sees the
  current pair, but the FrameReader still needs to release its old
  reader BEFORE the close (Web Serial errors on close while a reader
  holds the lock).

### AMEND-S7a-6 (IMPORTANT): Linux ModemManager interferes with USB CDC

On most Linux distros (Arch with NetworkManager, Ubuntu defaults, etc.)
ModemManager auto-probes every new ttyACM/ttyUSB device with AT
commands. The GBxCart firmware doesn't speak AT, so the probe causes
"the device has been lost" errors in Web Serial during the first few
seconds after plug-in.

Documented mitigation (mirrors FlashGBX's troubleshooting docs): add a
udev rule that tags the GBxCart's USB IDs with `ID_MM_DEVICE_IGNORE=1`.
S7b should put this in the README as a one-line install snippet.

### AMEND-S7a-7 (IMPORTANT): `?debug=1` URL param is essential infrastructure

The wire-level debug logger (TX/RX hex dump + ASCII + protocol-event
log, gated on `?debug=1`) was added mid-session and immediately paid
for itself — every protocol bug after that point was diagnosed in 1-2
round-trips by reading the trace, instead of 5+ rounds of guessing.
Keep it in. Future cart-protocol work should always tell the user to
load with `?debug=1` when bisecting a hardware issue.

### AMEND-S7a-8 (forward-carried to S7b): SaveSink freeze still holds

`core/src/sav/gen3/saveSink.ts` is not modified. The new `SaveSource`
in `core/src/cart/saveSource.ts` is symmetric (signal + onProgress +
returns `{bytes, metadata}`). S7b's `GbxCartSink` will implement
`SaveSink` exactly as defined.

### AMEND-S7a-9 (forward-carried): protocol cleanup() hook

`CartProtocol` grew an optional `cleanup(): Promise<void>` for
async pre-close work. FlashgbxProtocol uses it to downgrade baud back
to 1M. S7b's flash flow will use it to send any post-write voltage-off
or cart-power-off sequence before disconnect.

### AMEND-S7a-10 (CRITICAL — GBA AGB protocol): bus width, opcodes, and Flash banking

GBA carts (R/S/E/FR/LG) work fundamentally differently from DMG/GBC
on the LK protocol surface. Burned ~3 hours of HIL bisection with the
user's Pokemon Ruby JP cart to nail down the differences:

- **Use AGB_CART_READ (0xC1) for ROM reads, NOT DMG_CART_READ (0xB1).**
  Earlier impl's `readRom` was hardcoded to DMG, returning all-zero
  data on AGB carts.
- **AGB ADDRESS is in 16-bit words, not bytes.** Caller must shift the
  byte address right by 1 before passing to setVar('ADDRESS', ...).
  This is because the GBA cart bus is 16-bit (two bytes per address
  tick). DMG bus is 8-bit (one byte per address tick).
- **No DMG_ACCESS_MODE setvar for AGB.** That variable is DMG-only;
  the AGB opcode (0xC1 ROM, 0xC3 SRAM) determines the bus routing
  directly.
- **All Pokemon R/S/E/FR/LG use 128 KB Flash, not flat SRAM.** The Flash
  chip exposes a 64 KB window via bank-switching. To read 128 KB:
  - Switch to bank 0 via the JEDEC sequence:
    `cart_write 0x5555=0xAA → 0x2AAA=0x55 → 0x5555=0xB0 → 0x0=0`
  - Read 64 KB via AGB_CART_READ_SRAM
  - Switch to bank 1 (last byte = 0x01) and read another 64 KB
  Without bank-switching, the second 64 KB returns whatever bank was
  last selected (often a duplicate of bank 0). Pokemon parsers see
  garbage because slot B's data is missing.
- **Each cart-write uses LK SRAM-write framing.** TRANSFER_SIZE=1,
  ADDRESS=<flash addr>, then AGB_CART_WRITE_SRAM (0xC4) opcode + 1
  byte value + ack. FlashGBX's L>=6 firmware optimises this via the
  bulk SET_FLASH_CMD (0xA7) opcode that sends multiple writes in one
  frame; we don't use that yet because per-byte writes work fine for
  the 4 bytes per bank-switch (negligible perf cost).

### AMEND-S7a-11 (CRITICAL — Web Serial wire shape): TRANSFER_SIZE must match USB CDC packet boundary

Long, painful HIL lesson: **TRANSFER_SIZE must stay at 64 bytes**
(matching FlashGBX upstream, matching the USB CDC bulk endpoint MPS).
Any larger and Chrome's Web Serial stream API delivers overlapping or
duplicated sub-chunks per ReadableStream `read()` call.

Symptom from a misguided "optimisation":
- Set TRANSFER_SIZE=1024 thinking fewer round-trips would reduce noise
- Cart-read returned 304-316 bytes for a requested 336-byte transfer
  (lost 20-32 bytes per request)
- Trace showed chunk 9 (32 bytes) ending in `40 00 11 e2`, then chunk
  10 (28 bytes) starting with `80 00 11 e2 27 00 00 1a 04 c0 8c e2 40
  00 11 e2` — the LAST 16 BYTES of chunk 9 were repeated as the FIRST
  16 BYTES of chunk 10, then the actual continuation. Net: 16 bytes
  lost.

This is Chrome-specific behaviour with USB CDC ACM at TRANSFER_SIZE >
64. pyserial doesn't have the same problem because of different
buffering semantics. Stick to 64-byte chunks for AGB AND DMG paths.

### AMEND-S7a-12 (IMPORTANT — Web Serial port reuse): defensive close-before-open

`navigator.serial.requestPort()` caches granted permissions per origin.
On reload mid-session, or after an error path that doesn't reach the
finally-block close, the SerialPort can be returned still-open — the
subsequent `sp.open()` then throws "The port is already open." Wrap
the open with a defensive `try { sp.close() } catch {}` first.

### AMEND-S7a-13 (forward-carried): JP / non-English Gen 3 carts

The `charmap3.ts` we vendored is the English Gen 3 character map.
Japanese Pokemon Ruby (game code AXVJ) box names render as `????1`
because the cart's bytes don't decode under the English table.
S7b (or a follow-up cleanup) must:
- Add `charmap3JP.ts` (port from PKHeX's `StringConverterGen3JP`).
- Detect the JP variant from the cart's game_code (last char 'J').
- Pass the detected charmap into `decodeGen3BoxName(s)` as a parameter
  (currently hardcoded to English). May need similar treatment for
  trainer name + nickname decoders.

### AMEND-S7a-14 (forward-carried): Hoenn sprite vendoring (ndex 252-386)

`web/public/sprites/gen3/` only contains ndex 1-251 (Kanto + Johto)
PNGs from PokeAPI. Pokemon Ruby/Sapphire/Emerald players will mostly
have Hoenn species (252-386); these render as a `?` placeholder in
the dest box browser (per AMEND-S7a-9). Vendor the missing PNGs from
PokeAPI's Emerald sprite set as a follow-up.

---

## What shipped

**Core (`core/src/cart/`)** — 12 new files, ~1500 LoC:
- `types.ts` — Port duck-type (with optional `reopenAtBaud`),
  CartIdentity, CartError class, FirmwareInfo, options shapes
- `saveSource.ts` — new `SaveSource` interface (mirror of `SaveSink`)
- `fileUploadSource.ts` — `FileUploadSource` so Cart Mode and Upload
  Mode share the same source-side abstraction
- `gbxCartSource.ts` — `GbxCartSource` — wraps a `CartProtocol`,
  reads cart header + SRAM, surfaces progress
- `protocol/framing.ts` — `FrameReader` (acquire/release/readExactly/
  readUntil/flush) + `writeAll` + timeout helpers; ALL TX/RX bytes
  flow through the debug log when enabled
- `protocol/debug.ts` — wire-level logger gated on `setCartDebug(true)`
- `protocol/insidegadgets.ts` — stock OFW (ASCII opcodes per AMEND-S7a-1)
- `protocol/flashgbx.ts` — LK CFW (binary opcodes + fw-variable register
  interface + baud-upgrade dance per AMEND-S7a-2/3/4)
- `protocol/detect.ts` — autodetect: V byte then ALWAYS probe LK
- `protocol/cartHeader.ts` — Nintendo-logo probe + GBA game-code probe

**Core tests** — 6 new test files:
- `protocol/__tests__/framing.test.ts`, `cartHeader.test.ts`,
  `insidegadgets.test.ts`, `flashgbx.test.ts`, `detect.test.ts`,
  `conformance.test.ts` (both protocols pass the same swap-test suite)
- `__tests__/gbxCartSource.test.ts` (round-trip from a stubbed protocol
  to the existing fixture saves)

**Web (`web/src/cart/` + `web/src/ui/`)** — 6 new files:
- `cart/serialPort.ts` — `requestCartPort()` Web Serial wrapper with
  defensive close-before-open + 1500ms DTR settle + the `reopenAtBaud`
  impl
- `cart/browserCompat.ts` — `isWebSerialAvailable()`,
  `isSaveFilePickerAvailable()`, fallback explainer text
- `cart/cartReader.ts` — top-level read coordinator; calls protocol
  cleanup BEFORE port.close() in the finally block
- `cart/backupSink.ts` — BackupSink decorator with picker/download
  fallback (per Q3) + the hidden "Test backup" debug exerciser
- `ui/modeToggle.ts` — Upload/Cart segmented control
- `ui/cartProgress.ts` — read-progress overlay

**Web state extensions** (additive, all S5/S6a tests still pass):
- `mode: 'upload' | 'cart'` (default 'upload')
- `cartConnection: { variant; deviceId } | null`
- `cartReadProgress`, `cartReadError`

**Bundle**: 51.7 KB gz (was 42.7 → +9 KB; cap 200 KB).
**Tests**: 484 (+22 core + 21 web vs S6a).

---

## What did NOT ship (deferred to S7b or later)

- **Cart write / flash** — S7b's main deliverable. The protocol layer
  has writeSram() impls for both firmwares, but they're not wired into
  the cart-mode UI yet (they're called from BackupSink's decorator test
  path and that's it).
- **Persistent staging box (IndexedDB)** — S7b. Per
  `project_pokeportal_s7_cart_mode.md` memory: cart pane LEFT, temp
  staging RIGHT.
- **Mandatory pre-flash backup** — S7b. BackupSink is built and unit-
  tested; just needs to be wired into the (yet-to-exist) cart-write
  flow.
- **Vendoring 252..386 Gen 3 sprites** — still deferred from S6a.
- **Gen 1/2 charmap divergence (GitHub issue #1)** — still deferred.
- **64 KB single-slot Gen 3 .sav fixture-backed test** — still deferred
  from S6a (helper supports it, no fixture to back the assertion).

---

## Hardware-in-the-loop validation (what worked end-to-end)

Confirmed by the user (Joel) on 2026-04-22:
- Plug in GBxCart RW v1.4a/b/c with R42+L14 firmware on Arch Linux
- Tunnel served via cloudflared (HTTPS) so Web Serial is exposed
- Click "Cart Mode" → "Connect cart"
- Browser shows port picker filtered to known GBxCart VID/PID set
- Selection succeeds → 1500ms DTR settle → V probe at 1M
- LK QUERY_FW_INFO probe → identifies as L14
- TX 0x3E → close+reopen at 1.5M → all SET_VARs ack 0x01
- Pokemon Red cart bytes flow back, Nintendo logo + "POKEMON RED"
  title parse correctly, source pane populates
- Disconnect cleanly downgrades baud back to 1M; subsequent connects
  work without cart power-cycle

---

> Sprint 7a PLAN.md and PLAN_EVAL.md are preserved in git history at
> commit `84540e1` (planner + evaluator). EVAL.md is preserved at the
> archiving commit. Read via `git show 84540e1:PLAN.md`,
> `git show 84540e1:PLAN_EVAL.md`, `git show <archive>:EVAL.md`.
