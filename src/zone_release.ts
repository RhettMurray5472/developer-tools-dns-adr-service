import type { ReleaseRequest } from "./release_decision";

export type ReleasePlan = {
  operation: "publish-preview" | "promote-production";
  releaseState: "ready-for-preview" | "ready-for-production";
  expectedRecords: Array<{
    record_type: "CNAME" | "TXT";
    name: string;
    content: string;
    ttl: number;
  }>;
};

export function planRelease(input: ReleaseRequest): ReleasePlan {
  const expectedRecords = [
    {
      record_type: "CNAME" as const,
      name: input.domain,
      content: input.cnameTarget,
      ttl: 300
    },
    {
      record_type: "TXT" as const,
      name: `_build.${input.domain}`,
      content: input.buildId,
      ttl: 300
    },
    {
      record_type: "TXT" as const,
      name: `_verify.${input.domain}`,
      content: input.verificationToken,
      ttl: 300
    }
  ];

  if (input.releaseKind === "production") {
    return {
      operation: "promote-production",
      releaseState: "ready-for-production",
      expectedRecords
    };
  }

  return {
    operation: "publish-preview",
    releaseState: "ready-for-preview",
    expectedRecords
  };
}

type UpsertRecord = (body: {
  zone_id: string;
  record_type: string;
  name: string;
  content: string;
  ttl?: number;
  metadata?: Record<string, unknown>;
}) => Promise<{ data: unknown; metadata?: Record<string, unknown> }>;

type ListRecords = (query: { zone_id: string }) => Promise<{ data: Array<Record<string, unknown>>; metadata?: Record<string, unknown> }>;

export async function ensureZoneAndRecords(args: {
  input: ReleaseRequest;
  zoneId: string;
  upsertRecord: UpsertRecord;
  listRecords: ListRecords;
}): Promise<{
  recordsApplied: number;
  recordSummary: string[];
}> {
  const plan = planRelease(args.input);

  for (const record of plan.expectedRecords) {
    await args.upsertRecord({
      zone_id: args.zoneId,
      record_type: record.record_type,
      name: record.name,
      content: record.content,
      ttl: record.ttl,
      metadata: {
        build_id: args.input.buildId,
        commit_sha: args.input.commitSha,
        release_kind: args.input.releaseKind
      }
    });
  }

  const existing = await args.listRecords({ zone_id: args.zoneId });
  const summary = plan.expectedRecords.map((record) => `${record.record_type} ${record.name} -> ${record.content}`);

  return {
    recordsApplied: plan.expectedRecords.length,
    recordSummary: summary.concat(`listed=${existing.data.length}`)
  };
}

export function explainDeveloperDiagnostics(args: {
  domain: string;
  buildId: string;
  commitSha: string;
  releaseKind: "preview" | "production";
  recordSummary: string[];
  releaseDecision: ReleasePlan;
}): {
  headline: string;
  buildEvent: string;
  releaseOperation: string;
  developerNotes: string[];
} {
  const gotcha = "The one gotcha is that record changes use zone_id, so the service fetches or creates the zone before it writes TXT or CNAME records.";

  return {
    headline: `Domain ${args.domain} is ${args.releaseDecision.releaseState}.`,
    buildEvent: `Build ${args.buildId} from ${args.commitSha} prepared a ${args.releaseKind} release.`,
    releaseOperation: args.releaseDecision.operation,
    developerNotes: [gotcha, ...args.recordSummary]
  };
}
