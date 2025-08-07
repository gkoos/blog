---
layout: layouts/post.njk
title: Taming Goroutines - Efficient Concurrency with a Worker Pool in Go
date: 2025-08-07
description: A deep dive into hash maps, their implementation, and performance considerations in Go.
excerpt: "So you've learned everything about Go's goroutines and channels, and you're excited to dive into concurrent programming. But wait! Before you start spawning thousands of goroutines, let's take a step back and understand how to do this efficiently..."
tags:
- posts
- tutorials
- golang
- concurrency
---
So you've learned everything about Go's goroutines and channels, and you're excited to dive into concurrent programming. But wait! Before you start spawning thousands of goroutines, let's take a step back and understand how to do this efficiently. In this article, we'll explore the concept of a _worker pool_ and how it can help you manage concurrency in Go without overwhelming your system.

Let's say you're moving to a new place. Your stuff is in moving boxes and the van is waiting outside. You could try to carry the boxes, one at a time, but that would take forever. What can you do? If you are in good shape, you could carry two boxes at a time, but let's face it, we are couch potatoes. Instead, you invite your friends over and ask them to help. Now you have a team of people carrying boxes, and the job gets done much faster. Cool, but how many friends? There's only one door, and if too many people try to carry boxes at once, they will bump into each other and slow down the process.

In Go, goroutines are like those friends helping you move. They are lightweight threads that can run concurrently, allowing you to perform multiple tasks at once without the overhead of traditional threads. However, just like inviting too many friends can lead to chaos, spawning too many goroutines can lead to performance issues. This is where a worker pool comes in handy.

## 1. Goroutines and Channels: A Quick Recap

But before we dive into worker pools, let's quickly recap our building blocks: *goroutines* and *channels*. Goroutines are lightweight threads managed by the Go runtime. They allow you to run functions concurrently without the complexity of managing threads yourself. Channels are used to communicate between goroutines, enabling them to synchronize and share data safely. There are other ways for goroutines to communicate, but this is the safest and most idiomatic way in Go in accordance with "Don't communicate by sharing memory; share memory by communicating".

Here's a basic example of using a goroutine with a channel:

```go
ch := make(chan int)
go func() {
    ch <- someWork()  // Send result to channel when ready
}()

// Main goroutine continues other work...
otherWork()

// When we need the result, we receive from the channel
result := <-ch  // This blocks until the goroutine sends a value
fmt.Printf("Got result: %d\n", result)
```

In this example, the main goroutine can continue executing other tasks while `someWork()` runs concurrently. When the result is needed, `<-ch` blocks the main goroutine until the worker goroutine sends the value through the channel.

A channel can be *blocking* or *non-blocking*: a blocking channel will wait until a value is sent or received, while a non-blocking channel will return immediately if no value is available. The example above uses a blocking channel.

## 2. Concurrency ≠ Parallelism

It's important to understand that concurrency does not mean parallelism. Go allows you to run many goroutines, but it can't run more parallel threads than the number of available CPU cores. The Go runtime will spawn and run your _concurrent_ goroutines, but not all of them will run in _parallel_ at the same time. Yes, they all will be scheduled to run, but not necessarily all at once.

Also, goroutines introduce some overhead, such as stack space and scheduler work. If you spawn thousands of goroutines, you might end up hurting performance instead of improving it. Go is great at managing goroutines efficiently, but it's still important to be mindful of how many you create.

## 3. Parallelizing a Divide & Conquer Algorithm

A family of algorithms that can benefit from concurrency the most is the recursive divide-and-conquer algorithms. These algorithms break down a problem into smaller subproblems, solve them independently, and then combine the results.

The most classic example of a divide-and-conquer algorithm is **QuickSort**. You divide the dataset into two partitions, sort each partition, and then combine the results.

### 3.1 Sequential QuickSort

Let's see a non-parallel version of QuickSort:

```go
func quickSort(arr []int) []int {
    // Halt condition: if the array has less than 0 or 1 element, it's sorted
    if len(arr) == 1 || len(arr) == 0 {
        return arr
    }

    // Divide the array into two partitions
    // Everything less than the pivot goes to the left, everything greater (or equal) goes to the right
    pivot := arr[len(arr)/2]
    left := []int{}
    right := []int{}
    for _, v := range arr {
        if v < pivot {
            left = append(left, v)
        } else if v > pivot {
            right = append(right, v)
        }
    }

    // Recursively sort the partitions
    left = quickSort(left)
    right = quickSort(right)

    // Combine the left array, the pivot element, and the right array
    // Here both left and right are already sorted because of the recursive calls
    return append(append(left, pivot), right...)
}
```

If we look at this code, we can see that the sorting of left and right partitions can be done in parallel. We can spawn two goroutines to sort the left and right partitions concurrently, which can significantly speed up the sorting process for large datasets. We can't do much about the merging step, but it's still an improvement.

### 3.2 Parallel QuickSort - The Naive Approach

Here's a simple parallel version using raw goroutines:

```go
func quickSort(arr []int) []int {
    if len(arr) == 1 || len(arr) == 0 {
        return arr
    }

    pivot := arr[len(arr)/2]
    left := []int{}
    right := []int{}
    for _, v := range arr {
        if v < pivot {
            left = append(left, v)
        } else if v > pivot {
            right = append(right, v)
        }
    }

    // Create channels to receive the sorted partitions
    leftCh := make(chan []int)
    rightCh := make(chan []int)

    // Sort the left and right partitions in goroutines
    go func() {
        leftCh <- quickSort(left)
    }()

    go func() {
        rightCh <- quickSort(right)
    }()

    // Wait for both goroutines to finish and collect the results
    left = <-leftCh
    right = <-rightCh

    return append(append(left, pivot), right...)
}
```

In this version, we spawn two goroutines to sort the left and right partitions concurrently. This can spin out of control quickly. Although with careful (or lucky) pivot element selection, the depth of recursion will be `O(log n)`, in the worst case, it can go up to `O(n)`. And on every recursion level, we spawn two goroutines, which means the number of goroutines grows exponentially, so it's easy to go over the number of available CPU cores. And remember, each goroutine has its own stack space and scheduling overhead.

### 3.3 Optimized Parallel QuickSort with a Worker Pool

To avoid the issues with spawning too many goroutines, we can use a **worker pool**. A worker pool is a design pattern where a limited number of workers pull tasks from a queue. This throttles concurrency to what the CPU can handle and prevents thrashing from too many goroutines. We can also fall back to a sequential implementation if no workers are available, instead of just waiting for a free worker slot. This fallback is also useful for small datasets where the overhead of spawning goroutines outweighs the benefits of parallelism.

Here's how we can implement a worker pool for QuickSort:

```go
package main

import (
    "fmt"
    "runtime"
)

// Global worker pool - semaphore to limit concurrent goroutines
var workerPool chan struct{}

func init() {
    // Initialize with number of CPU cores
    workerPool = make(chan struct{}, runtime.NumCPU())
}

func quickSortWithPool(arr []int) []int {
    if len(arr) <= 1 {
        return arr
    }

    // Use sequential for small arrays to avoid overhead
    if len(arr) < 1000 {
        return quickSortSequential(arr)
    }

    // Partition the array
    pivot := arr[len(arr)/2]
    left := []int{}
    right := []int{}
    for _, v := range arr {
        if v < pivot {
            left = append(left, v)
        } else if v > pivot {
            right = append(right, v)
        }
    }

    // Channels to receive results
    leftCh := make(chan []int, 1)
    rightCh := make(chan []int, 1)

    // Try to get a worker for left partition
    select {
    case workerPool <- struct{}{}: // Got worker slot
        go func() {
            defer func() { <-workerPool }() // Release slot when done
            leftCh <- quickSortWithPool(left)
        }()
    default: // No workers available - use sequential
        leftCh <- quickSortSequential(left)
    }

    // Try to get a worker for right partition
    select {
    case workerPool <- struct{}{}: // Got worker slot
        go func() {
            defer func() { <-workerPool }() // Release slot when done
            rightCh <- quickSortWithPool(right)
        }()
    default: // No workers available - use sequential
        rightCh <- quickSortSequential(right)
    }

    // Wait for both results
    sortedLeft := <-leftCh
    sortedRight := <-rightCh

    // Combine results
    return append(append(sortedLeft, pivot), sortedRight...)
}
```

We make sure we never spawn more goroutines than the number of available CPU cores. There are several further optimizations we can do, such as falling back to sequential after a certain depth of recursion, batch processing or in-place partitioning (for better cache locality). There is great potential in better pivot selection too. But the basic idea is to use a worker pool to limit the number of concurrent goroutines and avoid overwhelming the system.

## 4. Benchmarking

In the accompanying [code repository](https://github.com/gkoos/article-taming-goroutines), you can find the implementations of the sequential QuickSort, the naive parallel QuickSort, and the worker pool version, with a thin wrapper to run them on a randomised dataset of 100,000 elements. If you run them, the results will be something like this:

```
$ go run sequential/main.go 
Sorted Data: [0 2 7 9 10 20 22 26 29 38] ... [999931 999939 999945 999964 999967 999972 999979 999984 999988 999997]
Elapsed time: 32.9421ms

$ go run parallel/main.go
Sorted Data: [0 2 7 9 10 20 22 26 29 38] ... [999931 999939 999945 999964 999967 999972 999979 999984 999988 999997]
Elapsed time: 66.6936ms

$ go run workerpool/main.go
Sorted Data: [0 2 7 9 10 20 22 26 29 38] ... [999931 999939 999945 999964 999967 999972 999979 999984 999988 999997]
Elapsed time: 31.0905ms
```

The results show that the naive parallel QuickSort is significantly slower than the sequential version, while the worker pool significantly improves the performance of the parallel algorithm, just beating the single-threaded execution.

The poor performance of the naive parallel version may come as surprise, but it nicely demonstrates our point: carelessly spawning goroutines can lead to serious performance degradation. Also, the simple, sequential QuickSort is doing great, it's not trivial to come up with something quicker.

## Summary

In this article, we examined what happens when we let goroutines spiral out of control and what we can do about it. 

Our worker pool is very simple: a robust implementation would use a more sophisticated task queue with job cancellation, timeouts via `context.Context` etc. We did not cover memory management patterns, such as using `sync.Pool` to reuse memory allocations for the left and right partitions. And the list goes on.

Concurrency is a vast topic, and there are many patterns and techniques to explore, we only started scratching the surface here.

The worker pool pattern is a powerful tool for managing goroutines, but not the only one. The key takeaway is: controlled parallelism beats chaotic concurrency every time.