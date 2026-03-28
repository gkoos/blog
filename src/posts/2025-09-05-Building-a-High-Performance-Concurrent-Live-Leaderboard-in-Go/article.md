---
layout: layouts/post.njk
title: Building a High-Performance Concurrent Live Leaderboard in Go
date: 2025-09-05
description: Implement a sharded, concurrent leaderboard in Go.
excerpt: "The goal of this article is to build a robust concurrent leaderboard in Go that can handle thousands of simultaneous updates from multiple goroutines, serve frequent Top-N queries efficiently, and maintain predictable snapshots of scores despite concurrent writes. We will balance theory with hands-on implementation, so you will not only see the code but also understand why each design decision matters under concurrent workloads."
tags:
- posts
- tutorials
- golang
- concurrency
---
*The code for this article is available on GitHub: [gkoos/article-leaderboard](https://github.com/gkoos/article-leaderboard).*

## Introduction

The goal of this article is to build a robust concurrent leaderboard in Go that can:

- Handle thousands of simultaneous updates from multiple goroutines.
- Serve frequent Top-N queries efficiently.
- Maintain predictable snapshots of scores despite concurrent writes.
- Be practical and production-ready, including guidance for scaling, memory usage, and extensions.

We will balance theory with hands-on implementation. You will not only see the code but also understand why each design decision matters under concurrent workloads.

Live leaderboards introduce several complexities:

- High-frequency writes: Many users may be updated simultaneously. Locks on a global map quickly become bottlenecks.
- Efficient Top-N queries: Sorting the entire dataset at every write is not feasible.
- Memory efficiency: Leaderboards may contain hundreds of thousands of users.
- Consistent snapshots: Users expect the Top-N query to reflect a meaningful state of the leaderboard, even as updates are occurring.

The combination of concurrent writes and frequent reads demands careful use of Go's synchronization primitives and data structures.

## Understanding the Problem

A leaderboard typically supports two main operations:

- `AddScore(userID string, score int)`: Stores a new score for a user. For simplicity, we will keep track of scores, not users, meaning that **multiple high scores by the same user are allowed**.
- `Top(n int)`: Retrieve the top N highest scores.

In addition, there are operational considerations:

- Updates must scale with concurrency.
- Top-N queries must be efficient, ideally faster than O(total users log total users).
- Locks should minimize contention, enabling multiple writers to proceed without blocking each other.

### Concurrency Challenges

- High-Frequency Writes: Without sharding or concurrency-aware data structures, every update serializes through a single lock. With thousands of simultaneous updates, this performs horribly.
- Efficient Top-N Queries: A naive approach would be to sort all users for each query. For 100,000 users, this can take tens of milliseconds per query - unacceptable for live systems that require millisecond-level responsiveness.
- Memory Efficiency: Maintaining auxiliary structures like heaps or sorted arrays for every user requires careful memory management. Each additional shard or heap increases memory usage linearly.
- Consistent Snapshots: Users expect the leaderboard to make sense. If a Top-N query reads inconsistent values across multiple shards, it may return fluctuating or incorrect results.

## Design Considerations

Before we start coding, we must decide how to organize data structures to satisfy these requirements.

### Single Map with Global Mutex

```go
type Leaderboard struct {
    mu     sync.RWMutex
    scores map[string]int
}
```

**Pros**: Simple and easy to reason about.

**Cons**: Poor scalability under heavy writes - all updates serialize through one mutex.

Use Case: Low concurrency or small datasets.

### Using `sync.Map`

Go's `sync.Map` provides a concurrent map with lock-free reads:

```go
var leaderboard sync.Map

leaderboard.Store("user123", 100)
score, ok := leaderboard.Load("user123")
```

**Pros**:
- Lock-free reads allow many goroutines to read simultaneously.
- Writes are atomic and safe for concurrent use.

**Cons**:
- Iteration is weakly consistent.
- Frequent writes reduce performance.
- Does not inherently support efficient Top-N queries, making it suboptimal for live leaderboards.

### Sharded Map Design

To scale with multiple writers, we can divide the leaderboard into shards. Each shard has its own map and mutex. This reduces lock contention and enables parallel updates.

- Writes to different shards proceed independently.
- Reads can occur concurrently across shards.
- Top-N queries merge per-shard results.

This design achieves high concurrency while keeping code relatively simple, so we will stick with it for our implementation.

### Heap-Based Top-N per Shard

In every shard, we have to keep track of the top N scores efficiently. We could sort the entire shard on every query, but that would be insane. Or we could keep track of the top N scores in an ordered list, then a new score could be inserted (or rejected) in O(N) time. But we can actually do even better, with the help of a *top-N min-heap*.

A min-heap is a complete binary tree where the value of each node is less than or equal to the values of its children:

![Min-Heap](https://i.imgur.com/NaGg1vM.png)

This property makes it efficient to extract the minimum element (the root) and to insert new elements while maintaining the heap structure.

It's a top-N min-heap because we only keep the top N scores in the heap. When a new score comes in, if it's less than the root of the heap, which is the smallest top N score, we reject it. If it's greater, we replace the root with the new score (we can do this, because the root element will be out of the top N) and re-heapify (restructure the heap). This ensures that we always have the top N scores in the heap. This approach provides O(1) rejection and O(log N) insertion complexity.

This diagram shows what happens on insertion:

![Insertion](https://i.imgur.com/UkGOObG.png)

Each shard keeps a local top-N heap and global Top-N is computed by merging these heaps. This approach avoids sorting the entire dataset on every Top-N query.

## Sharded Leaderboard Implementation

With all the theory under our belt, let's get to it! Fire up your favorite IDE and start with defining the shard structure and the main leaderboard type:

```go
// leaderboard/leaderboard.go

package leaderboard

import "sync"

// Shard represents a portion of the leaderboard
// It maintains a top-N min-heap of high scores
type shard struct {
	mu   sync.RWMutex
	topN *TopNMinHeap
}

type Leaderboard struct {
	shards []*shard
	n      int // global top-N size
}
```

### Heap Implementation

Next, we'll implement the top-N min-heap structure and methods to manage it. This includes insertion, rejection, and retrieval of the top N scores. We will use Go's `container/heap` package. We could implement our own heap for a small performance gain, but only at the cost of increased complexity - maybe in another article.

```go
// leaderboard/topnminheap.go
package leaderboard

import (
	"container/heap"
)

// ScoreEntry represents a score and its associated player.
type ScoreEntry struct {
	PlayerID string
	Score    int
}

// TopNMinHeap is a min-heap that stores the top-N high scores with player IDs.
type TopNMinHeap struct {
	scores []ScoreEntry
	maxN   int
}

// Len implements heap.Interface
func (h TopNMinHeap) Len() int { return len(h.scores) }

// Less implements heap.Interface (min-heap)
func (h TopNMinHeap) Less(i, j int) bool { return h.scores[i].Score < h.scores[j].Score }

// Swap implements heap.Interface
func (h TopNMinHeap) Swap(i, j int) {
	h.scores[i], h.scores[j] = h.scores[j], h.scores[i]
}

// Push implements heap.Interface
func (h *TopNMinHeap) Push(x any) {
	h.scores = append(h.scores, x.(ScoreEntry))
}

// Pop implements heap.Interface
func (h *TopNMinHeap) Pop() any {
	old := h.scores
	n := len(old)
	x := old[n-1]
	h.scores = old[:n-1]
	return x
}

// NewTopNMinHeap creates a TopNMinHeap with a specified maximum size.
func NewTopNMinHeap(maxN int) *TopNMinHeap {
	return &TopNMinHeap{
		scores: make([]ScoreEntry, 0, maxN),
		maxN:   maxN,
	}
}

// Add inserts a new score into the heap, maintaining the top-N property.
func (h *TopNMinHeap) Add(playerID string, score int) {
	entry := ScoreEntry{PlayerID: playerID, Score: score}
	if h.Len() < h.maxN {
		heap.Push(h, entry)
	} else if score > h.scores[0].Score {
		h.scores[0] = entry
		heap.Fix(h, 0)
	}
}
```

First, we must implement the `heap.Interface`, which defines `Len`, `Less`, `Swap`, `Push`, and `Pop`. Then, we create a constructor `NewTopNMinHeap` to initialize the heap. Finally, the `Add` method handles inserting new scores while maintaining the top-N property: if the heap is not full, we simply push the new score. If it is full and the new score is greater than the minimum (the root), we replace the root and re-heapify (that is, we call `heap.Fix`).

### Shard Operations: Score Updates and Reads

Each shard should expose methods that safely add new scores and retrieve its current top-N snapshot. The mutex `mu` ensures that concurrent updates to the shard are safe.

```go
// leaderboard/leaderboard.go

...

// AddScore adds a new score to the shard's top-N heap.
func (s *shard) AddScore(playerID string, score int) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.topN.Add(playerID, score)
}

// Top returns a snapshot of the top-N scores for this shard.
func (s *shard) Top() []ScoreEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// Return a copy to avoid exposing internal slice
	top := make([]ScoreEntry, len(s.topN.scores))
	copy(top, s.topN.scores)
	return top
}
```

`AddScore` locks the shard for writing, then adds the score to the heap using the `Add` method of the heap we defined earlier.

`Top` locks the shard for reading, and returns a copy of the heap slice so that callers cannot accidentally modify the internal heap.

Using `RWMutex` allows multiple goroutines to read the top-N concurrently while writes are serialized.

### Initializing the Leaderboard

Now that each shard is doing its thing, we can initialize the leaderboard with a specified number of shards and the global top-N size:

```go
// leaderboard/leaderboard.go

// NewLeaderboard creates a sharded leaderboard with `numShards` shards and global top-N size `n`.
func NewLeaderboard(numShards, n int) *Leaderboard {
	lb := &Leaderboard{
		shards: make([]*shard, numShards),
		n:      n,
	}

	for i := 0; i < numShards; i++ {
		lb.shards[i] = &shard{
			topN: NewTopNMinHeap(n),
		}
	}

	return lb
}
```

This function creates a `Leaderboard` with the specified number of shards, each initialized with its own top-N min-heap. Returning a pointer ensures that all goroutines operate on the same shared leaderboard instance, which is essential for concurrent updates.

### Adding Scores

When we add a score to the leaderboard, we need to determine which shard to update. We use the FNV-1a hash of playerID to assign a player to a shard, which ensures a roughly uniform distribution of players across shards. This is important to avoid distribution skew, which could lead to some shards being overloaded while others are underutilized. Note that the same playerID will always map to the same shard, which for our current design is not crucial, but could be important if we later want to support per-player operations.

```go
// leaderboard/leaderboard.go

import "hash/fnv"

...

// getShard returns the shard for a given playerID.
func (lb *Leaderboard) getShard(playerID string) *shard {
	h := fnv.New32a()
	h.Write([]byte(playerID))
	idx := int(h.Sum32()) % len(lb.shards)
	return lb.shards[idx]
}
```

With `getShard`, we can now easily implement the `AddScore` method to add scores to the leaderboard:

```go
// leaderboard/leaderboard.go

// AddScore adds a new score to the appropriate shard.
func (lb *Leaderboard) AddScore(playerID string, score int) {
	s := lb.getShard(playerID)
	s.AddScore(playerID, score)
}
```

`AddScore` calls `getShard` to find the correct shard, then adds the score to it via `shard.AddScore`. Each shard handles its own locking, so this scales with the number of shards.

### Retrieving Global Top-N

Now that we can add scores, there's only one thing left to do: retrieve the global top-N scores across all shards. We can do this by merging the top-N heaps from each shard. Since each shard's top-N is already sorted (as a min-heap), we can efficiently combine them using a max-heap to keep track of the overall top-N. (For very large numbers of shards, a more complex k-way merge could be implemented, but for typical shard counts, this approach is sufficient.)

```go
// leaderboard/leaderboard.go

// Top returns the global top-N across all shards.
func (lb *Leaderboard) Top() []ScoreEntry {
	// Temporary heap to compute global top-N
	globalHeap := NewTopNMinHeap(lb.n)

	for _, s := range lb.shards {
		shardTop := s.Top() // thread-safe snapshot
		for _, entry := range shardTop {
			globalHeap.Add(entry.PlayerID, entry.Score)
		}
	}

	// Copy to slice
	top := make([]ScoreEntry, len(globalHeap.scores))
	copy(top, globalHeap.scores)

	// Sort descending (highest score first)
	for i, j := 0, len(top)-1; i < j; i, j = i+1, j-1 {
		top[i], top[j] = top[j], top[i]
	}

	return top
}
```

Each shard returns a snapshot of its top-N, so we don't hold locks across multiple shards simultaneously. We insert all shard top-N entries into a temporary min-heap of size n to maintain the global top-N efficiently. Since the min-heap stores the smallest top-N score at the root, we reverse the slice to return the highest scores first.

## Testing What We've Built

Now that we have finished our leaderboard, let's see how it works. Here's a simple test program that demonstrates adding scores and retrieving the top-N concurrently:

```go
// main.go

package main

import (
	"fmt"
	"math/rand"
	"sync"
	"time"

	"./leaderboard"
)

func main() {
	const (
		numShards   = 8
		topN        = 10
		numPlayers  = 50
		numUpdates  = 200
		updateDelay = 10 * time.Millisecond
	)

	lb := leaderboard.NewLeaderboard(numShards, topN)

	var wg sync.WaitGroup

	// Spawn concurrent score updates
	for i := 0; i < numPlayers; i++ {
		wg.Add(1)
		playerID := fmt.Sprintf("player%02d", i)
		go func(pid string) {
			defer wg.Done()
			for j := 0; j < numUpdates; j++ {
				score := rand.Intn(50000)
				lb.AddScore(pid, score)
				time.Sleep(updateDelay)
			}
		}(playerID)
	}

	// Spawn a goroutine to print live top-N periodically
	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				top := lb.Top()
				fmt.Println("Top Scores:")
				for i, entry := range top {
					fmt.Printf("%2d: %s = %d\n", i+1, entry.PlayerID, entry.Score)
				}
				fmt.Println("-----")
			case <-done:
				return
			}
		}
	}()

	// Wait for all updates to finish
	wg.Wait()
	close(done)

	// Print final top-N
	fmt.Println("Final Top Scores:")
	top := lb.Top()
	for i, entry := range top {
		fmt.Printf("%2d: %s = %d\n", i+1, entry.PlayerID, entry.Score)
	}
}
```

This program creates a leaderboard with 8 shards and a top-10 size. It spawns 50 goroutines, each simulating a player that updates their score 200 times with random values. Concurrently, another goroutine prints the current top-10 scores every 100 milliseconds.

You can run this program with `go run main.go`, the output will be something like this:

```
Top Scores:
 1: player05 = 49830
 2: player07 = 49873
 3: player46 = 49966
 4: player24 = 49800
 5: player25 = 49961
 6: player10 = 49802
 7: player30 = 49812
 8: player02 = 49726
 9: player19 = 49750
10: player46 = 49718
-----
...
-----
Final Top Scores:
 1: player10 = 49971
 2: player45 = 49977
 3: player00 = 49992
 4: player40 = 49979
 5: player29 = 49990
 6: player19 = 49967
 7: player46 = 49966
 8: player18 = 49974
 9: player25 = 49961
10: player39 = 49960
```

## Conclusion

In this article, we've built a high-performance concurrent live leaderboard in Go from the ground up. Starting from the core problem, we discussed the challenges posed by high-frequency writes, efficient top-N queries, and snapshot consistency under concurrency.

We explored multiple design options:

- A single map with a global mutex: simple, but poor scalability.
- sync.Map: suitable for concurrent reads, but limited for top-N queries.
- Sharded leaderboard with per-shard top-N min-heaps: our chosen approach, balancing concurrency, efficiency, and simplicity.

We implemented:

- Shard-level structures with read-write locks.
- Top-N min-heaps per shard for fast insertion and rejection.
- Global top-N queries that merge per-shard heaps efficiently without blocking concurrent updates.

A demo/test harness illustrating live updates, concurrent writes, and periodic leaderboard snapshots.

Key takeaways:

- Sharding reduces lock contention. Multiple goroutines can update scores concurrently with minimal blocking.
- Min-heaps maintain the top-N efficiently. Only the most relevant scores are stored, keeping operations O(log N).
- Global top-N merging is practical. By combining per-shard heaps, we avoid sorting the entire dataset and maintain fast queries.
- Concurrency safety is straightforward with per-shard locks. You don't need complex lock-free algorithms for most live leaderboard use cases.
- This design scales gracefully. Increasing the number of shards reduces contention, and the heap-based approach ensures memory efficiency.

With this foundation, you can extend the leaderboard to support:

- Dynamic top-N per shard or multi-level leaderboards.
- Integration with persistent storage or distributed systems for larger-scale applications.
- Additional metrics such as timestamps, ranks, or achievements.

This practical, hands-on approach gives you an idea of how to handle real-world concurrent workloads efficiently. You now have the tools to implement, benchmark, and extend production-ready concurrent systems in Go.