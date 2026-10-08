import assert from "node:assert/strict";
import test from "node:test";
import {
  availableCash,
  balanceOn,
  effectiveTransactions,
  fundedForGoal,
  increasedCashReservation,
  monthLabel,
  monthStart,
  monthStartFromInput,
  nextMonth,
  paiseFromRupees,
  projectedGoalDate,
  rupeesFromPaise,
  todayInIndia,
  totalsOn,
} from "../src/lib/finance.ts";
import { EMPTY_DATA } from "../src/lib/types.ts";

const OWNER = "test-owner";

function dataWith(values = {}) {
  return { ...structuredClone(EMPTY_DATA), ...values };
}

function account(id, kind, openingBalance, openingOn = "2026-10-01") {
  return {
    id, owner_id: OWNER, name: id, kind,
    opening_balance_paise: openingBalance, opening_on: openingOn, active: true,
  };
}

function transaction(id, kind, amount, date, extra = {}) {
  return {
    id, owner_id: OWNER, occurred_on: date, kind, amount_paise: amount,
    source_account_id: null, destination_account_id: null,
    category_id: null, note: null, interest_paise: 0, ...extra,
  };
}

function entry(id, transactionId, accountId, delta) {
  return {
    id, owner_id: OWNER, transaction_id: transactionId,
    account_id: accountId, delta_paise: delta,
  };
}

test("goals without a target or monthly saving have no completion estimate", () => {
  const goal = { target_paise: null, monthly_contribution_paise: null };
  assert.equal(projectedGoalDate(goal, 10_000, "2026-10-08"), null);
  assert.equal(projectedGoalDate({ ...goal, target_paise: 100_000 }, 10_000, "2026-10-08"), null);
});

test("cash transfer changes locations but preserves assets and net worth", () => {
  const data = dataWith({
    accounts: [account("checking", "bank", 100_000), account("savings", "bank", 50_000)],
    transactions: [transaction("transfer", "transfer", 20_000, "2026-10-05", {
      source_account_id: "checking", destination_account_id: "savings",
    })],
    entries: [
      entry("e1", "transfer", "checking", -20_000),
      entry("e2", "transfer", "savings", 20_000),
    ],
  });
  const before = totalsOn(data, "2026-10-04");
  const after = totalsOn(data, "2026-10-05");

  assert.equal(before.netWorth, 150_000);
  assert.equal(after.netWorth, before.netWorth);
  assert.equal(after.assets, before.assets);
  assert.equal(after.balances.get("checking"), 80_000);
  assert.equal(after.balances.get("savings"), 70_000);
});

test("investment contribution moves value without creating income or wealth", () => {
  const data = dataWith({
    accounts: [account("bank", "bank", 100_000), account("fund", "investment", 10_000)],
    transactions: [transaction("sip", "investment_contribution", 20_000, "2026-10-05", {
      source_account_id: "bank", destination_account_id: "fund",
    })],
    entries: [entry("e1", "sip", "bank", -20_000), entry("e2", "sip", "fund", 20_000)],
  });
  const before = totalsOn(data, "2026-10-04");
  const after = totalsOn(data, "2026-10-05");

  assert.equal(after.cash, 80_000);
  assert.equal(after.investments, 30_000);
  assert.equal(after.netWorth, before.netWorth);
  assert.equal(after.assets, before.assets);
  assert.equal(effectiveTransactions(data)[0].kind, "investment_contribution");
});

test("card purchase counts once as spending; repayment preserves net worth", () => {
  const data = dataWith({
    accounts: [account("bank", "bank", 100_000), account("card", "card", 0)],
    transactions: [
      transaction("purchase", "expense", 10_000, "2026-10-05", {
        source_account_id: "card", category_id: "food",
      }),
      transaction("repayment", "card_payment", 10_000, "2026-10-06", {
        source_account_id: "bank", destination_account_id: "card",
      }),
    ],
    entries: [
      entry("e1", "purchase", "card", 10_000),
      entry("e2", "repayment", "bank", -10_000),
      entry("e3", "repayment", "card", -10_000),
    ],
  });
  const purchased = totalsOn(data, "2026-10-05");
  const repaid = totalsOn(data, "2026-10-06");
  const spending = effectiveTransactions(data)
    .filter((item) => item.kind === "expense")
    .reduce((sum, item) => sum + item.amount_paise, 0);

  assert.equal(purchased.debts, 10_000);
  assert.equal(purchased.netWorth, 90_000);
  assert.equal(repaid.debts, 0);
  assert.equal(repaid.cash, 90_000);
  assert.equal(repaid.netWorth, purchased.netWorth);
  assert.equal(spending, 10_000);
});

test("backdated valuation retains later contribution; same-day order is respected", () => {
  const fund = account("fund", "investment", 10_000);
  const transactions = [
    transaction("later-date", "investment_contribution", 20_000, "2026-10-04", {
      created_at: "2026-10-05T10:00:00Z",
    }),
    transaction("same-before", "investment_contribution", 3_000, "2026-10-03", {
      created_at: "2026-10-05T11:00:00Z",
    }),
    transaction("same-after", "investment_contribution", 5_000, "2026-10-03", {
      created_at: "2026-10-05T13:00:00Z",
    }),
  ];
  const entries = [
    entry("e1", "later-date", "fund", 20_000),
    entry("e2", "same-before", "fund", 3_000),
    entry("e3", "same-after", "fund", 5_000),
  ];
  const valuation = {
    id: "valuation", owner_id: OWNER, account_id: "fund",
    as_of_date: "2026-10-03", market_value_paise: 15_000,
    created_at: "2026-10-05T12:00:00Z",
  };

  assert.equal(balanceOn(fund, entries, [valuation], transactions, "2026-10-05"), 40_000);
  assert.equal(balanceOn(fund, entries, [valuation], transactions, "2026-10-03"), 20_000);
});

test("goal reservations do not add to assets or net worth", () => {
  const goal = {
    id: "emergency", owner_id: OWNER, name: "Emergency", target_paise: 30_000,
    target_on: null, monthly_contribution_paise: 1_000, status: "active",
    completed_at: null, notes: null,
  };
  const data = dataWith({
    accounts: [account("bank", "bank", 100_000), account("fund", "investment", 15_000)],
    goals: [goal],
    goalAllocations: [
      { id: "a1", owner_id: OWNER, goal_id: goal.id, account_id: "bank",
        cash_amount_paise: 25_000, investment_share_ppm: null },
      { id: "a2", owner_id: OWNER, goal_id: goal.id, account_id: "fund",
        cash_amount_paise: null, investment_share_ppm: 1_000_000 },
    ],
  });
  const totals = totalsOn(data, "2026-10-05");

  assert.equal(fundedForGoal(goal, data, totals.balances), 40_000);
  assert.equal(availableCash(data.accounts[0], data, totals.balances), 75_000);
  assert.equal(totals.assets, 115_000);
  assert.equal(totals.netWorth, 115_000);
});

test("reversal keeps audit entries but excludes original from activity", () => {
  const data = dataWith({
    accounts: [account("bank", "bank", 50_000)],
    transactions: [
      transaction("original", "expense", 10_000, "2026-10-05"),
      transaction("reversal", "reversal", 10_000, "2026-10-05", {
        reverses_transaction_id: "original",
      }),
      transaction("corrected", "expense", 6_000, "2026-10-05"),
    ],
    entries: [
      entry("e1", "original", "bank", -10_000),
      entry("e2", "reversal", "bank", 10_000),
      entry("e3", "corrected", "bank", -6_000),
    ],
  });

  assert.deepEqual(effectiveTransactions(data).map((item) => item.id), ["corrected"]);
  assert.equal(totalsOn(data, "2026-10-05").netWorth, 44_000);
});

test("India calendar day and month boundaries use Asia/Kolkata", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-05T18:29:59Z") });
  assert.equal(todayInIndia(), "2026-10-05");
  t.mock.timers.setTime(Date.parse("2026-10-05T18:30:00Z"));
  assert.equal(todayInIndia(), "2026-10-06");
  t.mock.timers.setTime(Date.parse("2026-12-31T18:30:00Z"));
  assert.equal(todayInIndia(), "2027-01-01");

  assert.equal(monthStart("2026-10-31"), "2026-10-01");
  assert.equal(monthStartFromInput("2026-10"), "2026-10-01");
  assert.equal(monthStartFromInput(""), null);
  assert.equal(monthStartFromInput("2026-13"), null);
  assert.equal(monthStartFromInput("2026-10-01"), null);
  assert.equal(nextMonth("2026-12-01"), "2027-01-01");
  assert.equal(nextMonth("2027-03-01", -1), "2027-02-01");
  assert.equal(monthLabel("2027-01-01"), "January 2027");
});

test("rupee and paise conversion preserves small amounts and rejects unsafe input", () => {
  assert.equal(paiseFromRupees("0.29"), 29);
  assert.equal(paiseFromRupees("1.01"), 101);
  assert.equal(rupeesFromPaise(1), "0.01");
  assert.throws(() => paiseFromRupees("-1"));
  assert.throws(() => paiseFromRupees(Number.MAX_SAFE_INTEGER));
});

test("increasing a cash goal reservation adds to its existing amount without exceeding free cash", () => {
  assert.equal(increasedCashReservation(25_000, 10_000, 15_000), 35_000);
  assert.throws(() => increasedCashReservation(25_000, 0, 15_000));
  assert.throws(() => increasedCashReservation(25_000, 20_000, 15_000));
  assert.throws(() => increasedCashReservation(Number.MAX_SAFE_INTEGER, 1, 1));
});
