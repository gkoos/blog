---
layout: layouts/post.njk
title: Your Throttling Is Lying to You
date: 2026-03-31
description: "Throttling reduces noisy UI events, but naive implementations can drop the final state. Learn how trailing throttle guarantees correctness for resize, scroll, and high-frequency interactions."
excerpt: "Throttling is a fundamental technique for controlling the frequency of function calls in response to high-frequency events. Like debounce, it's a common tool in the frontend developer's toolkit. At its core, throttling does one thing very well: it limits how often a hot signal can trigger work. That makes it a natural fit for resize handlers, scroll listeners, pointer tracking, analytics hooks, and other high-frequency events. But throttling doesn't just skip events: it can skip the one you need the most."
tags:
- posts
- tutorials
- javascript
---
[Throttling](https://www.geeksforgeeks.org/javascript/javascript-throttling/) is a fundamental technique for controlling the frequency of function calls in response to high-frequency events. Like [debounce](https://www.geeksforgeeks.org/javascript/debouncing-in-javascript/), it's a common tool in the frontend developer's toolkit.

At its core, throttling does one thing very well: it limits how often a hot signal can trigger work. That makes it a natural fit for resize handlers, scroll listeners, pointer tracking, analytics hooks, and other high-frequency events. But throttling doesn't just skip events: it can skip the one you need the most.

A typical implementation looks like this:

```js
function throttle(fn, delay) {
  let lastCall = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      fn.apply(this, args);
    }
  };
}
```

This is usually where we pat ourselves on the back and move on. But throttling has a sharp edge that often shows up later: **when the interaction ends, the final state is not always emitted**. This can lead to stale state in your app, missed analytics data, or just a confusing user experience if you rely on the final event to trigger important updates.

Not because throttling is wrong, but because the default implementation solves only half of the problem. It limits invocation frequency while events are firing, but does not guarantee a trailing invocation after events stop.

If you read [Your Debounce Is Lying to You](https://blog.gaborkoos.com/posts/2026-03-28-Your-Debounce-Is-Lying-to-You/), this is the companion story on the event side: same false sense of safety, different failure mode.

Next, we will reproduce the issue with a minimal resize demo, then fix it with a trailing call so the final state is always captured.

## Problem Setup

Let's keep the demo intentionally simple. We will log `window.innerWidth` and `window.innerHeight` whenever the browser is resized. No framework, no abstractions, just the raw event so we can clearly see what is happening.

Here is the naive version:

```js
window.addEventListener('resize', () => {
  console.log(Date.now(), window.innerWidth, window.innerHeight);
});
```

Let's see what happens when we resize the window quickly:

<video controls width="800" preload="metadata">
	<source src="./screencast1.mp4" type="video/mp4" />
	Your browser does not support the video tag.
</video>

You will immediately see the problem: the handler fires continuously and floods the console. This is exactly the kind of high-frequency event where throttling makes sense. So the motivation is clear: we want to reduce call volume without losing correctness.

## Naive Throttling Implementation

Let's reuse the throttle function from above and wire it to our resize logger with a 500ms interval:

```js
const throttledLog = throttle(() => {
  console.log(Date.now(), window.innerWidth, window.innerHeight);
}, 500);

window.addEventListener('resize', throttledLog);
```

If you run this version and resize quickly, the log volume drops a lot:

<video controls width="800" preload="metadata">
	<source src="./screencast2.mp4" type="video/mp4" />
	Your browser does not support the video tag.
</video>

At first glance, this looks perfect. We skipped noisy intermediate events and reduced work exactly as intended.

But now try this: resize quickly, then stop abruptly, and log the final size:

<video controls width="800" preload="metadata">
  <source src="./screencast3.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

The last console log says the window size is 170x433, but when you look at the actual size, it's 246x437. The final size is never logged!

That happens when your last resize event lands inside the *active throttle interval* (the period between allowed executions). The naive implementation limits calls to at most one per `delay` interval and has no trailing guarantee, so the interaction can end without emitting the final observed value.

Most of the time, however, the final state is the most important one. If you are tracking window size to adjust your layout, you want to know the final dimensions after resizing, not just some intermediate sizes. If you are sending analytics on user interactions, you want to capture the final state of the interaction, not just a sample of it. This is a subtle but critical failure mode that can lead to stale state, missed data, and a broken user experience.

## Improved Solution

The fix is straightforward: keep throttling, but add a *trailing invocation*. That means we still execute at most once per interval during active resizing, and we also schedule a final execution after the burst ends:

```js
function throttleWithTrailing(fn, delay) {
  let lastInvokeTime = 0;
  let timeoutId = null;
  let lastArgs;
  let lastThis;

  const invoke = (time) => {
    lastInvokeTime = time;
    const args = lastArgs;
    const context = lastThis;
    lastArgs = undefined;
    lastThis = undefined;
    fn.apply(context, args);
  };

  const startTimer = (wait) => {
    timeoutId = setTimeout(() => {
      timeoutId = null;
      if (lastArgs) {
        invoke(Date.now());
      }
    }, wait);
  };

  function throttled(...args) {
    const now = Date.now();
    lastArgs = args;
    lastThis = this;
    const remaining = delay - (now - lastInvokeTime);

    if (remaining <= 0) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      invoke(now);
    } else if (!timeoutId) {
      startTimer(remaining);
    }
  }

  throttled.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    lastArgs = undefined;
    lastThis = undefined;
    lastInvokeTime = 0;
  };

  throttled.flush = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (lastArgs) {
      invoke(Date.now());
    }
  };

  return throttled;
}

const throttledLogTrailing = throttleWithTrailing(() => {
  console.log(Date.now(), window.innerWidth, window.innerHeight);
}, 500);

window.addEventListener('resize', throttledLogTrailing);
```

Here we keep track of a timeout for the trailing call, plus the latest arguments and `this` context. If events keep arriving inside the same throttle window, the helper keeps updating that pending payload and runs once on the trailing edge with the newest data. The helper also exposes `cancel()` and `flush()` so callers can drop pending work or force it immediately. In real apps, this is useful during teardown (for example component unmount): call `cancel()` to prevent late side effects, or `flush()` if you must commit the last pending state before cleanup.

Now when you resize quickly and stop, intermediate values are still skipped, and in this pattern the final size is emitted reliably:

<video controls width="800" preload="metadata">
	<source src="./screencast4.mp4" type="video/mp4" />
	Your browser does not support the video tag.
</video>

As you can see, the final size is now correctly logged as 281x381, matching the actual window dimensions. This ensures that we don't miss critical state updates at the end of interactions, while still controlling the frequency of updates during active events.

This pattern is standard in mature utility libraries. For example, [Lodash](https://lodash.com/docs/4.17.15#throttle) `throttle` supports trailing behavior for exactly this reason: frequency control alone is not enough when your correctness depends on the last state.

Note that our implementation is intentionally compact and great for understanding the core trailing-throttle idea, but it's not a full utility library replacement. Mature libraries include additional features and edge-case handling that may be important in production code:
- `leading` and `trailing` configuration flags.
- Input type validation and delay normalization.
- Full return-value semantics.
- Edge-case handling for unusual timer and clock scenarios.

Another solution is to use a debounce instead of throttle, which runs once after events stop. However, that changes behavior during active resizing (no intermediate calls at all), which may not be desirable in all cases. Throttling with a trailing call is a practical compromise: controlled frequency during activity plus a reliable final-state emission.

## Conclusion

Throttling is still the right tool for noisy UI events. The mistake is assuming the default implementation is enough for correctness-sensitive flows. Naive throttling controls frequency, but it can drop the final state. In many real features, that final state is the one you care most about.

The fix is simple and practical: keep throttling, add a trailing call, and treat it as the safe baseline whenever your logic depends on where the interaction ends. So throttling is not lying by design, it only lies when we expect guarantees it never promised.

Throttling controls call frequency, but it doesn't handle what happens when those calls hit an unreliable network or a slow consumer. [Backpressure in JavaScript: The Hidden Force Behind Streams, Fetch, and Async Code](/posts/2026-01-06-Backpressure-in-JavaScript-the-Hidden-Force-Behind-Streams-Fetch-and-Async-Code/) covers what happens when your throttled calls pile up faster than the downstream can handle. For cancelling in-flight requests when a newer throttled call supersedes an older one, see [Cancellation In JavaScript: Why It's Harder Than It Looks](/posts/2025-12-23-Cancellation-In-JavaScript-Why-Its-Harder-Than-It-Looks/). And for production patterns combining these primitives, see [Advanced Asynchronous Patterns in JavaScript](/posts/2026-01-30-Advanced-Asynchronous-Patterns-in-JavaScript/).