---
layout: layouts/post.njk
title: I Tested 11 HTTP Resilience Libraries
date: 2026-10-04
description: "Twenty-one correctness scenarios run against eleven pinned fetch resilience libraries: 122 cells pass, 25 fail, and 84 combinations no library offers."
excerpt: "Retry, timeout, hedging, circuit breaking, bulkheading, and deduplication are each a small piece of state plus a long list of edge cases. I pinned eleven libraries, ran the same 21 scenarios against every one of them, and published every cell as a live matrix."
tags:
- posts
- javascript
- typescript
- testing
- resilience
- networking
- fetch-kit
---
*Featured in [TLDR IT - 2026-10-05](https://tldr.tech/it/2026-10-05)*

When I started building [ffetch](https://github.com/fetch-kit/ffetch), I had a fairly simple goal: make HTTP requests more resilient without turning a fetch wrapper into a complicated piece of machinery. Retries, backoffs, circuit breaking, and the other patterns could live around a small core, with plugins adding whatever a particular application needed. I liked the elegance of that design, and keeping the library lightweight was a big part of the appeal.

The trouble started when I went back through the code looking for correctness issues. I found subtle bugs and edge cases, then more of them as I looked at what happens when you [combine resilience patterns](/posts/2026-09-25-How-to-Combine-Circuit-Breakers-Bulkheads-and-Rate-Limiters/). I worked through the fixes, but the implementation kept growing, until the small library I had set out to write had become *huge and complex*. That was frustrating, because the simplicity was something I had deliberately designed for. But I couldn't justify keeping an elegant implementation at the expense of handling those cases correctly, so correctness won, and I accepted the complexity that came with it.

After working through that, I wanted to know what the other libraries were doing. These problems come with the resilience patterns themselves, so anyone implementing them has to deal with them somehow. How much of that complexity had other libraries managed to avoid, and how correctly did they handle the cases that had given me so much trouble? I put together a suite of 21 scenarios and ran it against eleven HTTP-resilience libraries, including ffetch, to find out.

## Methodology

I built scenarios covering retries and timeouts, circuit breaking, bulkheads, hedging, and request deduplication. Each library runs the scenarios its public API supports, with assertions checking the behaviour visible to the caller and the transport. The suite grew out of the bugs I found in ffetch, so its coverage reflects those concerns.

The basic cases establish that a policy does what its configuration says. Retry recovery serves two `503` responses followed by a `200` and expects exactly three attempts. Zero retries must still allow the initial request. The body replay case consumes a `POST` payload before returning a `503`, then checks that a retry sends the same bytes or that an unsupported body is explicitly rejected.

The combination cases introduce another event while a policy is already doing something. One aborts the caller 20 ms into a 100 ms retry backoff and checks that the promise settles before the wait ends, with no later dispatch. Another cancels a caller waiting in a bulkhead queue and checks that its place becomes available to a replacement. The circuit scenarios include a success from an older request arriving after a failed probe has reopened the breaker, when that success must leave the newer cooldown intact. These cases check whether the policies still behave correctly when their state changes underneath an operation.

Most scenarios use a scripted fetch implementation that serves predefined responses, delays, headers, and streamed bodies while recording transport attempts. Vitest's fake timers let the tests advance to the exact moment of an abort or deadline, and `Math.random` is fixed at `0.5` to make jitter repeatable. Two integration scenarios use native fetch against a local `node:http` server, checking retry recovery and timeout behaviour over real sockets.

Each library is configured through a thin adapter that preserves its own results and errors. A library that returns a terminal `503` response is checked for that response, while one that rejects is checked for its error type and any documented cause. Retry counts are aligned so that "two retries" means three attempts. Where libraries differ in circuit accounting or half-open probe admission, the tests respect the declared policy and check the invariants around it.

Cancellation has an explicit contract: the caller must settle promptly, and cancelled work must stop dispatching. Queued cancellations must also release queue capacity, and deadlines must stop active work when the transport supports cancellation. These requirements can be stricter than a library's documentation, so a failure records a disagreement with the scenario's rule even when the library makes no promise about that interaction.

In the generated report, every cell links to its configuration and expected behaviour, with assertion failures and traces attached when it fails. A combination the library cannot expose through its public API is marked `N/A`, with the reason recorded beside it. A supported combination that fails an assertion gets a `FAIL` verdict. The comparison measures correctness under these scenarios, with every verdict tied to the pinned release that was tested.

The code is on [GitHub](https://github.com/fetch-kit/http-resilience). To reproduce the matrix or narrow the run to one library:

```sh
git clone https://github.com/fetch-kit/http-resilience.git
cd http-resilience
npm ci
npm test
npm run report # writes results/matrix.html, .md and .json
npm test -- --testNamePattern "fetch-retry"
```

If you don't want to set up the project locally, you can also view the generated report directly at [https://fetchkit.org/http-resilience/](https://fetchkit.org/http-resilience/)

## The libraries

The packages are pinned to exact versions in `package.json`, so a verdict is attached to a release. The selection leans toward fetch wrappers people actually install: general-purpose clients with one or two policies, packages that exist to add a single policy, and wrappers that stack several of them. And, of course, ffetch :D

| Library | Pinned version | Cells implemented | Pass | Fail | N/A |
| --- | --- | --- | --- | --- | --- |
| [ffetch](https://github.com/fetch-kit/ffetch) | 5.7.1 | 21 | 20 | 1 | 0 |
| [ky](https://github.com/sindresorhus/ky) | 2.1.0 | 10 | 10 | 0 | 11 |
| [fetch-retry](https://github.com/jonbern/fetch-retry) | 6.0.0 | 7 | 6 | 1 | 14 |
| [ofetch](https://github.com/unjs/ofetch) | 1.5.1 | 8 | 7 | 1 | 13 |
| [wretch](https://github.com/elbywan/wretch) | 3.0.9 | 11 | 8 | 3 | 10 |
| [resilient-fetch-client](https://github.com/cnoelle/resilient-fetch-client) | 0.3.0 | 14 | 9 | 5 | 7 |
| [fetch-smartly](https://github.com/Ali-Raza-Arain/fetch-smartly) | 1.0.2 | 14 | 13 | 1 | 7 |
| [@resili/fetch](https://github.com/nkcodedev/resili) | 0.2.0-beta.1 | 20 | 15 | 5 | 1 |
| [fetch-resilience](https://github.com/mstuart/fetch-resilience) | 0.1.0 | 13 | 9 | 4 | 8 |
| [flowshield](https://www.npmjs.com/package/flowshield) | 1.0.4 | 18 | 15 | 3 | 3 |
| [ts-retry-circuit](https://www.npmjs.com/package/ts-retry-circuit) | 2.1.1 | 11 | 10 | 1 | 10 |

(flowshield and ts-retry-circuit no longer publish a public GitHub repository, so those two link to their npm pages.)

## The results

Here's the full matrix. The symbols mean: ✅ passes, ❌ fails, ➖ not applicable. The header row carries the pinned version that produced each column.

| Scenario | ffetch 5.7.1 | ky 2.1.0 | fetch-retry 6.0.0 | ofetch 1.5.1 | wretch 3.0.9 | resilient-fetch-client 0.3.0 | fetch-smartly 1.0.2 | @resili/fetch 0.2.0-beta.1 | fetch-resilience 0.1.0 | flowshield 1.0.4 | ts-retry-circuit 2.1.1 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Retry recovery | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Retry exhaustion | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Zero retries | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Retry + abort during backoff | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ |
| Bulkhead + queued abort | ✅ | ➖ | ➖ | ➖ | ➖ | ❌ | ➖ | ❌ | ❌ | ❌ | ➖ |
| Hedge + streaming body | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ✅ | ➖ | ✅ | ➖ |
| Circuit + hedge accounting | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ✅ | ➖ | ✅ | ➖ |
| Retry over real HTTP | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Timeout over real HTTP | ✅ | ✅ | ➖ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Retry + total timeout | ✅ | ✅ | ➖ | ➖ | ❌ | ❌ | ➖ | ➖ | ❌ | ❌ | ➖ |
| Retry + body replay | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Retry-After + abort | ✅ | ✅ | ➖ | ➖ | ➖ | ❌ | ✅ | ❌ | ➖ | ➖ | ➖ |
| Retry + throwing hooks | ✅ | ✅ | ✅ | ✅ | ❌ | ➖ | ✅ | ✅ | ➖ | ✅ | ✅ |
| Hedge + all branches fail | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ✅ | ➖ | ✅ | ➖ |
| Hedge + timeout | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ✅ | ➖ | ❌ | ➖ |
| Dedupe + retry | ✅ | ➖ | ➖ | ➖ | ✅ | ➖ | ✅ | ❌ | ➖ | ➖ | ➖ |
| Dedupe + caller cancellation | ✅ | ➖ | ➖ | ➖ | ✅ | ➖ | ✅ | ✅ | ➖ | ➖ | ➖ |
| Bulkhead + retry | ✅ | ➖ | ➖ | ➖ | ➖ | ✅ | ➖ | ✅ | ✅ | ✅ | ➖ |
| Circuit + retry accounting | ✅ | ➖ | ➖ | ➖ | ➖ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Circuit + half-open concurrency | ❌ | ➖ | ➖ | ➖ | ➖ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ |
| Circuit + local cancellation | ✅ | ➖ | ➖ | ➖ | ➖ | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ |

### What all eleven got right

Five scenarios pass in all eleven columns, which is 55 of the 147 implemented cells:

- Retry recovery: two 503 responses followed by a 200, with exactly three attempts.
- Retry exhaustion: three 503s, and the terminal result the library documents.
- Zero retries: one attempt, and the exact terminal response or error.
- Retry over real HTTP: three arrivals at a local server and a usable successful body.
- Retry + body replay: a POST body that reaches the server byte-for-byte on the retry, plus an explicit rejection when the body cannot be replayed.

Retry is commodity behaviour in all of these packages. Timeout is nearly as uniform, with fetch-retry the only library that has none. The scenarios that exercise one policy in isolation also hold up: bulkhead + retry, circuit + retry accounting, dedupe + caller cancellation, hedge + streaming body, and hedge + all branches fail pass in every cell where the policy exists.

The 25 failures cluster around a single pattern: something else arrives while a policy is waiting: a cancellation during a backoff sleep, a deadline that expires during the wait, a queued caller that leaves, a probe that completes after the breaker reopened. The rest of this post walks through those clusters.

### Retry + abort during backoff

This scenario serves one 503 to the first attempt, configures two retries with a 100 ms backoff, aborts the caller at 20 ms while the first delay is still running, drains every timer, and then issues a healthy follow-up request. The two questions that matter: does the caller's promise settle when the caller aborts, and does anything reach the transport afterwards?

Six libraries answer the first question late. At the moment of the abort the caller's promise is still pending, and it stays pending until the backoff sleep ends. Five of them also dispatch after the abort. Two of the five run out the retry budget instead of stopping at the cancellation: [fetch-retry](https://fetchkit.org/http-resilience/#case-retry-backoff-abort-fetch-retry) and [fetch-resilience](https://fetchkit.org/http-resilience/#case-retry-backoff-abort-fetch-resilience) have made three dispatches by the time the harness looks, where it expects the one attempt that preceded the abort, and four attempts in total where it expects two. The abort is not terminal for them, and the retry loop keeps going after the caller has left. ofetch, wretch, and resilient-fetch-client dispatch exactly one more attempt. [@resili/fetch](https://fetchkit.org/http-resilience/#case-retry-backoff-abort-@resili/fetch) is the member of this group that at least stops dispatching; its single failure is the late settlement.

fetch-retry shows the mechanism in one function: its retry delay is a bare `setTimeout(function () { wrappedFetch(++attempt); }, delay)` that never reads `init.signal`, so the only code that can notice the abort is the `fetch` call that runs after the timer fires. A caller aborting during the wait cannot interrupt the sleep, so it waits it out and then watches another attempt leave. ffetch, ky, fetch-smartly, flowshield, and ts-retry-circuit pass.

### Bulkhead + queued abort

The setup is capacity 1, queue 1, a first request that holds the slot for 100 ms, a second caller that queues and aborts at 20 ms, and a replacement that should take the freed slot. Four of the five libraries that have a queue fail every assertion: [resilient-fetch-client](https://fetchkit.org/http-resilience/#case-bulkhead-queued-abort-resilient-fetch-client), [@resili/fetch](https://fetchkit.org/http-resilience/#case-bulkhead-queued-abort-@resili/fetch), [fetch-resilience](https://fetchkit.org/http-resilience/#case-bulkhead-queued-abort-fetch-resilience), and [flowshield](https://fetchkit.org/http-resilience/#case-bulkhead-queued-abort-flowshield).

```
Queued cancellation must settle before slot handoff: expected undefined to be defined
Cancelled queue entry must release queue capacity: expected false to be true
expected 1 to be 2
```

The queued caller is still pending when the slot becomes free, the queue keeps the cancelled waiter, and the replacement is refused because the queue is still full. Two of the four went further and dispatched the cancelled operation anyway, which shows up as an attempt against `https://example.test/resource/cancelled...` in the transport. ffetch is the only pass, and it is the only queue in the set that is written against the abort signal.

This is what combination scenarios are for. All five libraries document a queue, and none of them documents what happens to a waiter that cancels. Losing a slot to a caller that already left is a leak rather than a design decision, and it only becomes visible when you abort a request that is waiting behind another one.

### Retry + total timeout

One overall deadline of 100 ms, one retry, and a second attempt that either follows a 300 ms backoff or, after an 80 ms backoff, hangs. The question is whether the deadline covers the policy around it.

```
No dispatch after original deadline: expected 2 to be 1
```

wretch, resilient-fetch-client, fetch-resilience, and flowshield all dispatch the second attempt after the caller's deadline has passed, and [wretch](https://fetchkit.org/http-resilience/#case-retry-total-timeout-wretch) adds a second failure, `Deadline must cover backoff and subsequent attempts`, because its caller is still pending at the deadline it was given. fetch-resilience and flowshield collect `Cooperative work must stop` instead, because the hung attempt is still alive after the deadline that was meant to bound it.

Five libraries are not applicable here, and the reason is worth stating on its own: they expose a per-attempt timeout and nothing that spans retries and backoff. That's a different contract. The deadline in this scenario has to be owned by whoever composes the policies, which means the composition, not the library, decides whether the retry can outlive the caller's patience.

### Retry-After + abort

The scenario serves a 503 with `Retry-After` set to a number of seconds, an HTTP date, a malformed value, and a large value, and it checks the whole contract around the header: the retry waits for the advertised delay, a malformed value falls back to the configured backoff, a large value is capped, an abort during the header-derived wait settles immediately with the right error, and nothing reaches the transport afterwards.

[resilient-fetch-client](https://fetchkit.org/http-resilience/#case-retry-after-abort-resilient-fetch-client) gets the timing right and then treats the wait as uninterruptible. For every one of the four header shapes it collects both of these:

```
Abort must interrupt header-derived wait: 1: expected undefined to be defined
No dispatch after header-wait cancellation: expected 2 to be 1
```

[@resili/fetch](https://fetchkit.org/http-resilience/#case-retry-after-abort-@resili/fetch) fails in the other direction: the header never controls the retry timing, so a second attempt exists before the advertised second has elapsed (`Retry-After must control retry timing: 1: expected 2 to be 1`), and the caller is again left pending on abort. Its timing failure is missing for the malformed value, which is a detail worth noticing: with a broken header the scenario expects a retry at the configured backoff, and retrying immediately is indistinguishable from retrying correctly. ffetch, ky, and fetch-smartly pass, and six libraries are not applicable because they never read the header at all.

### Retry + throwing hooks

Each library is exercised with the hooks it exposes: a retrying predicate, a delay function, and a retry callback, in synchronous and promise-returning form. The scenario throws a sentinel error from that hook and then checks three things: the caller settles with that exact error object, the failure is not retried, and the next request still succeeds. Eight libraries pass, two expose no hook to throw from, and [wretch](https://fetchkit.org/http-resilience/#case-retry-hook-error-wretch) loses the caller:

```
callback: callback rejection must settle the caller: expected undefined to be defined
```

The callback owns the rejection, so nothing is left to settle the promise the caller is holding. It is the kind of failure that turns into an eternal `await` in application code, and it is easy to miss because the happy path of a retry hook is a boolean.

### Hedging is the least finished surface

Four scenarios cover hedging, and they produce 32 of the 84 not applicable cells, more than any other policy. Only three libraries ship a hedge with a configurable launch delay: ffetch, @resili/fetch, and flowshield. Two of the three pass all four scenarios, including the streaming-body case and the case where both branches fail in either order.

[flowshield](https://fetchkit.org/http-resilience/#case-hedge-timeout-flowshield) fails the deadline scenario at every deadline it is given, 5 ms, 10 ms, 11 ms, and 100 ms. The timeout runs against a 10 ms hedge delay, so at 5 ms and 10 ms there should be no second request at all:

```
No late hedge at deadline 5: expected 2 to be 1
All cooperative branches must stop: expected 1 to be +0
```

A hedge is launched after the timeout has already settled the caller, and the branches keep running afterwards. The second assertion is the one that matters for a server: a hedge that never stops is a request nobody is waiting for. When the deadline is longer than the hedge delay, the same library adds a dispatch at or past the deadline (`expected false to be true`) and leaves two branches alive (`All cooperative branches must stop: expected 2 to be +0`), so the boundary at the hedge delay is where this implementation breaks first.

Hedging is a [controversial and complex strategy](/posts/2026-04-19-Your-HTTP-Client-Is-Lying-to-You/#scenario-c%3A-hedging-helps-tail-latency%2C-not-error-recovery), so it is not surprising that the implementations vary widely and that many edge cases are not handled correctly.

### Deduplication and retry share more than the request

4 libraries deduplicate concurrent identical requests, and three of them pass the combination that matters most: four same-key callers, two delayed 503s, two retries, then a streamed body, followed by a fresh same-key request that must not be joined to the finished one. [@resili/fetch](https://fetchkit.org/http-resilience/#case-dedupe-retry-@resili/fetch) shares the retry sequence correctly, and then hands the same response to everyone:

```
expected { ok: false, …(1) } to deeply equal { ok: true, value: 'ready' }
```

Three of the four callers get an unusable result because the body was consumed once. The scenario right next to it (dedupe + caller cancellation) passes for all four libraries, including this one, so the ownership rules around cancellation are in place. What the retry case adds is a response that is produced several layers away from the callers, and the first consumer wins.

### Circuit + half-open concurrency

Threshold 1, reset 100 ms, no retries. The transport serves a slow success at 150 ms, a 503 that trips the breaker, a probe admitted at the reset deadline that fails and restarts the cooldown, and a healthy recovery response for the next caller. The scenario accepts any of the three designs that appear in this set (a single probe, followers queued behind one probe, or unrestricted probes) and checks the invariants instead: nothing is dispatched before the reset deadline, the probe is admitted at the deadline, a failed probe restarts the cooldown, a success admitted before the reopen cannot close the newer state, and the recovery response still reaches the next caller.

Three libraries fail, and the first one is mine. [ffetch](https://fetchkit.org/http-resilience/#case-circuit-half-open-concurrency-ffetch) trips on a single assertion:

```
late success must not close the newer open state: expected false to be true
```

The 200 that arrives at 150 ms was admitted while the breaker was closed, and by the time it lands the breaker has reopened and restarted its cooldown. ffetch's circuit plugin keeps a `nextAttempt` deadline plus an `isOpen` flag, and its success path clears that flag whenever it finds it set, without asking which cooldown the flag belongs to. Admission is driven by the deadline, so traffic is still refused correctly, and the symptom is a state flag that disagrees with the breaker: anything reading `circuitOpen` (a health check, a dashboard, an integration test) sees a closed breaker that is still open. ffetch rechecks admission before every attempt precisely so a request parked in a bulkhead queue or a retry delay cannot be dispatched into a circuit that has opened in the meantime, and the stale-success rule is the mirror image of that problem. The plugin has no generation counter, so the mirror image is unimplemented.

[fetch-smartly](https://fetchkit.org/http-resilience/#case-circuit-half-open-concurrency-fetch-smartly) and [ts-retry-circuit](https://fetchkit.org/http-resilience/#case-circuit-half-open-concurrency-ts-retry-circuit) go further than ffetch, because in their case the stale success also changes what the transport sees:

```
late success must not admit during the new cooldown: expected true to be false
late success must not consume the recovery response: expected 4 to be 3
```

Their stale success clears the new cooldown, so the next request is admitted during it and consumes the recovery response that the scenario had queued for the healthy caller. ts-retry-circuit adds two boundary failures, `admit at the exact reset deadline: expected 1 to be 2` and `new cooldown expires at its deadline: expected 2 to be 3`, which means it refuses at the deadline itself in both the first and the restarted cooldown and admits only afterwards. The remaining four libraries pass, with two designs among them: one queued probe (resilient-fetch-client, @resili/fetch) and unrestricted probes (fetch-resilience, flowshield).

### Circuit + local cancellation

This scenario aborts a caller during a 100 ms retry backoff while the circuit is counting failures, and it is the backoff problem again with a breaker attached. [resilient-fetch-client](https://fetchkit.org/http-resilience/#case-circuit-local-cancellation-resilient-fetch-client) and [fetch-resilience](https://fetchkit.org/http-resilience/#case-circuit-local-cancellation-fetch-resilience) collect `backoff cancellation must settle promptly: expected undefined to be defined` and `no dispatch after backoff cancellation: expected 2 to be 1`, while [@resili/fetch](https://fetchkit.org/http-resilience/#case-circuit-local-cancellation-@resili/fetch) has only the settlement failure.

Everything else in the scenario passes for all three. The abort is excluded from the failure count where the adapter declares that exclusion, the breaker trips at the exact remaining budget, the refusal uses the documented error class, and the breaker recovers. The health accounting around cancellation is in better shape across this set than the cancellation timing itself.

## The confirmation bias

Because a lot of these scenarios come from bugs I had already fixed in ffetch, my library enters the comparison with an advantage. Its 20 passes out of 21 scenarios partly reflect that history and the behaviour I chose to implement. The cancellation cases require prompt settlement and forbid further dispatch, the queueing tests require cancelled waiters to release capacity, while the deadline tests require active work to stop when it supports cancellation. A library that observes an abort only when the next attempt starts receives a `fail` verdict under those rules, even if that behaviour matches its documentation. I tried to choose reasonable expectations, but the choice is subjective at times, and the results need to be read with that in mind.

The tests also reflect my interpretation of specifications, particularly for `Retry-After` parsing and request-body replay. Each cell publishes its configuration and expected behaviour, giving readers the information they need to examine those interpretations and challenge the verdict. If an assertion applies the wrong rule, the test needs correcting, and I welcome that as a bug report.

Some things are out of scope: there are no benchmarks, no throughput numbers, no assessment of the API design or the documentation, and nothing about how maintainers respond to issues. The table says what eleven pinned releases do when 21 scenarios drive them.

## Keeping the matrix current

I made some effort to keep the results up to date. The versions come from `package.json` and are recorded with the run, which is why the column headers carry them and why a verdict is attached to a release. Dependabot groups the pinned libraries. `.github/workflows/report-pages.yml` rebuilds and republishes the page weekly and whenever the pins change, `npm test && npm run report` reproduces the same page locally, and the report refuses to publish a run that is incomplete. A failed assertion still writes the report and makes the command exit nonzero, so a red cell cannot disappear between runs. At the end of the pipeline, the matrix can be accessed at [https://fetchkit.org/http-resilience/](https://fetchkit.org/http-resilience/)

## What is still missing

The scenarios I have not written are mostly the second-order interactions: a body that fails halfway through streaming and then gets retried, cache validation combined with a retry, a hedge around a POST with a replayable body, timeouts inside deduplicated groups, and breaker state shared between processes rather than held in one. Rate limiting is deliberately absent, since this matrix is about fetch wrappers and [the token bucket comparison](/posts/2026-09-22-Rate-Limiting-Without-the-Refill-Loop-Token-Bucket-vs-GCRA/) belongs somewhere else. The composition post, [How to Combine Circuit Breakers, Bulkheads, and Rate Limiters](/posts/2026-09-25-How-to-Combine-Circuit-Breakers-Bulkheads-and-Rate-Limiters/), describes several of the ordering rules that the scenario configurations here have to respect.

Adding a scenario is a file in `test/conformance/`, an adapter if the combination is not covered yet, and a rerun. The reporter picks up whatever the run produced.

## Conclusion

The eleven HTTP clients cover different subsets of resilience patterns, and they make different choices about how those patterns should behave. Some concentrate on retries and timeouts, while others also offer circuit breaking or hedging. Even a shared feature name leaves room for different contracts: a timeout can apply to each attempt or to the whole operation, and circuit breakers can admit recovery probes in different ways. Those choices matter when you configure a client, because the behaviour your application depends on goes beyond whether a feature appears in its documentation.

The basic retry cases held up across all eleven libraries, but combining policies exposed problems that were easy to miss when looking at each feature on its own. That is where I would spend time testing a client against the way my application actually uses it. I want this matrix to make that easier by showing what each library offers and what happens in specific scenarios, with enough detail to examine the rules behind the verdicts. Working through these cases has made me more willing to accept complexity in ffetch, but also more careful about assuming that the complexity means I have got everything right.
