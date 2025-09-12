---
layout: layouts/post.njk
title: "Garbage Collection in Go: From Reference Counting to Tri-Color to Green Tea"
date: 2025-09-12
description: Explore the evolution of garbage collection in Go, from early techniques to the latest advancements.
excerpt: Garbage collection (GC) is one of the most critical components of any modern programming language runtime. It decides how and when memory is reclaimed, directly impacting latency, throughput, and the overall responsiveness of applications.
tags:
- posts
- tutorials
- golang
---

# Garbage Collection in Go: From Reference Counting to Tri-Color to Green Tea

## Introduction

Garbage collection (GC) is one of the most critical components of any modern programming language runtime. It decides how and when memory is reclaimed, directly impacting latency, throughput, and the overall responsiveness of applications.

Go has always prioritized simplicity and developer productivity, and its garbage collector plays a major role in that story. Unlike languages such as C and C++ that leave memory management to the programmer, Go ships with a sophisticated GC designed to keep latency low while scaling to multi-core systems. 

In Go 1.25, the garbage collector underwent significant changes. A new algorithm, internally called 
*Green Tea*, replaced core parts of the tri-color mark-and-sweep approach that Go had used since its 
early releases. This shift represents more than just an implementation detail - it's a major step in 
Go's long-term strategy to provide predictable, low-latency GC for high-concurrency applications.

In this article, we'll take a step back and look at the evolution of garbage collection strategies, 
leading up to Go's current approach. We'll cover three major milestones:

1. **Reference Counting** — a simple but limited strategy that was historically popular.  
2. **Tri-Color Mark-and-Sweep** — the incremental algorithm that powered Go's GC until 1.25.  
3. **Green Tea** — the new span-based algorithm introduced in Go 1.25.

But this won't just be theory. To really understand the differences, we'll:

- Build toy implementations of each algorithm in Go, with a simplified heap model.  
- Benchmark and visualize their behavior on example workloads.  
- Run experiments to compare performance, trade-offs, and edge cases.  
- Discuss broader implications for Go developers and how these ideas compare to GC in other ecosystems.  

By the end, you'll not only understand what changed in Go 1.25, but also gain deeper insight into the 
trade-offs behind GC design - knowledge that's valuable far beyond Go itself.

The full code for the toy implementations, benchmarks, and demos is available in this repository: [https://github.com/gkoos/article-gc](https://github.com/gkoos/article-gc)

## Heap Representation (Real Go vs. Our Simplification)

> **Disclaimer:** The toy implementations below are for educational purposes and do not reflect all optimizations, concurrency mechanisms, or edge cases present in Go's production garbage collector.

Before we can talk about garbage collection algorithms, we need a mental model of the heap - the area of memory where dynamically allocated objects live.

### How Go Actually Manages the Heap

Go's memory management system is highly optimized and far from trivial. Some of the key aspects include:

- **Page allocator**: Go divides memory into pages (8 KB each on most systems).  
- **Spans**: Each page or group of pages is tracked as a "span", which manages objects of a specific size class.  
- **Size classes**: Objects are grouped by size, with a fixed set of classes to reduce fragmentation.  
- **Bitmap marking**: Each object is tracked in a bitmap, allowing the GC to quickly determine reachability.  
- **Concurrent scanning**: The GC can scan stacks and mark reachable objects while the program continues executing.  

This system is fast, scalable, and concurrency-friendly - but it's also very complex. Explaining it in full would require an article series on its own.

### Why We Need a Simplified Model
For the purpose of this article, we don't need to replicate every detail of the Go runtime. Instead, we want a simple but illustrative model of the heap that will let us:

- Allocate objects.  
- Store references between objects.  
- Track reachability from a root set.  
- Experiment with different GC strategies.  

This simplified heap won't capture performance optimizations like spans, arenas, or write barriers exactly as in Go, but it will make the algorithms much easier to explain and compare.

### Our Toy Heap
We'll represent the heap as a collection of `Object` structs, each with:

- An **ID**: just for easier visualization.  
- A list of **references** to other objects.  
- Metadata used by the GC (such as colors for tri-color marking, or a reference count for RC).  

Here's a basic sketch:

```go
type Object struct {
    ID       int
    Refs     []*Object // references to other objects
    Marked   bool      // used in tri-color / Green Tea
    RefCount int       // used in reference counting
}
```

We'll also maintain a global slice of all objects to represent the heap:

```go
var heap []*Object
```

And we'll define a simple root set - objects that are "always reachable" (like global variables or stack roots in a real program):

```go
var roots []*Object
```

This toy model gives us just enough structure to experiment with different garbage collection algorithms, without drowning in the details of the production Go runtime.

## Algorithms and Their Evolution

Now that we have a toy model of the heap, let's look at the algorithms that have been used for garbage collection.  
We'll cover three stages in the evolution of GC: *Reference Counting*, *Tri-Color Mark-and-Sweep*, and *Green Tea*.  

### Reference Counting
Reference counting (RC) is one of the simplest forms of garbage collection.  
Every object keeps a counter of how many references point to it.  
When a new reference is created, the counter increases.  
When a reference is removed, the counter decreases.  
When the counter reaches zero, the object can be freed immediately.

**Advantages:**
- Simple to implement and reason about.  
- Reclaims memory promptly (no pauses).  
- Still used today in some contexts (e.g., CPython, Swift ARC, Objective-C).  

**Limitations:**
- Cycles: if two objects reference each other but are otherwise unreachable, their counters never reach zero, causing a memory leak.  
- Incrementing/decrementing counters adds overhead.  
- Hard to make concurrent without locks.  

**Historical note:** Reference counting was popular in early systems due to its simplicity, and it's still a cornerstone of some languages (Python, Swift). But its limitations motivated more sophisticated algorithms.

---

### Tri-Color Mark-and-Sweep
The tri-color abstraction is the backbone of most modern garbage collectors.  
Objects are divided into three sets during a collection cycle:  

- **White**: candidates for garbage (unreachable unless proven otherwise).  
- **Gray**: reachable but not yet scanned.  
- **Black**: reachable and fully scanned.  

The algorithm works roughly like this:  
1. Start by putting all root objects in the gray set.  
2. While there are gray objects:
   - Pop one from the gray set.
   - Mark all objects it references as gray (if not already black/gray).
   - Mark the current object black.  
3. When no gray objects remain, all white objects are unreachable, so free them.  

**Advantages:**
- Detects cycles (unlike RC).  
- Works incrementally: can interleave marking with program execution.  
- Foundation for concurrent and parallel GC implementations.  

**Limitations:**
- Requires *write barriers* to handle mutations while GC runs.  
- Still introduces pause times if not carefully tuned.  

**Historical note:** Dijkstra's 1978 "on-the-fly" GC introduced the idea of tri-color marking, and it's influenced JVM, .NET, and Go.  

---

### Green Tea (Go 1.25+)
Go 1.25 introduced a major change with *Green Tea*, an algorithm designed to scale better across many cores and reduce coordination costs.  

Instead of thinking in terms of objects and colors, Green Tea shifts the perspective to **spans** - contiguous chunks of memory that contain multiple objects of the same size class.  

Key ideas:
- GC operates at the **span level**, not just the object level.  
- Marking is distributed more efficiently across worker threads.  
- Reduces synchronization overhead by grouping work.  

**Advantages:**
- Better scalability on multicore systems.  
- Reduced pause times under high concurrency.  
- Maintains Go's GC goal: keep latency low (<1 ms in most cases).  

**Limitations:**
- More complex implementation.  
- Still young - long-term behavior in production is being studied.  

**Historical note:** Green Tea builds on decades of research into parallel and concurrent GCs. Similar span- and region-based strategies appear in JVM G1GC and Azul's collectors, but Go's variant is tuned specifically for its concurrency model.  

### Other Algorithms (Honorable Mentions)

While our focus is on Reference Counting, Tri-Color, and Green Tea, other garbage collection strategies are worth knowing about:

- **Classic Mark-and-Sweep**  
  The simplest approach: stop the world, mark reachable objects, sweep the rest. Easy to implement but causes long pause times.  

- **Stop-and-Copy (Semi-Space, Cheney's algorithm)**  
  Splits the heap into two halves. Live objects are copied to the other half during collection. Provides fast allocation but wastes half the heap.  

- **Generational GC**  
  Based on the "most objects die young" observation. Frequently collects the young generation, rarely collects the old. Used extensively in JVM and .NET.  

- **Concurrent & Parallel GC**  
  Collectors that run alongside the program (HotSpot's G1GC, Azul C4). Reduce pause times but require sophisticated synchronization.  

- **Region/Arena-based Allocation**  
  Objects are allocated in regions (arenas), and the entire region is freed at once. Extremely efficient for certain workloads (seen in Rust's borrow checker or manual arena allocators).  

These approaches influenced the design of Go's GC, but Go has deliberately chosen simplicity and predictability over the complexity of full generational or concurrent copying collectors.

## Implementation

With the concepts in place, let's implement our toy garbage collectors.  
We'll use the simplified `Object` and `heap` structures we defined earlier, and implement each algorithm in turn: **Reference Counting**, **Tri-Color Mark-and-Sweep**, and **Green Tea**.

### Common Toy Heap Code

We already defined our `Object` struct and global `heap` and `roots`. Now, let's implement the core functions for our toy heap:

```go
func NewObject(id int) *Object {
    obj := &Object{ID: id}
    heap = append(heap, obj)
    return obj
}

func AddRoot(obj *Object) {
    roots = append(roots, obj)
}

func AddRef(from, to *Object) {
    from.Refs = append(from.Refs, to)
    to.RefCount++
}
```

These helper functions allow us to create objects, define roots, and establish references between objects.

### Reference Counting Implementation

Reference counting updates counters when references are added or removed. Collection is immediate: when an object's count drops to zero, we recursively free it.

```go
func RemoveRef(from, to *Object) {
    // remove reference from "from" to "to"
    newRefs := []*Object{}
    for _, r := range from.Refs {
        if r != to {
            newRefs = append(newRefs, r)
        }
    }
    from.Refs = newRefs

    // decrement counter
    to.RefCount--
    if to.RefCount == 0 {
        freeObject(to)
    }
}

func freeObject(obj *Object) {
    // recursively free children
    for _, r := range obj.Refs {
        r.RefCount--
        if r.RefCount == 0 {
            freeObject(r)
        }
    }

    // remove from heap
    newHeap := []*Object{}
    for _, h := range heap {
        if h != obj {
            newHeap = append(newHeap, h)
        }
    }
    heap = newHeap
    fmt.Printf("Freed object %d\n", obj.ID)
}
```

Description:

- Every object keeps a counter of references pointing to it (`RefCount`).
- When a reference is removed, the count is decremented. If it reaches zero, the object is freed immediately, recursively freeing children.
- Cannot handle cycles: two objects referencing each other but unreachable elsewhere will never be freed.
- Main routine continues allocating while reference counts are updated - no stop-the-world pause occurs.

### Tri-Color Mark-and-Sweep Implementation

Here's a simple tri-color collector. We'll use `Marked` as the "color": `false` = white, `true` = black. The gray set is represented by a queue.

```go
func TriColorGC() {
    // 1. Mark phase
    worklist := []*Object{} // gray set
    for _, root := range roots {
        if !root.Marked {
            root.Marked = true
            worklist = append(worklist, root)
        }
    }

    for len(worklist) > 0 {
        obj := worklist[0]
        worklist = worklist[1:]

        for _, r := range obj.Refs {
            if !r.Marked {
                r.Marked = true
                worklist = append(worklist, r)
            }
        }
    }

    // 2. Sweep phase
    newHeap := []*Object{}
    for _, obj := range heap {
        if obj.Marked {
            obj.Marked = false // reset for next GC
            newHeap = append(newHeap, obj)
        } else {
            fmt.Printf("Swept object %d\n", obj.ID)
        }
    }
    heap = newHeap
}
```

Description:

- Uses `Marked` to represent object color.
- `worklist` is the gray set: objects reachable but not yet scanned.
- Marks all reachable objects from roots, then sweeps the heap to free the rest.
- Main routine is paused during this process - all allocations or work depending on these objects must wait until GC finishes.
- Correctly handles cycles.
- Longer heap = longer pause.

How to see the pause:

- `TriColorGC()` runs synchronously: the main allocation loop cannot proceed while it executes.

### Green Tea (Span-based Approximation)

Our toy model won't fully replicate Go 1.25's span-based GC, but we can simulate the key idea: *work distribution at the span level*.

Here we treat each "span" as a batch of objects and mark them together.

```go
const spanSize = 2 // just for demonstration

func GreenTeaGC() {
    // divide heap into spans
    spans := [][]*Object{}
    for i := 0; i < len(heap); i += spanSize {
        end := i + spanSize
        if end > len(heap) {
            end = len(heap)
        }
        spans = append(spans, heap[i:end])
    }

    // mark reachable objects
    marked := map[*Object]bool{}
    worklist := roots
    for len(worklist) > 0 {
        obj := worklist[0]
        worklist = worklist[1:]

        if marked[obj] {
            continue
        }
        marked[obj] = true

        for _, r := range obj.Refs {
            worklist = append(worklist, r)
        }
    }

    // sweep whole spans
    newHeap := []*Object{}
    for _, span := range spans {
        keepSpan := false
        for _, obj := range span {
            if marked[obj] {
                keepSpan = true
                break
            }
        }

        if keepSpan {
            for _, obj := range span {
                if marked[obj] {
                    newHeap = append(newHeap, obj)
                }
            }
        } else {
            for _, obj := range span {
                fmt.Printf("GreenTea swept object %d\n", obj.ID)
            }
        }
    }
    heap = newHeap
}
```

Description:

- Splits the heap into spans (batches of objects).
- Maintains a worklist starting from roots. Marks objects as reachable.
- Processes spans incrementally, yielding periodically so the main routine can continue allocating.
- Sweeps per span, freeing only unmarked objects.
- Simulates Go 1.25's incremental/concurrent behavior: reduces application pause compared to Tri-Color.

How to see concurrency:

- In the benchmark, Green Tea GC can run in a separate goroutine while main work runs in its own goroutine.
- Main work completes faster because it is not blocked by the GC.

## Benchmarking Main Work Completion

To demonstrate the practical differences between Tri-Color and Green Tea, `cmd/bench/main.go` implements a main work completion benchmark. The goal is simple: simulate a program performing allocations while the GC runs, and measure how quickly the main routine completes.

### What the Benchmark Does

1. Heap Setup
   - Creates a heap of `HEAP_SIZE` objects.
   - Builds `ROOTS` root objects, each pointing to a chain of `SPAN_SIZE` objects.
   - This creates a mix of reachable and unreachable objects, simulating a realistic heap layout.

2. Main Work Simulation
   - A separate goroutine simulates the application doing allocations (`MAIN_ALLOC` new objects).
   - This represents typical program work independent of garbage collection.

3. Tri-Color GC (Blocking)
- Runs synchronously in the main goroutine.
- Marks all reachable objects from the roots, then sweeps unreachable objects.
- Because it blocks the main work goroutine, the total completion time reflects a stop-the-world pause.

4. Green Tea GC (Incremental)
   - Runs concurrently in its own goroutine.
   - Splits the heap into spans and marks reachable objects incrementally.
   - Every 100 objects marked, the GC yields (time.Sleep) to simulate cooperative concurrency.
   - Sweep is also done span by span.
   - The main routine continues allocating objects without being blocked, illustrating the reduced pause times of Green Tea.

5. Measurement
   - The benchmark measures how long the main work goroutine takes to complete under each GC strategy.
   - This directly shows the impact of GC pauses on application responsiveness, which is the core design goal of Green Tea.

> Note: Although tri-color marking is incremental in theory, our benchmark runs it as a blocking, synchronous operation to model the stop-the-world pauses that still occur in real implementations. In contrast, the Green Tea algorithm is designed to run incrementally and concurrently, so our benchmark allows the main work to continue while Green Tea GC operates in a separate goroutine, better reflecting its low-latency, non-blocking behavior.

### Why This Approach Works

- No Reference Counting Benchmark Needed: RC updates counts immediately during allocation and reference removal, so there's no stop-the-world pause to measure (although it can impact throughput due to frequent counter updates, especially in concurrent scenarios). Its behavior is implicit.
- Focus on Latency: By isolating main work from GC, the benchmark highlights real application latency, rather than total GC throughput.
- Incremental Simulation: Although simplified, yielding every 100 objects simulates a concurrent marking strategy, allowing readers to see why Green Tea reduces perceived pause times.

### Running the Benchmark

To run the benchmark, use:

```bash
go run cmd/bench/main.go
```

You should see output similar to:

```
[TriColor] Main work completed in: 5.0025ms
[GreenTea] Main work completed in: 3.8372ms
```

This output indicates that the main work completed faster with Green Tea, demonstrating its advantage in reducing application pause times.

Although this is a simplified model and the numbers are illustrative only, it effectively showcases the key differences between blocking and incremental GC strategies, aligning with Go's goals for low-latency garbage collection.

## Playground: Experimenting with Garbage Collection

To make these ideas more interactive, `cmd/demo/main.go` serves as a playground for experimenting with our toy heap and garbage collectors.

- What it does: Lets you create objects, set up references, define roots, and trigger the different GC strategies (Reference Counting, Tri-Color, and Green Tea).
- Why it's useful: By modifying object graphs, changing heap sizes, or tweaking span sizes, you can observe firsthand how each collector behaves under different workloads.
- Encouragement: Try adding cycles, increasing heap size, or adjusting the main allocation loop. Watch which objects get collected, how pauses appear, and how Green Tea's incremental approach (simulated in `cmd/demo/main.go`) reduces blocking.

You can run the demo with:

```bash
go run cmd/demo/main.go
```

This playground is designed for experimentation. Break it, tweak it, make cycles, expand the heap! The goal is to see the algorithms in action and build intuition about garbage collection, not just read about it.

## Why Go Moved Toward Green Tea

Go's shift from a classic tri-color GC to the span-based Green Tea collector reflects a set of practical priorities:

- Low-latency guarantees: Go has always aimed for sub-millisecond pause times, even under heavy concurrency. As applications scaled across many cores, the original tri-color GC required more synchronization and longer pauses. Green Tea reduces these pauses by distributing work at the span level and yielding more frequently.
- Scalability on multi-core systems: Modern servers often have dozens of cores. Tri-color GC's object-level marking can become a bottleneck with large heaps and many threads. Green Tea's span-based approach allows multiple workers to mark and sweep concurrently with minimal contention.
- Predictability over raw throughput: While tri-color GC could handle large heaps, its pause times were harder to predict under bursty workloads. By grouping objects into spans and processing them incrementally, Go can provide more consistent latency, a key concern for networked servers and real-time applications.
- Simplicity for concurrent workloads: Although the implementation is more complex internally, Green Tea reduces coordination between threads compared to fully concurrent, object-level marking. This keeps the runtime code simpler in practice and avoids subtle race conditions.

In short, Go's move reflects the latest advancements in garbage collection research combined with the practical realities of large, high-concurrency programs. The result is a collector that scales efficiently without compromising Go's core promise: predictable, low-latency performance.

## Conclusion

Garbage collection is more than a runtime detail - it directly affects how responsive and efficient your programs are. By exploring reference counting, tri-color mark-and-sweep, and Green Tea, we've seen:

- How memory management strategies evolved from simple counters to sophisticated, span-based marking.
- Why cycles, pause times, and concurrency constraints drive algorithmic choices.
- How Go 1.25's Green Tea GC balances scalability, predictability, and low latency, aligning with Go’s design philosophy.

Even if you never implement a garbage collector yourself, understanding these trade-offs gives you a sharper intuition about performance, memory behavior, and the hidden costs behind seemingly simple Go programs.

With these insights, you can better reason about allocation patterns, concurrency, and performance optimizations, and appreciate the engineering behind Go's modern garbage collector.

## A Note on Go Version

All our toy examples were cooked up with Go 1.23 — couldn't resist. 😄

But don't worry: with Go 1.25, the results should be very similar, so you can play around and see the differences between Tri-Color and Green Tea for yourself.
