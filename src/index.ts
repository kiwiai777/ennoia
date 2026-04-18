const STAGE = "Stage 0 — Initialization";

function main(): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Cortex started (${STAGE})`);
}

main();
