---
layout: layouts/post.njk
title: "New InfoQ Article: One Cache to Rule Them All: Handling Responses and In-Flight Requests with Durable Objects"
date: 2026-01-28
description: Learn how to eliminate redundant cache computations in distributed systems using Cloudflare Durable Objects.
excerpt: "I have a new article out on InfoQ: One Cache to Rule Them All: Handling Responses and In-Flight Requests with Durable Objects"
tags:
- posts
- infoq
- javascript
---
I have a new article out on InfoQ:

[One Cache to Rule Them All: Handling Responses and In-Flight Requests with Durable Objects](https://www.infoq.com/articles/durable-objects-handle-inflight-requests/)

In this piece, I look at a subtle but impactful inefficiency in distributed caching: when many clients trigger the same expensive work because a cache miss hasn't yet been resolved.

Instead of treating in‑flight work and completed cache results separately, the article proposes a pattern where both are managed as different states of the same cache entry. Using Cloudflare Durable Objects' singleton execution and shared state guarantees, we can:

- eliminate redundant computations during cache misses,
- simplify system design without complex locks or polling,
- and maintain cache correctness under horizontal scaling.

This pattern applies to distributed edge runtimes and other environments that support per‑key singleton execution.