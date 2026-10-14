/** Inputs must represent actual movements during the period between two accepted closings. */
export type CentreReconciliationInput = {
  movement: number;
  counterServiceCharges: number;
  personalGpayServiceCharges: number;
  creditServiceCharges: number;
  creditRepaymentsToCentre: number;
  advancesReceivedIntoCentre: number;
  departmentFeesPaidFromCentre: number;
  otherPaymentsFromCentre: number;
  transfersOutOfCentre: number;
};

export type CentreReconciliation = {
  centreServiceReceipts: number;
  receipts: number;
  payments: number;
  difference: number;
};

/**
 * Reconcile centre-held money only. Personal GPay receipts and unpaid credit are not
 * centre receipts. An advance counts when received; fulfilling that advance later is
 * not a new receipt or a cash payment. Credit repayments reduce customer debt, but
 * only repayments actually received into centre funds count as centre receipts.
 */
export function calculateCentreReconciliation(input: CentreReconciliationInput): CentreReconciliation {
  const centreServiceReceipts = Math.max(
    0,
    input.counterServiceCharges - input.personalGpayServiceCharges - input.creditServiceCharges,
  );
  const receipts =
    centreServiceReceipts +
    Math.max(0, input.creditRepaymentsToCentre) +
    Math.max(0, input.advancesReceivedIntoCentre);
  const payments =
    Math.max(0, input.departmentFeesPaidFromCentre) +
    Math.max(0, input.otherPaymentsFromCentre) +
    Math.max(0, input.transfersOutOfCentre);
  return { centreServiceReceipts, receipts, payments, difference: input.movement - receipts + payments };
}
