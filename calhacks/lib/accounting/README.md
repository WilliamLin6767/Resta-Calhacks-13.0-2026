# Accounting (A6)

`/accounting` checks that DoorDash and Uber Eats paid what your own orders say they owe, lists unpaid
supplier bills by due date, and exports money in and out as a CSV QuickBooks Online can import.
Plain math, no AI.

**Setup:** run `supabase/07_accounting.sql`. It adds `platform_payouts` and `invoices.paid_at`, and
INVENTED sample payouts built from the sample orders, with two planted problems: an $86.40 DoorDash
"error charge" and a Uber Eats week that was never paid.

## Payout check (`reconcile.ts`)

For each app and each finished week (Monday-Sunday): expected = our order subtotals minus the app's fees.
Compared with the payout: within $1 = matches; less = "paid less", with the reason (different sales,
different fees, or an adjustment and the app's note); none 5 days after the week = "missing".
Problems get a note to copy to the app's merchant support.

In real use payouts come from the apps' payout statements (their merchant APIs need partner approval).
Reading those statements with Claude, like invoices in A1, is the obvious next step.

## Bills

Invoices (A1) that aren't paid, grouped overdue / due in 7 days / later. If A1 found billing errors on a
bill, it says to dispute them first. "Mark paid" sets `status = 'paid'` and `paid_at`.

## QuickBooks export

`GET /api/accounting/quickbooks?from=YYYY-MM-DD&to=YYYY-MM-DD`: the 3-column bank-transaction format from
Intuit's guide (Date, Description, Amount; deposits positive, payments negative; no numbers in descriptions).
Upload in QuickBooks Online under Banking -> Upload transactions. Most restaurants also have a bank feed, so
QuickBooks may match these to bank lines rather than add new ones.

| | |
|---|---|
| `POST /api/invoices/:id/paid` | mark a supplier bill paid |
| `GET /api/accounting/quickbooks` | the CSV |
