---
layout: layouts/post.njk
title: "The Database Zoo: Probabilistic / Approximate Databases"
date: 2025-10-02
description: An in-depth look at Probabilistic / Approximate Databases, their architecture, use cases, and how they differ from traditional databases.
excerpt: "Modern systems often generate vast streams of high-volume, high-cardinality, or continuously changing data. Performing exact queries - like counting unique users on a website, tracking event frequencies, or checking membership in massive sets - can be slow, memory-intensive, or even infeasible on traditional relational or NoSQL databases."
tags:
- posts
- database zoo
- databases
---
*This post is part of* The Database Zoo: Exotic Data Storage Engines *, a series exploring purpose-built databases engineered for specific workloads. Each post dives into a different type of specialized engine, explaining the problem it solves, the design decisions behind its architecture, how it stores and queries data efficiently, and real-world use cases. The goal is to show not just what these databases are, but why they exist and how they work under the hood.*

## Introduction

Modern systems often generate vast streams of high-volume, high-cardinality, or continuously changing data. Performing exact queries - like counting unique users on a website, tracking event frequencies, or checking membership in massive sets - can be slow, memory-intensive, or even infeasible on traditional relational or NoSQL databases.

Probabilistic and approximate databases solve this problem by using compact data summaries, such as *Bloom filters*, *HyperLogLog*, and *sketches*, to provide fast, memory-efficient answers. Instead of storing every individual data point, these engines maintain summaries that can be updated incrementally, merged across partitions, and queried efficiently. By accepting a small, controlled error, they achieve real-time analytics at scale.

Common workloads where these databases excel include:

- **Web and marketing analytics**: Estimating the number of unique visitors per hour or day without storing every single user ID.
- **Streaming event aggregation**: Summarizing billions of events in near real-time for dashboards or alerting pipelines.
- **High-cardinality telemetry**: Counting distinct devices, sensors, or metrics in IoT systems where full retention is impractical.

General-purpose databases can perform these queries, but at scale, they require large amounts of memory, compute, and careful sharding. Probabilistic engines trade a tiny fraction of accuracy for huge gains in speed, memory efficiency, and scalability.

In this post, we will explore how these systems work under the hood, focusing on their core architecture, the data structures they employ, typical query patterns, and real-world use cases. By the end, you will understand when and why to use probabilistic databases, and how engines like Druid and Materialize implement approximate computation efficiently.

## Why General-Purpose Databases Struggle

Even the most robust relational and NoSQL databases face challenges when dealing with high-volume or high-cardinality datasets. Exact computation over these workloads can quickly overwhelm memory, CPU, and storage, creating bottlenecks that probabilistic databases are designed to avoid.

### High-Cardinality Aggregations

Counting distinct elements, such as users, devices, or events, can be prohibitively expensive:

- **Memory usage**: Storing every unique key may require gigabytes or terabytes of memory for large datasets.
- **Computation overhead**: Aggregating billions of records per second can exceed the processing capacity of conventional databases.
- **Latency**: Queries may take minutes or longer, making real-time analytics infeasible.

Probabilistic data structures, like *HyperLogLog*, provide approximate distinct counts using small, fixed-size summaries, dramatically reducing memory and compute requirements while keeping errors within predictable bounds.

### Real-Time Streaming Queries

Many workloads require near-instant answers over continuously arriving data:

- **High ingestion rates**: Millions of events per second may arrive, overwhelming traditional batch-oriented systems.
- **Query freshness**: Dashboards and alerting pipelines need low-latency responses, which are difficult to achieve when aggregating raw data.
- **Incremental updates**: Maintaining exact aggregates in real time requires complex locking, transaction management, and memory management.

Probabilistic databases maintain incremental summaries of the data stream, allowing low-latency queries without materializing the full dataset.

### Set Membership and Filtering

Checking whether an item belongs to a large set can be impractical:

- **Storage requirements**: Exact membership structures require storing all elements, which is costly for billions of keys.
- **Query performance**: Sequential scans or joins over massive tables are slow and inefficient.
- **Operational complexity**: Maintaining indexes or partitions for high-cardinality sets increases administrative overhead.

*Bloom filters* provide a compact representation that guarantees no false negatives and a controllable false positive rate, enabling fast membership checks without storing all raw data. This makes them ideal for scenarios where space is at a premium and occasional false positives are acceptable.

### Summary

General-purpose databases can technically handle large-scale aggregation and streaming workloads, but at significant cost:

- High memory and storage requirements
- Slower query performance for real-time analytics
- Increased operational complexity for indexing and sharding

Probabilistic databases are purpose-built to address these challenges. By maintaining compact, approximate summaries, they provide fast, memory-efficient answers over high-volume or high-cardinality datasets—workloads that would overwhelm traditional engines.

## Core Architecture

Probabilistic and approximate databases are designed to provide efficient analytics over massive, high-cardinality, or streaming datasets. Rather than storing every data point, these systems rely on compact probabilistic summaries that can be updated incrementally and queried efficiently. The architecture revolves around key principles: memory efficiency, incremental updates, mergeable summaries, and controllable approximation.

### Probabilistic Data Structures

These databases rely on specialized data structures to summarize large datasets with minimal memory:

- **Bloom Filters**: Fast, space-efficient membership tests. Guarantees no false negatives and a tunable false positive rate. They use multiple hash functions to set bits in a bit array, allowing quick checks for element presence. Insertions and queries are O(k), where k is the number of hash functions. The challenge is finding k different hash functions that are fast and uniformly distribute inputs.
- **HyperLogLog (HLL)**: Provides approximate counts of distinct elements using fixed memory. Error rates are predictable and low (typically 1–2%). They use hash functions to map elements to bit patterns, estimating cardinality based on the position of the leftmost 1 bit. HLL is highly mergeable, making it ideal for distributed systems.
- **Count-Min Sketch**: Estimates frequencies of elements in a data stream with bounded errors. Useful for identifying heavy hitters. It uses multiple hash functions to map elements to a 2D array, allowing frequency estimates with O(1) query time and O(log(1/δ)/ε) space, where ε is the error margin and δ is the confidence level.
- **Quantile Sketches**: Approximate quantiles (e.g., median, percentiles) in streaming data. They maintain a summary of the data distribution, allowing efficient quantile queries with controlled error bounds.
- **Top-K Sketches**: Tracks the most frequent items efficiently without storing all elements. It uses a combination of hash functions and priority queues to maintain the top K items in a compact form.

These structures allow queries to be executed on summaries rather than raw data, significantly reducing memory and compute overhead. As we can see, hash functions are a critical component of these data structures, enabling efficient mapping and retrieval of information.

### Streaming and Incremental Aggregation

High-throughput streams require incremental computation rather than batch processing:

- **Update-on-arrival**: Each incoming event updates the relevant sketch or filter immediately. This allows the system to maintain up-to-date summaries without reprocessing the entire dataset. Updates are typically O(1) or O(k) depending on the data structure.
- **Low-latency queries**: Since summaries are compact and pre-aggregated, queries can be answered in milliseconds, enabling real-time analytics.
- **Mergeable summaries**: Summaries from multiple partitions or nodes can be combined efficiently, supporting horizontal scaling. This is particularly important in distributed systems where data is partitioned across multiple nodes. For example, HyperLogLog sketches can be merged by performing a bitwise OR operation on their bit arrays, allowing for efficient aggregation of distinct counts across partitions.
- **Windowed computation**: Sliding or tumbling windows allow approximate aggregates over recent data without storing full history. This is crucial for real-time analytics where only the most recent data is relevant. It can be implemented for example by maintaining separate sketches for each window and merging them as needed.

This approach enables real-time dashboards, alerting, and analytics over streams with minimal latency.

### Storage Model

Unlike traditional databases that store raw rows, probabilistic systems focus on storing summaries:

- **Compact, fixed-size structures**: Memory usage is predictable, regardless of input size. For example, a HyperLogLog sketch typically uses only a few kilobytes of memory, regardless of whether it is summarizing thousands or millions of distinct elements.
- **Optional raw data retention**: Some systems store raw events for verification or auditing, but queries primarily rely on summaries.
- **Append-only logs**: If incoming events are stored, they are often written to an append-only log for durability, while summaries are updated in memory. This ensures that data is not lost in case of failures and allows for replaying events if needed.
- **Efficient serialization**: Summaries can be serialized and transmitted across the network with minimal overhead, facilitating distributed processing. This is particularly important in distributed systems where summaries need to be shared between nodes for merging or querying.
- **Hierarchical storage**: Recent data may be kept in memory for low-latency access, while older summaries are archived on disk or in object storage.
- **Versioning and snapshots**: Some systems support versioned summaries to enable time-travel queries or historical analysis.
- **Partitioning**: Summaries can be partitioned by time, user, or other dimensions for parallel processing and incremental merging.

This design maximizes throughput and minimizes storage costs while supporting large-scale analytics.

### Accuracy and Error Control

Approximation comes with trade-offs, but these systems provide predictable guarantees:

- **Configurable error bounds**: Users can tune the size of sketches or filters to balance accuracy and memory usage.
- **Probabilistic guarantees**: Errors are bounded and typically follow well-understood statistical distributions. For example, a HyperLogLog sketch with a standard error of 1.04/√m (where m is the number of registers) provides a predictable accuracy level.
- **Graceful degradation**: As data volume increases, accuracy may decrease slightly, but remains within acceptable limits.
- **Monitoring and validation**: Systems often provide tools to measure error rates and validate approximations against sample data.

By controlling accuracy, engineers can make informed decisions about acceptable trade-offs for their workload.

### Summary

The core architecture of probabilistic databases revolves around four pillars:

- Efficient, compact summaries instead of raw storage
- Incremental and mergeable updates for real-time analytics
- Streaming-oriented storage and partitioning for horizontal scalability
- Predictable accuracy and error bounds for controlled approximations

These architectural decisions enable fast, memory-efficient queries over datasets that would overwhelm general-purpose databases, making probabilistic engines uniquely suited for high-volume, high-cardinality, or streaming workloads.

## Query Execution and Patterns

Probabilistic databases expose familiar, often SQL-like query interfaces - but the execution engine operates on summaries instead of raw data. This shifts how queries are planned, optimized, and answered. While results may be approximate, the trade-off is consistent performance at scale.

### Approximate Aggregations

Common aggregate queries are executed against compact data structures:

- **COUNT(DISTINCT …)**: Uses HyperLogLog to estimate cardinality with low error. The query planner recognizes the use of COUNT(DISTINCT) and routes it to the HyperLogLog summary, which provides an approximate count in constant time.
- **SUM, AVG, MIN, MAX**: SUM and AVG can be computed exactly if the raw data is available, or approximated using sketches. MIN and MAX can be approximated using specialized sketches that maintain the minimum or maximum values seen so far.
- **FREQUENCY ESTIMATION**: Employs Count-Min Sketch or Top-K structures to return approximate counts of items. 
- **SET MEMBERSHIP**: Bloom filters quickly answer EXISTS or IN checks without scanning full tables.

These approximations enable interactive analytics on massive datasets where exact queries would be infeasible.

### Streaming Queries

Probabilistic engines are especially well-suited for continuous queries over streams:

- **Sliding windows**: Compute rolling distinct counts or frequencies without retaining all raw events.
- **Real-time dashboards**: Aggregate millions of events per second with sub-second latency. Dashboards can be updated in real-time by continuously querying the incremental summaries, providing up-to-date insights without the need for full data scans.
- **Alerting pipelines**: Trigger conditions based on approximate metrics (e.g., "unique users in the last 5 minutes > 100k").

The incremental nature of summaries ensures that query performance remains stable as streams grow.

### Merge and Parallel Execution

Because summaries are mergeable, queries can be distributed across nodes:

- Each partition maintains its own Bloom filter, sketch, or HLL.
- Results are merged during query execution to form a global summary.
- Parallelism ensures scalability across clusters without the complexity of global state synchronization.

This makes probabilistic databases naturally compatible with distributed and cloud-native environments.

### Accuracy Considerations

While results are approximate, queries provide bounded guarantees:

- Errors are predictable (e.g., ±1% on a cardinality estimate).
- Users can increase memory allocation to improve accuracy.
- Some systems allow hybrid queries: using exact answers for small subsets, and approximate summaries for large aggregations.

This balance of control and performance makes probabilistic queries practical in real-world analytics.

### Summary

Typical query patterns in probabilistic databases include:

- Distinct counts, frequency estimation, and membership checks executed via sketches and filters
- Streaming queries that operate on incremental, windowed data
- Mergeable, distributed execution across clusters
- Configurable accuracy trade-offs for predictable results

Instead of trying to answer every query exactly, these systems provide fast, approximate answers that scale to workloads traditional databases cannot handle in real time.

## Use Cases

Probabilistic databases are not general-purpose replacements, but they excel in scenarios where **scale and speed matter more than exactness**. By trading perfect accuracy for efficiency, they enable applications that would otherwise be impractical.

### Web and Marketing Analytics

Tracking unique users, clicks, or sessions across billions of events is a classic high-cardinality problem:

- **Problem**: Counting distinct visitors requires storing every unique user ID.
- **Solution**: HyperLogLog summaries maintain approximate counts with fixed memory.
- **Outcome**: Real-time dashboards can display active users or conversions without waiting for heavy batch jobs.

### Fraud Detection and Security

Membership and frequency queries help identify suspicious behavior:

- **Problem**: Detecting repeated login attempts or anomalies in transaction streams.
- **Solution**: Bloom filters and Count-Min Sketches track unusual activity with low overhead.
- **Outcome**: Alerts can be triggered in near real time, even on massive event streams.

### IoT and Telemetry

Billions of devices emit continuous metrics, often with high cardinality:

- **Problem**: Storing and analyzing raw telemetry data is prohibitively expensive.
- **Solution**: Sketches provide approximate counts and frequency estimates across streams.
- **Outcome**: Operators can monitor fleets of devices efficiently without exploding storage costs.

### Log Analysis and Observability

Monitoring infrastructure generates high-volume logs with diverse keys (IPs, sessions, endpoints):

- **Problem**: Queries like “how many unique IPs hit this endpoint in the last hour?” are too costly for exact answers.
- **Solution**: Probabilistic summaries deliver fast estimates for observability platforms.
- **Outcome**: Engineers get timely insights into system health without waiting for batch aggregations.

### Recommendation Systems

Large-scale personalization engines require efficient user-event aggregation:

- **Problem**: Tracking item popularity across millions of users in real time.
- **Solution**: Top-K sketches identify trending items without storing every interaction.
- **Outcome**: Recommendations can be updated dynamically and cheaply.

### Summary

Key workloads where probabilistic databases shine:

- **Analytics**: Counting users, sessions, clicks, or events at web scale
- **Security**: Detecting suspicious or anomalous behaviors in large streams
- **Telemetry**: Aggregating IoT metrics with minimal storage overhead
- **Observability**: Fast, approximate log and metric queries
- **Recommendations**: Identifying trends and frequent items in massive datasets

In all of these cases, **approximate answers are good enough**, provided they are fast, scalable, and memory efficient.

Note that there are overlaps with other specialized databases. For example, time-series databases like InfluxDB or TimescaleDB can handle high-throughput telemetry, but may struggle with high-cardinality distinct counts at scale. Similarly, stream processing frameworks like Apache Flink or Kafka Streams can perform aggregations, but often require more operational complexity and resources than a purpose-built probabilistic database.

## Examples of Probabilistic Databases

Several modern data systems incorporate probabilistic techniques to achieve scale and performance. While they are not always branded as "probabilistic databases", their query engines rely heavily on approximate data structures and execution strategies.

### [Apache Druid](https://druid.apache.org/)

**Overview**: 

A real-time analytics database designed for high-ingestion event streams and interactive queries.

**Probabilistic Features**:

- HyperLogLog for approximate distinct counts
- Theta Sketches for set operations (union, intersection, difference)
- Quantile sketches for percentile estimation

**Architecture Highlights:**

- **Columnar Storage**: Optimized for analytical queries, allowing for efficient compression and fast scans.
- **Distributed Execution**: Leverages a cluster of nodes to parallelize query processing and data ingestion.
- **Real-time Ingestion**: Supports high-throughput data streams with low-latency query capabilities.

**Trade-offs**:

Just like every approximate database, Druid's use of probabilistic data structures allows it to handle large-scale data with low latency, but it may sacrifice some accuracy in the process. Users must be aware of these trade-offs when designing their data models and queries.

**Use Cases**:

Interactive dashboards, clickstream analysis, fraud detection, and monitoring large-scale event data.

Druid combines columnar storage, distributed execution, and probabilistic summaries to deliver sub-second query performance on billions of rows.

### [Materialize](https://materialize.com/)

**Overview**: 

A streaming SQL database that continuously maintains query results as new data arrives.

**Probabilistic Features**:

- Approximate aggregations via sketches
- Incremental updates for real-time distinct counts and frequency estimates
- Integration with streaming pipelines (Kafka, Debezium) for low-latency analytics

**Architecture Highlights:**

- **Streaming-first**: Designed to process continuous data streams with low latency.
- **Incremental View Maintenance**: Updates query results incrementally as new data arrives, avoiding full recomputation.
- **SQL Interface**: Provides a familiar SQL interface for defining and querying data.
- **Distributed Execution**: Can scale horizontally by distributing data and computation across multiple nodes.

**Trade-offs**:

Materialize prioritizes low-latency updates and real-time analytics, which may lead to approximate results for certain queries. Users can configure the level of approximation based on their requirements, so like with most approximate systems, users must make informed decisions about the trade-offs between accuracy and performance.

**Use Cases**: 

Real-time dashboards, anomaly detection, and operational monitoring.

Materialize focuses on keeping results fresh rather than re-computing from scratch, making probabilistic approaches essential for performance.

### [ClickHouse](https://clickhouse.com/)

**Overview**: 

A columnar OLAP database optimized for analytical queries on very large datasets.

**Probabilistic Features**:

- Functions like `uniqHLL12` for approximate distinct counts
- Aggregation sketches for quantiles and set operations

**Architecture Highlights:**

- **Columnar Storage**: Enables efficient data compression and fast read performance for analytical workloads.
- **Vectorized Execution**: Processes data in batches to maximize CPU efficiency.
- **Distributed Processing**: Supports sharding and replication for high availability and scalability.
- **MergeTree Engine**: A powerful storage engine that supports efficient data insertion and querying.
- **Materialized Views**: Allows pre-aggregation of data for faster query responses.

**Trade-offs**:

As with other probabilistic databases, understanding the trade-offs between speed, memory usage, and accuracy is crucial when designing queries and data models.

**Use Cases**: 

Web analytics, telemetry, log analysis, and metrics dashboards.

Though not a "pure" probabilistic database, ClickHouse provides built-in approximate functions widely used in production analytics.

## [RedisBloom](https://redis.io/probabilistic/)

**Overview**: 

A Redis module providing probabilistic data structures as first-class citizens.

**Probabilistic Features**:

- Bloom filters
- Count-Min Sketch, Cuckoo filters, and Top-K sketches
- Cuckoo filters (an alternative to Bloom filters with additional support for deletion of elements from a set)
- Top-K sketches

**Trade-offs**:

Users must make the same informed decisions about the trade-offs between accuracy and performance as with other approximate systems.

**Use Cases**: 

Real-time membership checks, fraud detection, caching optimization, and telemetry aggregation.

RedisBloom demonstrates how probabilistic techniques can be embedded into existing systems for specialized workloads.

## Trade-Offs

The defining trade-off of probabilistic databases is simple:

- **Accuracy is sacrificed** in exchange for massive gains in performance, scalability, and efficiency.

Unlike other database families, there are few other compromises:

- **Storage and memory efficiency** are usually better than in general-purpose systems.
- **Query latency** is lower, since summaries are compact and mergeable.
- **Scalability** is easier, as summaries distribute naturally across nodes.

The cost is that results are approximate, though error bounds are well understood and tunable. For many real-world use cases—analytics, observability, telemetry—this trade-off is acceptable, as exact answers are rarely worth the additional cost.

## Real-World Examples

To see how these systems work in practice, let's look at scenarios where probabilistic approaches deliver value:

### Netflix – Streaming Analytics with Druid

Netflix uses Apache Druid to power real-time dashboards for user activity and content engagement. Druid's use of HyperLogLog and sketches allows engineers to track distinct users, session counts, and engagement metrics across millions of concurrent streams with sub-second latency.

### Yelp – User Behavior Analytics

Yelp relies on Druid for interactive analytics on clickstream and business engagement data. With approximate queries, they can aggregate billions of daily events to understand user behavior and ad performance without resorting to costly batch jobs.

### Shopify – Operational Monitoring with Materialize

Shopify adopted Materialize to process streaming data from Kafka in real time. Approximate aggregations help them monitor high-volume event streams (such as checkout attempts or API calls) continuously, keeping operational dashboards fresh without overloading storage.

### Cloudflare – Edge Analytics

Cloudflare uses ClickHouse for network and security analytics across trillions of HTTP requests per day. Built-in approximate functions (`uniqHLL12`, quantile sketches) allow engineers to quickly answer questions like “how many unique IPs attacked this endpoint in the last 10 minutes?” across global data.

### RedisBloom in Fraud Detection

Several fintech companies embed RedisBloom in fraud detection pipelines. Bloom filters and Count-Min Sketches let them flag suspicious transaction patterns (for example, repeated failed login attempts across accounts) without storing all raw transaction data in memory.

## Closing Thoughts

Probabilistic and approximate databases occupy a unique space in the database ecosystem. They are not designed for transactional workloads, nor do they aim for perfect accuracy. Instead, they embrace the reality that at web scale, "fast and close enough" beats "slow and exact".

By relying on Bloom filters, HyperLogLog, sketches, and similar techniques, these systems unlock analytics that would otherwise be impossible in real time. The trade-off - giving up a fraction of accuracy - is minor compared to the benefits in performance, scalability, and cost efficiency.

From Netflix and Shopify to Cloudflare and fintech platforms, some of the largest data-driven companies in the world already rely on probabilistic techniques in production. For organizations dealing with massive, fast-moving, or high-cardinality datasets, this database family offers a practical, battle-tested way to keep analytics interactive and affordable.