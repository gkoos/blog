---
layout: layouts/post.njk
title: "Your typeof Is Lying to You"
date: 2026-09-04
description: "JavaScript's typeof operator is useful, but it is not a real type system. It exposes a coarse runtime tag, and that coarseness is exactly where the confusion starts."
excerpt: "Most developers treat typeof as a precise type check. It's merely a coarse runtime label that collapses arrays, dates, regexes, null, and plain objects into the same 'object' bucket, and a few historical decisions make the results even messier."
tags:
- posts
- tutorials
- javascript
- types
- typeof
- runtime
- "... is lying to you"
---
Years ago in a job interview I was asked what `typeof typeof 2` was. I answered `"string"`. I was right, but I wasn't confident. `typeof 2` is `"number"`, and `typeof "number"` is `"string"`. I got the job, and the question stuck with me.

`typeof` is a **runtime label, not a type system**: it tells you the engine's rough category for a value. It does not tell you the deeper semantic kind of value you are dealing with in your program. 

## The short list

When you use `typeof`, you get a very small set of labels:

```js
console.log(typeof undefined)        // "undefined"
console.log(typeof true)             // "boolean"
console.log(typeof 2)                // "number"
console.log(typeof 2n)               // "bigint"
console.log(typeof "x")              // "string"
console.log(typeof Symbol("x"))      // "symbol"
console.log(typeof function () {})   // "function"
console.log(typeof {})               // "object"
```

It answers a narrow question: "what runtime category does this value fit into"? It's got nothing to do with the semantic type of the value. The operator does not even map cleanly to the language's own abstract type model. It exposes a small, specification-defined set of runtime categories, including historical and behavioral special cases.
## `typeof null`

The most famous case is this one:

```js
console.log(typeof null)            // "object"
```

The original JavaScript implementation used a tagged value representation. Primitive values and objects were distinguished by a small internal tag, and the object tag was `0`. `null` was represented as a pointer-like value that happened to use the same internal tag as objects. In other words, `null` was not modeled as a distinct null object, it was treated as a special pointer value that collided with the object tag. The language kept that behavior as a historical artifact, and the specification preserved it even though the semantics are strange. This is why `typeof null` returns `"object"`.

## `function` is not a type

And then we have

```js
function foo() {}
console.log(typeof foo) // "function"
```

According to ECMAScript, functions are objects. There is no distinct `Function` type in the same way there is a `Number` or `String` type. The result `"function"` is a special category primarily associated with callable function objects, with class constructors sharing the same label.

That is why `class` syntax still produces `"function"`:

```js
class Foo {}
console.log(typeof Foo) // "function"
Foo() // TypeError
```

A class constructor is still reported as `"function"`, even though it cannot be called as an ordinary function. `Foo()` throws, only `new Foo()` works. So even `"function"` should not be read literally as "this value can be called like a function".

## Object collapse

The main issue (apart from the compatibility quirks) is that `typeof` collapses whole classes of values into one bucket.

```js
console.log(typeof {})          // "object"
console.log(typeof [])          // "object", not array
console.log(typeof /abc/)       // "object", not regex
console.log(typeof new Date())  // "object", not Date
console.log(typeof new Map())   // "object", not Map
console.log(typeof new Set())   // "object", not Set
```

An array, a regex, a `Date`, and a plain object all get the same tag. Again, this is well documented and intentional, but it is not what most developers expect.

Let's look at the following example:

```js
console.log(typeof Date)        // "function"
console.log(typeof Date())      // "string"
console.log(typeof new Date)    // "object"
console.log(typeof new Date())  // "object"
```

`Date` itself is a constructor function, so `typeof Date` is `"function"`. But `Date()` without `new` is just a function call. It does not create a `Date` instance. It returns a string representation of the current time, so the result is a string. `new Date()` creates a `Date` *object*, this is why the result is `"object"`.

That is exactly why a superficial reading of `typeof` can be dangerous: the operator tells you what the value looks like at runtime, not what the expression was supposed to mean. Imagine you have something like

```js
if (typeof err === "object") {
  logger.error(err.message)   // TypeError if err is null
}
```

And there you go, you fell into the classic trap.

## The deeper point

JavaScript has at least two ideas floating around the word "type". One is the runtime classification that `typeof` exposes. The other is the semantic kind of value you are dealing with in your program: array, regex, Date, Map, plain object, function object, primitive, and so on.

`typeof` can answer the first question. It cannot answer the second. It also preserves legacy behavior, making it even less useful.

## So what should we use instead?

`typeof` is not wrong, it's just narrow.

If the question is "is this a primitive"? or "is this callable"? then `typeof` is the right tool. If the question is "is this an array"?, "is this a `Date`"? or "is this a `Map`"? then forget `typeof`, it collapses all of them into `"object"`.

Luckily for us, JavaScript has more specific checks:
- `Array.isArray(value)` answers "is this an array"?
- `value instanceof Date` answers "does this value inherit from the `Date` prototype"?
- `value instanceof RegExp` answers "is this a regex"?
- `value instanceof Map` answers "is this a Map"?
- `value instanceof Set` answers "is this a Set"?

And `Object.prototype.toString.call(value)` answers "what more specific object tag does this value expose"? This is a useful escape hatch, but it is not perfectly reliable because object tags can be spoofed via `Symbol.toStringTag`:

```js
const x = { [Symbol.toStringTag]: "Date" }
console.log(Object.prototype.toString.call(x)) // "[object Date]"
```

The semantics of JavaScript objects are not uniform. An array can be indexed and iterated in a way that a plain object cannot. A `Date` has calendar-time semantics. A `Map` has key/value semantics. A `RegExp` has pattern semantics. A plain object is just a bag of properties. They are all `"object"` under `typeof`, but they are not the same kind of value. WeakMaps, WeakSets, and Promises are also `"object"` under `typeof`, but they have very different semantics.

And worth mentioning that `instanceof` is not always reliable across realms (e.g., iframes, workers, or Node.js vm contexts). If you control both sides of the realm boundary, it works fine. Otherwise, you may need to use `Object.prototype.toString.call` or a modern type library.

## Conclusion

`typeof` is a compatibility-preserved runtime label, not a true type system. It can be useful for checking whether a value is a primitive or callable, but it cannot tell you the semantic kind of value you are dealing with. For that, you need to use more specific checks, with their own caveats.

And JavaScript has even bigger lies:
- [Your Debounce Is Lying to You](/posts/2026-03-28-Your-Debounce-Is-Lying-to-You/)
- [Your Throttling Is Lying to You](/posts/2026-03-31-Your-Throttling-Is-Lying-to-You/)
- [Your HTTP Client Is Lying to You](/posts/2026-04-19-Your-HTTP-Client-Is-Lying-to-You/)
- [Your Recursion Is Lying to You](/posts/2026-05-09-Your-Recursion-Is-Lying-to-You/)
- [Your Package Manager Is Lying to You](/posts/2026-06-11-Your-Package-Manager-Is-Lying-to-You/)
- [Your Console Is Lying to You](/posts/2026-06-28-Your-Console-Is-Lying-to_You/)
- [Your JS Date Is Lying to You](/posts/2026-07-21-Your-JS-Date-Is-Lying-to-You/)
- [Your JSON Is Lying to You](/posts/2026-08-03-Your-JSON-Is-Lying-to-You/)
- [YourModules Are Lying to You](/posts/2026-08-14-Your-Modules-Are-Lying-to-You/) 