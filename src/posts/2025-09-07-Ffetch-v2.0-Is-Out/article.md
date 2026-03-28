---
layout: layouts/post.njk
title: Ffetch v2.0 Is Out!
date: 2025-09-07
description: A production-ready TypeScript-first drop-in replacement for native fetch. V2.0 is out.
excerpt: Ffetch v2.0 is out. No breaking changes, but major improvements and revamped docs.
tags:
- posts
- announcements
- javascript
- typescript
---
[Ffetch](https://www.npmjs.com/package/@gkoos/ffetch) v2.0 is out! 

Ffetch is a lightweight, production-ready TypeScript-first drop-in replacement for native fetch.

This version has no breaking changes, but a couple of major improvements and a complete overhaul of the documentation.

## Bug Fixes
### Critical Signal Handling Issues
- Fixed AbortSignal.any fallback - Was completely broken and ignoring user signals
- Fixed signal duplication bug - transformRequest hook could cause same signal to be added twice
- Fixed transformRequest signal preservation - Signals from transformed requests are now properly combined
### Compatibility Issues
- Removed mandatory AbortSignal.timeout requirement - Now works in older environments
- Added manual timeout implementation - Falls back to setTimeout + AbortController when AbortSignal.timeout unavailable
- Enhanced signal combination logic - Properly handles multiple signals (user + timeout + transformed)
### Timeout Behavior
- Fixed timeout: 0 handling - Now properly disables timeout instead of causing errors
- Better timeout signal cleanup - Prevents memory leaks in complex abort scenarios

## New Features
### Enhanced Error System
- Better error type detection - More precise mapping of native errors to custom types
- Preserved original errors - All custom errors maintain .cause property with original error
- Improved error context - Better error messages and debugging information
### Request Tracking
- Added pending requests tracking - client.pendingRequests array to monitor active requests
- Proper request lifecycle management - Automatic cleanup when requests complete
### Documentation & Developer Experience
- Comprehensive Documentation Overhaul
  - Migration guide - Complete guide for transitioning from native fetch
  - Enhanced API documentation - Better examples and edge case coverage
  - Advanced usage patterns - Detailed hooks and configuration examples
  - Compatibility documentation - Environment requirements and polyfill guidance
  - To be perfectly honest, I relied heavily on AI to write the documentation. It still needs some polishing, but it's a huge improvement over the previous version.

GitHub: [gkoos/ffetch](https://github.com/gkoos/ffetch)

Any feedback or contributions are welcome in the GitHub repository.