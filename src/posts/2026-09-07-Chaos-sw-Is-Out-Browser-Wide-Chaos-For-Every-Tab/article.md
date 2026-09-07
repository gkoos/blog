---
layout: layouts/post.njk
title: "chaos-sw Is Out: Browser-Wide Chaos For Every Tab"
date: 2026-09-07
description: chaos-sw brings browser-wide network chaos injection to every controlled tab, and chaos-fetch 1.3.0 adds origin-aware route matching and cleaner public config types.
excerpt: "chaos-sw is out, and chaos-fetch 1.3.0 adds origin-aware routing for more realistic browser and Service Worker testing."
tags:
- posts
- announcements
- javascript
- typescript
- testing
- fetch-kit
---
Two releases are out:

- [`@fetchkit/chaos-sw`](https://www.npmjs.com/package/@fetchkit/chaos-sw)
- [`@fetchkit/chaos-fetch` 1.3.0](https://www.npmjs.com/package/@fetchkit/chaos-fetch)

Together, they give a more complete workflow for testing real browser apps under degraded network conditions.

## chaos-sw: browser-wide chaos without changing app code

`chaos-sw` installs a Service Worker that intercepts requests from every controlled browser tab and applies the same middleware rules as `chaos-fetch`. Your app can keep using its regular `fetch` calls; latency, failures, rate limits, throttling, and mock responses are applied centrally.

This is useful when you want to test a real app under slow, flaky, or failing conditions without rewriting the code paths under test.

Some of the package highlights from the README:

- Service Worker interception for browser requests
- Global and route-specific chaos rules
- Path-only and exact-origin absolute URL matching
- Built-in latency, failure, rate-limit, throttle, and mock middleware
- Runtime enable, disable, config replacement, and scenario reset
- Standalone worker or integration with an existing Service Worker

The setup is intentionally simple:

```sh
npm install @fetchkit/chaos-sw
npx chaos-sw init public
```

Then you can apply a config like this:

```ts
await chaos.applyConfig({
  global: [{ latencyRange: { minMs: 100, maxMs: 500 } }],
  routes: {
    'GET /api/users/:id': [
      { failNth: { n: 3, status: 503 } },
    ],
  },
})
```

This makes the chaos layer feel less like a custom fetch wrapper and more like a browser-wide test harness.

## chaos-fetch 1.3.0: more realistic routing

The new `chaos-fetch` release adds origin-specific routing with absolute URL patterns while keeping path-based routing intact for browser and Service Worker use cases.

It also exports the public `ChaosConfig` and `MiddlewareConfig` types, and replaces the `@koa/router` dependency with a direct `path-to-regexp` matcher. That reduces integration friction and removes the Node.js `http`/`url` requirement from the browser bundle.

The result is a cleaner middleware model for real-world routing, especially when the same app needs to target different origins or split global and route-specific behavior.

## Using them together

The two tools are intentionally complementary:

- `chaos-fetch` is the middleware layer you can use directly in app code and tests.
- `chaos-sw` extends the same configuration model to every controlled tab in the browser.

That gives you a clear path from targeted tests to realistic browser-level resilience experiments.

If you are testing frontend behavior under degraded conditions, both packages are worth a look.

GitHub:

- [fetch-kit/chaos-sw](https://github.com/fetch-kit/chaos-sw)
- [fetch-kit/chaos-fetch](https://github.com/fetch-kit/chaos-fetch)

npm:

- [@fetchkit/chaos-sw](https://www.npmjs.com/package/@fetchkit/chaos-sw)
- [@fetchkit/chaos-fetch](https://www.npmjs.com/package/@fetchkit/chaos-fetch)
