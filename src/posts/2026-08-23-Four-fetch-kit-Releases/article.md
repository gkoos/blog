---
layout: layouts/post.njk
title: "Four fetch-kit releases: ffetch 5.6.1 and the chaos tools"
date: 2026-08-23
description: Four fetch-kit releases with new fuzz tests, bug fixes, hardened CI and release pipelines, and OpenSSF Scorecards.
excerpt: "ffetch 5.6.1, chaos-fetch 1.2.3, chaos-proxy 3.4.2, and chaos-proxy-go 0.6.1 are out."
tags:
- posts
- announcements
- javascript
- typescript
- go
- fetch-kit
---
Four fetch-kit releases are out:

- [`@fetchkit/ffetch` 5.6.1](https://www.npmjs.com/package/@fetchkit/ffetch)
- [`@fetchkit/chaos-fetch` 1.2.3](https://www.npmjs.com/package/@fetchkit/chaos-fetch)
- [`@fetchkit/chaos-proxy` 3.4.2](https://www.npmjs.com/package/@fetchkit/chaos-proxy)
- [`chaos-proxy-go` 0.6.1](https://github.com/fetch-kit/chaos-proxy-go/releases/tag/v0.6.1)

These are patch releases, but the maintenance pass behind them was much larger than the version numbers suggest.

## Fuzzing and bug fixes

All four projects now have fuzz or property-based tests around their important state machines and boundaries: retries and hedging in `ffetch`; middleware, routing, streams, and telemetry in the chaos tools; and native Go fuzz targets in `chaos-proxy-go`.

The generated tests found real bugs, including cancellation and lifecycle leaks, rate-limit boundary errors, incorrect global fetch restoration, malformed configuration handling, broken empty proxy responses, and configuration values that could panic the Go proxy. The fixes are included in these releases and preserved as regression tests.

## CI and security

I also brought the repositories onto the same CI and security baseline: upgraded and pinned GitHub Actions, narrowly scoped workflow permissions, dependency and vulnerability checks, CodeQL, secret scanning, private vulnerability reporting, and OpenSSF Scorecard workflows.

The JavaScript projects now use the current Changesets release flow, while `chaos-proxy-go` uses Release Please and GoReleaser. Release versions and artifacts are aligned again, and `ffetch` releases now include verified provenance and an SBOM.

You can find the full ecosystem at [fetchkit.org](https://fetchkit.org) and the source code under the [fetch-kit GitHub organization](https://github.com/fetch-kit).