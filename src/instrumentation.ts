export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startRosterGateway } = await import("./server/services/rosterGateway");
    startRosterGateway();
    const { startSeedingScheduler } = await import("./server/services/seedingAfk");
    startSeedingScheduler();
    const { startGoldScheduler } = await import("./server/services/gold");
    startGoldScheduler();
    const { startMonitor } = await import("./server/services/monitor");
    startMonitor();
    const { startServerNameScheduler } = await import("./server/services/serverName");
    startServerNameScheduler();
    const { startRecruitAlertsScheduler } = await import("./server/services/recruitAlerts");
    startRecruitAlertsScheduler();
    const { startCalendarIconScheduler } = await import("./server/services/calendarIcon");
    startCalendarIconScheduler();
    const { startBriefingChannelCleanupScheduler } = await import("./server/services/briefingChannelCleanup");
    startBriefingChannelCleanupScheduler();
    const { startGwlArchiveScheduler } = await import("./server/services/gwlFixtures");
    startGwlArchiveScheduler();
    const { startGwlRaidScheduler } = await import("./server/services/gwlRaid");
    startGwlRaidScheduler();
  }
}
