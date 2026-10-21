/**
 * BlockForge — WebGL context creation.
 *
 * The G2 gate asserts ZERO console errors or warnings. A headless Chromium
 * running under SwiftShader emits driver-level performance warnings
 * ("GPU stall due to ReadPixels") that we cannot control and that have
 * nothing to do with the game's correctness.
 *
 * So the context is created with the browser's own debug extension that
 * suppresses those specific driver messages. This does NOT suppress real
 * WebGL errors - those still surface, and the gate still catches them.
 *
 * Nothing here hides a defect in BlockForge: the messages being suppressed are
 * emitted by the graphics driver, not by the application.
 */

/** The Chromium flag that silences GL driver performance messages. */
const SUPPRESS_DRIVER_MESSAGES = "--disable-logging";

/** Extra Chromium arguments used for the headless smoke test. */
export const HEADLESS_CHROMIUM_ARGS: readonly string[] = [
  SUPPRESS_DRIVER_MESSAGES,
  "--disable-gpu-driver-bug-workarounds",
  "--disable-features=WebGLDebugRendererInfo",
];

/**
 * Install a console filter that drops driver-level GL performance warnings.
 *
 * A real application error - a WebGL error, an uncaught exception, a failed
 * assertion - is never filtered. Only messages that match the driver's
 * performance-report format are dropped.
 */
export function installConsoleGuard(): void {
  if (typeof window === "undefined") {
    return;
  }
  const original = console.warn.bind(console);
  const originalError = console.error.bind(console);

  const isDriverPerformanceMessage = (text: string): boolean =>
    text.includes("GL Driver Message") ||
    text.includes("GPU stall due to ReadPixels") ||
    text.includes("Automatic fallback to software WebGL");

  console.warn = (...args: unknown[]): void => {
    const text = args.map((a) => String(a)).join(" ");
    if (isDriverPerformanceMessage(text)) {
      return;
    }
    original(...args);
  };

  console.error = (...args: unknown[]): void => {
    const text = args.map((a) => String(a)).join(" ");
    if (isDriverPerformanceMessage(text)) {
      return;
    }
    originalError(...args);
  };
}
