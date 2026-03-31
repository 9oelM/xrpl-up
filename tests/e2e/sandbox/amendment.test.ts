/**
 * Sandbox lifecycle — amendment list command tests.
 *
 * Requires the local rippled stack to be running (started by globalSetup).
 * All tests are read-only — no amendments are enabled or disabled.
 */
import { describe, it, expect } from "vitest";
import { runXrplUp } from "../../helpers/sandbox-cli";

describe("sandbox amendment list --local", () => {
  it("exits 0", () => {
    const result = runXrplUp(["amendment", "list", "--local"], {}, 30_000);
    expect(result.status).toBe(0);
  });

  it("stdout contains the Enabled column header", () => {
    const result = runXrplUp(["amendment", "list", "--local"], {}, 30_000);
    expect(result.stdout).toContain("Enabled");
  });

  it("stdout contains the Supported column header", () => {
    const result = runXrplUp(["amendment", "list", "--local"], {}, 30_000);
    expect(result.stdout).toContain("Supported");
  });

  it("stdout contains the summary count line", () => {
    const result = runXrplUp(["amendment", "list", "--local"], {}, 30_000);
    // Summary: "N enabled  ·  M supported but not enabled  ·  K total known"
    expect(result.stdout).toContain("total known");
  });

  it("stdout reports a non-zero number of enabled amendments", () => {
    const result = runXrplUp(["amendment", "list", "--local"], {}, 30_000);
    // Summary line: "<N> enabled  ·" — N must be > 0 for a properly started local node
    const match = result.stdout.match(/(\d+)\s+enabled\s+·/);
    expect(match).not.toBeNull();
    const count = parseInt(match![1], 10);
    expect(count).toBeGreaterThan(0);
  });
});

describe("sandbox amendment list --local --disabled", () => {
  it("exits 0", () => {
    // Shows only disabled amendments — may be an empty list, but must not crash.
    const result = runXrplUp(
      ["amendment", "list", "--local", "--disabled"],
      {},
      30_000,
    );
    expect(result.status).toBe(0);
  });
});

describe("sandbox amendment info --local (known amendment)", () => {
  it("looks up a known amendment by name and exits 0", () => {
    // fixUniversalNumber has been in rippled since 1.9.x — safe to use as a probe.
    const result = runXrplUp(
      ["amendment", "info", "fixUniversalNumber", "--local"],
      {},
      30_000,
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("fixUniversalNumber");
  });

  it("unknown amendment name exits 1", () => {
    const result = runXrplUp(
      ["amendment", "info", "ThisAmendmentDoesNotExist", "--local"],
      {},
      30_000,
    );
    expect(result.status).toBe(1);
  });
});
