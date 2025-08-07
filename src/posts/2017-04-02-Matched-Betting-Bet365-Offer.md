---
layout: layouts/post.njk
title: Matched Betting - Bet365 Offer
date: 2017-04-02
description: This post discusses a specific matched betting offer from Bet365 and how to calculate the lay stake for guaranteed profit.
tags:
- posts
- mathematics
- matched betting
---
In this post I'm discussing an offer I found on bet365:

> Back any single winner at 4/1 or more on any race televised live on ITV Racing and you can have a risk free bet to the same stake (up to £50) on the next race broadcast live on ITV Racing.

What it says is basically if your back bet on winner (on selected races odds over 5) wins, you get (on top of your usual winnings) a free bet that you can use in the next selected race. It is somewhat similar to the risk-free bets, only there you get the free bet if your back bet _loses_, here if it _wins_. The principle however is the same, so we can lock in for guaranteed profit.

So if we win the back bet at the bookmaker, we also get *f* worth of free bet. Assuming we pay _c_ commission on the exchange and *r f* of the bonus can be extracted with a subsequent bet, the profit breakdown is as follows:

| |**Bookie**|**Exchange**
|-|-|-
|**Back Bet wins**|*+ b<sub>1</sub> (o<sub>1</sub> - 1) + f r*|*- b<sub>2</sub> (o<sub>2</sub> - 1)*
|**Lay Bet Wins**|*- b<sub>1</sub>*|*+ b<sub>2</sub> (1 - c)*

The equation:

*b<sub>1</sub> (o<sub>1</sub> - 1) + f r - b<sub>2</sub> (o<sub>2</sub> - 1) = b<sub>2</sub> (1 - c) - b<sub>1</sub>*

Solving

***b<sub>2</sub> = (b<sub>1</sub> o<sub>1</sub> + f r) / (o<sub>2</sub> - c)***

That is, by making a _b<sub>2</sub>_ lay bet, we can ensure profit for either outcome.