---
layout: layouts/post.njk
title: "Introducing chaos-fetch: Network Chaos Injection for Fetch Requests"
date: 2025-09-27
description: chaos-fetch is a TypeScript library for injecting network chaos - latency, failures, drops - into fetch requests. Easily simulate adverse network conditions in client-side code for robust testing and resilience. Now available as @fetchkit/chaos-fetch on npm.
excerpt: "Introducing chaos-fetch: a TypeScript/ESM library for injecting network chaos (latency, failures, drops, etc.) into fetch requests. Designed for programmatic use, chaos-fetch provides a flexible middleware system for simulating adverse network conditions in client-side code."
tags:
- posts
- announcements
- javascript
- typescript
- testing
---
Introducing [chaos-fetch](https://www.npmjs.com/package/@fetchkit/chaos-fetch): a TypeScript/ESM library for injecting network chaos (latency, failures, drops, etc.) into fetch requests. Designed for programmatic use, `chaos-fetch` provides a flexible middleware system for simulating adverse network conditions in client-side code.

For advanced testing scenarios, `chaos-fetch` can be used alongside [chaos-proxy](https://www.npmjs.com/package/@fetchkit/chaos-proxy). While chaos-proxy operates at the proxy level to introduce chaos across all HTTP traffic, `chaos-fetch` allows targeted control within your application logic. This combination enables comprehensive resilience testing, covering both infrastructure and application layers.

`chaos-fetch` is suitable for development and testing environments where robust error handling and recovery strategies are required.

GitHub: [fetch-kit/chaos-fetch](https://github.com/fetch-kit/chaos-fetch)