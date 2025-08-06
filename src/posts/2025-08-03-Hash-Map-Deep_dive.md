---
layout: layouts/post.njk
title: Hash Map Deep Dive
date: 2025-08-03
description: A deep dive into hash maps, their implementation, and performance considerations in Go.
canonical: https://dev.to/gkoos/hash-map-deep-dive-2b7p
tags:
- posts
- tutorials
- algorithms
- Golang
---
_(Originally published on [Dev.to](https://dev.to/gkoos/practical-skyline-queries-in-go-1mb9))_

![](https://i.imgur.com/GiyaHep.jpeg)
A `dict` in Python. `map` in Go, `Object` or `Map` in Javascript. Associative arrays in PHP, `Dictionary<TKey, TValue>` in C++. Hash maps are implemented in virtually every high-level programming language. And they are awesome! Who doesn't want to store and then access data in constant time? Whether you're working with large datasets or grinding Leetcode problems, very often this data structure comes to the rescue. But what are they exactly and how do they work under the hood? In this article we will try and answer these questions.

## Table of Contents

[[toc]]

## What Is a Hash Map?

At a high level, a hash map, or hash table is a data structure that implements an associative array abstract data type, a structure that can map keys to values. The key is used to uniquely identify a value in the map, and the value is the data that is being stored. Hash maps are designed to provide fast insertion, deletion, and lookup of key-value pairs.

In fact, the average time complexity for these operations is O(1), which means that they can be performed in constant time! This feature makes hash maps probably the most used data structure in programming, however there are some caveats to this, as we will see later. 

The worst-case time complexity for these operations is O(n), which can happen in certain scenarios, and the more we know about the internals, the more likely we are to avoid these scenarios.

According to the [Wikipedia article](https://en.wikipedia.org/wiki/Hash_table): 
>  a hash table is a data structure that implements an associative array, also called a dictionary or simply map; an associative array is an abstract data type that maps keys to values. A hash table uses a hash function to compute an index, also called a hash code, into an array of buckets or slots, from which the desired value can be found.

So let's take a step back and look at the components of a hash map.

## What Is a Hash Function?

A hash function is a function that takes an input (or "key") and typically returns an integer that is used to index the data in the hash map. The key is transformed into an integer, which is then used to determine the index in the underlying array where the value is stored.

A good hash function has the following properties:
- **Deterministic**: The same input will always produce the same output.
- **Uniform Distribution**: The hash function should distribute keys uniformly across the hash table to minimize collisions.
- **Fast Computation**: The hash function should be quick to compute, even for large inputs.
- **Minimize Collisions**: The space of possible keys is typically much larger (often infinite) than the space of hash codes. This means that different keys may produce the same hash code. While these collisions are inevitable, a good hash function minimizes the chances of two different keys producing the same hash code.

A simple example of a hash function is the modulo operation, which takes a key and returns the remainder when divided by the size of the hash table. For example, if we have a hash table of size 10 and a key of 23, the hash code would be `23 % 10 = 3`, meaning that the value associated with the key 23 would be stored at index 3 in the underlying array. And if the key is 33, the hash code would be `33 % 10 = 3` as well, which means that we have a collision. In this case, both keys would map to the same index in the array.

## What Is a Bucket?

A bucket is a slot in the hash table where a key-value pair is stored. In case of a collision, where two different keys produce the same hash code, the bucket can store multiple key-value pairs. This is often done using a linked list or another data structure to handle collisions.

This diagram illustrates how all this works:
![](https://i.imgur.com/H8wRU0P.png)

Here we can see how the hash function maps keys to indices in the underlying array. The keys 23 and 33 both produce the same hash code of 3, which means that they are stored in the same bucket. The bucket can then store both key-value pairs, but when we retrieve a value, we need to check the keys in the bucket to find the correct one. This is where the time complexity can increase to O(n) in the worst case, if many (or even all) keys collide and are stored in the same bucket.

## Load Factor

The load factor is a measure of how full the hash table is. It is calculated as the number of elements in the hash table divided by the number of buckets (or slots) in the underlying array. A higher load factor means that there are more elements in the hash table relative to the number of buckets, which can lead to more collisions and slower performance.

## Collision Resolution

When two keys produce the same hash code, we have a collision. There are several strategies to handle collisions in hash maps:

1. **Chaining**: In this method, each bucket contains a linked list (or another data structure) of all key-value pairs that hash to the same index. When a collision occurs, the new key-value pair is simply added to the list in the appropriate bucket. This is the most common method for handling collisions.
   - **Complexity**: Average O(1) for all operations, worst-case O(n) if all keys hash to the same bucket
   - **Pros**: Simple to implement, handles high load factors well, deletion is straightforward
   - **Cons**: Extra memory overhead for pointers, poor cache performance due to scattered memory access

2. **Open Addressing**: In this method, when a collision occurs, the hash table searches for the next available slot in the array to store the new key-value pair. There are several techniques for finding the next available slot:

   **Linear Probing**: If a collision occurs, the algorithm checks the next slot in the array until it finds an empty one.
   - **Complexity**: Average O(1), worst-case O(n) due to primary clustering
   - **Pros**: Simple implementation, good cache performance for nearby accesses
   - **Cons**: Primary clustering (consecutive occupied slots), performance degrades with clustering

   **Quadratic Probing**: Instead of checking the next slot, it checks slots at increasing distances (1, 4, 9, etc.) from the original index.
   - **Complexity**: Average O(1), better than linear probing due to reduced clustering
   - **Pros**: Reduces primary clustering compared to linear probing, still cache-friendly
   - **Cons**: Secondary clustering (keys with same hash follow same probe sequence), may not visit all slots

   **Double Hashing**: Uses a second hash function to determine the step size for probing. Unlike linear probing which always moves to the next slot, or quadratic probing which uses a fixed sequence, double hashing calculates a unique step size for each key. The formula is typically: `index = (hash1(key) + i * hash2(key)) % table_size`, where `i` is the probe attempt number. The second hash function must return a value that's relatively prime to the table size to ensure all slots can be visited. For example, if `hash1(key) = 7` and `hash2(key) = 3`, then we'd probe indices 7, 10, 13, 16, etc.
   - **Complexity**: Average O(1), best performance among open addressing methods
   - **Pros**: Minimizes clustering, uniform distribution of probe sequences, visits all slots when properly implemented
   - **Cons**: More complex implementation, requires computing two hash functions, slightly more overhead per operation

3. **Rehashing**: If the load factor becomes too high, the hash table can be resized and all existing key-value pairs can be rehashed into the new table. This helps to maintain efficient performance as the number of elements grows.
   - **Complexity**: O(n) for the rehashing operation itself, but amortizes to O(1) per insertion over time
   - **Pros**: Maintains optimal performance by keeping load factor low, prevents performance degradation
   - **Cons**: Temporary performance spike during rehashing, requires additional memory during the resize operation

Each of these methods has its own trade-offs in terms of complexity, performance, and memory usage. The choice of collision resolution strategy can have a significant impact on the overall performance of the hash map.

Here is a quick summary of the pros and cons of each collision resolution method:

| **Feature** | **Chaining** | **Linear Probing** | **Quadratic Probing** | **Double Hashing** |
|-------------|--------------|-------------------|----------------------|-------------------|
| **Average Time Complexity** | O(1) | O(1) | O(1) | O(1) |
| **Worst-case Time Complexity** | O(n) | O(n) | O(n) | O(n) |
| **Memory Overhead** | High (pointers) | Low | Low | Low |
| **Cache Performance** | Poor | Good | Good | Moderate |
| **Implementation Complexity** | Simple | Simple | Moderate | Complex |
| **Clustering Issues** | None | Primary clustering | Secondary clustering | Minimal |
| **Load Factor Tolerance** | High (>1.0) | Low (<0.7) | Low-Medium (<0.7) | Medium (<0.8) |
| **Deletion Complexity** | Simple | Complex (tombstones) | Complex (tombstones) | Complex (tombstones) |
| **Space Efficiency** | Lower | Higher | Higher | Higher |
| **Performance Degradation** | Gradual | Rapid at high load | Moderate at high load | Slow at high load |
| **Hash Function Requirements** | One | One | One | Two |
| **Best Use Cases** | Unknown load factors, frequent deletions | Cache-friendly applications, low load | Better than linear, moderate load | High performance, predictable load |

## Some Real-World Examples

### Programming Language Implementations

Many programming languages have built-in hash maps. These implementations often use a combination of the techniques described above to provide efficient performance and handle collisions effectively.

- **Python**'s `dict` uses open addressing with randomized probing, rehashing when the load factor exceeds about 0.66.

- **Java**'s `HashMap` uses chaining with linked lists (converting to balanced trees for large buckets in Java 8+), rehashes at 0.75 load factor.

- **C++**'s `unordered_map` typically uses chaining, but implementations may vary.

### Database Systems

Hash maps are also widely used in database indexing. Many database systems use hash indexes to speed up data retrieval. These indexes allow for fast lookups by hashing the indexed columns and storing the resulting key-value pairs in a hash table. When a query is executed, the database can quickly find the relevant rows by computing the hash of the query key and looking it up in the hash index.

Some popular database systems that use hash indexing include:

- **PostgreSQL**: Supports hash indexes, but they are not as commonly used as B-tree indexes.
- **MongoDB**: Uses hash indexes for sharding and to support equality queries on hashed fields.
- **Redis**: Implements hash maps as a core data structure, allowing for efficient storage and retrieval of key-value pairs.

These implementations often leverage the same underlying principles of hashing and collision resolution discussed earlier, but they may also incorporate additional optimizations specific to the database context.

### Version Control

Version control systems like Git use hash maps to efficiently manage file changes and track versions. Each commit in Git is identified by a SHA-1 hash of its contents, which serves as a unique key for the commit object. This allows Git to quickly look up commits, branches, and other objects in the repository. Git doesn't use traditional hash table collision resolution, it's designed around the assumption that cryptographic hash collisions won't occur in practice.

## Putting It All Together: How Implementation Knowledge Matters

And it's not just about the theory! Understanding how hash maps are implemented in your programming language of choice can lead to significant performance improvements in your code.

For example, since Python's `dict` uses open addressing with optimized string handling, understanding this can lead to much better performance. Here's how to write efficient vs inefficient code:

### Bad Implementation (Fights Against Python's Dict)

```python
def count_words_bad(text):
    word_counts = {}
    words = text.split()
    
    for word in words:
        # This is inefficient with open addressing!
        if word in word_counts:          # First lookup
            word_counts[word] += 1       # Second lookup + assignment
        else:
            word_counts[word] = 1        # Third lookup + assignment
    
    return word_counts
```

**Problems:**
- Multiple hash lookups per word (up to 3!)
- Open addressing makes key-missing checks expensive
- Doesn't leverage Python's dict optimizations

### Good Implementation (Works With Python's Dict)

```python
from collections import defaultdict, Counter

def count_words_good_v1(text):
    # defaultdict eliminates key existence checks
    word_counts = defaultdict(int)
    words = text.split()
    
    for word in words:
        word_counts[word] += 1  # Single operation!
    
    return dict(word_counts)

def count_words_good_v2(text):
    # Counter is optimized specifically for Python's dict implementation
    words = text.split()
    return Counter(words)

def count_words_good_v3(text):
    # dict.get() with default avoids the membership test
    word_counts = {}
    words = text.split()
    
    for word in words:
        word_counts[word] = word_counts.get(word, 0) + 1  # Single lookup
    
    return word_counts
```

**Why These Are Better:**
- **Single hash operation** per word instead of multiple
- **Leverages Python's string optimization** - string keys are handled very efficiently
- **Works with open addressing** - fewer probing operations needed
- **Uses built-in optimizations** like `Counter` which is tuned for Python's implementation

### Performance Difference

**Typical Results:** The good implementation is often 2-3x faster, simply by understanding and working with Python's dict implementation rather than against it!

## Conclusion

Hash maps are among the most fundamental and powerful data structures in computer science, providing near-constant time access to data that makes them indispensable in modern programming. Throughout this deep dive, we've explored how they achieve their remarkable O(1) average performance through clever use of hash functions, strategic collision resolution, and careful load factor management.

The key insight is that the "magic" of hash maps isn't really magic at all — it's the result of well-designed algorithms and data structures working together. Understanding these internals helps us avoid the O(n) worst-case scenarios and write more efficient code.

**Key Takeaways:**

- **Hash functions** are the foundation—they determine how evenly data is distributed and directly impact collision rates
- **Collision resolution strategies** each have distinct trade-offs: chaining for simplicity and robustness, open addressing for memory efficiency and cache performance
- **Load factor management** through rehashing prevents performance degradation as hash maps grow
- **Implementation knowledge** translates to real performance gains—understanding whether your language uses chaining or open addressing can make your code 2-3x faster

Whether you're optimizing a Python script, debugging performance issues in Java, or making architectural decisions for a database system, this understanding of hash map internals gives you the tools to make informed choices. The next time you use a `dict`, `HashMap`, or `unordered_map`, you'll know exactly what's happening under the hood and how to make the most of these incredible data structures.

Hash maps truly are awesome—and now you know why!