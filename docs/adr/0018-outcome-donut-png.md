# ADR 0018 — The outcome donut is a PNG made in-process, with no dependency

> **Purpose:** Records how the run email shows its outcome chart (piece B of the 2026-11-25 email polish) and why no image library was added.
> **Read when:** You change the chart, add another image to the email, or the email arrives without its donut.
> **Size budget:** 6k chars (hard cap 60k)
> **Last verified:** 2026-11-25 @ 9a42db6

## Status
Accepted — 2026-11-25 (owner asked for a donut next to the Run Summary and for the smallest dependency that works on the CI runners and in the Playwright container).

## Context
Gmail strips SVG and CSS charts, so a chart has to be a raster image. The email is sent with nodemailer from the notify step, which runs on GitHub Actions runners and inside the Playwright container. The HTML must stay under 100 KB (Gmail clips there); the image is a separate part and does not count.

## Decision
- **No dependency.** `src/notifications/DonutChart.ts` draws the ring itself (3x3 supersampling, so the edges are anti-aliased) and writes the PNG with Node's built-in `zlib` (about 100 lines). Install cost: 0 bytes, 0 seconds. Render: about 40-100 ms. Size: 4-8 KB. Considered and rejected: `sharp`, `canvas` and `@napi-rs/canvas` (10-50 MB of native binaries per job, prebuilt-binary and glibc trouble in the container) for one small picture.
- **Text-free, 2x.** The image has no text; it is 340 px and shown at 170 px, so it is sharp on retina screens. The figure "99.7% first time" is HTML text beside it (readable, selectable, still there when images are blocked).
- **Inline attachment.** The HTML refers to it as `cid:run-outcome@kylas-report` (`DONUT_CID`); `NotificationService` attaches the PNG through `EmailPayload.attachments` (nodemailer `cid`). The `alt` text states the numbers.
- **The same numbers as the tiles.** The legend, the alt text and the segmented bar (coloured table cells, visible with images blocked) are computed once from the parsed report (`outcomeShares()`); invariants `chart-matches-tiles`, `chart-alt-matches`, `bar-matches-chart`, `chart-figure` in `check:scenarios` read them back against the tiles.
- **The image can never stop the send.** `chartPng()` catches any error, logs one warning ("the email goes out without the image, the bar and the legend stay") and the HTML omits the `<img>`. A generator can be injected (`new EmailTemplate(generator)`) to test this path (`check:donut`).
- **Not shown** when nothing is verified (blocked, incomplete, empty run).

## Consequences
Good: no install, no native binary, nothing to break on a runner image change; the chart cannot disagree with the tiles. Costs: a hand-written PNG writer to maintain (filter 0 only, RGBA 8-bit; `check:donut` decodes it) and a ring only (no labels in the picture). If a second chart is ever needed, revisit with a real library.

## How to revert
Remove `buildOutcomeChart()` and the `attachments` plumbing in `EmailAdapter` and `NotificationService`, delete `DonutChart.ts`; the segmented bar can stay.
