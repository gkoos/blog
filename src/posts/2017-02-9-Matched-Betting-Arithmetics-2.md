---
layout: layouts/post.njk
title: Matched Betting Arithmetics 2 - Rating a Matched Bet
date: 2017-02-09
description: This post discusses how to rate a matched bet based on the back and lay odds.
excerpt: "When selecting a bet to back and lay, our goal is to maximize profit (or for a qualifying bet, to minimize loss). Just by looking at the odds it's hard to tell if a bet is ludicrous or not, so let's try and create an index to rate those bets..."
tags:
  - posts
  - mathematics
  - matched betting
---
_This is the second part of the series on matched bet arithmetics.<br>
Click [here](/posts/2017-2-1-Matched-Betting-Arithmetics/) for Part 1._

When selecting a bet to back and lay, our goal is to maximize profit (or for a qualifying bet, to minimize loss). Just by looking at the odds it's hard to tell if a bet is ludicrous or not, so let's try and create an index to rate those bets.

We can tell how good the odds are by determining the amount of money we win or lose by backing and laying the bet. To normalize the results we will examine the ratio of our money after the bet has settled and the sum of the stakes we originally laid with both the bookmaker and the exchange. For calculating this quotient we can assume we backed the bet with £1 and laid it with the optimal lay stake.

Using the notations and equations from the Qualifying Bet section of [Part 1](/posts/2017-2-1-Matched-Betting-Arithmetics/), our back bet is 1 and the lay bet is

_o<sub>1</sub> / (o<sub>2</sub> - c)_

Then our combined stake is

_(o<sub>1</sub> + o<sub>2</sub> - c) / (o<sub>2</sub> - c)_

Our total gain/loss from the second row of the corresponding profit breakdown table, substituting _b<sub>1</sub>_ and _b<sub>2</sub>_ with there calculated values above is

_o<sub>1</sub> / (o<sub>2</sub> - c) (1 - c)_

The sum of these two is our total cash once the bet has settled. This is

_o<sub>1</sub> (2 - c) / (o<sub>2</sub> - c)_

Now dividing this total by our combined stakes, a quotient greater than one means we gain some profit, smaller than one means we'll have some loss, while if it equals one we neither win nor lose a penny on the bet (which might come handy at qualifying bets).<br>
The final formula is

**_R = o<sub>1</sub> (2 - c) / (o<sub>1</sub> + o<sub>2</sub> - c)_**

---

In the [*totaliser*](https://github.com/gkoos/totaliser) the percentage variant of this index is used. Note that all the four variants of betting/bonus types follow the same pattern so the same index can be used to determine how good the back and lay odds of a particular bet are for each one of them.

