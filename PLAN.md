# PLAN.md — Sprint 7a: Cart Mode (Web Serial GBxCart adapter, read-only) + S7b: staged-flash + persistent staging box

## §1 Sprint contract

**Goal.** Replace the single-shot file-upload flow with a real cart-mode workflow: source cart in → user picks mons → mons land in a persistent right-pane "staging box" → user commits to source cart (mandatory pre-flash backup, then flash with selected mons deleted) → user swaps to destination cart → user places staged mons into chosen Gen 3 box+slot positions → user commits to destination cart (mandatory pre-flash backup, then flash with mons injected). Upload Mode (S6a) remains as a Web-Serial-less fallback and a sibling top-level mode.

**In scope (the union — see §2 for slicing).**
- New `core/src/cart/` module: GBxCart RW USB-CDC-ACM serial protocol implementation (R3+ firmware), framed over Web Serial. Pure-TS, no DOM, no `navigator.serial` reference inside `core/` — the Web Serial port object is dependency-injected.
- New `GbxCartSource: SaveSource` (read SRAM from cart) and `GbxCartSink: SaveSink` (write SRAM to cart). Both honour `signal: AbortSignal` + `onProgress`.
- Symmetric `SaveSource` interface (re-spec'd; the S3a-frozen stub at `core/src/types/sav.ts:73` is widened to mirror the S6a-frozen `SaveSink` shape — `signal`/`onProgress`, plus a `kind: 'file' | 'serial'` discriminator promised by AMEND-S3a-2).
- New `web/src/cart/`: browser-side adapter that owns the `navigator.serial` port lifecycle, `open()` / `close()` / `forget()`, port-disconnect handling, and progress-overlay rendering during multi-second reads/writes.
- Persistent staging box (right pane) — IndexedDB-backed list of `{pk3 bytes, source-cart provenance, display metadata, sourceRef}`. Survives page reloads between cart-out and cart-in.
- Mandatory pre-flash backup: before EVERY cart write, full pre-write cart bytes are downloaded to `${cart-game}-${cart-tid}.backup-pre-${YYYYMMDDHHmmss}.sav`. Non-dismissable.
- Mode toggle at the top of the app: `[Upload Mode] [Cart Mode]`. Cart Mode is greyed out + tooltip-disabled in non-Chromium browsers (`'serial' in navigator === false`).
- Cart-mode UI flows: connect → progress overlay → trainer card + box browser (reuse S5/S6a renderers) → stage / place / commit interactions.
- Atomic commit (multi-mon delete in one cart write per side; see §6.5).
- All existing Upload Mode behaviour (S3a + S5 + S6a + S6b transfer-zip flow) preserved end-to-end, gated behind the mode toggle.

**Out of scope.**
- The post-S7 animation sprint (red recall + GS Ball + Trade Pipe). S7's left-pane = cart, right-pane = staging invariant is honoured to set that sprint up, but no animations are designed or implemented here.
- International (JP/FR/DE/IT/ES) cart support. English only.
- Mobile / touch-only cart UX. Desktop-with-USB-cart only.
- Audio cues. Silent UI continues.
- Firmware version detection beyond R1/R2 reject + R3/R4 accept (no firmware flashing, no version-specific adaptive command sets beyond what R3+ commonalities cover).
- Gen 3 sprite vendoring for species 252..386 (still AMEND-S6a-5 carryover).
- 64 KB single-slot Gen 3 cart write. Gen 3 cart reads return 128 KB for FR/LG/E and 128 KB or 64 KB for R/S; writer per S6a already handles the parity.
- `regionalDexWarning()` per-species pin test (AMEND-S6a-5 carryover).
- Gen 1/2 charmap divergence fix (AMEND-S6a-6 carryover).

**Done when.**
1. `bun install && bun test` is green across `core/`, `tests/`, `web/`. All 413 existing tests still pass; ≥45 new tests added (see §10).
2. `bun run --filter web build` produces `web/dist/` and `bun test web/src/__tests__/bundle-size.test.ts` passes (≤ 200 KB gzipped — current 42.7 KB; budget allows ~+150 KB).
3. With a real GBxCart RW (R3+ firmware) plugged in: the user opens the app, clicks `[Cart Mode]`, clicks `Connect cart`, picks the device in the browser's port picker, and within 30 s sees the source cart's trainer + boxes rendered identically to Upload Mode (same `boxBrowser.ts`, same per-cart sprite art).
4. Stage → commit → swap → place → commit produces a destination cart that, when re-read, contains the staged mons in the chosen slots; the source cart re-read shows them removed; both pre-flash backups are sitting in the user's Downloads folder.
5. Reload the page in the middle of a cart swap (after staging, before destination connect): the staging box restores from IndexedDB on next load and the user resumes from "insert destination cart" state.
6. Firefox: `[Cart Mode]` is disabled with tooltip `Cart Mode requires Chromium-based browser. Use Upload Mode.`; Upload Mode flow is byte-identical to S6a/S6b.

---

## §2 Slicing decision: SPLIT into S7a (this sprint) + S7b (next sprint)

**Recommendation: split.**

| | S7a — `core/src/cart/` + read-only Cart Mode | S7b — staged-flash + persistent staging + dest commit |
|---|---|---|
| Risk | Hardware: GBxCart firmware, Web Serial Chromium quirks, USB CDC framing | UX state machine: 8-state cart-swap flow, IndexedDB persistence, mandatory-backup race, atomic-multi-delete |
| External dep | Real GBxCart RW R3+ + a real Gen 1/2 cart | Same hardware + a real Gen 3 cart |
| DoD-shaped halt point | "I can read my cart and see my mons in the browser, identical to Upload Mode" | "I can move 5 mons from my Crystal cart into Box 13 of my Emerald cart, with both backups on disk" |
| Ships independently | Yes — falls back to upload for write side | No — depends on S7a's `GbxCartSource`/`Sink` |
| Bundle delta | ~+30 KB (protocol + Web Serial wrapper) | ~+30 KB (staging-box UI + IndexedDB schema + mode toggle) |

**Justification.**
1. **Risk isolation.** S3a/S3b's split was justified by the same logic — file-upload was a self-contained vertical and cart was hardware risk on top. S7a inherits that. The Web Serial port lifecycle, the protocol's framing, the firmware-version detection, and the read-progress UX are *all* hardware-shaped failure modes that should not block the staged-flash UX from shipping.
2. **DoD-shaped halt points.** S7a's halt point ("I can see my cart's contents in the browser") is independently testable with the user's own hardware before a single line of staging-box code is written. S7b's halt point ("I can complete a cart-to-cart trade") then layers strictly on top.
3. **The user's stated S7 scope IS the union — but the dependency graph is staged.** The user said "next sprint after this i want Cart Mode". They didn't promise it had to be one sprint. The two-sprint slicing keeps the ship velocity that S3a/S3b achieved without inflating the FAIL surface.
4. **The frozen `SaveSink` (AMEND-S6a-4) explicitly anticipates this.** S6a froze the sink interface specifically so a `GbxCartSink` could "drop in" later without retroactive widening — i.e., the architecture already assumed cart writes ship in a discrete step from the staging UX.
5. **S7b's atomic-commit + persistent-staging is a coherent unit.** Splitting them further would mean shipping a staging box whose mons can't be flashed, which is worse than no staging box at all.

**What ships in S7a (this PLAN's primary deliverable).**
- `core/src/cart/` module: protocol primitives, framing, command set for GBxCart R3+, `GbxCartSource` (SaveSource impl) AND `GbxCartSink` (SaveSink impl — both protocol implementations land together because they share the same framing/transport; there's no engineering reason to split them across S7a/S7b. `GbxCartSink` is shipped but only minimally exercised — it's wired into `BackupSink` for the pre-flash backup test, not yet hooked into the staging-box commit flow).
- Web Serial wrapper (`web/src/cart/serialPort.ts`) that vends a Port object the core protocol code can `read()`/`write()` against.
- `web/src/cart/cartConnector.ts`: `Connect cart` button → port picker → `parseSave(bytes)` → renders source-pane via existing `boxBrowser.ts`.
- Pre-flash backup machinery (`web/src/cart/backupSink.ts`) — a `SaveSink` decorator that downloads the pre-write bytes BEFORE delegating to its inner sink.
- Firmware version probe + R1/R2 hard-reject dialog.
- Mode toggle + browser-compat fallback.
- All Cart Mode UI for read-only: connect, progress overlay, disconnect handling.

**What S7a explicitly defers to S7b.**
- The persistent staging box (right pane).
- The `Stage` button in the comparison overlay.
- Multi-mon atomic delete + commit flow.
- The destination-cart `Place in box N slot M` UX.
- Cross-page-reload state restoration.

**S7a alone is a complete deliverable.** Cart Mode in S7a lets the user read their cart, browse it, click any mon, see the conversion comparison, and download a `.pk3` (existing S5 behaviour). Writing requires Upload Mode for one more sprint.

The remainder of this PLAN documents S7a in full. S7b is sketched in §6.6–§6.8 and §7 so the planner-eval reviewer can sanity-check that the S7a interfaces support the S7b flows; the actual S7b sprint will get its own PLAN.

---

## §3 Directory layout (S7a)

Do NOT touch existing S1/S2/S3a/S5/S6a/S6b code. Add the following.

```
core/src/
  cart/
    index.ts               # public surface: GbxCartSource, GbxCartSink,
                           #   detectFirmware, openCartSession, types
    protocol/
      framing.ts           # CDC ACM byte-stream framing helpers (header,
                           #   length-prefixed payload, response timeout)
      commands.ts          # Typed command/response enum + encoders/decoders
                           #   for the R3+ command set (see §4 table)
      session.ts           # CartSession: opens with a port, runs commands,
                           #   handles disconnect, owns the read/write loops
      firmware.ts          # detectFirmware(session) → FirmwareInfo
      cartHeader.ts        # parseCartHeader(bytes) — Game Boy header at
                           #   0x100-0x14F (Logo + title + cart type + RAM size)
                           #   Used for sanity ("this is a Gen 1/2 cart" vs
                           #   "this is a Gen 3 cart")
    gbxCartSource.ts       # implements SaveSource — reads SRAM, returns
                           #   Uint8Array, honours signal + onProgress
    gbxCartSink.ts         # implements SaveSink — writes SRAM, honours
                           #   signal + onProgress
    types.ts               # Port (the duck-typed Web Serial port abstraction
                           #   used by the protocol layer), CartIdentity,
                           #   FirmwareInfo, CartReadOptions, CartError

  types/
    sav.ts                 # MODIFIED — widen SaveSource interface to mirror
                           #   SaveSink (signal + onProgress + kind discriminator).
                           #   No removals; existing `read()` and `label`
                           #   stay. Existing callers (none in core; one
                           #   stub-only in web/src/state.ts via type) keep
                           #   working.

web/
  src/
    cart/
      serialPort.ts        # navigator.serial wrapper — requestPort(),
                           #   adapts the browser's SerialPort to the
                           #   core/cart Port duck-type
      cartConnector.ts     # Connect cart button, browser-compat probe,
                           #   read-progress overlay, error toasts
      backupSink.ts        # SaveSink decorator — downloads pre-write bytes
                           #   to disk BEFORE delegating to inner sink
      browserCompat.ts     # 'serial' in navigator detection + fallback dialog
    ui/
      modeToggle.ts        # [Upload] [Cart] segmented control at top of app
      cartProgress.ts      # progress-bar overlay used during reads/writes

tests/
  unit/
    cart-framing.test.ts          # CDC byte-stream framing round-trips
    cart-commands.test.ts         # encode/decode every R3+ command in §4
    cart-firmware.test.ts         # firmware probe handles R1/R2 reject + R3/R4 accept
    cart-header.test.ts           # parseCartHeader on known cart-type bytes
    cart-source-mock-port.test.ts # GbxCartSource with mock port — full
                                  #   read of a fixture .sav, byte-identical
                                  #   to file-loaded bytes, signal cancels
                                  #   mid-read
    cart-sink-mock-port.test.ts   # GbxCartSink with mock port — full write,
                                  #   per-page handshake, onProgress fires
                                  #   monotonically
  integration/
    cart-roundtrip-fixture.test.ts # parse(read-via-mock-cart(fixture.sav))
                                   # === parseSave(fixture.sav) for each
                                   # of demo-red.sav, demo-crystal.sav,
                                   # ruby.sav, emerald.sav, firered.sav

web/src/__tests__/
  browser-compat.test.ts        # 'serial' missing → Cart Mode disabled
  cart-progress.test.ts         # progress overlay updates on onProgress
  backup-sink.test.ts           # backup download fires BEFORE inner write
                                #   (with a recording inner sink; assert
                                #   call order)
  mode-toggle.test.ts           # toggle swaps Upload/Cart panes; preserves
                                #   the other-mode state when switching back
  cart-connect-flow.test.ts     # mocked navigator.serial — happy-path
                                #   connect → read → render box browser
```

**Rationale.** `core/src/cart/` is a peer of `core/src/sav/` — pure logic, no DOM. The `Port` abstraction is a duck-typed interface (`readable: ReadableStream<Uint8Array>`, `writable: WritableStream<Uint8Array>`, `addEventListener('disconnect', ...)`, `close()`) that BOTH the real Web Serial port AND the test mock implement. This keeps `core/` zero-runtime-dep and testable under Node without jsdom polyfills.

`web/src/cart/` is the thin browser glue: a 30-line wrapper around `navigator.serial.requestPort()`. Everything substantive lives in `core/`.

---

## §4 GBxCart RW protocol reference (R3+ firmware)

**Source of truth.** insidegadgets/GBxCart-RW firmware repo (`firmware/GBxCart_RW_v1.4_PCB/Src/main.c`) for the R1.4 PCB command set, and `Lesserkuma/FlashGBX` (`hw_GBxCartRW.py`) for a battle-tested host implementation we can mirror.

**Hardware transport.** USB-CDC-ACM. From the Web Serial side it's a normal `SerialPort` with no special baud requirement (firmware ignores baud — actual rate is full-speed USB). Do NOT set DTR/RTS — some R1/R2 boards reset on DTR. We open with `{ baudRate: 1000000, bufferSize: 16384 }` (the value FlashGBX uses) and rely on USB rather than UART for flow control.

**Framing.** Single-byte commands; arguments follow as raw bytes; responses are raw bytes terminated by either a fixed length the host computed in advance or a single sentinel byte `0x03`. There is no general framing protocol — every command has its own tailored response shape, which is why we model commands as a closed enum in `commands.ts` rather than a generic frame type.

**Minimum supported firmware: R3 (PCB v1.3).** R1/R2 used a different command set with no SRAM-write byte verification; supporting them is too many code paths for too few users (R1/R2 hardware shipped 2017–2019; R3+ has been the default since 2020). Our `detectFirmware()` reads the firmware version banner and either accepts or rejects.

**The R3+ command set we need:**

| Cmd | Code | Args | Response | Used for |
|---|---|---|---|---|
| `READ_FIRMWARE_VERSION` | `'V'` (0x56) | none | 1 byte (version) | firmware probe |
| `READ_PCB_VERSION` | `'h'` (0x68) | none | 1 byte (PCB rev) | firmware probe / R3 vs R4 |
| `SET_MODE_GB` | `'G'` (0x47) | none | none | switch the cart slot to Game Boy / Game Boy Color voltage (5V or 3.3V depending on cart) |
| `SET_MODE_GBA` | `'g'` (0x67) | none | none | switch to GBA voltage (3.3V) — used for Gen 3 carts |
| `READ_ROM_RAM_BYTES` | `'M'` (0x4d) | u24 length | length bytes | bulk SRAM read on GB carts |
| `WRITE_RAM_BYTE` | `'W'` (0x57) | 1 byte | 1 ack byte | single-byte SRAM write (GB) |
| `SET_BANK` | `'B'` (0x42) | u16 bank, u16 addr | none | switch SRAM bank for MBC3/MBC5 carts |
| `READ_GBA_SRAM` | `'r'` (0x72) | u24 length | length bytes | bulk SRAM read on GBA carts |
| `WRITE_GBA_SRAM_PAGE` | `'w'` (0x77) | u16 page index, page bytes | 1 ack byte | per-page SRAM write on GBA carts |
| `RESET_MBC` | `'I'` (0x49) | none | none | reset cart MBC state (issued before reads to ensure bank 0) |
| `XMAS_LED_OFF` | `'L'` (0x4c) | 1 byte | none | quiet the activity LED during long ops (cosmetic) |

**Cart-detect chain.**
1. Open port.
2. `READ_FIRMWARE_VERSION` → reject if < R3.
3. Issue `SET_MODE_GB` (we always start in GB mode; if we see a Gen 3 header we re-issue `SET_MODE_GBA` and re-probe).
4. `RESET_MBC`, then `READ_ROM_RAM_BYTES` of 0x150 bytes from ROM offset 0x00 (header read; this hits ROM, not SRAM, via the normal MBC mapping with bank 0 selected by `RESET_MBC`).
5. `parseCartHeader(bytes[0..0x14F])` → returns `{ kind: 'gb' | 'gbc' | 'gba', title, cartType, ramSize }`. The Nintendo logo bytes at 0x104..0x133 are the canonical "is this a Game Boy cart" probe; absence + a GBA-style header (entry point at 0x00, "AGBE"/"AGBJ" at 0xA0) means it's a GBA cart.
6. Branch:
   - GB/GBC cart → SRAM size from header byte 0x149 (0x02 = 8 KB, 0x03 = 32 KB; Gen 1 uses 0x03, Gen 2 uses 0x03). Read `0x8000` bytes via `READ_ROM_RAM_BYTES` issued in 4 KB chunks (for `onProgress` granularity).
   - GBA cart → re-issue `SET_MODE_GBA`, then `READ_GBA_SRAM` for `0x20000` bytes (128 KB) in 4 KB chunks.
7. Concatenate chunks → `Uint8Array` → return.

**Read speed expectations.** GBxCart R3 reads GB SRAM at ~32 KB/s and GBA SRAM at ~16 KB/s (per FlashGBX docs). 32 KB GB save → ~1 s. 128 KB GBA save → ~8 s. Progress reporting hooks into `SaveSource.onProgress({ bytesRead, bytesTotal })` after every chunk.

**Write speed expectations.** Per-byte WRITE_RAM_BYTE is the bottleneck on GB carts (~3 KB/s); 32 KB write ~10 s. GBA per-page WRITE_GBA_SRAM_PAGE writes 64-byte pages with handshake; 128 KB write ~30 s.

**MBC3 (Gen 1) vs MBC3+RTC (Gen 2) caveat.** Gen 2 cart SRAM is 4 banks × 8 KB = 32 KB, switched via SET_BANK. Reads MUST iterate banks 0..3 (with `SET_BANK` between each) and concatenate; per-bank reads use `READ_ROM_RAM_BYTES(0x2000)`. We also need to issue `B 0x6000 0x0a` (enable RAM) before any read/write and `B 0x6000 0x00` (disable RAM) after — exactly mirroring what the Game Boy hardware does on cartridge insertion.

**RTC bank caveat.** MBC3+RTC (Gen 2 Crystal) treats banks 0x08..0x0c as RTC registers, not SRAM. We don't read those — bank index range stays 0..3.

**GBA SRAM layout.** Game Pak SRAM is a single linear 128 KB region. No bank switching needed. The Gen 3 save format ignores half of that on FR/LG/E (treats it as two 64 KB slots) but the reader/writer doesn't care — it always operates on 128 KB.

**Disconnect mid-operation.** The Web Serial port emits a `disconnect` event when the cable is yanked. We wire it to abort the current `AbortController`, surface a `CartError` with `reason: 'DISCONNECTED'`, and tear down the session. The user must `Reconnect cart` from scratch.

---

## §5 `SaveSource` interface design

The S3a-frozen `SaveSource` (`core/src/types/sav.ts:73`) is too thin — it's just `{ read(): Promise<Uint8Array>; label: string }`. AMEND-S3a-2 promised a `kind: 'file' | 'serial'` discriminator that never landed; AMEND-S6a-4 forward-carried "design `SaveSource` symmetrically with `SaveSink`" to S6b, which was deferred to here. We do that now.

**The widened interface (drop-in additive — no breaking changes; current zero-real-callers surface).**

```ts
// core/src/types/sav.ts (replacing lines 69-77)

export interface SaveSourceProgress {
  readonly bytesRead: number;
  readonly bytesTotal: number; // may be 0 if unknown ahead of time
}

export interface SaveSourceOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (p: SaveSourceProgress) => void;
}

/**
 * Symmetric with SaveSink (saveSink.ts). Both signal + onProgress
 * accepted; fast/instant sources may ignore them.
 */
export interface SaveSource {
  read(opts?: SaveSourceOptions): Promise<Uint8Array>;
  readonly label: string;
  readonly kind: 'file' | 'serial';
}
```

**Two implementations.**

```ts
// web/src/uploadSource.ts (new file — extracts the file-upload path
// behind the SaveSource interface so the controller is source-agnostic).
export class FileUploadSource implements SaveSource {
  readonly kind = 'file' as const;
  readonly label: string;
  constructor(private readonly file: File) { this.label = file.name; }
  async read(_opts?: SaveSourceOptions): Promise<Uint8Array> {
    void _opts; // file reads are instant; signal/progress N/A.
    const buf = await this.file.arrayBuffer();
    return new Uint8Array(buf);
  }
}

// core/src/cart/gbxCartSource.ts (new)
export class GbxCartSource implements SaveSource {
  readonly kind = 'serial' as const;
  readonly label: string; // populated after detect: e.g. "POKEMON RED (32 KB)"
  constructor(private readonly session: CartSession) {
    this.label = session.identity.label;
  }
  async read(opts?: SaveSourceOptions): Promise<Uint8Array> {
    return this.session.readSram({
      signal: opts?.signal,
      onProgress: opts?.onProgress,
    });
  }
}
```

The reducer's `file_parsed` action and the controller's `handleFileSelected` both keep working unchanged — they just now call `await new FileUploadSource(file).read()` instead of `await file.arrayBuffer()` directly. This refactor is small (~10 lines in `web/src/ui.ts`) but unifies the two input paths.

---

## §6 Cart-mode UI flows

### §6.1 Mode toggle

A segmented control at the very top of the app (above the existing `pokeportal` h1 isn't ideal — we put it below the h1 and above the panes-grid):

```
┌─────────────────────────────────────────────────────┐
│  pokeportal                                         │
│  drop a Pokemon … OR plug in a cart                 │
│                                                     │
│         ┌───────────────┬───────────────┐           │
│         │  Upload Mode  │  Cart Mode    │           │
│         └───────────────┴───────────────┘           │
└─────────────────────────────────────────────────────┘
```

Tabs are mutually exclusive and per-side: clicking `Cart Mode` swaps BOTH the source-pane and the dest-pane into cart mode. The user's cart-out / cart-in workflow (one cart at a time) doesn't need independent per-pane mode — both panes are cart mode simultaneously, but only the relevant one is "active" at any given step.

When `Cart Mode` is selected, switching back to `Upload Mode` does NOT clear the staging box (S7b) — staging persists across mode switches. The toggle lives in `web/src/ui/modeToggle.ts`. Mode lives in state at `state.mode: 'upload' | 'cart'` (S7a defaults to `'upload'` per existing behaviour).

**Browser-compat fallback.** When `'serial' in navigator === false`, the `Cart Mode` tab is rendered with `disabled` attribute, `cursor: not-allowed`, and a tooltip:

> Cart Mode requires a Chromium-based browser (Chrome, Edge, Opera, Brave). Use Upload Mode instead.

A first-time-disabled-click fires a small dialog (via the existing `web/src/ui/dialog.ts`) with the same message + a link to https://caniuse.com/web-serial. This is in `web/src/cart/browserCompat.ts`.

### §6.2 Cart connect (read flow — S7a)

User clicks `Cart Mode`. Both panes show:

```
SOURCE                          DESTINATION
┌──────────────────┐            ┌──────────────────┐
│                  │            │                  │
│   [Connect cart] │            │  staging box     │
│                  │            │  (empty in S7a)  │
│   Insert your    │            │                  │
│   Gen 1/2 cart   │            │                  │
│   first.         │            │                  │
└──────────────────┘            └──────────────────┘
```

Clicking `Connect cart` invokes `navigator.serial.requestPort()`. The browser's port picker appears. User picks the GBxCart RW. `serialPort.ts` opens it, hands it to `openCartSession()`, which runs `detectFirmware` + `parseCartHeader` + the cart-detect chain (§4).

While reading, the source pane shows `cartProgress.ts`:

```
SOURCE
┌──────────────────────────────┐
│  Reading cart…               │
│  ████████░░░░  64 % (21/32 KB) │
│  POKEMON RED                 │
│  [Cancel]                    │
└──────────────────────────────┘
```

`Cancel` calls `controller.abort()` on the read AbortController; the session tears down; the pane returns to the `[Connect cart]` state.

When the read completes, `parseSave(bytes)` runs (same as Upload Mode). On success, the source pane renders the trainer card + `boxBrowser` exactly as Upload Mode does — the renderer is shared. The user can browse boxes, click any mon, see the comparison overlay, and download a `.pk3` (S5 behaviour).

### §6.3 Disconnect handling

If the cable is unplugged mid-session, the `disconnect` event fires on the SerialPort. The session aborts, the source pane shows:

```
SOURCE
┌──────────────────────────────┐
│  ⚠ Cart disconnected         │
│  [Reconnect cart]            │
└──────────────────────────────┘
```

Existing parsed save data stays in state (we don't dump the user's progress just because the cable wobbled), but cart-write actions are disabled until reconnect.

### §6.4 Pre-flash backup machinery (S7a)

Even though S7a doesn't yet ship the staging-box commit flow, the `BackupSink` decorator IS shipped and unit-tested in S7a, so S7b inherits it tested.

```ts
// web/src/cart/backupSink.ts
export class BackupSink implements SaveSink {
  readonly label: string;
  constructor(
    private readonly inner: SaveSink,
    private readonly preWriteBytes: Uint8Array,
    private readonly backupFilename: string,
  ) { this.label = `Backup + ${inner.label}`; }
  async write(bytes: Uint8Array, opts?: SaveSinkOptions): Promise<void> {
    blobDownload(this.backupFilename, this.preWriteBytes); // synchronous trigger
    await this.inner.write(bytes, opts); // delegates to the real (cart) sink
  }
}
```

**Construction site (S7b).** When the user clicks `Commit to source cart`, the controller:
1. Calls `await source.read()` once more to get the *current* cart bytes (in case the user pulled and re-inserted the cart between staging and commit — the cart contents may have been edited on a real Game Boy in between).
2. Constructs `backupFilename = "${cartLabel}-${trainer.tid}.backup-pre-${YYYYMMDDHHmmss}.sav"`.
3. Constructs `new BackupSink(gbxCartSink, currentCartBytes, backupFilename)`.
4. Calls `backupSink.write(deletedBytes, { signal, onProgress })`.

The download fires synchronously before the cart-write begins. It is non-dismissable in the sense that there's no UI affordance to skip it — it's wired into the sink, not into a dialog.

### §6.5 Atomic commit (S7b — designed here)

When the user has 5 mons staged and clicks `Commit to source cart`:
- **Atomic.** All 5 deletions are applied to the in-memory cart bytes via successive `deleteMonGen1` / `deleteMonGen2` calls (each returns a fresh `Uint8Array`; we re-parse between each to refresh slot indices, identical to S6b's chained-STORE flow). The final all-deleted bytes are flashed in ONE cart write.
- Same applies to the destination side: all 5 injections via successive `injectIntoSave` calls, then one cart write.

**Justification: atomic over incremental.**
1. Faster (one ~10 s write instead of five ~10 s writes).
2. Safer in the most-likely-failure-mode (cable yank): an incremental flow can leave the cart with mons deleted from the source but not yet placed in the destination. Atomic minimises the half-state window.
3. The user's stated flow ("after they are chosen, they are put into a temp local storage box") implies one staging gesture and one commit gesture, not five of each.
4. Failure recovery is symmetric: the pre-flash backup IS the recovery surface. If atomic flash fails, the user has the pre-flash `.sav` to flash back via Upload Mode + cart write or via FlashGBX.

**Per-mon failure.** If `deleteMonGen1` throws on mon #3 of 5, we abort the entire commit, surface the error, and the staging box is unchanged. The user can de-stage the problematic mon and retry.

### §6.6 Staging box (S7b — sketched)

Right pane in Cart Mode is the staging box. It uses the same overworld-sprite chrome as `boxBrowser.ts` but renders from the IndexedDB-backed `StagedMon[]` list (see §7) instead of from a parsed save.

```
DESTINATION (Cart Mode)
┌──────────────────────────────┐
│  STAGING                      │
│  [icon] [icon] [icon] [icon]  │
│  [icon] [icon]                │
│  3 staged · 12 free           │
│                               │
│  [Connect destination cart]   │
└──────────────────────────────┘
```

**Stage button.** When the source-side comparison overlay is open in Cart Mode, the existing `[STORE in destination]` button is replaced by `[Stage for transfer]`. Clicking it:
1. Calls `convert(mon) → packBoxed → pk3 bytes`.
2. Constructs a `StagedMon` (see §7).
3. Persists to IndexedDB.
4. Dispatches `staging_mon_added` action; reducer pushes onto `state.staging`.
5. Closes the comparison overlay.

The mon is NOT deleted from the source cart yet — deletion happens at commit time.

### §6.7 Place + commit flow (S7b)

After the user has staged everything they want and clicked `Commit to source cart` (which also pulls the cart and prompts to insert the destination):

1. Right pane shows: `Insert destination cart, then [Connect destination cart]`.
2. User inserts the Gen 3 cart, clicks the button → `parseGen3Save(bytes)` → destination box browser renders in the LEFT pane (yes — left! per the user's invariant the cart is always left, staging always right).
3. For each `StagedMon`, the user picks a target box+slot via the destination box browser cursor + clicks `Place`. The mon moves from staging-pane to a staged-and-placed list (visual: greyed-out icon in the staging pane + small chevron pointing at the destination slot).
4. When all staged mons are placed, the `Commit to destination cart` button enables.
5. Commit runs the atomic-injection + pre-flash-backup + cart-write flow (§6.4 / §6.5).
6. On success: staging box clears, both pre-flash backups are on disk, the user can disconnect.

### §6.8 Reload restoration (S7b — designed here)

User flow: staged 3 mons → pulled the source cart → closed the laptop lid → opened it next morning → page reloaded.

On boot:
1. `cartConnector.ts` checks IndexedDB for staged mons.
2. If `staging` is non-empty AND `mode` was `cart`, restore to mode = `cart`, populate `state.staging`, render the right pane with the 3 staged icons.
3. The left pane shows: `[Connect destination cart]` (we skip "insert source" because the user already committed to source — see the persistence schema's `phase` field).
4. If the user wants to abandon the staged mons (e.g. realised they wanted to keep them on the source cart): a `Discard staging` button is always visible; clicking it clears IndexedDB and the staging box.

---

## §7 Persistence schema (IndexedDB)

**Pick: IndexedDB (not localStorage).** Justification:
- `.pk3` bytes are binary; IndexedDB stores `ArrayBuffer` directly. localStorage requires base64 encoding (~33% bloat, sync API blocking the main thread).
- IndexedDB has no realistic size cap for our use case; localStorage's ~5 MB cap is a forever-future-proofing risk if the user ever stages a non-trivial number of mons (cap is per-origin and shared with everything else the app might persist).
- IDB's transactional model gives us "all-or-nothing" semantics on the staging-box mutations.
- The user's CLAUDE.md style preference ("simple, readable code over clever abstractions") could push toward localStorage — but the binary-encoding requirement makes IDB the simpler choice in practice.

**Database schema.**

```
DB name:     'pokeportal-staging'
Version:     1
Object stores:
  'mons'   keyPath: 'id' (string UUID)
  'meta'   keyPath: 'key'  (single 'state' record)
```

**`mons` record.**

```ts
interface StagedMon {
  id: string;              // crypto.randomUUID()
  pk3Bytes: Uint8Array;    // 80 bytes, ready to inject
  speciesGen3: number;     // for staging-pane sprite render
  speciesGen2: number;     // for source-cart-game label
  nicknameDisplay: string; // already-decoded string for tooltip
  level: number;
  sourceCartLabel: string; // e.g. "POKEMON CRYSTAL (TID 12345)"
  sourceFormat: SaveFormat; // RBY-RED | CRYSTAL | etc.
  sourceRef: { bucket: 'party' | 'currentBox' | 'box'; boxIndex?: number; slot: number };
  stagedAt: number;        // Date.now()
}
```

**`meta` 'state' record.**

```ts
interface StagingMeta {
  key: 'state';
  phase: 'collecting' | 'awaiting-source-commit' | 'awaiting-dest-cart' | 'placing' | 'awaiting-dest-commit';
  sourceCartIdentity?: { tid: number; format: SaveFormat; otNameBytes: number[] };
  destCartIdentity?: { tid: number; sid: number; format: SaveFormat3 };
  // Per-mon placement positions when phase === 'placing':
  placements?: { id: string; boxIndex: number; slot: number }[];
}
```

**Restore semantics.**
- On boot, if `mons` is non-empty, populate `state.staging`. Set `state.mode = 'cart'`.
- Use `meta.state.phase` to decide which left-pane prompt to show:
  - `collecting` → "Insert source cart" / `[Connect source cart]`
  - `awaiting-source-commit` → "Insert source cart to commit" (rare — the user staged but never clicked commit before reloading; staging stays, source cart still has the mons)
  - `awaiting-dest-cart` → "Insert destination cart" / `[Connect destination cart]`
  - `placing` → restore destination cart connection prompt + restore placements once cart is connected
  - `awaiting-dest-commit` → "Insert destination cart to commit"

**Schema migration.** Version 1 only in S7b. If a future S8 sprint adds fields, bump to version 2 and add an `onupgradeneeded` migration that defaults the new fields. Don't drop or rename existing fields without an archive sprint amendment.

---

## §8 State machine extensions

**S7a additions (additive, no S6b removals).**

```ts
// web/src/state.ts — additions

export type Mode = 'upload' | 'cart';

export interface CartSourceState {
  // present when Cart Mode is active and a cart session is open
  readonly identity: CartIdentity;
  readonly readProgress?: { bytesRead: number; bytesTotal: number };
  readonly readError?: string;
}

export type AppState = DestSlot & { mode: Mode; cartSource?: CartSourceState } & (
  | { kind: 'idle' }
  | { kind: 'parsing'; ... }
  | { kind: 'parse_error'; ... }
  | { kind: 'loaded'; ... }
);
```

**S7a actions added:**

```ts
| { type: 'mode_changed'; mode: Mode }
| { type: 'cart_connect_started' }
| { type: 'cart_connect_progress'; bytesRead: number; bytesTotal: number }
| { type: 'cart_connect_succeeded'; identity: CartIdentity; bytes: Uint8Array; save: SaveContents }
| { type: 'cart_connect_failed'; message: string }
| { type: 'cart_disconnected' }
```

`cart_connect_succeeded` is the cart-mode equivalent of `file_parsed` — it lands the parsed save into `state.save` exactly the same way, plus stashes the `cartSource` metadata. The reducer reuses the existing `'loaded'` shape.

**S7b additions (sketched).**

```ts
// new field
readonly staging?: StagedMon[];       // mirrors IndexedDB
readonly stagingPhase?: StagingPhase; // mirrors meta.state.phase

// new actions
| { type: 'staging_loaded_from_idb'; mons: StagedMon[]; meta: StagingMeta }
| { type: 'staging_mon_added'; mon: StagedMon }
| { type: 'staging_mon_removed'; id: string }
| { type: 'staging_phase_changed'; phase: StagingPhase }
| { type: 'staging_placement_set'; id: string; boxIndex: number; slot: number }
| { type: 'staging_committed_source'; postDeleteBytes: Uint8Array }
| { type: 'staging_committed_dest'; postInjectBytes: Uint8Array }
| { type: 'staging_cleared' }
```

**Mode-toggle invariant.** Switching `Upload → Cart` doesn't drop the upload-side state; switching `Cart → Upload` doesn't drop the cart-side state OR the staging box. This is "preserve everything, just change which UI you see" — much less surprising than a destructive toggle.

---

## §9 Component decomposition (S7a)

| File | Public API | Responsibility |
|---|---|---|
| `core/src/cart/types.ts` | `interface Port`, `interface CartIdentity`, `interface FirmwareInfo`, `class CartError extends Error` | Shared types. `Port` is the duck-typed Web Serial port abstraction. |
| `core/src/cart/protocol/framing.ts` | `readExactly(port, n, signal): Promise<Uint8Array>`, `writeAll(port, bytes): Promise<void>`, `withTimeout(promise, ms): Promise<T>` | Stream framing primitives. No protocol semantics. |
| `core/src/cart/protocol/commands.ts` | `enum Cmd`, `encodeCmd(cmd, args): Uint8Array`, `expectAck(port): Promise<void>` | Per-command encoders + ack readers per §4 table. |
| `core/src/cart/protocol/firmware.ts` | `detectFirmware(port, signal): Promise<FirmwareInfo>`, `requireR3Plus(info): void` | Reads firmware + PCB version via `'V'` and `'h'`. Throws `CartError('UNSUPPORTED_FIRMWARE')` on R1/R2. |
| `core/src/cart/protocol/cartHeader.ts` | `parseCartHeader(bytes): CartHeader \| null` | Game Boy / GBA header parser. Returns `kind: 'gb' \| 'gbc' \| 'gba'`, title, cart type, RAM size byte. |
| `core/src/cart/protocol/session.ts` | `class CartSession { open(port); identity; readSram(opts); writeSram(bytes, opts); close(); }` | The session object. Owns the port for the duration. Disconnect-aware. |
| `core/src/cart/gbxCartSource.ts` | `class GbxCartSource implements SaveSource` | Per §5 |
| `core/src/cart/gbxCartSink.ts` | `class GbxCartSink implements SaveSink` | Per `SaveSink` interface — wraps `session.writeSram()`. |
| `core/src/cart/index.ts` | re-exports the public surface above + `openCartSession(port): Promise<CartSession>` (does the firmware probe + cart-detect chain) | Single import point for `web/`. |
| `web/src/cart/serialPort.ts` | `requestCartPort(): Promise<Port>` | Calls `navigator.serial.requestPort()` with vendor/product filters for the GBxCart's CDC interface (vendor `0x1d50`, product `0x6018` per insidegadgets's USB config). Returns a Port wrapper that satisfies the duck type. |
| `web/src/cart/browserCompat.ts` | `function isWebSerialAvailable(): boolean`, `function showFallbackDialog(): void` | Detection + fallback dialog. |
| `web/src/cart/backupSink.ts` | `class BackupSink implements SaveSink` | Per §6.4. |
| `web/src/cart/cartConnector.ts` | `function connectSourceCart(dispatch, deps): Promise<void>` | Orchestration: open port → openCartSession → read → parse → dispatch. |
| `web/src/ui/modeToggle.ts` | `function modeToggle({mode, available, onModeChange}): HTMLElement` | The segmented control. |
| `web/src/ui/cartProgress.ts` | `function cartProgress({label, bytesRead, bytesTotal, onCancel}): HTMLElement` | Progress overlay for reads/writes. |

**Public-API surface added to `core/src/index.ts`.**

```ts
// Sprint 7a — Web Serial GBxCart RW adapter.
export { GbxCartSource, GbxCartSink, openCartSession, isCartError } from './cart/index.js';
export type {
  Port,
  CartIdentity,
  FirmwareInfo,
  CartError,
  CartReadOptions,
} from './cart/index.js';
export type { SaveSource, SaveSourceOptions, SaveSourceProgress } from './types/sav.js';
```

No existing exports change. `SaveSource` is widened (additive — the `kind` field is required, but no real callers exist outside the new code so the addition is fine).

---

## §10 Test plan

### Unit (run under Node, no jsdom needed)

| Test | Asserts |
|---|---|
| `cart-framing.test.ts` (~6 tests) | `readExactly` reads exactly N bytes; partial-read accumulation; signal aborts mid-read; `withTimeout` resolves and rejects on schedule; `writeAll` writes complete buffer |
| `cart-commands.test.ts` (~12 tests) | One per command in the §4 table — encode produces the documented byte sequence; decode (where applicable) interprets the response correctly; bank-switch encoding for MBC3 |
| `cart-firmware.test.ts` (~6 tests) | R1 banner → reject; R2 banner → reject; R3 banner → accept; R4 banner → accept; PCB version round-trip; malformed banner → CartError('CORRUPTED_RESPONSE') |
| `cart-header.test.ts` (~8 tests) | Known Pokemon Red header → `{kind:'gb', title:'POKEMON RED', ramSize:'32K'}`; known Crystal header → `{kind:'gbc', title:'PM_CRYSTAL'}`; known Emerald header → `{kind:'gba', title:'POKEMON EMER'}`; logo bytes corruption → null; truncated input → null |
| `cart-source-mock-port.test.ts` (~6 tests) | Mock port that responds to commands per §4; full GB read returns 32 KB matching a fixture; full GBA read returns 128 KB matching fixture; signal cancels mid-read; onProgress fires after every chunk monotonically; bank-switch sequence for Gen 2 issued in correct order |
| `cart-sink-mock-port.test.ts` (~5 tests) | Full GB write issues per-byte WRITE; per-page GBA write; ack failure → CartError('WRITE_FAILED'); signal cancels mid-write; onProgress monotonic |

### Integration (Node, fixtures-only)

| Test | Asserts |
|---|---|
| `cart-roundtrip-fixture.test.ts` (~5 tests, one per fixture) | `parseSave(await new GbxCartSource(mockSession).read()) === parseSave(fixture)`. Drives the protocol layer end-to-end without a real cart. Pin the byte equivalence so any future protocol-layer drift surfaces as a per-fixture FAIL. |

### Web (vitest jsdom)

| Test | Asserts |
|---|---|
| `browser-compat.test.ts` (~3 tests) | `'serial' missing` → `Cart Mode` button has `disabled`; click triggers fallback dialog; `'serial' present` → button enabled |
| `cart-progress.test.ts` (~3 tests) | overlay renders `bytesRead/bytesTotal`; cancel button calls `onCancel`; updates re-render on dispatch |
| `backup-sink.test.ts` (~4 tests) | with a recording inner sink + a recording `blobDownload`: backup fires before inner.write; pre-write bytes land in the backup; backup filename matches `${cartLabel}-${tid}.backup-pre-${YYYYMMDDHHmmss}.sav` regex; signal forwarded to inner.write |
| `mode-toggle.test.ts` (~4 tests) | clicking toggle dispatches `mode_changed`; switching back preserves the other-mode state in the reducer; default `mode === 'upload'`; disabled-state click doesn't dispatch |
| `cart-connect-flow.test.ts` (~5 tests) | with `navigator.serial` mocked: `Connect cart` opens port, runs detect chain, parses save, renders box browser; disconnect during read surfaces error; firmware reject shows specific dialog; user-cancelled port-picker doesn't crash |

**Total new tests: ~67** (well over the ≥45 floor — the hardware-protocol surface is genuinely large).

### Existing tests must still pass

- **Hard requirement**: all 413 existing tests green. Changes to `core/src/types/sav.ts` (widening `SaveSource`) are additive — the only existing consumer of the type is the export line, no runtime callsites. Confirm by `grep -rn "SaveSource" core/ web/ tests/` before submission.
- **Hard requirement**: bundle ≤ 200 KB gzipped. Current 42.7 KB; budget allows ~+150 KB. Estimated S7a delta: ~30 KB (protocol layer + Web Serial wrapper + mode toggle + progress overlay). Comfortable margin.

### Fixture acquisition

**No new fixtures needed for S7a.** The mock-port tests script the byte sequences directly from the §4 protocol table. The integration test reuses existing `demo-red.sav`, `demo-crystal.sav`, `ruby.sav`, `emerald.sav`, `firered.sav` fixtures.

**S7b will need:** a cart-side recording of a real round-trip (cart bytes pre-stage → cart bytes post-source-commit → cart bytes post-dest-commit), but that's a Generator-level fixture acquisition and only meaningful with the user's real hardware, which is appropriate to capture during S7b's implementation rather than at S7a planning time.

---

## §11 Browser-compat / fallback strategy

**Detection.** `'serial' in navigator` is the canonical Web Serial probe. Returns true on Chromium ≥ 89 (Chrome, Edge, Opera, Brave, Vivaldi). Returns false on Firefox (no plans), Safari (no plans), and any non-secure context (HTTP). Our Vite preview server runs HTTP locally — Web Serial requires HTTPS or localhost, so `localhost:5173` works but `192.168.x.x:5173` doesn't. Document this in the README's S7a section.

**UX.**
- `[Cart Mode]` tab is always rendered. When unavailable, it carries `disabled` + tooltip + a small `?` icon that opens an explainer dialog.
- The dialog points at https://caniuse.com/web-serial and gives concrete browser-name suggestions.
- The first time a user clicks the disabled tab, the dialog auto-opens; subsequent clicks just show the tooltip (we don't want to nag).

**Fallback path.** Upload Mode is unchanged from S6a/S6b. The toggle defaults to `upload` and stays there until the user explicitly chooses cart. Firefox/Safari users see exactly what they see today.

**Known issues.**
- Web Serial on Linux requires the user be in the `dialout` group (Debian/Ubuntu) or `uucp` group (Arch). If the port-picker doesn't list the GBxCart, this is the most common cause — surface a hint in the cart-connect failure dialog: `If the GBxCart isn't listed, you may need to add yourself to the dialout/uucp group and reboot.`
- macOS sometimes lists the GBxCart as `/dev/cu.usbmodem*` and `/dev/tty.usbmodem*` simultaneously; the picker shows both. We just use whichever the user picks — both work.

---

## §12 Risks and open questions for the Plan Evaluator

### R1. Web Serial Chromium quirks

The Web Serial spec is recent and Chrome's implementation has had behaviour changes through 2023–2024 (notably around `disconnect` event timing on hot-unplug). We test on Chrome stable; Edge / Opera / Brave inherit Chromium's behaviour but may lag. The mitigation is: keep the cart-session code small and put a `try/finally session.close()` around every operation so partial state is always cleaned up.

### R2. GBxCart firmware-version sniffing

R3 vs R4 firmware have minor command-set differences in the *write* path (R4 added a faster page-write mode for GBA SRAM). S7a accepts both but uses only the R3-compatible write commands. Plan-Eval should confirm we don't need R4-specific code paths to hit acceptable write speeds. Estimate: R3-compatible per-page write at ~16 KB/s → 128 KB write in ~8 s, which is acceptable.

### R3. Mid-read buffer accumulation

`READ_ROM_RAM_BYTES` returns a stream of bytes with no inter-chunk delimiter; we accumulate via `port.readable.getReader()` and concatenate. The risk is that the OS's serial-port driver may chunk reads at unpredictable boundaries (256 bytes, 4 KB, etc. depending on the kernel). Our `readExactly(n)` helper handles this by looping until N bytes accumulate. Tested via the mock port simulating various chunking strategies.

### R4. Cart pulled mid-read

When the user yanks the cart with the cable still connected, the GBxCart firmware may return all-`0xFF` bytes silently (no disconnect event — the cable's still in). We can't reliably detect this without a checksum. The mitigation in S7a: `parseSave(bytes)` will return a `SaveError` (checksum mismatch) for an all-FF buffer, which surfaces correctly to the user. S7b's commit flow should warn the user: "Don't disconnect the cart from the GBxCart while a write is in progress."

### R5. SaveSource interface widening

The existing `SaveSource` interface (S3a) has zero real callsites. Widening it to add `signal`/`onProgress`/`kind` is technically a breaking change to the type, but since nothing implements it today, it's effectively additive. Plan-Eval should confirm: `grep -rn "implements SaveSource" core/ web/ tests/` returns nothing. If it does, we need a migration path.

### R6. Mode-toggle granularity

The plan picks a single global `mode: 'upload' | 'cart'` toggle that swaps both panes simultaneously. An alternative is per-pane mode (source-pane mode independent of dest-pane mode), which would let the user upload a Gen 1 .sav AND read their Gen 3 cart in one session. Plan-Eval should weigh: is per-pane mode worth the extra state-machine complexity? My recommendation is global mode for S7a (simpler, matches the user's stated workflow) and revisit if user feedback asks for per-pane.

### R7. IndexedDB inside jsdom

vitest's jsdom env doesn't ship a working IndexedDB. We'll need `fake-indexeddb` as a dev-dep (~30 KB, dev-only — doesn't bloat the production bundle). S7b only.

### R8. Bundle size growth

S7a alone: estimated ~+30 KB gzipped (protocol layer ~15 KB + Web Serial wrapper ~3 KB + mode toggle/progress UI ~5 KB + new types/exports ~7 KB). Total post-S7a: ~73 KB, well under the 200 KB cap. S7b adds ~30 KB more (staging UI + IndexedDB schema). Total post-S7b: ~103 KB. Comfortable.

### R9. The `kind` discriminator on `SaveSource`

I added `kind: 'file' | 'serial'` per AMEND-S3a-2's promise. The original motivation was so the UI can render different progress UI per source type. But: with `signal`/`onProgress` on the interface itself, the UI doesn't actually need to discriminate — it just renders progress when `onProgress` callbacks fire, hides progress when they don't. Plan-Eval should decide: keep `kind` for forward-compat, or drop it because the progress hook subsumes its purpose? My recommendation is keep it — it's a single-line addition and downstream code (cart-mode-specific dialogs like `If the GBxCart isn't listed…`) genuinely needs to know which source type it's dealing with.

### R10. Pre-flash backup as decorator vs first-class commit step

The plan models pre-flash backup as a `BackupSink` decorator wrapping the real sink. An alternative is a top-level commit-orchestration function that explicitly does `[1] download backup; [2] await sink.write(modifiedBytes)`. Decorator is more elegant; explicit is more obvious in the code. Plan-Eval should pick. My recommendation is decorator — it makes "every cart write IS backed up" a type-level guarantee (you literally cannot construct a write path without a `BackupSink` wrapping it, if we make `BackupSink` the only path the controller knows about).

### R11. Atomic-commit failure mid-write

If the cart-write fails halfway through (write-failure on page 47 of 256 for example), the cart is in a corrupt state. The user has the pre-flash backup but no in-app way to flash it back without leaving the app. S7b should ship a `Restore from backup` flow that lets the user re-upload a backup .sav and flash it via cart-write. Out of scope for S7a but called out for S7b's planner.

### R12. The S7b animation-sprint compatibility

The post-S7 animation sprint will use the cart-left / staging-right invariant for a "red Pokeball recall" animation (mon flying from cart pane to staging pane on stage; mon flying from staging pane to dest cart pane on place). The DOM coordinates (and CSS transform origins) the animation needs are: `.source-pane .ow-sprite` (cart-side mon), `.dest-pane.staging-box .ow-sprite` (staging-side mon). S7a doesn't add or rename these classes. Plan-Eval can verify by inspecting `web/src/style.css` and the new `cartConnector.ts` render output.

---

> END OF PLAN.md (S7a). S7b sketches throughout this document are non-binding — the actual S7b sprint will get its own PLAN.md.
