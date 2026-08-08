/**
 * No-op stub for @opentelemetry/api
 * Prevents the Mistral SDK's optional telemetry module from failing at
 * build/runtime when the real package is not installed.
 * The Mistral SDK imports these only in its extra/observability/* path.
 */

const noopSpan = {
  setAttribute: () => noopSpan,
  setStatus: () => noopSpan,
  end: () => {},
  recordException: () => {},
  addEvent: () => noopSpan,
  isRecording: () => false,
  spanContext: () => ({ traceId: '0', spanId: '0', traceFlags: 0 }),
};

const noopTracer = {
  startSpan: () => noopSpan,
  startActiveSpan: (_name, optionsOrFn, contextOrFn, fn) => {
    const f = fn || contextOrFn || optionsOrFn;
    return typeof f === 'function' ? f(noopSpan) : undefined;
  },
};

export const trace = {
  getTracer: () => noopTracer,
  getActiveSpan: () => undefined,
  setSpan: (ctx) => ctx,
  getSpan: () => undefined,
};

export const context = {
  active: () => ({}),
  with: (_ctx, fn, _thisArg, ..._args) => fn(),
  bind: (_ctx, fn) => fn,
  disable: () => {},
};

export const propagation = {
  inject: () => {},
  extract: (_ctx, _carrier) => _ctx,
  fields: () => [],
};

export const SpanStatusCode = { UNSET: 0, OK: 1, ERROR: 2 };

export const SpanKind = {
  INTERNAL: 0, SERVER: 1, CLIENT: 2, PRODUCER: 3, CONSUMER: 4,
};

export const diag = {
  setLogger: () => {},
  verbose: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
};

export const ROOT_CONTEXT = {};
