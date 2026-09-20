export function getTodayString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getCurrentYear() {
  return new Date().getFullYear();
}

export function getCurrentMonthValue() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

export function formatAmount(value) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

export function getDayOfMonth(dateString) {
  const dayText = typeof dateString === "string" ? dateString.split("-")[2] : "";
  return clampRecurringDay(Number(dayText));
}

export function clampRecurringDay(value) {
  if (!Number.isInteger(value)) {
    return 1;
  }
  return Math.min(Math.max(value, 1), 31);
}

export function sanitizeRecurringSkipMonths(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.filter((month) => typeof month === "string" && /^\d{4}-\d{2}$/.test(month)))];
  }
  if (typeof value === "string" && value.trim()) {
    return sanitizeRecurringSkipMonths(value.split("|"));
  }
  return [];
}

export function escapeCsvValue(value) {
  const stringValue = String(value ?? "");
  return `"${stringValue.replaceAll('"', '""')}"`;
}

export function downloadFile({ content, fileName, mimeType }) {
  const blob = new Blob([content], { type: mimeType });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function createTransactionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `txn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function addMonthsToMonthKey(monthKey, delta) {
  const [yearText, monthText] = monthKey.split("-");
  const date = new Date(Number(yearText), Number(monthText) - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function buildRecurringDate(monthKey, desiredDay) {
  const [yearText, monthText] = monthKey.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const lastDayOfMonth = new Date(year, monthIndex + 1, 0).getDate();
  const day = Math.min(clampRecurringDay(desiredDay), lastDayOfMonth);
  return `${yearText}-${monthText}-${String(day).padStart(2, "0")}`;
}

export function formatMonthLabel(monthValue) {
  const [year, month] = monthValue.split("-");
  return `${year}년 ${Number(month)}월`;
}

export function parseAmountInputValue(value) {
  const digits = extractDigits(value);
  return digits ? Number(digits) : Number.NaN;
}

export function extractDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function formatNumberWithCommas(value) {
  return Number(value || 0).toLocaleString("ko-KR");
}

export function countDigits(value) {
  return extractDigits(value).length;
}

export function getCursorPositionFromDigitIndex(formattedValue, digitIndex) {
  if (digitIndex <= 0) {
    return 0;
  }

  let digitsSeen = 0;
  for (let index = 0; index < formattedValue.length; index += 1) {
    if (/\d/.test(formattedValue[index])) {
      digitsSeen += 1;
    }

    if (digitsSeen >= digitIndex) {
      return index + 1;
    }
  }

  return formattedValue.length;
}
