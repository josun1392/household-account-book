import {
  addMonthsToMonthKey,
  buildRecurringDate,
  clampRecurringDay,
  createTransactionId,
  formatNumberWithCommas,
  getTodayString,
  getDayOfMonth,
  sanitizeRecurringSkipMonths,
} from "../utils.js";

export function normalizeTransaction(input, options = {}) {
  const raw = input ?? {};
  const fallbackId = options.fallbackId ?? "";
  const id = asString(raw.id) || asString(raw.clientId) || fallbackId || createTransactionId();
  const date = normalizeDate(raw.date ?? raw.createdAt);
  const type = normalizeType(raw.type ?? raw.kind);
  const amount = normalizeAmount(raw.amount ?? raw.value);
  const category = asString(raw.category) || "기타";
  const memo = asString(raw.memo);

  if (!date || !type || !Number.isFinite(amount) || !category) {
    return {
      ok: false,
      reason: "핵심 필드(date/type/amount/category)가 누락되었거나 형식이 올바르지 않습니다.",
      raw,
    };
  }

  const isFixed = Boolean(raw.isFixed);
  // New recurringItems occurrences are fixed classifications, not legacy
  // transaction templates. Keep their provenance intact and never infer a
  // legacy series from them.
  const isNewRecurringOccurrence = raw.source === "recurringItem";
  const isLegacyFixed = isFixed && !isNewRecurringOccurrence;
  const generatedMonth = isLegacyFixed && typeof raw.generatedMonth === "string" ? raw.generatedMonth : "";
  const clientId = asString(raw.clientId) || (generatedMonth ? id : "");
  const recurringSeriesId = asString(raw.recurringSeriesId)
    || (isLegacyFixed && !generatedMonth ? (clientId || id) : "");
  const recurringDay = isLegacyFixed
    ? clampRecurringDay(typeof raw.recurringDay === "number" ? raw.recurringDay : getDayOfMonth(date))
    : null;
  const recurringStartDate = isLegacyFixed
    ? (asString(raw.recurringStartDate) || date)
    : "";
  const occurrenceKey = isLegacyFixed
    ? normalizeOccurrenceKey(raw.occurrenceKey, generatedMonth, recurringDay)
    : asString(raw.occurrenceKey);

  return {
    ok: true,
    value: {
      ...raw,
      id,
      ...(clientId ? { clientId } : {}),
      date,
      type,
      recordClass: normalizeRecordClass(raw.recordClass, raw.isSavings, raw.recordClassSavings),
      amount,
      category,
      memo,
      isFixed,
      recurringSeriesId,
      recurringDay,
      recurringStartDate,
      generatedMonth,
      occurrenceKey,
      recurringSkipMonths: sanitizeRecurringSkipMonths(raw.recurringSkipMonths),
    },
  };
}

export function addTransaction(transactions, data) {
  const result = normalizeTransaction(data);
  if (!result.ok) {
    return result;
  }
  return {
    ok: true,
    transaction: result.value,
    transactions: [...transactions, result.value],
  };
}

export function updateTransaction(transactions, id, data) {
  const existing = transactions.find((transaction) => transaction.id === id);
  if (!existing) {
    return { ok: false, reason: "거래를 찾을 수 없습니다." };
  }

  const result = normalizeTransaction({ ...existing, ...data, id });
  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    transaction: result.value,
    transactions: transactions.map((transaction) => transaction.id === id ? result.value : transaction),
  };
}

export function deleteTransaction(transactions, id) {
  const existing = transactions.find((transaction) => transaction.id === id);
  if (!existing) {
    return { ok: false, reason: "거래를 찾을 수 없습니다." };
  }

  return {
    ok: true,
    deleted: existing,
    transactions: transactions.filter((transaction) => transaction.id !== id),
  };
}

export function filterTransactions(transactions, options = {}) {
  const {
    month = "all",
    type = "all",
    search = "",
  } = options;

  const monthFiltered = !month || month === "all"
    ? [...transactions]
    : transactions.filter((transaction) => transaction.date.startsWith(month));

  const typeFiltered = monthFiltered.filter((transaction) => {
    if (type === "all") {
      return true;
    }
    if (type === "income") {
      return transaction.type === "income";
    }
    if (type === "expense") {
      return transaction.type === "expense" && transaction.recordClass !== "savings";
    }
    if (type === "savings") {
      return transaction.recordClass === "savings";
    }
    return true;
  });

  const normalizedSearch = String(search ?? "").trim().toLowerCase();
  if (!normalizedSearch) {
    return typeFiltered;
  }

  return typeFiltered.filter((transaction) => {
    const typeLabel = transaction.type === "income" ? "수입" : "지출";
    const recordClassLabel = transaction.recordClass === "savings" ? "저축" : "일반";
    const amountText = String(transaction.amount ?? "");
    const amountWithCommas = formatNumberWithCommas(transaction.amount ?? 0);
    return [
      transaction.date,
      transaction.memo,
      transaction.category,
      transaction.type,
      typeLabel,
      recordClassLabel,
      amountText,
      amountWithCommas,
    ].some((value) => String(value ?? "").toLowerCase().includes(normalizedSearch));
  });
}

export function sortTransactions(transactions, options = {}) {
  const sort = options.sort ?? "latest";
  const items = transactions.map((transaction, originalIndex) => ({ transaction, originalIndex }));

  switch (sort) {
    case "oldest":
      return items
        .sort((left, right) => compareTransactionsByOldest(left, right))
        .map(({ transaction }) => transaction);
    case "amountDesc":
      return items
        .sort((left, right) => {
          if (right.transaction.amount !== left.transaction.amount) {
            return right.transaction.amount - left.transaction.amount;
          }
          return compareTransactionsByLatest(left, right);
        })
        .map(({ transaction }) => transaction);
    case "amountAsc":
      return items
        .sort((left, right) => {
          if (left.transaction.amount !== right.transaction.amount) {
            return left.transaction.amount - right.transaction.amount;
          }
          return compareTransactionsByLatest(left, right);
        })
        .map(({ transaction }) => transaction);
    case "latest":
    default:
      return items
        .sort((left, right) => compareTransactionsByLatest(left, right))
        .map(({ transaction }) => transaction);
  }
}

export function getTransactions(transactions, filter = {}) {
  return sortTransactions(filterTransactions(transactions, filter), { sort: filter.sort ?? "latest" });
}

export function listRecentTransactions(transactions, limit = 10, filter = {}) {
  return getTransactions(transactions, { ...filter, sort: "latest" }).slice(0, limit);
}

export function getRecurringTemplates(transactions) {
  return transactions.filter((transaction) =>
    transaction.isFixed && !transaction.generatedMonth && transaction.source !== "recurringItem");
}

export function getRecurringMonthKeysToCreate(transactions, template, currentMonth) {
  // Old behavior kept for backward compatibility only:
  // this walks month-by-month until the current month, so it bulk-generates
  // the whole month as soon as the month changes, even for future due dates.
  if (!currentMonth) {
    return [];
  }

  const startMonth = template.recurringStartDate.slice(0, 7);
  const skipMonths = new Set(sanitizeRecurringSkipMonths(template.recurringSkipMonths));
  const monthKeys = [];
  let cursorMonth = addMonthsToMonthKey(startMonth, 1);

  while (cursorMonth <= currentMonth) {
    const alreadyExists = transactions.some((transaction) =>
      transaction.recurringSeriesId === template.recurringSeriesId && transaction.generatedMonth === cursorMonth);
    if (!alreadyExists && !skipMonths.has(cursorMonth)) {
      monthKeys.push(cursorMonth);
    }
    cursorMonth = addMonthsToMonthKey(cursorMonth, 1);
  }

  return monthKeys;
}

export function ensureDueFixedTransactions(transactions, today = getTodayString()) {
  // New behavior:
  // only materialize occurrences that are actually due on or before `today`.
  // If the user opens the app late, overdue months are backfilled here.
  const templates = getRecurringTemplates(transactions);
  const pending = templates
    .flatMap((template) => getDueRecurringOccurrencesToCreate(transactions, template, today)
      .map(({ monthKey, scheduledDate }) => buildRecurringTransaction(template, monthKey, scheduledDate)))
    .filter(Boolean)
    .filter(createUniqueTransactionFilter());

  return pending;
}

export function getDueRecurringOccurrencesToCreate(transactions, template, today = getTodayString()) {
  const startMonth = template.recurringStartDate.slice(0, 7);
  const todayMonth = today.slice(0, 7);
  const skipMonths = new Set(sanitizeRecurringSkipMonths(template.recurringSkipMonths));
  const dueOccurrences = [];
  let cursorMonth = addMonthsToMonthKey(startMonth, 1);

  while (cursorMonth <= todayMonth) {
    const scheduledDate = buildRecurringDate(cursorMonth, template.recurringDay);
    const isDue = scheduledDate <= today;

    if (isDue && !skipMonths.has(cursorMonth) && !hasRecurringOccurrence(transactions, template, cursorMonth, scheduledDate)) {
      dueOccurrences.push({ monthKey: cursorMonth, scheduledDate });
    }

    cursorMonth = addMonthsToMonthKey(cursorMonth, 1);
  }

  return dueOccurrences;
}

export function buildRecurringTransaction(template, monthKey, scheduledDate = buildRecurringDate(monthKey, template.recurringDay)) {
  const clientId = createRecurringClientId(template.recurringSeriesId || template.clientId || template.id, scheduledDate);
  const result = normalizeTransaction({
    ...template,
    id: clientId,
    clientId,
    date: scheduledDate,
    generatedMonth: monthKey,
    occurrenceKey: scheduledDate,
    recurringSkipMonths: [],
  });
  return result.ok ? result.value : null;
}

export function hasRecurringOccurrence(transactions, template, monthKey, scheduledDate = buildRecurringDate(monthKey, template.recurringDay)) {
  return transactions.some((transaction) => {
    if (transaction.recurringSeriesId !== template.recurringSeriesId) {
      return false;
    }

    // We accept both the legacy month marker and the new occurrence key so
    // existing edited/generated rows continue to block duplicates safely.
    return transaction.generatedMonth === monthKey
      || transaction.occurrenceKey === scheduledDate;
  });
}

export function createRecurringClientId(recurringSeriesId, occurrenceKey) {
  return `recurring-${recurringSeriesId}-${occurrenceKey}`;
}

export function getTransactionIdentity(transaction) {
  return transaction?.clientId || transaction?.id || "";
}

export function buildPendingDeleteTemplateUpdate(transaction, transactions) {
  if (!transaction.generatedMonth || !transaction.recurringSeriesId) {
    return null;
  }

  const template = transactions.find((currentTransaction) =>
    currentTransaction.recurringSeriesId === transaction.recurringSeriesId && !currentTransaction.generatedMonth);

  if (!template) {
    return null;
  }

  const previousSkipMonths = sanitizeRecurringSkipMonths(template.recurringSkipMonths);
  const nextSkipMonths = sanitizeRecurringSkipMonths([...previousSkipMonths, transaction.generatedMonth]);

  return {
    transactionId: template.id,
    previousSkipMonths,
    nextSkipMonths,
  };
}

export function getExportRows(transactions) {
  return sortTransactions(transactions, { sort: "latest" }).map((transaction) => ({
    id: transaction.id ?? "",
    clientId: transaction.clientId ?? "",
    date: transaction.date ?? "",
    type: transaction.type ?? "",
    recordClass: transaction.recordClass ?? "normal",
    amount: transaction.amount ?? 0,
    category: transaction.category ?? "",
    memo: transaction.memo ?? "",
    isFixed: Boolean(transaction.isFixed),
    recurringSeriesId: transaction.recurringSeriesId ?? "",
    recurringDay: transaction.recurringDay ?? "",
    recurringStartDate: transaction.recurringStartDate ?? "",
    generatedMonth: transaction.generatedMonth ?? "",
    occurrenceKey: transaction.occurrenceKey ?? "",
    recurringSkipMonths: sanitizeRecurringSkipMonths(transaction.recurringSkipMonths).join("|"),
    source: transaction.source ?? "",
    recurringItemId: transaction.recurringItemId ?? "",
  }));
}

export function quarantineMalformedTransactions(items, source = "unknown") {
  const normalized = [];
  const quarantined = [];

  items.forEach((item) => {
    const result = normalizeTransaction(item, { fallbackId: item?.id });
    if (result.ok) {
      normalized.push(result.value);
    } else {
      quarantined.push({
        source,
        reason: result.reason,
        raw: item,
        loggedAt: new Date().toISOString(),
      });
    }
  });

  return { normalized, quarantined };
}

function compareTransactionsByLatest(left, right) {
  const dateComparison = right.transaction.date.localeCompare(left.transaction.date);
  if (dateComparison !== 0) {
    return dateComparison;
  }
  return left.originalIndex - right.originalIndex;
}

function compareTransactionsByOldest(left, right) {
  const dateComparison = left.transaction.date.localeCompare(right.transaction.date);
  if (dateComparison !== 0) {
    return dateComparison;
  }
  return left.originalIndex - right.originalIndex;
}

function normalizeAmount(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : Number.NaN;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return Number.NaN;
    }
    const parsed = Number(trimmed.replaceAll(",", ""));
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  return Number.NaN;
}

function asString(value) {
  return typeof value === "string" ? value : "";
}

function normalizeType(value) {
  return value === "income" || value === "expense" ? value : "";
}

function normalizeDate(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function normalizeRecordClass(value, isSavings, recordClassSavings) {
  if (value === "savings" || Boolean(isSavings) || Boolean(recordClassSavings)) {
    return "savings";
  }
  return "normal";
}

function normalizeOccurrenceKey(rawOccurrenceKey, generatedMonth, recurringDay) {
  if (typeof rawOccurrenceKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawOccurrenceKey)) {
    return rawOccurrenceKey;
  }

  if (typeof generatedMonth === "string" && /^\d{4}-\d{2}$/.test(generatedMonth)) {
    return buildRecurringDate(generatedMonth, recurringDay);
  }

  return "";
}

function createUniqueTransactionFilter() {
  const seen = new Set();
  return (transaction) => {
    const key = getTransactionIdentity(transaction);
    if (!key) {
      return true;
    }
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  };
}
