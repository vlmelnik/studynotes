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
