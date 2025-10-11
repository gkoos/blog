---
layout: layouts/post.njk
title: "Node.js vs Go in Practice: Performance Comparison of chaos-proxy and chaos-proxy-go"
date: 2025-10-11
description: "Compare the performance of chaos-proxy in Node.js vs Go for HTTP chaos testing. See benchmarks, results, and practical advice for choosing the right proxy for resilient full stack app testing."
excerpt: "The original chaos-proxy was developed in Node.js, primarily to support testing of TypeScript and JavaScript applications. Node's event-driven model and npm ecosystem made it a natural fit for rapid development and for supporting custom middleware written in JS/TS - features that are especially valuable for frontend and full-stack teams."
tags:
- posts
- testing
- javascript
- typescript
- golang
---
The original [chaos-proxy](https://github.com/fetch-kit/chaos-proxy) was developed in Node.js, primarily to support testing of TypeScript and JavaScript applications. Node's event-driven model and npm ecosystem made it a natural fit for rapid development and for supporting custom middleware written in JS/TS - features that are especially valuable for frontend and full-stack teams.

However, unlike [chaos-fetch](https://github.com/fetch-kit/chaos-fetch), another testing tool, which is tightly coupled to JS runtimes, chaos-proxy's core concept is language-agnostic: it's a standalone HTTP proxy for injecting chaos (latency, failures, header/body transforms, etc.) into any API traffic. This opens the door to reimplementing the proxy in a language better suited for raw performance and concurrency, like Go.

In this article, I benchmark the original Node.js/Express-based chaos-proxy against a new Go implementation, chaos-proxy-go. While the Go version can't run custom JS/TS middleware, it aims to deliver the same core chaos features with much higher throughput and lower latency. Using a [Caddy](https://caddyserver.com/) server as the backend and the [hey](https://github.com/rakyll/hey) tool for load testing, I'll compare both proxies (and direct Caddy) in a controlled environment, sharing all configs and results for reproducibility.

## System & Test Environment

To ensure a fair and reproducible comparison, all benchmarks were run locally on the same machine with minimal background activity. Below are the full system specifications and environment details:

### System Specs:

- CPU: AMD Ryzen 7 5800H with Radeon Graphics
- Cores: 8 physical cores
- Threads: 16 logical processors (SMT enabled)
- Base Clock: 3.2 GHz
- RAM: 16GB DDR4
- Operating System: Windows 10 Home 22H2 64-bit

### Test Setup:

All tests were performed on localhost to eliminate network variability.
The backend API was served by a Caddy server running on port 8080.
Both chaos-proxy (Node.js) and chaos-proxy-go were configured to proxy requests to the Caddy backend.
No other heavy processes were running during the benchmarks.
Each test scenario was run multiple times, and the best/average results are reported.
Software Versions:

- Node.js: v24.2.0
- Go: go1.25.1 windows/amd64
- Caddy: v2.10.2 h1:g/gTYjGMD0dec+UgMw8SnfmJ3I9+M2TdvoRL/Ovu6U8=
- hey: v0.1.4
- chaos-proxy: v2.0.0 (latest at 11/10/2025)
- chaos-proxy-go: v0.0.5 (latest at 11/10/2025)

## Backend Setup: Caddy Server

For all benchmarks, I used a Caddy server as the backend API. Caddy is a modern, fast, and easy-to-configure web server, making it ideal for consistent, low-overhead benchmarking.

Caddyfile Configuration:

```caddy
# Caddyfile
http://localhost:8080 {
	# Add CORS headers for all responses
	header {
		Access-Control-Allow-Origin *
		Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS"
		Access-Control-Allow-Headers "Content-Type, Authorization"
		Content-Type application/json
	}

	# Simple JSON API endpoint	
	route /api/hello {
		respond `{
		"message": "Hello, World!",
		"server": "Caddy",
		"timestamp": "2025-10-03T22:00:00Z"}
		` 200
	}

	# Log all requests
	log {
		output file access.log
		format json
	}
}
```

We use a single `/api/hello` endpoint for benchmarking that returns a simple JSON response. The CORS headers ensure compatibility with any client, and logging is enabled for potential further analysis.

This setup ensures that the backend is not a bottleneck and that all proxy benchmarks reflect the overhead of the proxy layer itself.

## Proxy Setups

To compare the performance impact of each proxy implementation, I tested three scenarios:

### 1. Direct to Caddy (Baseline)
Requests are sent straight to the Caddy backend at `http://localhost:8080/api/hello`, with no proxy in between. This provides a baseline for the lowest possible latency and highest throughput.

### 2. chaos-proxy (Node.js/Koa)

The original chaos-proxy is a Node.js/Express-based HTTP proxy designed for injecting chaos into API traffic. 

For this benchmark:

- chaos-proxy listens on http://localhost:5000
- It is configured to forward requests to the Caddy backend at http://localhost:8080
- No custom JS/TS middleware was used for these tests

The config file (`chaos.yaml`) used is simply

```yaml
target: http://localhost:8080
port: 5000
```

### 3. chaos-proxy-go (Go)

chaos-proxy-go is a Go reimplementation of the same proxy concept, focused on performance and concurrency.

- chaos-proxy-go also listens on http://localhost:5000
- It proxies requests to the same Caddy backend at http://localhost:8080
- All core chaos features are supported, but custom JS/TS middleware is not
- Started using the compiled Go binary


Configuration Notes:

- Both proxies used the same minimal configuration to ensure a fair comparison.
- No additional middleware or plugins were enabled during the benchmarks.
- All tests used the `/api/hello` endpoint for consistency.
- This setup allows for a direct, apples-to-apples comparison of the overhead introduced by each proxy implementation, as well as the baseline performance of the backend itself.
- We are not testing the speed of the chaos features (latency injection, failures, etc.) here, just the raw proxy performance.

## Benchmarking Methodology

To ensure a fair and transparent comparison, I used the same benchmarking tool, request pattern, and methodology for all scenarios. The backend was restarted between tests to clear any caches.

### Test Command:
For each scenario, I ran `hey -n 1000 -c 50 http://localhost:<port>/api/hello`

Where:

- `-n 1000`: Total number of requests per test run.
- `-c 50`: Number of concurrent clients (connections).
- `<port>`: 8080 for direct Caddy, 5000 for both chaos-proxy and chaos-proxy-go

### Reproducibility:

All configuration files, commands, and system specs are included in this article. Anyone with a similar setup should be able to reproduce these results.

## Results

### 1. Direct to Caddy (Baseline)

```bash
./hey -n 1000 -c 50 http://localhost:8080/api/hello

Summary:
  Total:        0.0352 secs
  Slowest:      0.0121 secs
  Fastest:      0.0001 secs
  Average:      0.0016 secs
  Requests/sec: 28383.8519

  Total data:   94000 bytes
  Size/request: 94 bytes

Response time histogram:
  0.000 [1]     |
  0.001 [567]   |■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
  0.003 [342]   |■■■■■■■■■■■■■■■■■■■■■■■■
  0.004 [32]    |■■
  0.005 [5]     |
  0.006 [2]     |
  0.007 [19]    |■
  0.009 [8]     |■
  0.010 [3]     |
  0.011 [2]     |
  0.012 [19]    |■


Latency distribution:
  10% in 0.0002 secs
  25% in 0.0005 secs
  50% in 0.0012 secs
  75% in 0.0018 secs
  90% in 0.0024 secs
  95% in 0.0063 secs
  99% in 0.0116 secs

Details (average, fastest, slowest):
  DNS+dialup:   0.0002 secs, 0.0001 secs, 0.0121 secs
  DNS-lookup:   0.0002 secs, 0.0000 secs, 0.0047 secs
  req write:    0.0001 secs, 0.0000 secs, 0.0017 secs
  resp wait:    0.0011 secs, 0.0001 secs, 0.0058 secs
  resp read:    0.0002 secs, 0.0000 secs, 0.0016 secs

Status code distribution:
  [200] 1000 responses
```

### 2. chaos-proxy (Node.js/Koa)

```bash
./hey -n 1000 -c 50 http://localhost:5000/api/hello

Summary:
  Total:        0.2346 secs
  Slowest:      0.0430 secs
  Fastest:      0.0049 secs
  Average:      0.0115 secs
  Requests/sec: 4262.3420

  Total data:   94000 bytes
  Size/request: 94 bytes

Response time histogram:
  0.005 [1]     |
  0.009 [9]     |
  0.013 [880]   |■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
  0.016 [60]    |■■■
  0.020 [0]     |
  0.024 [8]     |
  0.028 [0]     |
  0.032 [10]    |
  0.035 [22]    |■
  0.039 [0]     |
  0.043 [10]    |


Latency distribution:
  10% in 0.0093 secs
  25% in 0.0097 secs
  50% in 0.0103 secs
  75% in 0.0110 secs
  90% in 0.0126 secs
  95% in 0.0224 secs
  99% in 0.0417 secs

Details (average, fastest, slowest):
  DNS+dialup:   0.0002 secs, 0.0049 secs, 0.0430 secs
  DNS-lookup:   0.0002 secs, 0.0000 secs, 0.0046 secs
  req write:    0.0000 secs, 0.0000 secs, 0.0002 secs
  resp wait:    0.0112 secs, 0.0049 secs, 0.0370 secs
  resp read:    0.0000 secs, 0.0000 secs, 0.0005 secs

Status code distribution:
  [200] 1000 responses
```

### 3. chaos-proxy-go (Go)

```bash
./hey -n 1000 -c 50 http://localhost:5000/api/hello

Summary:
  Total:        0.1133 secs
  Slowest:      0.0222 secs
  Fastest:      0.0004 secs
  Average:      0.0053 secs
  Requests/sec: 8828.0577

  Total data:   94000 bytes
  Size/request: 94 bytes

Response time histogram:
  0.000 [1]     |
  0.003 [202]   |■■■■■■■■■■■■■■■■■■■■■■■■■
  0.005 [318]   |■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
  0.007 [214]   |■■■■■■■■■■■■■■■■■■■■■■■■■■■
  0.009 [135]   |■■■■■■■■■■■■■■■■■
  0.011 [59]    |■■■■■■■
  0.013 [57]    |■■■■■■■
  0.016 [6]     |■
  0.018 [4]     |■
  0.020 [2]     |
  0.022 [2]     |


Latency distribution:
  10% in 0.0018 secs
  25% in 0.0028 secs
  50% in 0.0046 secs
  75% in 0.0071 secs
  90% in 0.0099 secs
  95% in 0.0118 secs
  99% in 0.0140 secs

Details (average, fastest, slowest):
  DNS+dialup:   0.0002 secs, 0.0004 secs, 0.0222 secs
  DNS-lookup:   0.0002 secs, 0.0000 secs, 0.0046 secs
  req write:    0.0000 secs, 0.0000 secs, 0.0009 secs
  resp wait:    0.0048 secs, 0.0004 secs, 0.0157 secs
  resp read:    0.0001 secs, 0.0000 secs, 0.0060 secs

Status code distribution:
  [200] 1000 responses
```

## Analysis

The benchmark results highlight the performance impact of each proxy layer:

Scenario | Requests/sec | Avg Latency (s) | 99th %ile Latency (s) | Fastest (s) | Slowest (s) | Errors
--- | --- | --- | --- | --- | --- | ---
Direct to Caddy | 28,384 | 0.0016 | 0.0116 | 0.0001 | 0.0121 | 0
chaos-proxy (Node.js) | 4,262 | 0.0115 | 0.0417 | 0.0049 | 0.0430 | 0
chaos-proxy-go (Go) | 8,828 | 0.0053 | 0.0140 | 0.0004 | 0.0222 | 0

### Key Observations

- Unsurprisingly, direct to Caddy (baseline) achieved the highest throughput and lowest latency, as expected for a direct backend call.
- chaos-proxy (Node.js) introduced significant overhead, reducing throughput by ~85% and increasing average latency by over 7x compared to direct Caddy. The 99th percentile latency was especially high, indicating more frequent slow requests under load.
- chaos-proxy-go (Go) performed much closer to the baseline, with throughput more than double that of the Node.js version and average latency less than half. The 99th percentile latency was also much lower and the response time distribution was tighter, showing more consistent performance.

## Conclusion

This benchmark demonstrates the performance advantages of using Go for an HTTP proxy compared to Node.js. While the original chaos-proxy in Node.js is highly extensible and integrates well with JS/TS applications, it incurs a substantial performance penalty under load.
If you need maximum performance and don't require custom JavaScript/TypeScript middleware, chaos-proxy-go is the clear winner. For teams prioritizing extensibility in JS/TS, the original chaos-proxy remains a flexible option—just be aware of the performance tradeoff.