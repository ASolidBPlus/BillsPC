/**
 * Sprint 7a: shared types for the GBxCart RW cart layer.
 *
 * `Port` is a duck-typed Web Serial port abstraction. The real
 * `navigator.serial` SerialPort satisfies it, AND the Node-side mock
 * port used by the unit tests satisfies it. The protocol layer never
 * imports anything DOM-shaped — it only sees `Port`.
 */

export interface Port {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  close(): Promise<void>;
  addEventListener?(event: 'disconnect', listener: () => void): void;
  removeEventListener?(event: 'disconnect', listener: () => void): void;
  /**
   * Optional: re-open the underlying transport at a new baud rate.
   * The protocol layer needs this to support GBxCart's two-stage
   * baud-upgrade dance (open at 1M for handshake, send
   * OFW_USART_1_5M_SPEED, close + reopen at 1.5M for SET_VARIABLE
   * traffic). Implementations that can't change baud (mocks) omit it;
   * the protocol then falls back to single-baud behaviour.
   */
  reopenAtBaud?(baudRate: number): Promise<void>;
}

/**
 * Identifies the cart currently inserted in the GBxCart. Filled in by
 * `openCartSession()` after the firmware probe + cart-header read.
 */
export interface CartIdentity {
  readonly kind: 'gb' | 'gbc' | 'gba';
  readonly title: string;
  readonly cartType: number;
  readonly ramSizeBytes: number;
  /** Display-friendly label, e.g. "POKEMON CRYSTAL (32 KB)". */
  readonly label: string;
}

export type ProtocolVariant = 'insidegadgets' | 'lesserkuma' | 'unknown';

export interface FirmwareInfo {
  readonly banner: string;
  readonly variant: ProtocolVariant;
  /** Major firmware revision parsed from the banner; -1 if unknown. */
  readonly majorRev: number;
}

export type CartErrorReason =
  | 'PORT_OPEN_FAILED'
  | 'UNSUPPORTED_FIRMWARE'
  | 'UNSUPPORTED_FIRMWARE_VARIANT'
  | 'CORRUPTED_RESPONSE'
  | 'TIMEOUT'
  | 'DISCONNECTED'
  | 'WRITE_FAILED'
  | 'CANCELLED'
  | 'BACKUP_FAILED'
  | 'UNSUPPORTED_CART';

export class CartError extends Error {
  readonly reason: CartErrorReason;
  readonly meta?: Readonly<Record<string, string | number>>;
  constructor(reason: CartErrorReason, message: string, meta?: Record<string, string | number>) {
    super(message);
    this.name = 'CartError';
    this.reason = reason;
    if (meta) this.meta = meta;
  }
}

export function isCartError(x: unknown): x is CartError {
  return x instanceof CartError;
}

export interface CartReadOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (p: { bytesRead: number; bytesTotal: number }) => void;
}

export interface CartWriteOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (p: { bytesWritten: number; bytesTotal: number }) => void;
}
