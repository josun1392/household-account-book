import {
  ensureDueFixedTransactions,
  getTransactionIdentity,
  normalizeTransaction,
} from "../core/transactions.js";

export function createSyncService({ storage, logger }) {
  return {
    applyOfflineQueue(transactions, queue) {
      let nextTransactions = [...transactions];

      queue.forEach((item) => {
        if (item.type === "create") {
          const result = normalizeTransaction(item.transaction);
          if (result.ok) {
            nextTransactions = upsertByIdentity(nextTransactions, result.value);
          }
          return;
        }

        if (item.type === "update") {
          const result = normalizeTransaction(item.transaction);
          if (result.ok) {
            nextTransactions = nextTransactions.map((transaction) =>
              transaction.id === item.transaction.id ? result.value : transaction);
          }
          return;
        }

        nextTransactions = nextTransactions.filter((transaction) => transaction.id !== item.transactionId);
      });

      return nextTransactions;
    },

    async syncTransactions({ uid, transactions, queue }) {
      if (!uid || queue.length === 0) {
        return { transactions, remainingQueue: queue };
      }

      logger?.logSync({
        action: "syncTransactions:start",
        params: { uid, queueSize: queue.length },
        success: true,
      });

      const remote = await storage.loadTransactions(uid);
      const clientIdMap = new Map();
      remote.normalized.forEach((transaction) => {
        if (typeof transaction.clientId === "string" && transaction.clientId) {
          clientIdMap.set(transaction.clientId, transaction.id);
        }
      });

      let nextTransactions = [...transactions];
      const remainingQueue = [];

      for (const item of queue) {
        try {
          if (item.type === "create") {
            const result = normalizeTransaction(item.transaction);
            if (!result.ok) {
              continue;
            }
            const pending = result.value;
            const pendingClientId = pending.clientId ?? pending.id;
            const existingDocId = clientIdMap.get(pendingClientId);

            if (existingDocId) {
              nextTransactions = nextTransactions.map((transaction) =>
                transaction.id === pending.id ? { ...pending, id: existingDocId, clientId: pendingClientId } : transaction);
            } else {
              const stored = await storage.createTransaction(uid, { ...pending, clientId: pendingClientId });
              clientIdMap.set(pendingClientId, stored.id);
              nextTransactions = nextTransactions.map((transaction) =>
                transaction.id === pending.id ? stored : transaction);
            }
            continue;
          }

          if (item.type === "update") {
            const result = normalizeTransaction(item.transaction);
            if (!result.ok) {
              continue;
            }
            const pending = result.value;
            const targetId = clientIdMap.get(pending.clientId) ?? pending.id;
            await storage.updateTransaction(uid, targetId, { ...pending, id: targetId });
            continue;
          }

          const targetId = clientIdMap.get(item.transactionId) ?? item.transactionId;
          await storage.deleteTransaction(uid, targetId);
        } catch (error) {
          console.error("오프라인 변경 사항 동기화에 실패했습니다.", error);
          logger?.logSync({
            action: "syncTransactions:itemFailed",
            params: { uid, queueType: item.type, transactionId: item.transactionId ?? item.transaction?.id ?? "" },
            success: false,
            error,
          });
          remainingQueue.push(item);
        }
      }

      logger?.logSync({
        action: remainingQueue.length > 0 ? "syncTransactions:partial" : "syncTransactions:success",
        params: { uid, queueSize: queue.length },
        success: remainingQueue.length === 0,
        error: remainingQueue.length > 0 ? `${remainingQueue.length} mutations remaining` : null,
        metadata: {
          processedCount: queue.length - remainingQueue.length,
          remainingCount: remainingQueue.length,
        },
      });

      return { transactions: nextTransactions, remainingQueue };
    },

    async ensureDueFixedTransactions({ uid, transactions, online, today }) {
      // Generation must be idempotent because refresh/app-load/offline replay can
      // call this repeatedly in the same day.
      const pending = ensureDueFixedTransactions(transactions, today);

      if (pending.length === 0) {
        return { transactions, created: [], failed: [] };
      }

      if (!online) {
        return { transactions: [...transactions, ...pending], created: [], failed: pending };
      }

      const created = [];
      const failed = [];

      for (const transaction of pending) {
        try {
          const stored = await storage.createTransaction(uid, transaction);
          created.push(stored);
        } catch (error) {
          console.error("고정 항목 자동 생성에 실패했습니다.", error);
          failed.push(transaction);
        }
      }

      return {
        transactions: [...transactions, ...created, ...failed],
        created,
        failed,
      };
    },

    async generateRecurringTransactionsIfNeeded(params) {
      return this.ensureDueFixedTransactions(params);
    },
  };
}

function upsertByIdentity(transactions, transaction) {
  const identity = getTransactionIdentity(transaction);
  if (!identity) {
    return [...transactions, transaction];
  }

  let found = false;
  const nextTransactions = transactions.map((currentTransaction) => {
    if (getTransactionIdentity(currentTransaction) !== identity) {
      return currentTransaction;
    }
    found = true;
    return transaction;
  });

  return found ? nextTransactions : [...nextTransactions, transaction];
}
