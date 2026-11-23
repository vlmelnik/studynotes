# Notes: Paste

## 2026-11-21 — Detect LaTeX in plain text

Added `findMath(text)` and unit tests for dollar, parenthesis, and bracket
delimiters. It returns ordered text and math segments, preserving the LaTeX
inside recognized delimiters and marking display formulas.

Single-dollar pairs require a math cue and tight edges to avoid treating
prices as formulas. Escaped dollars become literal dollars in plain text.
Unclosed delimiters and pairs across a blank line remain text. The matcher
indexes delimiter tokens so a long paste with unclosed formulas can be scanned
without rescanning each candidate's tail.

HTML source recovery, formula rendering, and clipboard integration remain
open.

Next, recover LaTeX from copied KaTeX and MathJax markup in this shared
module. Keep `findMath` available for the plain-text path and pass math
segments through with their display flag and source unchanged.

## 2026-11-23 - Shared clipboard parser

`mathFromHtml(html)` recovers TeX from KaTeX annotations and MathJax
`data-latex` or `math/tex` scripts without a DOM. It replaces the rendered
formula with one `rich-paste:math` span and preserves the surrounding HTML.
For MathJax v2 it drops the duplicate rendered frame when its ID matches
the source script. It decodes basic and numeric entities plus common math
symbols; other named entities remain literal.
`markdownToRich(text, baseSize)` formats headings, lists and emphasis only
after two recognized Markdown marks; one mark is too easy to type by accident.
This is a limited Markdown subset; it does not parse code spans or backslash escapes.

`pasteToRich({ html, text }, baseSize)` prefers HTML only when a rendered
formula was recovered. It rebuilds the supported markup rather than copying
HTML attributes. Otherwise it combines Markdown with the existing `findMath`
segments without treating LaTeX underscores or stars as Markdown. Display
formulas get their own paragraph. The result is `{ html, plain, formulas }`,
with dollar delimiters in `plain` and none in the stored TeX. A `null` result
lets ordinary paste continue.

Next, in `sn-ext-rich-paste`, register the inline kind and call `pasteToRich`
from the host paste transform with the target text-box size. The parser does
not load KaTeX or attach UI hooks. The extension owns the rendered preview,
editing and the readable fallback when rendering is disabled. Verify the
real editor path and then handle PDF export and rich copy in
`sn-ext-rich-paste-export`.
