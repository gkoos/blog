---
layout: layouts/post.njk
title: Matched Betting Arithmetics 3 - Overlaying / Underlaying
date: 2018-03-25
description: This post explains the concepts of overlaying and underlaying in matched betting, including when and how to use them for maximizing profits.
excerpt: "Overlaying and underlaying are advanced matched betting techniques that can help you maximize profits in specific scenarios. This post explains how they work and when to use them..."
tags:
- posts
- mathematics
- matched betting
---
_This is the third part of the series on matched bet arithmetics.<br>
Click [here](/posts/2017-2-1-Matched-Betting-Arithmetics/) for Part 1.<br>
Click [here](/posts/2017-2-9-Matched-Betting-Arithmetics-2/) for Part 2._

Overlaying and underlaying are slightly more advanced matched betting techniques. However, they are still pretty easy to understand and might come handy in some cases, so in this post we’ll take a look at how they work, when and why you may want to use them to increase your profits.

## Overlaying ##

Overlaying is when you adjust your bets so that you lay more than you usually would in order to gain more profit on the exchange if your lay bet wins, at the price of gaining less (or even losing some) at the bookmaker if your back bet wins with them.
Now normally we want to keep things risk-free, so not going any further than breaking even if our back bet does not win.

### When to overlay ###

There are plenty of reload offers like this:

> Receive a £10 free bet if you pick a winning horse

In order to receive the free bet we must pick a winner. But what happens if we don’t? Usually when we lay our pick there is a small qualifying loss and as we’re not guaranteed the free bet, we could lose some overall. So we overlay, instead of making equal profit, meaning we break even if our back bet loses and possibly suffer a small qualifying loss if we win with the bookie but then we get our free bet with which we're in profit. (Note that for offers like this the lay bet can be calculated to make equal profit though! That equal profit however would be less than the one we have a risk-free shot for with this technique.)
We can also overlay when we're simply sure our back bet won't win.

## Underlaying ##

Underlaying is the exact opposite of overlaying, ie. we lay less on the exchange in order to gain more if the back bet wins.

### When to underlay ###

Consider a (quite common) reload offer like

> Get a £10 free bet if your bet loses

Just like in the previous example for overlay, if we use the normal lay amount, we lose money if things don't go our in favor (in this case if our back bet wins, hence no free bet, our qualifying loss only). No problem, we lay so we break even if our back bet wins at the price of biting a bit more into our profit if our lay bet wins but then we get our free bet so we'll be in profit in the end.

## The Maths ##

The table from [Part 1](/Matched-Betting-Arithmetics/) breaks down our profit in each case:

| |**Bookie**|**Exchange**
|-|-|-
|**Back Bet wins**|*+ b<sub>1</sub> (o<sub>1</sub> - 1)*|*- b<sub>2</sub> (o<sub>2</sub> - 1)*
|**Lay Bet Wins**|*- b<sub>1</sub>*|*+ b<sub>2</sub> (1 - c)*

For overlaying the sum of the bookie and exchange profit must be zero if the back bet wins:

*b<sub>1</sub> (o<sub>1</sub> - 1) = b<sub>2</sub> (o<sub>2</sub> - 1)*

Solving it:

**Overlay: *b<sub>2</sub> = b<sub>1</sub> (o<sub>1</sub> - 1) / (o<sub>2</sub> - 1)***

Likewise, for underlaying the profit must be zero in the second row of the table, if the lay bet wins:

*b<sub>1</sub> = b<sub>2</sub> (1 - c)*

Solving:

**Underlay: *b<sub>2</sub> = b<sub>1</sub> / (1 - c)***