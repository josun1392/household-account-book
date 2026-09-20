export const USERS_COLLECTION = "users";
export const TRANSACTIONS_COLLECTION = "transactions";
export const RECURRING_ITEMS_COLLECTION = "recurringItems";
export const RECURRING_OCCURRENCE_SKIPS_COLLECTION = "recurringOccurrenceSkips";
export const LEGACY_TRANSACTIONS_STORAGE_KEY = "household-account-book-transactions";
export const MIGRATION_COMPLETED_KEY = "household-account-book-migration-completed";
export const OFFLINE_QUEUE_KEY = "household-account-book-offline-queue";
export const QUARANTINE_STORAGE_KEY = "household-account-book-quarantine";
export const BACKUP_STORAGE_KEY = "household-account-book-backup";
export const ITEMS_PER_PAGE = 20;

export const categoriesByType = {
  expense: ["식비", "카페", "교통", "쇼핑", "취미", "구독", "생활", "기타"],
  income: ["급여", "용돈", "프리랜서", "상금", "기타"],
};

export const expenseChartColors = [
  "#bb4d32",
  "#d67436",
  "#d99849",
  "#b88657",
  "#8f6f5c",
  "#c15f6b",
  "#9d6a94",
  "#6f7fa8",
];

export const incomeChartColors = ["#1f7a53", "#2f8f66", "#4b9d74", "#78b159", "#9abf74"];
export const savingsChartColors = ["#2b8c88", "#3c9fa0", "#58b2b3", "#6da8c9", "#7db7a6"];

export const statisticsFlowColors = {
  income: incomeChartColors[0],
  expense: expenseChartColors[0],
  savings: savingsChartColors[0],
  balance: "#2e5fa8",
};

export const firebaseConfig = {
  apiKey: "AIzaSyBprb4PTolR3gnPmJz9H9l102ybhcAnxCI",
  authDomain: "household-account-book-27aea.firebaseapp.com",
  projectId: "household-account-book-27aea",
  storageBucket: "household-account-book-27aea.firebasestorage.app",
  messagingSenderId: "435641439237",
  appId: "1:435641439237:web:664705f5e948d78094f86c",
  measurementId: "G-HLF7NTHP51",
};
