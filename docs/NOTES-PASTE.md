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
