---
layout: layouts/post.njk
title: "The Blog Now Has Formulas"
date: 2026-08-18
description: "Mathematical formula rendering is now supported on this blog, powered by MathJax. Inline and block math expressions work in all posts."
excerpt: "This blog now renders mathematical formulas using MathJax. Inline expressions sit inside prose, block equations get their own line, and the syntax is standard LaTeX. A few examples to kick things off."
tags:
- posts
- announcements
- meta
---

A small but satisfying addition today: this blog now renders mathematical formulas using [MathJax](https://www.mathjax.org/). The setup uses `markdown-it-mathjax3` as the markdown-it plugin, so the syntax is standard LaTeX surrounded by dollar signs.

## Inline math

Wrap an expression in single dollar signs to place it inline with text. For example, the quadratic formula $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$ sits right inside the sentence.

Euler's identity $e^{i\pi} + 1 = 0$ is another classic that fits neatly inline.

## Block math

Double dollar signs produce a centred display equation on its own line.

The Gaussian integral:

$$
\int_{-\infty}^{\infty} e^{-x^2} \, dx = \sqrt{\pi}
$$

The definition of the derivative:

$$
f'(x) = \lim_{h \to 0} \frac{f(x+h) - f(x)}{h}
$$

Bayes' theorem:

$$
P(A \mid B) = \frac{P(B \mid A)\, P(A)}{P(B)}
$$

## How it works

The renderer is `markdown-it-mathjax3` wired up with MathJax 3. Formulas are converted to inline SVG at build time, no JavaScript or external stylesheets are shipped to the browser.

Any post from now on can include formulas using the same `$...$` and `$$...$$` delimiters.
