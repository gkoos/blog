---
layout: layouts/post.njk
title: Matched Betting - Sunbets Halftime Hero Offer
date: 2017-02-16
description: A mathematical approach to the Sun Bets Halftime Hero offer.
tags:
- posts
- mathematics
- matched betting
---
In this post we'll discuss a nifty little offer from Sun Bets. The offer is not that great in terms of profit but provides a textbook example of what mindset is needed to exploit bookmaker offers with a little help of mathematics.

The offer says:
> If your team is winning
at half time but loses at full time, your bet will still be paid out at the winning odds. A
draw at full time will not count towards the offer.

Of course this is not the full T&Cs but it's all we need to know to set up our model. Team A plays with Team B. Now both half time and full time can have one of three different outcomes: A wins, Draw or B wins. Combined it is altogether 9 possibilities. Assuming we back A wins with a stake of _b<sub>1</sub>_ at the odds _o<sub>1</sub>_ matched with a normal laying bet of _b<sub>1</sub>_, odds _o<sub>1</sub>_ and commission _c_ results in the following table:

|**1st Half**|**Full Time**|**Outcome**
|-|-|-
|A wins|A wins|**Back Bet wins**, Lay Bet loses
|A wins|Draw|Back Bet loses, **Lay Bet wins**
|A wins|B wins|**Back Bet wins** (A won 1st half!), **Back Bet wins**
|Draw|A wins|**Back Bet wins**, Lay Bet loses
|Draw|Draw|Back Bet loses, **Lay Bet wins**
|Draw|B wins|Back Bet loses, **Lay Bet wins**
|B wins|A wins|**Back Bet wins**, Lay Bet loses
|B wins|Draw|Back Bet loses, **Lay Bet wins**
|B wins|B wins|Back Bet loses, **Lay Bet wins**

What we can see here is if team A wins the first half but team B wins the whole game both our bets win. Would it be possible to place a third bet so that we can ensure two of our bets win in either case?

Good ol' betting exchange comes to the rescue: we can **lay Team A wins half time / Team B wins full time**! Assuming we lay _b<sub>3</sub>_ and lay the odds of H/F A/B is _o<sub>3</sub> our profit table will look like this (H/F is the Half/Full market. Also, for the sake of simplicity we assume the two lay bets are made on the same exchange so the commission fee for both is _c_):

| |Back Team A|Lay Team A|Lay H/F A/B|Profit
|-|-|-|-|-
A/A, B/A, Draw/A|Wins|Loses|Wins|_(o<sub>1</sub> - 1) b<sub>1</sub> - (o<sub>2</sub> - 1) b<sub>2</sub> + b<sub>3</sub> (1 - c)_
A/B|Wins|Wins|Loses|_(o<sub>1</sub> - 1) b<sub>1</sub> + b<sub>2</sub> (1 - c) - (o<sub>3</sub> - 1) b<sub>3</sub>_
B/B, Draw/B, A/Draw, B/Draw, Draw/Draw|Loses|Wins|Wins|_-b<sub>1</sub> + b<sub>2</sub> (1 - c) + b<sub>3</sub> (1 - c)_

And just like always with matching bet, we want to make the same profit in all three cases, regardless the outcome. This gives us two equations in two unknowns, _b<sub>2</sub>_ and _b<sub>3</sub>_. Solving them:

**b2 = b1 o1 / (o2 - c)**

**b3 = b1 o1 / (o3 - c)**

That is, placing these bets on the exchange we can ensure equal profit whatever the outcome. Whether this profit is positive, however depends on the current odds. The closer the odds are to each other the better and usually the odds of the second lay bet are significantly higher than the others but sometimes it can be worth it. My intention was merely show how to approach an offer like this: the bookmaker gives us an extra edge and we try to convert it into cash.

Note that solving the equations _b<sub>2</sub>_ is the same as the normal qualifying bet with the same odds, not only simplifying the calculations but showing us how - with the help of elementary arithmetics - the puzzle pieces fit together, isn't it awesome!