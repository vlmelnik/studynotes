# Notes: Android

## 2026-11-21 — Share file digests with the WebView

Added synchronous `md5Hex`, `sha1Hex`, and `sha256Hex` for byte arrays and
UTF-8 strings. The shared module reuses the memory adapter's MD5 and SHA-256
rounds and provides SHA-1 for asset names. The three digests share block
handling. It reads complete blocks directly from the input view and copies
only the tail for padding to keep memory use bounded for large byte arrays.

The tests use standard vectors and Node's `crypto.createHash` for padding
edges, UTF-8, and a 1 MiB byte array. The large-input test reports elapsed time
per digest without enforcing a machine-specific deadline.

Platform adapter migration and performance testing on an Android device remain
open.

Next, use the shared digests in the WebView adapter and replace the memory
adapter's duplicate fallback code. Keep the adapter's existing asynchronous
API and use the same digest formats for sync checksums and stored asset names.

## 2026-11-23 — Share naming and case-only rename rules

Added `safeName`, `uniqueName`, `caseOnlyRename`, and `renamePlan` in
`src/shared/names.js`. Names fit both 120 UTF-16 units and 255 UTF-8 bytes
without cutting a character. Suffixes and the temporary `.renaming` marker
stay intact at both limits. Windows device names are prefixed even before an
extension. The caller supplies the exact source spelling and a snapshot of
sibling names. Per-character uppercase comparison recognizes Greek sigma's
two lowercase forms without treating `ß` as `SS`.

The plan does not touch the filesystem. Next, wire it into the desktop and
Android adapters. Recheck destination availability when applying the plan,
and handle rollback or recovery if the second rename fails. Verify the
case-only path on both platforms before replacing the existing library logic.
