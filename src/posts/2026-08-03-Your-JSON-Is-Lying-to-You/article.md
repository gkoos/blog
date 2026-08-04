---
layout: layouts/post.njk
title: "Your JSON Is Lying to You"
date: 2026-08-03
description: "JSON looks like a faithful representation of JavaScript data, but JSON.stringify and JSON.parse can silently alter or discard information at system boundaries."
excerpt: "JSON is readable and available almost everywhere, which makes it easy to trust. That trust becomes a problem when JavaScript values cross a JSON boundary and come back changed. Numbers lose precision, properties disappear, built-in types collapse into strings or empty objects, and serialization can execute code you did not expect."
tags:
- posts
- tutorials
- javascript
- json
- serialization
- "... is lying to you"
---
*Featured in [TLDR IT - 2026-08-04](https://tldr.tech/it/2026-08-04)*

Run this in your browser console:

```js
const payload = { id: 9007199254740993 }

console.log(JSON.stringify(payload))
// {"id":9007199254740992}
```

The value ends in `3`, but the serialized result ends in `2`. Nothing throws, and the output remains valid JSON, so the change is easy to miss when the value is an identifier buried inside a larger payload.

Now try a more varied object:

```js
const original = {
  id: 9007199254740993,
  missing: undefined,
  createdAt: new Date('2026-07-21T12:00:00Z'),
  score: NaN
}

const copy = JSON.parse(JSON.stringify(original))
console.log(copy)
// {
//   id: 9007199254740992,
//   createdAt: "2026-07-21T12:00:00.000Z",
//   score: null
// }
```

The number changed, the `missing` property disappeared, the `Date` became a string, and `NaN` became `null`. The object passed through the most familiar serialization round trip in JavaScript, yet the copy no longer carries the same data or types as the original.

## How We Got Here

JSON emerged around 2001 as a lightweight way to exchange structured data between browsers and servers. Douglas Crockford named and popularised the format, and [RFC 4627](https://www.rfc-editor.org/rfc/rfc4627) formally specified it in 2006. The current standard is [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259), published in 2017.

At the time, XML dominated data exchange on the web. JSON offered a much smaller grammar based on syntax JavaScript developers already recognised from object and array literals. A JSON document could be produced and consumed with little machinery, which made it a natural fit for the increasingly interactive web applications of the early 2000s.

That small grammar is still the source of JSON's appeal. It supports strings, numbers, booleans, `null`, arrays, and objects, giving different languages a common representation without importing one language's complete type system. Its design favours a minimal and portable wire format over exact preservation of every value available inside JavaScript.

JavaScript contains many values that fall outside that model. It has `undefined`, `BigInt`, symbols, special numeric values, objects with prototypes, and built-in collections with their own internal state. `JSON.stringify` must change or reject values the format cannot represent, while `JSON.parse` receives too little information to reconstruct most original types.

These differences become visible when a value leaves the process that created it. Writing it to a cache or database, sending it to another service, or reading it in another language can expose assumptions that remained hidden in JavaScript. The JSON can remain perfectly valid while the meaning changes on the way through.

This article examines those changes and explains how to define a wire representation that preserves the information your application actually needs. The goal is to make JSON boundaries explicit, so a convenient encoding does not quietly become an accidental data contract.

## The Number May Be Wrong Before JSON Sees It

The opening example reveals the changed value during serialization, but the precision loss happens earlier. JavaScript rounds `9007199254740993` while evaluating the number literal, before `JSON.stringify` receives it.

```js
const id = 9007199254740993

console.log(id)
// 9007199254740992
```

JavaScript stores ordinary numbers using the IEEE 754 binary64 format described by the ECMAScript [`Number` type](https://tc39.es/ecma262/#sec-ecmascript-language-types-number-type). This format can represent integers exactly from `Number.MIN_SAFE_INTEGER` through `Number.MAX_SAFE_INTEGER`, which is `-(2^53 - 1)` through `2^53 - 1`. Beyond that range, adjacent integers can map to the same stored value.

JSON has a different contract: [number grammar](https://www.rfc-editor.org/rfc/rfc8259#section-6) describes how a number is written as decimal text, but it does not prescribe one in-memory numeric type for every implementation. A system with a wider integer type can therefore produce valid JSON containing a value that JavaScript cannot store exactly.

```js
const text = '{"id":9007199254740993}'
const parsed = JSON.parse(text)

console.log(parsed.id)
// 9007199254740992
```

Here the text still contains the exact integer. Precision is lost when `JSON.parse` converts that text into a JavaScript `Number`. If the parsed value is later serialized again, the rounded result becomes part of the outgoing data.

This matters for database identifiers, account numbers, invoice totals, and monetary values represented in minor units. A producer may send the correct digits while the receiving JavaScript program silently stores a different number. Validation performed after parsing cannot recover the original value because the distinction has already disappeared.

`BigInt` can hold integers beyond the safe `Number` range, but JSON has no corresponding value type. JavaScript rejects the conversion instead of choosing an encoding automatically.

```js
const id = 9007199254740993n

console.log(id)
// 9007199254740993n

JSON.stringify({ id })
// TypeError: Do not know how to serialize a BigInt
```

Exact integers need an agreed representation before they cross the wire. A decimal string is often the simplest choice because JSON implementations can preserve its digits exactly.

```js
const json = JSON.stringify({ id: '9007199254740993' })
const parsed = JSON.parse(json)

console.log(parsed.id)
// "9007199254740993"
```

The schema must state that `id` is a decimal string rather than an ordinary number. The receiving program can keep it as an identifier or convert it to `BigInt` when arithmetic is required. Other encodings can work as well, provided that the producer and consumer agree on them explicitly.

## `undefined` Can Mean Multiple Things

JavaScript distinguishes between a missing property and a property whose value is `undefined`. Both produce `undefined` when read directly, but property checks reveal the difference:

```js
const value = { present: undefined }

console.log(value.present)          // undefined
console.log(value.missing)          // undefined
console.log('present' in value)     // true
console.log('missing' in value)     // false
```

That distinction can be relevant in application code. A missing property may mean that no update was requested, while a present property may mean that a caller supplied a value which still needs to be interpreted (although you can argue this is not good application design). This distinction disappears when an object property containing `undefined` is serialized.

```js
const value = {
  name: 'Alice',
  nickname: undefined
}

const json = JSON.stringify(value)
console.log(json)
// {"name":"Alice"}

const copy = JSON.parse(json)
console.log('nickname' in copy)
// false
```

JSON has no `undefined` value, so `JSON.stringify` omits the property. This behavior often looks reasonable for a normal response payload, but it can change the meaning of partial updates, configuration overlays, form submissions, and cached state.

Consider an endpoint that uses `null` to clear a nickname and omission to leave it unchanged:

```js
const leaveUnchanged = {}
const clearNickname = { nickname: null }
const ambiguousUpdate = { nickname: undefined }

console.log(JSON.stringify(leaveUnchanged))
// {}

console.log(JSON.stringify(clearNickname))
// {"nickname":null}

console.log(JSON.stringify(ambiguousUpdate))
// {}
```

The first and third objects become identical JSON even though they were distinguishable in JavaScript. Once serialized, the receiver cannot determine whether the property was absent from the start or removed because its value was `undefined`.

Arrays follow a different rule. Removing an array entry would shift every later position, so unsupported values become `null` instead.

```js
const values = ['first', undefined, 'third']

console.log(JSON.stringify(values))
// ["first",null,"third"]
```

At the top level, `JSON.stringify(undefined)` produces JavaScript `undefined`. It does not return JSON text, which can be surprising when code assumes that every successful call returns a string.

```js
const result = JSON.stringify(undefined)

console.log(result)        // undefined
console.log(typeof result) // "undefined"
```

Functions and symbols follow the same context-dependent pattern. They are omitted from objects and converted to `null` inside arrays, while top-level serialization returns `undefined`.

```js
const fn = () => 42

console.log(JSON.stringify({ fn }))
// {}

console.log(JSON.stringify([fn]))
// [null]
```

An API contract should define omission and `null` directly, because those are the states JSON can carry. If JavaScript code needs an additional state, it must encode that state explicitly before serialization rather than relying on `undefined` to survive the trip.

## Object Order Survives Until It Crosses a Boundary

Modern JavaScript gives `JSON.stringify` a stable property order. Serializing the same plain object repeatedly produces the same sequence of keys, provided that the object itself does not change.

```js
const value = { z: 1, a: 2, m: 3 }

console.log(JSON.stringify(value))
// {"z":1,"a":2,"m":3}
```

This behavior is defined by ECMAScript. [`JSON.stringify`](https://tc39.es/ecma262/#sec-json.stringify) visits enumerable own string-keyed properties using the same stable ordering rules as `Object.keys()`. Integer-index keys come first in ascending numeric order, followed by other string keys in creation order.

```js
const value = {}
value.b = 'second'
value[10] = 'ten'
value[2] = 'two'
value.a = 'first'

console.log(JSON.stringify(value))
// {"2":"two","10":"ten","b":"second","a":"first"}
```

The result is predictable inside JavaScript, but JSON gives object members a weaker meaning. [RFC 8259 defines an object as an unordered collection](https://www.rfc-editor.org/rfc/rfc8259#section-4) and notes that parsing libraries differ in whether they expose member ordering to calling code.

A JavaScript service may send the following document. Its textual order is visible, which can make that order look like part of the contract:

```json
{"z":1,"a":2,"m":3}
```

A Go service can decode that object into a `map[string]any`. The [Go language specification](https://go.dev/ref/spec#For_statements) leaves map iteration order unspecified, so code that loops over the decoded map cannot rely on receiving `z`, `a`, and `m` in source order. Another parser or serializer may also expose a different order while preserving the same JSON object.

This matters when an application gives position a meaning that the data model does not carry. A workflow may process the first property as the highest priority, or a test may compare raw JSON strings even though their objects contain the same members. Both designs depend on an ordering guarantee that can disappear when another runtime handles the document.

When order carries meaning, represent it with an array. The sequence then becomes part of the data model:

```json
[
  {"name":"z","value":1},
  {"name":"a","value":2},
  {"name":"m","value":3}
]
```

Arrays are ordered by the JSON specification, so every compliant parser preserves the sequence. The extra structure makes the intended contract visible to readers and implementations.

Hashes, signatures, cache keys, and content-addressed identifiers need a separate solution. Two JSON texts can represent the same object while differing in property order or whitespace, which gives them different byte sequences.

```js
const first = '{"a":1,"b":2}'
const second = '{ "b": 2, "a": 1 }'

console.log(JSON.parse(first))
// { a: 1, b: 2 }

console.log(JSON.parse(second))
// { b: 2, a: 1 }

console.log(first === second)
// false
```

Systems that sign or hash JSON need an agreed canonical representation before computing bytes. `JSON.stringify` produces repeatable output when it receives the same object with the same property order, but two objects with identical members can still produce different strings when those properties were created in a different order. A canonicalization scheme defines one representation for equivalent data, independent of how each producer constructed it.

## JSON Erases Types

A JSON document has a smaller type system than JavaScript. Values that fit its model can cross the boundary directly, while other values must be converted into something JSON can represent. The resulting document carries the converted value without recording its original JavaScript type.

`Date` is a common example. During serialization, a valid `Date` produces an ISO timestamp string through its `toJSON()` method.

```js
const createdAt = new Date('2026-07-21T12:00:00Z')
const json = JSON.stringify({ createdAt })

console.log(json)
// {"createdAt":"2026-07-21T12:00:00.000Z"}
```

The JSON contains an ordinary string. When it is parsed, there is no type marker telling JavaScript that the value came from a `Date`.

```js
const copy = JSON.parse(json)

console.log(typeof copy.createdAt)
// "string"

console.log(copy.createdAt instanceof Date)
// false
```

This ambiguity prevents `JSON.parse` from restoring the type automatically. A timestamp-looking value may have started as a `Date`, or it may have been a string from the beginning. Converting every matching string into a `Date` would change legitimate text and introduce a different kind of data error.

Serialization also removes the original timezone context. A `Date` stores an instant and emits it in UTC, so an input offset such as `-04:00` does not survive the conversion.

```js
const scheduledAt = new Date('2026-07-21T09:00:00-04:00')

console.log(JSON.stringify({ scheduledAt }))
// {"scheduledAt":"2026-07-21T13:00:00.000Z"}
```

The instant remains the same, but the original wall-clock time and offset have disappeared. [Your JS Date Is Lying to You](/posts/2026-07-21-Your-JS-Date-Is-Lying-to-You/) covers this loss of date and timezone intent in more detail.

Other built-in types lose even more information. `Map`, `Set`, `RegExp`, and `Error` store their meaningful state internally or in non-enumerable properties, so their default JSON representations are empty objects.

```js
const original = {
  tags: new Set(['json', 'js']),
  lookup: new Map([['answer', 42]]),
  pattern: /json/i,
  error: new Error('failed')
}

const copy = JSON.parse(JSON.stringify(original))
console.log(copy)
// { tags: {}, lookup: {}, pattern: {}, error: {} }
```

Nothing in the result identifies the original type of each empty object. Their contents have also been discarded, so the receiver cannot reconstruct them from the JSON alone.

Special numeric values follow another conversion rule. JSON numbers cannot represent `NaN` or either sign of infinity, so `JSON.stringify` writes `null` for them.

```js
const measurements = {
  current: NaN,
  upper: Infinity,
  lower: -Infinity
}

console.log(JSON.stringify(measurements))
// {"current":null,"upper":null,"lower":null}
```

This conversion is especially easy to overlook because `null` is valid JSON and parsing succeeds. Downstream code can no longer distinguish an unavailable measurement from a calculation that produced `NaN`, or an unbounded value represented by infinity.

Typed arrays retain their indexed values but lose their type and binary interpretation. Their enumerable indices become ordinary object properties.

```js
const bytes = new Uint8Array([10, 20, 30])
const copy = JSON.parse(JSON.stringify(bytes))

console.log(copy)
// { 0: 10, 1: 20, 2: 30 }

console.log(copy instanceof Uint8Array)
// false
```

Class instances behave in a similar way. Enumerable data fields may survive, but the parsed object has no connection to the original class, its prototype, or its private state.

```js
class User {
  #role = 'admin'

  constructor(name) {
    this.name = name
  }

  greet() {
    return `Hello, ${this.name}`
  }
}

const original = new User('Alice')
const copy = JSON.parse(JSON.stringify(original))

console.log(copy)
// { name: "Alice" }

console.log(copy instanceof User)
// false

console.log(typeof copy.greet)
// "undefined"
```

These conversions can remain hidden until code uses the parsed value. A string looks plausible where a `Date` was expected, an empty object passes a broad object check, `null` can travel through several layers, and a plain object can resemble decoded binary data until a later operation fails. The safest approach is to define the serialized form of every non-JSON type explicitly and restore it only through a contract understood by both sides.

## Serialization Executes Code

`JSON.stringify` does more than inspect stored values: it calls serialization hooks and reads properties through normal JavaScript operations, which means converting an object to JSON can execute application or library code.

The most direct hook is `toJSON()`. When an object provides this method, `JSON.stringify` calls it and serializes the returned value in place of the original object.

```js
const user = {
  name: 'Alice',
  password: 'secret',

  toJSON() {
    return { name: this.name }
  }
}

console.log(JSON.stringify(user))
// {"name":"Alice"}
```

The password disappears because `toJSON()` returns a new object containing only the name. This can be a useful way to define a public representation, but the output now depends on behavior that is easy to miss when reading the object at the call site.

`Date` uses the same mechanism. Its `toJSON()` method calls `toISOString()`, which is why the previous section produced a UTC string instead of an object with date fields.

```js
const date = new Date('2026-07-21T12:00:00Z')

console.log(date.toJSON())
// "2026-07-21T12:00:00.000Z"

console.log(JSON.stringify(date))
// "2026-07-21T12:00:00.000Z"
```

A custom method can perform any work available to ordinary JavaScript. It may calculate values, mutate state, access external state, or throw an exception, and each of those behaviours becomes part of serialization.

```js
let serializations = 0

const report = {
  value: 42,

  toJSON() {
    serializations += 1
    return { value: this.value }
  }
}

JSON.stringify(report)
JSON.stringify(report)

console.log(serializations)
// 2
```

Getters create a similar effect without defining `toJSON()`. When an enumerable property is backed by a getter, reading that property during serialization invokes the getter.

```js
const invoice = {
  subtotal: 100,

  get total() {
    console.log('calculating total')
    return this.subtotal * 1.2
  }
}

console.log(JSON.stringify(invoice))
// logs "calculating total"
// then {"subtotal":100,"total":120}
```

The serialized value contains the getter's result even though `total` was never stored as a data property. A getter that throws will also make `JSON.stringify` throw, which can turn logging or error reporting into another failure path.

```js
const value = {
  get secret() {
    throw new Error('secret is unavailable')
  }
}

JSON.stringify(value)
// Error: secret is unavailable
```

Callers can add another layer of behavior through a replacer, the optional second argument to `JSON.stringify`. A replacer function is called for the root value and then for each visited property, and its return value determines what gets serialized.

```js
const user = {
  name: 'Alice',
  password: 'secret',
  lastLogin: new Date('2026-07-21T12:00:00Z')
}

const json = JSON.stringify(user, (key, value) => {
  if (key === 'password') return undefined
  return value
})

console.log(json)
// {"name":"Alice","lastLogin":"2026-07-21T12:00:00.000Z"}
```

Returning `undefined` removes the `password` property, following the object rule covered earlier. The replacer receives `lastLogin` after the `Date` object's `toJSON()` method has converted it, so the callback sees the ISO string rather than the original `Date` instance.

The replacer can also be an array of property names. In that form it acts as an allowlist for object properties.

```js
const user = {
  name: 'Alice',
  email: 'alice@example.com',
  password: 'secret',
  role: 'admin'
}

console.log(JSON.stringify(user, ['name', 'role']))
// {"name":"Alice","role":"admin"}
```

These hooks make `JSON.stringify` flexible enough to support deliberate transport shapes and custom encodings. They also mean that the output cannot always be predicted from the visible fields alone, especially when the value comes from a dependency or a class whose implementation is elsewhere. Code that serializes unfamiliar objects should treat the operation as executable behavior and expect it to transform values or throw.

## Some Objects Simply Cannot Make the Trip

JSON can describe nested objects and arrays, but it has no way to describe object identity. If two properties point to the same object, the JSON representation contains two independent copies of that object's data. If an object points back to itself, serialization cannot continue at all.

```js
const shared = { name: 'Alice' }
const original = {
  owner: shared,
  reviewer: shared
}

const copy = JSON.parse(JSON.stringify(original))

console.log(original.owner === original.reviewer)
// true

console.log(copy.owner === copy.reviewer)
// false
```

The two properties share one object before serialization. After parsing, they contain separate objects with the same fields because JSON records values rather than references.

A circular reference reaches the hard limit of this model: the serializer detects the cycle and throws a `TypeError`.

```js
const value = { name: 'loop' }
value.self = value

JSON.stringify(value)
// TypeError: Converting circular structure to JSON
```

Circular structures appear naturally in parent links, graphs, caches, and framework objects. The exception often surfaces far from the code that created the cycle because serialization happens later during logging, persistence, or an HTTP response.

Removing the circular property with a replacer can make the value serializable, but that choice changes the data model. A graph that must preserve identity needs an explicit reference format, such as generated IDs with fields that point to those IDs.

Property visibility creates another limit. For ordinary objects, `JSON.stringify` considers enumerable own properties whose keys are strings. Inherited properties, non-enumerable properties, symbol-keyed properties, and private fields stay outside the JSON representation.

```js
const inherited = { inherited: 'from prototype' }
const value = Object.create(inherited)

value.visible = 'included'
Object.defineProperty(value, 'hidden', {
  value: 'non-enumerable',
  enumerable: false
})
value[Symbol('internal')] = 'symbol value'

console.log(JSON.stringify(value))
// {"visible":"included"}
```

Each omitted property is accessible in JavaScript, but none qualifies as an enumerable own string-keyed property. Serialization therefore follows the object's property descriptors rather than copying everything that code can read from it.

Class instances expose the same boundary. Constructor-assigned public fields are usually enumerable and survive, while prototype methods and private fields do not.

```js
class User {
  #role = 'admin'

  constructor(name) {
    this.name = name
  }

  greet() {
    return `Hello, ${this.name}`
  }
}

const user = new User('Bob')
const json = JSON.stringify(user)

console.log(json)
// {"name":"Bob"}
```

Parsing that text produces a plain object with a `name` property. It carries no `User` prototype, cannot call `greet()`, and contains no private role.

```js
const copy = JSON.parse(json)

console.log(copy instanceof User) // false
console.log(typeof copy.greet)    // "undefined"
```

This behavior makes arbitrary domain objects a fragile source for transport data. Constructing a plain transport object at the boundary makes every serialized field deliberate and keeps internal implementation details separate from the external contract.

```js
function toUserResponse(user) {
  return {
    name: user.name
  }
}

const response = toUserResponse(user)
console.log(JSON.stringify(response))
// {"name":"Bob"}
```

The output happens to match the implicit class serialization in this example, but the intent is now visible in code. Changes to enumerability, prototypes, or private implementation details cannot silently redefine the response shape.

## Parsing Is Safe, What You Do Next May Not Be

[Prototype pollution](https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/Prototype_pollution) is often described as a `JSON.parse` problem because malicious payloads commonly arrive as JSON. Parsing alone does not change `Object.prototype`. A `"__proto__"` member in JSON becomes an own data property with that name.

```js
const value = JSON.parse('{"__proto__":{"admin":true}}')

console.log(Object.hasOwn(value, '__proto__'))
// true

console.log(value.__proto__)
// { admin: true }

console.log({}.admin)
// undefined
```

The parsed object contains untrusted data, but other objects remain unchanged. The danger appears when later code interprets that data as instructions for modifying another object.

A recursive merge helper might walk every key from the parsed value and descend into matching properties on its target. Special names such as `__proto__` and `constructor` can lead that traversal into a prototype instead of an ordinary application-owned object. Assignments made there may then become visible through inheritance.

The flow separates the harmless parsing step from the unsafe use that follows it. The relevant sequence is:

```text
untrusted JSON
    ↓
own properties on the parsed object
    ↓
unsafe recursive merge
    ↓
prototype mutation
```

The parser creates the own property shown in the second step. The merge operation gives that property dangerous meaning, so protections belong where untrusted keys are accepted and copied.

Schema validation provides one useful defence because it allows only the fields expected by the application. A user update containing `name` and `email`, for example, has no reason to accept `__proto__`, `constructor`, or any other unexpected key. Merge utilities should also document protections against prototype pollution, especially when they recursively process configuration or request data.

Object spread has different semantics from many older merge patterns. Spreading the parsed value creates an own `__proto__` property on the new object rather than invoking the legacy prototype setter.

```js
const parsed = JSON.parse('{"__proto__":{"admin":true}}')
const copy = { ...parsed }

console.log(Object.hasOwn(copy, '__proto__'))
// true

console.log(Object.getPrototypeOf(copy) === Object.prototype)
// true
```

This does not make every use of object spread safe. It means the specific `__proto__` setter behaviour differs from assignment and from recursive merge implementations. Validation remains necessary because unexpected keys can still affect application logic without altering a prototype.

Resource exhaustion is a separate parsing concern. A valid JSON document can consume substantial memory and CPU when it contains a large amount of data or extreme nesting, and parsing usually happens before application-level validation can inspect the resulting value.

```js
const deeplyNested = '['.repeat(100_000) + ']'.repeat(100_000)
JSON.parse(deeplyNested)
```

The exact limit and failure mode depend on the runtime. An HTTP server should reject oversized request bodies before parsing them, while systems that accept complex JSON may also need limits on nesting, collection sizes, or total processing time.

Reviver functions can add more work because `JSON.parse` invokes them across the parsed structure. A computationally expensive reviver multiplies its cost with the number of values in an untrusted document, so the callback should remain small and predictable.

Safe JSON handling therefore extends beyond checking syntax. Limit the input before parsing and validate the resulting shape against an allowlist. Merge code should treat untrusted property names as data rather than as paths through an object graph.

## Revivers Do Not Restore Types Automatically

`JSON.parse` accepts an optional reviver function as its second argument. After parsing the text, it walks through the resulting structure and gives the callback an opportunity to replace or remove each value.

```js
const json = '{"name":"Alice","score":"42"}'

const parsed = JSON.parse(json, (key, value) => {
  if (key === 'score') return Number(value)
  return value
})

console.log(parsed)
// { name: "Alice", score: 42 }
```

The reviver receives child values before their containing objects, then receives the root value under an empty-string key. Returning a replacement changes the value stored at that location, while returning `undefined` removes an object property or creates a hole in an array.

This hook can restore types when the serialized representation contains enough information. A tagged object makes the intended conversion explicit:

```js
const json = JSON.stringify({
  createdAt: {
    $type: 'Date',
    value: '2026-07-21T12:00:00.000Z'
  }
})

const parsed = JSON.parse(json, (key, value) => {
  if (value?.$type === 'Date') {
    return new Date(value.value)
  }

  return value
})

console.log(parsed.createdAt instanceof Date)
// true
```

The `$type` field is part of a small serialization protocol shared by the producer and consumer. The producer records the original type, and the consumer decides how that type should be reconstructed.

A common shortcut is to treat every ISO-looking string as a `Date`. That approach changes strings which were intended to remain text.

```js
const json = JSON.stringify({
  createdAt: '2026-07-21T12:00:00.000Z',
  searchQuery: '2026-07-21T12:00:00.000Z'
})

const parsed = JSON.parse(json, (key, value) => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return new Date(value)
  }

  return value
})

console.log(parsed.createdAt instanceof Date)  // true
console.log(parsed.searchQuery instanceof Date) // true
```

The callback has no evidence that `searchQuery` represents a date. It only recognises the shape of the string, so valid text is converted into a mutable object with different behaviour.

Replacers and revivers are most reliable when they implement the same explicit contract. The replacer can emit tagged values before serialization, and the reviver can recognise those tags after parsing.

```js
const original = {
  requestId: 9007199254740993n
}

const json = JSON.stringify(original, (key, value) => {
  if (typeof value === 'bigint') {
    return { $type: 'BigInt', value: value.toString() }
  }

  return value
})

const copy = JSON.parse(json, (key, value) => {
  if (value?.$type === 'BigInt') {
    return BigInt(value.value)
  }

  return value
})

console.log(copy.requestId)
// 9007199254740993n
```

The tag avoids the precision loss discussed earlier because the digits travel as a string. It also makes the conversion visible in the JSON instead of assigning hidden meaning to every decimal string.

A reviver runs code across the entire parsed structure, including data supplied by an untrusted source. It should accept only known tags and validate the associated payload. Keep per-value work inexpensive; for larger contracts, a dedicated codec or schema transformation is usually easier to test than a growing collection of conditions inside one callback.

## Practical Rules for JSON Boundaries

The problems in the previous sections share one cause: an implicit contract. The sender serializes whatever object it has, while the receiver assumes that the parsed result carries the same meaning. A reliable boundary makes that meaning explicit before data leaves the process.

### Define the Wire Shape

Build a transport object from the fields the receiver needs. This keeps class internals, temporary state, computed fields, and incidental enumerable properties out of the external representation.

```js
function toUserResponse(user) {
  return {
    id: user.id.toString(),
    name: user.name,
    createdAt: user.createdAt.toISOString(),
    roles: [...user.roles]
  }
}
```

The conversion also documents exceptional types. The identifier travels as a decimal string, the date travels as a UTC timestamp, and the set of roles becomes an ordered JSON array. Future changes to the `User` class do not alter this response unless the conversion function changes with them.

### Validate After Parsing

`JSON.parse` checks syntax and returns JavaScript values. It does not verify that an object contains the fields your application expects or that those fields satisfy domain constraints.

```js
const value = JSON.parse('{"name":42,"createdAt":"yesterday"}')
// valid JSON, invalid user data
```

TypeScript cannot provide this check because its types are removed during compilation. A static annotation may describe the value expected by the program, but it does not inspect bytes received at runtime.

Schema libraries such as [Zod](https://zod.dev/), [Valibot](https://valibot.dev/), and [TypeBox](https://github.com/sinclairzx81/typebox) let an application define runtime rules for parsed data. The exact API differs, but the purpose is the same: reject an invalid value before business code treats it as trusted.

```js
import { z } from 'zod'

const UserResponse = z.object({
  id: z.string().regex(/^\d+$/),
  name: z.string(),
  createdAt: z.iso.datetime(),
  roles: z.array(z.string())
})

const user = UserResponse.parse(JSON.parse(text))
```

Validation cannot restore information already lost during parsing. If a large integer entered JavaScript as a JSON number, the schema sees the rounded result. The wire representation must preserve the value first, after which validation can check its shape and meaning.

### Give Exceptional Values an Explicit Representation

Large integers and binary data need a documented encoding because JSON cannot represent them directly. Dates and other typed values also need an explicit convention when their original type must survive.

```json
{
  "requestId": "9007199254740993",
  "createdAt": {
    "$type": "Date",
    "value": "2026-07-21T12:00:00.000Z"
  },
  "avatarBase64": "iVBORw0KGgoAAAANSUhEUgAA..."
}
```

The contract should explain how each representation is validated and decoded. A field name or type tag is preferable to guessing from the shape of a string.

### Use Arrays When Order Matters

Object member order should not carry workflow or priority semantics across systems. Put ordered values in an array and make each element's meaning explicit.

```json
{
  "steps": [
    { "name": "validate" },
    { "name": "charge" },
    { "name": "confirm" },
    { "name": "notify" }
  ]
}
```

Byte-level comparisons require canonicalization rather than an array conversion. Signing, hashing, deduplicating, or generating cache keys from JSON should use a documented canonical form shared by every producer.

### Limit Untrusted Input

Reject oversized bodies before calling `JSON.parse`, because application-level validation runs after allocation and parsing have already begun. Systems that accept deeply structured documents may also need limits for nesting and collection size.

Revivers deserve the same attention. Their work runs for values throughout the parsed structure, so a small amount of unnecessary processing can become expensive on large input.

### Test the Receiving Side

A serializer test proves only what one producer emits. A boundary test should also parse the representation with the receiving implementation and verify the meaning that survives.

For example, a JavaScript client and a Go service should test large identifiers as they move through both runtimes. Tests for signed JSON should construct equivalent objects in different property orders and confirm that canonicalization produces the same bytes.

### Choose Another Format When the Data Model Requires It

JSON remains a strong default for readable and widely interoperable data. A different format can be a better fit when compact binary output, typed byte strings, a wider numeric model, or an extension mechanism is part of the contract.

[MessagePack](https://msgpack.org/) provides a compact binary representation and supports extension types for values outside its core model. [CBOR](https://www.rfc-editor.org/rfc/rfc8949.html) distinguishes text from byte strings and provides tags for additional semantics, along with support for a wider range of numeric representations.

Neither format automatically preserves arbitrary JavaScript objects. Producers and consumers still need to agree on extensions, tags, numeric handling, and the schema applied after decoding. Changing formats expands the available vocabulary; it does not remove the need for a contract.

## Conclusion

The object from the introduction changed in several ways, but each result followed a defined rule. JavaScript rounded the large integer before serialization, `undefined` had no JSON representation, `Date` supplied a string through `toJSON()`, and `NaN` became `null`.

```js
const original = {
  id: 9007199254740993,
  missing: undefined,
  createdAt: new Date('2026-07-21T12:00:00Z'),
  score: NaN
}

console.log(JSON.parse(JSON.stringify(original)))
// {
//   id: 9007199254740992,
//   createdAt: "2026-07-21T12:00:00.000Z",
//   score: null
// }
```

JSON remains useful because its data model is small and widely understood. JSON is not broken. The mistake is treating a deliberately tiny interchange format as a lossless snapshot of JavaScript state. A JavaScript object and its JSON representation should be treated as different data models connected by an explicit conversion.

The reliable approach is to decide which information must survive before serialization begins. Large integers need an exact encoding, typed values need a documented representation, ordered data belongs in arrays, and untrusted input needs validation after parsing. Tests should cover the complete path through the producer and receiver rather than stopping at the generated string.

`JSON.parse(JSON.stringify(value))` is therefore a conversion rather than a general-purpose clone. It works when the value has already been designed for JSON, and it becomes unreliable when application types are allowed to cross the boundary by accident.

Define the wire shape and its exceptional encodings, then verify the result on the receiving side. Once those decisions are visible in code and schemas, JSON becomes predictable again because the application asks it to carry only what it can represent.

JSON shares this hidden-assumption pattern with the other posts in the series. [Your JS Date Is Lying to You](/posts/2026-07-21-Your-JS-Date-Is-Lying-to-You/) explores the date and timezone intent lost during serialization, while [Your console.log Is Lying to You](/posts/2026-06-28-Your-Console-Is-Lying-to_You/) explains why JSON cloning is also an incomplete debugging snapshot.

The remaining posts apply the same idea to other familiar abstractions. Each one examines the gap between the guarantee developers assume and the behavior the tool actually provides:

- [Your Debounce Is Lying to You](/posts/2026-03-28-Your-Debounce-Is-Lying-to-You/)
- [Your Throttling Is Lying to You](/posts/2026-03-31-Your-Throttling-Is-Lying-to-You/)
- [Your HTTP Client Is Lying to You](/posts/2026-04-19-Your-HTTP-Client-Is-Lying-to-You/)
- [Your Recursion Is Lying to You](/posts/2026-05-09-Your-Recursion-Is-Lying-to-You/)
- [Your Package Manager Is Lying to You](/posts/2026-06-11-Your-Package-Manager-Is-Lying-to-You/)
