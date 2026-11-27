// runBackgroundUpdateCheck was dead code - never called from anywhere in the app.
// Kept for reference but removed since it serves no purpose.

const STAGGER_MS = 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
