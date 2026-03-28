---
layout: layouts/post.njk
title: "Go Channels: A Runtime Internals Deep Dive"
date: 2025-08-26
description: A deep-dive into Go's channel internals.
excerpt: "Go channels are one of the language's signature features. They provide a structured way for goroutines to communicate and coordinate. Instead of manually sharing memory and managing locks, channels let goroutines send and receive values directly, ensuring that data is transferred correctly and synchronization is handled automatically."
tags:
- posts
- tutorials
- golang
- concurrency
---
Go channels are one of the language's signature features. They provide a structured way for goroutines to communicate and coordinate. Instead of manually sharing memory and managing locks, channels let goroutines send and receive values directly, ensuring that data is transferred correctly and synchronization is handled automatically.

But what really happens when we write something like:

```go
ch := make(chan int)
go func() {
    ch <- 42
}()
value := <-ch
```

Under the hood, channels are not magic. They are a carefully engineered data structure in the Go runtime, combining a ring buffer, wait queues, and integration with the scheduler. In this post, we'll explore the internals: how channels are represented, how send and receive operations work, what happens when you close a channel, how `select` interacts with channels, and how the scheduler and memory model come into play.

## Historical Context

Go didn't invent the concept of channels. They are inspired by **Communicating Sequential Processes (CSP)**, introduced by Tony Hoare in 1978. The core idea: processes don't share memory directly, they communicate by passing messages.

Other influences include:

- **Occam**, a CSP-based language for the Transputer.
- **Limbo/Newsqueak**, which brought message-passing concurrency to Plan 9.
- **Rob Pike** and **Ken Thompson**’s work on Plan 9, emphasizing simplicity and safe concurrent patterns.

The channel primitive embodies the CSP principle that underpins Go's concurrency philosophy: *don't communicate by sharing memory; share memory by communicating.*

In contrast to Java's `BlockingQueue` or pthreads condition variables, Go chose to make channels built into the language, with first-class syntax and tight runtime integration. This allows channels to express communication patterns naturally while remaining safe and type-checked.

## `hchan`: Memory Layout & Implementation Details

Every channel created with `make(chan T, N)` is represented internally by an `hchan` struct. Here's a simplified view:

```go
type hchan struct {
    qcount   uint           // number of elements in the buffer
    dataqsiz uint           // buffer capacity
    buf      unsafe.Pointer // circular buffer for elements
    elemsize uint16         // size of each element
    closed   uint32         // is channel closed?

    sendx    uint32         // send index into buffer
    recvx    uint32         // receive index into buffer

    recvq    waitq          // waiting receivers
    sendq    waitq          // waiting senders

    lock     mutex
}
```

Fields Breakdown:

- **Ring buffer**: Buffered channels use `buf` as a circular array. `sendx` and `recvx` wrap around modulo buffer size.
- **Goroutine queues**: `recvq` and `sendq` are linked lists of blocked goroutines, each represented as a `sudog` in the runtime. We'll briefly touch on `sudog` in the next section.
- **Closed flag**: Once set, it changes the semantics of send and receive.
- **Lock**: Each operation on a channel acquires the lock to maintain consistency.

The memory layout is designed for fast common paths:

- The buffer is contiguous in memory, improving cache locality.
- The queues are lightweight linked lists, avoiding large allocations unless many goroutines are blocked.
- Fields like `sendx`, `recvx`, and `qcount` allow the runtime to quickly determine whether a send/receive can proceed immediately.

`hchan` is allocated on the heap. That means it's managed by Go's garbage collector just like slices, maps, or other heap objects. When there are no references to a channel, the `hchan` header and its associated buffer become eligible for collection.

Concurrency control is provided by the embedded lock (`hchan.lock`). Internally, Go uses a spin–mutex hybrid strategy for this lock: in the uncontended case, goroutines may briefly spin to acquire it, avoiding expensive context switches. Under contention, they fall back to a traditional mutex with queuing. This design reduces overhead for high-frequency channel operations while still handling contention robustly.

Together, these details make `hchan` both lightweight enough for everyday concurrency and sophisticated enough to handle thousands of goroutines hammering the same channel under load.

## `sudog` in the Go Runtime

A `sudog` ("suspended goroutine") is an internal runtime structure that represents a goroutine waiting on a channel operation.

The naming comes from old Plan 9/Alef/Inferno runtime code, which influenced Go's runtime. In that lineage, *su* stood for *synchronous*, so `sudog` means something closer to *synchronous goroutine record*.

When a goroutine tries to send or receive on a channel and can't proceed immediately (because there's no matching receiver/sender):
1. The goroutine is marked as waiting.
2. The runtime creates or reuses a sudog object to store metadata about that wait.
3. This `sudog` is put into the channel's wait queue (a linked list for senders and another for receivers).
4. When a matching operation happens, the `sudog` is popped off the queue, and the corresponding goroutine is woken up.

### What's Inside a sudog?

From the Go runtime source (`runtime/runtime2.go`), a `sudog` holds:
- A pointer to the goroutine (`*g`) that's blocked.
- The element pointer (`elem`) for the value being sent/received.
- The channel it's waiting on.
- Links to the next/previous `sudog` in the wait queue.
- Debug/synchronization fields (like stack position, select cases, etc.).

In simplified pseudocode:

```go
type sudog struct {
    g     *g       // the waiting goroutine
    elem  unsafe.Pointer // value being sent/received
    c     *hchan   // channel this sudog is tied to
    next  *sudog   // linked-list pointer
    prev  *sudog
    // ... other bookkeeping
}
```

So the `sudog` is the "ticket" that says:
> This goroutine **G** is parked on channel **C**, waiting to send/receive the value at elem.

### Lifecycle of a `sudog`

- Created/attached when a goroutine blocks on `ch <- x` or `<-ch`.
- Enqueued into either the send queue or receive queue inside the channel (`hchan`).
- Dequeued when a matching operation arrives.
- Used to resume the blocked goroutine by handing its value off and scheduling it runnable again.
- Recycled by the runtime's pool for reuse (to avoid allocations every time).

### Why Not Just Store the Goroutine?

Because the runtime needs extra context: not only which goroutine is waiting, but also what it's doing (sending or receiving, which channel, which value pointer, which select case). The `sudog` bundles all of that into a single structure.

A key detail is that `sudog`s are pooled and reused by the runtime. This reduces garbage collector pressure, since channel-heavy programs (like servers handling thousands of goroutines) would otherwise generate massive amounts of short-lived allocations every time a goroutine blocks.

Another subtlety: a single goroutine can be represented by multiple `sudog`s at once. This happens in a select statement, where the same goroutine is registered as waiting on several channels simultaneously. When one case succeeds, the runtime cancels the others and recycles those extra `sudog`s.

## Lifecycle of Send/Receive

Channel operations have a multi-step journey that ensures correctness under concurrency. Let's break down both sending and receiving:

### Sending a Value (`ch <- v`)

**1. Acquire lock**
- Every send operation starts by acquiring the channel’s mutex.
- This ensures that multiple goroutines attempting to send or receive simultaneously do not corrupt internal state.

**2. Check waiting receivers**
- If a receiver is blocked in `recvq`, the runtime can immediately copy the value to the receiver's stack.
- This is the fast path: no buffering is necessary, and both goroutines can proceed immediately.
- Edge case: if multiple receivers are waiting, the runtime dequeues one at a time in FIFO order to maintain fairness.

**3. Check buffer availability (for buffered channels)**
- If no receiver is waiting, the send checks if the buffer has space.
- If space exists:
  - Place the value at `buf[sendx]`.
  - Increment `sendx` (modulo buffer size).
  - Increment `qcount`.
  - Release the lock and return.
- Edge case: high contention may cause the buffer to fill rapidly. The runtime ensures that multiple senders do not overwrite each other by keeping the mutex locked during the insertion.

**4. Block if necessary**
- If the buffer is full and no receiver is waiting:
  - Create a `sudog` structure representing the current goroutine and its value.
  - Enqueue it in `sendq`.
  - Park the goroutine, the scheduler removes it from the run queue.
- When a slot becomes available (either a receiver consumes from the buffer or another sender is dequeued due to a `select` wakeup), the goroutine is unparked.

**5. Edge cases**
- Sending on a closed channel immediately panics.
- Multiple blocked senders: senders are dequeued in FIFO order to avoid starvation.
- Spurious wakeups: the scheduler may wake a goroutine that finds the buffer still full, it will requeue itself.

### Receiving a Value (`x := <-ch`)

**1. Acquire lock**
- Protects access to the buffer and queues.

**2. Check waiting senders**
- If a sender is blocked in `sendq`:
  - Copy the sender’s value directly to the receiver’s stack.
  - Wake the sender.
  - Return immediately.
- Edge case: multiple senders waiting for an empty buffer - runtime dequeues one sender per receive, ensuring order and fairness.

**3. Check buffer content**
- If buffered values exist:
  - Take the element at `buf[recvx]`.
  - Increment `recvx`.
  - Decrement `qcount`.
  - Return immediately.
- Edge case: a buffered channel that is near empty may have multiple receivers contending - lock ensures one receiver consumes each element safely.

**4. Check closed channel**
- If the channel is closed and the buffer is empty, the receiver returns the zero value.
- Any subsequent receives continue to return zero values without blocking.

**5. Block if necessary**
- If no data is available and the channel is open:
  - Create a `sudog` representing the receiver.
  - Enqueue it in `recvq`.
  - Park the goroutine until a value becomes available.

**6. Edge cases**
- Multiple blocked receivers on a channel that becomes closed: all are unparked and see zero values.
- Receivers that wake up due to a sender being unblocked from a select statement handle the value correctly, even under high concurrency.

### Simplified Pseudo-Code: `chansend` / `chanrecv`

```go
func chansend(c *hchan, val T) {
    lock(c)

    if receiver := dequeue(c.recvq); receiver != nil {
        copy(val, receiver.stackslot)
        ready(receiver)
        unlock(c)
        return
    }

    if c.qcount < c.dataqsiz {
        c.buf[c.sendx] = val
        c.sendx = (c.sendx + 1) % c.dataqsiz
        c.qcount++
        unlock(c)
        return
    }

    enqueue(c.sendq, currentGoroutine, val)
    park()
    unlock(c)
}
```

```go
func chanrecv(c *hchan) (val T, ok bool) {
    lock(c)

    if sender := dequeue(c.sendq); sender != nil {
        val = sender.val
        ready(sender)
        unlock(c)
        return val, true
    }

    if c.qcount > 0 {
        val = c.buf[c.recvx]
        c.recvx = (c.recvx + 1) % c.dataqsiz
        c.qcount--
        unlock(c)
        return val, true
    }

    if c.closed != 0 {
        unlock(c)
        return zeroValue(T), false
    }

    enqueue(c.recvq, currentGoroutine)
    park()
    unlock(c)
    return
}
```

### Direct Stack Copy vs. Buffered Copy

An important optimization in Go's channel implementation is how values are copied:
- **Buffered path:** if the channel has a buffer and it's not full, a sender copies its value into the heap-allocated channel buffer. Later, when a receiver comes along, the value is copied again - from the buffer into the receiver's stack. That's two memory moves, plus buffer bookkeeping.
- **Unbuffered (synchronous) path:** if a receiver is already waiting, the sender bypasses the buffer entirely. The runtime copies the value directly from the sender's stack frame into the receiver's stack frame. This avoids the intermediate heap write and read, making synchronous sends/receives about as efficient as they can be.

This is part of why unbuffered channels are sometimes faster than buffered ones under low contention: fewer memory touches and no extra buffer indirection.

It also explains why channels can safely transfer values without data races: because the handoff is done via controlled stack or buffer copies managed by the runtime, not by exposing shared mutable memory.

## Closing Channels

Closing a channel is more complex than it seems due to multiple goroutines potentially waiting to send or receive.

### Step-by-Step Behavior

**1. Acquire lock**
- Ensures the channel state is updated atomically.

**2. Set `closed` flag**
- Changes semantics for all future sends and receives.

**3. Wake all receivers**
- Every goroutine in `recvq` is unparked.
- They attempt to receive: if the buffer still has elements, they get real data; if the buffer is empty, they receive zero values.

**4. Wake all senders**
- Every goroutine in `sendq` is unparked.
- Each sender panics because sending on a closed channel is invalid.

**5. Edge Cases / Race Conditions**
- Multiple goroutines blocked on send: all are unparked and panic safely.
- Receivers and buffer race: receivers see buffered values first before zero values.
- Closing twice: runtime detects `closed` flag and panics.
- Concurrent send during close: if a goroutine manages to reach the send path simultaneously with closing, the mutex ensures the send sees the channel as closed and panics, avoiding undefined behavior.

**6. Notes on fairness**
- FIFO ordering ensures that blocked receivers and senders are woken in a predictable order.
- Even under high contention, the runtime prevents starvation while maintaining correctness.

## `select` Internals

The `select` statement in Go allows a goroutine to wait on multiple channel operations simultaneously. Its power comes from combining non-determinism (randomized choice when multiple channels are ready) with safety (proper synchronization and fairness). Internally, `select` is implemented using structures and algorithms in the runtime that ensure correct behavior even under high contention.

### How `select` Works

**1. Compile-time representation:** each case in a select statement is represented at runtime as an `scase` struct. It contains:
- A reference to the channel (`hchan`) involved.
- Whether the operation is a send or receive.
- The value to send (if applicable).
- Pointers to the goroutine’s stack slots for receives.
- Flags indicating readiness and selection status.

**2. Randomized selection:** when multiple cases are ready, Go runtime picks one pseudo-randomly to avoid starvation. This ensures that a channel that’s always ready does not permanently dominate other channels.

**3. Blocking behavior**
- If at least one case is ready, `select` immediately executes one of them and proceeds.
- If no case is ready and there is no `default`, the goroutine is enqueued on all involved channels and parked.
- If a `default` case exists, the runtime executes it immediately, bypassing blocking.

**4. Queue management:** each channel's `sendq` or `recvq` may contain multiple goroutines waiting from various select statements.
- The runtime tracks which `select` cases are waiting to ensure that when a channel becomes ready, only one waiting goroutine per channel is woken and chosen correctly.

**5. Wakeup and execution:** when a channel in the select becomes ready:
- The scheduler wakes one of the waiting goroutines.
- The runtime determines which case of the select this goroutine represents.
- It executes that case and resumes execution immediately after the select statement.

### Example Scenarios

**Scenario 1: Multiple ready channels**

```go
select {
case ch1 <- 42:
    fmt.Println("Sent to ch1")
case ch2 <- 43:
    fmt.Println("Sent to ch2")
}
```

- If both `ch1` and `ch2` have space, the runtime randomly picks one.
- The other case is skipped entirely.
- Randomization prevents starvation for goroutines blocked on the less active channel.

**Scenario 2: No ready channels, with default**

```go
select {
case val := <-ch1:
    fmt.Println("Received", val)
default:
    fmt.Println("No channel ready")
}
```

- Since neither channel is ready, the `default` branch executes immediately.
- The goroutine does not block, preserving responsiveness.

**Scenario 3: No ready channels, no default**

```go
select {
case val := <-ch1:
    fmt.Println("Received", val)
case val := <-ch2:
    fmt.Println("Received", val)
}
```

- The goroutine is enqueued on both `ch1` and `ch2` receive queues.
- It remains parked until either channel becomes ready.
- Once ready, the runtime wakes the goroutine and executes the corresponding case.

### Closed Channels in `select`

Channels that are closed have special behavior in `select`:
- Receive from a closed channel is always ready, returning the zero value.
- If multiple channels are closed or ready, the runtime still uses randomized selection.
- Sending to a closed channel will panic, so select cases that attempt to send must handle this carefully, often using `recover` in higher-level patterns.

### Lifecycle Summary of a select Operation

1. Goroutine reaches `select`.
2. Runtime inspects all channels for readiness.
3. If any are ready:
   - Choose one case randomly.
   - Execute and return immediately.
4. If none are ready:
   - If `default` exists, execute it.
   - Otherwise, enqueue goroutine on all channels and park.
5. When a channel becomes ready:
   - Runtime wakes the goroutine.
   - Executes the selected case.
   - Removes the goroutine from all other queues.

## Memory Model & Synchronization

One of the most important - yet often overlooked - aspects of Go channels is how they fit into the Go memory model. At first glance, channels might seem like simple FIFO queues, but they are also synchronization points that define *happens-before* relationships between goroutines.

### Happens-Before with Channels

The Go memory model states:

- A send on a channel happens before the corresponding receive completes.
- A receive from a channel happens before the send completes only in the case of an unbuffered channel.

This is crucial, because it means that data sent over a channel is fully visible to the receiving goroutine by the time it executes the receive. You don't need extra memory barriers, `sync/atomic`, or mutexes to establish visibility when you use channels correctly.

```go
done := make(chan struct{})

var shared int

go func() {
    shared = 42
    done <- struct{}{}  // send happens-before the receive
}()

<-done                  // receive completes here
fmt.Println(shared)     // guaranteed to print 42
```

In this example, the assignment to `shared` is guaranteed to be observed by the main goroutine. The send/receive pair forms the synchronization boundary.

### Buffered Channels and Visibility

For buffered channels, the happens-before guarantee applies to the value being sent but not to unrelated memory writes that occur before or after. This distinction can be subtle:

```go
ch := make(chan int, 1)
x := 0

go func() {
    x = 99
    ch <- 1
}()

<-ch
fmt.Println(x) // guaranteed to see 99
```

Here, because the write to `x` occurs before the send, and the send happens-before the receive, the main goroutine is guaranteed to see `x = 99`.

But if you reverse the order, things get trickier:

```go
ch := make(chan int, 1)
x := 0

go func() {
    ch <- 1
    x = 99
}()

<-ch
fmt.Println(x) // NOT guaranteed to see 99
```

Why? Because the assignment to `x` occurs *after* the send. The only synchronization point is the send→receive pair, and nothing orders the `x = 99` relative to the main goroutine's read of `x`.

### Closing Channels

Closing a channel introduces its own happens-before rule:
- A close on a channel happens before a receive that returns the zero value because of the close.
This means you can safely use a closed channel as a broadcast signal:

```go
done := make(chan struct{})

go func() {
    // do some work
    close(done)  // happens-before all receivers unblocking
}()

<-done  // guaranteed to observe effects before close
```

But the guarantee only applies to memory writes that happen before the `close`. Anything after `close(done)` is unordered relative to the receivers.

Note that in idiomatic Go, closing a channel is relatively rare. Most programs simply let goroutines stop sending and rely on garbage collection. Channels are usually closed only for broadcast or completion signals, for example to indicate that no more work will be sent to multiple receivers. This pattern is common in fan-out/fan-in pipelines, worker pools, or signaling done conditions.

Attempting to send on a closed channel triggers a runtime panic immediately. This is Go’s way of preventing silent corruption or unexpected behavior:

```go
ch := make(chan int)
close(ch)          // channel is now closed

go func() {
    ch <- 42       // panic: send on closed channel
}()
```

Receivers, on the other hand, are safe: a receive from a closed channel returns the zero value of the channel type:

```go
x, ok := <-ch  // ok == false, x is zero value (0 for int)
```

Why this matters:
- **Broadcast semantics:** By closing a channel, multiple receivers can all unblock and detect completion safely.
- **Safe coordination:** Receivers never panic, making closed channels useful as signals.
- **Explicit contract:** Panic on send enforces the “don’t send after close” rule, reducing subtle bugs in concurrent programs.

### Practical Guidance

- Always assume that only operations ordered by channel send/receive (or close/receive) are synchronized.
- If you need ordering guarantees for other side effects, make sure they happen before the send or close.
- Don't rely on timing or buffered channel semantics to "probably" make your code safe - stick to the rules of the memory model.

## Scheduler Integration

Go's channels are not just clever data structures - they're tightly woven into the runtime scheduler. This integration is what makes blocking channel operations feel natural and efficient.

### The G/M/P Model

Go's scheduler uses three main entities:
- **G (Goroutine):** The lightweight, user-space thread of execution.
- **M (Machine):** An OS thread bound to a goroutine when it runs.
- **P (Processor):** A resource that manages runnable goroutines, acting as a bridge between **G**s and **M**s.
Every goroutine must run on an **M**, and every **M** must own a **P** to execute Go code.

### Blocking on Channels

When a goroutine tries to send or receive on a channel and the operation cannot proceed immediately:
1. The goroutine is parked (put to sleep).
2. It's removed from the **P**'s run queue.
3. A record of what it was waiting for is stored in the channel's `sudog` queue (a lightweight runtime structure that ties a goroutine to a channel operation).
4. The scheduler then picks another runnable **G** to execute on that **P**.
5. When the channel operation can proceed (e.g., another goroutine performs the corresponding send/receive), the parked goroutine is unblocked and can continue execution.
This makes channel operations fully cooperative with the scheduler—there is no busy waiting.

```go
ch := make(chan int)

go func() {
    fmt.Println(<-ch) // blocks, goroutine parked
}()

// main goroutine keeps running until it sends
ch <- 42
```

Here the anonymous goroutine is descheduled the moment it blocks on <-ch. The main goroutine keeps running until it eventually sends. At that point, the runtime wakes the parked goroutine, puts it back on a run queue, and resumes execution.

### Waking Up

When a channel operation becomes possible (e.g., a send finds a waiting receiver, or a receive finds a waiting sender):
- The runtime removes the waiting goroutine's `sudog` from the channel queue.
- It marks the goroutine as runnable.
- It places it onto a **P**'s local run queue or, if that’s full, the global queue.
This ensures the goroutine gets scheduled again without manual intervention.

### Fairness and Scheduling Order

Go's channel implementation enforces FIFO queues for waiting senders and receivers. This provides fairness - goroutines blocked earlier get served first.

But fairness interacts with the scheduler:
- Even if goroutine A was unblocked before goroutine B, the scheduler may not resume A immediately if B gets placed on a run queue with higher locality.
- There's no guarantee of strict timing order, only that operations complete without starvation.
This is why you should never assume that the order of goroutines being resumed matches your mental model of "who waited first."

### Impact on Performance

Because channels are scheduler-aware, blocking operations are relatively cheap compared to traditional system calls. Parking/unparking a goroutine only requires:
- Adjusting some runtime bookkeeping.
- Potentially waking an **M** if all **P**s are idle.
However, this still introduces overhead compared to non-blocking operations. At high contention, channels can become bottlenecks - not because of the data transfer itself, but because of the scheduler activity (context switches, run queue management).

### Subtle Consequences

- **Locality:** A goroutine unparked due to a channel operation might resume on a different **P** than before, leading to cache misses.
- **Bursty wakeups:** If many goroutines are waiting on a channel, a single close or broadcast-style send can cause a "thundering herd" of goroutines to wake up at once.
- **Select behavior:** The scheduler has to juggle multiple wait queues for select statements, which can slightly complicate fairness.

## Closing Thoughts

Go channels are deceptively simple. From the outside, they look like `<-` and `ch <- v`. Underneath lies a sophisticated orchestration of buffers, queues, parked goroutines, and scheduler hooks. Every pipeline, worker pool, or fan-in/fan-out pattern leverages this machinery to safely and efficiently move data between goroutines.

As Go evolves, channels remain central to its concurrency model, so understanding their internals gives you the intuition to use them effectively - and the caution to avoid misuse in high-contention scenarios.