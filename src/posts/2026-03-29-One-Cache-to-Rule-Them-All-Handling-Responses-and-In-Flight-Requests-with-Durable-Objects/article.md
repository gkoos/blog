---
layout: layouts/post.njk
title: "One Cache to Rule Them All: Handling Responses and In-Flight Requests with Durable Objects"
date: 2026-03-29
description: "Unify response caching and in-flight request deduplication with Cloudflare Durable Objects to eliminate duplicate work during cache misses in distributed systems."
excerpt: "Caching is one of the first tools engineers reach for when optimizing distributed systems. We cache completed responses - such as database query results or HTTP response bodies - to avoid repeating expensive work. What traditional caching does not address, however, is a different and often overlooked source of inefficiency: duplicate in-flight requests."
tags:
- posts
- distributed cache
- Cloudflare
- javascript
---
*Originally published on [InfoQ](https://www.infoq.com/articles/durable-objects-handle-inflight-requests/) on Jan 28, 2026*

Caching is one of the first tools engineers reach for when optimizing distributed systems. We cache completed responses - such as database query results or HTTP response bodies - to avoid repeating expensive work. What traditional caching does not address, however, is a different and often overlooked source of inefficiency: duplicate in-flight requests.

When multiple clients request the same resource at roughly the same time, a cache miss can trigger several identical computations in parallel. In a single-process JavaScript application, this is commonly mitigated by storing the in-flight Promise in memory so that subsequent callers can await the same result. In other languages and runtimes, similar effects may be achieved through different concurrency primitives, but the underlying assumption is the same: shared memory and a single execution context.

In distributed, serverless, or edge environments, this assumption no longer holds. Each instance has its own memory, and any form of in-flight deduplication is limited to the lifetime and scope of a single process.

Engineers often respond by introducing a second mechanism alongside their cache: locks, markers, or coordination records to track work in progress. These approaches are difficult to reason about and frequently degrade into polling or coarse-grained synchronization.

This article proposes a different model: treating completed responses and in-flight requests as two states of the same cache entry. Using Cloudflare Workers and Durable Objects, we can assign a single, authoritative owner to each cache key. That owner can safely hold an in-memory representation of ongoing work, allow concurrent callers to wait on it, and then transition the entry into a cached response once the work completes.

Rather than introducing a separate coordination layer, this pattern unifies caching and in-flight deduplication behind a single abstraction. While it relies on runtime features that are not universally available, it provides a clean and practical approach for environments that support per-key singleton execution.

## The Problem in Depth

At a high level, the problem is not caching itself, but what happens before a cache entry exists.

Consider an expensive operation: a database query, an external API call, or a CPU-heavy computation. In a distributed edge environment, multiple clients may request the same resource within a very short time window. If the cache does not yet contain a value for that key, each request independently triggers the same work.

Because edge runtimes intentionally scale horizontally, these requests are often handled by **different execution contexts**. Each context observes the same cache miss and proceeds as if it were the first requester. The result is a burst of redundant work that caching was supposed to prevent, but cannot, because *the cache only helps after the first request completes*.

In response, many systems introduce an additional mechanism to track work in progress. One cache is used for completed results, while another structure - sometimes an in-memory map, sometimes a distributed store - is used to mark requests as "in-flight". This split quickly increases complexity. The lifecycle of a request must now be coordinated across two separate systems, with careful handling of race conditions, failures, and timeouts.

Per-process in-memory deduplication partially mitigates this problem, but only within the scope of a single runtime instance. In serverless and edge environments, instances are short-lived and isolated by design. Two concurrent requests hitting different nodes cannot share in-flight state, even if they are logically identical. As traffic grows or becomes more geographically distributed, the effectiveness of this optimization rapidly diminishes.

The result is a pattern that works well in monolithic or long-lived services, but breaks down precisely in the environments where horizontal scaling is most aggressive.

This gap between the absence of a cached result and the completion of the first computation is where traditional caching strategies offer no help, and where *in-flight deduplication* (or request coalescing) becomes both necessary and surprisingly difficult in distributed runtimes.

## Why Durable Objects Are Suitable

The difficulty outlined in the previous section is a direct consequence of how modern serverless and edge platforms are designed. Isolated execution contexts, short-lived processes, and horizontal scaling are features, not flaws. Any solution to in-flight deduplication must therefore work with these constraints rather than attempting to work around them.

Cloudflare [Durable Objects](https://developers.cloudflare.com/durable-objects/) provide a small but crucial set of guarantees that make this possible.

First, a Durable Object instance is a **per-key singleton**. For a given object identifier, all requests are routed to the same logical instance, regardless of where they originate. This immediately eliminates the ambiguity of ownership: there is exactly one place where in-flight state for a given cache key can live.

Second, Durable Objects offer **shared, mutable memory across requests**. Unlike traditional Workers, where memory is scoped to a single invocation, a Durable Object can retain in-memory state between requests. This allows it to hold a representation of ongoing work, such as an in-flight computation without external coordination.

Third, requests to a Durable Object are **processed sequentially**. This serialized execution model removes the need for explicit locking when inspecting or updating in-flight state. Checking whether a computation is already running, creating it if not, and attaching additional waiters can all happen deterministically within a single execution context.

Taken together, these properties allow a Durable Object to act as the **authoritative owner of both in-flight and completed cache entries**. Instead of asking "has this request already been started somewhere else?", callers simply forward the request to the object responsible for that key and await the result.

## Applicability Beyond Cloudflare

While the examples in this article use [Cloudflare Workers](https://developers.cloudflare.com/workers/) and Durable Objects, the underlying pattern is not specific to Cloudflare. What matters is not the platform itself, but the abovementioned runtime guarantees.

At a minimum, the runtime must provide:
- Per-key singleton execution: all requests for a given key are routed to the same logical instance.
- Shared in-memory state across requests for that instance.
- Serialized request handling, or equivalent guarantees that eliminate the need for explicit locking.

Cloudflare Durable Objects satisfy these requirements explicitly, which makes them a convenient and well-defined example. Similar semantics can be found in other environments, although often under different names or with different trade-offs:
- *Actor-based systems*, such as those built on [Akka](https://akka.io/) or [Orleans](https://dotnet.github.io/orleans/), provide comparable guarantees through actor identity and message serialization. In these systems, an actor can naturally own both in-flight work and cached results for a given key.
- *Stateful serverless platforms* and "*durable execution*" models are also beginning to emerge, though their APIs and guarantees vary significantly. What they share is the idea that not all serverless computation must be stateless, and that limited, well-scoped state can simplify certain coordination problems.

By contrast, platforms that only offer stateless functions combined with eventually consistent key–value stores cannot implement this pattern cleanly. Without a single authoritative owner and shared in-memory execution context, in-flight deduplication inevitably devolves into polling or distributed locking.

For this reason, the pattern described here should be understood as **runtime-dependent**. It is not a universal replacement for traditional caching, but a targeted technique that becomes viable when the execution model supports it.

## A Minimal Implementation

With the runtime guarantees established, the implementation itself becomes surprisingly small. The goal is not to build a general-purpose cache, but to demonstrate how a single abstraction can handle both in-flight deduplication and response caching.

The example below shows a Durable Object responsible for a single cache key. All requests for that key are routed to the same object instance:

```javascript
export class CacheObject {
  private inflight?: Promise<Response>;
  private cached?: Response;

  async fetch(request: Request): Promise<Response> {
    // Fast path: return cached response if it exists
    if (this.cached) {
      return this.cached.clone();
    }

    // If no computation is in-flight, start one
    if (!this.inflight) {
      this.inflight = this.compute().then((response) => {
        // Store completed response
        this.cached = response.clone();
        // Clear in-flight state
        this.inflight = undefined;
        return response;
      });
    }

    // Await the same in-flight computation
    return (await this.inflight).clone();
  }

  private async compute(): Promise<Response> {
    // Placeholder for an expensive operation
    // e.g. database query or external API call
    const data = await fetch("https://example.com/expensive").then(r => r.text());
    return new Response(data, { status: 200 });
  }
}
```

This object maintains two pieces of state:
- `inflight`, which represents an ongoing computation.
- `cached`, which stores the completed response once available.

When a request arrives, the object first checks for a cached response. If none exists, it checks whether a computation is already in progress. If so, the caller simply awaits the same promise. If not, the object initiates the computation and stores the resulting promise in memory.

Because Durable Objects process requests sequentially, there is no need for explicit locks or atomic operations. The logic that checks and creates the in-flight promise executes deterministically within a single execution context.

From the caller's perspective, this behaves like a regular cache. The difference is that concurrent callers do not trigger duplicate work, even if the cache is initially empty. Once the computation completes, all waiting callers receive the same result, and subsequent requests are served directly from the cached response.

This example intentionally omits persistence, expiration, and error handling. Those concerns can be layered on later - optionally storing completed responses in a key–value store for durability - without changing the core idea. Crucially, the in-flight state never leaves memory, preserving the simplicity and correctness of the pattern.

## Why This Approach Is Useful

The primary benefit of this pattern is that it **collapses two related concerns into a single abstraction**. Instead of treating in-flight deduplication and response caching as separate problems, it models them as different states of the same cache entry.

This has several practical advantages:
- First, it **eliminates duplicate work at the point where caching alone cannot help**. By allowing multiple concurrent callers to await the same in-flight computation, the system avoids bursts of redundant requests during cache misses: precisely the scenario where traditional caches are least effective.
- Second, the approach **simplifies system design**. There is no need for a secondary coordination layer, distributed locks, or "in-progress" markers stored separately from cached data. All logic related to request coalescing, execution, and result reuse lives in one place, owned by a single runtime entity.
- Third, it **aligns naturally with how JavaScript applications are written**. Awaiting a shared promise is an idiomatic and well-understood pattern, and Durable Objects make it possible to extend this model beyond a single process without changing the mental model. Callers interact with the cache as if it were local, even though the execution is distributed.
- Fourth, this pattern **scales horizontally without losing correctness**. As traffic increases or becomes geographically distributed, requests are still routed to the same authoritative owner per key. The behavior does not degrade as more edge nodes are added, which is often the case with per-process optimizations.
- Finally, the model is **incrementally extensible**. Expiration policies, persistence of completed responses, metrics, and retries can all be added without altering the core control flow. The essential idea: one owner, one in-flight computation, one cached result remains intact.

These properties can make the pattern viable for workloads where the cost of duplicate work is high and request concurrency is unpredictable, such as edge APIs, aggregation endpoints, or expensive upstream integrations.

## Trade-offs and Limitations

Despite its elegance, this pattern is not universally applicable. Its usefulness depends heavily on the execution model of the underlying runtime, and it introduces trade-offs that should be considered carefully.
- The most significant limitation is **runtime dependency**. In-flight deduplication requires a single authoritative owner with shared in-memory state. Without per-key singleton execution the pattern cannot be implemented cleanly. Attempts to replicate it using eventually consistent key–value stores inevitably lead to polling, distributed locks, or other forms of coordination that undermine the original simplicity.
- The implementation itself can also be **non-trivial**. While the minimal example is small, production-ready versions must account for error propagation, retries, timeouts, eviction, and memory limits. Care must be taken to ensure that failed computations do not leave the system in a permanently "in-flight" state, and that cached responses are invalidated correctly.

Another important consideration is **relevance**. In many well-architected systems, duplicate in-flight requests are already rare. Idempotent upstream APIs, natural request spreading, or coarse-grained caching may make in-flight deduplication unnecessary. Introducing this pattern in such cases may add complexity without delivering meaningful benefits.

There is also a **scaling trade-off**. Routing all requests for a given key through a single owner introduces a natural serialization point. For workloads where a single key is extremely hot, this can become a bottleneck. In these cases, sharding strategies or alternative caching approaches may be more appropriate.

Finally, this pattern **does not replace traditional caching strategies**. It complements them. Completed responses may still need to be persisted in a key–value store or HTTP cache to survive process eviction or cold starts. Crucially, however, persistence should only apply to completed results, moving in-flight state into external storage negates the benefits of the approach.

For these reasons, the pattern should be seen as a **targeted optimization, not a default architectural choice**. When the runtime supports it and the workload justifies it, unifying response caching and in-flight deduplication can significantly reduce redundant work. When those conditions are not met, simpler designs are often preferable.

## Conclusion

This article has outlined a **pattern for unifying response caching and in-flight request deduplication in distributed JavaScript runtimes**: by relying on per-key singleton execution and shared in-memory state, it becomes possible to treat an ongoing computation and its eventual result as two states of the same cache entry, eliminating duplicate work without introducing polling or external coordination.

It is important to emphasize that this pattern is **primarily a design proposal, not a battle-tested recipe**. While the underlying primitives (Durable Objects, promises, and serialized execution) are well understood, the combination described here has not yet been broadly validated in production systems. Questions around operational behavior, observability, and long-term performance characteristics remain open and warrant further exploration.

That said, the value of the pattern may lie in how clearly it exposes the relationship between caching and execution. It demonstrates that the difficulty of in-flight deduplication is not inherent to distributed systems, but to the execution models we typically use. When a runtime provides a single authoritative owner per key, the problem simplifies dramatically.

As serverless and edge platforms continue to evolve, stateful execution models are becoming more common. Patterns like this one suggest that revisiting long-standing assumptions, such as the strict separation between caching and coordination, may lead to simpler and more expressive designs. Whether this specific approach proves broadly useful or remains a niche optimization, it highlights an important direction for future runtime and application architectures.