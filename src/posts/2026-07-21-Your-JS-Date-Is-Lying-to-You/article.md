---
layout: layouts/post.njk
title: "Your JS Date Is Lying to You"
date: 2026-07-21
description: "The built-in Date API is full of traps: unreliable parsing, mutation, timezone confusion, and broken arithmetic. Here's what it's actually doing, and how Temporal finally fixes it."
excerpt: "Date is one of JavaScript's oldest APIs and one of its most misleading. It lies about parsing, mutation, timezones, arithmetic, and serialization. Not because it is broken, but because it was designed in 1995 in ten days and the web never got a chance to clean it up. This post walks through the traps, explains why each one exists, and shows how the modern Temporal API finally tells the truth."
tags:
- posts
- tutorials
- javascript
- dates
- temporal
- "... is lying to you"
---
*Featured in [TLDR Dev - 2026-07-23](https://tldr.tech/dev/2026-07-23)*

Run this in your browser console:

```js
const d1 = new Date('2026-07-21')
console.log(d1.getDate())
```

If you are in a timezone west of UTC, you will see `20`, not `21`. The string looks unambiguous, but `Date` parsed it as UTC midnight, then `getDate()` converted to your local time and moved the clock back. You asked for July 21st, but got July 20th.

Or try the constructor directly:

```js
const d2 = new Date(2026, 7, 21)
console.log(d2.toDateString()) // "Fri Aug 21 2026"
```

Months are 0-indexed, so `7` is August, not July. You probably asked for July 21st and got August 21st.

And if you needed a reminder that `Date` objects are mutable:

```js
const deadline = new Date('2026-07-21')
deadline.setDate(32)
console.log(deadline) // 2026-08-01
```

No error, just silent rollover.

These are default behavior of the most-used date API in the world, quietly corrupting date logic in production applications for thirty years. `Date` was written in ten days in 1995, modeled closely on the Java `java.util.Date` class (which Java later deprecated). The web grew around it, frameworks worked around it, and the traps became invisible because everyone assumed the API made sense.

This post works through the main ways `Date` misleads you - parsing, mutation, timezones, arithmetic, and serialization - and shows how the `Temporal` API, now available in most modern runtimes, fixes each one. Along the way, it also covers safe patterns for code that is still stuck on `Date` and cannot migrate yet.

## Parsing Is Unreliable

The [ECMAScript spec](https://tc39.es/ecma262/#sec-date-time-string-format) says `new Date(string)` must support one format: ISO 8601 date-time strings like `"2026-07-21T12:00:00Z"`, everything else is implementation-defined. In practice every engine accepts a wide range of informal strings — `"July 21, 2026"`, `"21/07/2026"`, `"07-21-2026"`, but they don't agree on all of them, and the spec does not require them to.

That sounds like an edge case until you hit the most common one: a plain date string.

```js
console.log(new Date('2026-07-21'))   // parsed as UTC midnight
console.log(new Date('2026/07/21'))   // parsed as local midnight (or Invalid Date in some engines)
console.log(new Date('July 21 2026')) // parsed as local midnight
```

The ISO date-only format `YYYY-MM-DD` is treated as UTC by the spec. All other date strings are treated as local time, if they parse at all. So two strings that look functionally identical to a human can produce timestamps twelve hours apart depending on which separator you happened to use. The first one will shift dates when you call `getDate()`, `getMonth()`, or any other local-time method while the user is outside UTC. The second may throw `Invalid Date` in one runtime and succeed in another.

Another footgun: `Date()` and `new Date()` do not do the same thing.

```js
console.log(Date('2026-07-21'))      // current date-time string, input ignored
console.log(new Date('2026-07-21'))  // parsed Date object: eg. Tue Jul 21 2026 01:00:00 GMT+0100 (British Summer Time)
```

Forgetting `new` changes the operation from parsing to formatting "now", which can quietly invalidate tests and debugging output.

`Invalid Date` is its own problem. `Date` does not throw on a bad string:

```js
const d = new Date('not a date')
console.log(d)           // Invalid Date
console.log(isNaN(d))    // true
```

The object is constructed. It breaks later, silently, when you try to use the value - typically as a `NaN` that propagates through arithmetic, or as the string `"Invalid Date"` that ends up stored in a database or sent to an API.

This is why nearly every production codebase that deals seriously with dates ends up reaching for a library. [date-fns](https://date-fns.org/), [dayjs](https://day.js.org/), and [luxon](https://moment.github.io/luxon/) all provide strict parsing functions that throw explicitly when a string does not match the expected format. That behavior is what `Date` should have had from the start.

[`Temporal`](https://tc39.es/proposal-temporal/) is JavaScript's next-generation built-in date and time API (`Temporal.*`), designed to replace the sharp edges of `Date`. At the time of writing, its normative text is still maintained in the proposal repository while final ECMA-262 publication catches up, but engines and polyfills can still implement it because the Stage 4 semantics are already fixed. `Temporal.PlainDate.from('2026-07-21')` parses one format and always means a calendar date with no timezone involved. `Temporal.Instant.from('2026-07-21T00:00:00Z')` requires an explicit UTC offset. Ambiguous input becomes a parse error instead of a silent timezone shift.

For the next sections, we stay on `Date` because most existing codebases still run on it, and these bugs are where production incidents usually happen. `Temporal` appears as a reference model for safer semantics, not as an assumption that every project can migrate immediately.

## 0-Based Months and Mutation Break Assumptions

Even when you construct a `Date` correctly, month indexing and mutation rules still create production bugs.

As shown in the intro example (`new Date(2026, 7, 21)`), constructor month values are 0-based, so `7` means August, creating round-trip errors:

```js
function toApiDateParts(d) {
	return {
		year: d.getFullYear(),
		month: d.getMonth(), // returns 0..11
		day: d.getDate()
	}
}

console.log(toApiDateParts(new Date('2026-12-15T00:00:00Z')))
// { year: 2026, month: 11, day: 15 }
```

If another service expects `month: 12`, your December data is now November data.

Mutation makes this worse because helper functions can modify caller-owned values without signaling it:

```js
function addBusinessDays(date, days) {
	// Mutates input object
	date.setDate(date.getDate() + days)
	return date
}

const invoiceDate = new Date('2026-07-21T00:00:00Z')
const dueDate = addBusinessDays(invoiceDate, 14)

console.log(invoiceDate.toISOString()) // 2026-08-04T00:00:00.000Z
console.log(dueDate.toISOString())     // 2026-08-04T00:00:00.000Z
```

Many teams discover this only after seeing audit fields or cache keys "randomly" drift.

Overflow normalization adds another hidden branch to your logic:

```js
const renewal = new Date('2026-01-31T00:00:00Z')
renewal.setMonth(renewal.getMonth() + 1)

console.log(renewal.toISOString())
// 2026-03-03T00:00:00.000Z
```

Your intent was "next month", the runtime result is "plus a month, then normalize invalid day". That can be acceptable for some domains and disastrous for billing, compliance, or reporting.

Normalization also applies to constructor parts, including negative and zero values:

```js
console.log(new Date(2026, -1, 1).toISOString()) // 2025-12-01T00:00:00.000Z
console.log(new Date(2026, 1, 0).toISOString())  // 2026-01-31T00:00:00.000Z
```

This behavior is sometimes useful for date arithmetic, but dangerous when accidental.

`Temporal` addresses all three pain points directly: clearer type boundaries, one-based calendar fields in `PlainDate`, and immutable operations that return new values.

```js
const invoiceDate = Temporal.PlainDate.from('2026-07-21')
const dueDate = invoiceDate.add({ days: 14 })

console.log(invoiceDate.toString()) // 2026-07-21
console.log(dueDate.toString())     // 2026-08-04
```

The original value stays unchanged, and the intent is visible in the code.

## Timezones and DST Turn Simple Logic Into Incidents

`Date` stores an instant (milliseconds since Unix epoch, UTC), but most everyday methods (`getHours`, `getDate`, `toString`) project that instant into the host machine's local timezone. Bugs appear when code mixes UTC and local operations without noticing.

```js
const d = new Date('2026-07-21T00:30:00Z')

console.log(d.toISOString()) // 2026-07-21T00:30:00.000Z
console.log(d.getUTCDate())  // 21
console.log(d.getDate())     // may be 20 in timezones west of UTC
```

Same instant, different calendar day, depending on which getter you call. This is a common source of "off by one day" bugs in reports and date filters.

DST adds another layer. In DST-observing timezones, some local days are 23 hours and some are 25.

```js
// Example outcome in America/New_York around spring-forward transition
const start = new Date('2026-03-08T00:00:00-05:00')
const end = new Date('2026-03-09T00:00:00-04:00')

console.log((end - start) / (1000 * 60 * 60))
// 23
```

If billing, rate limits, retention windows, or SLAs assume every local day is 24 hours, these transitions produce subtle data drift.

Serialization makes the confusion travel between systems:

```js
const d = new Date('2026-07-21T15:00:00-04:00')

console.log(d.toString())     // local representation
console.log(d.toISOString())  // UTC representation
console.log(JSON.stringify(d)) // same as ISO string
```

`JSON.stringify` always emits UTC ISO strings. If another service later interprets that value as a local wall-clock time, the original timezone intent is gone.

This is why `Date` cannot preserve input timezone intent. It stores an instant, not a "timezoneful" local timestamp. For example:

```js
const d = new Date('2000-01-01T00:00:00+20:00')
console.log(d.getTimezoneOffset())
// your machine's local offset, not +20:00
```

The `+20:00` changed how the input was interpreted into an instant, but that offset is not retained as date object metadata.

Form controls add another sharp edge. When `valueAsDate` is supported and populated for `<input type="date">` and `<input type="time">`, it follows UTC-oriented semantics, which often surprises teams expecting local wall-clock behavior.

Safe `Date` rule for distributed systems: persist and transmit instants in UTC (`toISOString()`), then attach an explicit IANA timezone (`America/New_York`, `Europe/Berlin`) when you need calendar semantics.

`Temporal` splits these concepts into different types so mistakes are harder to make:

- `Temporal.Instant` for machine time points
- `Temporal.ZonedDateTime` for timezone-aware calendar math
- `Temporal.PlainDate` for date-only values with no timezone

That type separation removes a large class of local-vs-UTC mix-ups that `Date` makes easy.

## Arithmetic and Duration Logic Are Fragile by Default

`Date` has no first-class duration type, so most code falls back to raw millisecond math:

```js
const msPerDay = 24 * 60 * 60 * 1000
const expiresAt = new Date(start.getTime() + 30 * msPerDay)
```

That looks harmless, but it bakes in assumptions that are often false in local-time workflows (DST days are not always 24 hours) and hard to audit in business logic.

Calendar arithmetic is where these shortcuts break fastest. "Add one month" is not equivalent to "add 30 days" and can diverge by several days around month boundaries.

```js
const jan31 = new Date('2026-01-31T00:00:00Z')

const plus30Days = new Date(jan31.getTime() + 30 * 24 * 60 * 60 * 1000)
const plus1Month = new Date(jan31)
plus1Month.setUTCMonth(plus1Month.getUTCMonth() + 1)

console.log(plus30Days.toISOString()) // 2026-03-02T00:00:00.000Z
console.log(plus1Month.toISOString()) // 2026-03-03T00:00:00.000Z
```

Both are "reasonable" operations. Neither means the same thing. If your domain says "next billing month", milliseconds are the wrong unit.

Even simple comparisons can blur intent when everything is expressed as numbers:

```js
const ageMs = Date.now() - createdAt.getTime()
if (ageMs > 90 * 24 * 60 * 60 * 1000) {
	archive(record)
}
```

This mixes machine-time thresholds with calendar expectations. Around DST and timezone conversions, teams start seeing records archived earlier or later than product owners expect.

Safe `Date` pattern when migration is not possible:

- use UTC for machine-time durations (timeouts, TTLs, retry backoff)
- use explicit calendar logic for date-based rules (monthly renewals, "same day next month")
- centralize date math helpers and test them against DST and month-end cases

`Temporal` makes this separation explicit by giving you dedicated types for both instants and durations:

```js
const start = Temporal.ZonedDateTime.from('2026-01-31T00:00:00+00:00[UTC]')

const nextMonth = start.add({ months: 1 })
const plus30Days = start.add({ days: 30 })

console.log(nextMonth.toString()) // 2026-02-28T00:00:00+00:00[UTC]
console.log(plus30Days.toString()) // 2026-03-02T00:00:00+00:00[UTC]
```

The code now states intent directly: calendar month arithmetic versus day-count arithmetic.

## Serialization and Storage Quietly Drop Intent

By the time a date leaves your process, the hardest problem is no longer parsing but preserving meaning across boundaries. With `Date`, the value carries an instant, but many business workflows care about local calendar intent: "run at 9:00 in Berlin," "invoice date is July 21 in tenant timezone," or "daily reset at local midnight."

A plain JSON round-trip often erases that intent:

```js
const payload = {
	scheduledAt: new Date('2026-07-21T09:00:00-04:00')
}

const json = JSON.stringify(payload)
console.log(json)
// {"scheduledAt":"2026-07-21T13:00:00.000Z"}
```

The offset `-04:00` is gone. You still have the same instant, but not the original wall-clock context.

The same issue shows up in storage layers:

```js
localStorage.setItem('dueDate', JSON.stringify(new Date('2026-07-21')))

const raw = localStorage.getItem('dueDate')
const loaded = new Date(JSON.parse(raw))

console.log(loaded.toString())
// rendered in current machine timezone, which may differ from where it was created
```

Move the data between regions, or open it on a laptop with a different timezone, and "same date" features start drifting by hours or even by a day.

API contracts can amplify this drift when they mix ambiguous field names and inconsistent semantics:

- `createdAt`: instant in UTC
- `businessDate`: calendar date in tenant timezone
- `runAt`: local wall-clock time tied to a specific IANA zone

If all three are serialized as plain ISO strings without explicit schema rules, bugs are guaranteed.

Safe transport pattern with `Date`:

- for instants, send UTC ISO strings (`toISOString()`)
- for calendar dates, send date-only strings (`YYYY-MM-DD`) as plain data, not `Date` objects
- for local-time schedules, send both local time and timezone id (`Europe/Berlin`)
- validate and normalize at service boundaries, not deep inside business logic

`Temporal` maps cleanly to this contract style:

- `Temporal.Instant` for UTC machine timestamps
- `Temporal.PlainDate` for date-only business fields
- `Temporal.ZonedDateTime` when timezone and wall-clock semantics must survive round-trips

Serialization stops being a guessing game once the type matches the meaning.

## Temporal in Real Projects: Adoption Without a Big-Bang Rewrite

As `Temporal` seems to address many of the shortcomings of `Date`, at this point the natural question is: should you replace every `Date` right now?

Usually, no.

Most teams need a mixed model for a while:

- keep `Date` at interop edges that require it (legacy APIs, third-party SDKs, older libraries)
- use `Temporal` for new domain logic where correctness matters
- convert explicitly at boundaries instead of letting values drift implicitly

That incremental approach avoids the riskiest migration pattern: touching every timestamp in the codebase at once.

A practical rollout plan:

1. Identify high-cost date paths first: billing cycles, reporting windows, retention policies, scheduling.
2. Introduce small date utilities that expose intent (`toBusinessDate`, `toUtcInstant`, `nextBillingDate`).
3. Implement those utilities with `Temporal` internally.
4. Keep adapters for `Date` at API/database boundaries until dependent systems are updated.
5. Add tests for DST transitions, month-end rollover, and timezone conversion invariants.

Interop is straightforward when done explicitly:

```js
const sourceDate = new Date('2026-07-21T00:00:00.000Z')

// Date -> Temporal
const instant = Temporal.Instant.fromEpochMilliseconds(sourceDate.getTime())

// Temporal -> Date
const roundTripDate = new Date(instant.epochMilliseconds)

console.log(instant.toString())
console.log(roundTripDate.toISOString())
```

For environments that do not yet provide native `Temporal`, use one of the [polyfills](https://www.npmjs.com/package/@js-temporal/polyfill) and keep the same API surface. That lets you standardize semantics now and remove polyfill wiring later. If bundle size is a concern, evaluate lighter alternatives and only ship the parts you need. In many apps this cost is still preferable to recurring production date bugs.

Choose the model that matches the boundary and the risk profile:

- `Date` remains a compatibility type.
- `Temporal` becomes your correctness type.

Defining those roles explicitly makes date logic simpler, safer, and easier to review.

## Practical Rules for Date Code You Still Have to Maintain

Many teams cannot switch everything to `Temporal` in one quarter. If your codebase still uses `Date` heavily, enforce a few hard rules and date bugs drop quickly.

1. Ban ambiguous parsing.
Only accept strict input formats. Parse `YYYY-MM-DD` as a calendar date value, and parse instants with full ISO date-time plus explicit offsets (`Z` or `+/-HH:mm`). Reject everything else.

2. Separate instant fields from calendar fields in your schema.
Use names that encode semantics, such as `createdAtUtc`, `businessDate`, `localRunTime`, and `timeZoneId`.

3. Keep UTC for transport and storage.
Persist instants as ISO UTC strings, and store timezone identifiers separately when wall-clock behavior matters.

4. Never mutate a shared `Date` instance.
Clone before modification in helper functions:

```js
function addDaysImmutable(date, days) {
	const next = new Date(date)
	next.setUTCDate(next.getUTCDate() + days)
	return next
}
```

5. Centralize date math.
Put all date arithmetic in one module with tests for DST boundaries, month-end rollover, leap years, and timezone conversions.

6. Test with multiple timezones in CI.
Run the same test suite at least in `UTC` and one DST-observing timezone. Many bugs only appear outside your local developer setup.

7. Log both machine and calendar context in critical flows.
When debugging production incidents, log the instant, timezone id, and derived local date/time used in business decisions.

These rules are boring by design. Boring date handling is what prevents expensive production surprises.

## Conclusion

`Date` survives because it is everywhere, not because it is safe (or even correct) by default. It mixes parsing ambiguity, mutable state, timezone projection, and normalization rules into one API, then asks application code to keep all of that straight under production load. `Temporal` fixes most of the pain by separating concerns, enforcing immutability, and providing explicit types for instants, calendar dates, and timezone-aware schedules. So the latter is the right choice for new code, and the former is a compatibility type that should be isolated behind adapters, and eventually retired.

You do not need a full rewrite tomorrow, you need explicit semantics today.

- treat instants, calendar dates, and timezone-aware schedules as different data types
- enforce strict parsing and boundary validation
- isolate legacy `Date` usage behind adapters
- move high-risk business logic to `Temporal` as you touch it

That approach works in real teams, with real constraints. It reduces incident risk immediately and creates a clear path away from the sharp edges of `Date`.

If you think you have mastered `Date`, try the excellent (unaffiliated) quiz at [https://jsdate.wtf/](https://jsdate.wtf/). You might be in for a surprise 😄
---

Dates are not the only things lying to you in JavaScript. Other posts in the series:

- [Your Debounce Is Lying to You](/posts/2026-03-28-Your-Debounce-Is-Lying-to-You/)
- [Your Throttling Is Lying to You](/posts/2026-03-31-Your-Throttling-Is-Lying-to-You/)
- [Your HTTP Client Is Lying to You](/posts/2026-04-19-Your-HTTP-Client-Is-Lying-to-You/)
- [Your Recursion Is Lying to You](/posts/2026-05-09-Your-Recursion-Is-Lying-to-You/)
- [Your Package Manager Is Lying to You](/posts/2026-06-11-Your-Package-Manager-Is-Lying-to-You/)
- [Your console.log Is Lying to You](/posts/2026-06-28-Your-Console-Is-Lying-to_You/)
