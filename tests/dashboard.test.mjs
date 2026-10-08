import assert from "node:assert/strict";
import test from "node:test";
import { dashboardLiquidity, dashboardMonthlyFlows } from "../src/lib/dashboard.ts";
import { actualForPlanItem } from "../src/lib/planning.ts";
import { EMPTY_DATA } from "../src/lib/types.ts";

const owner_id = "owner";
const month = "2026-10-01";
const account = (id, kind, amount) => ({ id, owner_id, name: id, kind, opening_balance_paise: amount, opening_on: month, active: true });
const transaction = (id, kind, amount, extra = {}) => ({ id, owner_id, kind, amount_paise: amount, occurred_on: "2026-10-08", source_account_id: null, destination_account_id: null, category_id: null, note: null, interest_paise: 0, ...extra });
const entry = (id, transaction_id, account_id, delta_paise) => ({ id, owner_id, transaction_id, account_id, delta_paise });
const planItem = (id, kind, planned_paise, extra = {}) => ({ id, owner_id, plan_id: "plan", name: id, kind, planned_paise, due_day: null, category_id: null, goal_id: null, account_id: null, recurring_template_id: null, funding_account_id: "bank", ...extra });
const dataWith = values => ({ ...structuredClone(EMPTY_DATA), ...values });

test("usable cash subtracts goals and remaining plan commitments, without duplicating linked recurring", () => {
  const data = dataWith({
    accounts: [account("bank", "bank", 100_000), account("wallet", "cash", 5_000)],
    goals: [{ id: "emergency", name: "Emergency", status: "active" }],
    goalAllocations: [{ id: "allocation", goal_id: "emergency", account_id: "bank", cash_amount_paise: 25_000, investment_share_ppm: null }],
    monthlyPlans: [{ id: "plan", month_start: month, status: "active" }],
    planItems: [planItem("rent", "fixed_expense", 20_000, { recurring_template_id: "rent-template" }), planItem("sip", "investment", 10_000)],
    recurringTemplates: [{ id: "rent-template", name: "Rent", kind: "expense", source_account_id: "bank", active: true }],
    recurringOccurrences: [{ id: "occ", template_id: "rent-template", month_start: month, expected_amount_paise: 20_000, status: "pending" }],
  });
  const result = dashboardLiquidity(data, "2026-10-08");
  assert.equal(result.goalReservedPaise, 25_000);
  assert.equal(result.plannedReservedPaise, 30_000);
  assert.equal(result.usablePaise, 50_000);
  assert.equal(result.locations.find(item => item.account.id === "bank").usablePaise, 45_000);
});

test("an ordinary expense does not release a plan until linked to that item", () => {
  const expense = transaction("paid", "expense", 6_000, { source_account_id: "bank", category_id: "food" });
  const data = dataWith({
    accounts: [account("bank", "bank", 100_000)],
    categories: [{ id: "food", name: "Food", kind: "expense" }],
    transactions: [expense], entries: [entry("e", "paid", "bank", -6_000)],
    monthlyPlans: [{ id: "plan", month_start: month, status: "active" }],
    planItems: [planItem("food budget", "variable_expense", 20_000, { category_id: "food", funding_account_id: null })],
  });
  const result = dashboardLiquidity(data, "2026-10-08");
  assert.equal(result.unassignedPaise, 20_000);
  assert.equal(result.locations[0].usablePaise, 94_000);
  assert.equal(result.usablePaise, 74_000);
  expense.plan_item_id = "food budget";
  const linked = dashboardLiquidity(data, "2026-10-08");
  assert.equal(linked.unassignedPaise, 0);
  assert.equal(linked.usablePaise, 94_000);
});

test("monthly flow counts card spending once, investments once, and cash goal allocation once", () => {
  const data = dataWith({
    accounts: [account("bank", "bank", 100_000), account("fund", "investment", 0), account("card", "card", 0)],
    categories: [{ id: "salary", name: "Salary", kind: "income" }, { id: "food", name: "Food", kind: "expense" }],
    goals: [{ id: "goal", name: "Emergency" }],
    transactions: [
      transaction("income", "income", 70_000, { destination_account_id: "bank", category_id: "salary" }),
      transaction("card-spend", "expense", 8_000, { source_account_id: "card", category_id: "food" }),
      transaction("card-pay", "card_payment", 8_000, { source_account_id: "bank", destination_account_id: "card" }),
      transaction("invest", "transfer", 10_000, { source_account_id: "bank", destination_account_id: "fund" }),
    ],
    goalAllocationChanges: [
      { id: "g1", goal_id: "goal", account_id: "bank", reason: "manual", effective_on: "2026-10-08", old_cash_amount_paise: 0, new_cash_amount_paise: 5_000 },
      { id: "g2", goal_id: "goal", account_id: "fund", reason: "manual", effective_on: "2026-10-08", old_investment_share_ppm: 0, new_investment_share_ppm: 1_000_000 },
    ],
  });
  const flow = dashboardMonthlyFlows(data, "2026-10-08", 1)[0];
  assert.deepEqual(flow.income, { Salary: 70_000 });
  assert.deepEqual(flow.uses, { Food: 8_000, Investing: 10_000, "Goal · Emergency": 5_000 });
});

test("investment plan recognizes a transfer into an investment as processed", () => {
  const item = planItem("sip", "investment", 10_000, { account_id: "fund" });
  const data = dataWith({
    accounts: [account("bank", "bank", 100_000), account("fund", "investment", 0)],
    transactions: [transaction("invest", "transfer", 10_000, { source_account_id: "bank", destination_account_id: "fund" })],
    entries: [entry("e1", "invest", "bank", -10_000), entry("e2", "invest", "fund", 10_000)],
    monthlyPlans: [{ id: "plan", month_start: month, status: "active" }],
    planItems: [item],
  });
  assert.equal(actualForPlanItem(item, data, month), 10_000);
  assert.equal(dashboardLiquidity(data, "2026-10-08").plannedReservedPaise, 0);
});

test("saving allocation from a different account does not release the funded plan line", () => {
  const item = planItem("emergency saving", "saving", 10_000, { goal_id: "goal" });
  const data = dataWith({
    accounts: [account("bank", "bank", 30_000), account("wallet", "cash", 15_000)],
    goals: [{ id: "goal", name: "Emergency", status: "active" }],
    monthlyPlans: [{ id: "plan", month_start: month, status: "active" }],
    planItems: [item],
    goalAllocations: [{ id: "allocation", goal_id: "goal", account_id: "wallet", cash_amount_paise: 5_000, investment_share_ppm: null }],
    goalAllocationChanges: [{ id: "change", goal_id: "goal", account_id: "wallet", reason: "manual", effective_on: "2026-10-08", old_cash_amount_paise: 0, new_cash_amount_paise: 5_000 }],
  });
  assert.equal(actualForPlanItem(item, data, month), 0);
  assert.equal(dashboardLiquidity(data, "2026-10-08").plannedReservedPaise, 10_000);
});

test("outstanding card debt is deducted once even with a pending card bill", () => {
  const data = dataWith({
    accounts: [account("bank", "bank", 100_000), account("card", "card", 20_000)],
    recurringTemplates: [{ id: "card-bill", name: "Card bill", kind: "card_payment", source_account_id: "bank", destination_account_id: "card" }],
    recurringOccurrences: [{ id: "card-due", template_id: "card-bill", month_start: month, expected_amount_paise: 20_000, status: "pending" }],
  });
  const before = dashboardLiquidity(data, "2026-10-08");
  assert.equal(before.cardDebtPaise, 20_000);
  assert.equal(before.plannedReservedPaise, 0);
  assert.equal(before.usablePaise, 80_000);

  data.transactions.push(transaction("card-paid", "card_payment", 20_000, { source_account_id: "bank", destination_account_id: "card" }));
  data.entries.push(entry("cash-out", "card-paid", "bank", -20_000), entry("debt-down", "card-paid", "card", -20_000));
  data.recurringOccurrences[0].status = "completed";
  data.recurringOccurrences[0].actual_transaction_id = "card-paid";
  const after = dashboardLiquidity(data, "2026-10-08");
  assert.equal(after.cardDebtPaise, 0);
  assert.equal(after.usablePaise, 80_000);
});

test("current unpaid EMI is reserved, then released when marked paid", () => {
  const data = dataWith({
    accounts: [account("bank", "bank", 100_000), account("loan", "loan", 200_000)],
    recurringTemplates: [{ id: "emi", name: "Home EMI", kind: "loan_payment", source_account_id: "bank", destination_account_id: "loan" }],
    recurringOccurrences: [{ id: "emi-due", template_id: "emi", month_start: month, expected_amount_paise: 10_000, status: "pending" }],
  });
  const before = dashboardLiquidity(data, "2026-10-08");
  assert.equal(before.emiReservedPaise, 10_000);
  assert.equal(before.usablePaise, 90_000);

  data.transactions.push(transaction("emi-paid", "loan_payment", 10_000, { source_account_id: "bank", destination_account_id: "loan" }));
  data.entries.push(entry("emi-cash", "emi-paid", "bank", -10_000), entry("emi-loan", "emi-paid", "loan", -10_000));
  data.recurringOccurrences[0].status = "completed";
  data.recurringOccurrences[0].actual_transaction_id = "emi-paid";
  const after = dashboardLiquidity(data, "2026-10-08");
  assert.equal(after.emiReservedPaise, 0);
  assert.equal(after.usablePaise, 90_000);
});

test("same-category plan lines stay separate and a confirmed lower payment releases the difference", () => {
  const rent = planItem("rent", "fixed_expense", 41_000, { category_id: "housing" });
  const electricity = planItem("electricity", "fixed_expense", 2_000, { category_id: "housing" });
  const data = dataWith({
    accounts: [account("bank", "bank", 100_000)],
    categories: [{ id: "housing", name: "Housing", kind: "expense" }],
    monthlyPlans: [{ id: "plan", month_start: month, status: "active" }],
    planItems: [rent, electricity],
  });
  assert.equal(dashboardLiquidity(data, "2026-10-08").usablePaise, 57_000);
  data.transactions.push(transaction("paid-rent", "expense", 39_000, { source_account_id: "bank", category_id: "housing", plan_item_id: rent.id }));
  data.entries.push(entry("rent-out", "paid-rent", "bank", -39_000));
  assert.equal(actualForPlanItem(rent, data, month), 39_000);
  assert.equal(actualForPlanItem(electricity, data, month), 0);
  assert.equal(dashboardLiquidity(data, "2026-10-08").plannedReservedPaise, 2_000);
  assert.equal(dashboardLiquidity(data, "2026-10-08").usablePaise, 59_000);
});

test("confirmed higher payment releases its line and takes excess from usable cash", () => {
  const rent = planItem("rent", "fixed_expense", 41_000, { category_id: "housing" });
  const data = dataWith({
    accounts: [account("bank", "bank", 100_000)],
    monthlyPlans: [{ id: "plan", month_start: month, status: "active" }],
    planItems: [rent],
  });
  assert.equal(dashboardLiquidity(data, "2026-10-08").usablePaise, 59_000);
  data.transactions.push(transaction("paid-rent", "expense", 43_000, { source_account_id: "bank", category_id: "housing", plan_item_id: rent.id }));
  data.entries.push(entry("rent-out", "paid-rent", "bank", -43_000));
  assert.equal(dashboardLiquidity(data, "2026-10-08").usablePaise, 57_000);
});

test("voiding a plan-linked payment restores the unused reservation", () => {
  const rent = planItem("rent", "fixed_expense", 41_000, { category_id: "housing" });
  const data = dataWith({
    accounts: [account("bank", "bank", 100_000)],
    monthlyPlans: [{ id: "plan", month_start: month, status: "active" }],
    planItems: [rent],
    transactions: [
      transaction("paid-rent", "expense", 39_000, { source_account_id: "bank", category_id: "housing", plan_item_id: rent.id }),
      transaction("void", "reversal", 39_000, { reverses_transaction_id: "paid-rent" }),
    ],
    entries: [entry("payment", "paid-rent", "bank", -39_000), entry("refund", "void", "bank", 39_000)],
  });
  assert.equal(actualForPlanItem(rent, data, month), 0);
  assert.equal(dashboardLiquidity(data, "2026-10-08").plannedReservedPaise, 41_000);
  assert.equal(dashboardLiquidity(data, "2026-10-08").usablePaise, 59_000);
});
