---
layout: layouts/post.njk
title: "Fuzzing the State Machines Inside My HTTP Client"
date: 2026-09-05
description: "ffetch had a full suite of passing tests for retries, hedging, timeouts, and cancellation. Describing the rules instead of the cases, and letting fast-check generate network outcomes and timings, found eleven real defects."
excerpt: "Example-based tests cover the situations their author imagined. Generated tests search the space around them. Here is what 27,450 generated cases found inside an HTTP client that already looked well tested."
tags:
- posts
- testing
- javascript
- typescript
- property-based-testing
- fuzzing
- ffetch
- fetch-kit
---
[`ffetch`](https://github.com/fetch-kit/ffetch) had tests for retries, timeouts, hedging, cancellation, circuit breaking, bulkheads, request deduplication, and the plugin combinations where those features interact. Nineteen files, 206 test blocks, all passing. I had written most of them while writing the features themselves, which is the part worth being suspicious about.

The hedge plugin sends a second copy of a request after a short delay and takes whichever attempt answers usefully first, which is a good way to cut tail latency when one connection stalls. Deciding which answer counts as useful is where it gets interesting: a `429` or a `500` is a response, but it is not an answer you want to hand back to the caller if another attempt is still running and might return a `200`. I had a feeling the plugin got that wrong when the hedge failed quickly while the original was still in flight.

Writing that exact scenario as a regression test would have taken ten minutes and proved almost nothing. It would confirm that I can fix a bug I already described, and it would tell me nothing about the orderings I had not thought to describe. The alternative was to state the rule instead of the case: whenever any attempt is capable of returning a usable response, the plugin must return one, no matter how the timings fall. Then let a generator pick the timings.

It found a violation on the fourth generated case and shrank it to a timeline three milliseconds wide. That was the result I expected. What I did not expect was that the same approach, applied to the rest of the client over the following week, would surface ten more defects that I had not suspected, including one sitting underneath a test named after the exact behaviour it failed to check.

## Describing inputs instead of listing them

The tests most of us write are *example-based*. You pick an input, work out what should come back, and write both down: sort `[3, 1, 2]`, expect `[1, 2, 3]`. That proves one thing about one input, and what you know about the function afterwards is the sum of the examples you were willing to type out.

*Property-based testing*, or *fuzzing* replaces both halves of that. Instead of picking an input you describe what any valid input looks like: an array of integers, any length, any values. Instead of naming the expected output you state a rule that holds whatever the input turns out to be: the result is the same length as the input, and each element is less than or equal to the one after it. The runner generates inputs from your description, checks the rule after each one, and repeats a few hundred or a few thousand times. Most of those inputs you never see, and you never write down the answer for any of them. The descriptions are called *arbitraries*, and they compose, so small ones combine into the input space you actually care about.

Two mechanics make this work. The first is reproducibility: a failing run reports the seed that produced it, so the same sequence can be replayed. The second is *shrinking*, and it does most of the work: when a property fails, the runner does not hand you the case it happened to generate, which is usually full of irrelevant detail. It searches for smaller inputs that still fail, repeatedly, until it reaches something minimal. A failure that arrives as "delay 17ms, status 503, delay 4ms, status 200" becomes "delay 1ms, status 429, delay 3ms, status 200", and at that size you can hold the whole thing in your head.

This is worth separating from what people usually mean by fuzzing HTTP: that normally involves mutating protocol bytes to attack a parser, or generating request payloads to hammer a server. Both are useful but neither is what happens here. My target is the behavioural state machine inside the client, so the generated inputs are network outcomes and their timings: what each attempt returns, and when.

## Where the bugs actually live

An HTTP client with resilience features does not transform a request into a response. It reacts to a timeline, and the timeline has more dimensions than are comfortable to enumerate by hand. Attempts start at different moments, responses arrive in another order than the attempts were launched. Some attempts throw instead of returning. Backoff windows open and close between them. Cancellation can arrive from the caller, from an overall deadline, or from the client's own internal machinery, and each of those has to be told apart from the others. Timers have to be cleaned up regardless of which path settled the request.

Every example-based test I wrote covered one path through that space. Together they form a list of orderings I thought of while implementing the feature, and this list looks thorough right up until you notice that it was assembled by the same mind that wrote the code. The holes are not in the entries, they are between them, in the orderings that never occurred to me, which are also the orderings I did not defend against.

To be clear about who this is for: the value here belongs to the library author. Nobody using `ffetch` should have to fuzz their own configuration to find out whether documented behaviour is real. That is my job, and this is the account of doing it.

## The harness

My setup was simple: `fast-check` as a dev dependency, running inside the existing Vitest suite. No separate runner, no separate CI job, no separate command. The properties are test files that happen to generate their inputs, so `npm test` runs them alongside everything else.

Vitest fake timers do the rest of the work. Generated delays cost nothing when time is advanced programmatically, which is what makes a thousand cases per property affordable. A property that would take twenty real seconds finishes in under one.

The input space for the first hedge property is

```ts
const outcomeArbitrary = fc.record({
  delay: fc.integer({ min: 0, max: 20 }),
  status: fc.constantFrom(200, 429, 500, 503),
})
```

An outcome is a completion time between zero and twenty milliseconds and a status drawn from one success and three retryable failures. Two of those describe a hedged request: one for the original attempt, one for the hedge.

The property itself:

```ts
it('does not let a retryable response beat an in-flight success', async () => {
  await fc.assert(
    fc.asyncProperty(
      outcomeArbitrary,
      outcomeArbitrary,
      async (original, hedge) => {
        fc.pre(original.status === 200 || hedge.status === 200)

        vi.useFakeTimers()

        const outcomes = [original, hedge]
        let calls = 0
        const next: PluginDispatch = () => delayedResponse(outcomes[calls++])
        const dispatch = hedgePlugin({ delay: 1 }).wrapDispatch!(next)

        const resultPromise = dispatch(makeContext())
        await vi.runAllTimersAsync()
        const result = await resultPromise

        expect(result.ok).toBe(true)
        expect(calls).toBeLessThanOrEqual(2)

        vi.useRealTimers()
      }
    ),
    { numRuns: 1_000 }
  )
})
```

The `fc.pre` line discards generated cases where neither attempt succeeds, since the rule says nothing about those. Everything else is two assertions: a usable response has to come back, and the plugin must not launch more attempts than it was configured for.

Notice what the property does not contain. There is no ordering in it, no scenario, no hint about which arrangement of timings might be dangerous. It states the rule I believed was already true and leaves the search to the generator.

## The race that took four cases

`fast-check` reported a failure on the fourth generated case and shrank it to this:

```text
original: 200 after 3 ms
hedge:    429 immediately after launch
hedge delay: 1 ms
```

Laid out as a timeline:

```text
t=0 ms  original request starts
t=1 ms  hedge starts
t=1 ms  hedge returns 429
t=3 ms  original would return 200
```

`ffetch` returned the `429`, and it aborted the original request on the way out, so the `200` that was two milliseconds from arriving never arrived at all. The caller got a retryable failure while a success was sitting in flight.

The cause was a single assumption buried deep in the winner-selection logic. The plugin used an attempt's position to decide whether anything better might still be coming: if the attempt that just completed was the most recently launched one, it was treated as the last word, and a retryable response from the last word became the answer. Position is a fact about when an attempt started. Nothing about it says whether an earlier attempt is still running.

The existing example tests were not thin here. They covered a `5xx` original waiting for its hedge, a `429` original waiting for its hedge, a `5xx` resolving when it genuinely was the last attempt, a `4xx` winning immediately as a legitimate answer, all attempts failing, and one attempt succeeding while others failed. What none of them covered was the reverse ordering: a failing hedge completing while a successful original was still pending. Each of those tests is reasonable on its own, and reading through the file gives a strong impression of coverage. But the impression comes from the number of cases rather than from the shape of the space they occupy.

The fix removes the assumption. A retryable response becomes a fallback candidate instead of a winner, and the fallback is only used once every launched and scheduled attempt has completed without producing something better:

```ts
if (result.status === 'fulfilled') {
  const res = result.value
  // A retryable response is only a fallback. Its attempt index says
  // when it was launched, not whether a better attempt is pending.
  if (res.ok || (res.status < 500 && res.status !== 429)) {
    settle(index, res)
    return
  }
  fallbackResponse = res
} else {
  lastError = result.reason
}
```

Anything acceptable, including a `4xx` that is not a `429`, settles the request the moment it arrives. Transport errors keep their original fail-fast behaviour, since a thrown connection error is not a response anyone can fall back to. The comment in there is load-bearing; it is the sentence I wish had been in my head when I wrote the original version.

With that change, the property passes its thousand cases, and the three-millisecond counterexample stays in the suite permanently, not as a test I wrote but as a case the generator can still reach.

## Five more properties, nothing found

One confirmed hunch is a weak result. If the only rule I could state was the one I already suspected, the exercise would amount to an expensive way of writing a regression test. So before touching anything else I wrote five more hedge properties, none of them aimed at a behaviour I doubted.

They generate between two and four attempts and require that a reachable success still wins. They generate a `maxHedges` between zero and five and require that exactly `1 + maxHedges` attempts get launched when everything stays retryable. They mix thrown transport errors into the responses. They check that every loser is aborted once a winner settles and that no scheduled attempt starts afterwards. They abort from outside at generated moments and require that every launched attempt notices, that nothing new starts, and that no timer survives.

## Into the core client

Everything up to here confirmed something I suspected. The rest of the work had no hypothesis behind it, which is where the results start being interesting.

The core client is where retries, backoff, timeouts, cancellation, and lifecycle hooks all meet. I wrote properties for the retry loop on its own and for the whole client including its timeout and abort machinery: attempts never exceed `retries + 1`, the first non-retryable response stops the loop, retryable responses and thrown errors consume the same budget, `onRetry` agrees with the physical attempt history, `onComplete` fires exactly once, aborting or timing out during backoff prevents another attempt, and no retry timer survives termination.

### Cancellation that returned a response anyway

Two properties failed immediately and shrank to nearly identical configurations:

```text
user abort: abort at 0 ms during backoff, retries = 1
timeout:    timeout at 1 ms during backoff, retries = 1
```

In both, the first request returned `503` and the client entered its retry delay. The abort arrived during that delay and correctly prevented a second physical request. Then the returned promise resolved with the saved `503` instead of rejecting with `AbortError` or `TimeoutError`.

This one is more interesting than a straightforward mistake, because two contracts are internally coherent here. A client could treat cancellation as terminating the whole logical operation, in which case it rejects regardless of what came before. A client could also treat cancellation as revoking permission to make further attempts, in which case returning the most recent response is reasonable.

`ffetch` says that aborting during backoff cancels immediately, presents `AbortError` and `TimeoutError` as terminal errors, shows callers catching `AbortError` to handle cancellation, and defines the timeout as covering the complete logical operation including retries. Returning that `503` contradicted all of it: a caller who cancelled would see an ordinary response and never learn that their cancellation had taken effect.

The cause was precedence. The client keeps the most recent response around so that failures occurring after the response arrives, during transformation for instance, can still return something useful. That fallback ran in the catch path before anything checked whether the terminal condition was cancellation. The same paths could also fire `onAbort` or `onTimeout` and then fire it again from the outer handler. The fix classifies `AbortError` and `TimeoutError` before the saved response is considered, always rejects for those two, centralises their hooks in the outer catch, and leaves the fallback intact for everything else.

### A test that passed for the wrong reason

`abortAll()` cancels every request a client currently has in flight. The property for it failed on its first run and shrank to the smallest case available:

```text
pending requests: 1
call abortAll()
physical request signal: not aborted
```

One request! The client tracked it, `abortAll()` walked the list of pending entries and called `.abort()` on each controller, and the controller duly reported itself aborted. That controller's signal had never been included in the signal handed to the fetch handler. Aborting it changed a flag that nothing downstream was listening to, so the request carried on.

There was already a test named "abortAll aborts all requests". It created two hanging requests, called `abortAll()`, asserted that the exposed controller signals became `aborted`, and awaited both requests expecting rejection. Both assertions passed. The first passed because the controllers really were aborted, which was never in question. The second passed because those requests carried a one-second client timeout and eventually rejected on their own. The test proved that a timeout works.

The generated property behaved differently: it watched the signal the fetch handler actually received rather than the one the client exposed, disabled the timeout so nothing else could produce a rejection, and always settled its synthetic transport so shrinking could not stall. None of those choices were clever.

The fix gives every logical request an internal controller and folds its signal into the combined signal used for every physical attempt, alongside the user signal, the transformed-request signal, and the timeout:

```ts
const signals: AbortSignal[] = []
if (userSignal) signals.push(userSignal)
if (transformedSignal && transformedSignal !== userSignal) {
  signals.push(transformedSignal)
}
if (timeoutSignal) signals.push(timeoutSignal)
signals.push(controller.signal)
```

An abort from that internal controller then has to be classified as an `AbortError` rather than retried or wrapped as a `RetryLimitError`, which means the precedence between the four cancellation sources became explicit.

Of the eleven defects, this is the one I would point at if I had to justify the whole exercise: the behaviour was documented, implemented, and covered by a test named after it, and it did not work.

### A promise nobody awaited

The last core property generates failures in every lifecycle hook, synchronously and asynchronously, and requires that the request still settles, leaves `pendingRequests`, and produces no stray work. Its assertions passed, Vitest then reported several hundred unhandled promise rejections.

Shrinking and grouping pointed at one hook. The public `Hooks` type lets every hook return `void` or `Promise<void>`, and most of them are awaited. `onRetry` was called from the synchronous wrapper that decides whether to retry, so its returned promise went nowhere. An async `onRetry` that rejected left the request to complete normally while the rejected promise escaped into the process, which is the kind of thing that shows up much later as a crashed Node worker with no useful stack.

Making the internal decision callback able to return a promise, and awaiting it in both the response and error paths, was most of the fix. The rest was restructuring the retry loop so that a failure inside the decision or its hook is not mistaken for a failure from the request itself. The public `shouldRetry` option stays synchronous, since that is what its documentation promises; only the internal wrapper changed, so the async hook type that was already documented now actually works.

## Where components meet

Each hedge branch owns its own retry loop, so the two features multiply: physical traffic is bounded by `(retries + 1) x (maxHedges + 1)`. That composition is supported, so I generated both policies together and asserted the obvious things about it: a success anywhere wins, traffic never exceeds the product, all-retryable scenarios use the budget exactly, callbacks agree with physical launches, aborting stops every branch, and settling one branch cancels the rest.

Three defects came out of it, and none of them lived in retry or in hedge. They lived in the seam.

**The second hedge could not clone the body.** The property shrank to something ridiculously small: an empty string body, a `PUT`, zero retries, one hedge. The hedge plugin built its first branch directly from the shared `Request`, which disturbs the source body, so when the scheduled hedge tried to build its own branch it threw `Cannot construct a Request with a Request object that has already been used`. Standalone retry tests never saw this because the retry loop clones per attempt; the hedge layer had its own cloning boundary and did not use it for the first branch. Cloning before constructing every branch, including the first, gives each branch a source its own retry loop can reuse.

**`onComplete` fired once per speculative branch.** With zero retries and one hedge, the property reduced to two physical branches and two calls. The hook lived inside the retry runner, which is correct as long as there is exactly one runner; hedging creates one per branch. Any metric counting completions would have double-counted, and any cleanup attached to `onComplete` would have run twice. It now lives at the boundary after plugins have selected an outcome, behind a once-only guard:

```ts
let completeCalled = false
const callComplete = async (
  response: Response | undefined,
  error: unknown
) => {
  if (completeCalled) return
  completeCalled = true
  await effectiveHooks.onComplete?.(request, response, error)
}
```

**Cancelled losers looked like user aborts.** The last property generated a successful original plus one hanging hedge. The original returned `200`, the hedge loser was correctly aborted, the overall request succeeded, and `onAbort` and `onError` fired anyway. From the application's side nothing had been aborted and nothing had failed; its request returned a response. Speculative cleanup was leaking through the public lifecycle, so an application counting aborts would have seen phantom cancellations proportional to how well hedging was working. Terminal errors are now reported only at the logical request boundary, and branches detached from that boundary stay quiet.

The pattern across all three is that retry was right about retrying and hedge was right about hedging. Neither was wrong on its own terms, and the defects only exist in the region where one component's assumptions meet another's.

## The component with nothing wrong

The circuit breaker got six properties and 2,200 cases, and found nothing.

`ffetch`'s circuit plugin is deliberately simpler than the textbook three-state breaker: there is no half-open state and no queueing while open. Requests before the reset deadline fail immediately with `CircuitOpenError` and never reach the transport, every request after the deadline is admitted including concurrent ones, the first success closes the circuit, and a failure reopens it with a fresh window.

The properties I wrote describe the two-state contract: the threshold opens the circuit exactly when configured, a non-failure response resets the count, open requests are rejected without dispatch, all concurrent post-reset requests are currently admitted, a failed post-reset request reopens and extends the gate, and normalized transport failures count the same as HTTP failures.

What that bought is not bug-finding but documentation that executes. If the plugin later grows an explicit half-open state with a probe limit, the properties describing today's behaviour will fail.

## The queue that outlived its deadline

The bulkhead limits how many requests run at once and queues the rest. Its properties generate concurrency limits, queue limits, request counts, outcomes, abort patterns, and timeouts, then check that concurrency never exceeds the limit, queue depth never exceeds its own, overflow rejects with `BulkheadFullError`, admitted requests reach the transport in order, every outcome releases exactly one slot, and everything returns to zero afterwards.

The timeout property failed after one generated case and shrank to a deadline of one millisecond:

```text
maxConcurrent: 1
request A: occupies the active slot indefinitely
request B: waits in the queue with timeout = 1 ms
```

B's timeout fired on schedule and it stayed in the queue. It left only when A finally completed and the queue admitted it, at which point the core noticed the expired deadline and rejected. The error type was correct, which is precisely why this would have survived a less careful test: the caller sees `TimeoutError` eventually. The deadline had bounded nothing, and if A never completed, B would have waited forever holding a queue slot.

The reason is a signal mix-up: the bulkhead was listening to `ctx.request.signal`, which carries the caller's original signal. The signal that actually represents the whole logical request, combining user cancellation, transformed-request cancellation, the overall timeout, and the controller behind `abortAll()`, lives in plugin metadata and is used at dispatch. The queue sits before dispatch, so it was watching a signal that could never carry a timeout. One line moves it to the right one:

```ts
const signal = ctx.metadata.signals.combined ?? request.signal
```

Cancellation while queued then has to preserve its classification, so a user abort becomes `AbortError` and an expired deadline becomes `TimeoutError`, and the entry and its listener are removed the moment either arrives.

## Two defects in deduplication

The dedupe plugin collapses concurrent identical requests into one physical request. Everything about it depends on what "identical" means, and the default answer is method, URL, and body, with a `hashFn` option for applications that need headers or tenant identity or anything else in the key.

The body-identity property failed after one case and shrank to two POSTs whose bodies were `""` and `" "`, collapsed into a single physical request. The documented identity includes the body, but the implementation read it from the `init` argument only. A caller who passes a fully constructed `Request` has no `init.body`, so every such request hashed as though it had no body at all, and two POSTs differing only in payload became the same key. One of them was silently answered with the other's response.

The correction is a single expression, though the reasoning behind it took longer:

```ts
body: (ctx.init.body ?? ctx.request.body) as DedupeHashParams['body'],
```

A synchronous hash function cannot read a `ReadableStream` body without consuming it, and consuming it would break the request it is trying to identify. Passing the real body through means the default strategy encounters a stream and declines to deduplicate, which is the safe answer: two requests are treated as distinct when the client cannot prove they are the same. Applications that know how their streamed requests should be identified can still supply a `hashFn`.

The cancellation property failed on its first case too, shrinking to two callers sharing one request where the second aborts. Its promise stayed pending until the shared response arrived, then resolved successfully. The dedupe entry stored `resolve` and `reject` for each waiter and never watched their signals, so a waiter could ask to leave and be ignored. Each waiter now gets a listener that removes it on cancellation with the right error type, and cancelling a waiter affects only that caller.

One asymmetry remains, and documenting it was the honest move: the first caller owns the physical request, so aborting that one aborts the shared operation and rejects everyone still waiting.

## Arithmetic on a number the server chose

The download progress plugin wraps a response body and reports bytes as they arrive. Its properties generate chunk boundaries, valid and malformed `Content-Length` headers, declared lengths that disagree with the actual body, upstream failures, callback failures, and consumer cancellation, then require byte-for-byte passthrough, cumulative counts that match the chunks seen, percentages between zero and one, and metadata that survives the wrapper.

Two cases exposed the same mistake from opposite directions. A response with `Content-Length: garbage` and one byte of body reported `totalBytes: NaN`, and every subsequent percentage computed from it was `NaN` too. A response declaring one byte and delivering two reported `percent: 2`, from an API whose type documents a fraction between zero and one. Both went straight into arithmetic and out to the callback.

`Content-Length` is a value the server chose. It arrives over the network, it can be absent, malformed, or simply wrong, and nothing in the client had been treating it as input:

```ts
const parsedContentLength =
  contentLength && /^\d+$/.test(contentLength) ? Number(contentLength) : 0
const totalBytes = Number.isSafeInteger(parsedContentLength)
  ? parsedContentLength
  : 0
```

Anything that is not a non-negative decimal integer inside the safe range becomes the documented unknown-total value. The percentage is then clamped so that a server sending more than it declared produces `1` rather than `2`, while the transferred-byte count stays truthful about what actually arrived.

Seven properties across 2,300 cases confirmed the rest: bytes leave the wrapper exactly as they entered, cumulative counts track the chunks, status and headers survive, upstream and callback failures reach the consumer, and cancelling the returned body propagates upstream without inventing a final progress event.

## The tally

| Area | Properties | Generated cases | Defects |
| --- | ---: | ---: | ---: |
| Hedge | 6 | 4,500 | 1 |
| Retry | 6 | 4,600 | 1 |
| Core client | 12 | 5,750 | 3 |
| Retry and hedge together | 6 | 3,500 | 3 |
| Circuit breaker | 6 | 2,200 | 0 |
| Bulkhead | 5 | 2,100 | 1 |
| Dedupe | 7 | 2,500 | 2 |
| Download progress | 7 | 2,300 | 1 |
| **Total** | **55** | **27,450** | **11** |

The suite went from 19 files and 206 test blocks to 27 files and 274 tests, and it still runs in under nine seconds because fake timers mean generated delays cost nothing. There is no separate fuzz command and no separate CI job, the properties are ordinary Vitest files that generate their own inputs, so `npm test` runs all 27,450 cases alongside everything else. It all shipped as `@fetchkit/ffetch` 5.6.0.

Every counterexample stayed. Three of them became deterministic tests sitting next to the property that found them, for cases specific enough that I wanted them checked by name; the rest live on as inputs the generator can still reach.

## What the eleven have in common

The defects came from eight different files, and they were not eight different mistakes.

**Position mistaken for proof.** The hedge race and the per-branch `onComplete` are the same error wearing different clothes. In one, the most recently launched attempt was treated as the only remaining attempt. In the other, the retry runner reporting completion was treated as the only runner. Both are cases of a component knowing something about itself and assuming that fact describes the whole operation.

**Cancellation stopping at a layer boundary.** `abortAll()` reached the bookkeeping and not the socket. The bulkhead queue watched the caller's signal instead of the one carrying the deadline. Both are about which signal a layer is entitled to trust, and in both cases the layer trusted the one nearest to hand rather than the one representing the request as a whole.

**Internal machinery visible from outside.** Losing hedge branches reported their cancellation as application-level aborts, and speculative branches announced completions the application never asked for. The client was describing its own implementation to code that only knows about logical requests.

**Server values treated as invariants.** `Content-Length` went from a header into arithmetic without anything asking whether it was a number.

**Tests passing for reasons unrelated to their names.** The `abortAll` example test is the cautionary one, and it is worth sitting with: a timeout in the fixture made a broken feature look correct, indefinitely, to anyone reading the test name.

**Promises created and dropped.** The async `onRetry` failure was invisible to every assertion about requests, hooks, and cleanup, and showed up only as process-level noise that a less strict setup would have swallowed.

None of these are exotic. If you write async infrastructure in JavaScript, you have most of them somewhere.

## What this does not prove

Twenty-seven thousand generated cases is not a proof, and the number is less impressive than it looks: it is 27,450 draws from a space I described, so it inherits every assumption I made about what a network outcome is. My arbitraries produce four status codes and delays up to twenty milliseconds. Real servers produce redirects, `1xx` responses, connections that half-close, and delays measured in seconds.

Fake timers buy determinism and give up realism. The properties never touch a socket, so anything arising from real transport behaviour, event loop pressure, or genuine parallelism is outside what they can see. Application handler behaviour is outside too; the properties check what `ffetch` does, not what happens when an `onRetry` hook mutates shared state.

This is also bounded property testing rather than continuous fuzzing. The runs are fixed-size, they happen when CI happens, and nothing is accumulating a corpus or exploring coverage over time. A Go project would get more from `go test -fuzz`, which keeps interesting inputs and searches with feedback.

Some properties earned their place more than others. The circuit breaker suite found nothing and is closer to executable documentation than to bug-finding, which is worth having but is not what I would point at to justify the technique. A few of the core-client properties duplicate what a decent parameterised test would have covered. The ones that paid were the properties about ordering, cancellation, and cleanup, which is to say the ones where the input was a timeline.

## Trying this on your own code

- Pick the component that reacts to an ordering rather than a value. Anything that races, retries, queues, cancels, or cleans up is where generated timings find things - a pure function that maps input to output is better served by the examples you already have.
- State the rule you already believe rather than the case you already fear. If you write a property that encodes the counterexample you suspect, you have written a regression test with extra ceremony. The value comes from properties general enough that the generator can surprise you, and the surprise is the point.
- Use fake timers. A thousand cases with generated delays costs a second when time is advanced programmatically, and that is what makes it reasonable to run every property on every commit instead of nightly.
- When a property fails, read the shrunk counterexample before you open the source. It is usually small enough to reason about directly, and half the time the cause is obvious from the input alone.
- Keep both artifacts: the property, and the minimal case it produced. The property guards the general rule going forward, and the case documents the specific thing that was once broken.
- When a failure exposes a genuine design question rather than a mistake, let the documentation break the tie. The cancellation finding could have gone either way as a design choice, and what made it a bug was that the library had already promised the other behaviour in writing.

## What actually changed

The suspicion I started with was correct, and confirming it was the least valuable thing that happened. A regression test would have done that with less cognitive overhead.

What the properties did instead was find ten defects I had no reason to suspect, in components I considered finished, several of them covered by tests that passed. The tests I wrote by hand covered the situations I had imagined while writing the code, which is exactly the limitation you would predict and exactly the one that is hardest to notice from the inside.

All the work described above can be found in [this PR](https://github.com/fetch-kit/ffetch/pull/90/changes). The same approach has since run against `chaos-fetch`, `chaos-proxy`, and the Go port, where the tooling is different and the findings were different again. This was the first time I have used property-based testing to explore a space I could not enumerate by hand, and it was worth the effort. It also improves the [OpenSSF scorecard](https://scorecard.dev/viewer/?uri=github.com/fetch-kit/ffetch) of `ffetch` a little bit :D