---
layout: layouts/post.njk
title: "Small-Scale Chaos Testing: The Missing Step Before Production"
date: 2025-10-01
description: Using chaos-fetch and chaos-proxy for lightweight chaos testing in dev/staging to improve app resilience and UX.
excerpt: "Chaos testing usually brings Netflix or Amazon to mind: production services deliberately stressed to find weaknesses. For smaller teams, or solo developers, that kind of chaos feels extreme or impractical."
tags:
- posts
- testing
---
Chaos testing usually brings Netflix or Amazon to mind: production services deliberately stressed to find weaknesses. For smaller teams, or solo developers, that kind of chaos feels extreme or impractical.

But controlled chaos tests in dev or staging can catch problems earlier, improve resilience, and prevent production surprises - all without tearing down your infrastructure.

## What Real Developers Are Doing

I recently asked developers on Reddit about chaos testing in everyday dev/QA environments. Key takeaways:

- Many teams don't run chaos tests at all.
- Teams that do often limit them to production with large-scale infrastructure tools.
- Lightweight chaos in dev or staging environments is rare.
- Some teams use chaos creatively: for onboarding, troubleshooting, or uncovering hidden assumptions, rather than strictly for production reliability.

There seems to be a gap here: **small-scope chaos in dev/stage is largely unexplored**. Are we missing opportunities to catch UX and resilience issues before production? From my own experience, small-scale chaos can reveal frontend and API issues that would otherwise slip through.

## Why Lightweight Chaos Matters

Simple failure scenarios can have big impacts:

- Slow or failing backend APIs can break frontends.
- Uncaught exceptions may cascade under edge-case conditions.
- UX issues often appear before production-scale failures.

Could testing one API or frontend component in dev reveal fragile spots in your system? How would your app behave if a key service suddenly slowed down or returned errors? As a developer, you should want to know this before your users do.

## Where You Can Inject Chaos

Chaos doesn't require Netflix-level infrastructure. You can experiment in a few areas:

- Backend: simulate slow responses, inject random errors, or fail requests.
- Frontend: delay or fail API responses before they reach your app.
- Proxy/Network Layer: throttle requests, drop connections, or add latency.

What happens if your frontend suddenly experiences random latency or dropped requests? Which parts of your system hold up, and which break?

## Tools and Experimentation

Most standard testing frameworks focus on correctness and coverage, not resilience under failure. That means chaos testing often requires additional tools or custom scripts. Options include:

### The Big Guns

- [Toxiproxy](https://github.com/Shopify/toxiproxy): A proxy to simulate network conditions.
- [Chaos Monkey](https://github.com/Netflix/chaosmonkey): A classic tool for randomly terminating instances in production.
- [Gremlin](https://www.gremlin.com/): A more user-friendly chaos engineering platform that allows for a variety of failure modes.
- [Locust](https://locust.io/): While primarily a load testing tool, it can be used to simulate user behavior under stress.

### Handmade Frontend Solutions

- [Mock Service Worker](https://mswjs.io/): MSW can mock API responses, including delays and errors.
- [Custom Middleware](https://expressjs.com/en/guide/using-middleware.html): You can create custom middleware to introduce delays or failures in API calls.

### In Between

And there seems to be a large gap between the production-scale, infrastructure-heavy tools and the DIY frontend solutions. This is why I built a small set of libraries to fill that void:

- [chaos-fetch](https://github.com/fetch-kit/chaos-fetch): A lightweight TypeScript library to inject chaos (latency, failures, drops) into fetch requests. Ideal for frontend or backend code using fetch.
- [chaos-proxy](https://github.com/fetch-kit/chaos-proxy): A simple HTTP proxy to simulate network chaos across all HTTP traffic. Useful for testing how your app behaves under adverse network conditions.

### Non-JS Ecosystem

Of course not every app is a simple JS frontend to a Node backend. Other ecosystems may need their own tools, or proxies, but the principles remain the same: inject controlled chaos in dev/staging to catch issues early.

## Closing Thoughts

Now obviously, this "chaos light" approach isn't a substitute for full-scale chaos engineering in production. But it can be a practical step for smaller teams to improve resilience without massive overhead.

Chaos testing doesn't have to be a Netflix-scale operation. Many teams skip it entirely or only apply it in production. Running controlled chaos experiments in dev and staging can help you:

- Improve UX and resilience.
- Reduce surprises in production.
- Give your team confidence handling failures.

Could a few targeted chaos tests in your dev/staging environment make your system more robust tomorrow? How might you start exploring it this week?