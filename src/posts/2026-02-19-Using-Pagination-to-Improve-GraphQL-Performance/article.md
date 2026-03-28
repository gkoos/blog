---
layout: layouts/post.njk
title: Using Pagination to Improve GraphQL Performance
date: 2026-02-19
description: "Exploring how pagination strategies can impact GraphQL performance in Node.js applications."
excerpt: "GraphQL makes it easy to request exactly the data you need, but that flexibility can quickly turn into a performance problem when queries return large result sets. A single field that returns all items may work fine during development, yet silently degrade into slow responses, high memory usage, or even process crashes as data volume grows."
tags:
- posts
- javascript
- graphql
---
GraphQL makes it easy to request exactly the data you need, but that flexibility can quickly turn into a performance problem when queries return large result sets. A single field that returns "all items" may work fine during development, yet silently degrade into slow responses, high memory usage, or even process crashes as data volume grows.

This is especially relevant in **Node.js** backends, where resolvers often materialize entire result sets in memory before returning a response. Fetching a large number of records in a single GraphQL query doesn't just increase response time, it can put sustained pressure on the event loop, garbage collector, and overall process stability.

Pagination is the standard solution to this problem, but not all pagination strategies behave the same under load.

In this article, we'll look at three common approaches to pagination in a Node.js GraphQL API: fetching everything at once, *offset-based pagination*, and *cursor-based pagination*. Rather than treating pagination as a purely theoretical concern, we'll instrument each approach and observe how it affects response times and memory usage.

We'll build a minimal GraphQL API using **Express** and **Apollo Server**, backed by a SQLite database seeded with 500,000 products. You'll see how naive queries show up as slow requests and memory spikes, how offset-based pagination improves things but still has hidden costs, and why cursor-based pagination is - spoiler alert! - the recommended pattern for stable, scalable GraphQL APIs.

## Setting Up the Project

To keep things simple, the article is accompanied by a runnable [demo repository](...). The project is a small Node.js GraphQL API, with a SQLite backend populated with 500,000 products.

## Prerequisites

To follow along, you'll only need:

- Node.js 18+
- npm
- A basic understanding of GraphQL and Node.js development

## Installation

Start by cloning the repository and installing dependencies:

```bash
git clone https://github.com/gkoos/article-graphql-pagination
cd article-graphql-pagination
npm install
```

The project uses Prisma with SQLite and includes a seed script that creates 500,000 product records to demonstrate performance differences between pagination strategies.

Run the following commands to initialize and seed the database:

```bash
npx prisma generate
npm run prisma:migrate
npm run prisma:seed
```

This will create the database schema and populate it with realistic-looking product data.

## Running the Server

Once setup is complete, start the server:

```bash
npm start
```

The GraphQL API will be available at `http://localhost:4000`, where you can explore the schema and run queries using the Apollo Sandbox.

## The Problem: Fetching All Data at Once

Before introducing pagination, let's start with the simplest approach: returning *all* records from a GraphQL field in a single request.

In our app, the `allProducts` query does exactly that. It loads all 500,000 products from the database and returns them as a single response. This kind of query is easy to write, easy to understand, and surprisingly common in early GraphQL schemas.

Here's the resolver behind it:

```js
// src/resolvers.js
...
allProducts: async () => {
    console.time('allProducts');
    const products = await prisma.product.findMany({
    orderBy: { id: 'asc' }
    });
    console.timeEnd('allProducts');
    console.log(`Fetched ${products.length} products (ALL)`);
    return products;
},
```

There's nothing technically wrong with this resolver. It does exactly what it promises. The problem is *scale*.

### Running the Fetch-All Query

Open the GraphQL Sandbox at `http://localhost:4000` and run the following query:

```graphql
query allProducts {
  allProducts {
    id
    name
    price
    category
  }
}
```

Depending on your machine, the query may take several seconds to complete. You'll also notice that the response payload is very large: hundreds of thousands of objects serialized into JSON and sent over the wire in one go.

In your terminal, you should see a log message like this:

```
allProducts: 2.817s
Fetched 500000 products (ALL)
```

A single request:

- Executes a large database query
- Allocates memory for all 500,000 rows
- Serializes the entire result set before responding

In a real production API, this kind of request can quickly become problematic under concurrent load.

### Why This Pattern Breaks Down

Even in this local setup, you can observe:
- High response times (often several seconds)
- Significant memory usage spikes during request processing

Because the resolver loads the entire dataset eagerly, the cost of this query **scales linearly with the number of rows in the table**. As the dataset grows, so does response time, memory pressure, and GC activity in the Node.js process.

This is one of those things that often goes unnoticed during development, but becomes very visible once real data and real traffic hit the system.

Fetching all data at once has a few fundamental problems:

- **Unbounded results**: There's no upper limit on how much data a client can request.
- **Poor memory characteristics**: Large result sets must be held in memory until the response is sent.
- **Unpredictable performance**: Response time grows with dataset size, not request intent.
- **Easy to abuse**: A single client can unintentionally (or intentionally) stress the backend.

**Pagination** exists to put boundaries around this behavior.

## Naive Offset-Based Pagination

A natural first step after realizing that fetching everything at once doesn't scale is to introduce *offset-based pagination*. This approach limits the number of records returned per request and allows clients to "page through" results using a combination of limit and offset.

Offset-based pagination is simple to implement and easy to reason about, which makes it a common choice in REST APIs and an equally common first attempt in GraphQL.

### Implementing Offset Pagination

In our demo project, the `productsOffset` query exposes this pattern:

```js
// src/resolvers.js
...
productsOffset: async (_, { limit, offset }) => {
    console.time('productsOffset');
    if (limit > 100) {
        limit = 100; // enforce a maximum limit to prevent abuse
    }
    const products = await prisma.product.findMany({
    take: limit,
    skip: offset,
    orderBy: { id: 'asc' }
    });
    console.timeEnd('productsOffset');
    console.log(`Fetched ${products.length} products (offset: ${offset}, limit: ${limit})`);
    return products;
},
```

One thing that's important to note here is if we don't limit the number of records returned, we could still end up fetching everything at once. **Always implement a server-side maximum limit to prevent abuse**.

The resolver uses Prisma's `take` and `skip` options to implement limit and offset behavior. Clients can specify how many records they want (`limit`) and where to start (`offset`).

The corresponding GraphQL query looks like this:

```graphql
query productsOffset {
  productsOffset(limit: 20, offset: 0) {
    id
    name
    price
    category
  }
}
```

Instead of returning all 500,000 products, this query fetches just a small window of results. Clients can request subsequent pages by increasing the offset value.

### Observing the Improvement

Run the offset-based query a few times from the GraphQL Sandbox, changing the offset to simulate paging through the dataset.

In your terminal, you should see logs like this:

```
productsOffset: 17.44ms
Fetched 20 products (offset: 0, limit: 20)
```

Compared to the fetch-all approach, you should immediately notice:

- Much faster response times
- Shorter database query time
- Lower overall memory usage per request

By limiting how many records are loaded and serialized, offset-based pagination dramatically reduces the per-request cost. Even under load, this approach is far more stable than returning everything at once.

### The Hidden Cost of Offsets

While offset-based pagination is a clear improvement, it comes with a less obvious downside.

As the offset value increases, **the database still needs to scan past the skipped rows to reach the requested page**. For small offsets this isn't a problem, but deeper pages can become increasingly expensive, especially on large tables.

Let's query the last page of products:

```graphql
query productsOffset {
  productsOffset(limit: 20, offset: 499980) {
    id
    name
    price
    category
  }
}
```

Run this query and observe the terminal logs:

```
productsOffset: 1.055s
Fetched 20 products (offset: 499980, limit: 20)
```

In this particular case, the first query took 17ms, while the last page took more than a second!

From the client's perspective, this query looks almost identical to fetching the first page, but from the database's perspective, it may involve scanning hundreds of thousands of rows before returning just 20.

### Why This Matters in GraphQL APIs

Offset-based pagination also has semantic issues in GraphQL:

- **Unstable pagination**: Inserts or deletes can shift offsets, causing clients to skip or duplicate items.
- **No natural continuation**: Clients must manage offsets manually.
- **Poor fit for infinite scrolling**: Large offsets become increasingly inefficient.

These limitations are why offset-based pagination is generally considered a transitional solution in GraphQL APIs.

## Cursor-Based Pagination

Offset-based pagination improves performance by limiting result size, but it still becomes less efficient as clients paginate deeper into a dataset. In GraphQL APIs, the recommended alternative is **cursor-based pagination**, where each page starts from a known position instead of skipping an arbitrary number of rows.

Cursor-based pagination is a better fit for large datasets because its **performance depends on page size, not page number**.

### Implementing Cursor-Based Pagination

In this project, cursor-based pagination is implemented using Prisma’s native cursor support. Each product's `id` is encoded into an opaque cursor, which the client passes back when requesting the next page.

At a high level, the resolver:

1. Decodes the after cursor (if present)
2. Uses it as a database cursor
3. Fetches first + 1 records to determine if another page exists
4. Builds a connection-style response with edges and pageInfo

Here is the resolver implementation:

```js
// src/resolvers.js
// Helper function to encode cursor
function encodeCursor(id) {
  return Buffer.from(id.toString()).toString('base64');
}

// Helper function to decode cursor
function decodeCursor(cursor) {
  return parseInt(Buffer.from(cursor, 'base64').toString('ascii'));
}

...

productsCursor: async (_, { first = 20, after }) => {
    console.time('productsCursor');
    
    const cursor = after ? { id: decodeCursor(after) } : undefined;
    
    // Fetch one extra to determine if there's a next page
    const products = await prisma.product.findMany({
    take: first + 1,
    ...(cursor && {
        skip: 1, // Skip the cursor itself
        cursor: cursor
    }),
    orderBy: { id: 'asc' }
    });

    const hasNextPage = products.length > first;
    const edges = products.slice(0, first).map(product => ({
    cursor: encodeCursor(product.id),
    node: product
    }));

    const pageInfo = {
    hasNextPage,
    hasPreviousPage: !!after,
    startCursor: edges.length > 0 ? edges[0].cursor : null,
    endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null
    };

    const totalCount = await prisma.product.count();

    console.timeEnd('productsCursor');
    console.log(`Fetched ${edges.length} products (cursor-based, after: ${after || 'start'})`);

    return {
    edges,
    pageInfo,
    totalCount
    };
},
```

This approach ensures that each query resumes from a precise position in the dataset rather than scanning past thousands of rows.

### Querying with Cursors

To fetch the first page of products:

```graphql
query cursorProductsFirst {
  productsCursor(first: 20) {
    edges {
      cursor
      node {
        id
        name
        price
        category
      }
    }
    pageInfo {
      hasNextPage
      hasPreviousPage
      startCursor
      endCursor
    }
    totalCount
  }
}
```

In the terminal, you'll see something like:

```
productsCursor: 39.993ms
Fetched 20 products (cursor-based, after: start)
```

And the response will be:

```json
{
  "data": {
    "productsCursor": {
      "edges": [
        {
          "cursor": "MQ==",
          "node": {
            "id": 1,
            "name": "Product 1",
            "price": 581.7240166646505,
            "category": "Clothing"
          }
        },
        ...
        {
          "cursor": "MjA=",
          "node": {
            "id": 20,
            "name": "Product 20",
            "price": 979.7302196981608,
            "category": "Sports"
          }
        }
      ],
      "pageInfo": {
        "hasNextPage": true,
        "hasPreviousPage": false,
        "startCursor": "MQ==",
        "endCursor": "MjA="
      },
      "totalCount": 500000
    }
  }
}
```

The format is slightly different from our offset-based implementation, but all 20 products are returned as expected, plus some useful pagination metadata. To fetch the next page, the client simply uses the `endCursor` from the previous response:

```graphql
query cursorProductsNext {
  productsCursor(first: 20, after: "MjA=") {
    edges {
      cursor
      node {
        id
        name
        price
        category
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

And the response will contain products 21-40:

```json
{
  "data": {
    "productsCursor": {
      "edges": [
        {
          "cursor": "MjE=",
          "node": {
            "id": 21,
            "name": "Product 21",
            "price": 194.5758511706771,
            "category": "Toys"
          }
        },
        ...
        {
          "cursor": "NDA=",
          "node": {
            "id": 40,
            "name": "Product 40",
            "price": 527.7330156641641,
            "category": "Electronics"
          }
        }
      ],
      "pageInfo": {
        "hasNextPage": true,
        "hasPreviousPage": true,
        "startCursor": "MjE=",
        "endCursor": "NDA="
      },
      "totalCount": 500000
    }
  }
}
```

And for the next page, we would use the new `endCursor` value of `"NDA="` and so on.

The cursor itself is opaque to the client and should be treated as an implementation detail. If the client can "guess" cursor values, it may lead to unintended behavior.

Now let's try to fetch the last page using the cursor! To do this on the client-side, we should keep following the `endCursor` values until we reach the end. However, for demonstration purposes, we will cheat a little and directly encode the 499980th product's ID and create a cursor for it. In `resolvers.js`, the `encodeCursor()` function does this. What we need is `Buffer.from("499980").toString("base64")`, which results in `NDk5OTgw`, therefore our query to fetch the last page looks like this:

```graphql
query cursorProductsNext {
  productsCursor(first: 20, after: "NDk5OTgw") {
    edges {
      cursor
      node {
        id
        name
        price
        category
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

Check your terminal logs again:

```
productsCursor: 35.197ms
Fetched 20 products (cursor-based, after: NDk5OTgw)
```

As you can see, the response times remain consistent regardless of how deep we paginate into the dataset!

Compared to offset-based pagination, you should observe:

- Consistent database execution time, even for later pages
- Uniform request duration across pages
- Stable memory usage per request

Because each query starts from a known position, the database does not need to scan past large numbers of rows.

### Why Cursor-Based Pagination Scales Better

Cursor-based pagination avoids the main pitfalls of offset-based pagination:

- Performance does not degrade as clients paginate deeper
- Pagination remains stable when records are inserted or deleted
- Works naturally with infinite scrolling or stream-like UIs
- Produces predictable, easy-to-compare timings/measurements in observability tools

Although cursor-based pagination requires slightly more setup than offset-based pagination, it provides far more reliable performance characteristics and is the preferred pattern for production GraphQL APIs.

## Conclusion

Pagination is often treated as a schema design detail in GraphQL, but as shown earlier, it has a direct and measurable impact on performance, memory usage, and system stability.

Fetching all data at once may be convenient, but it quickly becomes a liability as datasets grow. Offset-based pagination improves the situation by limiting result size, yet still introduces hidden costs that surface as users paginate deeper. Cursor-based pagination, on the other hand, provides consistent performance characteristics regardless of dataset size, making it the most reliable choice for production GraphQL APIs.

More importantly, this article highlights the value of observability-driven decisions. Without instrumentation, all three approaches can appear to "work". But with proper profiling in place, the differences become clear, allowing you to make informed choices about how to design your API for real-world usage patterns.

If you're building or maintaining a GraphQL API in Node.js, **cursor-based pagination should be your default** (unless your dataset is small and unlikely to grow). And whatever approach you choose, instrument it early. Pagination is not just about shaping responses: it's about shaping how your system behaves under real-world load.