import { describe, expect, it } from "vitest";
import { buildServerName, readConfigServerName, replaceConfigServerName, stripScore } from "@/lib/serverName";

const scores = [{ name: "Lonestar", score: 98 }, { name: "Valkyra", score: 45 }, { name: "Manticore", score: 12 }];

describe("server name", () => {
  it("appends the score", () => expect(buildServerName("My Server", scores)).toBe("My Server | L 98ㆍV 45ㆍM 12"));
  it("uses the base name at 0-0", () => expect(buildServerName("My Server", scores.map((s) => ({ ...s, score: 0 })))).toBe("My Server"));
  it("rejects names that are too long", () => expect(() => buildServerName("x".repeat(120), scores)).toThrow());
  it("strips a score suffix", () => {
    expect(stripScore("My Server | L 98ㆍV 45ㆍM 12")).toBe("My Server");
    expect(stripScore("My Server | Discord")).toBe("My Server | Discord");
  });
  it("replaces only the ServerName line", () => {
    const cfg = '[a]\r\nServerName="Old | x"\r\nServerPassword="p"\r\n';
    expect(readConfigServerName(cfg)).toBe("Old | x");
    expect(replaceConfigServerName(cfg, "New $& name")).toBe('[a]\r\nServerName="New $& name"\r\nServerPassword="p"\r\n');
    expect(() => replaceConfigServerName(cfg, 'a"b')).toThrow();
  });
});
