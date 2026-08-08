/**
 * No-op stub for @opentelemetry/semantic-conventions
 * Prevents the Mistral SDK's optional observability module from failing at
 * build/runtime when the real package is not available as a top-level dep.
 * All constants are exported as empty strings / 0.
 */

// The Mistral SDK uses SEMATTRS_* constants for span attributes.
// Exporting an empty proxy satisfies the import without causing errors.
export const SEMATTRS_HTTP_METHOD = "http.method";
export const SEMATTRS_HTTP_URL = "http.url";
export const SEMATTRS_HTTP_STATUS_CODE = "http.status_code";
export const SEMATTRS_NET_PEER_NAME = "net.peer.name";
export const SEMATTRS_DB_SYSTEM = "db.system";
export const SEMATTRS_DB_STATEMENT = "db.statement";

// Catch-all: export a Proxy that returns empty strings for any attribute key
export default new Proxy({}, { get: (_t, k) => String(k) });
