export function calculateSummary(transactions) {
  const totals = transactions.reduce(
    (accumulator, transaction) => {
      if (transaction.type === "income") {
        accumulator.income += transaction.amount;
        if (transaction.isFixed) {
          accumulator.fixedIncome += transaction.amount;
        }
      } else if (transaction.recordClass === "savings") {
        accumulator.savings += transaction.amount;
      } else {
        accumulator.expense += transaction.amount;
        if (transaction.isFixed) {
          accumulator.fixedExpense += transaction.amount;
        }
      }
      return accumulator;
    },
    { income: 0, fixedIncome: 0, expense: 0, fixedExpense: 0, savings: 0 },
  );

  const balance = totals.income - totals.expense - totals.savings;
  const variableExpense = totals.expense - totals.fixedExpense;
  const fixedExpenseRatio = totals.expense === 0 ? 0 : Math.round((totals.fixedExpense / totals.expense) * 100);

  return {
    ...totals,
    balance,
    variableExpense,
    fixedExpenseRatio,
  };
}
