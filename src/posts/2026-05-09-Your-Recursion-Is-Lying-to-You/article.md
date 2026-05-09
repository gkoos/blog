---
layout: layouts/post.njk
title: Your Recursion Is Lying to You
date: 2026-05-09
description: "Tail-recursive code in JavaScript still risks stack overflow in real-world runtimes. Learn when recursion is safe and when to switch to iterative patterns."
excerpt: "Recursion in JavaScript can feel elegant and mathematically clean, and tail recursion often sounds like a free optimization. In practice, that assumption breaks quickly: you can still hit stack limits in production even with tail-recursive-looking code. This article shows why that happens and what to do instead."
tags:
- posts
- tutorials
- javascript
---
[Recursion](https://developer.mozilla.org/en-US/docs/Glossary/Recursion) is one of those ideas developers learn early and trust for years. If the recursive step is simple and the base case is correct, the code feels clean and safe.

It is elegant for a reason: many problems are naturally recursive, and the code often mirrors how we explain the logic out loud. For tree walks, nested structures, and divide-and-conquer patterns, recursion can be easier to read than explicit loops.

The catch is physical limits. Even with a correct base case and sound logic, each recursive call still consumes stack space. At some depth, you crash with stack overflow.

If you read [Your Debounce Is Lying to You](/posts/2026-03-28-Your-Debounce-Is-Lying-to-You/) and [Your Throttling Is Lying to You](/posts/2026-03-31-Your-Throttling-Is-Lying-to-You/), this is the recursion version of the same pattern: elegant abstraction, hidden operational edge.

## Problem Setup: Recursion Hits The Wall

You can run everything below directly in a browser console. Let's start simple: a recursive sum of all integers from 1 to n.

```js
function sum(n) {
  if (n === 0) return 0;
  return n + sum(n - 1);
}

sum(10); // 55
```

Now push a big input:

```js
sum(100000); // RangeError or InternalError: too much recursion in most JS runtimes
```

What just happened? The function is logically correct, but each call to `sum` stays on the stack until the one below it returns. At depth 100,000 the runtime runs out of stack space and throws. It has nothing to do with the result being wrong, it is purely a physical limit on how many nested frames the runtime can hold at once.

## The Tail Recursion Rescue Story

The usual next step is [tail call optimization](https://en.wikipedia.org/wiki/Tail_call). The idea is simple: make the recursive call the last thing the function does, so the runtime can reuse the same frame instead of pushing a new one.

Note that `sum` is **not** tail-recursive, even though the recursive call appears on the last line. After `sum(n - 1)` returns, there is still pending work: the result must be added to `n`. **A call is only in tail position when its return value is forwarded immediately, with no pending computation afterward**.

The tail-recursive version moves that pending state into an accumulator:

```js
function sumTR(n, acc = 0) {
  if (n === 0) return acc;
  return sumTR(n - 1, acc + n);
}

sumTR(10); // 55
```

Here `sumTR(...)` is the very last thing that happens — no pending `+`, no pending anything. The running total lives in `acc`, not in waiting stack frames. In theory, a runtime that implements TCO can execute this in constant stack space regardless of depth.

Now repeat the same stress input:

```js
sumTR(100000); // may still throw RangeError!
```

Even with correct tail-recursive structure, many JavaScript runtimes still allocate a new stack frame per call and throw at large depth. This surprises developers who expect TCO to be a universal guarantee. [ECMAScript 2015](https://262.ecma-international.org/6.0/#sec-tail-position-calls) formally specified proper tail calls in strict mode, but most engines never adopted the feature consistently. Some shipped it and then walked it back due to performance regressions. Others never implemented it at all. The result is that you cannot assume tail recursion is stack-safe in production JavaScript, even if the code is correctly structured for TCO.

## A Note on Fibonacci

[Fibonacci](https://en.wikipedia.org/wiki/Fibonacci_number) is the go-to recursion textbook example and it does run into stack limits too, but it carries a second problem that makes it even worse: **exponential time complexity**.

```js
function fib(n) {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}
```

Each call branches into two more calls, so the total number of calls grows as O(2ⁿ). `fib(30)` already makes over a million calls; `fib(50)` is in the tens of billions. In a browser this freezes the tab long before any stack limit is reached, which makes the failure mode look identical to a stack overflow but have a completely different root cause.

The tail-recursive version of Fibonacci:

```js
function fibTR(n, a = 0, b = 1) {
  if (n === 0) return a;
  if (n === 1) return b;
  return fibTR(n - 1, b, a + b);
}
```

This version runs in linear time, but it still risks stack overflow at large `n` due to the same TCO uncertainty. The exponential version is a red herring for this discussion because it fails for a completely different reason: stack overflow and exponential blowup are two separate problems. They look the same from the outside (the page hangs or crashes) but require completely different fixes.

## Runtime Reality (At The Time Of Writing)

At the time of writing (May 2026), proper tail-call optimization support is not something you can count on across JavaScript runtimes.

| Runtime | Engine | Proper Tail Calls You Can Rely On? | Practical Take |
| --- | --- | --- | --- |
| Chrome | V8 | No | Do not expect stack-safe tail recursion. |
| Node.js | V8 | No | Tail-recursive code can still overflow. |
| Deno | V8 | No | Same operational expectation as Node/Chrome. |
| Firefox | SpiderMonkey | No | Do not treat tail recursion as a safety guarantee. |
| Safari | JavaScriptCore | Inconsistent — JSC has shipped and walked back TCO across versions | Do not rely on it; behavior has varied enough across releases that it is not a stable guarantee. |
| Bun | JavaScriptCore-based | Engine-dependent, not a cross-runtime guarantee | Verify on exact version; do not assume universal behavior. |

The key point is portability. Tail recursion is a property of function structure, while stack reuse is a property of runtime implementation. Even if one engine behaves better in one version, production JavaScript usually spans multiple targets, and correctness should not depend on optimizer-specific behavior. A function can be perfectly tail-recursive in shape and still consume stack per call in the environments your users actually run.

## Better Patterns for Production Code

Every recursive function can be rewritten iteratively, and that is usually the safest choice in production when input depth can grow. Iteration does not rely on runtime optimizations for stack safety, because it does not consume stack frames per step. This does not mean giving up the recursive mental model. You can still write code that is conceptually recursive but uses an explicit stack or a *trampoline* to manage control flow without hitting physical limits.

```js
function sumIter(n) {
  let acc = 0;
  for (let i = n; i > 0; i--) acc += i;
  return acc;
}

sumIter(1000000); // no recursive stack growth
```

## The Trampoline Pattern

If you want to keep the recursive structure for readability but need to avoid stack growth, you can use a trampoline: a loop that repeatedly calls a function that returns either a final result or another function to call.

```js
function trampoline(fn) {
  let result = fn;
  while (typeof result === 'function') {
    result = result();
  }
  return result;
}

function sumTrampoline(n, acc = 0) {
  if (n === 0) return acc;
  return () => sumTrampoline(n - 1, acc + n);
}

trampoline(() => sumTrampoline(100000)); // no stack overflow, still tail-recursive in spirit
```

Trampolines trade stack safety for additional function allocations and dispatch overhead, so they are most useful when preserving recursive structure matters more than raw performance.

This approach scales in a way that does not depend on runtime tail-call behavior, which is exactly what you want when input depth can grow. If recursive structure improves readability for a particular problem, these techniques let you keep that mental model with explicit tradeoffs instead of implicit runtime assumptions.

A useful rule of thumb is to keep recursion for small, bounded depths that you control, and **switch to iterative control flow as soon as depth is user-driven, data-driven, or operationally uncertain**. For hot paths, benchmark both styles, but do not base correctness on assumed TCO.

## Practical Checklist

- Never assume TCO in JavaScript for production-critical paths.
- Test with realistic upper bounds, not toy input sizes.
- Favor iterative implementations when depth can grow.
- Treat recursion as a readability tool, not a stack-safety guarantee.

## Conclusion

Recursion itself is not the enemy, unverified runtime assumptions are. Tail-recursive shape does not automatically make JavaScript stack-safe, and that gap is where many "works on my machine" surprises come from in production.

Use recursion where it improves clarity and depth is genuinely bounded. When depth can grow or input is outside your control, prefer iterative designs that make stack behavior explicit and portable.
