import test from "node:test";
import assert from "node:assert/strict";
import { calculateCentreReconciliation } from "./reconciliation.ts";

const base = {
  movement: 0,
  counterServiceCharges: 0,
  personalGpayServiceCharges: 0,
  creditServiceCharges: 0,
  creditRepaymentsToCentre: 0,
  advancesReceivedIntoCentre: 0,
  departmentFeesPaidFromCentre: 0,
  otherPaymentsFromCentre: 0,
  transfersOutOfCentre: 0,
};

test("ordinary service charge collected by centre is a receipt", () => {
  const result = calculateCentreReconciliation({ ...base, movement: 500, counterServiceCharges: 500 });
  assert.equal(result.receipts, 500);
  assert.equal(result.difference, 0);
});

test("personal GPay service charge is excluded from centre receipts", () => {
  const result = calculateCentreReconciliation({
    ...base,
    movement: 0,
    counterServiceCharges: 300,
    personalGpayServiceCharges: 300,
  });
  assert.equal(result.receipts, 0);
  assert.equal(result.difference, 0);
});

test("partial credit repayment counts only the part received by centre", () => {
  const result = calculateCentreReconciliation({
    ...base,
    movement: 250,
    creditRepaymentsToCentre: 250,
  });
  assert.equal(result.receipts, 250);
  assert.equal(result.difference, 0);
});

test("personal GPay credit repayment is not a centre receipt", () => {
  const result = calculateCentreReconciliation({ ...base, movement: 0, creditRepaymentsToCentre: 0 });
  assert.equal(result.receipts, 0);
  assert.equal(result.difference, 0);
});

test("advance counts on receipt date; service later against old advance adds no receipt", () => {
  const receiptDay = calculateCentreReconciliation({ ...base, movement: 1000, advancesReceivedIntoCentre: 1000 });
  assert.equal(receiptDay.difference, 0);
  const serviceDay = calculateCentreReconciliation({ ...base, movement: 0 });
  assert.equal(serviceDay.difference, 0);
});

test("personal GPay departmental collection with centre bank payout counts only actual centre payout", () => {
  const result = calculateCentreReconciliation({
    ...base,
    movement: -840,
    counterServiceCharges: 300,
    personalGpayServiceCharges: 300,
    departmentFeesPaidFromCentre: 840,
  });
  assert.equal(result.receipts, 0);
  assert.equal(result.payments, 840);
  assert.equal(result.difference, 0);
});

test("expenses and owner transfers are centre outflows", () => {
  const result = calculateCentreReconciliation({
    ...base,
    movement: -2100,
    otherPaymentsFromCentre: 100,
    transfersOutOfCentre: 2000,
  });
  assert.equal(result.payments, 2100);
  assert.equal(result.difference, 0);
});
