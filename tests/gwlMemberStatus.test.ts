import { describe, expect, it } from "vitest";
import { gwlMemberMatcher } from "@/lib/gwlMemberStatus";

const snapshot = (members: { discordId?: string | null }[], stale = false) => ({
  data: { members }, stale, fetchedAt: "2026-11-11T00:00:00Z",
});

describe("GWL Discord ID matching", () => {
  it("only links exact Discord IDs and does not infer non-registration", () => {
    const matcher = gwlMemberMatcher(snapshot([{ discordId: "123456789012345678" }, { discordId: null }]));
    expect(matcher.status("123456789012345678")).toBe("linked");
    expect(matcher.status("123456789012345679")).toBe("not_matched");
    expect(matcher.missingScope).toBe(false);
  });

  it("reports unknown for unavailable, stale or missing-scope data", () => {
    expect(gwlMemberMatcher(null).status("123456789012345678")).toBe("unknown");
    expect(gwlMemberMatcher(snapshot([{ discordId: "123456789012345678" }], true)).status("123456789012345678")).toBe("unknown");
    const missing = gwlMemberMatcher(snapshot([{}, { discordId: "123456789012345678" }]));
    expect(missing.missingScope).toBe(true);
    expect(missing.status("123456789012345678")).toBe("linked");
    expect(missing.status("123456789012345679")).toBe("unknown");
  });

  it("does not treat duplicate IDs as a reliable link", () => {
    const matcher = gwlMemberMatcher(snapshot([{ discordId: "123456789012345678" }, { discordId: "123456789012345678" }]));
    expect(matcher.status("123456789012345678")).toBe("unknown");
  });

  it("does not claim registration for an empty roster", () => {
    expect(gwlMemberMatcher(snapshot([])).status("123456789012345678")).toBe("not_matched");
  });
});
