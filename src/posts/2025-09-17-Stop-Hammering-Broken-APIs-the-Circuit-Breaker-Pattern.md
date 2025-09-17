---
layout: layouts/post.njk
title: Stop Hammering Broken APIs - the Circuit Breaker Pattern
date: 2025-09-17
description: How to make your fetch requests production-ready by implementing the circuit breaker pattern to handle failing APIs gracefully.
excerpt: "Modern applications rarely live in isolation. A single page load might involve calls to a payments API, a recommendation service, a geolocation provider, and your own backend. This web of dependencies makes apps powerful, but also fragile. What happens if one of these services slows down or starts failing? Without safeguards, your app may keep retrying, queuing up requests, or waiting on timeouts. The result: wasted resources, frustrated users, and sometimes cascading failures that spread from one misbehaving service into the rest of your system."
tags:
- posts
- tutorials
- javascript
- typescript
---
## Introduction

Modern applications rarely live in isolation. A single page load might involve calls to a payments API, a recommendation service, a geolocation provider, and your own backend. This web of dependencies makes apps powerful, but also fragile.

What happens if one of these services slows down or starts failing? Without safeguards, your app may keep retrying, queuing up requests, or waiting on timeouts. The result: wasted resources, frustrated users, and sometimes cascading failures that spread from one misbehaving service into the rest of your system.

This is where the *circuit breaker pattern* comes in. Inspired by electrical circuits, a software circuit breaker "opens" once failures reach a threshold. While the breaker is open, calls to the failing service are blocked immediately, giving it time to recover and protecting the rest of the system. After a cooldown period, the breaker closes again and normal traffic resumes.

Circuit breakers are especially useful in multi-endpoint pipelines - scenarios where one failing dependency can cause an entire chain of requests to collapse. Think of:

- A checkout flow that needs both an orders service and a payments service.
- A user profile page that aggregates data from half a dozen microservices.
- A data processing script that calls one API and uses the results to query another.

In each case, a single failing service can bring everything down unless failures are isolated and handled gracefully.

In this article, we'll make the circuit breaker pattern concrete by building a small demo backend with multiple endpoints, then wiring them together into a pipeline. We'll show what happens when endpoints fail, how circuit breakers respond, and how you can observe the difference in practice.

## What We'll Build

To see what happens when upstream services are unreliable, we'll create a simple Express backend API with three endpoints:

- `/users` - an endpoint to get user information.
- `/orders/:id` - to fetch orders made by a user.
- `/payments/:id` - to get payment status for an order.

We'll add configurable failure rates to the orders and payments endpoints, so we can simulate instability. The users endpoint will always succeed, because without a stable starting point, the rest of the pipeline can't run. Note that as a responsible developer, your app has to deal with failures at every step, including the first one. But for this demo, we want to focus on the circuit breakers.

Once our backend is ready, we'll create a client-side script that runs a pipeline every few seconds that:

- Fetches the list of users.
- For each user, fetches their orders.
- For each order, fetches the payment status.
- Displays the results in a table.

First we simply implement this pipeline using native `fetch()`, then we switch to using a fetch wrapper that supports circuit breakers. We'll see how the behavior changes when endpoints start failing, and how circuit breakers can help keep the overall system more stable by decreasing load on failing services.

## The Backend

In this example, we'll use Express, so first make sure you have it installed:

```bash
npm install express
```

Then create a `server.js` file with the following code:

```javascript
// server.js
import express from "express";

const app = express();
const PORT = 3000;

// configurable failure rates
const ORDERS_FAILURE_RATE = parseFloat(process.env.ORDERS_FAILURE_RATE || "0.3");
const PAYMENTS_FAILURE_RATE = parseFloat(process.env.PAYMENTS_FAILURE_RATE || "1.0");

// simple in-memory data
const users = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
  { id: 3, name: "Charlie" }
];
const orders = {
  1: [{ id: 101, item: "Book" }, { id: 102, item: "Laptop" }],
  2: [{ id: 201, item: "Pen" }],
  3: [{ id: 301, item: "Notebook" }, { id: 302, item: "Keyboard" }]
};

function maybeFail(rate) {
  return Math.random() < rate;
}

// log helper
function log(req, status) {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} → ${status}`);
}

app.get("/users", (req, res) => {
  log(req, "200 (success)");
  res.json(users);
});

app.get("/orders/:id", (req, res) => {
  if (maybeFail(ORDERS_FAILURE_RATE)) {
    log(req, "500 (failure)");
    res.status(500).json({ error: "Orders service unavailable" });
  } else {
    log(req, "200 (success)");
    res.json(orders[req.params.id] || []);
  }
});

app.get("/payments/:id", (req, res) => {
  if (maybeFail(PAYMENTS_FAILURE_RATE)) {
    log(req, "500 (failure)");
    res.status(500).json({ error: "Payment service down" });
  } else {
    log(req, "200 (success)");
    res.json({ id: req.params.id, status: "paid" });
  }
});

app.listen(PORT, () => console.log(`Mock backend running on http://localhost:${PORT}`));
```

This code sets up an Express server with three endpoints. The `/users` endpoint always returns a static list of users. The `/orders/:id` and `/payments/:id` endpoints simulate failures based on configurable failure rates, which you can set using environment variables `ORDERS_FAILURE_RATE` and `PAYMENTS_FAILURE_RATE`. By default, the orders endpoint fails 30% of the time, and the payments endpoint fails 100% of the time. We log each request along with its status to the console for easy monitoring.

To run the server, use:

```bash
node server.js
```

You can adjust the failure rates by setting the environment variables when starting the server. For example, to set a 20% failure rate for orders and a 70% failure rate for payments, you can run:

```bash
ORDERS_FAILURE_RATE=0.2 PAYMENTS_FAILURE_RATE=0.7 node server.js
```

## The Client Pipeline

Our "frontend" will be a simple Node.js script that runs the pipeline every 3 seconds and displays the results in the console, after clearing the previous output. Create a `pipeline.js` file start putting it together.

First, let's define our state simply as an object holding the results of each call. The key for the orders and payments will be the user ID and order ID respectively, so we can easily look them up later. We can also define the API base URL:

```javascript
// pipeline.js
const API_BASE = "http://localhost:3000";

const state = {
  users: [],
  orders: {},
  payments: {},
};
```

The bulk of the logic will go inside a `runPipeline` function that we call every few seconds. We'll start by fetching the users, then for each user, fetch their orders, and for each order, fetch the payment status. We'll use `Promise.all` to parallelize requests where possible:

```javascript
async function runPipeline() {
  // Fetch users
  let users;
  try {
    const usersRes = await fetch(`${API_BASE}/users`);
    users = await usersRes.json();
    // Reset state if users fetch succeeded
    state.users = users;
    state.orders = {};
    state.payments = {};
  } catch (err) {
    // If there was an error fetching users, use the last known state
    renderTable();
    return;
  }

  // Fan out orders requests in parallel
  await Promise.all(
    users.map(async (user) => {
      try {
        const ordersRes = await fetch(`${API_BASE}/orders/${user.id}`);
        const orders = await ordersRes.json();
        state.orders[user.id] = orders;
        // Fan out payments requests in parallel for each user's orders
        await Promise.all(
          orders.map(async (order) => {
            try {
              const paymentRes = await fetch(`${API_BASE}/payments/${order.id}`);
              const payment = await paymentRes.json();
              (state.payments[user.id] ??= {})[order.id] = payment;
            } catch (err) {
              (state.payments[user.id] ??= {})[order.id] = null;
            }
          })
        );
      } catch (err) {
        state.orders[user.id] = [];
      }
    })
  );
  renderTable();
}
```

Here, we first try to fetch the users. If that fails, we simply render the last known state and exit early. If it succeeds, we reset the orders and payments state. This is not ideal for a real app, as without it we would have almost implemented caching, but for this demo the cache would be in the way when trying to interpret the results.

Then we have to make sure the pipeline runs every 3 seconds:

```javascript
async function loopPipeline() {
  while (true) {
    await runPipeline();
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

loopPipeline();
```

This is one way to do it. If we were using `setInterval()`, we would have to be careful to avoid overlapping runs if one takes longer than the interval. We should abort all the previous requests, which would divert attention from the main topic of this article.

Finally, we need a `renderTable` function to display the results in a table format. We'll clear the console each time to keep it tidy:

```javascript
function renderTable() {
  console.clear();
  if (!state.users.length) {
    console.log("No data to display (no users)");
    return;
  }
  const table = state.users.map((user) => {
    const orders = state.orders[user.id] || [];
    const payments = state.payments[user.id] || {};
    return {
      User: user.name,
      Orders:
        orders
          .map((order) => {
            const payment = payments[order.id];
            let paymentStatus = "-";
            if (payment === null) paymentStatus = "failed";
            else if (payment && payment.status) paymentStatus = payment.status;
            return `${order.item} (${paymentStatus})`;
          })
          .join(", ") || "-",
    };
  });
  console.table(table);
}
```

Here, we map over the users and for each user, we look up their orders and payments. We format the orders and payment statuses into a string for display. If there are no users, we simply print a message indicating that.

## Running the Example

To run the demo, first make sure your backend server is running:

```bash
node server.js
```

Then, in another terminal, run the pipeline script:

```bash
node pipeline.js
```

This will start the pipeline, which will fetch data from the backend every 3 seconds and display it in the console. You should see a table with users, their orders, and payment statuses. As the orders and payments endpoints fail according to their configured failure rates, you'll see the data changing, depending on which requests succeed or fail.

(Handling failures gracefully is where `partial data` comes in. In a real app, you might want to show cached data, indicate loading states, or provide retry options to the user etc. Sophisticated UIs have to implement sophisticated state management, it's not enough to just display the data hoping that everything works. The happy path is just one part of the story. Managing partial data and is a huge topic in itself, this article is much less ambitious and only aims to focus on the circuit breaker pattern.)

If we run the server and then the pipeline script, we might see output like this:

```
┌─────────┬───────────┬──────────────────────────────┐
│ (index) │ User      │ Orders                       │
├─────────┼───────────┼──────────────────────────────┤
│ 0       │ 'Alice'   │ 'Book (-), Laptop (-)'       │
│ 1       │ 'Bob'     │ '-'                          │
│ 2       │ 'Charlie' │ 'Notebook (-), Keyboard (-)' │
└─────────┴───────────┴──────────────────────────────┘
```

And in the server console, we would see logs of each request and its status, helping us understand how often each endpoint is failing:

```
[2025-09-17T19:56:49.010Z] GET /users → 200 (success)
[2025-09-17T19:56:49.013Z] GET /orders/1 → 200 (success)
[2025-09-17T19:56:49.013Z] GET /orders/2 → 200 (success)
[2025-09-17T19:56:49.014Z] GET /orders/3 → 500 (failure)
[2025-09-17T19:56:49.014Z] GET /payments/101 → 500 (failure)
[2025-09-17T19:56:49.014Z] GET /payments/201 → 500 (failure)
[2025-09-17T19:56:49.016Z] GET /payments/102 → 500 (failure)
[2025-09-17T19:56:52.020Z] GET /users → 200 (success)
[2025-09-17T19:56:52.022Z] GET /orders/1 → 200 (success)
[2025-09-17T19:56:52.023Z] GET /orders/2 → 500 (failure)
[2025-09-17T19:56:52.023Z] GET /orders/3 → 200 (success)
[2025-09-17T19:56:52.024Z] GET /payments/101 → 500 (failure)
[2025-09-17T19:56:52.025Z] GET /payments/301 → 500 (failure)
[2025-09-17T19:56:52.026Z] GET /payments/102 → 500 (failure)
[2025-09-17T19:56:52.027Z] GET /payments/302 → 500 (failure)
...
```

What we will see in the logs, is that a poll starts with a `/users` request, which always succeeds. Then we see three `/orders/:id` requests, one for each user. Depending on the configured failure rate, some of these will fail. For each successful orders request, we then see one or more `/payments/:id` requests. Then the cycle repeats every 3 seconds.

So we have 4-9 requests every 3 seconds in our current setup. Obviously, with more data and more complex pipelines, this can quickly grow to dozens or hundreds of requests per second. If one of the endpoints starts failing, this can lead to a lot of wasted requests hammering a service that is already struggling.

## How Circuit Breakers Help

Failing requests cause many issues. The one that circuit breakers are designed to solve is that they waste resources by continuing to send requests to a service that is already failing. This can exacerbate the problem, as the failing service may become overwhelmed and fail even more. Then rate limits may kick in, causing even more failures...

In its simplest form, the circuit breaker "opens" when failures reach a threshold, blocking further requests temporarily until the system hopefully stabilizes. After a cooldown period, the breaker "closes" again and normal traffic resumes. Of course, if the problem persists, the breaker will open again.

As even failing requests consume bandwidth and other resources, if we know that a request is most likely to fail, it's better to not send it at all. This is what a circuit breaker does - gives a little break to a struggling service, while protecting the rest of the system from being dragged down.

## Adding a Circuit Breaker to Our Pipeline

Implementing our own circuit breaker logic is possible, but it can be complex and error-prone. Instead, we'll use a library called [`ffetch`](https://www.npmjs.com/package/@gkoos/ffetch) that provides a simple way to add circuit breakers to our fetch requests. The library also supports retries, timeouts, and life-cycle hooks, making it a versatile choice for handling HTTP requests in any JavaScript environment. But you're not here for the marketing, so let's get to the point.

First, install `ffetch`:

```bash
npm install @gkoos/ffetch
```

Then, modify our `pipeline.js` to use `ffetch` instead of the native `fetch()`. We simply create a client with circuit breaker options and use it for our requests:

```javascript
// pipeline.js
import createClient from "@gkoos/ffetch";

const api = createClient({
  timeout: 5000,
  retries: 0,
  circuit: { threshold: 3, reset: 5000 },
});
```

Here, we configure the client with a timeout of 5 seconds, no retries (retries would pollute the logs for us), and a circuit breaker that opens after 3 consecutive failures and resets after 5 seconds.

Now, replace all instances of `fetch()` in the `runPipeline` function with `api()`, which uses our configured client:

```javascript
async function runPipeline() {
  // Fetch users
  let users;
  try {
    const usersRes = await api(`${API_BASE}/users`); // <--HERE
    users = await usersRes.json();
    // Only reset state if users fetch succeeded
    state.users = users;
    state.orders = {};
    state.payments = {};
  } catch (err) {
    renderTable();
    return;
  }

  // Fan out orders requests in parallel
  await Promise.all(
    users.map(async (user) => {
      try {
        const ordersRes = await api(`${API_BASE}/orders/${user.id}`); // <--HERE
        const orders = await ordersRes.json();
        state.orders[user.id] = orders;
        // Fan out payments requests in parallel for each user's orders
        await Promise.all(
          orders.map(async (order) => {
            try {
              const paymentRes = await api(`${API_BASE}/payments/${order.id}`); // <--HERE
              const payment = await paymentRes.json();
              (state.payments[user.id] ??= {})[order.id] = payment;
            } catch (err) {
              (state.payments[user.id] ??= {})[order.id] = null;
            }
          })
        );
      } catch (err) {
        state.orders[user.id] = [];
      }
    })
  );
  renderTable();
}
```

Now, when you run the pipeline script again, when the orders or payments endpoints start failing, the circuit breaker will open after 3 consecutive failures. While the breaker is open, any further requests to that endpoint will fail immediately without actually sending a request. This reduces the load on the failing service and gives it time to recover. (Well it won't recover in our case, but in a real-world scenario, it might eventually.)

To observe the circuit breaker in action, you can add some logging to the `renderTable` function to show the status of each endpoint:

```javascript
const api = createClient({
  timeout: 5000,
  retries: 0,
  circuit: { threshold: 3, reset: 5000 },
  hooks: {
    onCircuitOpen: () => {
      renderTable();
    },
    onCircuitClose: () => {
      renderTable();
    },
  },
});

...

function renderTable() {
  console.clear();
  
  const breakerStatus = api.circuitOpen ? "OPEN" : "CLOSED";
  console.log("Circuit Breaker Status:", breakerStatus);
  ...
}
```

When we create the client, we add hooks for when the circuit opens and closes, so we can re-render the table to show the updated status. In the `renderTable` function, we log whether the circuit breaker is currently open or closed.

Now, when you run the pipeline script, you should see the circuit breaker status in the console output. When the orders or payments endpoints start failing, after 3 consecutive failures, the circuit breaker will open, and you'll see "Circuit Breaker Status: OPEN". While the breaker is open, any further requests to that endpoint will fail immediately without actually sending a request. After 5 seconds, the breaker will close again, and normal traffic will resume.

The server logs will look something like this:

```
Mock backend running on http://localhost:3000
[2025-09-17T21:14:24.338Z] GET /users → 200 (success)
[2025-09-17T21:14:24.352Z] GET /orders/1 → 500 (failure)
[2025-09-17T21:14:24.353Z] GET /orders/2 → 200 (success)
[2025-09-17T21:14:24.353Z] GET /orders/3 → 500 (failure)
[2025-09-17T21:14:30.378Z] GET /users → 200 (success)
[2025-09-17T21:14:30.383Z] GET /orders/1 → 200 (success)
[2025-09-17T21:14:30.384Z] GET /orders/2 → 500 (failure)
[2025-09-17T21:14:30.384Z] GET /orders/3 → 200 (success)
[2025-09-17T21:14:30.385Z] GET /payments/101 → 500 (failure)
[2025-09-17T21:14:30.392Z] GET /payments/102 → 500 (failure)
...
```

You'll notice that after a few failures, the circuit breaker opens, and subsequent requests to the failing endpoint are skipped, as indicated in the console output. When the circuit breaker is open, no request is being sent to the server, so you won't see any corresponding log entries for those skipped requests. In the example logs above, when the circuit breaker is open for 5 seconds, no request is made to the server for the next cycle, so actually 6 seconds pass between the two polls.

Now how much difference does the circuit breaker make? It depends on the failure rates and the thresholds you set. In our example, with a 30% failure rate for orders and a 100% failure rate for payments, the circuit breaker will open frequently for payments, preventing a flood of failed requests. For orders, it may open occasionally, depending on the random failures.

Feel free to experiment with different failure rates and circuit breaker settings to see how they affect the behavior of the pipeline. You can adjust the `ORDERS_FAILURE_RATE` and `PAYMENTS_FAILURE_RATE` environment variables when starting the server, as well as the `threshold` and `reset` options when creating the `ffetch` client.

## Next Steps: Beyond Open/Closed Breakers

The simple open/closed breaker is already a big improvement over blindly hammering a failing service. But in larger, distributed systems, engineers often adopt a more nuanced variant: the *half-open circuit breaker*. This adds a third state to the breaker, allowing a few trial requests through after the cooldown period to test if the service has recovered.

Think of the three states like this:

- **Closed**: requests flow normally. Failures are counted, but traffic continues.
- **Open**: too many failures have occurred, the breaker trips and all requests are blocked immediately. Instead of even trying the call, you fail fast.
- **Half-Open**: after a cooldown period, the breaker "peeks" to see if the service has recovered. A small number of test requests are allowed through:
  - If they succeed, the breaker closes and normal traffic resumes.
  - If they fail, the breaker reopens, protecting the system again.

This middle state prevents the "thundering herd" problem where all requests flood back into a service the instant its cooldown expires. Instead, recovery is gradual and controlled.

Half-open breakers shine in environments where:

- Multiple nodes or instances may be calling the same service. If each of them retries at once, the failing service may be overwhelmed just as it's trying to recover.
- Intermittent outages occur. A backend might fail for 20 seconds, then come back. With open/closed only, you risk hammering it every time the breaker resets, causing a failure spiral.
- Performance degradation is as harmful as outright failure. A half-open breaker can keep load low until the service proves it's truly healthy.

In short: the half-open state improves stability and speeds up recovery while minimizing the risk of re-overloading fragile systems.

`ffetch` intentionally keeps its breaker simple: open/closed only. That makes sense for local scripts, pipelines, and client-side code where you don't want a lot of state management. If you do want half-open behavior, you can layer it on top of ffetch, but the implementation (especially in distributed systems where it actually matters) can be quite complex and beyond the scope of this article - maybe a future one.

### Takeaway

- Open/closed breakers (`ffetch`'s default) are simple and effective for most local applications, CLI tools, and small services.
- Half-open breakers are a valuable extension in distributed, high-traffic systems where recovery has to be carefully controlled.
- You don't need to rewrite `ffetch` - just wrap it. Think of `ffetch` as the foundation (resilient requests) and your custom half-open logic as the policy layer (when to allow traffic back in).

## Conclusion

In this article, we took the circuit breaker pattern out of the abstract and put it into practice. Starting from a small mock backend with multiple endpoints, we built a pipeline that showed how failures ripple through a system and how circuit breakers can change the picture.

We saw that once an endpoint starts failing consistently, the breaker opens, requests are blocked immediately, and the rest of the system avoids wasting time and resources on calls that are unlikely to succeed. With retries, delays, and logging layered in, the breaker becomes a lightweight but powerful tool for keeping pipelines stable under pressure.  

Circuit breakers are not a cure-all. They won't fix broken services or replace careful error handling. In simple cases, a retry strategy might be enough - in others, adding a breaker prevents cascading failures and buys breathing room for recovery. The right choice depends on how critical the dependency is, how often it fails, and what impact failures have downstream.

The takeaway is this: circuit breakers are a practical resilience pattern. They're not mandatory everywhere, but when external services are part of the picture, they often make the difference between a system that collapses under stress and one that degrades predictably. In multi-endpoint pipelines like the one we built, circuit breakers help prevent one failing service from dragging the rest of the system down. For other techniques to improve resilience, see also [Making Your Fetch Requests Production-Ready with ffetch](https://blog.gaborkoos.com/posts/2025-09-13-Making-Your-Fetch-Requests-Production-Ready-With-Ffetch/).