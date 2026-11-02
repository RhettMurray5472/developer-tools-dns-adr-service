import { describe, expect, it, vi } from "vitest";
import { ensureZoneAndRecords, explainDeveloperDiagnostics, planRelease } from "../src/zone_release";
import type { ReleaseRequest } from "../src/release_decision";

describe("developer-tools DNS release decision", () => {
  const input: ReleaseRequest = {
    domain: "learn.example.com",
    buildId: "build-lesson-42",
    commitSha: "1234567abcd",
    releaseKind: "production",
    accountId: "academy",
    cnameTarget: "prod.devtools.internal",
    verificationToken: "verify-lesson-token"
  };

  it("promotes production with three expected records and readable diagnostics", async () => {
    const upsertRecord = vi.fn(async () => ({ data: {} }));
    const listRecords = vi.fn(async () => ({ data: [{ id: 1 }, { id: 2 }, { id: 3 }] }));

    const plan = planRelease(input);
    const result = await ensureZoneAndRecords({
      input,
      zoneId: "zone_123",
      upsertRecord,
      listRecords
    });
    const diagnostics = explainDeveloperDiagnostics({
      domain: input.domain,
      buildId: input.buildId,
      commitSha: input.commitSha,
      releaseKind: input.releaseKind,
      recordSummary: result.recordSummary,
      releaseDecision: plan
    });

    expect(plan.releaseState).toBe("ready-for-production");
    expect(plan.operation).toBe("promote-production");
    expect(result.recordsApplied).toBe(3);
    expect(upsertRecord).toHaveBeenCalledTimes(3);
    expect(upsertRecord).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        zone_id: "zone_123",
        record_type: "CNAME",
        name: "learn.example.com",
        content: "prod.devtools.internal"
      })
    );
    expect(diagnostics.developerNotes[0]).toContain("zone_id");
    expect(diagnostics.headline).toBe("Domain learn.example.com is ready-for-production.");
  });
});
