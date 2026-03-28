---
layout: layouts/post.njk
title: "Lessons Learned from Running a Privacy-First Disposable Email Service: Insights from nullmail.cc"
date: 2026-02-18
description: "Running a privacy-first disposable email service: Lessons from handling domain abuse flags, ServerHold suspension, and registry issues with nullmail.cc."
excerpt: "A few days ago, I got an unexpected email from Cloudflare: my domain, maildock.store, had stopped using their nameservers and was at risk of being deleted. This was unexpected, as I hadn't made any changes to the DNS settings. After some investigation, I discovered that the domain had been flagged for abuse, likely due to its association with disposable email services."
tags:
- posts
- nullmail
- email privacy
- disposable email
---
A few days ago, I got an unexpected email from Cloudflare: my domain, `maildock.store`, had stopped using their nameservers and was at risk of being deleted. This was unexpected, as I hadn't made any changes to the DNS settings. After some investigation, I discovered that the domain had been flagged for abuse, likely due to its association with disposable email services.

For context, `maildock.store` powers [nullmail.cc](https://nullmail.cc), a privacy-first disposable email service. Users can create addresses, receive emails, and have them automatically deleted after expiration - all without signing up, tracking, or sending any outgoing mail. The frontend is a [SvelteKit](https://kit.svelte.dev/) app on [Vercel](https://vercel.com/), emails are forwarded via [forwardemail.net](https://forwardemail.net/) into a [Supabase](https://supabase.com/) database, and the system automatically cleans up expired content. It's minimal by design, but robust enough to provide a fully functional disposable inbox - mostly in free tiers of various services.

Despite this simplicity, domains like `maildock.store` can trigger automated abuse flags. What followed was a whirlwind of DNS checks, WHOIS lookups, blacklist verification, and conversations with the `.store` registry, [Radix](https://radix.website). In this post, I'll walk through the story, how (I think) I resolved the issue, and the architectural choices that made it possible to recover safely, while keeping the service privacy-first.

## Design Philosophy

At its core, Nullmail is built around **privacy, simplicity, and minimalism**. The goal is straightforward: users should be able to receive emails without giving away personal information, signing up for accounts, or being tracked. There's no analytics, no logging beyond what's necessary to deliver emails, and no outgoing SMTP - the service is strictly receive-only.

Every design choice reflects this philosophy. Addresses are ephemeral and automatically expire, keeping the system lean and reducing the risk of abuse. The database only stores what's necessary: the address itself and the emails sent to it. No unnecessary metadata, no IP logs, no behavioral tracking. Even the UI is stripped down to essentials, giving users just enough functionality to check their inbox and manage addresses.

This minimal, privacy-first approach has a practical benefit as well: it reduces the attack surface and limits what can go wrong. There's no complicated backend for sending mail, no rate-limiting infrastructure, and no analytics that could trigger false positives with anti-spam systems.

## Architecture Overview

The simplicity of Nullmail's design is mirrored in its architecture. The service combines a few lightweight, well-chosen components to deliver a fully functional disposable email system while staying mostly in free tiers:

- **Frontend**: A SvelteKit app hosted on Vercel. It handles the user interface for reading emails and managing addresses, with minimal JavaScript and no tracking.
- **Backend/API**: The same SvelteKit app provides serverless API routes on Vercel for core operations: creating new addresses, listing inboxes, fetching email bodies, and extending expiry timestamps.
- **Database**: A Supabase Postgres instance stores addresses and emails. The database schema is minimal, consisting of:
  - **addresses table**: stores the address and its expiry timestamp.
  - **emails table**: stores sender, recipient, subject, body, and delivery timestamp. Each email references an address, and expired addresses (and their emails) are automatically deleted via a scheduled cron job every five minutes.
- **Email ingestion**: All incoming emails are routed through `forwardemail.net`. ForwardEmail posts inbound mail to a Vercel API endpoint, which inserts it into the Supabase database.
- **Domains & DNS**: The service operates under the domains `maildock.store` and `nullmail.cc`. DNS is managed through [Cloudflare](https://www.cloudflare.com/), which provides:
  - Nameserver hosting
  - MX, SPF, DMARC, TLSRPT, and _security TXT records
  - Proxying for web traffic (though Nullmail is mostly static)
  - Protection against accidental misconfiguration or abuse flags
- **Optional UX**: Browser extensions for [Chrome](https://chromewebstore.google.com/detail/nullmail-extension/ogbnjlpdlihcbfmdffhkklhikjlmkfnm?pli=1) and [Firefox](https://addons.mozilla.org/en-US/firefox/addon/nullmail-extension/) open the site with a `fromExtension=1` flag for minor interface tweaks.

The codebase can be found on GitHub: [gkoos/nullmail](https://github.com/gkoos/nullmail/).

This architecture is lightweight but resilient, perfectly aligned with the privacy-first philosophy: no outgoing SMTP, minimal logging, and automated cleanup. It also meant that when the domain was flagged by Radix, most of the infrastructure was unaffected: the problem was isolated to DNS and registry-level issues.

## The Incident

Even with a minimal, receive-only setup, disposable email domains can attract attention from automated abuse systems. As I mentioned earlier, I got an email from Cloudflare warning that maildock.store had stopped using their nameservers and was at risk of being deleted. At first, it felt like a false alarm — I hadn't touched any DNS settings.

Digging deeper, I discovered that the domain had been placed on `ServerHold` by Radix, the registry that manages .store domains. `ServerHold` is usually reserved for domains flagged for abuse, spam, or other policy violations. In my case, the likely trigger was the domain's association with my disposable email service, even though Nullmail is strictly receive-only and doesn't send outbound mail.

To investigate, I ran `WHOIS` checks, `TXT` and `MX` lookups, and verified DNS settings through Cloudflare. I also checked common spam/blacklist sources like SURBL: initially, the domain appeared flagged, though later it was cleared. While the frontend and database remained fully functional, the suspension meant that any new email delivery could fail and the domain risked being removed entirely.

This incident highlighted the harsh reality: even a minimal, privacy-first service with just a few users can run into registry-level issues. Fortunately, the architecture - isolated frontend, serverless backend, and Cloudflare-managed DNS - meant that the problem was largely contained to the domain itself, and recovery would be possible with the right steps.

## The Resolution

Once I confirmed that maildock.store was on `ServerHold`, the next step was to contact Radix directly via their [unsuspension form](https://abuse.radix.website/unsuspension). I explained the service, emphasized it's receive-only nature, and detailed the privacy-first safeguards in place.

Radix responded positively and removed the `ServerHold`, reinstating the domain. To further prevent future issues and provide a point of contact for abuse reports, I created a dedicated abuse mailbox (abuse@maildock.store). This mailbox is stored in the Supabase database, has no public access, and is checked only via the Supabase UI as needed.

Next, I verified and cleaned up the DNS records in Cloudflare:

- Removed old registrar NS entries that were no longer needed.
- Deleted test or placeholder A records that could confuse DNS checks.
- Confirmed MX records pointing to forwardemail.net were correct.
- Ensured SPF, DMARC, TLSRPT, and `_security` TXT records were properly configured, with the abuse mailbox as the contact.

After these steps, the domain was fully operational again: emails were being received reliably, and the system continued to enforce automatic cleanup of expired content.

This experience reinforced the importance of clear abuse contact channels, proper DNS hygiene, and documenting a simple, minimal architecture that isolates potential issues. Even a small, receive-only service can be flagged, but thoughtful design makes recovery straightforward.

Honestly, I should have anticipated this sooner. Luckily, the solution was simple, and the service is back up without any lasting damage. The incident also provided valuable insights into how registry-level abuse flags work and how to design a service that can recover gracefully from them.

## Lessons Learned

The ServerHold incident with maildock.store offered several insights about running a minimal disposable email service:

- Despite being receive-only, with no outgoing mail, maildock.store was still flagged for potential abuse. utomated systems at the registry level tend to be cautious and sometimes overly conservative. Also, because no logs are kept, there's no way to tell what triggered the flag, which is a risk of a privacy-first approach.
- DNS and registry configurations matter more than expected.
- Inconsistencies in nameservers or leftover records may trigger alerts. While the system itself was unaffected, the domain's reachability depends on clear, correct DNS entries.
- Direct communication with the registry is crucial - and they were responsive and helpful in resolving the issue once I provided context about the service and its safeguards.
- Automated abuse flags are often resolvable with context. Having a clear explanation and a point of contact (abuse@maildock.store) allowed me to restore the domain quickly.
- Minimalism has trade-offs: a simple architecture isolates most operations from failures like this, but no logging and lack of outbound monitoring means we rely on external feedback to detect issues.
- The "why" remains uncertain: we still don't know exactly what triggered the abuse flag. This leaves open questions about how disposable domains are evaluated, and whether additional safeguards could reduce false positives. And also makes me wonder if the domain was targeted by a malicious actor who reported it, or tried to exploit the service, or if it was just an automated flag based on the domain's history or traffic patterns.

Overall, the experience reinforced that running a privacy-first service comes with uncertainties and edge cases. While minimalism and privacy help in some areas, external systems (registries, DNS providers, abuse monitors) can still impact availability in ways that are outside the service's direct control. In a larger context, this highlights the need to do your due diligence and understand the challenges of running a service that interacts with the broader internet ecosystem, even if it's designed to be as simple and private as possible. Also, value your users, but don't trust them to not try to abuse the service, and design with that in mind.