export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startRosterGateway } = await import("./server/services/rosterGateway");
    startRosterGateway();
    const { startGoldScheduler } = await import("./server/services/gold");
    startGoldScheduler();
  }
}
