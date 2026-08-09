/**
 * Compatibility shim — pixtralVision.ts has been renamed to visionExtraction.ts.
 * This re-export exists solely so existing vi.mock("../lib/pixtralVision") in
 * the adversarial test suite continues to resolve the module.
 * New code must import from visionExtraction directly.
 */
export * from "./visionExtraction.js";
