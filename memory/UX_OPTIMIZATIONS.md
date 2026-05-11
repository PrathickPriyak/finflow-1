# UI/UX Optimization Tracker — Fin Flow

> Documented: Feb 2026  
> Source: Full static analysis of `/app/frontend/src/`  
> Status key: OPEN | IN PROGRESS | DONE

---

## Summary

| # | Priority | Title | File(s) | Status |
|---|----------|-------|---------|--------|
| UX-01 | 🔴 P0 | Dead Notification Bell | `Header.js` | DONE |
| UX-02 | 🔴 P1 | `TableSkeleton` Duplicated 4× | 4 page files | DONE |
| UX-03 | 🔴 P1 | Dashboard: 4 Uncoordinated API Calls | `DashboardPage.js` | DONE |
| UX-04 | 🟡 P2 | `getAgeDays` Locally Redefined in 2 Pages | `CollectionsPage.js`, `PaymentsPage.js` | DONE |
| UX-05 | 🟡 P2 | `window.searchTimeout` Global Namespace Pollution | `CustomersPage.js` | DONE |
| UX-06 | 🟡 P2 | `formatCurrency` Rounds to 0 Decimals — Loses Financial Precision | `formatters.js` | DONE |
| UX-07 | 🟡 P2 | BanksAndCardsPage: No Loading Skeleton | `BanksAndCardsPage.js` | DONE |
| UX-08 | 🟡 P2 | TransactionsPage: Search Requires Explicit Enter Key | `TransactionsPage.js` | DONE |
| UX-09 | 🟡 P2 | `NewTransactionPage.js` is 1996 Lines — God Component | `NewTransactionPage.js` | DONE |
| UX-10 | 🟢 P3 | Silent Catch Blocks — Users Unaware of Failures | All pages (~40 instances) | DONE |

---

## Detailed Findings

---

### UX-01 · 🔴 P0 · Dead Notification Bell

**File:** `src/components/layout/Header.js:47`  
**Status:** OPEN

**Problem:**  
The `<Bell>` icon is rendered in the header on every page but has zero functionality — no `onClick`, no badge count, no dropdown panel. Users click it and nothing happens.

```jsx
// Header.js — current (broken)
<Button variant="ghost" size="icon" className="relative" data-testid="notifications-btn">
  <Bell className="w-5 h-5" strokeWidth={1.5} />
  {/* no handler, no badge, no content */}
</Button>
```

**Impact:** In a financial system, users expect the bell to surface critical alerts — overdue payments, failed reconciliation, large incoming amounts. A dead UI element erodes trust and wastes prime header real estate.

**Fix:**
- Option A (quick): Remove the bell entirely until the feature is implemented.
- Option B (proper): Wire up a dropdown that shows a live count badge from a `/api/notifications/summary` endpoint returning overdue payments count, failed reconciliation count, and pending collections older than 30 days. Use a red badge overlay on the bell when count > 0.

---

### UX-02 · 🔴 P1 · `TableSkeleton` Duplicated 4×

**Files:**
- `src/pages/CollectionsPage.js:60`
- `src/pages/PaymentsPage.js:50`
- `src/pages/CustomersPage.js:49`
- `src/pages/TransactionsPage.js:39`

**Status:** OPEN

**Problem:**  
Identical `TableSkeleton` component copy-pasted in 4 separate pages. Col-counts differ arbitrarily (5, 6, 6, 7), making the loading experience inconsistent. Additionally, `WalletsPage.js` and `ExpensesPage.js` use a different CSS class (`className="skeleton"`) instead of the Shadcn `<Skeleton>` component — resulting in 6 distinct loading visual styles across the app.

```js
// Identical block repeated in 4 files:
const TableSkeleton = ({ rows = 5, cols = 6 }) => (
  <Table>
    <TableHeader>...</TableHeader>
    <TableBody>
      {Array(rows).fill(0).map((_, rowIdx) => (
        <TableRow key={rowIdx}>
          {Array(cols).fill(0).map((_, colIdx) => (
            <TableCell key={colIdx}><Skeleton className="h-4 w-full" /></TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  </Table>
);
```

**Fix:**  
Extract into `src/components/ui/table-skeleton.jsx` (or `src/components/TableSkeleton.js`) and import from all 4 pages. Standardize `WalletsPage` and `ExpensesPage` to use the same component.

---

### UX-03 · 🔴 P1 · Dashboard: 4 Uncoordinated API Calls, No Unified Loading State

**File:** `src/pages/DashboardPage.js:63–68`  
**Status:** OPEN

**Problem:**  
Four separate fetch functions fire on mount with individual `loading` / `error` states. Each card renders independently as its data arrives. If `fetchHealthScore` is slow, the health metric card pops in 2–3 seconds after everything else renders — a jarring visual jump. If any call fails, only that card silently shows stale/empty data with no visible error.

```js
// DashboardPage.js — current
useEffect(() => {
  fetchDashboard();           // controls page-level loading state
  fetchReconciliationStatus(); // independent, no loading state
  fetchDailyProfit();          // independent, no loading state
  fetchHealthScore();          // independent, no loading state
}, []);
```

**Fix:**  
Wrap all 4 calls in `Promise.all` with a single `loading` gate. Each section can show its own skeleton independently while the primary data loads first.

```js
// Proposed
useEffect(() => {
  const loadDashboard = async () => {
    setLoading(true);
    try {
      const [dashboard, profit, reconciliation, health] = await Promise.all([
        api.get('/dashboard'),
        api.get('/dashboard/daily-profit'),
        api.get('/reconciliation/status'),
        api.get('/dashboard/health-score'),
      ]);
      // set all states at once
    } finally {
      setLoading(false);
    }
  };
  loadDashboard();
}, []);
```

---

### UX-04 · 🟡 P2 · `getAgeDays` Locally Redefined in 2 Pages

**Files:**
- `src/pages/CollectionsPage.js:82` — defines local `getAgeDays`
- `src/pages/PaymentsPage.js:72` — defines local `getAgeDays`
- `src/lib/formatters.js:81` — canonical definition (NOT imported by either page)

**Status:** OPEN

**Problem:**  
Both pages import `formatCurrency`, `formatDate`, `formatDateShort` from `formatters.js` but define their own local `getAgeDays` instead of importing the canonical one. If the canonical version is updated (e.g., timezone-aware), the local versions stay stale, causing divergent age calculations across pages.

**Fix:**  
In both `CollectionsPage.js` and `PaymentsPage.js`:
```js
// Change:
import { formatCurrency, formatDate, formatDateShort } from '@/lib/formatters';
// To:
import { formatCurrency, formatDate, formatDateShort, getAgeDays } from '@/lib/formatters';
// And delete the local const getAgeDays = ...
```

---

### UX-05 · 🟡 P2 · `window.searchTimeout` Global Namespace Pollution

**File:** `src/pages/CustomersPage.js:132–133`  
**Status:** OPEN

**Problem:**  
Debounce is implemented by storing the timeout ID on the global `window` object. This pollutes the global namespace and could silently conflict if another component uses the same key.

```js
// CustomersPage.js — current (bad pattern)
clearTimeout(window.searchTimeout);
window.searchTimeout = setTimeout(() => {
  fetchCustomers(value, 1);
}, 500);
```

**Fix:**  
Use a `useRef` to store the timeout handle:
```js
const searchTimeoutRef = useRef(null);
// ...
clearTimeout(searchTimeoutRef.current);
searchTimeoutRef.current = setTimeout(() => {
  fetchCustomers(value, 1);
}, 500);
```

---

### UX-06 · 🟡 P2 · `formatCurrency` Rounds to 0 Decimals — Loses Financial Precision

**File:** `src/lib/formatters.js:16`  
**Status:** OPEN

**Problem:**  
`maximumFractionDigits: 0` means all amounts are rounded to the nearest rupee. Commission amounts like `₹12.75` display as `₹13`, gateway charges like `₹100.50` display as `₹101`. For a system tracking per-paise accuracy in commissions and PG charges, this silently hides the real figures.

```js
// formatters.js — current
export const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,  // ← loses paise
  }).format(amount);
};
```

**Fix:**  
Add an optional `precise` flag for contexts where decimals matter (commission display, settlement breakdowns):
```js
export const formatCurrency = (amount, precise = false) => {
  if (amount === null || amount === undefined) return '₹0';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: precise ? 2 : 0,
    maximumFractionDigits: precise ? 2 : 0,
  }).format(amount);
};
// Usage: formatCurrency(commission, true) → "₹12.75"
```

---

### UX-07 · 🟡 P2 · BanksAndCardsPage: No Loading Skeleton

**File:** `src/pages/BanksAndCardsPage.js`  
**Status:** OPEN

**Problem:**  
The only page in the application with **zero loading skeleton or spinner**. When the page loads, users see a blank white area for 200–500ms before the table content pops in. Every other page has at least a basic loader. This creates a noticeably inconsistent experience.

**Fix:**  
Add a skeleton loading state using the shared `TableSkeleton` component (once UX-02 is fixed) or the Shadcn `<Skeleton>` directly. Show it while the banks/card-networks data is fetching.

---

### UX-08 · 🟡 P2 · TransactionsPage: Search Requires Explicit Enter Key Press

**File:** `src/pages/TransactionsPage.js:282`  
**Status:** OPEN

**Problem:**  
The search input only fires on `onKeyDown → Enter`. Filters (transaction type, gateway, date range) don't auto-apply when changed — they require the user to also press Enter or click a separate button. There's no visual affordance telling users they need to press Enter. Users type a search term and see no response, which feels broken.

```jsx
// TransactionsPage.js — current
<Input
  onChange={(e) => setSearchQuery(e.target.value)}
  onKeyDown={(e) => e.key === 'Enter' && applyFilters(1)}
/>
```

**Fix:**  
- Add a visible **"Search"** button next to the input that triggers `applyFilters(1)`.
- OR wire filters to auto-apply with a 400ms debounce using `useEffect([filters, searchQuery])`.
- Show a subtle loading indicator inside the input field while fetching.

---

### UX-09 · 🟡 P2 · `NewTransactionPage.js` is 1996 Lines — God Component

**File:** `src/pages/NewTransactionPage.js`  
**Status:** OPEN

**Problem:**  
Single component holding ALL transaction creation logic: type selection, customer search, card selection, gateway source management, payment source form, submission, and success state — 1996 lines in one file. Every state change (`payToCardAmount`, `selectedCard`, `gatewaySources`) triggers a full re-render of the entire component tree. On low-end mobile devices the initial JS parse time for this file is the longest in the application.

**Impact:**
- Slower re-renders on every input change in the form
- Difficult to test individual sub-flows
- Hard to maintain; any change risks unintended side effects

**Proposed split:**
| Component | Responsibility |
|---|---|
| `TransactionTypeSelector` | Type 01 / Type 02 toggle |
| `CustomerSearchPanel` | Customer lookup + card selection |
| `PaySourcesManager` | Gateway source rows (add/remove/edit) |
| `TransactionSummaryBar` | Running totals, submit button |
| `NewTransactionPage` | Orchestrator: state + API calls only |

---

### UX-10 · 🟢 P3 · Silent Catch Blocks — Users Unaware of Operation Failures

**Scope:** ~40 `catch` blocks across all pages that swallow errors silently  
**Status:** OPEN

**Problem:**  
Many catch blocks only have `toast.error(...)` for the primary action, but secondary/background calls (loading reference data like banks, card networks, gateway servers) fail silently. Users submit a form and nothing happens — no error, no retry prompt. In financial operations, silent failures are particularly dangerous.

Example of common silent pattern:
```js
// Found in multiple pages
} catch (error) {
  // No toast, no setError, no feedback to user
}
```

**Fix:**  
Audit all `catch` blocks for user-triggered operations and ensure every one has either:
1. A `toast.error()` with an actionable message, OR
2. An inline error state shown near the failed element

Background data-fetching failures (loading dropdowns, reference lists) should at minimum disable the dependent form fields and show a warning rather than silently showing empty options.

---

## Statistics

| Priority | Count | Status |
|----------|-------|--------|
| 🔴 P0/P1 | 3 | OPEN |
| 🟡 P2 | 6 | OPEN |
| 🟢 P3 | 1 | OPEN |
| **Total** | **10** | **All OPEN** |
