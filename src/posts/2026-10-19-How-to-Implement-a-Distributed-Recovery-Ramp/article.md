---
layout: layouts/post.njk
title: How to Implement a Distributed Recovery Ramp
date: 2026-10-19
description: A breaker closing can return full traffic to a dependency that is still fragile. How to ramp admission back gradually by giving the application control of the shared limit and leaving enforcement to the library.
excerpt: "A breaker closes and the full ceiling returns in the same instant, which is how a recovering dependency gets broken a second time. The ramp is easy to write; deciding who owns it is not. These are the designs I tried, the distributed coordination that ruled most of them out, and the shared settings update that lets an application ramp a fleet's limit while the library keeps enforcing it."
tags:
- posts
- javascript
- typescript
- distributed systems
- resilience
- series--Distributed Resilience
---
*This series follows circuit breakers, bulkheads, and rate limiters from their in-process foundations to implementations that coordinate across a fleet. This article examines how to implement a distributed recovery ramp, using [Caracal](https://github.com/gkoos/caracal) as reference.*

1. [How to Implement a Distributed Circuit Breaker](/posts/2026-09-14-How-to-Implement-a-Distributed-Circuit-Breaker/)
2. [How to Implement a Distributed Bulkhead](/posts/2026-09-17-How-to-Implement-a-Distributed-Bulkhead/)
3. [Rate Limiting Without the Refill Loop: Token Bucket vs GCRA](/posts/2026-09-22-Rate-Limiting-Without-the-Refill-Loop-Token-Bucket-vs-GCRA/)
4. [How to Implement a Distributed Rate Limiter](/posts/2026-09-24-How-to-Implement-a-Distributed-Rate-Limiter/)
5. [How to Combine Circuit Breakers, Bulkheads, and Rate Limiters](/posts/2026-09-25-How-to-Combine-Circuit-Breakers-Bulkheads-and-Rate-Limiters/)
6. [How to Implement a Distributed Recovery Ramp](/posts/2026-10-19-How-to-Implement-a-Distributed-Recovery-Ramp/)

*The earlier posts in the series covered well known, universally accepted patterns for handling failures in distributed systems. Their implementation was relatively straightforward. This post presents a more opinionated approach that seems to be working for my use case, but unlike the previous ones, it involves more judgment and trade-offs rather than a clear-cut solution.*

A circuit breaker stops calls to a failing dependency and eventually lets a few probes through to see whether it can accept work again. When those probes succeed, the breaker closes and ordinary traffic resumes. A dependency that can handle a few requests may still struggle under its usual load, especially while caches are cold or capacity is coming back online. A **recovery ramp** gives it time by increasing the admitted traffic gradually.

I wanted to add this to [Caracal](https://github.com/gkoos/caracal), my resilience library. But this is a surprisingly tricky problem once distribution and shared limits come into play. I asked an AI to help design it first (:D), expecting that the existing primitives would make the work fairly straightforward. We could start with a low concurrency limit and raise it as the dependency recovered. The proposals soon involved teaching the breaker about other policies, inferring limits from the surrounding pipeline, or installing temporary policies that would disappear when recovery finished.

Each proposal required a decision about who should own recovery. The library can enforce a concurrency ceiling, but deciding how quickly to raise it requires knowledge of the dependency and what the application considers acceptable. Distribution complicates that boundary further: a process reacting to a breaker transition can change its own behaviour while the rest of the fleet continues admitting traffic as before. The mechanism has to preserve shared accounting without making the library responsible for the recovery strategy.

The design I settled on gives applications a way to update existing distributed policies while Caracal continues enforcing their shared limits. A recovery ramp becomes one use of that capability. Getting there took more judgement than writing the ramp itself, and the AI wasn't being particularly helpful in untangling the mess of ownership and coordination decisions this seemingly simple feature entails.

## What I tried and dismissed

First I tried to put the ramp inside the circuit breaker. After successful probes, the breaker would continue restricting admission and gradually let more calls through. That gives it responsibility for a concurrency budget alongside its health decisions. A breaker can [count its own half-open probes](/posts/2026-09-14-How-to-Implement-a-Distributed-Circuit-Breaker/#the-probe-budget-has-to-be-a-global-one), but extending that restriction into normal operation means deciding how it should interact with the admission policies the application already uses. And not very reusable either: what if the application wants to use the same ramp logic for multiple breakers or different types of admission policies?

The next idea was to infer those policies from the surrounding pipeline and ramp back towards their configured limits. Consider an operation with [a per-customer bulkhead inside a shared bulkhead](/posts/2026-09-17-How-to-Implement-a-Distributed-Bulkhead/#multiple-bulkheads-acquired-in-order) protecting the dependency. Both limits apply, but they govern different populations of calls. The library would have to choose which budget to change and how that choice affects other operations sharing it. Policy order alone cannot supply that meaning, and some applications have no normal bulkhead to provide a target at all. It would be very clever if I could get it right, but zero chance of doing so reliably in all cases.

Explicitly binding a recovery policy to the breaker removes the guesswork about which policy participates, but it still leaves a lifecycle to define. Suppose a temporary bulkhead starts at three concurrent calls and eventually reaches twenty. If the normal ceiling is fifty, leaving the temporary policy active keeps the application below its intended capacity. Removing it requires a definition of completion and a way to retire its restriction while calls admitted under it are still running. And that lifecycle management would have to be implemented in the library, which brings the complexity of ownership question back into the library's domain. Same problem as before: it's too complex to handle every edge case reliably (for me anyway).

Replacing policy instances looked simpler because the application could choose its own steps. It could use a bulkhead of three for a while, then switch to ten. The [accounting needs to survive the switch](/posts/2026-09-17-How-to-Implement-a-Distributed-Bulkhead/#what-a-permit-actually-holds) though: with fresh counters, the new bulkhead could admit ten calls while the old one still had three in flight. Preserving the existing accounting makes this a settings change on the same budget, which is the capability we eventually chose to build.

A general API for adding, removing, and reordering policies would also allow a ramp, but it would require rules for calls already executing through an earlier pipeline. Removing a policy cannot erase its outstanding permits or prevent their eventual release. That scope was much larger than the recovery problem required, but a subset of it could be used to implement the ramp: **changing the limits on existing policies while preserving their current state**. With that approach, the library enforces the shared limits, and the application controls the progression of the ramp without disturbing the pipeline's identity. I finally got to a design that felt both practical and reusable. And it also shows a very severe limitation of today's LLMs: **they are much better at solving a problem you've defined than at figuring out which problem actually needs solving.** Each of the earlier proposals was plausible, and an LLM could probably have produced a convincing implementation of any of them. The difficulty was recognizing that they were solving the wrong problem, following the consequences of each design decision, and eventually arriving at a different abstraction altogether. That took several substantial conceptual jumps, with no tests or compiler errors to tell us when we were heading in the wrong direction.


## The distributed catch

With that boundary settled, I could focus on how a settings change would take effect. The application code reacting to the breaker runs in one process, but the policy it wants to adjust can share a budget across the whole fleet. Giving that handler a way to change its local policy would leave the other replicas using their original limits.

Suppose one replica's successful probe closes the shared breaker. That replica emits a local event, and its application handler lowers a bulkhead limit to three. The other replicas can see that the breaker is closed when they next check Redis, but they do not receive the event emitted in the first process. If their bulkheads still use the constructor limit of twenty, they can continue admitting calls under that higher ceiling. Sharing an [occupancy counter](/posts/2026-09-17-How-to-Implement-a-Distributed-Bulkhead/#whose-limit-is-it) does not help when callers apply different limits to it.

This meant the new setting had to be authoritative wherever the shared budget was enforced. Caracal's distributed policies already contact Redis to make admission decisions, so those commands could read the current configuration and use it in the same atomic operation. The application would publish a change through a separate call. A replica handling ordinary traffic would then use that setting on its next admission, without first receiving a broadcast or making another round trip to fetch configuration.

The scope of the change matters too. Lowering the concurrency allowed for one partner API should affect replicas calling that API, without changing an unrelated customer's budget. The configuration therefore belongs to the same policy identity as the runtime accounting, including its operation and resolved scope. A process only needs configuration information for the identities it actually uses.

That also separates observing the trigger from enforcing the result. Every replica can run the same application controller, although only a replica that receives the relevant local event will react to that transition. The resulting configuration is shared, and repeated proposals for the same settings can leave it unchanged. Competing proposals still need revision checks so that a delayed controller cannot overwrite newer intent. None of this guarantees that another controller will reconstruct a missed recovery event, which remains an application concern.

There was a close precedent in [Bottleneck's clustering support](https://github.com/SGrondin/bottleneck#clustering). It stores limiter settings in Redis, and calling updateSettings() changes the settings used by connected limiters. That was a useful example of shared runtime configuration with application-controlled updates. Caracal needed to define the same kind of capability around its existing policy identities and accounting.

[Envoy's slow start](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/load_balancing/slow_start) addresses warming capacity through load balancing: it gradually increases an endpoint's weight. That works with a pool of endpoints among which traffic can be distributed. Caracal controls admission to a scoped operation, so its ramp has to change how much work is allowed through. The existing Redis decision point gave it somewhere to enforce that change without introducing a configuration broadcast system.

## Who owns recovery?

Using Redis as the enforcement point gave the fleet a shared ceiling, but the decision to move that ceiling still needed an owner. The breaker provides a useful signal when successful probes allow it to close. The application then has to decide what that signal means for the dependency it calls, including how much traffic to admit while confidence builds.

For a dependency with a predictable warm-up period, the application can follow a fixed schedule, raising concurrency from three to six, then twelve, and eventually twenty. Another application can wait for latency to settle before allowing each increase. Both use the same limit-update mechanism, but they express different assumptions about recovering capacity. Caracal has no basis for choosing between them from the policy composition alone.

This also means that the breaker can be closed while the application still considers the dependency to be recovering. Closing the breaker allows ordinary calls again, the application's ramp determines how much of that traffic gets through the admission policy. If failures cause the breaker to reopen, the application can put the admission limit back at its recovery floor and abandon the current progression. Completion is another application decision: it restores the intended operating limit on the existing policy, with its accounting still intact.

This split made the settings feature useful beyond recovery. An operator reducing traffic during maintenance can use the same mechanism without involving a breaker at all. Caracal owns enforcement and the rules for applying an update to live state, while the application owns the reason for the change. With that responsibility assigned, the remaining design work was to define a configuration contract that concurrent callers could use safely.

## Shared settings, unchanged policies

The configuration contract follows the division of responsibility: an application submits settings for a particular distributed policy identity, and Caracal applies them to the budget already associated with that identity. The policy stays in the pipeline, so changing its configuration leaves the existing accounting in place.

Until an application writes an override, each policy uses its constructor settings, which count as revision zero. The first explicit update creates a shared record at revision one. From then on, the stored settings take precedence over the corresponding constructor values, including in replicas that start after the update. Ordinary coordination calls cannot overwrite that record with their local defaults.

The public API exposes a configuration manager using the same Redis dataset and namespace as the policy's coordinator. With an existing Redis client, lowering a bulkhead's limit looks like this:

```ts
import { redisConfigurationManager } from "@gkoos/caracal/redis"

const manager = redisConfigurationManager(redis, {
  namespace: "svc:prod",
})

const identity = {
  policy: "bulkhead",
  name: "partner-api-capacity",
  operation: "submit",
  scope: "partner-a",
} as const

const current = await manager.read(identity)
const result = await manager.update(
  identity,
  current?.revision ?? 0,
  { policy: "bulkhead", limit: 3 },
)
```

The read returns the shared snapshot, or null if there is no override. The update supplies the revision on which the proposal is based, allowing Redis to reject a conflicting change if another writer has moved the configuration forward. The caller must handle that result before treating the proposal as accepted. These are explicit management calls, separate from executing the protected operation.

Each update replaces the complete set of supported mutable settings for that policy. For a bulkhead, that is just its limit. For a rate limiter, the snapshot includes both rate and burst, so a decision cannot observe a new rate paired with an old burst. The record also carries its revision and a changedAt timestamp from Redis. It retains the requested settings beside the normalized values used for enforcement, with numeric settings serialized as decimal strings.

The record lives alongside the policy's runtime keys and uses the same Redis hash tag, placing them in the same Cluster slot. An admission command reads the record and applies its settings within the existing atomic operation. Its reply carries the revision used for that decision, along with the full snapshot when the caller's known revision differs. This adds work inside the command and some response data, while preserving the number of coordination calls per execution. An explicit manager read is available when application code needs to inspect the stored configuration independently of traffic.

Configuration records have no TTL. When recovery finishes, the application writes its normal operating settings as another revision, while existing execution leases and runtime retention keep their own expiry rules. That keeps the lifetime of a configuration separate from the work governed by it. Preserving that work also requires precise rules for when each mutable setting takes effect, particularly for calls that were already admitted before an update.

## Changing limits without resetting state

A complete configuration snapshot makes the settings change atomic, but each field still needs a rule for how it interacts with existing work. I restricted updates to fields whose effects could be defined against the policy's current state. Applying an update leaves that state in place, and the next relevant coordination command makes its decision using the new settings.

For a bulkhead, the mutable field is limit. If three calls hold permits and the ceiling rises to ten, there is room for seven more calls, assuming those permits remain active. Lowering the ceiling also preserves existing holders: if eight calls are running when the limit becomes three, [those calls continue](/posts/2026-09-17-How-to-Implement-a-Distributed-Bulkhead/#what-a-permit-actually-holds), and new acquisitions are refused until occupancy falls below three. Permit renewal and release keep their existing rules.

The rate limiter allows rate and burst to change together. It uses [GCRA](/posts/2026-09-22-Rate-Limiting-Without-the-Refill-Loop-Token-Bucket-vs-GCRA/#advancing-the-timestamp), which records a theoretical arrival time representing the schedule built up by earlier admissions. That timestamp survives an update. The next admission uses the new spacing and burst allowance against the existing schedule, preserving any outstanding time debt. Increasing burst can deliberately make more traffic admissible, while changing rate controls how subsequent admissions advance the schedule.

The breaker has more mutable fields because its decisions depend on both health observations and its current state. `failureThreshold` and `minimumThroughput` are evaluated against the retained observations when the next outcome is recorded. Changing `windowSize` trims that history on the next observation if necessary, while increasing it only creates room for future observations. History discarded under an earlier, smaller window stays discarded.

An update to `openMs` changes when an OPEN breaker becomes eligible for probes. The elapsed time is still measured from when it originally opened. If it has already been open for five seconds and the duration is reduced to three, the next probe-admission check can move it to `HALF_OPEN`. Increasing the duration after it has reached HALF_OPEN leaves that state intact, with its existing probes.

Within `HALF_OPEN`, `halfOpenProbes` controls new probe admissions. Lowering it preserves probes already in flight, just as lowering a bulkhead limit preserves permit holders. [`halfOpenSuccesses`](/posts/2026-09-14-How-to-Implement-a-Distributed-Circuit-Breaker/#the-settings-are-not-independent) changes the target checked at the next successful probe settlement, retaining the successes already accumulated. Writing a lower target does not itself close the breaker, and an ignored result only releases its probe slot. A failed probe still reopens it through the ordinary transition rules.

Lease durations and retention settings stay fixed, along with policy identity and callbacks. During review, `openMs` exposed a hidden dependency: the original implementation also used it to derive cleanup retention for `CLOSED` breaker state. Making it mutable would have changed two behaviours at once. I separated that cleanup duration from the shared setting and resolved it at construction, so changing the OPEN waiting period leaves cleanup retention alone.

These rules keep configuration revisions separate from [breaker generations](/posts/2026-09-14-How-to-Implement-a-Distributed-Circuit-Breaker/#generations-become-epochs). An update changes the settings used for later decisions, while an ordinary state transition can still advance the generation and invalidate probes as before. The remaining validation work is to ensure that a proposed snapshot contains coherent values, especially when several replicas are trying to change it.

## Validation, duplicates, and uncertainty

Preserving runtime state makes the validity of the new settings especially important. A breaker override with `minimumThroughput` greater than `windowSize` would require more observations than the window could ever retain, preventing its failure threshold from being evaluated. Both values can be valid individually while the combination is unusable. Shared updates therefore validate the complete snapshot, including that relationship and the bounds on derived rate-limit arithmetic.

Normalization uses the same TypeScript helpers as policy construction, with stricter cross-field validation for shared breaker overrides. A rate becomes a whole-millisecond emission interval, and a failure threshold becomes an integer numerator in thousandths. The Redis scripts consume those effective values. Equality also uses the normalized configuration, so different requested numbers that resolve to the same behaviour leave the revision unchanged.

That equality rule matters when the same application code runs in several replicas. Suppose two controllers both read revision seven, where the bulkhead limit is three, and both propose six. The first update writes revision eight. The second finds that its proposed settings already match and returns unchanged, even though its expected revision is now stale. It preserves both revision eight and its changedAt timestamp, allowing duplicate proposals without restarting the step's clock.

A differing proposal must still match the current revision. If a delayed controller tries to restore the limit to three using revision seven, it receives a conflict with the stored snapshot. Automatically substituting revision eight and trying again would turn an obsolete proposal into a successful overwrite. The application has to reconsider its intent against the returned configuration before making another change.

A lost response introduces a different uncertainty. Redis can commit an update before the connection fails, leaving the caller unable to tell whether it was applied. Repeating the same proposal with the original expected revision can apply it if the first attempt never ran, or return unchanged if those settings are already stored. If a different configuration has since replaced them, the stale retry conflicts. This protects the current record without keeping a receipt history, but the result cannot establish whether the original attempt committed before a later writer intervened.

Revision information observed through ordinary traffic has its own limits. Replies can arrive out of order, so a lower revision alone cannot distinguish a delayed response from configuration loss or rollback. The coordinator's cached revision only helps Redis decide whether to include the full record in its next reply; enforcement continues using the record on the server. An explicit manager read provides the shared snapshot as of that call, without making cached observations authoritative or publishing them back to Redis.

Management reads also validate the stored record. A malformed record produces a ConfigurationError with reason corrupt-record, while an unknown schema version produces unsupported-schema. Silently falling back to constructor settings would conceal the problem and change admission behaviour, so these errors remain visible to the caller. A missing record is a separate case: it means there is no shared override and the policy uses its revision-zero baseline.

Those checks define how individual updates behave under competition and uncertain delivery. They still leave operational boundaries to account for, particularly when Redis is unavailable or replicas run different versions of the configuration protocol.

## The operational boundaries

An atomic update gives one policy identity a coherent configuration on the Redis primary serving the command. The fleet still depends on Redis availability, and a failover or data-loss event can remove settings that an application previously observed. The guarantees around that update therefore have to fit the existing coordination model.

During a Redis outage, distributed bulkheads and rate limiters [continue to fail closed](/posts/2026-09-25-How-to-Combine-Circuit-Breakers-Bulkheads-and-Rate-Limiters/#the-composed-system-depends-on-its-coordinator) because they cannot establish admission. The breaker follows its existing onCoordinatorError setting, which defaults to fail-open when the process has no retained knowledge that the scope is OPEN or HALF_OPEN. While that non-closed state remains its last known state, an outage rejects calls for that scope regardless of the setting. Cached configuration cannot reconstruct shared occupancy or current dependency health, so I kept those behaviours instead of introducing a local substitute for distributed enforcement.

Deployment order matters even while Redis is healthy. Every participant sharing an identity must understand the configuration protocol before overrides are enabled. An older replica can execute its own Lua scripts with constructor settings and ignore the shared record entirely. A schema version helps a newer client reject a format it cannot interpret, but it cannot identify another process running old code. Rolling back to a release that predates the feature also leaves the records behind: that release uses its baselines, and a later upgrade reactivates the stored overrides.

Persistent records bring an identity-management cost. A valid update to a mistyped scope can create a dormant record that becomes active if the same scope is used later. Renaming a scope leaves the old record behind, and there is no public deletion or listing API to manage it. Applications need bounded identities and an administrative approach to retained records. Configuration can also survive the loss of breaker runtime state, so a fresh breaker generation does not automatically invalidate a limit left by an earlier recovery attempt.

Atomicity stops at [one policy identity](/posts/2026-09-25-How-to-Combine-Circuit-Breakers-Bulkheads-and-Rate-Limiters/#what-each-admission-commits). A controller changing both a breaker and an admission policy must choose the order and handle the interval between those writes. There is also a reaction window between the breaker closing and an event handler publishing a lower admission ceiling, during which ordinary calls can already pass. The settings mechanism governs subsequent decisions; eliminating that window would require tighter coupling between the breaker transition and admission.

The shared record also has no exclusive owner. Restoring the normal limit when a process shuts down looks like sensible cleanup, but during a rolling restart that process can overwrite the ceiling still governing recovery in the surviving replicas. A controller's departure does not establish that the dependency has recovered. Restoring normal settings belongs to the application's recovery lifecycle, with the same revision checks as any other change.

A separate client for configuration writes needs an actual permissions boundary. [Redis ACLs](https://redis.io/docs/latest/operate/oss_and_stack/management/security/acl/) control commands and key access, and the coordination clients already need scripting and runtime-state write permissions. Calling one connection the writer does not restrict the grants held by the others. Strict separation requires verifying the deployed permissions against the scripts involved; the broad grants used by the existing coordinators assume trusted participants.

These limits keep the configuration feature within Caracal's existing coordination model, while leaving recovery strategy in application code. With those boundaries explicit, I could test a controller against a dependency that failed and later resumed successful responses. The useful evidence would be the workload admitted at each step, alongside the configuration writes.


## What the measured run shows

I created a new [case study](https://github.com/gkoos/caracal-sandbox/tree/main/case-studies/16-recovery-ramp) in the Caracal Sandbox to exercise that boundary with four replicas sharing a bulkhead whose normal limit was eight. The application controller set a floor of one and doubled the limit once per second until it reached eight.

The scenario makes the dependency fail one second into the run and resume successful responses at three seconds. A local breaker event reporting a transition from HALF_OPEN to CLOSED starts the controller's recovery ladder. An OPEN event cancels that process's progression and proposes the floor again. Every replica runs the controller because any of them can receive the relevant transition event, while Redis holds the shared configuration they update.

The recorded ladder was 1 -> 2 -> 4 -> 8, paired with revisions. Its start entry appeared three milliseconds after the close event. The floor had already been established while the breaker was open, so the start entry confirmed revision one rather than creating another revision. This distinction matters when reading the controller log: a successful proposal can leave the existing record unchanged.

To check enforcement, I used the dependency's own sampled in-flight timeline. The per-step check waits 300 milliseconds after each logged step before examining samples up to the next step, allowing calls admitted under an earlier ceiling to drain. Those windows produced:

| Limit | Revision | Sampled peak in flight | Samples |
| ---: | ---: | ---: | ---: |
| 1 | 1 | 1 | 46 |
| 2 | 2 | 2 | 45 |
| 4 | 3 | 4 | 46 |
| 8 | 4 | 8 | 825 |

Each window reached its configured ceiling, and all its samples stayed within it. A check of the overall peak alone would accept a controller that jumped directly to eight. Matching the dependency's observations to each step makes the intermediate limits testable too, while leaving the settling intervals outside that per-step assertion. Sampling also bounds the evidence to what the instrument observed.

The checks cover the ordering of the ladder and its trigger, including that it finishes at the constructor baseline. This run recorded zero conflicts: one replica observed the close and drove the ramp. Demonstrating competing controllers would require a run that actually creates that collision. The ramp also completed before shutdown, leaving restored false, so the shutdown restore path remained unexercised.

The dependency's configured capacity stayed at sixteen throughout this experiment; the timeline changed its failure rate. The evidence therefore establishes that the application-directed concurrency steps reached shared enforcement across the replicas. Measuring whether those steps prevent another overload during warm-up requires a dependency whose available capacity itself changes, followed by a comparison against immediate restoration of the normal ceiling.

The controller also supports a rate target with burst held constant, but this study exercises concurrency. A rate-ramp experiment needs an arrival-rate measurement, such as the instrument used in [case study 12](https://github.com/gkoos/caracal-sandbox/tree/main/case-studies/12-rate-distributed). Those experiments would extend the evidence to recovery effectiveness and rate enforcement, while this run gives a concrete check of the shared bulkhead mechanism.


## The judgement behind the mechanism

The measured ladder gave me an external check on the mechanism I had chosen. Once the application supplied a sequence of limits, I could check whether the dependency's observed concurrency followed it. The experiment also exposed the limits of that evidence: recovery effectiveness needs a different workload, and competing controllers need a run that actually makes them compete.

The earlier ownership decision had no equivalent pass condition. A ramp embedded in the breaker could satisfy its own tests, as could a temporary admission policy with a carefully implemented lifecycle. Those tests would establish behaviour within the chosen design. Choosing between the designs required following their consequences into applications with different policy compositions and deciding how much responsibility the library should take on.

That was where I needed the most judgement during the AI-assisted work. A plausible implementation made each proposal look more settled than it was, even while its assumptions about ownership remained unresolved. I had to keep working through what happened to the surrounding policies and existing calls before the narrower settings-update feature became clear. Once that boundary was defined, there were concrete invariants to implement and test. To give credit where it's due, the LLM did a decent job at implementing the boring but necessary parts: tests, boilerplate, and documentation.

The [shared configuration API](https://github.com/gkoos/caracal/blob/main/docs/redis.md#shared-configuration) shipped in Caracal 0.9.0, and the [application controller](https://github.com/gkoos/caracal-sandbox/blob/main/apps/partner-api/src/ramp.ts) shows one way to use it for recovery. Its schedule is an application choice that can be tested against the dependency it protects. Caracal's responsibility is to apply those settings consistently to the existing shared budget, preserving the work already accounted for while the application decides how that budget should move.
