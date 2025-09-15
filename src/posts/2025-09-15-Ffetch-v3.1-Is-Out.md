---
layout: layouts/post.njk
title: Ffetch v3.1 Is Out!
date: 2025-09-15
description: A production-ready TypeScript-first drop-in replacement for native fetch. V3.1 is out.
excerpt: Ffetch v3.1 is out. This release introduces support for pluggable fetch implementations and removes the manual AbortSignal.any fallback.
tags:
- posts
- announcements
- javascript
- typescript
---
[Ffetch](https://www.npmjs.com/package/@gkoos/ffetch) v3.1 is released. 

Ffetch is a lightweight, production-ready TypeScript-first drop-in replacement for native fetch.

This release introduces support for pluggable fetch implementations and removes the manual `AbortSignal.any` fallback.

Highlights
- Added `fetchHandler` option, allowing users to provide any fetch-compatible implementation. This improves compatibility with SSR frameworks, edge environments, and custom backends.
- Removed the manual fallback for combining abort signals. `ffetch` now requires native `AbortSignal.any` or a polyfill.
- Documentation has been updated to clarify the new requirements and provide instructions for polyfill installation.

To upgrade, run:
```bash
npm install @gkoos/ffetch@latest
# or
yarn add @gkoos/ffetch@latest
# or
pnpm add @gkoos/ffetch@latest
```

Refer to the documentation for migration details and compatibility notes.

GitHub: [gkoos/ffetch](https://github.com/gkoos/ffetch)
