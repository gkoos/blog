---
layout: layouts/post.njk
title: "Your Package Manager Is Lying to You"
date: 2026-06-11
description: "npm, Yarn, pnpm, Bun, and Deno are not interchangeable install tools. They encode different assumptions about dependency layout, compatibility, reproducibility, and developer speed."
excerpt: "Most developers treat package managers as interchangeable: install dependencies and move on. That assumption breaks down fast. npm, Yarn, pnpm, Bun, and Deno optimize for different dependency models, and those model choices are exactly where real-world breakage starts."
tags:
- posts
- javascript
- nodejs
- npm
- yarn
- pnpm
- bun
- deno
- tooling
---
Package managers are usually treated as interchangeable tooling: install dependencies, commit the lockfile, and move on. In that framing, the only question that seems to matter is performance.

In practice, the differences run much deeper. npm, Yarn, and pnpm are built on fundamentally different models of what `node_modules` should be: different assumptions about how dependencies should be represented on disk, how strictly boundaries should be enforced, and how much implicit behavior the ecosystem should tolerate.

Bun and Deno go further: they challenge the model itself. Bun treats the entire developer loop as something that should feel instantaneous. Deno folds dependency management into a broader security and web-native runtime philosophy.

This is why migrations often feel disproportionate. The lockfile might be perfect and your application code untouched, yet builds break because scripts, plugins, and tools were written against a different set of invariants about the filesystem.

**The real axis of difference isn't speed or disk usage, but how each tool chooses to represent and resolve dependencies.**

Every package manager is a different compromise between what physically exists on disk and what the ecosystem expects to find. Those tradeoffs are easiest to see through five competing goals.

## The Five Competing Goals

Every package manager is trying to optimize the same things:
- Reproducible installs
- Install speed and cache reuse
- Disk efficiency across multiple projects
- Compatibility with the Node ecosystem as it exists today
- Developer experience (integrated tooling, lower friction, safer defaults)

No tool can maximize all five at once. The practical choice is usually the one whose failure mode you’re most willing to tolerate.

## [npm](https://www.npmjs.com/): The Pragmatic Baseline (Compatibility Over Correctness)

npm is the default package manager for Node.js and has been since its early days. If you use Node, you have npm. This gives npm a huge advantage in terms of ecosystem compatibility and developer familiarity, but it also means npm has had to make compromises to maintain that compatibility over time.

### Core Model

npm flattens the dependency tree by placing packages as high as possible in `node_modules`, then falls back to nested subdirectories only when version conflicts force it. This simple strategy was born from pragmatism: Node's module resolution algorithm walks up the directory tree looking for `node_modules`, so the flatter the structure, the faster the lookup and the fewer surprises developers encounter. The strategy has persisted because it still broadly works with how the Node ecosystem is wired.

### Design Philosophy

npm's philosophy is pragmatic continuity: rather than enforce a strict model of dependency access, npm prioritizes keeping the ecosystem running as it currently runs. This means tolerating patterns that are structurally impure if those patterns are common in the wild. A new, stricter model might be more correct, but it would break existing code and tooling, so npm's design philosophy is to bend toward the ecosystem rather than ask the ecosystem to bend toward it.

### Strengths

This design brings several concrete advantages. Compatibility is the biggest: almost every tool in the JavaScript ecosystem was first tested and optimized for npm's semantics, so migrating away from npm often means discovering edge cases in other tooling. Setup is minimal, which matters for teams that don't want to spend cycles learning tooling; npm just works by default. And there is real value in being bundled with Node itself: it means npm is always available, always installed, and always familiar to anyone with Node on their machine.

### Weaknesses

The cost of this compatibility-first approach is structural ambiguity. Hoisting can make undeclared dependencies accidentally available, which means the actual runtime dependency graph often differs from what `package.json` files claim. On larger codebases, this ambiguity compounds: `node_modules` can become very large and performance can degrade in monorepos or CI pipelines where many projects share the same machine. Install times are generally slower than newer, store-based approaches, especially when you are running the same installs repeatedly across different projects or CI runs.

### The Lie It Tells

npm's lie is a useful one: it suggests that a package's runtime behavior matches its declared dependencies. In reality, a package can often reach into the hoisted tree and use packages it never declared, simply because those packages were placed somewhere reachable. The discrepancy is usually invisible until something changes—a new dependency, a version conflict, or a different install layout on a different machine—and suddenly that undeclared access no longer works.

### Example

Suppose your app declares `react`, but one of your dependencies declares `lodash`. npm hoists both to the top level of `node_modules`. If your app imports `lodash` directly, it will work—and the import may be there because someone saw it was available and used it for convenience. Months later, you update a different dependency, or remove the one that was declaring `lodash`. Now npm's hoisting algorithm arranges things differently, and `lodash` is no longer at the top level. Your app's direct `import lodash` suddenly fails, and the error looks baffling because you never explicitly declared the dependency and the import appears to be fine in the code.

### Best for

npm remains the default choice for most teams, especially those building straightforward applications, maintaining legacy codebases, or operating in environments where broad ecosystem compatibility matters more than perfect structural correctness. If your priority is minimizing friction and maximizing the number of third-party packages and tools that work without special configuration, npm is still usually the right call.

## [Yarn (Berry)](https://yarnpkg.com/): Reproducibility as a Response to npm's Early Chaos

When people refer to "Yarn" in 2026, there is often ambiguity about which version they mean. Yarn Classic (v1) was released as a faster alternative to npm in the npm v3–v4 era and is still widely used in legacy projects. Yarn Berry (v2 and later) is a much more ambitious reimagining, released around 2019, that fundamentally questions whether `node_modules` should exist at all. This section focuses on Yarn Berry, because that is where Yarn's design philosophy is most visible.

### Core Model

Yarn Berry combines a strong lockfile system with an optional Plug'n'Play (PnP) mode that abandons the `node_modules` directory entirely. Instead of storing packages on disk in the traditional way, PnP mode uses a `.pnp.cjs` file to map each package to its location in a global cache, and Node's module resolution is intercepted to consult that map. The lockfile is deterministic to the byte, meaning the same `yarn.lock` on any machine will always produce the exact same dependency tree and artifacts. If you want, you can run `yarn install --immutable` and ship the dependencies as part of your repository, enabling zero-install setups where CI does not need to download or build anything.

### Design Philosophy

Yarn's philosophy is reproducibility as a first-class concern and extensibility as a design principle. Every decision in Yarn Berry prioritizes the ability to reproduce an install exactly, down to the checksum of every file. The plugin system allows customization at nearly every step of the install process, which appeals to large organizations that need to enforce internal policies or integrate custom private registries and tooling. Yarn treats package management as a build artifact that deserves the same rigor as compiled code.

### Strengths

Yarn delivers on reproducibility in ways that are genuinely powerful for large teams. Every install is deterministic and can be verified; there is no ambiguity about what your project depends on or how it was resolved. The plugin ecosystem is extensive, allowing organizations to customize resolution, transport, and authentication without forking the entire tool. Zero-install workflows are real: you can ship `.yarn/cache` and `.pnp.cjs` in version control so anyone cloning the repo can start work immediately without running `yarn install`. For enterprise teams managing complex monorepos with internal tooling, Yarn's flexibility can be a major advantage.

### Weaknesses

The cost of this power is complexity and ecosystem friction. Plug'n'Play mode breaks many tools that assume a traditional `node_modules` directory exists. Older packages may have scripts that do `fs.readdirSync('node_modules')` or similar filesystem introspection, and those simply fail under PnP. Even many modern tools can behave unexpectedly because they were written for `node_modules` semantics. Build tools, bundlers, and testing frameworks often need special configuration or plugins to work well with PnP. Yarn Berry adoption is still much smaller than npm or pnpm, so community support and third-party integration are less mature. For teams that do not have a dedicated DevOps or tooling function, Yarn's flexibility can feel like unnecessary overhead.

### The Lie It Tells

Yarn's lie is seductive: that you can completely abstract away `node_modules` and replace it with something cleaner and more reproducible without paying a compatibility tax. The reality is that the Node ecosystem is deeply wired around the expectation of a physical `node_modules` directory, and that wiring is stronger than Yarn's tooling can fully hide. Tools that Yarn does not control will still expect `node_modules` to exist.

### Example

You enable PnP mode and everything works locally. Your build tool has a Yarn plugin, your test runner runs fine, and the install is instant. Then a team member uses a script that was written by someone else in your organization years ago, or tries to use a third-party tool that does `require.resolve()` with filesystem assumptions, and it fails because the packages are not actually on disk in `node_modules` anymore. You can often fix this by adding a Yarn plugin or switching to a different tool, but each fix is a small friction point.

### Best for

Yarn Berry is best suited to large organizations with dedicated tooling teams, complex monorepos, or projects where reproducibility and extensibility are more valuable than broad tool compatibility. If you are willing to invest in understanding and maintaining Yarn's plugin system, or if your CI environment is fully under your control and can be customized, Yarn offers genuine advantages. For smaller teams or projects that need to work smoothly with a wide variety of third-party tools out of the box, Yarn's cost-to-benefit ratio is often too high.

## [pnpm](https://pnpm.io/): Structural Correctness Through Isolation

*Note that I am biased towards pnpm, because it was created by a fellow Hungarian called Zoltan Kochan.*

pnpm takes a different approach to the same problems that motivated Yarn. Rather than try to abstract away `node_modules`, pnpm makes `node_modules` stricter and more honest about what dependencies are actually available.

### Core Model

pnpm uses a content-addressable global store and symlinks to build a non-flattened `node_modules` tree. Each package in your project gets its own `node_modules` directory containing only the packages it directly declares, plus symlinks to those packages' dependencies. This means a package's `node_modules` mirrors its `package.json` exactly: if it declares `lodash`, `lodash` is there; if it does not, `lodash` is not accessible through the filesystem, even if some other package brought it in. The global store deduplicates identical copies of the same package across multiple projects, which saves substantial disk space, especially in monorepo environments.

### Design Philosophy

pnpm's philosophy is structural correctness and efficiency. The core belief is that the dependency graph should be explicit and strict: if a package declares a dependency, it should be there; if it does not, it should not be. This honesty creates friction with the ecosystem, but it also exposes bugs and bad practices that npm and Yarn hide. pnpm's secondary goal is disk efficiency, achieved through content-addressable storage and symlinks rather than through hoisting or abstraction.

### Strengths

pnpm delivers tangible benefits for the specific use cases it targets. Disk savings are real and measurable, especially in monorepos or CI environments where many projects are installed on the same machine; a global store means installing `lodash` a second time costs almost nothing. Isolation eliminates phantom dependencies entirely, so your code is forced to match what your `package.json` claims. Installation is fast, both because the global store avoids duplication and because pnpm can leverage hard links and copy-on-write in certain environments. For monorepos in particular, pnpm's performance characteristics are better than npm's in almost every scenario.

### Weaknesses

The cost is ecosystem friction. Tools and packages that were written assuming npm's hoisting behavior will break under pnpm. A `postinstall` script that does `require('lodash')` without declaring `lodash` will fail. Build tools that walk the `node_modules` tree looking for specific files may find them in unexpected places because they are symlinked rather than copied. Older packages with complex installs sometimes fail. On Windows, symlinks can introduce permission issues. The Node ecosystem was not built around strict isolation, so opting into pnpm means being prepared for occasional surprises and workarounds.

### The Lie It Tells

pnpm's lie is that the filesystem representation of dependencies is obvious and complete. The reality is that the filesystem is now abstract: packages are symlinks to a global store, and the actual files are cached globally. You can no longer walk into `node_modules` and see what you have; you have to understand symlinks and content addressing. For teams used to simple filesystem navigation, this is a minor lie, but it is there.

### Example

You install a package that has a `postinstall` script expecting to reach a transitive dependency. Under npm, the hoisting may make that work accidentally. Under pnpm, the transitive dependency is not in that package's `node_modules` tree, so the script fails. You either need to add the transitive dependency to the package's declared dependencies (which is the "correct" fix) or work around it. This kind of friction is common enough to notice during monorepo migrations.

### Best for

pnpm is the best practical upgrade from npm if your pain point is disk usage or install time in a monorepo, or if you want the strictness of explicit dependencies without the complexity and friction of Yarn's PnP mode. It is increasingly becoming the package manager of choice for large monorepos and organizations that can tolerate the ecosystem friction. For solo projects or teams that prioritize broad compatibility over strictness, pnpm offers less value.

## [Bun](https://bun.sh/): Speed as a First-Class Citizen

Bun is a newer runtime that bundles its own package manager, and that manager reflects Bun's core philosophy: speed should feel magical, and the entire developer experience should be instantaneous. Unlike npm, Yarn, and pnpm, which are package managers that happen to work with Node, Bun's package manager is designed from the ground up as part of a runtime that understands and optimizes for the entire development loop.

### Core Model

Bun's package manager uses a global store similar to pnpm but with tighter integration into Bun's runtime and with different optimization strategies. The install process is dramatically faster than npm, in part because Bun itself is written in Zig and uses parallelism aggressively, and in part because Bun can resolve and validate dependencies using runtime knowledge that npm cannot. Bun also attempts to maintain broad compatibility with npm's `node_modules` layout, so the transition is often smooth, but Bun can also use its own dependency resolution when advantageous.

### Design Philosophy

Bun's philosophy is simplicity through speed. The core belief is that friction in the development loop comes from waiting—waiting for installs, waiting for builds, waiting for tests. Bun attacks that friction by making every operation as fast as possible, and by consolidating tools that developers usually need to install separately (bundler, transpiler, test runner, package manager) into a single cohesive system. The design accepts some ecosystem incompatibility if that incompatibility enables significant speed gains.

### Strengths

Bun is genuinely fast in ways that matter. Install times are often 5–10x faster than npm, and that speed translates to real developer experience gains, especially in CI pipelines or on machines with slower disks. Running `bun install` and then immediately using installed packages feels snappy in a way that npm rarely achieves. Because Bun is a complete runtime, it can also function as a drop-in replacement for Node in many scenarios: you can run TypeScript files directly without transpilation, use Bun's built-in test runner instead of installing Jest, and use Bun's bundler instead of webpack. For greenfield projects or teams willing to commit to Bun as their primary runtime, this all-in-one experience is compelling.

### Weaknesses

Bun is still maturing, and that maturity gap is visible in production. Some native Node modules do not work with Bun because Bun's native module interface is different from Node's. Complex webpack configurations or advanced build setups sometimes require adaptation. Third-party tools that hook into Node internals (like certain APM or debugging tools) may not work. Bun's adoption is still small compared to Node, so the ecosystem is less tested against Bun semantics. The risk is real: betting on Bun means accepting that you may hit undocumented edge cases or that some dependency may not work as expected. For teams that need guaranteed stability and compatibility across a broad range of tooling, Bun is not yet a safe choice.

### The Lie It Tells

Bun's lie is that you can use it as a drop-in replacement for Node without any friction. The reality is that while Bun is compatible with a high percentage of Node packages and tooling, it is not completely compatible. Tools that assume Node internals, native modules with Node-specific bindings, or code that relies on subtle Node.js behavior differences will surface issues that are not immediately obvious.

### Example

You switch your project to Bun and installs become blazingly fast. Your basic tests run. You deploy and everything works for a few weeks. Then a package that uses a native module breaks because its Node-specific binding does not work in Bun. Or an internal tool relies on `node` being available in the PATH, and Bun is not recognized as a drop-in replacement. Or a third-party SDK that patches Node internals fails. These are not Bun issues; they are ecosystem expectations that Bun has not yet fully absorbed.

### Best for

Bun is best for greenfield projects where you control the entire toolchain and can commit to Bun as your primary runtime. If your primary goal is speed and developer experience, and you are willing to occasionally work around compatibility edge cases, Bun is a compelling choice. For existing projects heavily invested in Node.js tooling, or for production systems that require broad compatibility guarantees, Bun is not yet the pragmatic choice.

## [Deno](https://deno.land/): The Secure, Web-Native Alternative

Deno is a runtime built by the creator of Node, and its package manager reflects a philosophical rethinking of what dependency management should mean on the web. Rather than importing from `node_modules`, Deno primarily imports from URLs, storing code in a global cache. This approach is radically different from all the tools we have discussed, and it surfaces a different set of tradeoffs that appeal to developers who care about security and clean architecture more than ecosystem inertia.

### Core Model

Deno uses a URL-based import model by default. When you import a module, you provide its full URL (e.g., `https://deno.land/std/fmt/mod.ts`), and Deno caches it globally on your machine. There is no `node_modules` folder, no hoisting, no flattening. You are also not limited to npm packages; you can import from GitHub raw files, any web server, or third-party registries. For teams that have adopted `package.json` and npm, Deno 2+ also supports npm compatibility, allowing you to run `deno install` on a traditional `package.json` file and get similar behavior to npm.

### Design Philosophy

Deno's philosophy is security by default and simplicity through URLs. The core belief is that dependencies should be explicit and traceable, and that the web's native import model (URLs) is cleaner and more secure than npm's node_modules. Security is not an afterthought; Deno grants zero permissions by default. A script cannot access the network, file system, or environment variables without explicit permission flags. This is a radical departure from Node, where every installed package can do anything to your system.

### Strengths

Deno's security model is genuinely compelling. You know exactly what URLs you are importing from, and you can audit them. Third-party code cannot access your file system or make network calls unless you explicitly allow it with permission flags. The built-in toolchain is also excellent: Deno includes a formatter, linter, test runner, documentation generator, and bundler without needing additional installations. For projects starting from scratch with TypeScript, Deno feels clean and cohesive in a way that Node does not. URL-based imports also side-step the entire ecosystem compatibility issue because you control exactly which code you are importing.

### Weaknesses

Deno is smaller than Node and npm, so the ecosystem is more limited. While there are many high-quality Deno packages available, the breadth and maturity of npm's ecosystem is incomparable. A specialized library or framework you rely on might not exist for Deno, or might be maintained by a small team with less stability than the npm equivalent. Converting an existing npm project to Deno-native imports is labor-intensive because you must rewrite every import to use URLs instead of package names. For teams deeply embedded in the npm ecosystem, Deno feels like a step backward in terms of library availability and community support.

### The Lie It Tells

Deno's lie is that security and clean philosophy automatically translate to better software. The reality is that URL-based imports are harder to version correctly, easier to accidentally pin old versions, and less discoverable than npm's centralized registry. A globally cached third-party module is still a third-party module, with all the attendant risks.

### Example

You start a new Deno project and use URL-based imports from deno.land. Everything feels clean. You grant only the permissions your code actually needs: `deno run --allow-read --allow-net my-script.ts`. Six months later, you want to upgrade a dependency, but because you pinned the URL to a specific version, you have to manually find and update every import throughout your codebase. If you had used a package.json with Deno 2+ npm compatibility, you would have a cleaner upgrade path, but then you lose the simplicity of URL-based imports.

### Best for

Deno is best for security-conscious projects, fresh TypeScript greenfield work, and teams that philosophically prefer the web's native import model. If you are building backend services or tooling where the built-in security model matters, and you are willing to accept a smaller ecosystem, Deno is a compelling choice. For projects that rely heavily on npm packages or for teams that need maximum ecosystem access, Deno is not yet pragmatic.

## The Core Thesis: Different Mental Models

When we step back from each tool's implementation details, a clearer pattern emerges. The real axis of difference is not speed or disk usage or which tool claims to be the fastest. The real difference is how each tool chooses to represent and resolve dependencies in the first place, and what that representation means about the relationship between your code and the packages it depends on.

At the heart of these five tools is one fundamental question: how should the package manager resolve and physically (or virtually) lay out dependencies on your machine? npm flattens them to maximize compatibility. Yarn reproducibly locks them and can abstract them away entirely. pnpm isolates them structurally. Bun optimizes around speed. Deno rejects the node_modules model altogether. Each answer reflects a different assumption about what dependencies should be, and each assumption carries consequences.

| Tool     | Mental Model                              | Core Assumption                        | Best For                          |
|----------|-------------------------------------------|----------------------------------------|-----------------------------------|
| npm      | Flattened convenience graph               | Compatibility first                    | Most everyday projects            |
| Yarn     | Reproducible build artifact               | Tooling extensibility                  | Enterprise customization          |
| pnpm     | Explicit isolated graph                   | Structural correctness                 | Monorepos & large codebases       |
| Bun      | Invisible high-performance detail         | Speed should feel magical              | Speed-first greenfield            |
| Deno     | Web-native secure code imports            | Dependencies can be clean and safe     | Security / philosophy-driven work |

## Where Things Actually Break

Understanding these mental models is intellectually interesting, but the gap between philosophy and practice is where package managers reveal themselves. The Node.js ecosystem was built entirely around npm's assumptions. Thousands of packages, build tools, and deployment scripts are hardcoded to expect npm's specific model of dependency resolution and layout. Any deviation from that model carries a compatibility tax, and that tax is paid in small, accumulated frictions that add up.

*I once spent four hours debugging a monorepo migration from npm to pnpm. The overall migrate looked clean: update the lockfile, run `pnpm install`, commit, done. But a postinstall script deep in one of our dependencies was doing something that should have been impossible: it was reaching into a transitive dependency that pnpm didn't hoist by default. The script didn't declare that dependency, so it shouldn't have been able to find it. Under npm's flattened model, it was just there. Under pnpm's strict model, it was nowhere. The build broke silently at a step the script didn't fail on, it just couldn't find what it needed. Debugging required understanding not just what pnpm did differently, but what that dependency's script was secretly assuming about npm's layout.*

## Why Switching Feels Like Progress (or Regress)

Every few years, a new wave of developers discovers a newer package manager and adopts it with missionary zeal. npm → Yarn felt revolutionary in 2016 because npm was genuinely unstable and Yarn's lockfile was a genuine breakthrough. npm → pnpm often feels like finally getting it right, because pnpm's strict isolation catches real bugs that npm hides. npm → Bun feels like magic because it *is* fast. npm → Deno feels philosophically cleaner because security-by-default and URL-based imports genuinely reduce certain classes of risk.

And yet, for most day-to-day work, staying on npm still feels like the rational default. That is not because npm is objectively best, adoption is rarely driven by just technical superiority in isolation. It's driven by the difference between friction and payoff. For a small team on a stable project with no monorepo pain, the chore of switching to pnpm outweighs the payoff. For a team that has just hit their third incident caused by a phantom dependency, pnpm suddenly looks very attractive. For a greenfield project where speed is critical and you can control the entire toolchain, Bun is worth the risk. But most teams inherit their package manager from whatever was already there when they joined.

## Practical Decision Guidance in 2026

Choosing a package manager should be boring and practical, not philosophical. Here is how to think about it:

If you are starting a new project or working on something small, solo, or legacy where nothing breaks and you want zero friction, **npm** is still the right choice. It is the default, it works, and your entire team already understands it. If you have a monorepo with hundreds of packages and your CI pipeline is slow or your developers are regularly confused about which dependencies are actually available, **pnpm** is the strongest practical upgrade. It solves real pain points without requiring architectural rethinking. If you have a large enterprise with heavy custom workflows, heavy internal tooling requirements, or deep build customization, **Yarn Berry** can provide the plugin system and flexibility you need. If you are starting a new greenfield project and your primary constraint is speed—and you are willing to occasionally work around compatibility edges, **Bun** offers a genuinely better developer experience. If you are building something security-critical or you are philosophically committed to clean, traceable dependencies, **Deno** is worth the ecosystem cost.

The truth is that most teams do not actually choose their package manager, they inherit one. The developer who set up the project chose it three years ago, and now changing it feels like choosing to fight an unnecessary battle. That inertia is not always wrong. Switching has real costs, and the payoff is often smaller than it feels until you have actually experienced years of pain under your current tool.

## Conclusion

Your package manager is not malicious. It's not lying out of deception, it's lying out of necessity. Every tool optimizes for a specific set of assumptions about what `node_modules` should represent, what dependencies should mean, and what the developer's priority actually is. npm optimizes for compatibility and zero configuration. Yarn optimizes for reproducibility and extensibility. pnpm optimizes for correctness and disk efficiency. Bun optimizes for speed. Deno optimizes for security and simplicity on the web.

The real question you need to ask yourself is not "which package manager is best?" but "which set of assumptions - and which set of lies - am I willing to live with?" Because every tool has tradeoffs: they make a fundamental choice about what matters and what you can afford to sacrifice. Understanding those choices, and understanding what your real pain point actually is, is the only way to make a decision you will not regret.