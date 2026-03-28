---
layout: layouts/post.njk
title: Chaos Proxy Migrates to @fetchkit/chaos-proxy & fetch-kit/chaos-proxy (Now at 1.0.3)
date: 2025-09-26
description: Chaos Proxy is now @fetchkit/chaos-proxy on npm, with new features and improved support in the FetchKit ecosystem.
excerpt: "After a lot of work and some migration struggles, Chaos Proxy is now published as @fetchkit/chaos-proxy on npm and has reached version 1.0.3!"
tags:
- posts
- announcements
- javascript
- typescript
- testing
---
After a lot of work and some migration struggles, Chaos Proxy is now published as `@fetchkit/chaos-proxy` on npm and has reached version 1.0.3!

## Repository migration:

The GitHub repo has also moved from `gkoos/chaos-proxy` to [`fetch-kit/chaos-proxy`](https://github.com/fetch-kit/chaos-proxy).

## What's new?

The package is now under the FetchKit organization: `@fetchkit/chaos-proxy`  
Latest version: 1.0.3

### New features:

- `throttle` middleware for bandwidth control
- `bodyTransform` middleware for custom body logic
- Improved routing logic for flexible chaos injection

## Migration:

The old chaos-proxy package is deprecated.

To upgrade:

```bash
npm uninstall chaos-proxy
npm install @fetchkit/chaos-proxy
```

Update your GitHub links to the new repo: <https://github.com/fetch-kit/chaos-proxy>

## Why the change?

This migration brings Chaos Proxy into the FetchKit ecosystem for better support, discoverability, and future development.

## Deprecation notice:

All updates and support will be focused on `@fetchkit/chaos-proxy` and the new GitHub repo.

Please migrate to stay up to date.

Thanks for sticking around through the migration!

Questions or feedback? [GitHub Issues](https://github.com/fetch-kit/chaos-proxy/issues)