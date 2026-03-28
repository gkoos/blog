---
layout: layouts/post.njk
title: "Modern JavaScript Concurrency"
date: 2025-10-25
description: "Explore the concurrency model of modern JavaScript, including the event loop, async/await, and more."
excerpt: "When most developers think of JavaScript, the word single-threaded often comes to mind. But modern JS runtimes are far more sophisticated than the old 'one thread, one call stack' stereotype. From the event loop and async/await to Web Workers, async iterators, and SharedArrayBuffers, today's JavaScript offers a rich (although muddled) concurrency landscape: one that spans browsers, Node.js / Bun / Deno, and edge environments."
tags:
- posts
- javascript
- typescript
---
When most developers think of JavaScript, the word "*single-threaded*" often comes to mind. But modern JS runtimes are far more sophisticated than the old "one thread, one call stack" stereotype. From the event loop and async/await to Web Workers, async iterators, and SharedArrayBuffers, today's JavaScript offers a rich (although muddled) concurrency landscape: one that spans browsers, Node.js / Bun / Deno, and edge environments.

Understanding how these layers of concurrency interact is essential for building responsive UIs, scalable backends, and reliable serverless functions. In this article, we'll break down the concurrency primitives and patterns available in modern JavaScript, show how they actually work, and show how to leverage them safely and effectively.

## The Myth of Single-Threaded JavaScript

In a sense, JS *is* single-threaded: **each execution context runs on a single call stack**. An execution context is created for each script, function, or module, and it has its own stack where function calls are pushed and popped.

But this label can be misleading. Modern JavaScript runtimes support multiple forms of concurrency, enabling asynchronous and even parallel operations without blocking the main thread.

At the heart of JS concurrency is the **event loop**, which schedules and executes tasks cooperatively. Tasks are picked from the **macrotask queue** (timers, I/O callbacks, setTimeout) and **microtask queue** (promises, queueMicrotask) in a well-defined order. This mechanism allows JavaScript to perform asynchronous work while maintaining a single-threaded execution model.

Example:

```js
console.log(1);
setTimeout(() => console.log(2));
Promise.resolve().then(() => console.log(3));
console.log(4);

// Output: 1, 4, 3, 2
```

In this snippet:

- `console.log(1)` and `console.log(4)` run immediately on the main stack.
- The promise microtask executes next (3) before the macrotask from `setTimeout` (2).

### Key takeaway 

JavaScript concurrency is **cooperative**, not parallel by default. Even though the runtime handles multiple pending operations, only one piece of JavaScript executes at a time in a given context.

## The Event Loop as the Core Concurrency Engine

The event loop manages concurrency in JavaScript. Instead of thinking in terms of threads, it's easier to view it as a **task scheduler** that coordinates asynchronous operations while the main thread executes one piece of code at a time.

### How the Event Loop Schedules Work

- The loop maintains multiple queues for pending operations, including timers, I/O callbacks, and promise reactions.
- Microtasks (promise callbacks) are always processed before the next macrotask, ensuring predictable sequencing for chained async operations.
- Long-running synchronous tasks block the loop, preventing pending tasks from executing. Understanding this behavior is key to keeping UIs responsive and servers efficient.

### Runtime Nuances

- **Browser**: The event loop integrates with the rendering engine. Layout recalculation, repaints, and input events are scheduled alongside JavaScript tasks. Blocking the loop can cause jank or frozen UI.
- **Node.js**: Uses libuv, which combines the event loop with a thread pool for non-blocking I/O and file system operations. Heavy computations on the main thread still block incoming requests.
- **Deno/Bun**: Similar to Node.js but with different performance characteristics and built-in TypeScript support. They also use libuv under the hood.
- **Edge runtimes**: Typically spin up isolated event loop instances per request. Concurrency at scale comes from running many event loops in parallel across instances rather than threads.

### Practical Takeaways

- **Avoid blocking synchronous code**: offload heavy work to workers or external processes.
- **Design code around predictable scheduling**: promise chains, async iteration, and event-driven streams can help structure work without blocking.
- Be aware that **microtask-heavy code can starve timers**, delaying scheduled callbacks.

## Beyond the Event Loop: Using Workers

While the event loop enables concurrency within a single thread, true parallelism in JavaScript requires *workers*. Workers run in separate execution contexts, allowing code to execute on multiple threads simultaneously without blocking the main thread.

### Types of Workers

- **Web Workers (browser)**: Designed for CPU-intensive tasks that would otherwise block the UI thread. Each worker runs in its own global scope (self) and cannot directly access the DOM or main-thread variables. Communication is done via `postMessage` and events. Typical use cases include image processing, data crunching, encryption, or other complex computations in web apps. Workers are created with `new Worker(url)` and can be terminated with `.terminate()` or automatically when the main page closes.
- **Worker Threads (Node.js/Deno/Bun)**: Provide a similar model for CPU-bound tasks using isolated memory and message passing. Unlike Web Workers, these can share memory via `SharedArrayBuffer` and `Atomics`. Use cases include backend-heavy computations, streaming compression, data transformations, or parallelizing tasks across CPU cores. Created via `new Worker(filePath, options)` and terminated with `.terminate()` or exit automatically when work completes.
- **Edge environment workers**: Found in Cloudflare Workers, Deno Deploy, or Vercel Edge Functions. They use lightweight isolates instead of full OS threads. Each request runs in a separate isolate, providing parallelism across requests rather than within a single thread. Communication between isolates is limited, and persistent state is usually stored externally. Ideal for serverless request handling, high-volume HTTP traffic, or isolating untrusted code.

### Communication

Workers do not share memory by default. They communicate through message passing using `postMessage` and events. For more advanced use cases, `SharedArrayBuffer` and `Atomics` allow shared memory, but careful synchronization is required.

### Example: Using a Web Worker

```js
// main.js
const worker = new Worker('worker.js');
worker.onmessage = (e) => console.log('Worker says:', e.data);
worker.postMessage('ping');

// worker.js
self.onmessage = (e) => {
  self.postMessage(e.data + ' pong');
};
```

This will log `Worker says: ping pong`.

### Practical Implications

- Offload heavy computations to workers to keep UIs responsive.
- Workers are ideal for CPU-bound tasks, image processing, cryptography, or large dataset transformations.
- Communication overhead exists: passing large objects frequently can reduce performance.
- Use message-passing patterns to structure concurrency cleanly and avoid race conditions.

### Key takeaway

- Workers enable true parallelism in JavaScript, complementing the event loop's cooperative concurrency. They are explicit and isolated, making them powerful tools for scalable and responsive applications.

## Async Iterators: Structured Concurrency for Streams

While workers enable parallelism, not all concurrency requires multiple threads. Modern JavaScript provides *async iterators* as a way to handle ongoing asynchronous streams of data in a structured and predictable way. They let you consume asynchronous data **incrementally**, rather than waiting for the entire dataset or stream to be ready.

### How Async Iterators Work

An async iterator implements the `Symbol.asyncIterator` method and exposes a `next()` method that returns a promise. You can use `for await...of` loops to consume values as they become available. This pattern is particularly useful for streaming APIs, event processing, or any scenario where data arrives over time.

Example:

```js
async function* streamData() {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 100));
    yield i;
  }
}

(async () => {
  for await (const value of streamData()) {
    console.log(value);
  }
})();
// Output: 0, 1, 2
```

In this example, each value is produced asynchronously and consumed one by one without blocking the main thread.

### Use Cases

- **Streaming APIs**: Reading data from `fetch().body` or other streams incrementally.
- **Event-driven systems**: Processing user input, WebSocket messages, or sensor data as they arrive.
- **Backpressure handling**: Async iterators allow consuming data at your own pace, preventing resource overload.

### Practical Implications

- Async iterators offer structured concurrency, letting you write sequential-style code for asynchronous streams.
- They work seamlessly with promises, allowing smooth integration with the rest of your async code.
- Combining async iterators with `AbortController` or cancellation patterns enables better control over long-running streams.
- Unlike workers, they don't provide parallelism but allow controlled, non-blocking handling of asynchronous sequences.

### Key takeaway

- Async iterators provide a clear, structured way to handle streams of asynchronous data, making complex concurrency patterns easier to reason about while keeping code readable and non-blocking.

## Shared Memory and Atomics

For scenarios where multiple threads or workers need to **coordinate and share data directly**, JavaScript provides `SharedArrayBuffer` and `Atomics`. Unlike message-passing between workers, this allows threads to access the same memory space, enabling **true shared-memory parallelism**.

### How Shared Memory Works

A `SharedArrayBuffer` is a special type of buffer that can be accessed by multiple workers simultaneously. To avoid race conditions, the `Atomics` API provides methods for atomic operations like read, write, add, and compare-and-swap, ensuring that operations on shared memory are executed safely.

Example:

```js
// main.js
const sharedBuffer = new SharedArrayBuffer(4);
const counter = new Int32Array(sharedBuffer);

// Create two workers
const worker1 = new Worker('worker.js');
const worker2 = new Worker('worker.js');

// Send the shared buffer to both workers
worker1.postMessage(sharedBuffer);
worker2.postMessage(sharedBuffer);

worker1.onmessage = worker2.onmessage = () => {
  console.log('Final counter value:', Atomics.load(counter, 0));
};


// worker.js
self.onmessage = (e) => {
  const counter = new Int32Array(e.data);

  // Each worker increments the counter 1,000 times
  for (let i = 0; i < 1000; i++) {
    Atomics.add(counter, 0, 1);
  }

  self.postMessage('done');
};

// Output: Final counter value: 2000
```

Without `Atomics`, concurrent reads and writes could overwrite each other, causing inconsistent or unpredictable results. After both workers complete, the counter reliably shows 2000, demonstrating **true concurrent updates**.

### Use Cases

- **Worker coordination**: Workers can signal each other or track progress using shared memory and atomic operations, avoiding the overhead of message passing. For example, one worker can set a flag or increment a shared counter, and another worker can respond accordingly.
- **Performance-critical computations**: Shared memory enables fine-grained parallel algorithms, such as counting, accumulation, or simulations, where multiple threads need fast, synchronized access to the same data.
- **WebAssembly parallelism**: High-performance multi-threaded code in the browser or Node.js can use SharedArrayBuffer and Atomics to coordinate threads safely.
- **Low-latency signaling**: Atomic operations combined with Atomics.wait and Atomics.notify allow threads to efficiently wait for or signal events, which is useful in scenarios where timing and responsiveness are critical.

### Practical Implications

- Shared memory introduces the risk of race conditions, so careful design is essential.
- Often, message passing is sufficient and simpler for most applications. Use `SharedArrayBuffer` only when performance requirements justify the complexity.
- Combined with workers, `SharedArrayBuffer` enables high-performance concurrent algorithms that cannot be achieved with the event loop alone.

### Key takeaway

- Shared memory and Atomics provide low-level, thread-safe access to memory across workers, enabling true parallelism for performance-critical tasks, but **they require careful handling to avoid concurrency pitfalls**.

## Concurrency Across Runtimes

JavaScript's concurrency model behaves slightly differently depending on the runtime. Understanding these differences is crucial for writing efficient, non-blocking, and parallel code across browsers, server environments, and edge platforms.

### Browsers

- The event loop is **tightly integrated with the rendering engine**. Layout recalculation, painting, and user input events are coordinated alongside JavaScript tasks.
- Web Workers provide parallelism for CPU-bound tasks but **cannot access the DOM directly**.
- Streaming APIs and async iterators allow non-blocking handling of data from network requests, file reads, or media streams.
- Shared memory with `SharedArrayBuffer` and `Atomics` enables low-latency coordination between workers, but **must be used carefully to avoid race conditions**.

### Node.js, Deno, Bun

- Node.js, Deno, and Bun use `libuv` to implement the event loop and a thread pool for async I/O, allowing concurrency for network and file operations without blocking the main thread.
- Worker threads provide true parallelism for CPU-intensive tasks, with optional shared memory via `SharedArrayBuffer`.
- Async iterators, streams, and event-driven patterns let you process data incrementally without blocking the event loop.
- Node-specific APIs (like `fs.promises` or `net`) are **integrated with the event loop** for scalable I/O operations.

### Edge Environments

- Edge runtimes, such as *Cloudflare Workers*, *Deno Deploy*, and *Vercel Edge Functions*, often **run each request in isolated event loop instances**.
- Parallelism comes from **horizontal scaling** (handling many requests simultaneously) rather than multiple threads per instance.
- Workers are sometimes supported via lightweight isolates, but **shared memory is limited or unavailable**.
- These runtimes prioritize low-latency, stateless execution, and predictable concurrency patterns over full-threaded parallelism.

### Practical Takeaways

- Choose concurrency patterns based on the runtime and workload: use workers for parallel computation, streams and async iterators for incremental I/O, and shared memory for fine-grained coordination.
- Async iterators and streams are **universally useful** for non-blocking processing of data regardless of the environment.
- Shared memory is powerful but should be reserved for scenarios requiring high-performance coordination between threads.
- Always **consider runtime-specific constraints** (DOM access, I/O behavior, horizontal scaling) when designing concurrent systems.

### Key takeaway

- While the core concurrency primitives - event loop, workers, async iterators, and shared memory - are consistent across JavaScript runtimes, the practical application and limitations differ, and choosing the right pattern depends on your environment and workload.

## Structured Concurrency: The Missing Abstraction

Despite the rich set of concurrency primitives in JavaScript, managing multiple async tasks safely and predictably remains challenging. Developers often rely on patterns like `Promise.all()`, `AbortController`, or manual cleanup to coordinate related tasks, but these approaches can be error-prone and hard to reason about.

Structured concurrency is a concept being explored by TC39 via the [JavaScript Concurrency Control Proposal](https://github.com/tc39/proposal-concurrency-control), aiming to provide:

- **Predictable lifetimes for async tasks**: Tasks are automatically canceled or cleaned up when their parent scope completes.
- **Easier cancellation and cleanup**: No more dangling promises or orphaned async operations.
- **Simplified reasoning about async flows**: Tasks are grouped hierarchically, making it clear which operations are related and when they finish.

While still a proposal, structured concurrency represents a promising direction for making JavaScript concurrency safer and more manageable in the future.

### Key takeaway

- Structured concurrency aims to make task lifetimes explicit and predictable, reducing bugs and making async code execution easier to follow, especially as applications scale.

## Determinism, Testing, and Debugging

Asynchronous and concurrent code introduces ordering and timing issues that can make bugs hard to reproduce. Even if your tasks aren't truly parallel, the cooperative nature of JavaScript concurrency means that the **sequence in which async operations complete can affect program behavior**.

### Common Challenges

- **Unawaited promises**: Forgetting to await a promise can cause silent failures or race conditions.
- **Hidden async triggers**: Some operations (timers, network requests, event listeners) may fire unexpectedly, impacting test reliability.
- **Non-deterministic ordering**: The interleaving of microtasks and macrotasks can lead to inconsistent behavior if not handled carefully.

### Tools and Patterns for Predictable Testing

- **Virtual clocks / Fake timers**: Libraries like [Jest's fake timers](https://jestjs.io/docs/timer-mocks) or [Sinon](https://sinonjs.org/) allow you to control `setTimeout`, `setInterval`, and other asynchronous scheduling, making tests deterministic.
- **Deterministic queues**: Some test frameworks let you simulate or control the order of task execution for promises and async iterators.
- **Explicit cleanup**: Always cancel timers, subscriptions, and workers in afterEach blocks to avoid cross-test interference.
- **Structured testing of concurrency**: Even when code isn't parallel, testing async logic is effectively testing concurrency behavior, ensuring proper sequencing, error handling, and cancellation.

### Practical Implications

- Tests should focus on **observable behavior and expected sequences rather than exact timing**.
- **Avoid relying on implicit ordering of async tasks**. Prefer `await`, `Promise.all`, or controlled streams to ensure determinism.
- Use **tools to simulate and fast-forward asynchronous events**, reducing flakiness and making bugs reproducible.

### Key takeaway

- Testing async code is fundamentally about **controlling and observing concurrency behavior**. Proper tooling and patterns make your tests reliable and your concurrent code easier to debug.

## The Future of JS Concurrency

JavaScript concurrency continues to evolve. New proposals, runtime improvements, and edge-focused patterns are shaping how developers will write async and parallel code in the coming years.

### Emerging Trends

- **Better worker ergonomics**: Proposals for module workers and more integrated worker APIs aim to simplify creating and managing threads across environments.
- **Shared memory evolution**: Improvements to SharedArrayBuffer and Atomics may provide safer, higher-level abstractions for parallel computation.
- **Structured concurrency proposals**: TC39’s TaskGroup / Concurrency Control proposals promise predictable task lifetimes, hierarchical scoping, and easier cancellation patterns.
- **Edge-native concurrency models**: Serverless and edge runtimes increasingly rely on horizontal scaling, lightweight isolates, and request-level parallelism, pushing developers toward patterns that exploit concurrency without traditional threads.

### Practical Outlook

- Modern JavaScript concurrency is **cooperative and explicit**, requiring careful design to avoid blocking the event loop or introducing race conditions.
- Developers will likely see higher-level abstractions that make workers, async iterators, and shared memory easier to use safely.
- Edge-first and distributed applications will continue to shape how concurrency patterns are applied, emphasizing **scalable, non-blocking, and predictable behavior**.

## Closing Thought

Modern JavaScript concurrency is powerful but demands understanding. Between the event loop, workers, async iterators, shared memory, and emerging structured concurrency, developers have a rich toolkit, but must choose the right primitives for the right workload. The future promises safer, more ergonomic, and more predictable concurrency, making JavaScript a robust environment for both UI and backend parallelism.

Explore structured concurrency proposals, try out worker patterns in your projects, and experiment with async iterators to get hands-on experience with modern JavaScript concurrency.