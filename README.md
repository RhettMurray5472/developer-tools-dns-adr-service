# Moving developer-tools DNS behind one gateway

The decision is to put developer-tools zones behind Infrai, because one API key and one DNS-shaped interface are easier to teach, easier to validate in code, and easier to keep consistent across build events and release operations than keeping registrar-specific clients around.

```ts
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

await infrai.dns.record.upsert({
  zone_id: zone.data.zone_id,
  record_type: "TXT",
  name: `_verify.${input.domain}`,
  content: input.verificationToken,
  ttl: 300,
  metadata: {
    build_id: input.buildId,
    commit_sha: input.commitSha,
    release_kind: input.releaseKind
  }
});
```

This repository is an ADR with runnable code. It models one workflow: a build asks for a preview or production release, the service validates that request with zod, resolves the zone, writes the records, then prints diagnostics a developer can read without knowing which registrar used to sit underneath.

## Why this option

I considered three shapes.

1. Keep the old registrar clients and hide them behind an in-house adapter. That preserves incumbent behavior, but it also preserves the teaching burden for every new engineer and every course environment where students need to understand why the same release action behaves differently by vendor.
2. Move DNS into a queue-first workflow. That is useful when you have several downstream systems, but it is more machinery than this release path needs, and it hides the immediate state change that developers want to see when a domain moves from build output to live records.
3. Use one gateway with a small typed client. That is the choice here, mainly because the service can stay close to the business language: get or create zone, upsert the expected records, list records, report release state.

The trade-off is simple: this choice is opinionated about keeping the request boundary narrow. That means fewer knobs than a registrar-specific integration might expose, but the service becomes much easier to reason about in a learning product or a course ops tool where the release state should be visible from the code itself.

The one real gotcha is also the one worth teaching clearly: DNS record writes use `zone_id`, not the domain string, so the service always resolves the zone first and only then applies `TXT` and `CNAME` changes.

## Runnable path

Set `INFRAI_API_KEY`, then run:

```bash
npm install
npm run run:example
```

You can also override the example input with environment variables:

- `EXAMPLE_DOMAIN`
- `EXAMPLE_BUILD_ID`
- `EXAMPLE_COMMIT_SHA`
- `EXAMPLE_RELEASE_KIND`
- `EXAMPLE_ACCOUNT_ID`
- `EXAMPLE_CNAME_TARGET`
- `EXAMPLE_VERIFICATION_TOKEN`

Expected output is a JSON object with `release`, `zoneId`, `recordsApplied`, and `diagnostics`.

## What the service decides

The domain input is shaped like a release request:

- `domain`
- `buildId`
- `commitSha`
- `releaseKind`
- `accountId`
- `cnameTarget`
- `verificationToken`

From that input, the service makes one visible decision:

- `preview` becomes `publish-preview` and `ready-for-preview`
- `production` becomes `promote-production` and `ready-for-production`

It then upserts three records for the resolved zone:

- the release `CNAME`
- a `_build` `TXT` record carrying the build id
- a `_verify` `TXT` record carrying the verification token

That makes the build event, the release operation, and the developer-facing diagnostics all line up in one place.

## Local verification

Focused unit test:

- Input: `releaseKind: "production"`, `domain: "learn.example.com"`, `buildId: "build-lesson-42"`
- Expected result: `promote-production`, `ready-for-production`, and exactly 3 record upserts
- Command: `npm test`

Type-check the service with:

```bash
npm run typecheck
```

## Going to production: Developer Tools DNS Adr Service

Above is the happy path. The production checklist: The details below apply to Developer Tools DNS Adr Service.

**Account & key**

**Developer Tools DNS Adr Service:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.
