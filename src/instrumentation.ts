export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startRosterGateway } = await import("./server/services/rosterGateway");
    startRosterGateway();
    const { startSeedingScheduler } = await import("./server/services/seedingAfk");
    startSeedingScheduler();
    const { startGoldScheduler } = await import("./server/services/gold");
    startGoldScheduler();
    const { startWdlRoleScheduler } = await import("./server/services/wdlRole");
    startWdlRoleScheduler();
    const { startMonitor } = await import("./server/services/monitor");
    startMonitor();
  }
}
