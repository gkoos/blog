---
layout: layouts/post.njk
title: "A Year of Building"
date: 2026-07-29
description: "How a layoff and a security clearance wait turned into a year of open source projects, technical writing, and discovering what happens when work and side projects align."
excerpt: "A year ago, uncertainty opened up time I didn't expect. That time became projects that solved real problems, writing that reached unexpected audiences, and eventually work that aligned with what I'd been building all along. This is what the journey looked like."
tags:
- posts
- personal
- open source
- technical writing
- career
---
![](nechama-lock-1Wfe-zmHtGc-unsplash.jpg)

Until July 2025, I was one of the laziest developers, but then something unique happened. Not long before that I got laid off, so I decided to pimp my CV and started working on some GitHub projects. I was lucky enough to get a new job soon, signed the contract, but then I had to wait for months to start, until my Security Clearance was approved. This put me in an odd situation: I technically had no job, but didn't have to prepare for interviews either, so I had a lot of free time. I was already working on projects that addressed my own pain points as a developer, made some good progress, so I didn't want to abandon them.

## Building in the Gap

This is when I created [ffetch](https://github.com/fetch-kit/ffetch), because every project I was working on we implemented our own resilience layer on top of fetch. One of the early feedbacks I got was "yeah, that name is stupid". The first time I implemented a fetch wrapper at work, I had a colleague called Paul Ffrench, so it's named after him. Wherever you are Paul, I hope you're good.

The next step was creating tools for testing `ffetch`, so [chaos-proxy](https://github.com/fetch-kit/chaos-proxy) and [chaos-fetch](https://github.com/fetch-kit/chaos-fetch) were born. Then, because I love golang but rarely had the opportunity to actually use it at work, I ported `chaos-proxy` to golang and created [chaos-proxy-go](https://github.com/fetch-kit/chaos-proxy-go).

I had a solid foundation of projects, but I didn't want to work almost full time on my own stuff in complete obscurity. I needed a way to do some light promotion.

## Resurrecting the Blog

I had an abandoned blog, mostly about [matched betting](https://en.wikipedia.org/wiki/Matched_betting) mathematics from 2017. I dusted it off and started writing. The idea was to promote my OSS work, but I wanted to start with a few more generic posts. The first pieces were about [skyline queries](https://en.wikipedia.org/wiki/Skyline_operator), a fascinating topic with surprising mathematical depth, then an old, never published writeup about hash tables. 

I slowly started to enjoy writing technical deep dives: go internals, network resilience, database engines. The research was engaging. The writing forced me to think clearly about complex topics. Articles on Reddit gained unexpected traction. Posts got picked up by newsletters and made it to the front page of Hacker News. People were reading things I wrote.

During this time I also shipped [nullmail](https://nullmail.cc), an anonymous, disposable email service. It's still running with a few hundred daily users. It runs on Vercel's free tier, and I regularly get emails saying I'm constantly over 75% of the free tier allowance. I put a buymeacoffee link on it. So far one person paid $10. I'm in profit. 🙂

## The Professional Turn

For a short while I was working on technical deep dives and OSS projects in parallel. I pitched an article on [freeCodeCamp](https://www.freecodecamp.org/news/) and it got accepted. Then one for [InfoQ](https://www.infoq.com/), where I experienced firsthand how much a good editor can improve your writing. 

I got more ambitious and pitched a whole book to Apress based on the blog series *Database Zoo*. It got [accepted](https://link.springer.com/book/9798868827082). By then I was already working a new job, so things got thick. They changed the title from *Database Zoo* to *Database Safari*. I managed to keep the deadlines, but if I thought the InfoQ editorial process was thorough, the book editorial process was meticulous. And they were right about everything, all the time. I learned not just from my own research, but from every piece of editorial feedback. Looking back, I enjoyed every minute of it, but hope I won't have to touch the damn thing ever again. 😄

## When Work Aligned with What I Built

Then at work the need for a RAG system came up. I was lucky enough to be the one who could implement it. [confluence2md](https://github.com/gkoos/confluence2md) was born. I had to learn a lot about Confluence Cloud, Atlassian APIs, and how to properly structure a RAG pipeline. This wasn't a passion project squeezed into nights and weekends anymore. It was real work, and it felt natural because I'd been solving adjacent problems for months.

I followed this with [confluence2md-indexer](https://github.com/gkoos/confluence2md-indexer) for hybrid search, then [confluence2md-mcp](https://github.com/gkoos/confluence2md-mcp) to make it accessible as a Model Context Protocol server. The professional requirement and the creative freedom converged, lucky me.

## What This Year Meant

Looking back, the whole thing was driven by accidental circumstances more than deliberate strategy. A bureaucratic delay gave me uninterrupted time when I didn't expect it, a real itch with fetch abstractions turned into a library. Wanting to not build in obscurity turned into a habit of writing, writing turned into a book deal I never planned for. A professional need at work landed squarely in territory I'd already mapped.

The skills reinforced each other in ways I didn't anticipate. Writing about complex systems forced me to understand them more thoroughly than just implementing them would have. Implementing things gave me something concrete to write about rather than opinion pieces about trends. By the end of the year these felt less like separate activities and more like the same work approached from different angles.

## What's Next

There's a [Network Chaos Lab](https://fetchkit.org/network-chaos-lab/) I built as a Three.js visualization for replaying historic network incidents and tuning client behavior to see how it changes outcomes. I abandoned it for a while and it deserves to be finished properly.

[confluence2md](https://github.com/gkoos/confluence2md) also needs its own landing page. Right now it lives in a GitHub README, which works, but a proper home would give it more room to breathe.

And there's a book to promote when it ships.