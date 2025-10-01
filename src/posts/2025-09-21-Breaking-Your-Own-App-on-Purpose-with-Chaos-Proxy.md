---
layout: layouts/post.njk
title: Breaking Your Own App (on Purpose) with Chaos Proxy
date: 2025-09-21
description: How to use Chaos Proxy to simulate a slow network and test UI loading states in a Next.js app.
excerpt: "Chaos Engineering is a practice where you introduce controlled failures into your system to test its resilience and improve its reliability. It's a fun concept that can help you identify weaknesses in your application and infrastructure, but probably not something that you do every day - not everyone has the luxury of a Netflix-scale engineering team to manage a Netflix-scale infrastructure. But the concept is valid and useful even for small teams and projects."
tags:
- posts
- tutorials
- javascript
- typescript
- testing
---
Chaos Engineering is a practice where you introduce controlled failures into your system to test its resilience and improve its reliability. It's a fun concept that can help you identify weaknesses in your application and infrastructure, but probably not something that you do every day - not everyone has the luxury of a Netflix-scale engineering team to manage a Netflix-scale infrastructure. But the concept is valid and useful even for small teams and projects.

In this article, we'll explore how to use the principles of Chaos Engineering to test UI loading states. We will use a simple tool called [Chaos Proxy](https://github.com/gkoos/chaos-proxy) to implement and test a delayed loading indicator in a Network.js application. 

## The Application

Imagine you're working for a company in the music streaming space. A small (but important) part of your application is a playlist feature that shows users their playlists and the songs within them. 

The app is built with [Next.js](https://nextjs.org/) and uses [React Query](https://react-query.tanstack.com/) for data fetching. It has a few API routes to get playlists and songs, and two main pages: one for listing all playlists and another for showing the details of a selected playlist.

The code for the app is available on [GitHub](https://github.com/gkoos/article-chaos-proxy). Feel free to clone it and follow along:

```sh
git clone https://github.com/gkoos/article-chaos-proxy.git
cd article-chaos-proxy
npm install
npm run dev
```

The app (well more like a stub) has the following features:

- **API Routes**:
  - `GET /api/playlists` - Returns all playlists (id, name)
  - `GET /api/playlists/:id` - Returns playlist details (id, name, description)
  - `GET /api/playlists/:id/songs` - Returns songs in a playlist ([{order, songId}])
  - `GET /api/song/:id` - Returns song details (id, artist, title)

- **Pages**:
  - `/` - Lists all playlists, clickable to `/playlist/:playlistId`
  - `/playlist/:playlistId` - Shows playlist details and ordered songs

It uses React Query for data fetching. [Cypress](https://www.cypress.io/) is set up for end-to-end testing and a few basic e2e tests are included. In our very sloppy setup, to run Cypress, make sure the app is running and then run:

```sh
npx cypress open
```

## The Problem

So you've built this app, and you're moderately happy with it. (I mean both the code quality and the DX are both meh, I'm sure you could do better, but for the sake of this article, let's say it's good enough.) You're about to grab a mocha latte, or a plant based cappuccino, when your manager comes to you and says:

> "Hey, I got a great idea! Let's add a loading indicator to the playlist page. You know, like a spinner or something. But not always, only when the network is slow. Like, after 2 seconds or so. And while the data is loading, we should show a skeleton screen. You know, those grey boxes that look like the content but aren't. It'll be super cool and modern! Can you do that?"

Well, sure, you're an engineer. You can do that. But how do you test it? How do you simulate a slow network? You could use the browser's dev tools to throttle the network, but that's manual and tedious. You could use a library like [msw](https://mswjs.io/) to mock the API responses, but that's a bit overkill for this simple app. You could even modify the API routes to introduce artificial delays, but that would be messy and not very elegant. Or use something like [toxiproxy](https://github.com/Shopify/toxiproxy) to simulate network conditions, but that's also a bit heavy for this use case.

Essentially, your problem is two-fold: you have to simulate a slow network for both development and testing (and here doesn't even matter which one you do first, this is not a TDD-focused article). For testing, you want to be able to run your tests in CI/CD pipelines, where you can't rely on manual network throttling. You could mock the API calls and use fake timers, but that gets you to a point where your tests are more complex than your code and not even testing the real behavior of the app. For development, you want to be able to see the loading indicator in action without having to change your code or the API routes.

## The Solution: Chaos Proxy

Between ridiculously complex chaos engineering tools (like [Gremlin](https://www.gremlin.com/) and [Chaos Monkey](https://github.com/Netflix/chaosmonkey)) and convoluted, overengineered testing techniques, you want something lightweight and easy that covers both your development and testing needs.

That's where [Chaos Proxy](https://github.com/gkoos/chaos-proxy) comes in. It's a simple reverse proxy that adds latency, drops requests, and simulates other network conditions. As a chaos engineering tool, it's barely a child's toy, but for this particular use case, it's perfect. It can be used to simulate a slow network for both development and testing, without modifying the app or the API routes.

## Implementing the Skeleton and the Loading Indicator

This is where some of you raise their eyebrows and say "Wait, shouldn't we start with the tests first?" Sure, you can do that. In fact, everything in this article stays valid if you do TDD. But for the sake of simplicity, let's just quickly implement the feature first and then test it.

Before you roll up your sleeves and start coding, let's see what your manager actually wants:
- A skeleton screen that shows up while the data is loading.
- A loading indicator that shows up after 2 seconds of waiting for the API response.

### The Skeleton Screen

You decide to start with the skeleton screen. It's usually implemented as a set of grey boxes that mimic the layout of the content. You can use a library like [react-loading-skeleton](https://www.npmjs.com/package/react-loading-skeleton) to easily create skeleton screens.

You install the library:

```sh
npm install react-loading-skeleton
```

And then you modify the playlist page to show the skeleton screen while the data is loading:

```js
// pages/playlist/[playlistId].js
import Skeleton from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';

...

  if (loadingPlaylist || loadingSongs || songQueries.some(q => q.isLoading)) {
    return (
      <div className="max-w-xl mx-auto py-12 px-4">
        <Skeleton width={120} height={24} className="mb-2" />
        <Skeleton width={220} height={18} className="mb-8" />
        <Skeleton width={100} height={20} className="mb-4" />
        <ol className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="bg-white rounded shadow p-4 border border-gray-200">
              <Skeleton width={180} height={16} />
            </li>
          ))}
        </ol>
      </div>
    );
  }

...
```

The full code for this chapter is available on the `improve-playlist-ui` branch:

```sh
git checkout improve-playlist-ui
```

If you run the app now, you'll see the skeleton screen while the data is loading. But since your network is fast, it loads almost instantly, and you don't get to see the skeleton screen for more than a split second. Also, note that react-query has a built-in caching mechanism, so if you navigate away and back to the playlist page, it will show the cached data immediately without showing the skeleton screen again (until you refresh the page or restart the app).

### Setting Up Chaos Proxy

So far so good, the skeleton screen seems to be working as expected. But for the loading indicator, even if your implementation is correct, you won't be able to see it in action without a slow network.

This is the right time to set up Chaos Proxy and simulate a slow network. First, install it as a dev dependency:

```sh
npm install --save-dev chaos-proxy
```

Then create a `chaos.yaml` file in the root of your project with the following content:

```yaml
port: 8080
target: http://localhost:3000

routes:
  /api:
    - latency:
        ms: 2000
    - cors: {}
```

This configuration tells Chaos Proxy to listen on port 8080 and forward requests to your Next.js app running on port 3000. It also adds a latency of 2000 milliseconds (2 seconds) to all `/api/*`requests. Last but not least, it enables CORS for the API endpoints, which is important because your app will be making requests to a different origin (localhost:8080 instead of localhost:3000)!

Now you can start Chaos Proxy in a separate terminal window:

```sh
npx chaos-proxy
```

With Chaos Proxy running, you can now access your app through the proxy by navigating to `http://localhost:8080` in your browser. This way, all requests to your app will go through Chaos Proxy and will have the added latency.

Make sure the app is running (`npm run dev`), then try to curl the playlists API through the proxy to see the delay in action:

```sh
curl http://localhost:8080/api/playlists
```

You should see that the response takes about 2 seconds to arrive.

Now you want to make sure your app uses the proxy for API requests. Currently, the app is configured to read the base API URL from an environment variable called `NEXT_PUBLIC_BASE_API_URL`. You can set this variable to point to the proxy URL when running the app.

```sh
NEXT_PUBLIC_BASE_API_URL=http://localhost:8080/api npm run dev
```

And now, if you navigate to `http://localhost:3000` in your browser, you should see the app working through the proxy. When you go to a playlist page, you should see the skeleton screen for 2 seconds before the data loads.

### The Loading Indicator

Now that you have the skeleton screen working and the slow network simulation set up, you can implement the loading indicator. You decide to use a simple text-based indicator that says "Retrieving data..." for simplicity. You can bet your manager will want to change it later.

```js
// pages/playlist/[playlistId].js
import React from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { useRouter } from "next/router";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";

const BASE_API_URL = process.env.NEXT_PUBLIC_BASE_API_URL;
function fetchPlaylist(id) {
  return fetch(`${BASE_API_URL}/playlists/${id}`).then((r) => r.json());
}
function fetchPlaylistSongs(id) {
  return fetch(`${BASE_API_URL}/playlists/${id}/songs`).then((r) => r.json());
}
function fetchSong(id) {
  return fetch(`${BASE_API_URL}/songs/${id}`).then((r) => r.json());
}

export default function PlaylistPage() {
  const router = useRouter();
  const { playlistId } = router.query;

  const { data: playlist, isLoading: loadingPlaylist } = useQuery({
    queryKey: ["playlist", playlistId],
    queryFn: () => fetchPlaylist(playlistId),
    enabled: !!playlistId,
  });
  const { data: songOrders, isLoading: loadingSongs } = useQuery({
    queryKey: ["playlistSongs", playlistId],
    queryFn: () => fetchPlaylistSongs(playlistId),
    enabled: !!playlistId,
  });

  const songQueries = useQueries({
    queries: (songOrders || []).map(({ songId }) => ({
      queryKey: ["song", songId],
      queryFn: () => fetchSong(songId),
      enabled: !!songId,
    })),
  });

  // Delayed loading indicator state
  const [showDelayedIndicator, setShowDelayedIndicator] = React.useState(false);
  const anySongLoading = songQueries.some((q) => q.isLoading);
  React.useEffect(() => {
    let timer;
    if (loadingPlaylist || loadingSongs || anySongLoading) {
      timer = setTimeout(() => setShowDelayedIndicator(true), 2000);
    } else {
      setShowDelayedIndicator(false);
    }
    return () => clearTimeout(timer);
  }, [loadingPlaylist, loadingSongs, anySongLoading]);

  if (loadingPlaylist || loadingSongs || anySongLoading) {
    return (
      <div className="max-w-xl mx-auto py-12 px-4">
        {showDelayedIndicator && (
          <div className="mb-4 text-center text-blue-500 animate-pulse">
            Retrieving data...
          </div>
        )}
        <Skeleton width={120} height={24} className="mb-2" />
        <Skeleton width={220} height={18} className="mb-8" />
        <Skeleton width={100} height={20} className="mb-4" />
        <ol className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <li
              key={i}
              className="bg-white rounded shadow p-4 border border-gray-200">
              <Skeleton width={180} height={16} />
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if (!playlist)
    return (
      <div className="flex items-center justify-center h-screen text-xl">
        Playlist not found
      </div>
    );

  return (
    <div className="max-w-xl mx-auto py-12 px-4">
      <a
        href="/"
        className="text-blue-600 hover:text-blue-800 mb-6 inline-block">
        &larr; Back to playlists
      </a>
      <h1 className="text-3xl font-bold mb-2">{playlist.name}</h1>
      <p className="mb-8 text-gray-600">{playlist.description}</p>
      <h2 className="text-xl font-semibold mb-4">Songs</h2>
      <ol className="space-y-2">
        {songQueries.map((q, i) => (
          <li
            key={i}
            className="bg-white rounded shadow p-4 border border-gray-200">
            {q.isLoading ? (
              ""
            ) : q.data ? (
              <>
                <span className="font-medium">{q.data.title}</span> by{" "}
                <span className="text-gray-500">{q.data.artist}</span>
              </>
            ) : (
              "Not found"
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
```

Remember, the file is in the repo.

And that's it! You now have a skeleton screen that shows up immediately while the data is loading, and a loading indicator that shows up after 2 seconds if the data is still loading. You can see both in action by running the app through Chaos Proxy. The latency injected by Chaos Proxy will ensure that the loading indicator appears after two seconds.

## Testing with Cypress

Now that you have the feature implemented and working, it's time to test it (well, maybe you should have done that first, but let's not split hairs). You can use Cypress to write end-to-end tests for the playlist page, including the loading states.

The code for the tests is available on the `adding-tests` branch. Make sure to check it out:

```sh
git checkout adding-tests
```

One way to test both features is to write a test that navigates to a playlist page and checks for the presence of the skeleton screen and the loading indicator. Here's an example:

```js
// cypress/e2e/playlist.cy.js
describe('Playlist page loading states', () => {
  it('shows skeleton and delayed loading indicator', () => {
    cy.visit('/playlist/1');

    // Skeleton should be visible immediately
    cy.get('.react-loading-skeleton').should('exist');

    // Delayed loading indicator should appear after ~2s
    cy.contains('Retrieving data...').should('not.exist');
    cy.wait(2100); // Wait slightly longer than proxy latency
    cy.contains('Retrieving data...').should('exist');

    // After data loads, both skeleton and indicator disappear
    cy.get('.react-loading-skeleton', { timeout: 5000 }).should('not.exist');
    cy.contains('Retrieving data...').should('not.exist');
  });
});
```

To run the end to end tests, you have to make sure both the app and Chaos Proxy are running. Build the app with `npm run build` and then create a new file called `start-next-chaos.js` in the root of your project with the following content:

```js
// start-next-chaos.js
// Programmatically start Next.js and Chaos Proxy in one process (no child processes)
const next = require('next');
const http = require('http');
const { startServer } = require('chaos-proxy/dist/index.js');

const NEXT_PORT = 3000;
const CHAOS_PORT = 8080;


// Set env var for Next.js to use the proxy
process.env.NEXT_PUBLIC_BASE_API_URL = `http://localhost:${CHAOS_PORT}/api`;

// Start Next.js (production mode)
const app = next({ dev: false, port: NEXT_PORT });
const handle = app.getRequestHandler();

app.prepare()
  .then(() => {
    http.createServer((req, res) => handle(req, res)).listen(NEXT_PORT, (err) => {
      if (err) {
        console.error('Failed to start Next.js:', err);
        process.exit(1);
      }
      console.log(`Next.js ready on http://localhost:${NEXT_PORT}`);

      // Start Chaos Proxy programmatically
      startServer({
        port: CHAOS_PORT,
        target: `http://localhost:${NEXT_PORT}`,
        global: [
          { latency: { ms: 2000 } },
          { cors: {} }
        ]
      }, { verbose: true });

      console.log(`Chaos Proxy ready on http://localhost:${CHAOS_PORT}`);

      // Keep the process alive
      setInterval(() => {}, 1000 * 60 * 60);
    });
  })
  .catch((err) => {
    console.error('Error preparing Next.js app:', err);
    process.exit(1);
  });
```

Build the app with with `BASE_API_URL` pointing to the proxy:

```sh
NEXT_PUBLIC_BASE_API_URL=http://localhost:8080/api npm run build
```

Then run both the app and Chaos Proxy:

```sh
node start-next-chaos.js
```

And then in another terminal, you can finally run the tests with the following command:

```sh
npx cypress run
```

And there you have it! The tests should pass, confirming that both the skeleton screen and the delayed loading indicator work as expected.

Now this setup is more than messy. In a real-world scenarion you'd probably containerize everything or for the very least use something like `concurrently` to run both processes in parallel. But my aim was only to show how you can run `chaos-proxy` both from the command line and programmatically from Node.js (in `start-next-chaos.js`).

## Conclusion

Of course, you can use Chaos Proxy as a lightweight chaos engineering tool to test other failure scenarios, like dropped requests or random errors. You can also use it to simulate different network conditions, like high latency or low bandwidth. But where it really can be useful is simpler use cases like this one, where you just want deterministic end-to-end tests and a better development experience without the overhead of complex tools or convoluted testing techniques.