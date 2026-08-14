---
layout: layouts/post.njk
title: "Your Modules Are Lying to You"
date: 2026-08-14
description: "ESM and CommonJS expose values through different contracts. Learn how bindings, object references, evaluation order, caching, cycles, and interop shape module behavior in Node.js."
excerpt: "Import and require look like two ways to load code, but they connect modules through different contracts. ESM exposes live bindings, while CommonJS returns an exported value. The distinction explains why destructured state becomes stale, cycles expose partial or uninitialized data, and package entry points can create separate module instances."
tags:
- posts
- tutorials
- javascript
- nodejs
- modules
- esm
- commonjs
- "... is lying to you"
---
Consider this small ES module:

```js
// state.mjs
export let status = 'starting'

export function start() {
  status = 'ready'
}
```

Import its two exports, call the function, and the imported `status` changes:

```js
// app.mjs
import { status, start } from './state.mjs'

start()
console.log(status) // ready
```

The CommonJS version looks equivalent:

```js
// state.cjs
module.exports.status = 'starting'

module.exports.start = function () {
  module.exports.status = 'ready'
}
```

The same-looking consumer produces a different result:

```js
// app.cjs
const { status, start } = require('./state.cjs')

start()
console.log(status) // starting
```

The function changed `module.exports.status` to `'ready'`, yet the local `status` remained `'starting'`. Keeping the object returned by `require()` changes the result again:

```js
// app.cjs
const state = require('./state.cjs')

state.start()
console.log(state.status) // ready
```

All three results follow from the module systems' contracts. An ESM named import refers to a binding owned by the exporting module. When that module assigns a new value to the binding, the importer observes it. CommonJS returns the value of `module.exports`, which is an ordinary object in this example. Destructuring reads one property from that object and stores its current value in a local variable. Keeping the object preserves the shared reference, so later property mutations remain visible.

This distinction reaches far beyond destructuring. `import` and `require` hide several operations behind the familiar idea of bringing code into a file: resolving a module, creating or retrieving its module instance, evaluating its code, and exposing something to another module. ESM and CommonJS make different decisions at each stage. Those decisions determine when side effects run, what a circular dependency can observe, whether two consumers share state, and why a package can work through `import` while failing through `require`.

The examples in this article use native module behavior in current Node.js. Browsers support ESM without CommonJS, while bundlers and transpilers can generate interop wrappers with behavior of their own. Code transformed by a build tool may demonstrate behavior that the Node.js loaders do not guarantee, so each environment should be treated separately.

## Bindings, Values, and Objects

An ESM export connects a local name in one module to an imported name in another. The imported name provides a read-only view of the exporter's binding rather than storing a private copy of its value.

```js
// counter.mjs
export let count = 0

export function increment() {
  count++
}
```

```js
// app.mjs
import { count, increment } from './counter.mjs'

console.log(count) // 0
increment()
console.log(count) // 1
```

Only the exporting module can assign to `count`. The importing module observes each assignment, but cannot perform one itself:

```js
count = 10
// TypeError: Assignment to constant variable.
```

The error mentions a constant because the imported name is read-only in this module. The exporter may declare the same binding with `let` and update it whenever its own code permits.

Live bindings also say nothing about object immutability. An exported `const` prevents the exporter from assigning another object to that name, while the object itself may remain mutable:

```js
// settings.mjs
export const settings = {
  mode: 'development'
}

export function enableProduction() {
  settings.mode = 'production'
}
```

Every importer holding `settings` can observe the property mutation. Unless the object is frozen or protected behind an API, importers can mutate it as well. The binding is read-only from the importer's perspective; the value stored in that binding may still contain mutable state.

A live binding does not notify dependent code when it changes. Code reads its current value when an expression accesses the imported name, and nothing runs merely because the exporter changed it. Treating an exported binding as application state can therefore create the same coordination problems as any other global mutable state.

CommonJS begins from a different primitive: a module can assign any JavaScript value to `module.exports`, and `require()` returns that value. Objects are common, but the export can also be a function, class, string, or promise.

The opening used a mutable property on the exported object. A getter can expose private module state while keeping the same object-based contract:

```js
// counter.cjs
let count = 0

module.exports = {
  get count() {
    return count
  },
  increment() {
    count++
  }
}
```

Compare repeated property access with a destructured value:

```js
// app.cjs
const counter = require('./counter.cjs')
const { count, increment } = counter

console.log(counter.count) // 0
console.log(count)         // 0

increment()

console.log(counter.count) // 1
console.log(count)         // 0
```

This can resemble an ESM live binding in use, but it comes from ordinary object semantics: `counter` refers to the exported object, and each `counter.count` expression invokes its getter. Destructuring invokes the getter once and stores the returned number.

Reassigning `module.exports` introduces another boundary. A mutation changes the existing object, while an assignment makes the module export a different value:

```js
// mutation
module.exports.status = 'ready'

// replacement
module.exports = { status: 'ready' }
```

Consumers holding the original object observe the mutation. They cannot be redirected to the replacement object. This becomes particularly dangerous when a module replaces its export after asynchronous initialization:

```js
// client.cjs
module.exports = { ready: false }

initializeClient().then((client) => {
  module.exports = client
})
```

A consumer that calls `require('./client.cjs')` before initialization finishes retains `{ ready: false }`. A later consumer may receive `client` from the cached module record. The process now contains two exported objects from one module, and the first one will never become ready.

Asynchronous initialization should be visible in the exported contract. The module can export the promise itself:

```js
// client.cjs
module.exports = initializeClient()
```

Consumers must then handle asynchronous readiness explicitly:

```js
// app.cjs
const clientPromise = require('./client.cjs')

async function run() {
  const client = await clientPromise
  return client.query('SELECT 1')
}
```

An exported initialization function can provide more control over retries and shutdown. A deliberately shared object can also work when its identity must remain stable, provided that the module mutates documented properties instead of replacing the object. Each design tells consumers when the resource becomes usable and which value they will share.

ESM named imports remain connected to bindings controlled by the exporting module. CommonJS consumers receive an exported value, and ordinary JavaScript rules determine whether they retain an object reference or copy one of its properties. This explains the different results in the examples without treating either module system as special state-management machinery.

## Evaluation Order and Caching

Static ESM imports participate in a dependency graph that is built before the entry module begins evaluating. Their position in the source file does not delay them until execution reaches that line.

```js
// setup.mjs
console.log('setup')
```

```js
// app.mjs
console.log('app: before import')

import './setup.mjs'

console.log('app: after import')
```

Running `node app.mjs` prints:

```text
setup
app: before import
app: after import
```

The import appears between the two calls in `app.mjs`, but `setup.mjs` runs first. Node resolves and links the graph, then evaluates the dependency before continuing with the body of the importing module. Moving the declaration to the bottom of `app.mjs` would produce the same output.

This behavior is often described as import hoisting. That description is useful for syntax, since an imported name can appear in code above its declaration. Evaluation involves more than moving a declaration to the top of a file, however. The runtime resolves every static dependency and creates module records with connected bindings before evaluating the graph in dependency order.

Side-effect imports make the ordering especially visible:

```js
import './register-hooks.mjs'
```

This form imports no names. Its purpose is the evaluation of `register-hooks.mjs`, perhaps to install instrumentation or populate a registry. That work happens before the importing module's body. Source placement cannot be used to schedule it between two statements.

CommonJS follows ordinary execution order. `require()` is a function available inside the CommonJS wrapper, so Node calls it when control flow reaches it:

```js
// setup.cjs
console.log('setup')
```

```js
// app.cjs
console.log('app: before require')

require('./setup.cjs')

console.log('app: after require')
```

The output now follows the source:

```text
app: before require
setup
app: after require
```

The first call to `require('./setup.cjs')` resolves the file and evaluates it synchronously. Node stores the module in its CommonJS cache. A later `require()` that resolves to the same file returns the cached export instead of evaluating the file again.

```js
// sequence.cjs
let value = 0

value++
console.log('evaluated')

module.exports = { value }
```

```js
// app.cjs
const first = require('./sequence.cjs')
const second = require('./sequence.cjs')

console.log(first.value)    // 1
console.log(second.value)   // 1
console.log(first === second) // true
```

`evaluated` is printed once. Both variables receive the same exported object from the cached module record.

The cache key follows the resolved module identity rather than the spelling of the request alone. Two requests that resolve to the same file normally share one module instance. Requests that resolve to different files can produce separate instances even when they use the same package name. This becomes important with nested dependencies, symlinks, conditional package entry points, and packages that publish separate ESM and CommonJS implementations.

ESM modules are also evaluated once per module instance and reused by later imports. ESM uses its own loader and module cache rather than `require.cache`. The exact identity comes from the resolved module URL, which is why changing a URL query or fragment can cause Node to load the same file as another module instance:

```js
import './config.mjs?mode=one'
import './config.mjs?mode=two'
```

Each specifier resolves to a distinct URL, so `config.mjs` is evaluated twice. This is occasionally useful in tests, but it can split state that callers expected to share.

When loading must happen at a particular point in execution, JavaScript provides dynamic `import()`:

```js
console.log('before')

const formatter = await import('./formatter.mjs')

console.log('after')
```

Unlike a static declaration, `import()` is an expression. Execution reaches it at runtime, and the expression returns a promise for the module namespace object. It can appear inside a condition or function, which makes it suitable for optional features and expensive code that should load only when needed.

Dynamic import also provides the usual asynchronous bridge from CommonJS to ESM:

```js
// report.cjs
async function createReport(data) {
  const { format } = await import('./formatter.mjs')
  return format(data)
}

module.exports = { createReport }
```

The interop section will examine the namespace object returned across this boundary. For evaluation timing, the important part is that `formatter.mjs` is requested when `createReport()` runs, and the caller must wait for the resulting promise.

Top-level `await` extends asynchronous evaluation to an entire ESM module:

```js
// configuration.mjs
const response = await fetch('https://example.com/config.json')
export const configuration = await response.json()
```

Any module that statically imports `configuration.mjs` waits for that module to finish before its own body runs. The delay propagates through the dependency graph, so one top-level `await` can postpone modules that never use `await` themselves.

Static imports express dependencies that must be linked before evaluation. Dynamic imports express dependencies requested during execution. CommonJS `require()` also runs during execution, but it loads through a synchronous, separately cached module system. Reading the syntax alone is therefore insufficient when initialization order or shared state depends on which loader created the module instance.

## Circular Dependencies and Partial Initialization

A circular dependency exists when following imports eventually leads back to a module already in the chain. The smallest cycle contains two modules: `a` loads `b`, and `b` loads `a`.

CommonJS permits this by returning an export before the module has finished evaluating. Consider these two files:

```js
// a.cjs
console.log('a: starting')
exports.ready = false

const b = require('./b.cjs')

console.log('a: b.ready =', b.ready)
exports.ready = true
console.log('a: finished')
```

```js
// b.cjs
console.log('b: starting')

const a = require('./a.cjs')

console.log('b: a.ready =', a.ready)
exports.ready = true
console.log('b: finished')
```

Running `node a.cjs` produces:

```text
a: starting
b: starting
b: a.ready = false
b: finished
a: b.ready = true
a: finished
```

Evaluation starts in `a.cjs`, which sets `exports.ready` to `false` before requiring `b.cjs`. Evaluation then moves into `b.cjs`. Its call to `require('./a.cjs')` finds a module that is already being evaluated, so Node returns the export object in its current state. The object contains `ready: false`; the assignment to `true` has not happened yet.

If `a.cjs` assigned the property after loading `b.cjs`, then `b.cjs` would read `undefined` instead. CommonJS provides access to the partially constructed export rather than waiting for the cycle to complete. Code inside the cycle can therefore observe a state that no consumer sees after startup.

The earlier distinction between mutation and replacement also applies here: `exports.ready = true` mutates the object already returned to `b.cjs`, so a later read through `a.ready` sees the update. Replacing `module.exports` would leave `b.cjs` holding the original object while later consumers receive the replacement.

ESM handles the graph differently. Its linker creates the imported bindings before either module body runs. A binding can exist at that stage without having been initialized by its declaration.

```js
// a.mjs
import { b } from './b.mjs'

export const a = 'a'
console.log('a: b =', b)
```

```js
// b.mjs
import { a } from './a.mjs'

console.log('b: a =', a)
export const b = 'b'
```

Running `node a.mjs` fails while evaluating `b.mjs`:

```text
ReferenceError: Cannot access 'a' before initialization
```

Node begins with the dependency of `a.mjs`, so it evaluates `b.mjs` first. The binding for `a` has already been created, but execution has not reached `export const a = 'a'`. Reading it from `b.mjs` crosses the temporal dead zone and stops evaluation of the graph.

This ESM graph fails when `b.mjs` reads `a` before initialization. Deferring that read allows both modules to finish initializing:

```js
// a.mjs
import { b } from './b.mjs'

export const a = 'a'
console.log('a: b =', b)
```

```js
// b.mjs
import { a } from './a.mjs'

setTimeout(() => {
  console.log('b: a =', a)
}, 0)

export const b = 'b'
```

This version prints:

```text
a: b = b
b: a = a
```

`b.mjs` schedules the callback and initializes `b`. Evaluation returns to `a.mjs`, which can now read `b` and initialize `a`. The timer reads the live binding only after both module bodies have completed.

Declaration type also affects what an early ESM read can observe. Lexical declarations such as `let`, `const`, and `class` remain uninitialized until evaluation reaches them, so an early read throws. An exported `var` is initialized to `undefined` during instantiation, and an exported function may already be callable. Changing the declaration can therefore change the symptom while leaving the cycle intact.

Delaying a read can make a small cycle run, but it leaves initialization order coupled across files. A later refactor can move one access earlier and turn a working graph into a startup failure. Larger cycles are harder to inspect because the dependency that closes the loop may sit several modules away.

The durable fix is to change the graph. Shared definitions or state can move into a lower-level module that both sides depend on. Closely related responsibilities may belong in one module. Where one side needs runtime behavior from the other, passing that dependency through a function or constructor keeps the connection out of module initialization.

CommonJS cycles expose exports while they are still being constructed. ESM cycles connect bindings before evaluation and may expose them before initialization. Both behaviors follow their respective loading models, and both make correctness depend on timing across module boundaries.

## Crossing the CommonJS and ESM Boundary

Node.js allows the two module systems to load each other, but it has to translate between an arbitrary CommonJS export value and an ESM namespace built from declared bindings. That translation determines how default and named exports appear on the resulting namespace object.

### Importing CommonJS from ESM

When ESM imports a CommonJS module, Node exposes the value of `module.exports` as the default export. This is the dependable path when properties of a CommonJS export object may change at runtime.

```js
// status.cjs
exports.status = 'starting'

setTimeout(() => {
  exports.status = 'ready'
}, 100)
```

```js
// app.mjs
import statusModule from './status.cjs'

setTimeout(() => {
  console.log(statusModule.status) // ready
}, 200)
```

`statusModule` refers to the object assigned to `module.exports`, so the later property mutation is visible.

Node also tries to make familiar CommonJS patterns available as ESM named imports. It analyzes the CommonJS source before evaluation and creates named exports for properties it can recognize:

```js
// app.mjs
import statusModule, { status } from './status.cjs'

setTimeout(() => {
  console.log(statusModule.status) // ready
  console.log(status)              // starting
}, 200)
```

The named `status` export is copied from `module.exports` when Node constructs the ESM namespace. Later updates to the CommonJS property are not detected. The default import still refers to the exported object and observes its mutation.

Named-export detection is a compatibility convenience based on static analysis. CommonJS can compute property names or replace its export with the result of a function. Source analysis cannot reliably infer every shape that such code may produce. A named import that works for one CommonJS package can fail for another even when the property exists at runtime.

For that reason, native ESM code consuming an unfamiliar CommonJS module should normally use its default export and read properties from that value:

```js
import packageApi from 'commonjs-package'

packageApi.doWork()
```

This matches the CommonJS module's actual export model and avoids depending on Node's detection heuristics.

### Loading ESM from CommonJS

Dynamic `import()` works inside CommonJS and can load any ESM graph that Node can evaluate, including one that uses top-level `await`.

```js
// formatter.mjs
export const version = '2.0'

export default function format(value) {
  return String(value).toUpperCase()
}
```

```js
// report.cjs
async function createReport(value) {
  const formatter = await import('./formatter.mjs')

  console.log(formatter.version) // 2.0
  return formatter.default(value)
}

module.exports = { createReport }
```

The promise resolves to an ESM namespace object. Named exports appear as properties with the same names, while the default export appears under `.default`. Dynamic import always has this asynchronous shape, even when the imported module contains no asynchronous code.

Current Node.js can also load a synchronous ESM graph through `require()`:

```js
// report.cjs
const formatter = require('./formatter.mjs')

console.log(formatter.version)       // 2.0
console.log(formatter.default('ok')) // OK
```

Here `require()` returns the module namespace object synchronously. It does not unwrap the default export into the direct return value, so code written as though `require('./formatter.mjs')` returns the default function will fail:

```js
const format = require('./formatter.mjs')

format('ok')
// TypeError: format is not a function
```

Synchronous loading is available only when the complete ESM graph can finish without top-level `await`. If `formatter.mjs` or one of its dependencies awaits at the top level, `require()` throws instead of turning the operation into an asynchronous one. Dynamic `import()` is the appropriate CommonJS entry point for that graph.

This behavior has changed across Node.js releases. Libraries supporting older Node versions cannot assume that `require()` can load ESM at all. Their supported runtime range and published package entry points determine whether synchronous interop is available.

### Why `.default` and `__esModule` Appear

An ESM default export is still a named binding in the module namespace, using the special name `default`. CommonJS has one exported value in `module.exports`. Converting between those shapes requires a convention for deciding whether a CommonJS value represents the namespace or the default value inside it.

Transpilers have long marked generated ESM-shaped CommonJS output with an `__esModule` property. A simplified transformation looks like this:

```js
// original ESM
export default function format(value) {
  return String(value)
}
```

```js
// simplified CommonJS output
Object.defineProperty(exports, '__esModule', { value: true })

exports.default = function format(value) {
  return String(value)
}
```

A direct CommonJS `require()` receives the generated exports object:

```js
const formatter = require('./formatter.cjs')

formatter.default('value')
```

Compiler-generated helper code may inspect `__esModule` and decide whether to use the object directly or wrap it in `{ default: value }`. Compilers and bundlers do not all apply identical helpers under every configuration. The same source import can therefore receive a function in one build and an object containing `.default` in another.

`__esModule` began as a tooling convention rather than an ESM language feature. Modern Node.js also uses it on some namespace objects for compatibility with code generated by those tools. Its presence describes an interop shape; it does not turn CommonJS properties into native live bindings.

Interop bugs often appear when development and production use different loaders. Tests may transpile both formats into CommonJS or run against bundled output. Production Node.js may then load the published files directly, leaving the native boundary untested until deployment.

At each boundary, inspect the value the active loader actually returns. A CommonJS module imported into ESM is reliably available through the default import. An ESM module loaded through dynamic `import()` or synchronous `require()` normally arrives as a namespace object. Generated `__esModule` wrappers follow the rules of the tool that created them.

## Publishing for Both Module Systems

Application code usually has one module format chosen by the project. A library has less control over its consumers. Some users load packages through ESM, while existing applications and tools still call `require()`. Supporting both means publishing files and entry points that expose consistent runtime behavior.

### Declaring the Format of Each File

Node determines the format of a JavaScript file from its extension and the nearest parent `package.json`. The explicit extensions always win:

- `.mjs` is ESM.
- `.cjs` is CommonJS.

A `.js` file inherits its interpretation from the nearest package scope. With `"type": "module"`, Node treats `.js` files as ESM. With `"type": "commonjs"`, it treats them as CommonJS.

```json
{
  "name": "formatter",
  "type": "module"
}
```

Inside this package, `index.js` is ESM and `legacy.cjs` remains CommonJS. Changing `"type"` can therefore change how every `.js` file in that package scope is parsed without changing the files themselves.

This is easy to miss in monorepos and generated output. A source file may live below one `package.json`, then a build step copies it below another. Syntax that worked in the source tree can fail from `dist` because the nearest package scope changed. Published files should use extensions and package metadata that remain unambiguous after packing.

Relative ESM specifiers also require explicit file extensions:

```js
import { format } from './format.js'
```

Node does not add `.js` or search for an `index.js` file for relative ESM imports. A build that rewrites file locations without updating specifiers can emit valid JavaScript that the ESM resolver cannot load.

### Conditional Exports

The `"exports"` field defines the public entry points of a package. Conditions can direct ESM and CommonJS consumers to different files:

```json
{
  "name": "formatter",
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./colors": {
      "import": "./dist/colors.js",
      "require": "./dist/colors.cjs"
    }
  }
}
```

An ESM import of `formatter` selects `./dist/index.js`. A CommonJS call to `require('formatter')` selects `./dist/index.cjs`. The `formatter/colors` subpath has its own pair of targets. Other files inside the package become private unless the export map exposes them.

The map describes availability; it does not verify the targets. A published package can contain an `"import"` path that works and a missing `"require"` file. Both files may exist while exporting different names. One target may also have an extension or surrounding `"type"` that makes Node interpret it in the wrong format.

Conditional exports are resolved by the active loader. Testing `src/index.js` directly bypasses this decision, as does importing `dist/index.js` by relative path. Those tests can pass while the public package name selects a broken target.

### The Dual-Package Instance Hazard

Separate `"import"` and `"require"` targets often contain separate builds of the same source. Node treats those target files as separate modules with separate caches. If one process reaches the package through both conditions, it receives two module instances.

Suppose the ESM build exports a class:

```js
// dist/index.js
export class Token {
  constructor(value) {
    this.value = value
  }
}
```

The CommonJS build contains the equivalent class:

```js
// dist/index.cjs
class Token {
  constructor(value) {
    this.value = value
  }
}

module.exports = { Token }
```

An ESM application can still load both package conditions when one of its dependencies uses `require()`:

```js
// app.mjs
import { createRequire } from 'node:module'
import { Token as ImportedToken } from 'formatter'

const require = createRequire(import.meta.url)
const { Token: RequiredToken } = require('formatter')

const token = new ImportedToken('abc')

console.log(token instanceof ImportedToken) // true
console.log(token instanceof RequiredToken) // false
```

The class definitions have identical source, but JavaScript compares their identities rather than their text. The same split affects shared state, including registries and module-level counters. Configuration applied to one instance does not reach the other.

Bundlers can conceal this problem by deduplicating the package or selecting one condition for the complete build. Native Node.js preserves the two entry points, so a package that behaves as one instance in a bundled application may split when loaded directly.

One way to preserve identity is to keep the stateful implementation in CommonJS and make the ESM entry point re-export that same value. Another design keeps state outside both wrappers and passes it into stateless format-specific entry points. A package can also publish one format and let the other system use Node's native interop when its supported Node versions permit it. Each option has compatibility costs, but each avoids silently maintaining two independent implementations of shared state.

### Test the Installed Package

Package tests should exercise the artifact selected by the public package name. Build the project, create the tarball, then install it into a small consumer project:

```bash
npm pack
```

The consumer should contain separate ESM and CommonJS smoke tests:

```js
// smoke.mjs
import { Token } from 'formatter'

console.log(new Token('esm'))
```

```js
// smoke.cjs
const { Token } = require('formatter')

console.log(new Token('commonjs'))
```

Run both tests against the packed tarball rather than a workspace link. Packing reveals missing build files and entry points that still refer to the source tree. The smoke tests should cover every documented subpath and compare the public API exposed by both conditions.

Libraries that advertise synchronous `require()` support also need a test that loads their complete ESM dependency graph. A transitive top-level `await` is enough to break that promise. Type declarations require the same boundary testing when ESM and CommonJS consumers receive different declaration files or export shapes.

Consumers load the published artifact through the paths advertised in `"exports"`. Source imports and bundler tests exercise useful development paths, but they do not prove that Node can resolve those paths. Packing the library and loading it through both public interfaces exercises the same files and loader decisions used after installation.

## Practical Rules for Module Boundaries

The mechanics described above lead to a small set of rules that keep module behavior visible in code and package metadata.

1. **Use ESM for new Node.js applications unless a dependency or deployment target requires CommonJS.**

   ESM is the language-standard module system and matches the model used by browsers. A project-wide `"type": "module"` keeps ordinary `.js` files consistent, while `.cjs` provides an explicit boundary for legacy code. Existing CommonJS applications do not need a format migration merely for syntax; migrate when ESM solves a concrete compatibility or tooling problem.

2. **Prefer named ESM exports for a stable library API.**

   Named exports make the public surface visible to editors and static analysis without default-export conventions. They also reduce ambiguity when CommonJS interop produces a namespace with a `.default` property. A default export remains appropriate when the module clearly represents one primary value, but package documentation should show the exact import shape consumers receive.

3. **Treat mutable exports as shared process state.**

   An exported object can be changed by every importer that receives it. An exported `let` can change underneath code that reads its live binding. Keep mutable state private when callers only need operations over it:

   ```js
   let enabled = false

   export function enable() {
     enabled = true
   }

   export function isEnabled() {
     return enabled
   }
   ```

   This API controls writes and makes reads explicit. It still represents shared state, so tests and initialization code must reset or configure it deliberately.

4. **Keep the CommonJS export object when its properties are expected to change.**

   Destructuring a CommonJS property stores its current value:

   ```js
   const { status } = require('./service.cjs')
   ```

   Retain the object when later reads should observe mutations:

   ```js
   const service = require('./service.cjs')
   console.log(service.status)
   ```

   When ESM consumes an unfamiliar CommonJS package, use the default import and read from that object. Synthetic named exports depend on static detection and do not receive later CommonJS property updates.

5. **Remove cycles instead of arranging code around their current evaluation order.**

   A delayed read can make a cycle work today while preserving a hidden dependency on startup timing. Replacing a static import with dynamic `import()` may postpone one side of the cycle, but it leaves the dependency graph fragile. Move shared definitions into a lower-level module, combine responsibilities that initialize together, or pass runtime dependencies through functions. Tests should fail on an accidental cycle before production startup discovers an early read.

6. **Use dynamic `import()` when loading is genuinely conditional or deferred.**

   Dynamic import is appropriate for optional features or large modules needed on one path. It also provides the asynchronous route from CommonJS into ESM, with the returned promise making that boundary explicit.

7. **Make every file format explicit at package boundaries.**

   Use `"type"` for the package default and `.mjs` or `.cjs` for exceptions. Include extensions in relative ESM specifiers. Inspect the built directory with its own nearest `package.json`; the source tree's package scope does not determine how published files are interpreted.

8. **Assume separate export targets create separate instances.**

   When `"import"` and `"require"` select different files, design them as independent modules unless they deliberately share one underlying implementation. Avoid module-local singletons whose correctness depends on both targets receiving the same cache entry. Test class identity and shared configuration when consumers can reach the package through both loaders.

9. **Test the package name rather than its source path.**

   Pack the library and install the tarball into a clean consumer. Run one ESM smoke test and one CommonJS smoke test when both conditions are published. Exercise documented subpaths and compare their public APIs. This catches missing output and conditional targets whose paths or formats are wrong.

These rules keep module identity and evaluation timing in places where developers can inspect them. Explicit formats make export shapes easier to follow, while tests that enter through the public package paths exercise the same boundaries as consumers.

## Practical Debugging Checklist

When an imported value is `undefined`, stale, wrapped in an unexpected object, or different from the value seen elsewhere in the process, check the boundary in this order:

1. **Identify the format of the importing file.** Check its extension and the nearest `package.json` `"type"` field. Do not infer the active loader from whether the source happens to contain `import()` or a generated `require()` call.

2. **Resolve the package entry point.** Inspect the package's `"exports"` map and determine which condition the current loader selects. Confirm that the selected file exists in the installed package and has the expected format.

3. **Inspect the returned shape.** Determine whether the value is an ESM namespace, a CommonJS export object, or a wrapper generated by a compiler. Check `.default` only after establishing why a namespace or wrapper is present.

4. **Determine what the local variable holds.** An ESM named import is a live binding. A CommonJS object may be shared, while a destructured property is a copied value. A getter stays current only when code continues to read the property.

5. **Check whether evaluation has finished.** Side effects in an ESM dependency run before the importer body. A CommonJS cycle can return a partially constructed export, while an ESM lexical binding can still be uninitialized.

6. **Trace the complete dependency cycle.** The module that closes the loop may be several files away. Look for reads performed during module initialization, especially construction and registration code.

7. **Compare module identity.** Confirm that other parts of the process resolved the same file or URL. Mixed `import` and `require` paths, URL query strings, duplicate package installations, or separate conditional-export targets can create another instance.

8. **Remove transformations from one test path.** Run the published files directly in a supported Node.js version. A test runner or bundler may add default-export wrappers and hide a native-loader failure.

9. **Reproduce through the packed package.** Install the tarball into a clean directory and load it by package name. Test every public entry point through each module system the package claims to support.

This sequence usually locates the mismatch before changes to import syntax obscure it further. Start with the resolved file and the loader that created its instance. Then inspect the exact value returned across the boundary.

## Conclusion

The opening examples diverged even though each appeared to perform the same operation. The ESM import observed `'ready'` through a live binding. In CommonJS, the destructured variable kept `'starting'`, while the consumer holding the exported object observed `'ready'` through its shared reference.

Those results establish the distinction that runs through the rest of the module system. ESM links declared bindings across a dependency graph before evaluation. CommonJS evaluates a module when `require()` reaches it and returns the value of `module.exports`. Both loaders cache module instances, although they maintain separate caches and derive identity through different resolution rules.

Circular dependencies expose the consequences during initialization. CommonJS can return an export object before its module has finished constructing it. ESM can connect a lexical binding before its declaration has initialized it, causing an early read to throw. Delaying the read changes the timing, while removing the cycle changes the dependency structure and produces a more durable result.

Interop adds a translation layer between these models. Importing CommonJS from ESM reliably exposes `module.exports` as the default value, while detected named exports may be copied snapshots. Loading ESM from CommonJS normally produces a namespace object, either asynchronously through `import()` or synchronously through `require()` when the complete graph contains no top-level `await`. Transpilers can add another shape through `.default` wrappers and the `__esModule` convention.

Published packages make every one of these choices operational. Package scope and file extensions determine a file's format, while conditional exports select the path presented to each loader. Separate `"import"` and `"require"` targets can expose equivalent APIs while creating independent classes or shared-state instances. Tests that import source files cannot reveal a broken path in the packed artifact.

When module behavior looks impossible, identify the resolved file and the loader that created it. For ESM, establish which binding crossed the boundary. For CommonJS, determine whether the consumer retained the exported value or copied one of its properties. Then verify that evaluation has completed and that the rest of the process holds the same module instance. These questions connect unexpected behavior to visible loader decisions.

Modules hide resolution and evaluation behind compact syntax. Once those stages are separated, `import` and `require` stop looking like interchangeable spellings and start describing different ways to connect code.

The same hidden-assumption pattern appears elsewhere in JavaScript tooling and data boundaries:

- [Your Debounce Is Lying to You](/posts/2026-03-28-Your-Debounce-Is-Lying-to-You/) covers the gap between controlling call frequency and controlling asynchronous work.
- [Your Throttling Is Lying to You](/posts/2026-03-31-Your-Throttling-Is-Lying-to-You/) shows how naive throttling can discard the final state.
- [Your HTTP Client Is Lying to You](/posts/2026-04-19-Your-HTTP-Client-Is-Lying-to-You/) examines the interactions between retries, timeouts, rate limits, and tail latency.
- [Your Recursion Is Lying to You](/posts/2026-05-09-Your-Recursion-Is-Lying-to-You/) separates language-level structure from runtime guarantees.
- [Your Package Manager Is Lying to You](/posts/2026-06-11-Your-Package-Manager-Is-Lying-to-You/) examines how install layout changes which modules can be resolved.
- [Your Console Is Lying to You](/posts/2026-06-28-Your-Console-Is-Lying-to_You/) covers live object inspection and timing-sensitive output.
- [Your JS Date Is Lying to You](/posts/2026-07-21-Your-JS-Date-Is-Lying-to-You/) explores parsing, mutation, timezones, and normalization.
- [Your JSON Is Lying to You](/posts/2026-08-03-Your-JSON-Is-Lying-to-You/) follows values that change shape while crossing a serialization boundary.
