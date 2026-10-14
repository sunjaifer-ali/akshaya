# Akshaya Centre app — accounting changes in this offline review

## Core rule

`closing difference = (today centre-held balance - previous centre-held balance) - receipts into centre funds + payments out of centre funds`

Centre-held balance is physical cash + E-district wallet + CSC wallet + centre bank account. Personal GPay is outside the centre balance.

## Behaviour changes

- Daily closing now delegates the movement reconciliation to `src/lib/ledger/reconciliation.ts`.
- Counter service charges paid to personal GPay are excluded from centre receipts.
- A personal-GPay counter entry now records its stated department fee as a linked centre-bank department payout, matching the owner's stated workflow. This is only correct if that department fee is in fact paid from the centre bank for each such entry.
- Credit repayments now record their actual destination (`centre` or `personalGpay`). Repayments still reduce the customer's unpaid credit regardless of destination, but only centre-directed repayments count as centre receipts.
- Legacy credit repayment rows with no known destination remain `unknown` and are excluded from centre receipts until someone verifies them. The app does not guess based on equal amounts.
- Advance receipt is counted on the date received. Delivering a service against a prior advance does not create a second receipt. Partial services retain the remaining advance.
- Added reconciliation tests for centre service charges, personal GPay, credit repayments, advances, departmental payouts, expenses and owner transfers.

## Important limitations / rollout

- No production database, GitHub repository, or Vercel deployment was accessed or changed by this offline work.
- The additive `customer_move.destination` column is created by the app's existing table-setup routine when the updated app runs. It has not been run against any database here.
- Existing repayment rows have unknown destinations. Review those rows before using historical closing differences as audited figures.
- A full TypeScript check/build could not be completed because dependency installation timed out; the global TypeScript checker also reported missing `@types/node` and `vite/client`. The new pure reconciliation test suite ran successfully (7/7).
- Before deployment, install dependencies in a normal development environment, run the complete test/typecheck/build suite, and verify a database backup. Do not deploy this ZIP as-is until those checks pass.
