---
layout: layouts/post.njk
title: ffetch Migrates to @fetchkit/ffetch & fetch-kit/ffetch
date: 2025-09-26
description: FFetch is now @fetchkit/ffetch on npm, with improved support in the FetchKit ecosystem.
excerpt: "FFetch is now published as `@fetchkit/ffetch` on npm! The GitHub repo has also moved from gkoos/ffetch to fetch-kit/ffetch."
tags:
- posts
- announcements
- javascript
- typescript
---
FFetch is now published as `@fetchkit/ffetch` on npm!

## Repository migration:

The GitHub repo has also moved from `gkoos/ffetch` to [`fetch-kit/ffetch`](https://github.com/fetch-kit/ffetch).

## What's new?

The package is now under the FetchKit organization: `@fetchkit/ffetch`  
Latest version: 3.4.1

### Migration:

The old `@gkoos/ffetch` package is deprecated.

To upgrade:

```bash
npm uninstall @gkoos/ffetch
npm install @fetchkit/ffetch
```

Update your GitHub links to the new repo: <https://github.com/fetch-kit/ffetch>

## Why the change?

This migration brings FFetch into the FetchKit ecosystem for better support, discoverability, and future development.

## Deprecation notice:

All updates and support will be focused on `@fetchkit/ffetch` and the new GitHub repo.

Please migrate to stay up to date.

Thanks for sticking around through the migration!

Questions or feedback? [GitHub Issues](https://github.com/fetch-kit/ffetch/issues)