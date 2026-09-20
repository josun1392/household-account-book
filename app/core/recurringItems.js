import { addMonthsToMonthKey, getTodayString } from "../utils.js";

export function normalizeRecurringItem(input = {}) {
  const name = String(input.name ?? "").trim();
  const type = input.type === "income" || input.type === "expense" ? input.type : "";
  const amount = Number(String(input.amount ?? "").replaceAll(",", ""));
  const category = String(input.category ?? "").trim() || "기타";
  const startDate = normalizeDate(input.startDate);
  const dayOfMonth = Number(input.dayOfMonth);
  const recordClass = input.recordClass ?? "normal";
  if (!name || !type || !Number.isFinite(amount) || amount <= 0 || !startDate || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
    return { ok: false, reason: "이름, 유형, 금액, 결제일(1~31), 시작일을 확인해 주세요." };
  }
  if (recordClass !== "normal" && recordClass !== "savings") {
    return { ok: false, reason: "분류는 일반 또는 저축이어야 합니다." };
  }
  if (type === "income" && recordClass === "savings") {
    return { ok: false, reason: "수입 반복 항목은 저축으로 분류할 수 없습니다." };
  }
  return { ok: true, value: {
    ...input, name, type, amount, category, memo: String(input.memo ?? "").trim(),
    recurrence: "monthly", dayOfMonth, recordClass, isActive: input.isActive !== false,
    kind: input.kind === "subscription" ? "subscription" : "fixed", startDate,
  } };
}

export function getMonthlyOccurrenceDate(monthKey, dayOfMonth) {
  const [year, month] = monthKey.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return `${monthKey}-${String(Math.min(dayOfMonth, lastDay)).padStart(2, "0")}`;
}

export function getDueRecurringOccurrences(item, today = getTodayString()) {
  if (!item?.isActive || item.recurrence !== "monthly" || !item.startDate || item.startDate > today) return [];
  const due = [];
  let monthKey = item.startDate.slice(0, 7);
  const todayMonth = today.slice(0, 7);
  while (monthKey <= todayMonth) {
    const date = getMonthlyOccurrenceDate(monthKey, item.dayOfMonth);
    if (date >= item.startDate && date <= today) due.push({ occurrenceKey: monthKey, date });
    monthKey = addMonthsToMonthKey(monthKey, 1);
  }
  return due;
}

export function buildRecurringItemTransaction(item, occurrence, uid) {
  const id = `recurring-${item.id}-${occurrence.occurrenceKey}`;
  return {
    id, clientId: id, date: occurrence.date, type: item.type, amount: item.amount,
    category: item.category, memo: item.memo, isFixed: true, recordClass: item.recordClass ?? "normal", userId: uid,
    source: "recurringItem", recurringItemId: item.id, occurrenceKey: occurrence.occurrenceKey,
  };
}

export function getLegacyTemplateIdentity(template) {
  return template?.recurringSeriesId || template?.clientId || template?.id || "";
}

function normalizeDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}
