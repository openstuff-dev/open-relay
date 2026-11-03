---
name: ux-details
description: Checks an app against 20 UX details (skeletons, optimistic updates, command menu, undo toasts, view transitions, hit targets, tabular numbers, idempotency keys and more) and builds the ones that fit and are missing. Use when building a new app or screen, before a release, or when asked to polish the UX or check it against the OpenStuff UX standards.
---

# UX details

Go through the 20 UX details below and check the app against each one. If a detail fits this
project and isn't done yet, build it. Skip the ones that don't fit, and the ones that need backend
work you can't do from here.

While you build:

- Use what the project already has before you add a library, and match the existing code style.
  In an OpenStuff project that means `@openstuff-dev/ui` and `@openstuff-dev/ui-angular` first,
  and `--os-*` tokens for colour, space and motion. If the toolkit lacks something every project
  would need (a toast, a command menu), add it to the design repository or report a finding
  against it, instead of building a local variant.
- Every animation respects reduced motion (`@media (prefers-reduced-motion: reduce)`, or
  `matchMedia` in script).
- Build them one at a time, and run the project's checks after each one
  (`npx nx run-many -t lint stylelint typecheck test build`, or `npx nx affected -t …`).

When you're done, list all 20, each marked as one of:

- **Built**: what you changed, which files, and how to see it working.
- **Already done**: where it is.
- **Skipped**: why.

## The 20

1. **Skeleton loaders (Apple).** Gray blocks in the shape of the real layout while content loads,
   made from the same component as the loaded state so nothing jumps. Only show them if loading
   takes longer than about 300ms.
2. **Optimistic updates (React).** Small actions like likes, checkboxes and renames update the
   screen right away and roll back with an error if the request fails (`useOptimistic` in
   React 19, a signal set before the request in Angular). Never for payments.
3. **Command menu (Linear).** Cmd+K or Ctrl+K opens a search of every page and action that works
   with the keyboard alone. Only in apps people use every day.
4. **Shortcut hints (Superhuman).** Show each action's keyboard shortcut in menus, tooltips and
   the command menu, with ⌘ on Mac and Ctrl elsewhere. Shortcuts don't fire while someone is
   typing in a field.
5. **Undo toasts (Gmail).** For anything reversible, like delete or archive, drop the confirm
   dialog. Do it right away and show an Undo toast for 5 to 10 seconds, with a soft delete or a
   delayed request behind it. The toast has `role="status"`.
6. **Stale-while-revalidate (Vercel).** Show cached data instantly and refetch in the background,
   again when the window regains focus or the network comes back. Not for balances, stock counts,
   or anything where old data costs money.
7. **Prerendering (Chrome).** Speculation rules with eagerness `"moderate"` for same-site links,
   leaving out logout and any link that changes data. Check what the router already prefetches
   first.
8. **BlurHash placeholders (Wolt).** Store a BlurHash or ThumbHash with each uploaded image and
   show the blur at the image's exact size while the real one loads.
9. **View transitions (Chrome).** `document.startViewTransition` for changes on one page,
   `@view-transition { navigation: auto; }` between pages, and the same `view-transition-name` on
   elements that move between them. Under 300ms.
10. **Swipe-to-dismiss sheets (Apple).** Bottom sheets follow the finger and close on distance or
    a quick flick (`presentationDetents` in SwiftUI, `@gorhom/bottom-sheet` in React Native, Vaul
    on the web). Keep a close button too.
11. **Interruptible animations (Apple).** Springs that turn around from their current position and
    speed when interrupted. No CSS keyframes on anything a user can interrupt, and never block
    input while something animates.
12. **Predictive back (Android).** Move back handling to `OnBackPressedCallback` or
    `PredictiveBackHandler` so the back swipe can preview the previous screen. It's on by default
    when targeting Android 16.
13. **Hit slop (React Native).** Every tap target is at least 44 by 44 points on iOS and 48 by
    48 dp on Android, even when the icon is smaller, using `hitSlop` or padding, without
    overlapping its neighbors.
14. **Safe-area insets (Apple).** `viewport-fit=cover` and `env(safe-area-inset-*)` on the web,
    `react-native-safe-area-context` in React Native, so nothing tappable sits under the notch,
    the Dynamic Island or the home indicator.
15. **One-time-code autofill (Apple).** One input with `autocomplete="one-time-code"` and
    `inputmode="numeric"` (`textContentType .oneTimeCode` on iOS), and the text message ends with
    a line like `@yourdomain.com #123456`.
16. **Tabular numbers (CSS).** `font-variant-numeric: tabular-nums` on timers, prices, counters
    and table columns.
17. **Balanced headlines (CSS).** `text-wrap: balance` on headings and short titles,
    `text-wrap: pretty` on paragraphs.
18. **Continuous corners (Apple).** The `.continuous` corner style in SwiftUI and UIKit. On the
    web, `corner-shape: squircle` next to the existing `border-radius`, which only Chromium
    browsers draw and everything else ignores.
19. **Idempotency keys (Stripe).** Make a UUID when the user starts a payment or anything that
    creates a record, send it as the `Idempotency-Key` on every retry of that action, and do the
    same on your own API. Disable the button while the request runs.
20. **Safe triangle (Amazon).** Hover menus with submenus don't switch while the cursor moves
    diagonally toward the open submenu (`safePolygon` in Floating UI, or the menu library's own
    version).
