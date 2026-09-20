# Book Scan streaming — Task 5: mobile

Read on a phone during a trial. Confirmed the three requirements at small width, with one layout change.

## 1. Progress visible without scrolling — ONE layout change made
The scanning progress line lives in the header, above the findings, so it is above the fold on open.
But as findings stream in and the rep scrolls to read them, a non-pinned line would scroll away. So the
progress line is now **`position: sticky; top: 0`** (with an opaque `--surface-base` background, a
hairline underbar, and `z-index:1` so streaming findings scroll *under* it). It stays visible the whole
time the scan is working, and disappears when done. This is the only layout change Task 5 needed.

## 2. New findings appending below the fold do not yank the viewport — confirmed, no change
This is guaranteed by the Task 3 design, not by scroll math: findings **append** to the end of a flat
list, each keyed by a stable `findingId`, and existing entries never move or re-sort. React mounts the
new nodes **below** the existing ones, so nothing above the viewport changes height or order — the
scroll position is undisturbed. (The failure mode the requirement guards against — prepending or
re-grouping, which shifts everything down and yanks the viewport — is exactly what append-never-resort
rules out.) No scroll-anchoring hack is needed.

## 3. The finished state is obvious — confirmed, no change
When the scan completes, `scanning` flips false and the sticky "Still scanning — analysed N of M chats"
bar is **removed**. What remains is the settled reveal: the "N findings · M clients · K chats read" meta,
the full findings list, and the closing invitation ("export your next chat…"). The removal of the
pinned progress bar is the unambiguous "done" signal — there is no longer anything telling the rep it is
still working, and the invitation only makes sense once the scan has finished. Zero-findings-at-done
shows the honest empty state ("What your book has been hiding" + message) — also unambiguous.

## Width / wrapping
The progress copy ("Still scanning — analysed 2 of 3 chats · 1 couldn't be read") sits in the existing
`tov-screenmeta` class, which wraps; on a ~360px phone it wraps to two lines without overflow. Findings
use the existing `Receipt` chit layout already used across the app at phone width — no change.

## Summary
One layout change: the scanning progress line is now sticky-topped so it stays visible while findings
stream in. Viewport-stability and the finished-state signal fell out of the Task 3 append-only design
and the Task 2 progress gating respectively — no further change required.
