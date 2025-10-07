---
layout: layouts/post.njk
title: "Chaos-Driven Testing for Full Stack Apps: Integration Tests That Break (and Heal)"
date: 2025-10-07
description: "Learn how to use chaos-driven testing in full stack apps with integration tests that simulate network failures and latency. Discover practical techniques with chaos-fetch to build more resilient JavaScript and TypeScript applications."
excerpt: "Testing is a tricky business. Testing full stack apps is even trickier. You have to deal with frontend, backend, database, network, and more. First, of course, you unit test your components, functions, and modules in isolation. Then you write integration tests to ensure they play nicely together. You might even add a few end-to-end tests for the entire application to simulate real user interactions."
tags:
- posts
- testing
- javascript
- typescript
---
Testing is a tricky business. Testing full stack apps is even trickier. You have to deal with frontend, backend, database, network, and more. First, of course, you unit test your components, functions, and modules in isolation. Then you write integration tests to ensure they play nicely together. You might even add a few end-to-end tests for the entire application to simulate real user interactions.

But then there's the chaos factor: what happens when things go wrong? What happens when the network is slow or unreliable? What happens when the backend is down? An application that works perfectly on the happy path can still easily break when something unexpected happens. It is impossible to predict all the ways in which a system can fail, especially when multiple components interact in complex ways, but we can prepare for failure by testing how our application behaves under adverse conditions.

Chaos-driven testing is an approach that embraces this uncertainty by intentionally introducing failures into your tests. In this article, we'll explore how to implement chaos-driven testing in a Next.js application using integration tests that intentionally break things.

## The App

Well, first we'll need an app to test. To keep the article focused, I've created a minimal fullstack Next.js app so you don't have to.

The app is a simple recipe app where you can browse a list of recipes, view recipe details, and like them. It uses Tailwind CSS for styling and TypeScript for type safety.

When you like a recipe, the like count updates optimistically on the frontend while the backend processes the request. If the backend call fails, the like count reverts to its previous state. If it succeeds, it returns the new like count, but the frontend doesn't update it again to avoid jumping numbers, if the recipe was liked by another user in the meantime. This is a common pattern in web apps to provide a snappy user experience, when consistency is not critical.

The code is available on [GitHub](https://github.com/gkoos/article-chaos-fetch)

Check out the repo, install dependencies, and you can run it locally with:

```bash
git clone
cd article-chaos-fetch
npm install
npm run dev
``` 

Open <http://localhost:3000> in your browser.

You will see something like this:

![Recipe List](https://i.imgur.com/Iw2NQac.gif)


The backend has three API routes:
- `GET /api/posts` — list all recipes
- `GET /api/posts/[id]` — get recipe details
- `POST /api/posts/[id]/like` — increment likes - returns the new like count

Note that the likes are stored in-memory and reset on server restart. This is just for demonstration purposes, in a real app, you'd use a database.

The like button is implemented in `src/components/LikeButton.tsx` using React's `useState` and `useEffect` hooks. It handles the optimistic update, error handling, and reversion logic. Probably not how either you or I would implement it in a real app, but it will do for this demo.

## Unit Tests with Mock Service Worker (MSW)

If you want to unit test your component, there are multiple ways to do that, but one of the smartest way is to use [Mock Service Worker (MSW)](https://mswjs.io/) to mock the backend API calls. This way, you can test the component in isolation without relying on the actual backend.

In the `main` branch, we set up [Vitest](https://vitest.dev/) as the test runner and [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/) for rendering the component and simulating user interactions. We also set up MSW to intercept the network requests and return mock responses.

`src/components/LikeButton.test.tsx` contains the unit tests for the `LikeButton` component. It tests the following scenarios:
- The like button disables during the request and updates to the backend value on success.
- The like button disables during the request and rolls back on backend error.

You can run the tests with:

```bash
npm run test
```

If we have a look at the test code, we can see how we use MSW to mock the backend responses. For example, in the first test, we override the mock to return a successful response with a new like count of 42:

```typescript
// test("like button disables during request and updates to backend value"
...
server.use(
  http.post("/api/posts/:id/like", async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { likes: 42 };
  })
);
...
```

In the second test, we override the mock to return an error response:

```typescript
test("like button disables during request and rolls back on backend error"
...
server.use(
  http.post("/api/posts/:id/like", async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { status: 500 };
  })
);
...
```

What MSW does is intercept the network requests made by the `LikeButton` component and returns the mock responses we defined in the tests. This way, we can test how the component behaves under different backend conditions without relying on the actual backend. However, no real backend is involved, so we can't test the full integration between frontend and backend!

## Integration Tests

So what can we do to test the full integration between frontend and backend? Technically we could change MSW to forward the requests to the actual backend, but that would be a bit hacky and not really what MSW is designed for. Another viable option is to use a real browser environment like [Playwright](https://playwright.dev/) or [Cypress](https://www.cypress.io/) to run end-to-end tests and use a standalone proxy like [toxiproxy](https://github.com/Shopify/toxiproxy) or something simpler like [chaos-proxy](https://github.com/fetch-kit/chaos-proxy) to simulate network conditions - but that would be a bit overkill for this simple app.

This is where [chaos-fetch](https://github.com/fetch-kit/chaos-fetch) comes in. It is a lightweight library that wraps the native `fetch` API and allows you to introduce chaos into your network requests. You can simulate latency, errors, rate limiting, throttling, and even random failures with just a few lines of code.

Let's use `chaos-fetch` to create some integration tests. If we want to test the full integration between frontend and backend, we need to run the tests in a real browser environment. We can use Vitest's `jsdom` environment for this, which simulates a browser-like environment in Node.js.
```bash

To use `chaos-fetch`, we first need to install it:

```bash
npm install @fetchkit/chaos-fetch --save-dev
```

The first thing we can do, for illustration purposes, is to swap MSW with `chaos-fetch` in our unit tests. It's not really what the library is designed for, but it works. In `LikeButton.test,tsx`, we replace the MSW setup with `chaos-fetch`:

```typescript
// src/components/LikeButton.test.tsx
import {
  createClient,
  replaceGlobalFetch,
  restoreGlobalFetch,
} from "@fetchkit/chaos-fetch";
...
describe("LikeButton", () => {
  afterEach(() => {
    restoreGlobalFetch();
  });

  test("like button disables during request and updates to backend value", async () => {
    // Mock fetch to return success
    const client = createClient(
      {
        global: [
          { latency: { ms: 300 } },
        ],
        routes: {
          "POST /api/posts/:id/like": [
            { latency: { ms: 300 } },
            { mock: { body: '{ "likes": 43 }' } },
          ],
        },
      },
      window.fetch
    );
    // Replace global fetch with mock client
    replaceGlobalFetch(client);
    // From here on, the test code remains the same
  ...
```

As you can see, we create a `chaos-fetch` client that instead of fetching, returns some mock data and replaces the global `fetch` function with it. In the `afterEach` hook, we restore the original `fetch` function. The rest of the test code remains the same.

Note we also added some latency to simulate a real network request. This is important because the `LikeButton` component disables the button during the request, and we want to test that behavior. Without it the test would fail because the request would complete too quickly. (And this leads us to the brittle, unreliable world of time-based testing, but that's a topic for another article.)

The code for the second test is similar, we just change the mock to return an error:

```typescript
test("like button disables during request and rolls back on backend error", async () => {
    // Mock fetch to return success
    const client = createClient(
      {
        global: [],
        routes: {
          "POST /api/posts/:id/like": [
            { latency: { ms: 300 } },
            { mock: { status: 500, body: '{ "error": "Internal Server Error" }' } },
          ],
        },
      },
      window.fetch
    );
    // Replace global fetch with mock client
    replaceGlobalFetch(client);
    ...
```

The code is on the `tests-with-chaos-fetch` branch of the repo. You can check it out with `git checkout tests-with-chaos-fetch`.

Now we can run the tests with:

```bash
npm run test
```

Now MSW is still a better fit for unit tests, because it is designed for that purpose. But it's definitely possible to use `chaos-fetch` for that as well.

## Chaos-Driven Integration Tests

If we want to move beyond unit tests and test the full integration between frontend and backend, we can use `chaos-fetch` to introduce chaos into our network requests. This way, we can test how the application behaves under adverse conditions.

First, for the integration tests, we have to do a small refactor: we cannot directly render an async server component in our tests. Instead, we create a `PostPage` component that contains the `LikeButton` and the recipe details. This way, we can test `LikeButton` in our integration tests. The code for `PostView` is in `src/components/PostView.tsx`.

Next, we have to make sure the backend is running before we run the tests. In our case, it's the whole app, which makes the setup funny, cause we will test a component against the app it is part of, but you can set up integration tests the same way if the backend is a separate service.

The same tests we had in `LikeButton.test.tsx` are rewritten in `PostView.integration.test.tsx` to test the full integration between frontend and backend. The code is similar, but instead of mocking the backend responses, we let the requests go through to the actual backend. We still use `chaos-fetch` to introduce errors into the requests.

An important detail is that we have to set `globalThis.location` to a URL object, so that `chaos-fetch` can resolve relative URLs correctly. In this setup, JSDOM with the native fetch, wouldn't even work for relative urls! `chaos-fetch` patches JSDOM's `location` to make it work.

So first we set `globalThis.location`:

```typescript
globalThis.location = new URL("http://localhost:3000/posts/1");
```

Then we create `chaos-fetch` clients in the tests that override the native fetch and we can inject latency, errors, and more.

For the first test we don't even have to modify `fetch`, we only override it so it works with relative urls:

```typescript
test("integration: like button disables during request and re-enables after fetch (real backend)", async () => {
  replaceGlobalFetch(createClient({}));

  render(<PostView postId={1} />);


  // Wait for post to load (like count should be present)
  const likeCountText = await screen.findByText(/\d+\s*likes/);
  const initialCount = Number(likeCountText.textContent.match(/(\d+)/)?.[1] ?? 0);

  const button = await screen.findByRole("button", { name: /like/i });
  const user = userEvent.setup();
  await user.click(button);

  // Button should be disabled during request
  expect(button).toBeDisabled();

  // Wait for fetch to complete and UI to update
  await waitFor(() => expect(button).not.toBeDisabled());

  // Check updated like count
  await waitFor(() => {
    const updatedLikeCountText = screen.getByText(/\d+\s*likes/);
    const updatedCount = Number(updatedLikeCountText.textContent.match(/(\d+)/)?.[1] ?? 0);
    expect(updatedCount).toBe(initialCount + 1);
  });

  restoreGlobalFetch();
});
```

For the second test, we create a client that simulates a backend error for the like request:

```typescript
test("integration: like button disables during request and rolls back on backend error (fail middleware)", async () => {
  // Configure chaos-fetch to fail the like endpoint
  replaceGlobalFetch(createClient({
    routes: {
      "POST /api/posts/:id/like": [
        { latency: { ms: 300 } },
        { fail: { status: 500, body: '{ "error": "fail middleware" }' } },
      ],
    },
  }));

  render(<PostView postId={1} />);

  // Wait for post to load (like count should be present)
  const likeCountText = await screen.findByText(/\d+\s*likes/);
  const initialCount = Number(likeCountText.textContent.match(/(\d+)/)?.[1] ?? 0);

  const button = await screen.findByRole("button", { name: /like/i });
  const user = userEvent.setup();
  await user.click(button);

  // Button should be disabled during request
  expect(button).toBeDisabled();

  // Wait for fetch to complete and UI to update
  await waitFor(() => expect(button).not.toBeDisabled());

  // Check that like count rolls back to original value
  await waitFor(() => {
    const rolledBackLikeCountText = screen.getByText(/\d+\s*likes/);
    const rolledBackCount = Number(rolledBackLikeCountText.textContent.match(/(\d+)/)?.[1] ?? 0);
    expect(rolledBackCount).toBe(initialCount);
  });

  restoreGlobalFetch();
});
```

Now technically in the second test, we don't call the backend at all, because `chaos-fetch` intercepts the request and returns an error. But it gives a unified interface to handle successful and failing requests alike.

Where this approach really shines is when you want to simulate more complex network conditions. For example, you can simulate slow networks with the `throttle` middleware. Or you can try what happens if your backend is rate limiting you with the `rateLimit` middleware. 

Another thing that's hard to test is if a delayed loading spinner is shown while the request is in flight. You can use the `latency` middleware to simulate a slow network and test that your loading state is shown correctly.

If you don't care about determinism, you can even add some random failures to see how your app behaves under unpredictable conditions. You can also write and register your own custom middleware to simulate specific scenarios.

## Conclusion

Chaos testing is often associated with large-scale distributed systems, but it's equally important for smaller applications. In this article, we explored lightweight chaos-driven testing for full stack apps using integration tests that intentionally break things. We saw how to use `chaos-fetch` to introduce chaos into our network requests and test how our application behaves under adverse conditions.

`@fetchkit/chaos-fetch` is not a better (or worse) replacement for MSW or end-to-end testing frameworks like Playwright or Cypress. It is a complementary tool that can be set up and used alongside them (and `@fetchkit/chaos-proxy`) to enhance your testing strategy. By embracing chaos and testing how your application behaves under failure conditions, you can build more resilient and robust applications.