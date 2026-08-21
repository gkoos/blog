---
layout: layouts/post.njk
title: "The Structured Clone Algorithm: What JavaScript Can and Cannot Move Between Boundaries"
date: 2026-08-22
description: "JavaScript's structured clone algorithm preserves cycles, shared references, and many built-in types, but it still rejects or transforms values when data crosses a boundary."
excerpt: "Structured cloning carries much more of JavaScript's data model than JSON, including maps, binary data, and cyclic object graphs. It also strips custom prototypes and property descriptors, rejects functions, and can transfer ownership away from the sender."
tags:
- posts
- tutorials
- javascript
- structured-clone
- serialization
- web-workers
---
When JavaScript developers need to copy some data or move it across a boundary, they often reach for JSON. Convert the value with `JSON.stringify()`, send or store the resulting text wherever it needs to go, and reconstruct it with `JSON.parse()`. That works until the value contains something JSON cannot describe: a `Date` becomes a string, a `Map` becomes an empty object, a cyclic object throws instead of producing a copy. [Your JSON Is Lying to You](/posts/2026-08-03-Your-JSON-Is-Lying-to-You/) examines the quirks of JSON serialization.

There is another mechanism for moving data: the [structured clone algorithm](https://html.spec.whatwg.org/multipage/structured-data.html#structured-cloning) had already powered APIs such as `postMessage()` and IndexedDB for years when it became directly available through the global `structuredClone()` function in 2021 and 2022. Browsers implemented the API, and Node.js added its WHATWG-compatible global in version 17. The HTML Standard defines the API and its underlying serialization algorithm, while the [Node.js documentation describes its server-side implementation](https://nodejs.org/api/globals.html#structuredclonevalue-options).

It handles many of the cases that break a JSON clone:

```js
const shared = { status: 'ready' }
const original = {
  createdAt: new Date('2026-08-22T10:00:00Z'),
  metadata: new Map([['attempts', 2]]),
  primary: shared,
  secondary: shared
}
original.self = original

const copy = structuredClone(original)

console.log(copy.createdAt instanceof Date)       // true
console.log(copy.metadata instanceof Map)         // true
console.log(copy.primary === copy.secondary)      // true
console.log(copy.self === copy)                   // true
```

`Date` remains a `Date`, `Map` keeps its entries, the cycle survives, and both references to `shared` still point to one object inside the cloned graph. This is much closer to what we usually mean when we ask for a deep copy.

For large binary payloads, structured clone can transfer the underlying storage instead of duplicating it:

```js
const buffer = new ArrayBuffer(1024)

const copy = structuredClone(buffer, {
  transfer: [buffer]
})

console.log(copy.byteLength)
// 1024

console.log(buffer.byteLength)
// 0
```

The bytes move to `copy`, leaving the original buffer detached. This gives worker code a way to hand off data without paying for another copy.

The broader type support stops at the types built into the algorithm. An application-defined class loses the behaviour that made it useful:

```js
class Session {
  constructor(user, token) {
    this.user = user
    this.token = token
  }

  isAuthenticated() {
    return this.token !== null
  }
}

const original = new Session('Alice', 'secret')
const copy = structuredClone(original)

console.log(copy)
// { user: "Alice", token: "secret" }

console.log(copy instanceof Session)
// false

copy.isAuthenticated()
// TypeError: copy.isAuthenticated is not a function
```

The data arrives, but the `Session` prototype and its methods stay behind. The receiving code gets a plain object with the same enumerable fields.

Structured clone can preserve object graphs that JSON cannot represent and move resources that would be expensive to copy. It can also flatten application-defined types, reject unsupported values, and expose differences between environments. This article examines those rules and the contracts needed around worker messages, stored records, and other structured clone boundaries.

## What the Structured Clone Algorithm Actually Does

The name suggests a recursive copy operation, but the [HTML Standard describes structured cloning](https://html.spec.whatwg.org/multipage/structured-data.html#safe-passing-of-structured-data) as a pair of operations: *serialization* turns a JavaScript value into a realm-independent internal representation, *deserialization* uses that representation to create a value in the target realm. Most APIs perform these steps at different times, while `structuredClone()` **runs them together and returns the reconstructed value immediately**.

Worker messaging places those two operations on opposite sides of a thread boundary. Workers run with separate JavaScript heaps, so the sending thread cannot pass an ordinary object reference to the receiving thread. postMessage() serializes the value, and the worker later reconstructs it in its own realm. A received array uses the worker's Array.prototype, and a received Map uses the worker's Map.prototype. Application-defined prototypes from the sending realm do not cross the boundary.

The algorithm decides how to represent a value from information defined by the platform. A `Date` has a date value that can be recorded. A `Map` has an ordered list of entries, so its keys and values can be serialized in that order. Serializable Web API objects define their own serialization and deserialization steps. An ordinary object contributes its enumerable own string-keyed properties. This fixed set of rules explains why a class instance can lose its prototype even though its public fields survive: the algorithm does not know how to serialize the class itself, so it falls back to the default object representation.

While traversing the value, the serializer keeps a map of objects it has already visited. When it reaches the same object again, it reuses the existing serialized record instead of serializing that object for a second time. This preserves cycles and repeated references within the graph:

```js
const user = { name: 'Alice' }
const original = {
  owner: user,
  reviewer: user
}
original.self = original

const copy = structuredClone(original)

console.log(copy.owner === copy.reviewer)
// true

console.log(copy.self === copy)
// true

console.log(copy.owner === user)
// false
```

The first two comparisons show identity preserved inside the new graph, while the last comparison marks the boundary between the graphs: none of the cloned objects is the object that existed on the sending side. Several APIs use this technique because they need values to outlive a call or appear in another execution context. Messages sent through workers, windows, `MessagePort`, and `BroadcastChannel` pass through structured serialization. IndexedDB uses a storage-oriented variant when writing records, and the History API applies structured serialization to state passed to `pushState()` and `replaceState()`. The surrounding API still controls when the value is read, where it may travel, and whether it can be stored, Structured clone only defines how the value is represented across that boundary.

JSON solves a different problem. It produces text with a small, language-independent type system, which makes the result suitable for files, HTTP bodies, logs, and programs written in other languages. Structured serialization creates an internal platform representation rather than a portable wire format. There is no structured-clone document that can be saved as text or decoded by a Go service. The conversion rules also differ. JSON calls `toJSON()` methods and can be customized with replacer and reviver functions. Structured clone has no corresponding hook for application-defined types. JSON duplicates repeated objects and rejects cycles, while structured clone preserves both relationships through its memory map. Unsupported values usually cause structured clone to throw a `DataCloneError`, so one function or proxy nested deep inside a message can prevent the entire graph from crossing.

These properties make structured clone suitable for richer data moving inside the web platform or a compatible runtime such as Node.js, but they do not turn it into a universal object copier. Its contract is the set of types and reconstruction steps defined by the platform, and the next question is which JavaScript values that contract preserves.

## What Survives, and in What Form

Each supported type has its own serialization steps. Primitive values such as `undefined`, `null`, booleans, strings, numbers, and `BigInt` cross without being converted to another type. This includes numeric values that JSON cannot represent faithfully:

```js
const original = {
  missing: undefined,
  large: 9007199254740993n,
  invalid: NaN,
  upper: Infinity,
  lower: -Infinity,
  negativeZero: -0
}

const copy = structuredClone(original)

console.log(copy.missing)                   // undefined
console.log(copy.large)                     // 9007199254740993n
console.log(Number.isNaN(copy.invalid))     // true
console.log(copy.upper)                     // Infinity
console.log(copy.lower)                     // -Infinity
console.log(Object.is(copy.negativeZero, -0)) // true
```

JSON omits `undefined` object properties, rejects `BigInt`, and converts the non-finite numbers to `null`, structured clone records these values directly. 

Arrays and ordinary objects become new arrays and objects populated from their enumerable own string-keyed properties. Nested values go through the same algorithm, so a supported value remains supported regardless of its depth in the graph. The result contains no references back into the original graph unless the value represents shared memory, which follows separate security and runtime rules.

Built-in objects with internal state need dedicated handling. A `Date` carries its numeric time value, and a `RegExp` carries its source and flags. `Map` and `Set` retain their entries and iteration order. `ArrayBuffer`, typed arrays, and `DataView` preserve their bytes, element type, length, and offset. Errors and several Web API types, including `Blob` and `File`, also have defined serialization behaviour in environments that support them.

Preserving a built-in type does not keep a connection to the original instance:

```js
const original = new Map([
  ['createdAt', new Date('2026-08-22T10:00:00Z')]
])

const copy = structuredClone(original)

console.log(copy instanceof Map)
// true

console.log(copy.get('createdAt') instanceof Date)
// true

console.log(copy === original)
// false

console.log(copy.get('createdAt') === original.get('createdAt'))
// false
```

The receiving graph contains a new `Map` and a new `Date`. Their internal state survives because the algorithm defines how to serialize those built-ins.

Map keys reveal the same boundary from another direction. Object keys are cloned along with the rest of the graph, so the original key cannot be used to query the cloned map:

```js
const key = { id: 42 }
const original = {
  key,
  lookup: new Map([[key, 'found']])
}

const copy = structuredClone(original)

console.log(copy.lookup.get(key))
// undefined

console.log(copy.lookup.get(copy.key))
// "found"
```

Inside `copy`, the `key` property and the map entry still refer to the same cloned object, the memory map described in the previous section preserves that relationship. The original `key` belongs to the source graph and has no identity inside the clone.

Binary views follow this graph-preservation rule as well. If several views share one buffer before cloning, their copies share one new buffer afterward:

```js
const buffer = new ArrayBuffer(8)
const original = {
  bytes: new Uint8Array(buffer),
  words: new Uint32Array(buffer)
}

const copy = structuredClone(original)

console.log(copy.bytes instanceof Uint8Array)
// true

console.log(copy.words instanceof Uint32Array)
// true

console.log(copy.bytes.buffer === copy.words.buffer)
// true

console.log(copy.bytes.buffer === buffer)
// false
```

Copying the buffer produces new storage, while the relationship between the views survives.

Some built-ins preserve less state than their familiar surface suggests. A cloned `RegExp` retains its pattern and flags, but its `lastIndex` returns to zero:

```js
const pattern = /clone/g
pattern.lastIndex = 4

const copy = structuredClone(pattern)

console.log(copy.source)    // "clone"
console.log(copy.flags)     // "g"
console.log(copy.lastIndex) // 0
```

This still counts as a `RegExp` clone according to the algorithm because the standardized serialization steps record its matcher, source, and flags, but mutable state outside those steps does not travel.

Structured clone therefore preserves two different things: dedicated rules reconstruct supported built-in types, while the traversal memory preserves identity relationships within the new graph. Neither guarantee extends to every property or every kind of object. The later sections examine the information that those reconstruction rules leave behind.

## Transferables: Move Instead of Copy

As we saw, cloning an `ArrayBuffer` allocates new storage and copies every byte into it. That cost grows with images, audio chunks, model inputs, and other binary payloads passed between threads. The [transferable-object mechanism](https://html.spec.whatwg.org/multipage/structured-data.html#transferable-objects) lets selected resources change owners during structured serialization.

A transfer list applies to resources inside a larger value. Everything else follows the normal cloning rules:

```js
const buffer = new ArrayBuffer(1024)
const bytes = new Uint8Array(buffer)
bytes[0] = 42

const original = {
  jobId: 'resize-17',
  options: { width: 800 },
  bytes
}

const copy = structuredClone(original, {
  transfer: [buffer]
})

console.log(copy.jobId)
// "resize-17"

console.log(copy.options === original.options)
// false

console.log(copy.bytes[0])
// 42

console.log(buffer.byteLength)
// 0

console.log(bytes.byteLength)
// 0
```

The strings and ordinary objects are cloned, `Uint8Array` is reconstructed around the buffer received by `copy`, while the buffer used by `original.bytes` is detached. Every view backed by that source buffer loses access to the storage, including views that were never included in the value passed to `structuredClone()`. Detachment happens before the call returns. Code that hands off a buffer must also give up every path that could use it afterward. Keeping an alias in a queue, cache, closure, or pending operation leaves that code holding a view with a byte length of zero.

The transfer list names the transferable resource rather than every object that refers to it. Typed arrays and `DataView` objects are serializable views, while their underlying `ArrayBuffer` supplies the transferable storage:

```js
const bytes = new Uint8Array([10, 20, 30])

const copy = structuredClone(bytes, {
  transfer: [bytes.buffer]
})

console.log(copy)
// Uint8Array(3) [10, 20, 30]

console.log(bytes.byteLength)
// 0
```

Listing the typed array itself as the transferable produces an error. The distinction follows the ownership being moved: the bytes belong to the buffer, and a typed array describes how to view them.

A transferred object gets one handoff, reusing the detached source does not send the bytes again:

```js
const buffer = new ArrayBuffer(16)
const first = structuredClone(buffer, {
  transfer: [buffer]
})

console.log(first.byteLength)
// 16

structuredClone(buffer)
// DataCloneError
```

The transfer list must also contain each resource at most once: listing the same `ArrayBuffer` twice causes a `DataCloneError` rather than creating two destinations for one resource.

`structuredClone()` performs the handoff within the current thread and returns the receiving value. Messaging APIs perform the same ownership change while sending the serialized value elsewhere:

```js
const buffer = new ArrayBuffer(1024)

worker.postMessage(
  { type: 'chunk', buffer },
  [buffer]
)

console.log(buffer.byteLength)
// 0
```

The worker receives a new `ArrayBuffer` through its `message` event. The sender loses access as soon as `postMessage()` accepts the transfer, it does not wait for the worker's event handler to run. The options form, `worker.postMessage(message, { transfer: [buffer] })`, expresses the same transfer in environments that support that signature.

Browsers define several transferable platform objects in addition to `ArrayBuffer`. `MessagePort` moves one endpoint of a message channel. `ImageBitmap` and `OffscreenCanvas` can hand graphics resources to another context. Streams can also be transferable in supporting environments. Available types depend on the browser, runtime, and the API receiving the value, so code that crosses several environments needs tests against each target.

`SharedArrayBuffer` follows different semantics: structured serialization can create a new `SharedArrayBuffer` object that refers to the same shared memory, subject to the platform's isolation requirements. It does not appear in the transfer list and the sender keeps access. Coordination then becomes part of the program because both agents can read and write the same bytes, usually through `Atomics`.

Transfer removes the byte-for-byte copy of the resource, but the surrounding object graph still has to be traversed and reconstructed. Small buffers may not justify the ownership complexity, and transferring a buffer that other code still expects to use creates failures that a normal clone would avoid. Large payloads with a clear handoff point are the natural use case: once the sender queues the work, the receiver owns the resource and the sender discards its references.

## Where Structured Clone Loses Information

The list of supported built-ins can make structured clone look broader than it is. They survive because the algorithm recognizes their internal slots and defines how to reconstruct them, but application-defined types have no such reconstruction steps.

### Classes Lose Their Identity

The `Session` instance in the introduction became a plain object because its prototype was not serialized. The same rule applies when a class is available in both realms. Structured clone does not look up a constructor by name or reconnect the received object to application code.

Subclasses of supported built-ins keep the built-in part and lose the subclass:

```js
class Scores extends Map {
  highest() {
    return Math.max(...this.values())
  }
}

const original = new Scores([
  ['Alice', 12],
  ['Bob', 9]
])
original.round = 'final'

const copy = structuredClone(original)

console.log(copy instanceof Map)
// true

console.log(copy instanceof Scores)
// false

console.log(copy.round)
// undefined

console.log(copy.highest)
// undefined
```

The map entries and their order survive through the `Map` serialization steps. The `Scores` prototype and the extra `round` property are outside those steps. Extending `Date`, `Set`, or a typed array produces the same kind of result: the recognized built-in state travels without the application-defined layer around it.

Private fields disappear with the class instance because only the class body can access them and the algorithm has no rule for reconstructing them. A private field cannot be recovered from the enumerable public properties left in the clone.

### Unsupported Values Stop the Whole Operation

Functions, symbol values, `WeakMap`, `WeakSet`, `Promise`, and proxies cannot be structured-cloned. Encountering one anywhere in the graph throws a `DataCloneError`:

```js
const message = {
  type: 'calculate',
  payload: {
    values: [1, 2, 3],
    callback(result) {
      console.log(result)
    }
  }
}

structuredClone(message)
// DataCloneError
```

The surrounding object does not make the callback cloneable. The serializer reaches the function while traversing `payload` and aborts the entire operation.

A proxy fails even when its target contains only ordinary data:

```js
const state = new Proxy(
  { count: 1 },
  {}
)

structuredClone(state)
// DataCloneError
```

This affects reactive state and other libraries that wrap data in proxies. Worker messages and IndexedDB writes see the wrapper passed at the boundary, rather than the plain target hidden behind it. The application has to extract a supported data representation before making the call.

Symbols follow two different paths: a symbol used as a value throws, while a symbol-keyed property falls outside the enumerable string-keyed properties collected from an ordinary object:

```js
const internal = Symbol('internal')
const original = {
  visible: 1,
  [internal]: 2
}

const copy = structuredClone(original)

console.log(copy)
// { visible: 1 }

structuredClone({ value: internal })
// DataCloneError
```

The first operation succeeds without carrying the symbol-keyed property. The second operation reaches the symbol as a value and fails.

### Properties Become Ordinary Data

For an ordinary object, structured clone visits enumerable own string-keyed properties and reads their values. Inherited properties and non-enumerable properties stay behind. The clone creates ordinary data properties, so read-only flags, setters, and other descriptor details do not survive.

```js
const original = {}

Object.defineProperty(original, 'id', {
  value: 42,
  enumerable: true,
  writable: false,
  configurable: false
})

Object.defineProperty(original, 'secret', {
  value: 'hidden',
  enumerable: false
})

const copy = structuredClone(original)

console.log(copy)
// { id: 42 }

console.log(Object.getOwnPropertyDescriptor(copy, 'id'))
// {
//   value: 42,
//   writable: true,
//   enumerable: true,
//   configurable: true
// }

console.log(copy.secret)
// undefined
```

Accessors are read during serialization. Their functions do not cross the boundary, the values they return become ordinary properties in the clone:

```js
let reads = 0

const original = {
  subtotal: 100,

  get total() {
    reads += 1
    return this.subtotal * 1.2
  }
}

const copy = structuredClone(original)

console.log(reads)
// 1

console.log(copy.total)
// 120

console.log(Object.getOwnPropertyDescriptor(copy, 'total').get)
// undefined
```

A getter can mutate state, log information, perform expensive work, or throw - structured cloning an unfamiliar object can therefore execute code before it produces a result. A thrown getter exception propagates from the cloning call.

### There Is No Custom Serialization Hook

`JSON.stringify()` checks for a `toJSON()` method and accepts a replacer. Structured clone ignores `toJSON()` inherited from a prototype and has no replacer or reviver.

```js
class Account {
  constructor(id) {
    this.id = id
  }

  toJSON() {
    return {
      type: 'Account',
      id: this.id
    }
  }
}

const account = new Account(42)

console.log(JSON.stringify(account))
// {"type":"Account","id":42}

console.log(structuredClone(account))
// { id: 42 }
```

The JSON representation can carry the type tag because `Account` controls that conversion. The structured clone result follows the rules for an ordinary object and receives only the enumerable `id` field.

JavaScript currently provides no `Symbol.toStructuredClone`, registration API, or callback for adding a type to the native algorithm. A custom type has to be converted before the boundary and reconstructed afterward by application code. Both sides need to agree on the tag and validate the associated data.

### Errors Preserve an Engine-Defined Record

`Error` objects receive dedicated treatment, but their useful state extends beyond a simple set of enumerable properties. The HTML Standard records the recognized error name, message, and an implementation-defined representation of the stack. It also allows engines to include other accompanying data.

```js
const original = new TypeError('Invalid amount')
original.code = 'E_AMOUNT'

const copy = structuredClone(original)

console.log(copy.name)
// "TypeError"

console.log(copy.message)
// "Invalid amount"

console.log(copy.code)
// undefined
```

The custom enumerable `code` property is not part of the standard `Error` serialization steps. Stack content can differ after a worker or persistence boundary because its representation belongs to the engine. Modern engines may preserve `cause`, but applications that require it across every supported runtime should encode it as part of their own error record.

Sending operational errors as plain data gives the receiver a stable contract:

```js
function toErrorMessage(error) {
  return {
    name: error.name,
    message: error.message,
    code: error.code,
    cause: error.cause?.message
  }
}
```

The conversion chooses the fields that matter to the application instead of inheriting an engine's current `Error` serialization behaviour.

### Host Objects Depend on the Environment

Web APIs opt supported platform objects into structured serialization. `Blob`, `File`, and several graphics types define how their internal data crosses a boundary. A DOM node has no corresponding representation and throws a `DataCloneError`:

```js
structuredClone(document.body)
// DataCloneError
```

Node.js implements the WHATWG algorithm alongside its own platform types. Its [worker documentation](https://nodejs.org/api/worker_threads.html#considerations-when-cloning-objects-with-prototypes-classes-and-accessors) calls out one common conversion: a Node `Buffer` arrives as a plain `Uint8Array`.

```js
const original = Buffer.from([10, 20, 30])
const copy = structuredClone(original)

console.log(Buffer.isBuffer(copy))
// false

console.log(copy instanceof Uint8Array)
// true
```

Support also changes as standards and runtimes evolve. Older engines rejected some objects that current engines serialize, and fields such as `Error.cause` have not behaved uniformly. Feature detection can establish that `structuredClone()` exists, but only a boundary test can establish that a particular value returns with the required type and state.

## Practical Boundaries and Failure Modes

Structured clone defines the representation of a value. The API using it determines when serialization happens, which realm receives the result, and what can happen before that result is consumed. A successful call to `structuredClone()` covers only the simplest case because the sender and receiver are the same piece of synchronous code.

### Messages Are Serialized Before Delivery

`postMessage()` serializes the message during the call, before the browser queues work for the receiving context. Getters run on the sending side, and an unsupported value throws there:

```js
try {
  worker.postMessage({
    type: 'calculate',
    callback() {}
  })
} catch (error) {
  console.log(error.name)
  // "DataCloneError"
}
```

The worker never receives a partial message. Once serialization succeeds, delivery and deserialization happen later. The sender may have changed its own state by then, but those changes cannot alter the serialized message.

Transferables follow the same timing. A buffer passed in the transfer list is detached before `postMessage()` returns, even though the worker's `message` handler has not run. This creates a clean handoff point for binary data: code after the call executes without access to the transferred storage.

Deserialization can fail separately when the target environment cannot reconstruct a platform object contained in the message. Messaging APIs report this through a `messageerror` event rather than the normal `message` handler:

```js
worker.addEventListener('messageerror', event => {
  console.error('The worker could not deserialize the message', event)
})
```

This failure is less common for ordinary JavaScript values, but platform types can differ between windows, workers, browser versions, and non-browser runtimes.

### Cross-Window Messages Need an Origin Contract

Structured cloning carries data across a window boundary without deciding who should receive it. The `targetOrigin` argument to `window.postMessage()` controls delivery:

```js
otherWindow.postMessage(
  { type: 'payment-complete', orderId: 'A-42' },
  'https://checkout.example'
)
```

Using an exact origin prevents the browser from delivering the message after the target window navigates to an unrelated site. The receiving window should check `event.origin` and, where relevant, `event.source` before acting on `event.data`.

A cloned object remains untrusted input. Structured clone can preserve a `Map` or a `Date`, but it does not validate field names, string contents, numeric ranges, or application permissions. The receiver still needs a schema and authorization checks for the operation requested by the message.

Workers do not use `targetOrigin`, but their lifetimes introduce other constraints. Terminating a worker can discard queued messages. A service worker may be stopped between events, and asynchronous work associated with an event must be attached to its lifetime through APIs such as `event.waitUntil()`. Successful serialization provides no delivery or durability guarantee.

### IndexedDB Stores a Snapshot

IndexedDB stores record values using [`StructuredSerializeForStorage`](https://w3c.github.io/IndexedDB/#clone-value). The value is captured when `put()` or `add()` is called. Mutating the source object afterward does not update the stored record:

```js
const preferences = {
  theme: 'dark',
  shortcuts: new Map([['save', 'Ctrl+S']])
}

store.put(preferences, 'preferences')

preferences.theme = 'light'
preferences.shortcuts.set('open', 'Ctrl+O')
```

A later read returns the earlier snapshot with the dark theme and one map entry, assuming the transaction commits. The database does not retain a live reference to `preferences`.

The storage variant excludes values that cannot safely be restored later. `SharedArrayBuffer`, for example, cannot be persisted because its meaning depends on shared memory within a running agent cluster. Transfer lists also have no role in IndexedDB; stored data must remain available after the objects and execution contexts that created it have disappeared.

A successful clone at the `put()` call does not mean that the write has committed. IndexedDB performs the storage operation through a transaction that can later abort because of another request, an application exception, or a storage failure. Code that needs confirmation must observe the request and transaction completion events.

Persistence extends the compatibility period from one message to months or years. A browser update may deserialize an old record with newer implementations of the same built-ins, while application code may have changed its expected shape. Stored structured-clone values therefore need the same versioning and migration discipline as records encoded with JSON.

The Cache API has a narrower data model. It stores copies of `Request` and `Response` objects using Fetch and Service Worker rules; it is not a general store for arbitrary structured-clone values. Application metadata belongs in IndexedDB or another database rather than being attached as custom properties to a cached response.

### Values Belong to the Receiving Realm

Deserialization creates built-ins from the target realm. A `Map` received by an iframe uses that iframe's `Map.prototype`, and an array delivered to a worker uses the worker's `Array.prototype`. This normally makes `instanceof Map` work in the receiving code because both sides of the check come from the receiving realm.

References retained by the sender belong to a different graph. Comparing a received object with an original object, including an object used as a map key, always fails by identity. Code that needs stable identity across messages should send an identifier and resolve it against state owned by the receiver.

Cross-realm reconstruction also rules out prototype patching as a transport strategy. Adding methods to `Map.prototype` in the main window does not add them to a map reconstructed inside a worker. Each realm must load the behaviour it needs, and incoming data should be converted into local application types after validation.

### Serialization Can Block the Sender

`structuredClone()` is synchronous, and the serialization portion of `postMessage()` also runs before the call returns. Traversing a large graph can block the main thread even when the receiver handles the message asynchronously. Deserialization later consumes time and memory in the target context.

Cost depends on the graph rather than its top-level object count. A small wrapper can lead to a large buffer, a map with thousands of object keys, or repeated getters that perform their own work. Shared references avoid serializing the same object twice within one operation, but the algorithm still has to visit the surrounding properties and collection entries.

Common performance failures come from sending more state than the receiver needs and repeatedly cloning the same stable data with every message. Narrow messages reduce traversal work and make the boundary contract easier to understand. Large buffers suit transfer when the sender can relinquish them. Data needed by both sides may belong in shared memory, provided that the synchronization cost and isolation requirements fit the application.

Performance tests should exercise the complete boundary on the target runtimes. A benchmark of `structuredClone()` on one engine does not include message queuing, target-side deserialization, IndexedDB I/O, or the application work performed by getters. Measure the path that users actually wait for.

## Safer Patterns for Structured Clone Boundaries

Define the value accepted on each boundary before choosing how to move it. JSON suits data that must become text, cross a network, enter another language, or remain readable outside the runtime that produced it. Structured clone fits messages and stored values that benefit from supported JavaScript and platform types such as `Map`, `Date`, `Blob`, and typed arrays.

The richer type set does not remove the need for a contract. A worker should receive a known message shape rather than an arbitrary object taken from application state.

### Build Boundary Values

Class instances, reactive state, and library objects carry behaviour that the receiver cannot use. Convert them into a record containing the fields required by the operation:

```js
function toResizeMessage(job) {
  return {
    version: 1,
    type: 'resize-image',
    jobId: String(job.id),
    width: job.targetWidth,
    pixels: job.pixels
  }
}

const message = toResizeMessage(job)

worker.postMessage(message, {
  transfer: [message.pixels.buffer]
})
```

The conversion fixes the message shape independently of the `job` class. Adding a getter, method, cache, or private field to that class cannot alter the worker protocol. The `version` field gives the receiver a way to distinguish future shapes.

Use the types that serve the boundary. A `Map` is reasonable when both sides run in environments that support its structured serialization and key identity has meaning within the message. An array of entries is easier to inspect and can later move to JSON without another redesign. The contract should make that choice rather than inherit it from whichever object the sender already holds.

### Validate After Receiving

A successful deserialization proves that the platform understood the value's types. It says nothing about the application's required fields and constraints. Worker messages, window messages, and IndexedDB records should be checked before business code uses them:

```js
function isResizeMessage(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    value.version === 1 &&
    value.type === 'resize-image' &&
    typeof value.jobId === 'string' &&
    Number.isInteger(value.width) &&
    value.width > 0 &&
    value.pixels instanceof Uint8Array
  )
}

worker.addEventListener('message', event => {
  if (!isResizeMessage(event.data)) {
    console.error('Invalid worker message')
    return
  }

  resize(event.data)
})
```

Cross-window messages need the origin and source checks described earlier before shape validation. IndexedDB needs the same shape check even though its data came from the same origin. Old application versions, interrupted migrations, browser extensions, and other tabs can leave records that current code did not create in its present form.

Schema libraries can replace handwritten checks for larger protocols. The schema must run at runtime; a TypeScript annotation describes what the program expects but cannot inspect a message or stored record.

### Encode Custom Types Outside the Algorithm

Application-defined types need a transport representation and a reconstruction function. A type tag keeps that conversion visible:

```js
class Account {
  constructor(id, currency) {
    this.id = id
    this.currency = currency
  }
}

function encodeAccount(account) {
  return {
    type: 'Account',
    version: 1,
    id: account.id,
    currency: account.currency
  }
}

function decodeAccount(value) {
  if (
    value?.type !== 'Account' ||
    value.version !== 1 ||
    typeof value.id !== 'string' ||
    typeof value.currency !== 'string'
  ) {
    throw new TypeError('Invalid Account record')
  }

  return new Account(value.id, value.currency)
}
```

The receiver chooses when to construct an `Account` and validates the fields first. Avoid resolving an arbitrary tag through `globalThis` or calling a constructor named by incoming data. A small allowlist of known codecs keeps deserialization tied to types the application supports.

Nested graphs require a broader codec when custom values can appear at any depth. At that point, a library with registered encoders and decoders may fit better than a growing collection of manual tree walks. The encoded output still needs a versioned schema and tests on both sides of the boundary.

### Make Transfer Visible in the API

A function that transfers a resource should communicate that ownership leaves the caller. Naming and state changes can make later use harder:

```js
function sendImageBuffer(worker, buffer) {
  worker.postMessage(
    { type: 'image-buffer', buffer },
    { transfer: [buffer] }
  )
}

let pendingBuffer = await loadImageBuffer()

sendImageBuffer(worker, pendingBuffer)
pendingBuffer = null
```

Setting the local variable to `null` does not detach any additional aliases, but it documents the handoff and prevents that variable from being reused accidentally. An application with several views over the buffer should gather their ownership under one object rather than distributing aliases across unrelated components.

Transfer fits a pipeline in which one stage finishes with a resource as the next stage begins. Normal cloning fits data that both sides must continue reading independently. Shared memory requires a synchronization protocol and should enter the design only when both sides need concurrent access to the same bytes.

### Detect the Capability You Need

Checking for the global function establishes only that some form of structured cloning exists:

```js
if (typeof structuredClone !== 'function') {
  // Choose a supported fallback for this application.
}
```

Support for a platform object or transfer operation can vary independently. Test the required behaviour when the application targets environments with different capabilities:

```js
function canTransferArrayBuffer() {
  if (typeof structuredClone !== 'function') {
    return false
  }

  const source = new ArrayBuffer(1)

  try {
    const copy = structuredClone(source, {
      transfer: [source]
    })

    return source.byteLength === 0 && copy.byteLength === 1
  } catch {
    return false
  }
}
```

A JSON round trip is a safe fallback only for values designed for JSON. Applying it to an arbitrary structured-clone payload reintroduces the lost types, rejected `BigInt`, and cycle failures discussed in the previous article. Polyfills can reproduce part of the algorithm for JavaScript built-ins, while host objects and transfer semantics depend on facilities provided by the runtime.

### Test the Complete Crossing

Tests should send a value through the API used in production and assert the result in the receiving context. Calling `structuredClone()` in a unit test does not exercise worker startup, target-realm support, message delivery, transaction completion, or persistence across a reload.

Check the properties that form the contract. A message test can verify the received built-in types and graph relationships. A transfer test should verify the destination bytes and the sender's detached views. An IndexedDB test should close and reopen the database before reading the stored record, then run the same migration and validation code used by the application.

Boundary tests also need invalid input. Unsupported values should fail where the sender expects, malformed records should be rejected by the receiver, and older versions should follow a defined migration or rejection path. These tests turn the structured clone rules from runtime assumptions into behaviour maintained by the application.

Boundary crossing is also a good candidate for [fuzz testing](https://en.wikipedia.org/wiki/Fuzz_testing). Randomly generated graphs can reveal unexpected cycles, getters, and other structures that the algorithm must traverse. A fuzz test can also verify that the application-defined schema and codec functions reject invalid input rather than throwing an unhandled exception.

## Conclusion

Structured clone is useful when a boundary needs values that JSON cannot carry, but it still needs a data contract. The receiving side gets the platform's reconstruction of a value, which may have a different prototype, fewer properties, or no result at all if one nested value is unsupported.

Define the shape that crosses the boundary and validate it on arrival, convert application objects before sending them, and transfer a resource only when the sender is finished with it. The platform can preserve supported types and graph identity; application code remains responsible for preserving meaning. It's a nice tool to keep in the toolbox, but it is not a magic wand that makes every JavaScript value portable.
