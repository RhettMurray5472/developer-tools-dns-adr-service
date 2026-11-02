import { z } from "zod";
import { infrai } from "./infrai_client";
import { ensureZoneAndRecords, explainDeveloperDiagnostics, planRelease } from "./zone_release";

const releaseRequestSchema = z.object({
  domain: z.string().min(1),
  buildId: z.string().min(1),
  commitSha: z.string().min(7),
  releaseKind: z.enum(["preview", "production"]),
  accountId: z.string().min(1),
  cnameTarget: z.string().min(1),
  verificationToken: z.string().min(1)
});

export type ReleaseRequest = z.infer<typeof releaseRequestSchema>;

async function main(): Promise<void> {
  const rawInput = {
    domain: process.env.EXAMPLE_DOMAIN ?? "docs-course.example.com",
    buildId: process.env.EXAMPLE_BUILD_ID ?? "build-2026-10-26-lesson-12",
    commitSha: process.env.EXAMPLE_COMMIT_SHA ?? "abc1234def56",
    releaseKind: (process.env.EXAMPLE_RELEASE_KIND as "preview" | "production" | undefined) ?? "preview",
    accountId: process.env.EXAMPLE_ACCOUNT_ID ?? "course-platform",
    cnameTarget: process.env.EXAMPLE_CNAME_TARGET ?? "preview.devtools.internal",
    verificationToken: process.env.EXAMPLE_VERIFICATION_TOKEN ?? "verify-course-domain-token"
  };

  const input = releaseRequestSchema.parse(rawInput);
  const releasePlan = planRelease(input);

  const zone = await infrai.dns.domain.get({ domain: input.domain }).catch(async () => {
    return infrai.dns.domain.add({
      domain: input.domain,
      vendor: "infrai",
      account_id: input.accountId,
      metadata: {
        build_id: input.buildId,
        commit_sha: input.commitSha,
        release_kind: input.releaseKind
      }
    });
  });

  const outcome = await ensureZoneAndRecords({
    input,
    zoneId: zone.data.zone_id,
    upsertRecord: infrai.dns.record.upsert,
    listRecords: infrai.dns.record.list
  });

  const diagnostics = explainDeveloperDiagnostics({
    domain: input.domain,
    buildId: input.buildId,
    commitSha: input.commitSha,
    releaseKind: input.releaseKind,
    recordSummary: outcome.recordSummary,
    releaseDecision: releasePlan
  });

  console.log(
    JSON.stringify(
      {
        release: releasePlan,
        zoneId: zone.data.zone_id,
        recordsApplied: outcome.recordsApplied,
        diagnostics
      },
      null,
      2
    )
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
