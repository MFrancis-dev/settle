/**
 * Installs the Node `Buffer` global in the browser, before any wallet package is imported.
 * Roadmap: S4.1 · Spec: ARCHITECTURE.md §11 (S0.14)
 *
 * Read off `@near-wallet-selector/core@10.1.4`: `validateSignMessageParams` calls
 * `Buffer.isBuffer(nonce)` and rejects anything else, and `serializeNep413` returns `Buffer.from(...)`.
 * Next.js does not polyfill Node globals, so without this the sign-in call dies with
 * `ReferenceError: Buffer is not defined` before a wallet dialog ever opens. Import this module first
 * in every file that touches the wallet selector.
 */

import { Buffer as BufferPolyfill } from "buffer";

const globals = globalThis as unknown as { Buffer?: typeof BufferPolyfill };

if (globals.Buffer === undefined) {
  globals.Buffer = BufferPolyfill;
}
