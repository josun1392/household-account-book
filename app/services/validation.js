import { normalizeTransaction } from "../core/transactions.js";

const SAFE_TEXT_LENGTH = 120;
const SAFE_CATEGORY_LENGTH = 40;
const SAFE_SEARCH_LENGTH = 100;

export function createValidationService() {
  return {
    // User-entered memo/category/search text is always treated as inert data.
    sanitizeText(value, maxLength = SAFE_TEXT_LENGTH) {
      return String(value ?? "")
        .replace(/[\u0000-\u001F\u007F]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength);
    },

    sanitizeFilter(filter = {}) {
      return {
        month: typeof filter.month === "string" ? filter.month.trim().slice(0, 7) : "all",
        type: typeof filter.type === "string" ? filter.type.trim() : "all",
        search: this.sanitizeText(filter.search, SAFE_SEARCH_LENGTH),
        sort: typeof filter.sort === "string" ? filter.sort.trim() : "latest",
      };
    },

    validateTransactionPayload(payload, options = {}) {
      // Old and new schemas are normalized before any write reaches storage.
      const sanitized = {
        ...payload,
        category: this.sanitizeText(payload.category, SAFE_CATEGORY_LENGTH),
        memo: this.sanitizeText(payload.memo, SAFE_TEXT_LENGTH),
      };

      if (typeof sanitized.type === "string" && !["income", "expense"].includes(sanitized.type)) {
        return { ok: false, reason: "유형은 income 또는 expense여야 합니다." };
      }

      const normalized = normalizeTransaction(sanitized, options);
      if (!normalized.ok) {
        return normalized;
      }

      return {
        ok: true,
        value: normalized.value,
      };
    },

    validateTransactionId(id) {
      const value = String(id ?? "").trim();
      if (!value) {
        return { ok: false, reason: "거래 ID가 필요합니다." };
      }
      return { ok: true, value };
    },
  };
}
