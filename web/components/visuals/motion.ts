// JS twins of the CSS timing tokens in app/globals.css (--dur-step, --dur-pop, --hold, --dur-fast).
// Timers in components must read these so JS and CSS agree. Change both places together.
export const STEP_MS = 600; // --dur-step
export const POP_MS = 420; // --dur-pop
export const HOLD_MS = 2500; // --hold
export const FAST_MS = 180; // --dur-fast
