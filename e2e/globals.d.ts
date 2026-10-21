/**
 * The browser tests' own instrumentation.
 *
 * The e2e tests declare globals they install themselves. This one counts
 * AudioContext constructions, so the test can prove that NONE happens before
 * a user gesture - a context created outside a gesture is what makes Chrome
 * log an autoplay warning, and the G2 gate fails on a single warning.
 *
 * TypeScript needs to know about them, because the e2e directory is
 * typechecked like everything else. That is a recent change: before it, the
 * browser tests were invisible to `tsc`.
 */
declare global {
  interface Window {
    /** How many AudioContexts the page has constructed. */
    __bfAudioContexts?: number;
  }
}

export {};
