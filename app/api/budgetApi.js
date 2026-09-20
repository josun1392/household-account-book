import { signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  addTransaction as addTransactionCore,
  buildPendingDeleteTemplateUpdate,
  deleteTransaction as deleteTransactionCore,
  getExportRows,
  getTransactions as getTransactionsCore,
  listRecentTransactions,
  normalizeTransaction,
  updateTransaction as updateTransactionCore,
} from "../core/transactions.js";
import { buildRecurringItemTransaction, getDueRecurringOccurrences, normalizeRecurringItem } from "../core/recurringItems.js";
import { calculateSummary } from "../core/summary.js";
import { calculateCategoryStats, calculateOverallStats as calculateOverallStatsCore } from "../core/statistics.js";
import { downloadFile, escapeCsvValue, getTodayString } from "../utils.js";

const PERMISSIONS = {
  getTransactions: "READ",
  calculateSummary: "READ",
  calculateCategoryStats: "READ",
  calculateOverallStats: "READ",
  addTransaction: "WRITE",
  updateTransaction: "WRITE",
  deleteTransaction: "DANGEROUS",
  bulkUpdate: "DANGEROUS",
  exportAllData: "DANGEROUS",
};

const PUBLIC_API_DEFINITIONS = [
  {
    name: "setCurrentUser",
    permission: "WRITE",
    description: "Set the current authenticated user and refresh scoped data.",
    parameters: [{ name: "user", type: "FirebaseUser|null", required: true }],
    returns: "Promise<void|Transaction[]>",
  },
  {
    name: "refresh",
    permission: "READ",
    description: "Reload transactions from storage, apply migration, offline queue, and recurring generation.",
    parameters: [],
    returns: "Promise<Transaction[]>",
  },
  {
    name: "getTransactions",
    permission: "READ",
    description: "Return transactions filtered and sorted for the current user state.",
    parameters: [{ name: "filter", type: "TransactionFilter", required: false }],
    returns: "Transaction[]",
  },
  {
    name: "queryTransactions",
    permission: "READ",
    description: "Apply the same filter logic to a provided transaction array.",
    parameters: [
      { name: "sourceTransactions", type: "Transaction[]", required: true },
      { name: "filter", type: "TransactionFilter", required: false },
    ],
    returns: "Transaction[]",
  },
  {
    name: "calculateSummary",
    permission: "READ",
    description: "Calculate income, expense, savings, balance, and fixed/variable totals.",
    parameters: [{ name: "input", type: "Transaction[]|TransactionFilter|null", required: false }],
    returns: "SummaryResult",
  },
  {
    name: "calculateCategoryStats",
    permission: "READ",
    description: "Calculate category totals and shares for income or expense items.",
    parameters: [
      { name: "input", type: "Transaction[]|TransactionFilter|null", required: false },
      { name: "type", type: "'income'|'expense'", required: false },
    ],
    returns: "CategoryStat[]",
  },
  {
    name: "calculateOverallStats",
    permission: "READ",
    description: "Calculate overall flow totals across income, expense, savings, and balance.",
    parameters: [{ name: "input", type: "Transaction[]|TransactionFilter|null", required: false }],
    returns: "OverallStatsResult",
  },
  {
    name: "getSummaryDetails",
    permission: "READ",
    description: "Build modal/detail data for a summary card type.",
    parameters: [
      { name: "summaryType", type: "string", required: true },
      { name: "filterOrTransactions", type: "TransactionFilter|Transaction[]", required: false },
    ],
    returns: "SummaryDetailsResult",
  },
  {
    name: "addTransaction",
    permission: "WRITE",
    description: "Validate, normalize, store, and optionally queue a new transaction.",
    parameters: [{ name: "data", type: "TransactionInput", required: true }],
    returns: "Promise<ActionResult<Transaction>>",
  },
  {
    name: "updateTransaction",
    permission: "WRITE",
    description: "Validate, normalize, and persist updates for an existing transaction.",
    parameters: [
      { name: "id", type: "string", required: true },
      { name: "data", type: "Partial<TransactionInput>", required: true },
    ],
    returns: "Promise<ActionResult<Transaction>>",
  },
  {
    name: "deleteTransaction",
    permission: "DANGEROUS",
    description: "Stage deletion of a transaction and return a confirmation payload.",
    parameters: [{ name: "id", type: "string", required: true }],
    returns: "Promise<ConfirmationResult|FailureResult>",
  },
  {
    name: "bulkUpdate",
    permission: "DANGEROUS",
    description: "Stage a bulk update request and return a confirmation payload.",
    parameters: [{ name: "items", type: "Array<{id:string,data:object}>", required: true }],
    returns: "Promise<ConfirmationResult>",
  },
  {
    name: "exportTransactions",
    permission: "WRITE",
    description: "Export filtered transactions to CSV or JSON.",
    parameters: [
      { name: "format", type: "'csv'|'json'", required: false },
      { name: "filter", type: "TransactionFilter", required: false },
    ],
    returns: "ActionResult<{ format: string, count: number }>",
  },
  {
    name: "exportAllData",
    permission: "DANGEROUS",
    description: "Stage export of the full dataset and return a confirmation payload.",
    parameters: [{ name: "format", type: "'csv'|'json'", required: false }],
    returns: "ConfirmationResult",
  },
  {
    name: "confirmAction",
    permission: "DANGEROUS",
    description: "Execute a previously staged dangerous action.",
    parameters: [{ name: "confirmationId", type: "string", required: true }],
    returns: "Promise<ActionResult<any>>",
  },
  {
    name: "cancelConfirmation",
    permission: "DANGEROUS",
    description: "Cancel a staged dangerous action.",
    parameters: [{ name: "confirmationId", type: "string", required: true }],
    returns: "Promise<{ ok: true, confirmationId: string }>",
  },
  {
    name: "listRecentTransactions",
    permission: "READ",
    description: "Return a latest-first subset of transactions.",
    parameters: [
      { name: "limit", type: "number", required: false },
      { name: "filter", type: "TransactionFilter", required: false },
    ],
    returns: "Transaction[]",
  },
  {
    name: "generateRecurringTransactionsIfNeeded",
    permission: "WRITE",
    description: "Create missing generated recurring transactions for the active user.",
    parameters: [],
    returns: "Promise<{ ok: true, transactions: Transaction[], created: Transaction[], failed: Transaction[] }>",
  },
  {
    name: "syncPendingChanges",
    permission: "WRITE",
    description: "Push queued offline mutations to remote storage.",
    parameters: [],
    returns: "Promise<{ ok: true, transactions: Transaction[], remainingQueue: object[] }>",
  },
  {
    name: "signInWithGoogle",
    permission: "WRITE",
    description: "Start Google sign-in flow.",
    parameters: [],
    returns: "Promise<UserCredential>",
  },
  {
    name: "signOut",
    permission: "WRITE",
    description: "Sign the current user out.",
    parameters: [],
    returns: "Promise<void>",
  },
  {
    name: "dumpTransactionsBackup",
    permission: "READ",
    description: "Persist a local backup snapshot of current transactions.",
    parameters: [{ name: "reason", type: "string", required: false }],
    returns: "BackupSnapshot|null",
  },
  {
    name: "setOnlineStatus",
    permission: "WRITE",
    description: "Update the in-memory online/offline flag.",
    parameters: [{ name: "isOnline", type: "boolean", required: true }],
    returns: "void",
  },
  {
    name: "getPermissionLevel",
    permission: "READ",
    description: "Return the permission tier for a named action.",
    parameters: [{ name: "action", type: "string", required: true }],
    returns: "'READ'|'WRITE'|'DANGEROUS'",
  },
  {
    name: "getState",
    permission: "READ",
    description: "Return the current API state snapshot.",
    parameters: [],
    returns: "BudgetApiState",
  },
  {
    name: "subscribe",
    permission: "READ",
    description: "Subscribe to state changes.",
    parameters: [{ name: "listener", type: "(state: BudgetApiState) => void", required: true }],
    returns: "() => void",
  },
  {
    name: "getToolDefinitions",
    permission: "READ",
    description: "Return a concise tool schema for AI integration.",
    parameters: [],
    returns: "ToolDefinition[]",
  },
  {
    name: "getApiReference",
    permission: "READ",
    description: "Return the full public API metadata for documentation or AI tooling.",
    parameters: [],
    returns: "ApiDefinition[]",
  },
];

const AI_TOOL_METADATA = [
  {
    name: "getTransactions",
    description: "Read transactions with optional month, type, search, and sort filters.",
    safetyLevel: "READ",
    confirmationRequired: false,
  },
  {
    name: "calculateSummary",
    description: "Calculate summary totals from current transactions or a filtered subset.",
    safetyLevel: "READ",
    confirmationRequired: false,
  },
  {
    name: "calculateCategoryStats",
    description: "Calculate category statistics for income or expense transactions.",
    safetyLevel: "READ",
    confirmationRequired: false,
  },
  {
    name: "listRecentTransactions",
    description: "Return the most recent transactions for quick inspection.",
    safetyLevel: "READ",
    confirmationRequired: false,
  },
  {
    name: "addTransaction",
    description: "Add a new financial transaction.",
    safetyLevel: "WRITE",
    confirmationRequired: false,
  },
  {
    name: "updateTransaction",
    description: "Update an existing financial transaction.",
    safetyLevel: "WRITE",
    confirmationRequired: false,
  },
  {
    name: "generateRecurringTransactionsIfNeeded",
    description: "Generate any missing recurring transactions.",
    safetyLevel: "WRITE",
    confirmationRequired: false,
  },
  {
    name: "syncPendingChanges",
    description: "Sync queued offline mutations to remote storage.",
    safetyLevel: "WRITE",
    confirmationRequired: false,
  },
  {
    name: "exportTransactions",
    description: "Export filtered transactions to CSV or JSON.",
    safetyLevel: "WRITE",
    confirmationRequired: false,
  },
  {
    name: "deleteTransaction",
    description: "Stage deletion of a transaction. Requires explicit confirmation before execution.",
    safetyLevel: "DANGEROUS",
    confirmationRequired: true,
  },
  {
    name: "bulkUpdate",
    description: "Stage updates for multiple transactions. Requires explicit confirmation before execution.",
    safetyLevel: "DANGEROUS",
    confirmationRequired: true,
  },
  {
    name: "exportAllData",
    description: "Stage export of the full dataset. Requires explicit confirmation before execution.",
    safetyLevel: "DANGEROUS",
    confirmationRequired: true,
  },
  {
    name: "confirmAction",
    description: "Confirm and execute a previously staged dangerous action.",
    safetyLevel: "DANGEROUS",
    confirmationRequired: false,
  },
  {
    name: "cancelConfirmation",
    description: "Cancel a previously staged dangerous action.",
    safetyLevel: "DANGEROUS",
    confirmationRequired: false,
  },
];

export function createBudgetAPI({ auth, googleProvider, storage, syncService, validation, logger }) {
  const listeners = new Set();
  const pendingConfirmations = new Map();
  let recurringGenerationPromise = null;
  let recurringItemMaterializationPromise = null;
  const state = {
    currentUser: null,
    transactions: [],
    quarantinedTransactions: [],
    recurringItems: [],
    online: navigator.onLine,
    loading: false,
  };

  const budgetAPI = {
    // All UI and AI traffic must enter through this gateway so the same checks always run.
    async setCurrentUser(user) {
      state.currentUser = user;
      if (!user) {
        state.transactions = [];
        state.quarantinedTransactions = [];
        state.recurringItems = [];
        emit();
        return;
      }
      await budgetAPI.refresh();
    },

    async refresh() {
      if (!state.currentUser) {
        state.transactions = [];
        emit();
        return state.transactions;
      }

      state.loading = true;
      emit();

      const uid = storage.getUserId(state.currentUser);
      const remote = await storage.loadTransactions(uid);
      state.transactions = remote.normalized;
      state.quarantinedTransactions = storage.appendQuarantine(uid, remote.quarantined);

      if (state.transactions.length === 0 && state.online && !storage.isLegacyMigrationCompleted(uid)) {
        await storage.migrateLegacyTransactions(uid);
        const migrated = await storage.loadTransactions(uid);
        state.transactions = migrated.normalized;
        state.quarantinedTransactions = storage.appendQuarantine(uid, migrated.quarantined);
      }

      state.transactions = syncService.applyOfflineQueue(
        state.transactions,
        storage.loadOfflineQueue(uid),
      );

      if (state.online) {
        await budgetAPI.syncPendingChanges();
        const latest = await storage.loadTransactions(uid);
        state.transactions = latest.normalized;
        state.quarantinedTransactions = storage.appendQuarantine(uid, latest.quarantined);
      }

      // Legacy templates retain their production behavior, including offline
      // queueing. The canonical recurringItems engine stays online-only.
      // Run after every refresh, not only online. Overdue fixed items should
      // appear on app load, and offline mode can queue them for later sync.
      await budgetAPI.generateRecurringTransactionsIfNeeded();

      try {
        state.recurringItems = await storage.loadRecurringItems(uid);
      } catch (error) {
        console.warn("반복 항목을 불러오지 못했습니다.", error);
        state.recurringItems = [];
      }
      await budgetAPI.materializeRecurringItemsIfNeeded();

      state.loading = false;
      emit();
      logAction("refresh", "READ", { uid }, true);
      return state.transactions;
    },

    getTransactions(filter = {}) {
      const safeFilter = validation.sanitizeFilter(filter);
      const result = getTransactionsCore(state.transactions, safeFilter);
      logAction("getTransactions", PERMISSIONS.getTransactions, safeFilter, true);
      return result;
    },

    queryTransactions(sourceTransactions, filter = {}) {
      const safeFilter = validation.sanitizeFilter(filter);
      return getTransactionsCore(Array.isArray(sourceTransactions) ? sourceTransactions : state.transactions, safeFilter);
    },

    calculateSummary(input = null) {
      const transactions = Array.isArray(input) ? input : budgetAPI.getTransactions(input ?? {});
      const result = calculateSummary(transactions);
      logAction("calculateSummary", PERMISSIONS.calculateSummary, summarizeParams(input), true);
      return result;
    },

    calculateCategoryStats(input = null, type = "expense") {
      const transactions = Array.isArray(input) ? input : budgetAPI.getTransactions(input ?? {});
      const result = calculateCategoryStats(transactions, type);
      logAction("calculateCategoryStats", PERMISSIONS.calculateCategoryStats, { type, input: summarizeParams(input) }, true);
      return result;
    },

    calculateOverallStats(input = null) {
      const transactions = Array.isArray(input) ? input : budgetAPI.getTransactions(input ?? {});
      return calculateOverallStatsCore(transactions);
    },

    getSummaryDetails(summaryType, filterOrTransactions = {}) {
      const items = Array.isArray(filterOrTransactions)
        ? getTransactionsCore(filterOrTransactions, { sort: "latest" })
        : budgetAPI.getTransactions({ ...filterOrTransactions, sort: "latest" });
      const summary = calculateSummary(items);
      switch (summaryType) {
        case "income":
          return { title: "총수입 상세", total: summary.income, transactions: items.filter((item) => item.type === "income"), kind: "transactions" };
        case "fixedIncome":
          return { title: "총고정수입 상세", total: summary.fixedIncome, transactions: items.filter((item) => item.type === "income" && item.isFixed), kind: "transactions" };
        case "expense":
          return { title: "총지출 상세", total: summary.expense, transactions: items.filter((item) => item.type === "expense" && item.recordClass !== "savings"), kind: "transactions" };
        case "savings":
          return { title: "총저축 상세", total: summary.savings, transactions: items.filter((item) => item.recordClass === "savings"), kind: "transactions" };
        case "fixedExpense":
          return { title: "총고정지출 상세", total: summary.fixedExpense, transactions: items.filter((item) => item.type === "expense" && item.recordClass !== "savings" && item.isFixed), kind: "transactions" };
        case "variableExpense":
          return { title: "총변동지출 상세", total: summary.variableExpense, transactions: items.filter((item) => item.type === "expense" && item.recordClass !== "savings" && !item.isFixed), kind: "transactions" };
        case "balance":
          return { title: "잔액 상세", total: summary.balance, transactions: [], kind: "balance", summary };
        default:
          return { title: "요약 상세", total: 0, transactions: [], kind: "transactions" };
      }
    },

    async addTransaction(data) {
      ensureAuthenticated(state.currentUser);
      const uid = storage.getUserId(state.currentUser);
      const validated = validation.validateTransactionPayload({
        ...data,
        userId: uid,
        clientId: data.clientId || data.id || undefined,
      });

      if (!validated.ok) {
        logValidationFailure("addTransaction", data, validated.reason, { stage: "validateTransactionPayload" });
        logAction("addTransaction", PERMISSIONS.addTransaction, data, false, validated.reason);
        return validated;
      }

      const result = addTransactionCore(state.transactions, validated.value);
      if (!result.ok) {
        logValidationFailure("addTransaction", data, result.reason, { stage: "addTransactionCore" });
        logAction("addTransaction", PERMISSIONS.addTransaction, data, false, result.reason);
        return result;
      }

      let transaction = result.transaction;
      if (!transaction.clientId) {
        transaction = { ...transaction, clientId: transaction.id };
      }

      if (!state.online) {
        state.transactions = [...state.transactions, transaction];
        storage.queueOfflineMutation(uid, { type: "create", transaction });
        emit();
        await budgetAPI.generateRecurringTransactionsIfNeeded();
        logAction("addTransaction", PERMISSIONS.addTransaction, summarizeParams(transaction), true, null, { mode: "offline" });
        return { ok: true, transaction, mode: "offline" };
      }

      const stored = await storage.createTransaction(uid, transaction);
      state.transactions = [...state.transactions, stored];
      emit();
      await budgetAPI.generateRecurringTransactionsIfNeeded();
      logAction("addTransaction", PERMISSIONS.addTransaction, summarizeParams(stored), true, null, { mode: "remote" });
      return { ok: true, transaction: stored, mode: "remote" };
    },

    async updateTransaction(id, data) {
      ensureAuthenticated(state.currentUser);
      const validatedId = validation.validateTransactionId(id);
      if (!validatedId.ok) {
        logValidationFailure("updateTransaction", { id }, validatedId.reason, { stage: "validateTransactionId" });
        logAction("updateTransaction", PERMISSIONS.updateTransaction, { id }, false, validatedId.reason);
        return validatedId;
      }

      const existing = state.transactions.find((item) => item.id === validatedId.value);
      const validated = validation.validateTransactionPayload({ ...existing, ...data, id: validatedId.value });
      if (!validated.ok) {
        logValidationFailure("updateTransaction", { id, data }, validated.reason, { stage: "validateTransactionPayload" });
        logAction("updateTransaction", PERMISSIONS.updateTransaction, { id, data }, false, validated.reason);
        return validated;
      }

      const result = updateTransactionCore(state.transactions, validatedId.value, validated.value);
      if (!result.ok) {
        logValidationFailure("updateTransaction", { id, data }, result.reason, { stage: "updateTransactionCore" });
        logAction("updateTransaction", PERMISSIONS.updateTransaction, { id, data }, false, result.reason);
        return result;
      }

      const uid = storage.getUserId(state.currentUser);
      const transaction = {
        ...result.transaction,
        clientId: result.transaction.clientId || result.transaction.id,
      };

      if (!state.online) {
        state.transactions = state.transactions.map((item) => item.id === validatedId.value ? transaction : item);
        storage.queueOfflineMutation(uid, { type: "update", transaction });
        emit();
        await budgetAPI.generateRecurringTransactionsIfNeeded();
        logAction("updateTransaction", PERMISSIONS.updateTransaction, summarizeParams(transaction), true, null, { mode: "offline" });
        return { ok: true, transaction, mode: "offline" };
      }

      const stored = await storage.updateTransaction(uid, validatedId.value, transaction);
      state.transactions = state.transactions.map((item) => item.id === validatedId.value ? stored : item);
      emit();
      await budgetAPI.generateRecurringTransactionsIfNeeded();
      logAction("updateTransaction", PERMISSIONS.updateTransaction, summarizeParams(stored), true, null, { mode: "remote" });
      return { ok: true, transaction: stored, mode: "remote" };
    },

    getRecurringItems() {
      return [...state.recurringItems];
    },

    async createRecurringItem(data) {
      ensureAuthenticated(state.currentUser);
      if (!state.online) return { ok: false, reason: "고정 항목 관리는 온라인에서만 변경할 수 있습니다." };
      const normalized = normalizeRecurringItem(data);
      if (!normalized.ok) return normalized;
      const item = await storage.createRecurringItem(storage.getUserId(state.currentUser), {
        ...normalized.value, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      state.recurringItems = [...state.recurringItems, item];
      emit();
      await budgetAPI.materializeRecurringItemsIfNeeded();
      return { ok: true, item };
    },

    async updateRecurringItem(id, data) {
      ensureAuthenticated(state.currentUser);
      if (!state.online) return { ok: false, reason: "고정 항목 관리는 온라인에서만 변경할 수 있습니다." };
      const existing = state.recurringItems.find((item) => item.id === id);
      if (!existing) return { ok: false, reason: "고정 항목을 찾을 수 없습니다." };
      const normalized = normalizeRecurringItem({ ...existing, ...data });
      if (!normalized.ok) return normalized;
      const item = await storage.updateRecurringItem(storage.getUserId(state.currentUser), id, {
        ...normalized.value, createdAt: existing.createdAt, updatedAt: new Date().toISOString(),
      });
      state.recurringItems = state.recurringItems.map((current) => current.id === id ? item : current);
      emit();
      return { ok: true, item };
    },

    async deleteRecurringItem(id) {
      ensureAuthenticated(state.currentUser);
      if (!state.online) return { ok: false, reason: "고정 항목 관리는 온라인에서만 변경할 수 있습니다." };
      await storage.deleteRecurringItem(storage.getUserId(state.currentUser), id);
      state.recurringItems = state.recurringItems.filter((item) => item.id !== id);
      emit();
      return { ok: true };
    },

    async deleteTransaction(id) {
      ensureAuthenticated(state.currentUser);
      const validatedId = validation.validateTransactionId(id);
      if (!validatedId.ok) {
        logValidationFailure("deleteTransaction", { id }, validatedId.reason, { stage: "validateTransactionId" });
        logAction("deleteTransaction", PERMISSIONS.deleteTransaction, { id }, false, validatedId.reason);
        return validatedId;
      }
      return createConfirmation("deleteTransaction", { id: validatedId.value });
    },

    async bulkUpdate(items) {
      ensureAuthenticated(state.currentUser);
      return createConfirmation("bulkUpdate", { items });
    },

    exportTransactions(format = "json", filter = {}) {
      try {
        const rows = getExportRows(budgetAPI.getTransactions(filter));
        const count = downloadExport(rows, format);
        logAction("exportTransactions", "WRITE", { format, filter: summarizeParams(filter), count }, true);
        return { ok: true, format, count };
      } catch (error) {
        logAction("exportTransactions", "WRITE", { format, filter: summarizeParams(filter) }, false, error.message);
        return { ok: false, format, reason: error.message };
      }
    },

    exportAllData(format = "json") {
      ensureAuthenticated(state.currentUser);
      return createConfirmation("exportAllData", { format });
    },

    async confirmAction(confirmationId) {
      const pending = pendingConfirmations.get(confirmationId);
      if (!pending) {
        return { ok: false, reason: "확인 대기 중인 작업을 찾을 수 없습니다." };
      }

      pendingConfirmations.delete(confirmationId);

      try {
        let result;
        if (pending.action === "deleteTransaction") {
          result = await executeDelete(pending.params.id);
        } else if (pending.action === "bulkUpdate") {
          result = await executeBulkUpdate(pending.params.items);
        } else if (pending.action === "exportAllData") {
          const count = downloadExport(getExportRows(state.transactions), pending.params.format);
          result = { ok: true, format: pending.params.format, count };
        } else {
          result = { ok: false, reason: "지원하지 않는 확인 작업입니다." };
        }

        logAction(pending.action, pending.permission, summarizeParams(pending.params), result.ok !== false, result.reason ?? null, { confirmationId });
        return result;
      } catch (error) {
        logAction(pending.action, pending.permission, summarizeParams(pending.params), false, error.message, { confirmationId });
        throw error;
      }
    },

    async cancelConfirmation(confirmationId) {
      pendingConfirmations.delete(confirmationId);
      return { ok: true, confirmationId };
    },

    listRecentTransactions(limit = 10, filter = {}) {
      const safeFilter = validation.sanitizeFilter(filter);
      return listRecentTransactions(state.transactions, limit, safeFilter);
    },

    async generateRecurringTransactionsIfNeeded() {
      if (!state.currentUser) {
        return { ok: true, created: [], failed: [] };
      }

      if (recurringGenerationPromise) {
        return recurringGenerationPromise;
      }

      recurringGenerationPromise = (async () => {
        const uid = storage.getUserId(state.currentUser);
        const result = await syncService.ensureDueFixedTransactions({
          uid,
          transactions: state.transactions,
          online: state.online,
          today: getTodayString(),
        });

        state.transactions = result.transactions;
        if (!state.online && result.failed.length > 0) {
          result.failed.forEach((transaction) => {
            storage.queueOfflineMutation(uid, { type: "create", transaction });
          });
        }
        emit();
        logAction("generateRecurringTransactionsIfNeeded", "WRITE", { created: result.created.length, failed: result.failed.length }, true);
        return { ok: true, ...result };
      })();

      try {
        return await recurringGenerationPromise;
      } finally {
        recurringGenerationPromise = null;
      }
    },

    async materializeRecurringItemsIfNeeded() {
      if (!state.currentUser || !state.online || recurringItemMaterializationPromise) {
        return recurringItemMaterializationPromise ?? { ok: true, created: [], failed: [] };
      }
      recurringItemMaterializationPromise = (async () => {
        const uid = storage.getUserId(state.currentUser);
        const created = [];
        const failed = [];
        for (const item of state.recurringItems) {
          const normalized = normalizeRecurringItem(item);
          if (!normalized.ok || !normalized.value.isActive) continue;
          for (const occurrence of getDueRecurringOccurrences(normalized.value, getTodayString())) {
            const rawTransaction = buildRecurringItemTransaction(item, occurrence, uid);
            try {
              const wasCreated = await storage.createRecurringOccurrenceIfMissing(uid, rawTransaction);
              if (wasCreated) {
                const transaction = normalizeTransaction(rawTransaction).value;
                state.transactions = [...state.transactions, transaction];
                created.push(transaction);
              }
            } catch (error) {
              console.error("반복 항목 발생 내역을 만들지 못했습니다.", item.id, occurrence.occurrenceKey, error);
              failed.push({ itemId: item.id, occurrenceKey: occurrence.occurrenceKey });
            }
          }
        }
        if (created.length) emit();
        return { ok: true, created, failed };
      })();
      try { return await recurringItemMaterializationPromise; }
      finally { recurringItemMaterializationPromise = null; }
    },

    async syncPendingChanges() {
      if (!state.currentUser || !state.online) {
        return { ok: true, remainingQueue: [] };
      }

      const uid = storage.getUserId(state.currentUser);
      const queue = storage.loadOfflineQueue(uid);
      if (queue.length === 0) {
        return { ok: true, remainingQueue: [] };
      }

      logger?.logSync({
        action: "syncPendingChanges:start",
        params: { uid, queueSize: queue.length },
        success: true,
      });

      try {
        const result = await syncService.syncTransactions({
          uid,
          transactions: state.transactions,
          queue,
        });

        state.transactions = result.transactions;
        if (result.remainingQueue.length === 0) {
          storage.clearOfflineQueue(uid);
        } else {
          storage.saveOfflineQueue(uid, result.remainingQueue);
        }
        emit();
        logger?.logSync({
          action: result.remainingQueue.length === 0 ? "syncPendingChanges:success" : "syncPendingChanges:partial",
          params: { uid, queueSize: queue.length },
          success: result.remainingQueue.length === 0,
          error: result.remainingQueue.length === 0 ? null : `${result.remainingQueue.length} mutations remaining`,
          metadata: { remainingQueue: result.remainingQueue.length },
        });
        logAction("syncPendingChanges", "WRITE", { queueSize: queue.length, remaining: result.remainingQueue.length }, true);
        return { ok: true, ...result };
      } catch (error) {
        logger?.logSync({
          action: "syncPendingChanges:failure",
          params: { uid, queueSize: queue.length },
          success: false,
          error,
        });
        logAction("syncPendingChanges", "WRITE", { queueSize: queue.length }, false, error.message);
        throw error;
      }
    },

    async signInWithGoogle() {
      return signInWithPopup(auth, googleProvider);
    },

    async signOut() {
      return signOut(auth);
    },

    dumpTransactionsBackup(reason = "manual") {
      if (!state.currentUser) {
        return null;
      }
      return storage.dumpTransactionsBackup(storage.getUserId(state.currentUser), state.transactions, reason);
    },

    setOnlineStatus(isOnline) {
      state.online = Boolean(isOnline);
      emit();
    },

    getPermissionLevel(action) {
      return PERMISSIONS[action] ?? "READ";
    },

    getState() {
      return {
        ...state,
        transactions: [...state.transactions],
        quarantinedTransactions: [...state.quarantinedTransactions],
        recurringItems: [...state.recurringItems],
      };
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getToolDefinitions() {
      return AI_TOOL_METADATA.map((item) => ({ ...item }));
    },

    getApiReference() {
      return PUBLIC_API_DEFINITIONS.map((definition) => ({ ...definition }));
    },

    getAiToolMetadata() {
      return AI_TOOL_METADATA.map((item) => ({ ...item }));
    },
  };

  return budgetAPI;

  function emit() {
    listeners.forEach((listener) => listener(budgetAPI.getState()));
  }

  function createConfirmation(action, params) {
    const confirmationId = `${action}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const permission = PERMISSIONS[action] ?? "DANGEROUS";
    const payload = {
      action,
      permission,
      params,
      requiresConfirmation: true,
      confirmationId,
      message: buildConfirmationMessage(action),
    };
    pendingConfirmations.set(confirmationId, payload);
    logAction(action, permission, summarizeParams(params), true, null, { staged: true, confirmationId });
    return payload;
  }

  async function executeDelete(id) {
    const uid = storage.getUserId(state.currentUser);
    const deleteResult = deleteTransactionCore(state.transactions, id);
    if (!deleteResult.ok) {
      return deleteResult;
    }

    const target = deleteResult.deleted;
    if (target.source === "recurringItem" && target.recurringItemId && target.occurrenceKey) {
      if (!state.online) {
        return { ok: false, reason: "자동 생성된 반복 거래는 온라인에서만 삭제할 수 있습니다." };
      }
      // The undo timer runs in the UI before this finalized confirmation.
      // Persist the tombstone and delete atomically so reconciliation cannot
      // recreate an occurrence the user deliberately removed.
      await storage.deleteRecurringOccurrenceWithSkip(uid, target);
      state.transactions = deleteResult.transactions;
      emit();
      return { ok: true, deleted: target, mode: "remote", skippedRecurringOccurrence: true };
    }
    const templateUpdate = buildPendingDeleteTemplateUpdate(target, state.transactions);
    let nextTransactions = deleteResult.transactions;

    if (templateUpdate) {
      nextTransactions = nextTransactions.map((transaction) =>
        transaction.id !== templateUpdate.transactionId
          ? transaction
          : { ...transaction, recurringSkipMonths: templateUpdate.nextSkipMonths });
    }

    state.transactions = nextTransactions;

    if (!state.online) {
      if (templateUpdate) {
        const template = state.transactions.find((transaction) => transaction.id === templateUpdate.transactionId);
        if (template) {
          storage.queueOfflineMutation(uid, { type: "update", transaction: template });
        }
      }
      storage.queueOfflineMutation(uid, { type: "delete", transactionId: id, userId: uid });
      emit();
      return { ok: true, deleted: target, mode: "offline", stoppedRecurring: didStopRecurring(target) };
    }

    if (templateUpdate) {
      const template = state.transactions.find((transaction) => transaction.id === templateUpdate.transactionId);
      if (template) {
        await storage.updateTransaction(uid, template.id, template);
      }
    }

    await storage.deleteTransaction(uid, id);
    emit();
    return { ok: true, deleted: target, mode: "remote", stoppedRecurring: didStopRecurring(target) };
  }

  function didStopRecurring(transaction) {
    return Boolean(
      transaction?.isFixed && transaction.recurringSeriesId && !transaction.generatedMonth,
    );
  }

  async function executeBulkUpdate(items) {
    const results = [];
    for (const item of items) {
      results.push(await budgetAPI.updateTransaction(item.id, item.data));
    }
    return { ok: true, results };
  }

  function downloadExport(rows, format) {
    if (format === "csv") {
      const header = Object.keys(rows[0] ?? buildEmptyExportRow());
      const csv = [header.join(","), ...rows.map((row) => header.map((field) => escapeCsvValue(row[field])).join(","))].join("\r\n");
      downloadFile({
        content: csv,
        fileName: `household-account-book-${getTodayString()}.csv`,
        mimeType: "text/csv;charset=utf-8",
      });
      return rows.length;
    }

    downloadFile({
      content: JSON.stringify(rows, null, 2),
      fileName: `household-account-book-${getTodayString()}.json`,
      mimeType: "application/json;charset=utf-8",
    });
    return rows.length;
  }

  function logAction(action, permission, params, success, error = null, metadata = {}) {
    logger?.logAction({ action, permission, params, success, error, metadata });
  }

  function logValidationFailure(action, params, reason, metadata = {}) {
    logger?.logValidationFailure({ action, params, reason, metadata });
  }
}

function ensureAuthenticated(user) {
  if (!user) {
    throw new Error("로그인이 필요합니다.");
  }
}

function buildConfirmationMessage(action) {
  switch (action) {
    case "deleteTransaction":
      return "이 거래를 정말 삭제할까요?";
    case "bulkUpdate":
      return "여러 거래를 한 번에 수정할까요?";
    case "exportAllData":
      return "전체 데이터를 내보낼까요?";
    default:
      return "이 작업을 계속할까요?";
  }
}

function summarizeParams(value) {
  if (Array.isArray(value)) {
    return { count: value.length };
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 10));
  }
  return value;
}

function buildEmptyExportRow() {
  return {
    id: "",
    clientId: "",
    date: "",
    type: "",
    recordClass: "",
    amount: "",
    category: "",
    memo: "",
    isFixed: "",
    recurringSeriesId: "",
    recurringDay: "",
    recurringStartDate: "",
    generatedMonth: "",
    occurrenceKey: "",
    recurringSkipMonths: "",
    source: "",
    recurringItemId: "",
  };
}
