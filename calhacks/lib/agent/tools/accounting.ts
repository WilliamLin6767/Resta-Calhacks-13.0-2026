// Money, read only: bills to pay, delivery-app payouts, and the (simulated) bank and cash plan.
// Paying a bill or moving money are confirm-first actions (Part B).
import { z } from "zod";
import { loadAccounting } from "@/lib/accounting/service";
import { loadBank } from "@/lib/bank/service";
import { loadMoney } from "@/lib/bank/cashPlan";
import { json, round2, defineTool } from "../types";

export const accountingTools = [
  defineTool({
    name: "get_cash_plan",
    description: "Bills to pay (overdue, due soon, later), what the delivery apps still owe, the bank balance, and the cash plan for the next two weeks. Read only.",
    input: z.object({}),
    run: async (_input, ctx) => {
      const accounting = await loadAccounting(ctx.db);
      const [bank, money] = await Promise.all([
        loadBank(ctx.db, accounting).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) })),
        loadMoney(ctx.db, accounting).catch(() => null),
      ]);
      const bills = Object.fromEntries(
        Object.entries(accounting.bills).map(([group, list]) => [
          group,
          { count: list.length, total: round2(list.reduce((s, b) => s + b.total, 0)), bills: list.slice(0, 10).map((b) => ({ id: b.id, supplier: b.supplier, invoice_number: b.invoice_number, due: b.due_date, total: b.total, disputed: b.disputed })) },
        ]),
      );
      return json({
        today: accounting.today,
        bills,
        delivery_apps_owe: round2(accounting.owed),
        bank: "error" in bank ? { error: bank.error } : bank.connected ? { balance: bank.account.balance, savings: bank.savings, cash: bank.cash } : { connected: false },
        cash_plan: money ? { forecast: money.forecast, suggested_move_to_savings: money.move, food_budget: money.budget } : null,
      });
    },
  }),
];
