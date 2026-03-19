---
layout: layouts/post.njk
title: Developing and Benchmarking the Same Feature in Node and Go
date: 2026-03-19
description: "Compare the performance of chaos-proxy in Node.js vs Go for HTTP chaos testing. See benchmarks, results, and practical advice for choosing the right proxy for resilient full stack app testing."
excerpt: "When I started building chaos-proxy, the initial goal was simple: make API chaos testing practical for JavaScript and TypeScript teams. I wanted something that could sit between an app and its upstream API and introduce realistic turbulence on demand: latency spikes, intermittent failures, and other behavior that makes integration tests feel closer to production."
tags:
- posts
- testing
- javascript
- typescript
- golang
---
When I started building chaos-proxy, the initial goal was simple: make API chaos testing practical for JavaScript and TypeScript teams. I wanted something that could sit between an app and its upstream API and introduce realistic turbulence on demand: latency spikes, intermittent failures, and other behavior that makes integration tests feel closer to production.

Node.js was the obvious first runtime for that because the ecosystem, tooling, and middleware ergonomics are excellent for rapid iteration. It is hard to overstate how productive that setup is when the main audience is already living in npm, TypeScript, and JavaScript test runners.

Later, I rewrote the same proxy in Go to push raw proxy performance further and support higher throughput under load. The intent was not to replace one with the other philosophically, but to explore a different optimization frontier with the same product idea.

This post documents what happened when I implemented the same non-trivial feature in both runtimes: hot config reload. Then I reran the benchmark from my previous article to see how the newer versions compare.

The interesting part is not only the final numbers. It is also how two mature runtimes guide you toward different internal designs, even when you are enforcing the same external behavior contract.

Old benchmark post:
[https://blog.gaborkoos.com/posts/2025-10-11-Nodejs-vs-Go-in_Practice-Performance-Comparison-of-chaos-proxy-And-chaos-proxy-go/](https://blog.gaborkoos.com/posts/2025-10-11-Nodejs-vs-Go-in_Practice-Performance-Comparison-of-chaos-proxy-And-chaos-proxy-go/)

Repositories:
- Node implementation: [https://github.com/fetch-kit/chaos-proxy](https://github.com/fetch-kit/chaos-proxy)
- Go implementation: [https://github.com/fetch-kit/chaos-proxy-go](https://github.com/fetch-kit/chaos-proxy-go)

## Implementing Hot Config Reload in Two Runtimes

The goal of hot config reload was to allow users to update the proxy's behavior without downtime. This means that when a new config is posted to the /reload endpoint, the proxy should parse, validate, and apply the new configuration atomically, without interrupting in-flight requests. This enables advanced testing scenarios where you can change the chaos behavior on the fly to model dynamic production conditions like feature rollouts, traffic shifts, or evolving failure modes.

Both implementations follow the same external contract:
- POST /reload accepts a full config snapshot
- Parse -> validate -> build -> swap, all-or-nothing
- Deterministic in-flight behavior (request-start snapshot semantics)
- Reject concurrent reload requests
- Consistent status model (400, 409, 415, success returns version and reload duration)

So the user-facing behavior is aligned. Clients see the same API and guarantees. The internal shape is where Node and Go felt very different.

### Runtime model

**Node** leaned toward a dynamic runtime object: rebuild middleware/router chain, then swap the active runtime. That style maps naturally to the way Node applications are often composed. Rebuilds are straightforward to express, and the overall control flow stays compact.

**Go** leaned toward immutable runtime snapshots: config + router + version behind an atomic pointer. In practice, this makes the runtime feel more explicit. You can point to exactly what a request observed and exactly when a new version became active.

### Concurrency model

In **Node**, most complexity is around making reload writes serialized and safe while requests continue flowing.

In **Go**, the read/write split is explicit: request path loads one snapshot at request start, reload path builds fresh state under lock, then atomically swaps.

Behaviorally both approaches are equivalent from a user perspective. The difference is mostly in how obvious the invariants are when you revisit the code weeks later.

### In-flight guarantees

Both versions guarantee request-start snapshot semantics.

In **Node**, this is easier to accidentally violate if mutable shared state leaks into request handling.

In **Go**, the pointer-load-at-entry pattern makes this guarantee structurally harder to violate.

That was one of the strongest practical contrasts for me: same requirement, different default safety profile.

### Router lifecycle and rebuild mechanics

**Node** composition is lightweight and ergonomic for rebuilds.

**Go** rebuilds a fresh router and re-registers middleware/routes on each reload. Behavior is explicit and predictable at the snapshot level, with middleware execution order deterministic only when config uses ordered list elements (not multiple keys in one map). It can look verbose at first, but this explicitness pays off when debugging edge cases around reload timing.

### Validation and rollback boundaries

Both use the same pipeline: parse -> validate -> build -> swap.

**Node** gives more dynamic flexibility but needs stricter guard discipline.

**Go**'s type-driven pipeline made failure paths and rollback behavior cleaner to reason about.

In both runtimes, treating build and swap as separate phases was the key to keeping rollback semantics simple.

### Stateful middleware behavior

Both implementations rebuild middleware instances on reload. That means in-memory middleware state (for example counters or local token buckets) resets by design after a successful reload. This is intentional and worth calling out to users because it is product behavior, not an implementation accident.

## Benchmark Rerun

After adding hot config reload support, I reran the old benchmark setup.

The goal here was not to produce an absolute, universal number for every environment. The goal was to keep methodology stable enough to compare the old and new versions and see whether the relative shape changed.

### System and Test Environment (Same Machine as the Old Article)

This rerun was executed on the same machine as the benchmark in the previous article, with the same local topology (Caddy backend on localhost, proxy on localhost, load generated by hey on the same host).

Machine characteristics:
- CPU: AMD Ryzen 7 5800H with Radeon Graphics
- Cores/Threads: 8 cores / 16 threads
- Base clock: 3.2 GHz
- RAM: 16 GB DDR4
- OS: Windows 10 Home 22H2 64-bit

Benchmark setup characteristics:
- Backend: Caddy serving /api/hello on localhost:8080
- Proxy target: localhost:5000
- Load generator: hey
- Command pattern: hey -n 1000 -c 50 http://localhost:<port>/api/hello
- Runs per scenario: 3 (median reported)

Reproducibility command block (same pattern used for this article):

```bash
# 1) Start Caddy backend
./caddy.exe run --config Caddyfile

# 2) Baseline (direct Caddy)
for i in 1 2 3; do ./hey -n 1000 -c 50 http://localhost:8080/api/hello | tee -a baseline-caddy-runs.txt; done

# 3) Node proxy benchmark (in another terminal, start proxy first)
npx chaos-proxy --config chaos.yaml
for i in 1 2 3; do ./hey -n 1000 -c 50 http://localhost:5000/api/hello | tee -a node-3.0.1-runs.txt; done

# Stop the Node proxy process before running the Go proxy benchmark (both use port 5000)

# 4) Go proxy benchmark (in another terminal, start proxy first)
./chaos-proxy-go.exe --config chaos.yaml
for i in 1 2 3; do ./hey -n 1000 -c 50 http://localhost:5000/api/hello | tee -a go-0.2.1-runs.txt; done
```

Versions in this rerun:
- chaos-proxy (Node): 3.0.1
- chaos-proxy-go (Go): 0.2.1

I also verified response-size parity for fairness:
- Caddy: 94 bytes/request
- Node 3.0.1: 94 bytes/request
- Go 0.2.1: 94 bytes/request

This check mattered because an earlier Node run returned compacted JSON (smaller payload), which could bias throughput. The final numbers below use matched response sizes.

### Current Rerun (Median of 3)

| Scenario | Requests/sec | Avg Latency (s) | P99 Latency (s) |
|---|---:|---:|---:|
| Direct Caddy | 24,912.1845 | 0.0018 | 0.0156 |
| chaos-proxy Node 3.0.1 | 3,788.0065 | 0.0129 | 0.0318 |
| chaos-proxy-go 0.2.1 | 7,286.8293 | 0.0062 | 0.0248 |

### Old Benchmark Reference (from previous post)

| Scenario | Requests/sec | Avg Latency (s) | P99 Latency (s) |
|---|---:|---:|---:|
| Direct Caddy | 28,383.8519 | 0.0016 | 0.0116 |
| chaos-proxy Node 2.0.0 | 4,262.3420 | 0.0115 | 0.0417 |
| chaos-proxy-go 0.0.5 | 8,828.0577 | 0.0053 | 0.0140 |

### What changed?

1) Go vs Node in current versions

- Go is still clearly ahead.
- Throughput: Go is about 1.92x higher than Node (7286.8 vs 3788.0 req/sec).
- Average latency: Node is about 2.08x slower than Go (0.0129s vs 0.0062s).

2) Go old vs Go new

- Throughput decreased from 8828.1 to 7286.8 req/sec (~17.5% lower).
- Average latency increased from 0.0053s to 0.0062s (~17.0% higher).
- P99 increased from 0.0140s to 0.0248s.

3) Node old vs Node new

- Throughput decreased from 4262.3 to 3788.0 req/sec (~11.1% lower).
- Average latency increased from 0.0115s to 0.0129s (~12.2% higher).
- P99 improved from 0.0417s to 0.0318s.

Adding hot-reload-safe runtime mechanics introduces measurable overhead even in steady-state forwarding paths, which is why both implementations are slower than their previous versions in this benchmark shape.

I did not trigger reloads during benchmark traffic, so this should be interpreted as structural overhead from the runtime architecture needed to guarantee safe reload semantics, not reload execution cost itself.

### Why There Is Overhead Even Without Calling /reload

Even if reload is never triggered during the benchmark request stream, the hot reload feature still changes the steady-state architecture:
- Requests now run through runtime indirection designed for safe snapshot semantics.
- Runtime objects and routing/middleware composition are organized around swap-ready boundaries.
- Concurrency guards and state-boundary discipline are now part of the normal request path design.

In other words, the cost is not from running /reload repeatedly during the test. The cost comes from maintaining reload-safe invariants all the time.

## Conclusion

Implementing the same feature in Node and Go was one of the most useful engineering exercises I have done in a while.

The final behavior contract can be identical across runtimes, but the implementation pressure points are very different:
- Node emphasizes dynamic composition and careful mutation control.
- Go emphasizes snapshot immutability and explicit concurrency boundaries.

Performance-wise, the high-level outcome still holds: the Go proxy remains roughly 2x faster than the Node proxy in this benchmark shape. At the same time, both implementations are now better specified in terms of live reconfiguration semantics, which was the actual feature goal. The implementations are likely not fully performance-tuned yet. For now, that trade-off is acceptable for the feature guarantees we wanted.

And yes, it was genuinely fun to build.
