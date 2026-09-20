import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  runTransaction,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  BACKUP_STORAGE_KEY,
  LEGACY_TRANSACTIONS_STORAGE_KEY,
  MIGRATION_COMPLETED_KEY,
  OFFLINE_QUEUE_KEY,
  QUARANTINE_STORAGE_KEY,
  RECURRING_ITEMS_COLLECTION,
  RECURRING_OCCURRENCE_SKIPS_COLLECTION,
  TRANSACTIONS_COLLECTION,
  USERS_COLLECTION,
} from "../config.js";
import { quarantineMalformedTransactions } from "../core/transactions.js";

export function createStorageService({ db }) {
  return {
    getUserId(user) {
      return user?.uid ?? "";
    },

    getUserTransactionsCollection(uid) {
      return collection(db, USERS_COLLECTION, uid, TRANSACTIONS_COLLECTION);
    },

    getUserTransactionDocRef(uid, transactionId) {
      return doc(db, USERS_COLLECTION, uid, TRANSACTIONS_COLLECTION, transactionId);
    },

    getUserRecurringItemsCollection(uid) {
      return collection(db, USERS_COLLECTION, uid, RECURRING_ITEMS_COLLECTION);
    },

    getUserRecurringItemDocRef(uid, recurringItemId) {
      return doc(db, USERS_COLLECTION, uid, RECURRING_ITEMS_COLLECTION, recurringItemId);
    },

    getUserRecurringOccurrenceSkipDocRef(uid, recurringItemId, occurrenceKey) {
      return doc(db, USERS_COLLECTION, uid, RECURRING_OCCURRENCE_SKIPS_COLLECTION,
        `recurring-skip-${recurringItemId}-${occurrenceKey}`);
    },

    async loadTransactions(uid) {
      // Firebase payloads are normalized before the rest of the app sees them.
      const snapshot = await getDocs(this.getUserTransactionsCollection(uid));
      const rows = snapshot.docs.map((snapshotDoc) => ({
        id: snapshotDoc.id,
        ...snapshotDoc.data(),
      }));
      return quarantineMalformedTransactions(rows, "firestore");
    },

    async createTransaction(uid, transaction) {
      const docRef = await addDoc(this.getUserTransactionsCollection(uid), toFirestorePayload(transaction));
      return { ...transaction, id: docRef.id };
    },

    async updateTransaction(uid, id, transaction) {
      await updateDoc(this.getUserTransactionDocRef(uid, id), toFirestorePayload(transaction));
      return { ...transaction, id };
    },

    async deleteTransaction(uid, id) {
      await deleteDoc(this.getUserTransactionDocRef(uid, id));
    },

    async loadRecurringItems(uid) {
      const snapshot = await getDocs(this.getUserRecurringItemsCollection(uid));
      return snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
    },

    async createRecurringItem(uid, item) {
      const docRef = await addDoc(this.getUserRecurringItemsCollection(uid), toFirestorePayload(item));
      return { ...item, id: docRef.id };
    },

    async updateRecurringItem(uid, id, item) {
      await updateDoc(this.getUserRecurringItemDocRef(uid, id), toFirestorePayload(item));
      return { ...item, id };
    },

    async deleteRecurringItem(uid, id) {
      await deleteDoc(this.getUserRecurringItemDocRef(uid, id));
    },

    async createRecurringOccurrenceIfMissing(uid, transaction) {
      const transactionRef = this.getUserTransactionDocRef(uid, transaction.id);
      const skipRef = this.getUserRecurringOccurrenceSkipDocRef(uid, transaction.recurringItemId, transaction.occurrenceKey);
      return runTransaction(db, async (firestoreTransaction) => {
        const [existingTransaction, existingSkip] = await Promise.all([
          firestoreTransaction.get(transactionRef),
          firestoreTransaction.get(skipRef),
        ]);
        if (existingTransaction.exists() || existingSkip.exists()) {
          return false;
        }
        firestoreTransaction.set(transactionRef, toFirestorePayload(transaction));
        return true;
      });
    },

    async deleteRecurringOccurrenceWithSkip(uid, transaction) {
      const transactionRef = this.getUserTransactionDocRef(uid, transaction.id);
      const skipRef = this.getUserRecurringOccurrenceSkipDocRef(uid, transaction.recurringItemId, transaction.occurrenceKey);
      await runTransaction(db, async (firestoreTransaction) => {
        firestoreTransaction.set(skipRef, {
          recurringItemId: transaction.recurringItemId,
          occurrenceKey: transaction.occurrenceKey,
          skippedAt: new Date().toISOString(),
        });
        firestoreTransaction.delete(transactionRef);
      });
    },

    async migrateLegacyTransactions(uid) {
      const legacy = this.loadLegacyTransactions(uid);
      if (legacy.normalized.length === 0 || this.isLegacyMigrationCompleted(uid)) {
        return legacy.normalized;
      }

      const snapshot = await getDocs(this.getUserTransactionsCollection(uid));
      const existingClientIds = new Set();
      snapshot.docs.forEach((snapshotDoc) => {
        const data = snapshotDoc.data();
        if (typeof data.clientId === "string" && data.clientId) {
          existingClientIds.add(data.clientId);
        }
      });

      this.dumpTransactionsBackup(uid, legacy.normalized, "before-legacy-migration");

      for (const transaction of legacy.normalized) {
        const clientId = transaction.clientId || transaction.id;
        if (existingClientIds.has(clientId)) {
          continue;
        }
        await addDoc(this.getUserTransactionsCollection(uid), toFirestorePayload({ ...transaction, clientId, userId: uid }));
        existingClientIds.add(clientId);
      }

      localStorage.setItem(getMigrationCompletedKey(uid), "true");
      return legacy.normalized;
    },

    loadLegacyTransactions(uid) {
      const raw = safeJsonParse(localStorage.getItem(LEGACY_TRANSACTIONS_STORAGE_KEY), []);
      const result = Array.isArray(raw)
        ? quarantineMalformedTransactions(raw, "legacy-localStorage")
        : { normalized: [], quarantined: [] };
      this.appendQuarantine(uid, result.quarantined);
      return result;
    },

    isLegacyMigrationCompleted(uid) {
      return localStorage.getItem(getMigrationCompletedKey(uid)) === "true";
    },

    loadOfflineQueue(uid) {
      const key = getOfflineQueueKey(uid);
      return key ? safeJsonParse(localStorage.getItem(key), []) : [];
    },

    saveOfflineQueue(uid, queue) {
      const key = getOfflineQueueKey(uid);
      if (key) {
        localStorage.setItem(key, JSON.stringify(queue));
      }
    },

    clearOfflineQueue(uid) {
      const key = getOfflineQueueKey(uid);
      if (key) {
        localStorage.removeItem(key);
      }
    },

    queueOfflineMutation(uid, mutation) {
      const queue = this.loadOfflineQueue(uid);

      if (mutation.type === "create") {
        const createIndex = queue.findIndex((item) =>
          item.type === "create" && hasSameQueuedTransactionIdentity(item.transaction, mutation.transaction));
        if (createIndex >= 0) {
          queue[createIndex] = mutation;
        } else {
          queue.push(mutation);
        }
        this.saveOfflineQueue(uid, queue);
        return queue;
      }

      if (mutation.type === "update") {
        const createIndex = queue.findIndex((item) => item.type === "create" && item.transaction.id === mutation.transaction.id);
        if (createIndex >= 0) {
          queue[createIndex] = { type: "create", transaction: mutation.transaction };
          this.saveOfflineQueue(uid, queue);
          return queue;
        }

        const updateIndex = queue.findIndex((item) => item.type === "update" && item.transaction.id === mutation.transaction.id);
        if (updateIndex >= 0) {
          queue[updateIndex] = mutation;
        } else {
          queue.push(mutation);
        }
        this.saveOfflineQueue(uid, queue);
        return queue;
      }

      const createIndex = queue.findIndex((item) => item.type === "create" && item.transaction.id === mutation.transactionId);
      if (createIndex >= 0) {
        queue.splice(createIndex, 1);
        this.saveOfflineQueue(uid, queue);
        return queue;
      }

      const filteredQueue = queue.filter((item) =>
        item.type === "delete" ? item.transactionId !== mutation.transactionId : item.transaction.id !== mutation.transactionId);
      filteredQueue.push(mutation);
      this.saveOfflineQueue(uid, filteredQueue);
      return filteredQueue;
    },

    appendQuarantine(uid, entries) {
      if (!entries.length) {
        return [];
      }
      const storageKey = `${QUARANTINE_STORAGE_KEY}-${uid || "anonymous"}`;
      const existing = safeJsonParse(localStorage.getItem(storageKey), []);
      const next = [...existing, ...entries].slice(-200);
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    },

    dumpTransactionsBackup(uid, transactions, reason = "manual") {
      const storageKey = `${BACKUP_STORAGE_KEY}-${uid || "anonymous"}`;
      const existing = safeJsonParse(localStorage.getItem(storageKey), []);
      const next = [...existing, {
        createdAt: new Date().toISOString(),
        reason,
        count: transactions.length,
        transactions,
      }].slice(-10);
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next.at(-1);
    },
  };
}

function toFirestorePayload(transaction) {
  const { id, ...payload } = transaction;
  return payload;
}

function safeJsonParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    console.error("localStorage 데이터를 해석하지 못했습니다.", error);
    return fallback;
  }
}

function getMigrationCompletedKey(uid) {
  return `${MIGRATION_COMPLETED_KEY}-${uid}`;
}

function getOfflineQueueKey(uid) {
  return uid ? `${OFFLINE_QUEUE_KEY}-${uid}` : "";
}

function hasSameQueuedTransactionIdentity(left, right) {
  const leftIdentity = left?.clientId || left?.id || "";
  const rightIdentity = right?.clientId || right?.id || "";
  return Boolean(leftIdentity && rightIdentity && leftIdentity === rightIdentity);
}
