# Notes: Clipboard

## 2026-11-21 — Selection format planning

`clipPlan` chooses original picture bytes for a single image and a bounded raster size for other selections. It returns plain text in object reading order, using the plain-text field `t` from table cells. The scale is expressed in output pixels per page unit. The private selection format stays available for internal paste.

Next: connect the plan to the clipboard writer, supply the original image bytes or rendered selection and verify paste in both StudyNotes and an external application. This helper only describes the formats.
