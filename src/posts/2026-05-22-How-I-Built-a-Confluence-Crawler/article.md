---
layout: layouts/post.njk
title: "How I Built a Confluence Crawler"
date: 2026-05-22
description: "Building a Go-based CLI tool to export Confluence spaces to local Markdown files for RAG pipelines, offline docs, and Git-based knowledge management."
excerpt: "Confluence exports are terrible. I built confluence2md, a CLI that crawls your Confluence space and converts it to clean local Markdown files. Here's how I approached the problem, the design decisions, and why it matters for RAG and knowledge management."
tags:
- posts
- golang
- Confluence
- RAG
- knowledge-management
---

>TLDR: If you are not interested in the story and just want the tool, go straight to the repository: [github.com/gkoos/confluence2md](https://github.com/gkoos/confluence2md). It is a CLI that crawls Confluence and mirrors it into local Markdown files, including links, comments, and attachments, with support for incremental updates.

This started with a small problem that slowly became expensive: finding things in our company Confluence was harder than it should have been.

The first issue was human. Search results were noisy; useful pages existed, but they were buried under stale docs, half-duplicated runbooks, and pages whose titles made sense only to the person who wrote them three years ago. When you are in the middle of an incident or trying to understand a legacy service, that's not ideal.

The second issue was machine. I was building workflows with LLMs, and Confluence turned out to be a difficult source to work with directly. The content model is not designed around LLM retrieval quality. You can pull pages through APIs, but you still need to normalize structure, preserve context, handle references, and keep updates in sync. If the source layer is messy, everything downstream in your AI pipeline inherits the mess.

At some point the idea clicked: Markdown is a format that both humans and machines handle well. Humans can read it in any editor, Git can diff it, indexers can process it, LLM pipelines can chunk it. So instead of fighting Confluence at query time, why not mirror the space locally into clean Markdown and treat that mirror as the canonical retrieval layer?

That was the origin of `confluence2md`.

## The First Attempt

The first design looked almost too clean: at heart, this is a two-phase crawling problem.

Phase one: start from one or more seed pages, crawl linked pages to a configurable depth, and convert each page into Markdown.

Phase two: once you know the complete set of crawled pages, rewrite internal Confluence links into local relative links.

On paper, this gives you exactly what you want. You avoid guessing link targets while crawling, because rewrite decisions happen only after the graph is known. You keep the logic separable: fetching and conversion in phase one, graph-aware link correction in phase two.

I expected most of the effort to be around traversal performance and retry logic. Instead, the hardest work appeared in the conversion layer and update model. The crawling algorithm was the easy part.

## The Pain of Converting Confluence to Markdown

Confluence content is not "almost Markdown": it is stored in a custom storage format that is XML-heavy, macro-heavy, and full of edge cases that are perfectly valid in Confluence but awkward outside of it.

The first surprise: two pages that look visually similar in Confluence can serialize very differently in storage format. Tables, rich text blocks, code snippets, callouts, and macro output can appear in patterns that are not trivial to flatten into readable Markdown.

The second surprise was links: "a link to another Confluence page" is not a single thing. You encounter multiple URL shapes, embedded references, path-based forms, query-based forms, and links whose targets are obvious to Confluence but not obvious to your converter. If link extraction fails silently, your local mirror is technically present but functionally broken.

The third surprise was macros. Macros are one of Confluence's superpowers, but also one of the biggest export headaches. Some macros map cleanly to Markdown - like constructs. Others are effectively mini-apps embedded in page content. You need a strategy for graceful degradation, not perfect one-to-one fidelity. Your realistic goal is utility, not pixel-perfect cloning.

The key lesson was that conversion is not just a renderer problem. You are trying to preserve meaning and navigability under a different representation model. Once I accepted that, the implementation got better: normalize aggressively, preserve critical references, and be explicit about what gets transformed versus passed through. And I most likely missed lots of edge cases too. The best I could do was to cover the most common patterns I encountered and make sure the system is resilient to weird content rather than brittle.

## The Pain of Comments and Attachments

After getting page conversion to a usable state, comments and attachments became the next wall.

Comments matter more than people think. In many organizations, the real decision history lives in comments: caveats, corrections, "do not do this anymore", and contextual notes that never made it into the page body. Exporting pages without comments creates a technically complete mirror that is practically incomplete.

Attachments are similar. A runbook that references scripts, screenshots, or PDFs is only useful if those references survive locally. Broken attachment links are almost worse than missing files, because they create false confidence.

In Confluence APIs, comments and attachments often come through different endpoints and different response shapes. They do not naturally slot into a naive page conversion pass. I had to treat them as first-class parts of the model: fetch, normalize, persist, and rewrite references so local files resolve correctly.

For comments, the practical choice was to append them into a clear section in each generated Markdown page. That keeps context colocated with the source page while staying machine-readable. For attachments, the rule was simple: if a page references a file and that file is in scope, download it and rewrite the reference to local path. If not, fail visibly.

Once those rules were in place, the mirror stopped feeling like an "export artifact" and started feeling like a usable documentation corpus.

## The Pain of Updates

Then came the real operational problem.

A corporate Confluence space can have thousands of pages. Most runs happen because a small subset changed. Full recrawls are wasteful, slow, and expensive in API quota terms. If every update cycle requires reprocessing everything, people stop running updates, and your mirror becomes stale.

Initially, [CQL](https://developer.atlassian.com/cloud/confluence/advanced-searching-using-cql/) looked like the obvious solution. Query pages by modification window, fetch only changed content, done. In theory, elegant. In practice, not sufficient.

Why it did not hold up in production:

CQL can tell you what changed according to indexed metadata, but does not magically solve all dependency and consistency issues for a local mirror. Link graphs can shift. Referenced pages may become relevant without being directly changed in a way your query catches at the right time. Some operational edge cases appear around indexing lag and query behavior that are tolerable in UI search but painful for deterministic synchronization.

I needed a model that prioritized reliable convergence over clever query shortcuts.

The solution became an incremental strategy backed by checkpoints and deterministic traversal behavior. In short: keep the crawl model stable, detect what is dirty versus reusable, and make update decisions based on explicit processing state rather than optimistic assumptions.

This is where the dual-checkpoint idea paid off:

- A completed checkpoint tracks what finished processing.
- A successful checkpoint tracks what finished with zero errors.

That split avoids a common failure mode where partial runs accidentally look "healthy" and poison future incrementals. You can advance progress while still preserving correctness signals.

The result is that updates mode can reuse clean artifacts aggressively while still rerendering genuinely dirty pages. It is fast enough to run frequently, and predictable enough to trust.

## Technical Choices

Go was a deliberate choice, not just personal preference.

For CLI tools, Go gives you a very practical package: fast startup, straightforward concurrency, solid standard library, and simple deployment through static binaries. That matters when your users might run the tool in local shells, CI jobs, or mixed developer environments across operating systems.

The crawling workload itself also maps well to Go's model. You can manage concurrency and rate limiting cleanly without pulling in heavyweight runtime dependencies. The codebase stays compact and maintainable, which matters for a tool that has to evolve with API quirks.

On distribution, Go keeps friction low. Cross-platform release artifacts for Linux, macOS, and Windows are easy to automate, and users can download, extract, and run without installing language runtimes. For internal tooling adoption, that is a huge win.

## From Chaos to a Working Mirror

At this point, the major blockers were resolved: conversion fidelity, link rewriting, comments and attachments, and incremental update correctness.

What emerged is not a one-off exporter but a repeatable mirror process. You can point it at seeds, run a full sync, then run updates regularly and keep a local Markdown representation of your Confluence knowledge that stays useful over time.

That sounds simple now, but it took several iterations to make "works once" become "works repeatedly under real constraints".

## What Is It Good For

The first obvious use case is a personal or team second brain. Once content is local Markdown, people can search and browse with tools they already trust instead of relying entirely on Confluence UI behavior.

The second is offline and operational resilience. If network access is limited, if Confluence is degraded, or if you simply want a local snapshot for incident work, the mirror is immediately useful.

The third is versioned knowledge management. Putting mirrored docs in Git gives you history, diffs, and visibility into how operational knowledge evolves. That is valuable for onboarding, audits, and postmortems.

The fourth is machine workflows. Clean local Markdown plus metadata is a far better substrate for indexing and retrieval than trying to resolve everything live against Confluence APIs at query time.

In practice, this means one mirror can serve multiple audiences: humans browsing docs, engineers diffing changes, and AI systems consuming structured text.

## Next Steps

The obvious next step is to feed the mirror into a [RAG pipeline](https://en.wikipedia.org/wiki/Retrieval-augmented_generation), but that should not mean "one page equals one chunk". That naive approach throws away structural signals and often hurts retrieval quality.

A stronger pipeline should chunk by semantic boundaries: headings, sections, and content blocks that correspond to coherent ideas. It should preserve metadata such as page ID, title, source URL, section path, and update timestamp. It should also account for duplicated content, stale snapshots, and link context that may improve answer grounding.

Another important step is retrieval strategy. Hybrid retrieval often works better than pure vector search for operational docs, because exact keywords (service names, env vars, incident IDs) matter. A good pipeline can combine lexical and semantic retrieval, then rerank with contextual scoring.

There is also room for change-aware indexing: when the mirror updates, only re-embed affected chunks and keep stable identifiers so downstream stores do not churn unnecessarily.

In other words, mirroring Confluence to Markdown is not the final destination. It is the foundation. Once that foundation is reliable, higher-level knowledge workflows become much easier to build correctly.

## Conclusion

This project began as frustration with documentation discoverability and ended as a practical data pipeline for both humans and machines.

The core idea is simple: convert an operationally messy knowledge source into a local, readable, versionable, machine-friendly representation. The implementation was not simple at all, especially around conversion fidelity and incremental correctness, but the payoff is real: a Confluence space you can actually work with.

If this sounds useful for your team, the tool is open source and ready to run:
[github.com/gkoos/confluence2md](https://github.com/gkoos/confluence2md)
