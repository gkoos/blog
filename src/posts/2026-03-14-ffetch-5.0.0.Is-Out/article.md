---
layout: layouts/post.njk
title: Ffetch v5.0.0 Is Out!
date: 2026-03-14
description: A production-ready TypeScript-first drop-in replacement for native fetch. V5.0.0 is out.
excerpt: Ffetch v5.0.0 is out with breaking changes, a new public plugin lifecycle API, and first-party Circuit Breaker and Deduplication plugins.
tags:
- posts
- announcements
- javascript
- typescript
---
[Ffetch](https://www.npmjs.com/package/@fetchkit/ffetch) v5 is out! 

Ffetch is a lightweight, production-ready TypeScript-first drop-in replacement for native fetch.

**⚠️ This release includes breaking changes.**

This version introduces a new plugin system with the following improvements:

- support for third-party custom plugins through the public plugin lifecycle API
- first-party Circuit Breaker and Deduplication plugins.
- the deduplication plugin also includes an optional sweep timer to clean up stale entries from the in-flight dedupe map.
- docs were updated and test coverage was expanded across core flows and plugin behavior.

GitHub: [fetch-kit/ffetch](https://github.com/fetch-kit/ffetch)

Any feedback or contributions are welcome in the GitHub repository.