---
layout: layouts/post.njk
title: Decorating Promises Without Breaking Them
date: 2026-04-10
description: How to add convenience methods to a native Promise object without subclassing, wrapping, or changing what await returns.
excerpt: "I wanted .get().json() ergonomics in a fetch client without lying about return types, without subclassing Response, and without a Proxy layer. What I ended up with is a small technique worth knowing regardless of the library context."
tags:
- posts
- tutorials
- javascript
- typescript
---

I wanted `.get().json()`.

This came up while building convenience plugins for [ffetch](https://github.com/fetch-kit/ffetch), a lightweight fetch wrapper focused on keeping native semantics intact. Libraries like [ky](https://github.com/sindresorhus/ky) solve the ergonomics problem by introducing a custom `Response`-like object, which works great until something outside the library expects a plain `Response`. I wanted a different path.

Not because I needed it, strictly speaking. `await fetch('/api/todos/1')` followed by `await response.json()` works perfectly fine. But after the hundredth time writing that two-step dance across a codebase, you start reaching for something cleaner.

The usual answer is a wrapper class or a custom Promise subclass. Both work, but both carry a hidden cost: you are now responsible for whatever happens when you swap out the native `Response` for your own abstraction. `instanceof` checks break. Framework integrations that inspect the response directly can behave unexpectedly. And the moment someone passes your custom object into something that expected a plain `Response`, you have a problem. Subclassing in particular is a trap that looks clean until some dependency does `response instanceof Response` and gets `false` - at which point you are debugging framework internals instead of your actual code.

I wanted a different answer. This is about that.

## The Goal

The cleaner call site I was after looks like this:

```typescript
const todo = await client.get('/api/todos/1').json()
```

Two requirements in tension. On one hand, `.json()` should be reachable without a separate `await` and variable assignment. On the other hand, `await client.get('/api/todos/1')` should still resolve to a genuine, unmodified `Response` — not a wrapper, not a subclass, not a Proxy.

Most approaches collapse this tension by picking one side. Either you get ergonomics and lose native semantics, or you keep native semantics and write the two-liner. The question is whether you can actually have both.

## The Mechanism

A `Promise` in JavaScript is an object. Like any object, you can assign properties to it at runtime.

That is the whole trick. Instead of wrapping the Promise or replacing it with something else, you decorate it in place: attach the convenience methods directly as properties on the Promise instance returned by the fetch call.

Here is what that looks like in practice:

```typescript
function attachResponseShortcuts(promise: Promise<Response>) {
  const descriptor = (fn: (r: Response) => unknown) => ({
    value: function (this: Promise<Response>) {
      return this.then(fn)
    },
    enumerable: false,
    writable: false,
    configurable: false,
  })

  Object.defineProperties(promise, {
    json:        descriptor((r) => r.json()),
    text:        descriptor((r) => r.text()),
    blob:        descriptor((r) => r.blob()),
    arrayBuffer: descriptor((r) => r.arrayBuffer()),
    formData:    descriptor((r) => r.formData()),
  })

  return promise
}
```

A few things are happening here that are worth unpacking.

**Property descriptors, not assignment.** Using `Object.defineProperties` instead of `promise.json = fn` gives explicit control over the property attributes. Each method is `enumerable: false` which means it stays invisible to `for...in` loops, `Object.keys`, and JSON serialization. (They will still show up in browser DevTools when you expand the object and in `Object.getOwnPropertyDescriptors()`, but that is useful for debugging anyway — the point is they do not pollute standard iteration or JSON output.) It is `writable: false` and `configurable: false`, so it cannot be accidentally overwritten or deleted at runtime. This is intentional: without these locks, a careless reassignment (`promise.json = myMock`) would silently break the convenience layer for everyone holding that promise. The tradeoff is that it also prevents *intentional* overrides — if you need to mock `.json()` in a test, you cannot. This is a deliberate choice favoring safety over flexibility.

**Forwarding, not reimplementing.** Each method is a one-liner that calls `.then()` on the Promise itself (via `this`) and delegates immediately to the native `Response` method. The parsing behavior, error handling, and body consumption rules all come from the browser or runtime. We are not reimplementing anything. The methods are thin pass-throughs.

**The Promise remains a Promise.** `await client.get('/api/todos/1')` still resolves to the same native `Response` it always did. The added methods live on the instance itself, not on the prototype chain like native methods do — they are invisible properties on the Promise object. They do not affect the resolution value, the prototype chain, or any standard Promise behavior. (This is a meaningful difference: calls to `promise.constructor` or `Object.getPrototypeOf(promise)` see an untouched Promise, not a subclass or wrapper.)

## Idempotency

If multiple plugins or hooks might touch the same promise — which is the case in a plugin-based architecture — you need to guard against decorating the same object twice. `Object.defineProperties` will throw if you try to redefine a non-configurable property.

A marker handles this, and this is one of the rare cases where a `Symbol` is genuinely useful: it provides collision-free identity that no other code can accidentally claim.

```typescript
const DECORATED = Symbol('ffetch.responseShortcutsDecorated')

function attachResponseShortcuts(promise: Promise<Response>) {
  if ((promise as any)[DECORATED]) return promise

  // ... defineProperties ...

  Object.defineProperty(promise, DECORATED, { value: true, enumerable: false })
  return promise
}
```

The marker is invisible to `Object.keys`, `Object.getOwnPropertyNames`, and iteration — only findable via `Object.getOwnPropertySymbols` if you explicitly look for it. Decoration becomes a safe, idempotent operation regardless of call order, with zero risk of collision with any third-party code or browser internals.

## Typing It

TypeScript does not know about properties you attach at runtime, so you have to tell it. The cleanest model here is an intersection type: the call site return type is `Promise<Response>` intersected with the shortcut interface.

```typescript
interface ResponseShortcuts {
  json<T = unknown>(): Promise<T>
  text(): Promise<string>
  blob(): Promise<Blob>
  arrayBuffer(): Promise<ArrayBuffer>
  formData(): Promise<FormData>
}

type DecoratedPromise = Promise<Response> & ResponseShortcuts
```

This is honest. `DecoratedPromise` really is both things simultaneously: a standard Promise that resolves to `Response`, and an object that happens to have five extra methods. The intersection expresses both without hiding either.

When the library does not have the plugin installed, the return type is `Promise<Response>` with no extras. When it does, it is `Promise<Response> & ResponseShortcuts`. TypeScript catches you if you try to call `.json()` without the plugin, and it autocompletes when you have it. No runtime cost either way.

## Tradeoffs Worth Naming

This technique is additive, not transformative. That is its strength and its limit.

It cannot change what `Response` contains. If you call `.json()` on a response that came back with a `text/html` body, you get the same parse error you would have got with the two-liner. The shortcut is a convenience, not a type-safe schema layer.

Body consumption rules are also unchanged. `Response` bodies can only be read once — calling `.json()` and then separately awaiting the response and calling `.json()` again will fail, exactly as native fetch would. Decoration does not change the underlying object.

The TypeScript types also do not capture body consumption state. If the response body was already read (e.g., by an upstream handler or middleware), calling `.json()` will throw at runtime. TypeScript will not catch this — the types express the structural shape of the methods, not the preconditions for their success. This is a general limitation of modeling `Response` state in TypeScript, not specific to this technique, but it is worth knowing: the intersection type `Promise<Response> & ResponseShortcuts` is a shape guarantee, not a behavioral one.

And if you or your team prefer strict explicitness — no augmented promise objects, all parsing explicit — then this pattern is probably not the right call. It is a style choice. The native two-liner is perfectly readable, just longer.

Where this genuinely shines is in a plugin or middleware architecture where you want to offer ergonomics as opt-in behavior. The baseline remains untouched, native fetch-compatible, and requires zero knowledge of the convenience layer to work with.

## The Broader Point

What I find interesting about this technique is that it demonstrates a property of JavaScript that is easy to forget: objects are open. A Promise is not a sealed system. You can extend it in flight without wrapping or subclassing, and without disturbing the contract anyone else has with it.

Preserve native behavior first. Layer ergonomics second, explicitly, and as close to invisibly as possible.

If the shortcut is there and you use it, you gain a line. If the shortcut is there and you do not use it, nothing changes. That is the shape of a good opt-in.

The full implementation lives in [ffetch](https://github.com/fetch-kit/ffetch) if you want to see it in context. But the technique itself applies anywhere you need to decorate promises with convenience methods.
