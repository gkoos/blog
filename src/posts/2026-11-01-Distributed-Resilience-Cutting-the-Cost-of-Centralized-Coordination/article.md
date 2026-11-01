---
layout: layouts/post.njk
title: Distributed Resilience - Cutting the Cost of Centralized Coordination
date: 2026-11-01
description: A shared coordinator makes distributed limits correct and puts itself on the critical path of every admission. How to let each replica hold a bounded piece of the fleet's authority, what that costs, and what a four-replica sandbox measured.
excerpt: "The coordinator answers one question per admission: may this call proceed. That is what makes a fleet-wide limit real, and it is also what makes the coordinator a hard dependency of every request. I spent months on the alternative — replacing it with peer-to-peer state sharing — before measuring that it does not work nearly as well as it sounds. What did work was smaller: keep the coordinator as the source of truth, and let each replica hold a bounded, expiring piece of its authority."
tags:
- posts
- javascript
- typescript
- distributed systems
- resilience
- series--Distributed Resilience
---
*This series follows circuit breakers, bulkheads, and rate limiters from their in-process foundations to implementations that coordinate across a fleet. This article examines how to take the coordinator off the request path, using [Caracal](https://github.com/gkoos/caracal) as reference.*

1. [How to Implement a Distributed Circuit Breaker](/posts/2026-09-14-How-to-Implement-a-Distributed-Circuit-Breaker/)
2. [How to Implement a Distributed Bulkhead](/posts/2026-09-17-How-to-Implement-a-Distributed-Bulkhead/)
3. [Rate Limiting Without the Refill Loop: Token Bucket vs GCRA](/posts/2026-09-22-Rate-Limiting-Without-the-Refill-Loop-Token-Bucket-vs-GCRA/)
4. [How to Implement a Distributed Rate Limiter](/posts/2026-09-24-How-to-Implement-a-Distributed-Rate-Limiter/)
5. [How to Combine Circuit Breakers, Bulkheads, and Rate Limiters](/posts/2026-09-25-How-to-Combine-Circuit-Breakers-Bulkheads-and-Rate-Limiters/)
6. [How to Implement a Distributed Recovery Ramp](/posts/2026-10-19-How-to-Implement-a-Distributed-Recovery-Ramp/)
7. [Distributed Resilience - Cutting the Cost of Centralized Coordination](/posts/2026-11-01-Distributed-Resilience-Cutting-the-Cost-of-Centralized-Coordination/)

In the earlier posts in this series, we built the distributed resilience policies in [Caracal](https://github.com/gkoos/caracal). We started with a circuit breaker that shares observations across replicas, then added fleet-wide limits on concurrency and request rate. Redis holds the shared state and makes admission decisions atomically, allowing every replica to enforce the same policy against the same accounting.

The [composition article](/posts/2026-09-25-How-to-Combine-Circuit-Breakers-Bulkheads-and-Rate-Limiters/) brought those policies together and examined how their order changes what each one counts. The [recovery ramp](/posts/2026-10-19-How-to-Implement-a-Distributed-Recovery-Ramp/) then added shared runtime configuration, allowing an application to adjust the fleet’s limits while preserving existing work. By this point, Caracal could coordinate protection across a fleet and change its settings during recovery, with Redis involved in every admission.

## The coordinator becomes a bottleneck

In the original, strictly coordinated implementation, each policy makes its admission decision through a Redis call. A distributed bulkhead acquires a permit before starting work and releases it after the work settles, while the breaker reads its shared state and later reports the outcome. Composing policies adds coordinator calls around the same execution, with the admission checks completing before the dependency receives any work. The time spent waiting for those replies becomes part of the request's latency.

The coordinator receives those checks at the rate requests arrive, including checks that end in rejection. At 1000 attempted calls a second, one admission check per call produces 1000 coordinator commands a second, before accounting for permit releases or outcome reports. Lowering the downstream limit reduces admitted work, while incoming requests continue to require admission decisions. The shared limit therefore leaves the coordinator exposed to the traffic being refused.

A coordinator outage also prevents the distributed rate limiter and bulkhead from admitting work, because neither policy has enough information locally to establish that capacity is available. The breaker's fail-open setting governs only its own admission decision, so a later policy in the pipeline still refuses the call when Redis is unreachable. The application depends on the coordinator being available as well as the partner API it calls.

I wanted to reduce these coordination calls while keeping admission informed by activity across the fleet. I began by investigating a design in which replicas exchanged their observations directly and made decisions from the state they held locally.

## The bright idea I expected to win

First I focused on the circuit breaker, since each replica already observes whether its own calls succeed or fail. Sharing those observations gives a process information about calls made elsewhere in the fleet, and the admission decision then runs against a local copy of that shared history. I expected this to preserve the benefit of a fleet-wide window while removing the coordinator calls from ordinary execution.

The implementation used [gossip](https://en.wikipedia.org/wiki/Gossip_protocol) to exchange counters between peers. Each replica recorded successes and failures in short time buckets, keeping a separate counter component for each process that produced observations. Receivers merged a component by retaining the larger value, which prevented duplicate updates from counting the same observation twice. An older value arriving after a newer one left that component unchanged. This is a [conflict-free replicated data type](https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type) type, or *CRDT*, with expiry rules that prevent an old message from restoring observations whose window has already passed.

I was really proud of this idea. I built a deterministic simulator to compare the design with independent local breakers and a reference breaker that received the fleet's observations immediately. Requests had stable identities, with outcomes assigned independently of which requests a breaker admitted, so rejecting one request left the later workload unchanged. The experiments included a dependency that failed immediately and one whose failures only became visible when callers timed out. Replaying the same workload under each design showed how many additional failing calls it admitted, alongside successful calls lost through rejection.

The simulator initially gave gossip a substantial advantage over independent breakers. In a cold-start profile, where the dependency failed before the replicas had accumulated any history, gossip reduced additional failed admissions from 200 to 52.4 across the fleet, averaged over thirty seeds. The protocol passed the experiment's stated protection and recovery budgets in all four tested profiles. Those results justified implementing the same comparison with real processes and Redis.

Unfortunately, the real-process runs reduced that advantage considerably. With ten replicas receiving 500 requests a second, I started the dependency in failure for twelve seconds and then allowed it to recover, offering each design 20,001 requests over the run. Across ten seeded runs, the mean number of additional failed calls per replica, measured against the reference from the same seed, was:

| Design | Additional failed calls per replica |
| --- | ---: |
| Reference breaker | 0 by definition |
| Independent local breakers | 18.7 |
| Gossip-based breakers | 15.3 |
| Caracal's Redis-coordinated breaker | 4.3 |

Gossip reduced that excess by 18% compared with independent breakers, against the simulator's 74% reduction. The receiving replica continued admitting calls while observations travelled through the gossip protocol, and an update arriving after the failure threshold had been crossed left those earlier calls unaffected. The CRDT's merge rules ensured agreement once the same evidence had arrived, while admission depended on the evidence available at the instant of the decision. Caracal also used a count-based window rather than the experiment's time-bucketed window, with its retention aligned to the same ten-second period, so the comparison included those different detection mechanisms.

I also tried a hybrid that retained the gossiped observations and added a shared OPEN flag in Redis. A replica that detected failure claimed the flag, and the others checked it periodically to stop traffic before their own windows had enough evidence. Recovery remained local, however, and repeated OPEN claims kept the shared restriction active after the dependency recovered. In a separate five-seed cold-start comparison, the hybrid rejected a mean of 4,507 requests that would have succeeded, against 1,697 for gossip alone. Giving a central flag control over admission required a recovery protocol that kept the replicas' state consistent with that flag.

Several assumptions in the simulator also needed correcting once I measured the coordinator itself. It assigned twenty milliseconds to a Redis round trip, while simple exchanges against Redis on the same machine measured a median of 0.35 milliseconds. The original byte estimate assumed a small counter read, although the modelled coordinator actually retrieved an entire bucketed window. Replacing those assumptions with measurements changed the cost comparison, and the real-process runs became necessary checks on conclusions drawn from the simulation.

## Delegation, not replacement

The design I pursued next kept the verdict authoritative in Redis and cached it in each replica. [RedEye](https://github.com/laurells/redeye) provided a working implementation to measure, with a versioned local cache refreshed by store responses and transition notifications. Its failure-rate strategy uses an exponentially weighted average and a single recovery trial, so its failure counts also reflect a different detection and recovery policy. Comparing that implementation with its own cache disabled isolated the saving: over 10,000 healthy calls, caching reduced store operations from 20,000 to 10,002. Each outcome still required a write, while almost every admission read was eliminated.

I took that separation into Caracal: Redis would continue to determine the shared verdict, and replicas would use it locally for a defined period. A replica then needed rules for accepting a newer verdict and handling an expired one, while the coordinator retained responsibility for deciding when the fleet should open or recover. The experiment's full comparison extends beyond this article, but these measurements gave me a concrete basis for keeping centralized authority and reducing the calls needed to use it.

The reframing that worked was smaller than the idea it replaced. Keep the coordinator as the source of truth, and let each replica hold a bounded piece of its authority, enforce it locally, and refresh it. The replica is not inventing policy; it is spending something it was given.

The three policies need three different contracts, because the state they delegate is different in kind, and those differences decide what happens when the coordinator is unreachable.

**A breaker verdict is re-derivable.** The verdict is a function of observations the coordinator holds, so any replica could compute it given the data. That means a verdict can be cached, versioned, and **reconciled**: when the replica can reach the coordinator again, it adopts whatever the current verdict is. The failure mode is bounded staleness, and the replica can be configured to fail closed when its verdict is too old to trust.

**A bulkhead allocation is reclaimable.** A slot is not derivable from anything, but it can be **leased**. Give a replica a number of slots valid for a period, and let the lease expire: if the replica dies, the capacity comes back on its own, without anyone reconciling anything. A grace period lets a replica that was merely slow hand its slots back before the coordinator reissues them.

**A rate-limit grant is consumable.** Permits are spent, and no read can reconstruct what a replica holds — the coordinator only knows what it issued. So a grant is never reconciled. It is issued with a deadline anchored to the moment the request was *sent* rather than the moment the reply arrived, so a slow reply cannot extend its life; it is deduplicated by operation id, so a retried issuance cannot be granted twice; and if it expires unused, it is simply gone.

Each delegated coordinator in Caracal implements the interface already used by its policy. Its local admission logic follows the rules above, allowing an application to change coordination strategies while keeping the existing policy composition.

## The breaker first

The breaker is the hardest of the three, so I started there. Its delegated state is a *decision* rather than a quantity, being wrong about it means admitting traffic to a dependency that is failing, and it has the most machinery: a verdict, a generation, a probe budget, and a policy for what to do when the coordinator cannot be reached. If the shape holds for the breaker, the other two are arithmetic.

It is also the policy where I had the most prior art to borrow from. [RedEye](https://github.com/laurells/redeye) is a Node circuit breaker with a Redis-backed distributed mode, and it does a version of this: an **exclusive trial claim** for recovery, held by a per-call ownership token so a claim can only be released by the instance that took it, with the claim expiring on its own so a slow dependency cannot wedge recovery; and an **open-state cache**, with a benchmark that compares no caching against a refresh interval and a local cache rather than assuming the cache pays for itself.

Two things I took from it directly: cache the verdict, and fail closed rather than inventing one. What I changed: a single exclusive trial serialises recovery on one call at a time, and with a fleet of replicas the interesting question is how many probes are in flight *across the fleet*, not per process. So the trial became a budget, a fixed number of probe tokens, each with a deadline, held in the coordinator. A token that expires frees its slot on its own, which is the same anti-wedging property as an expiring claim, but the overshoot is bounded by design instead of being bounded to "at most two" by an ownership token. That distinction turned out to matter more than I expected, and I will come back to it.

The replica stores a version with each cached verdict and rejects an update that is older than the one it already holds. A delayed CLOSED reply therefore leaves a newer OPEN verdict in place. To handle a change of coordinator, the session also supports a separate identifier called an incarnation. The deployment supplies this identifier, and the session switches to a new one only after reading the coordinator's current state. It then rejects messages carrying the retired identifier. The default Redis integration uses a fixed identifier, so detecting a replacement requires deployment support. The session reads the coordinator's current state at startup and again after reconnecting. Periodic reads also refresh the cache when no notifications arrive, while a notification triggers an earlier read through the same version checks.

The one genuinely fiddly piece is the deadline: the coordinator reports [the server's clock reading](/posts/2026-07-19-Beyond-Happy-Path-Engineering-Time/) and the record's expiry in *server* time, and a client cannot turn that into a local deadline without knowing the server's clock. So the remaining validity is treated as a duration and anchored to the moment the read was *sent*, which makes the replica's deadline conservative: it can be early, never late.

From the outside, opting in is a different coordinator and nothing else. The strict coordinators are unchanged and remain the default:

```ts
import { circuitBreaker } from "@gkoos/caracal"
import { redisCircuitBreakerCoordinator } from "@gkoos/caracal/redis"
import { createServalBreaker } from "@gkoos/caracal/serval"

const breaker = createServalBreaker({
  namespace: "svc:prod",
  authority: redisCircuitBreakerCoordinator(redis, { namespace: "svc:prod" }),
  replicaId: "replica-1",
  freshnessMs: 1_000,          // how long a cached verdict admits without a read
  staleClosed: "fail-closed",  // what to do once a CLOSED verdict is too old
})

const policy = circuitBreaker.distributed({
  name: "partner-api",
  coordinator: breaker.coordinator,
  scope: () => "global",
  minimumThroughput: 20,
  failureThreshold: 0.5,
  openMs: 5_000,
  halfOpenProbes: 3,
  halfOpenSuccesses: 1,
})
```

The policy is unchanged, the coordinator decides whether an admission costs a round trip or is answered from what the replica already holds.

## Then the other two

The delegated bulkhead requests an allocation of concurrent slots from Redis. With a fleet-wide limit of twenty, an allocation of four reserves four slots for one replica against that shared total. The replica acquires and releases slots within its allocation locally, so completing a call makes room for another without contacting Redis. A per-replica ceiling limits how much of the fleet's capacity one process holds.

While handling traffic, the coordinator renews the allocation before its deadline. If renewal fails and the deadline passes, the replica stops admitting new work and keeps tracking calls already running. Redis retains the reservation for an additional grace period before making those slots available elsewhere. As with the [leases in the original bulkhead](/posts/2026-09-17-How-to-Implement-a-Distributed-Bulkhead/#a-permit-that-nobody-can-return), reclamation leaves running work unaffected, so a replacement allocation can overlap calls started under an expired one.

The rate limiter obtains consumable permits from a separate Redis issuer. Redis charges the shared budget when it issues a grant, and the replica spends one permit for each local admission. A grant of ten permits therefore allows ten calls to start within its validity period, with no permit returned when a call finishes. Spending those permits after issuance also changes the timing of admissions compared with checking the shared rate schedule on every call.

Each issuance carries an operation ID, allowing a retry after a lost reply to retrieve the recorded grant without charging the budget again. Grants use the send-time deadline described above, and unused permits are discarded when that deadline passes. The coordinator replenishes exhausted stock through another issuance request, while an unreachable issuer leaves the replica limited to its remaining unexpired permits. Once those are spent or expire, further calls are refused until a new grant arrives.

Both coordinators keep their own local accounting and obtain authority through policy-specific Redis issuers. The session used by the breaker does not reconstruct their allocations or restore spent permits.

## What the sandbox measured

I measured the implementation in the [Caracal sandbox](https://github.com/gkoos/caracal-sandbox), where four application processes call an HTTP dependency through either strict or delegated coordinators. The healthy comparisons ran for fifteen seconds with a target of 400 requests a second and at most twenty client requests in flight. The dependency had a configured response time of thirty milliseconds, and its own counters recorded the calls it received and their peak concurrency.

A wrapper around each replica's Redis client counted coordination commands, including calls made to obtain or renew delegated authority. The tables divide that count by all client executions, including rejected requests, and cover the complete policy pipeline. The latency figures come from the load generator and include policy rejections as well as calls that reached the dependency.

The concurrency comparison uses [study 02](https://github.com/gkoos/caracal-sandbox/tree/main/case-studies/02-distributed-basic) as the strict baseline and [study 18](https://github.com/gkoos/caracal-sandbox/tree/main/case-studies/18-serval-delegated) for delegation, both configured with a shared bulkhead limit of five. The saved baseline used Caracal 0.10.0, while the delegated run used the published 0.12.0 package, so these results compare the recorded configurations across those releases.

| Measurement | Strict | Delegated |
| --- | ---: | ---: |
| Caracal version | 0.10.0 | 0.12.0 |
| Dependency peak in flight | 5 | 5 |
| Successful client requests/s | 105 | 107 |
| Client p99 latency | 59 ms | 54 ms |
| Redis commands per execution | 2.50 | 0.35 |

The delegated run completed 1,598 calls and refused 4,693 for capacity, with no dependency failures or breaker openings. Its allocation was reused across those successful calls, and the saturated pool answered capacity refusals locally. The reduction in coordinator traffic therefore covered a workload in which most incoming requests were rejected.

For the rate comparison, [studies 28 and 29](https://github.com/gkoos/caracal-sandbox/tree/main/case-studies/28-serval-rate-burst) both used published Caracal 0.12.0 with a shared rate of 100 calls a second and a burst of forty. The delegated coordinator requested grants of up to forty permits, while the strict coordinator checked each admission individually. Both studies gave the dependency capacity for sixty-four concurrent calls so that the configured burst had room to complete.

| Measurement | Strict | Delegated |
| --- | ---: | ---: |
| Calls received by the dependency | 1,541 | 1,539 |
| Mean dependency requests/s | 103 | 103 |
| Peak arrivals in a one-second window | 140 | 140 |
| Dependency peak in flight | 20 | 11 |
| Client p99 latency | 58 ms | 52 ms |
| Redis commands per execution | 4.24 | 1.03 |

The mean rate includes the allowance spent from the initial burst. Both configurations reached the same peak one-second rate under this workload, while their peak concurrency differed because admissions were distributed differently over time. The ten-permit delegated run in [study 25](https://github.com/gkoos/caracal-sandbox/tree/main/case-studies/25-serval-rate-delegated) also recorded 1.03 commands per execution, so increasing the grant produced no reduction in that aggregate measure. That comparison changes the configured burst along with the grant size, and the load generator's steady arrivals leave simultaneous spending of held grants across replicas untested.

The dependency-failure comparison in [studies 23 and 24](https://github.com/gkoos/caracal-sandbox/tree/main/case-studies/23-serval-dependency-fault) used published Caracal 0.12.0 in both runs. Each run lasted twenty seconds, with the dependency failing every call from the third second through the ninth. Both configurations used a ten-observation breaker window and a bulkhead limit of five, while the delegated breaker retained a CLOSED verdict for up to five seconds.

| Measurement | Strict | Delegated |
| --- | ---: | ---: |
| Successful client requests | 1,018 | 953 |
| Failed calls recorded by the dependency | 55 | 191 |
| Dependency peak in flight | 5 | 5 |
| Probe-started events | 6 | 6 |
| Client p99 latency | 53 ms | 106 ms |
| Redis commands per execution | 2.25 | 0.35 |

Both breakers returned to CLOSED after the dependency recovered. A cached CLOSED verdict allows a replica to admit work until a reply updates that verdict or its freshness period ends. Retries were enabled in both runs, so the dependency's failure count includes repeated attempts made for the same client execution.

Each table describes one saved run per configuration in a single-machine sandbox. The summaries retain the library version and configuration, and the study files provide the workload settings needed to repeat the comparison.

## Failure behavior and operating limits

The outage studies disconnected each application's Redis client from the fourth second until the 12th, while leaving Redis and its stored state intact. Across the full fifteen-second runs, the strict configuration completed 767 client requests and the delegated configuration completed 884. Both recorded a peak of five calls in flight at the dependency. Delegation allowed replicas to continue using authority they already held, but that authority still expired during the outage, after which they needed Redis before they could resume admitting work.

The breaker in these studies was configured to allow calls when coordination failed. The distributed bulkhead still required a valid allocation, so the breaker's failure policy could not keep the application serving once those allocations expired. A separate run added a local bulkhead with a ceiling of two calls per process. With four processes, that placed an additional limit of eight on their combined locally tracked concurrency, although the measured peak remained five and never exercised that limit. A local ceiling constrains each process while distributed authority remains usable, and it does not extend the allocation's lifetime.

The rate limiter has less authority to carry through an outage because every admission spends a permit. In the delegated rate-outage study, the dependency received 407 calls over fifteen seconds, averaging 27 a second against a configured rate of 100. That average covers the whole run, including the periods before disconnection and after reconnection. The limiter recorded 1,864 admissions for which it could not obtain a coordinator decision, while the bulkhead also refused work during the outage. The result reflects the composed pipeline, with exhausted or expired rate grants preventing further admissions until the issuer became reachable. Adding a local rate limiter would constrain each process's request rate, but it would not replenish the distributed grant.

The amount of coordinator traffic also depends on how authority is consumed. A bulkhead allocation can serve successive calls as slots are released, whereas a rate grant must be replaced after its permits are spent. An issuer refusal can include a retry delay, allowing the replica to reject further calls locally until that delay passes. Requests to replenish stock still require coordination, and those attempts contribute to the rate limiter's higher command count in the preceding results. During the outage, the recording wrapper also counted calls that failed on a disconnected Redis client, so its figures measure coordination attempts rather than commands confirmed to have reached Redis.

The dependency-failure studies exposed a problem in the original probe accounting. The breaker limited probes currently in flight, and settling a probe returned its allowance even when the result supplied no evidence about the dependency. A replica holding a cached HALF_OPEN verdict continued forwarding admission requests to the coordinator. When subsequent policies refused those probes, each inconclusive settlement made room for another, allowing the next request to repeat the process. An early local-build run recorded 512 probe starts with `halfOpenProbes` set to three, and the breaker never returned to CLOSED. The dependency's measured peak concurrency remained five, so that probe count describes repeated admissions over the run.

The shared breaker script now keeps an inconclusive result from restoring the probe allowance for the current recovery window. The allowance is renewed on the configured cooldown, and leased probe tokens can still be reclaimed when their holders disappear. This change affects the strict coordinator as well as the delegated one. The corrected run reported in the preceding section completed recovery with six probe-started events.

A separate failed run exposed a mismatch between the breaker configuration and the observations it received. Its window retained the last hundred outcomes, while the bulkhead rejected much of the offered traffic before a dependency call began. Those policy refusals correctly supplied no evidence about dependency health. With fewer completed calls reaching the breaker during the fault, healthy outcomes from before the failure remained in the window longer, and the breaker did not open during the injected failure. I reduced the study's window to ten observations so that it could respond within that failure interval. The window size needs to reflect how often dependency calls complete after admission control.

## Closing

The experiments led me to keep shared admission authority in Redis and reduce how often replicas need to consult it. This design is available in Caracal as an experimental feature called [Serval](https://github.com/gkoos/caracal/tree/main/docs/serval), whose delegated coordinators use the existing policy interfaces. In the sandbox, reusable bulkhead allocations reduced coordination traffic while keeping admitted throughput close to the strict configuration.

The dependency-failure comparison also shows why command counts alone cannot determine the choice. The delegated configuration sent more failing calls to the dependency while using fewer coordinator commands. Its cached verdict allowed work to continue before the replica learned that the breaker had opened, and the freshness setting controls how long that remains possible. During a coordinator outage, the application can use its remaining authority only until the relevant deadline or budget is exhausted.

I would keep strict coordination where its measured cost is acceptable, while delegation becomes useful when those exchanges consume enough latency or coordinator capacity to justify the additional local state and its failure behavior. Caracal allows that decision to be made separately for each policy, so an application can reuse bulkhead allocations locally while continuing to check the shared breaker on every admission.
