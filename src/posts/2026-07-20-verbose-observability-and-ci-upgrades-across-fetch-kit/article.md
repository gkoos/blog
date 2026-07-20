---
layout: layouts/post.njk
title: "chaos-proxy 3.4.0 and chaos-proxy-go 0.6.0, plus CI upgrades across fetch-kit"
date: 2026-07-20
description: Both chaos proxies gain structured --verbose observability, and every fetch-kit repo moves its release automation to a GitHub App with fixed Discord announcements.
excerpt: "chaos-proxy 3.4.0 and chaos-proxy-go 0.6.0 add structured --verbose logging, and the whole fetch-kit release pipeline moved to a GitHub App with working Discord announcements."
tags:
- posts
- announcements
- javascript
- typescript
- go
- fetch-kit
---
Two releases and a round of release-pipeline work across the fetch-kit ecosystem.

## Structured `--verbose` in both chaos proxies

Both the Node.js and Go chaos proxies now ship the same structured observability model behind `--verbose`.

- **[chaos-proxy 3.4.0](https://github.com/fetch-kit/chaos-proxy)** (`@fetchkit/chaos-proxy`) adds a verbose logging utility with structured events and automatic redaction of sensitive data.
- **[chaos-proxy-go 0.6.0](https://github.com/fetch-kit/chaos-proxy-go)** adds structured `--verbose` observability logging: `key=value` events for startup, request begin/end, config reloads, proxy errors, and shutdown. Sensitive query-string values are redacted and control characters are sanitized. Warnings and errors go to stderr, info and debug to stdout.

The result is that both runtimes emit consistent, greppable event lines you can pipe straight into your log tooling while chaos-testing.

## Release automation moved to a GitHub App

Behind the scenes, every fetch-kit repository moved its release automation off an expired personal access token and onto a dedicated GitHub App that mints short-lived installation tokens. This is more secure - no long-lived PAT sitting in secrets - and no longer breaks when a token expires.

That migration also fixed a subtle bug: release announcements to Discord had gone quiet. Tag-triggered announcement workflows weren't firing because pushes made with the built-in `GITHUB_TOKEN` deliberately do **not** dispatch downstream workflows. Pushing the release tag with an App installation token restores the trigger, so announcements flow again on:

- `@fetchkit/ffetch`
- `@fetchkit/chaos-fetch`
- `@fetchkit/chaos-proxy`
- `chaos-proxy-go` - which now posts release announcements for the first time

chaos-proxy-go's release workflow also bumped its Go runtime to `1.25.12` to clear a standard-library advisory.

As always, feedback and contributions are welcome in the [fetch-kit](https://github.com/fetch-kit) repositories.
