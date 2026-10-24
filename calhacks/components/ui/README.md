# Shared UI pieces

Small building blocks so every page loads, empties, confirms and moves the same way. Use them on
new pages instead of writing your own. Colors: `brand-*` (follows the current section) and `gray-*`.

## Loading: `Skeleton.tsx`

Use as a Suspense fallback, sized like the real content so nothing jumps when it loads.

```tsx
<Suspense fallback={<SkeletonTable rows={6} cols={5} />}><MyTable /></Suspense>
<Suspense fallback={<SkeletonStat />}><YesterdaySales /></Suspense>
```

Shapes: `SkeletonStat` (big number + line), `SkeletonLines lines={3}`, `SkeletonTable rows cols`,
`SkeletonChart height={240}`, and a plain `Skeleton className="h-24 rounded-xl"` for anything else
(wrap several plain ones in one `<div role="status">` with a `sr-only` "Loading").

## Nothing to show: `EmptyState.tsx`

```tsx
if (rows.length === 0) return <EmptyState title="Nothing is low. The walk-in is in good shape." icon="box" />;
<SimpleTable rows={rows} columns={cols} empty={<EmptyState title="No suppliers on file yet." />} />
```

Plain, calm words; no jokes, no exclamation marks. `icon` is a key of `ICONS` in `lib/nav.ts`.

## After an action: `useToast` and `useAction`

```tsx
const { run } = useAction();
run(`/api/invoices/${id}/paid`, undefined, undefined, { success: "Invoice marked paid" });
```

`success` shows a toast when the call works; a failed call always toasts its error (and still
returns `error`). Say what happened, past tense, with the value when you have it ("Price set to
$14.50"). For anything else: `const toast = useToast(); toast({ message, tone: "success" })`. Only
undoable money moves get an `action: { label: "Undo", onClick }`.

## A number that changed: `LiveValue` and `Stat`

```tsx
<td className={tdNum}><LiveValue value={formatMoney(dish.price)} /></td>
<Stat label="Yesterday's sales" value={formatMoney(revenue)} sub="42 orders" />
```

Flashes a soft highlight for 600ms when the value changes after a refresh, never on first load.
Pass the formatted string.

## The AI is working: `AiThinking` and `TypingDots`

```tsx
{loading && <AiThinking label="Reading the invoice... (about 20 seconds)" />}
{busy && <TypingDots />}
```

Keep the button's own short label ("Analyzing...") and put `AiThinking` under it with the long one.

## New items in a list: `Reveal`

```tsx
<Reveal as="tbody" initial>{rows.map((r) => <tr key={r.key} className={tr}>...</tr>)}</Reveal>
```

Items that appear after the first render rise in one after another (30ms apart). Children need
keys and must take a className. `initial` also plays the ones there at first (for a list that
mounts with what the AI just read).

## Tables: `table.ts`

```tsx
<div className={tableWrap}><table className={table}><thead className={thead}><tr><th className={th}>Dish</th><th className={thNum}>Price</th></tr></thead>
<tbody><tr className={tr}><td className={td}>Pho</td><td className={tdNum}>$14.50</td></tr></tbody></table></div>
```

Numbers and money go in `thNum` / `tdNum` (right-aligned, `tabular-nums`). `SimpleTable` uses the same classes.

## Motion

Tokens in `app/globals.css` `@theme`: `--ease-out-soft`, `--duration-fast` (150ms, feedback),
`--duration-enter` (240ms), `--duration-exit` (200ms). Highlights max 600ms.

Every CSS animation goes inside `@media (prefers-reduced-motion: no-preference)`; with reduced
motion things just appear in their final state. In JavaScript, check `useReducedMotion()` before
starting anything that moves; charts use `useAnimateOnce()` for `isAnimationActive` so they draw
once and don't replay after a refresh. Nothing waits on an animation.
