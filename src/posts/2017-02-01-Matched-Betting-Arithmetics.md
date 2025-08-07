---
layout: layouts/post.njk
title: Matched Betting Arithmetics
date: 2017-02-01
description: This post introduces the basic concepts of matched betting and the mathematics behind it.
excerpt: "Matched betting is a strategy that uses simple maths to extract risk-free profits from free bets and bonuses offered by bookmakers. One of core principles of matched betting is that risk is removed by ensuring that whatever the outcome of the match you get the same return..."
tags:
  - posts
  - mathematics
  - matched betting
---

Matched betting is a strategy that uses simple maths to extract risk-free profits from free bets and bonuses offered by bookmakers. One of core principles of matched betting is that risk is removed by ensuring that whatever the outcome of the match you get the same return, thus removing the 'gambling' from the betting. This is achieved by covering all the possible outcomes of an event, in it's simplest form by *laying* your *back* bet with a betting exchange. Let's see the maths!

### Back and Lay Bets

A *back* bet is where we bet that something will happen, like betting that Chelsea will win the Premier League. A *lay* bet is where we bet that something won’t happen, like betting that Chelsea won’t win the Premier League.
Whenever a punter goes to a bookmaker to place a bet, they are placing a back bet and the bookmaker is laying their bet.

### Betting Exchanges

At a *betting exchange*, users bet against each other. This means that we can be either the backer or the layer, so we can use betting exchanges to lay our back bet we laid at the bookie.
Betting exchanges make profit by charging a small commission fee for all winning bets. The commission is 5% at Betfair and 2% at Smarkets etc.

## Calculations

The problem needs to be solved for matched betting is as follows: given the back and lay odds of an event and our stake at the bookmaker, how much do we lay at the exchange to gain the same profit either the back bet wins or loses?

### Decimal odds

There are different forms of odds like fractions, decimal or American etc. For matched betting the decimal format is universally used as it makes the calculations easier.
The formula for decimal odds is:

Your Stake x Odds = Payout

Say you are backing Manchester United and Man U’s decimal odds to win are 1.82, if you wagered £100 your potential return on your bet would be £182. Remember that this counts your original stake of 100 pounds, so your net profit on a winning bet would be £82.

### Denotations

*o<sub>1</sub>* denotes the decimal back odds of an event at a bookmaker and *o<sub>2</sub>* is the decimal lay odds of the same event at a betting exchange where the commission is *c* (*100 c* in percentages). We lay *b<sub>2</sub>* bet in the exchange and want to make the same profit either the back or the lay bet wins.

There are different types of bonuses, these are the four most common ones:

### Qualifying / Arbing Bet

Here the bettor bets with his own money with both the bookie and the exchange. Most of the times such a bet is needed to release the bonus from the bookmaker. Another use of this formula is *arbing* or arbitrage betting, where the odds differences provided by bookmakers guarantee sure profit regardless the outcome of the event. The table below breaks down how much we win or lose in each case at the bookie and the exchange:

| |**Bookie**|**Exchange**
|-|-|-
|**Back Bet wins**|*+ b<sub>1</sub> (o<sub>1</sub> - 1)*|*- b<sub>2</sub> (o<sub>2</sub> - 1)*
|**Lay Bet Wins**|*- b<sub>1</sub>*|*+ b<sub>2</sub> (1 - c)*

Thus the equation is

*b<sub>1</sub> (o<sub>1</sub> - 1) - b<sub>2</sub> (o<sub>2</sub> - 1) = b<sub>2</sub> (1 - c) - b<sub>1</sub>*

Solving it
 
***b<sub>2</sub> = b<sub>1</sub> o<sub>1</sub> / (o<sub>2</sub> - c)***

So this will be our lay stake.

---

### Stake No Return (SNR) Bet

Here the bookmaker gives *b<sub>1</sub>* free money to bet, however the stake is not returned with any winnings. The table of the detailed profit breakdown is:

| |**Bookie**|**Exchange**
|-|-|-
|**Back Bet wins**|*+ b<sub>1</sub> (o<sub>1</sub> - 1)*|*- b<sub>2</sub> (o<sub>2</sub> - 1)*
|**Lay Bet Wins**|*0*|*+ b<sub>2</sub> (1 - c)*

The equation is

*b<sub>1</sub> (o<sub>1</sub> - 1) - b<sub>2</sub> (o<sub>2</sub> - 1) = b<sub>2</sub> (1 - c)*

Solving:

***b<sub>2</sub> = b<sub>1</sub> (o<sub>1</sub> - 1) / (o<sub>2</sub> - c)***

---

### Stake Return (SR) Bet

Here again *b<sub>1</sub>* free bonus is given but now it includes its stake in potential winnings. At first it sounds better than the SNR bonus, however such bonuses usually have minimum wagering requirements, making them more difficult to withdraw.

| |**Bookie**|**Exchange**
|-|-|-
|**Back Bet wins**|*+ b<sub>1</sub> o<sub>1</sub>*|*- b<sub>2</sub> (o<sub>2</sub> - 1)*
|**Lay Bet Wins**|*0*|*+ b<sub>2</sub> (1 - c)*

The equation:

*b<sub>1</sub> (o<sub>1</sub> - 1) - b<sub>2</sub> (o<sub>2</sub> - 1) = b<sub>2</sub> (1 - c)*

And the solution is

***b<sub>2</sub> = b<sub>1</sub> o<sub>1</sub> / (o<sub>2</sub> - c)***

(Note that it is exactly the same as the Qualifying bet.)

---

### Risk Free Bet

In this case, if we lose the back bet at the bookmaker, we get *f* worth of free bet. If we win, no bonus is added. Assuming we can extract *r f* of the bonus with a subsequent bet, the profit breakdown is as follows:

| |**Bookie**|**Exchange**
|-|-|-
|**Back Bet wins**|*+ b<sub>1</sub> o<sub>1</sub>*|*- b<sub>2</sub> (o<sub>2</sub> - 1)*
|**Lay Bet Wins**|*- b<sub>1</sub> + f r*|*+ b<sub>2</sub> (1 - c)*

The equation:

*b<sub>1</sub> (o<sub>1</sub> - 1) - b<sub>2</sub> (o<sub>2</sub> - 1) = b<sub>2</sub> (1 - c) - b<sub>1</sub> + f r*

Solving

***b<sub>2</sub> = (b<sub>1</sub> o<sub>1</sub> - f r) / (o<sub>2</sub> - c)***

---

These formulas are used in the code of the [*totaliser*](https://github.com/gkoos/totaliser).