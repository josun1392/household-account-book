import { expenseChartColors, incomeChartColors, statisticsFlowColors } from "../config.js";
import { calculateSummary } from "./summary.js";

export function calculateCategoryStats(transactions, type) {
  const palette = type === "income" ? incomeChartColors : expenseChartColors;
  const totals = new Map();

  transactions.forEach((transaction) => {
    if (transaction.type !== type) {
      return;
    }
    if (type === "expense" && transaction.recordClass === "savings") {
      return;
    }
    totals.set(transaction.category, (totals.get(transaction.category) ?? 0) + transaction.amount);
  });

  const totalAmount = [...totals.values()].reduce((sum, amount) => sum + amount, 0);
  return [...totals.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([category, amount], index) => ({
      category,
      amount,
      color: palette[index % palette.length],
      share: totalAmount === 0 ? 0 : Math.round((amount / totalAmount) * 100),
    }));
}

export function calculateOverallStats(transactions) {
  const summary = calculateSummary(transactions);
  const totalFlow = summary.income + summary.expense + summary.savings;
  return {
    totalFlow,
    items: [
      {
        category: "총수입",
        amount: summary.income,
        color: statisticsFlowColors.income,
        shareText: totalFlow > 0 ? `${Math.round((summary.income / totalFlow) * 100)}%` : "-",
      },
      {
        category: "총지출",
        amount: summary.expense,
        color: statisticsFlowColors.expense,
        shareText: totalFlow > 0 ? `${Math.round((summary.expense / totalFlow) * 100)}%` : "-",
      },
      {
        category: "총저축",
        amount: summary.savings,
        color: statisticsFlowColors.savings,
        shareText: totalFlow > 0 ? `${Math.round((summary.savings / totalFlow) * 100)}%` : "-",
      },
      {
        category: "잔액",
        amount: summary.balance,
        color: statisticsFlowColors.balance,
        shareText: "",
      },
    ],
  };
}
