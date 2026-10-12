# Components

All values are tokens (`var(--color-*)`, `--space-*`, `--radius-*`); no raw hex or pixels in
component code. Icons: Lucide subset (ISC). Every interactive part is a real element, reachable by
keyboard, with a visible 2px `focus` ring. Copy is written fresh and kept in one strings file.

```
Button
  variants  primary (accent), secondary (surface + border), ghost, danger
  sizes     sm 32, md 40, lg 48
  states    default, hover, active, focus-visible, disabled, loading (label kept for screen readers)
  a11y      <button>, type set, disabled uses aria-disabled when it needs a tooltip
  used on   all

Field (text, long text, number, date, select, multi-select)
  parts     label always visible, hint, error message linked with aria-describedby
  states    default, focus, invalid, disabled, read-only (for view-only users)
  border    border-input (3:1 or better)
  used on   S01, S02, S08 to S12, S20 to S30

Table / list row
  features  inline edit, sortable header (aria-sort), row focus, truncated long names with title
  states    loading skeleton, empty (EmptyState), error, view-only (no edit affordances)
  used on   S04, S15, S17, S19, S20, S28

Board
  parts     column (section), card (title, assignee, due, field chips), drag handle
  a11y      drag also available as a "Move to..." menu so keyboard users can move a card
  states    empty column, over-limit title, view-only (no drag)
  used on   S05

CalendarGrid
  parts     month grid, day cell with task chips, "+n more" popover
  a11y      grid role, arrow-key navigation, today marked by text and not colour alone
  used on   S06

TimelineBar
  parts     date axis, task bars start to due, milestone marker, dependency line
  states    no dates (listed as "unscheduled"), view-only
  a11y      same data available as a table below the chart
  used on   S07

Drawer / Modal
  behaviour focus trap, Esc closes, returns focus to the opener, scroll lock on modal
  used on   S08 (drawer), S20, S25 (modals)

Chart (number, bar, line, donut) in SVG
  colours   chart-1 to chart-6 in order; every series also gets a text label or pattern
  a11y      <title> and <desc>, data table fallback under "Show data"
  used on   S14, S15, S17

Meter (progress)   role="progressbar" with value text; used on S13, S15, S16
Tabs               roving tabindex, arrow keys; used on S08, S29
Toast              role="status", 5 s, dismissible, never the only place an error appears
EmptyState         icon, one sentence, one action; written for each screen
Badge              role (owner, admin, member, view-only, guest), status, STUB, SETTING ONLY, NOT CERTIFIED
                   (STUB and NOT CERTIFIED use warning / warning-soft and always include text)
TokenReveal        shows a new token once with a copy button and a "stored as hash" note
AuditRow           time, actor, action, target, expandable before/after
Banner             "demo workspace: fake data" and "mock identity provider" notices
```

Responsive: sidebar collapses under `bp-md`; views stack under `bp-sm`; tables become
cards under `bp-sm`. Targets 390px and 1440px wide.
