import { initializeApp as initializeFirebaseApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { addDoc, collection, deleteDoc, doc, getDocs, getFirestore, runTransaction, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
const USERS_COLLECTION = "users";
const TRANSACTIONS_COLLECTION = "transactions";
const RECURRING_ITEMS_COLLECTION = "recurringItems";
const RECURRING_OCCURRENCE_SKIPS_COLLECTION = "recurringOccurrenceSkips";
const LEGACY_TRANSACTIONS_STORAGE_KEY = "household-account-book-transactions";
const MIGRATION_COMPLETED_KEY = "household-account-book-migration-completed";
const OFFLINE_QUEUE_KEY = "household-account-book-offline-queue";

const categoriesByType = {
  expense: [
    "식비",
    "카페",
    "교통",
    "쇼핑",
    "취미",
    "구독",
    "생활",
    "기타",
  ],
  income: [
    "급여",
    "용돈",
    "프리랜서",
    "상금",
    "기타",
  ],
};

const expenseChartColors = [
  "#bb4d32",
  "#d07a2a",
  "#dfb04a",
  "#6e9a3d",
  "#2f8f83",
  "#4a7fc9",
  "#7355b6",
  "#a95d8f",
];

const incomeChartColors = [
  "#1f7a53",
  "#3f9b73",
  "#78b159",
  "#2f8f83",
  "#4a7fc9",
];

const form = document.getElementById("transactionForm");
const dateInput = document.getElementById("date");
const todayButton = document.getElementById("todayButton");
const typeInput = document.getElementById("type");
const amountInput = document.getElementById("amount");
const categoryInput = document.getElementById("category");
const memoInput = document.getElementById("memo");
const isFixedInput = document.getElementById("isFixed");
const transactionList = document.getElementById("transactionList");
const transactionCount = document.getElementById("transactionCount");
const transactionTypeFilterInput = document.getElementById("transactionTypeFilter");
const transactionSortInput = document.getElementById("transactionSort");
const transactionSearchInput = document.getElementById("transactionSearch");
const exportCsvButton = document.getElementById("exportCsvButton");
const exportJsonButton = document.getElementById("exportJsonButton");
const emptyState = document.getElementById("emptyState");
const summarySection = document.getElementById("summary");
const formEyebrow = document.getElementById("formEyebrow");
const formStatus = document.getElementById("formStatus");
const submitButton = document.getElementById("submitButton");
const cancelEditButton = document.getElementById("cancelEditButton");
const statisticsTypeInput = document.getElementById("statisticsType");
const statisticsEmpty = document.getElementById("statisticsEmpty");
const statisticsList = document.getElementById("statisticsList");
const pieChart = document.getElementById("pieChart");
const chartTitle = document.getElementById("chartTitle");
const chartTotal = document.getElementById("chartTotal");
const totalIncomeElement = document.getElementById("totalIncome");
const totalFixedIncomeElement = document.getElementById("totalFixedIncome");
const totalExpenseElement = document.getElementById("totalExpense");
const fixedExpenseRatioElement = document.getElementById("fixedExpenseRatio");
const balanceElement = document.getElementById("balance");
const totalFixedExpenseElement = document.getElementById("totalFixedExpense");
const totalVariableExpenseElement = document.getElementById("totalVariableExpense");
const monthFilterInput = document.getElementById("monthFilter");
const selectedPeriodLabel = document.getElementById("selectedPeriodLabel");
const periodToggleButton = document.getElementById("periodToggleButton");
const periodSelectionPanel = document.getElementById("periodSelectionPanel");
const allTimeButton = document.getElementById("allTimeButton");
const thisMonthButton = document.getElementById("thisMonthButton");
const prevYearButton = document.getElementById("prevYearButton");
const nextYearButton = document.getElementById("nextYearButton");
const periodMonthGrid = document.getElementById("periodMonthGrid");
const periodPanelYearLabel = document.getElementById("periodPanelYearLabel");
const summaryModal = document.getElementById("summaryModal");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
const modalTotal = document.getElementById("modalTotal");
const modalCloseButton = document.getElementById("modalCloseButton");
const syncStatusBanner = document.getElementById("syncStatusBanner");
const appMessage = document.getElementById("appMessage");
const authGate = document.getElementById("authGate");
const authBar = document.getElementById("authBar");
const authGateSignInButton = document.getElementById("authGateSignInButton");
const authStatusText = document.getElementById("authStatusText");
const signOutButton = document.getElementById("signOutButton");
const recurringItemsButton = document.getElementById("recurringItemsButton");
const recurringItemsModal = document.getElementById("recurringItemsModal");
const recurringModalCloseButton = document.getElementById("recurringModalCloseButton");
const recurringItemForm = document.getElementById("recurringItemForm");
const recurringFormTitle = document.getElementById("recurringFormTitle");
const recurringNameInput = document.getElementById("recurringName");
const recurringTypeInput = document.getElementById("recurringType");
const recurringAmountInput = document.getElementById("recurringAmount");
const recurringCategoryInput = document.getElementById("recurringCategory");
const recurringKindInput = document.getElementById("recurringKind");
const recurringDayOfMonthInput = document.getElementById("recurringDayOfMonth");
const recurringStartDateInput = document.getElementById("recurringStartDate");
const recurringMemoInput = document.getElementById("recurringMemo");
const recurringIsActiveInput = document.getElementById("recurringIsActive");
const recurringSubmitButton = document.getElementById("recurringSubmitButton");
const cancelRecurringEditButton = document.getElementById("cancelRecurringEditButton");
const recurringItemsList = document.getElementById("recurringItemsList");
const recurringItemCount = document.getElementById("recurringItemCount");

let transactions = [];
let recurringItems = [];
let editingTransactionId = null;
let editingRecurringItemId = null;
let isSyncingOfflineTransactions = false;
let isMaterializingRecurringOccurrences = false;
let messageTimeoutId = null;
let syncStatusTimeoutId = null;
let currentTypeFilter = "all";
let currentSortOption = "latest";
let pendingDeleteState = null;
let currentUser = null;
let hasBoundEventListeners = false;

const periodState = {
  value: "all",
  isPanelOpen: false,
  panelYear: getCurrentYear(),
};

async function initializeBudgetApp() {
  bindEventListeners();
  dateInput.value = getTodayString();
  updateCategoryOptions(typeInput.value);
  updateAuthUI();

  if (!currentUser) {
    setAuthenticatedUIState(false);
    updateSyncStatus();
    render();
    return;
  }

  setAuthenticatedUIState(true);
  updateSyncStatus();
  await hydrateTransactionsFromFirestore();
  await hydrateRecurringItemsFromFirestore();
  if (transactions.length === 0) {
    await migrateLegacyLocalStorageToFirestore();
    await hydrateTransactionsFromFirestore();
  }
  applyOfflineQueueToTransactions();
  if (navigator.onLine) {
    await syncOfflineTransactions();
    await hydrateTransactionsFromFirestore();
    const materializationResult = await materializeDueRecurringOccurrences();
    if (materializationResult.createdCount > 0) {
      await hydrateTransactionsFromFirestore();
    }
  }
  syncMonthFilterOptions();
  setPeriodValue("all", { closePanel: false, skipRender: true });
  render();
}

function bindEventListeners() {
  if (hasBoundEventListeners) {
    return;
  }

  typeInput.addEventListener("change", handleTypeChange);
  form.addEventListener("submit", handleSubmit);
  amountInput.addEventListener("input", handleAmountInput);
  todayButton.addEventListener("click", handleTodayButtonClick);
  cancelEditButton.addEventListener("click", resetForm);
  transactionTypeFilterInput.addEventListener("change", handleTransactionTypeFilterChange);
  transactionSortInput.addEventListener("change", handleTransactionSortChange);
  transactionSearchInput.addEventListener("input", render);
  exportCsvButton.addEventListener("click", handleExportCsv);
  exportJsonButton.addEventListener("click", handleExportJson);
  statisticsTypeInput.addEventListener("change", renderStatistics);
  monthFilterInput.addEventListener("change", handleNativeMonthFilterChange);
  periodToggleButton.addEventListener("click", togglePeriodPanel);
  allTimeButton.addEventListener("click", () => setPeriodValue("all"));
  thisMonthButton.addEventListener("click", handleThisMonthClick);
  prevYearButton.addEventListener("click", () => changePanelYear(-1));
  nextYearButton.addEventListener("click", () => changePanelYear(1));
  periodMonthGrid.addEventListener("click", handlePeriodMonthClick);
  recurringItemsButton.addEventListener("click", openRecurringItemsModal);
  recurringModalCloseButton.addEventListener("click", closeRecurringItemsModal);
  recurringItemsModal.addEventListener("click", handleRecurringModalOverlayClick);
  recurringItemForm.addEventListener("submit", handleRecurringItemSubmit);
  recurringTypeInput.addEventListener("change", handleRecurringTypeChange);
  recurringKindInput.addEventListener("change", handleRecurringKindChange);
  recurringAmountInput.addEventListener("input", handleAmountInput);
  cancelRecurringEditButton.addEventListener("click", resetRecurringItemForm);
  recurringItemsList.addEventListener("click", handleRecurringItemAction);
  transactionList.addEventListener("click", handleTransactionAction);
  appMessage.addEventListener("click", handleAppMessageClick);
  summarySection.addEventListener("click", handleSummaryCardClick);
  summarySection.addEventListener("keydown", handleSummaryCardKeydown);
  summaryModal.addEventListener("click", handleModalOverlayClick);
  modalCloseButton.addEventListener("click", closeSummaryModal);
  document.addEventListener("keydown", handleDocumentKeydown);
  window.addEventListener("online", handleOnlineStatusChange);
  window.addEventListener("offline", handleOfflineStatusChange);
  signOutButton.addEventListener("click", handleSignOutClick);
  authGateSignInButton.addEventListener("click", handleSignInClick);

  hasBoundEventListeners = true;
}

function handleTypeChange() {
  updateCategoryOptions(typeInput.value);
}

function getCurrentUserId() {
  return currentUser?.uid ?? "";
}

function getUserTransactionsCollection(uid = getCurrentUserId()) {
  return collection(db, USERS_COLLECTION, uid, TRANSACTIONS_COLLECTION);
}

function getUserTransactionDocRef(transactionId, uid = getCurrentUserId()) {
  return doc(db, USERS_COLLECTION, uid, TRANSACTIONS_COLLECTION, transactionId);
}

function getUserRecurringItemsCollection(uid = getCurrentUserId()) {
  return collection(db, USERS_COLLECTION, uid, RECURRING_ITEMS_COLLECTION);
}

function getUserRecurringItemDocRef(recurringItemId, uid = getCurrentUserId()) {
  return doc(db, USERS_COLLECTION, uid, RECURRING_ITEMS_COLLECTION, recurringItemId);
}

function getUserRecurringOccurrenceSkipsCollection(uid = getCurrentUserId()) {
  return collection(db, USERS_COLLECTION, uid, RECURRING_OCCURRENCE_SKIPS_COLLECTION);
}

function getUserRecurringOccurrenceSkipDocRef(recurringItemId, occurrenceKey, uid = getCurrentUserId()) {
  return doc(
    db,
    USERS_COLLECTION,
    uid,
    RECURRING_OCCURRENCE_SKIPS_COLLECTION,
    getRecurringOccurrenceSkipId(recurringItemId, occurrenceKey),
  );
}

function getMigrationCompletedKey() {
  return `${MIGRATION_COMPLETED_KEY}-${getCurrentUserId()}`;
}

function getOfflineQueueKey(uid = getCurrentUserId()) {
  return uid ? `${OFFLINE_QUEUE_KEY}-${uid}` : "";
}

function updateAuthUI() {
  if (!authStatusText || !signOutButton || !authGate || !authBar || !authGateSignInButton) {
    return;
  }

  if (!currentUser) {
    authStatusText.textContent = "로그인이 필요합니다";
    authBar.classList.add("hidden");
    authGate.classList.remove("hidden");
    document.body.classList.add("auth-locked");
    signOutButton.classList.add("hidden");
    authGateSignInButton.disabled = false;
    return;
  }

  authStatusText.textContent = `${currentUser.displayName ?? currentUser.email ?? "사용자"} 로그인됨`;
  authBar.classList.remove("hidden");
  authGate.classList.add("hidden");
  document.body.classList.remove("auth-locked");
  signOutButton.classList.remove("hidden");
}

function setAuthenticatedUIState(isAuthenticated) {
  [
    ...form.querySelectorAll("input, select, button"),
    transactionTypeFilterInput,
    transactionSortInput,
    transactionSearchInput,
    statisticsTypeInput,
    exportCsvButton,
    exportJsonButton,
    periodToggleButton,
    allTimeButton,
    thisMonthButton,
    prevYearButton,
    nextYearButton,
    recurringItemsButton,
  ].forEach((element) => {
    element.disabled = !isAuthenticated;
  });
}

function clearPendingDeleteState() {
  if (!pendingDeleteState) {
    return;
  }

  clearTimeout(pendingDeleteState.timerId);
  pendingDeleteState = null;
}

function resetTransactionsState() {
  transactions = [];
  recurringItems = [];
  editingTransactionId = null;
  resetRecurringItemForm();
  closeRecurringItemsModal();
  currentTypeFilter = "all";
  currentSortOption = "latest";
  clearPendingDeleteState();
  transactionTypeFilterInput.value = "all";
  transactionSortInput.value = "latest";
  transactionSearchInput.value = "";
  resetForm();
}

async function handleSignInClick() {
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    console.error("Google 로그인에 실패했습니다.", error);
    showError("로그인에 실패했습니다");
  }
}

async function handleSignOutClick() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("로그아웃에 실패했습니다.", error);
    showError("로그아웃에 실패했습니다");
  }
}

async function handleAuthStateChange(user) {
  currentUser = user;
  resetTransactionsState();
  hideMessage();
  await initializeBudgetApp();
}

async function handleSubmit(event) {
  event.preventDefault();

  if (!currentUser) {
    showError("로그인 후 이용해 주세요");
    return;
  }

  const amount = parseAmountInputValue(amountInput.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    amountInput.focus();
    return;
  }

  const existingTransaction = editingTransactionId
    ? transactions.find((currentTransaction) => currentTransaction.id === editingTransactionId)
    : null;
  const clientId = existingTransaction?.clientId ?? (editingTransactionId ? undefined : createTransactionId());
  const transaction = {
    id: editingTransactionId ?? clientId,
    date: dateInput.value,
    type: typeInput.value,
    amount,
    category: categoryInput.value,
    memo: memoInput.value.trim(),
    isFixed: isFixedInput.checked,
    userId: existingTransaction?.userId ?? getCurrentUserId(),
    ...(clientId ? { clientId } : {}),
    ...(existingTransaction?.source ? {
      source: existingTransaction.source,
      ...(typeof existingTransaction.recurringItemId === "string" ? { recurringItemId: existingTransaction.recurringItemId } : {}),
      ...(typeof existingTransaction.occurrenceKey === "string" ? { occurrenceKey: existingTransaction.occurrenceKey } : {}),
    } : {}),
  };

  if (!navigator.onLine) {
    if (editingTransactionId) {
      transactions = transactions.map((currentTransaction) =>
        currentTransaction.id === editingTransactionId ? transaction : currentTransaction,
      );
      queueOfflineMutation({ type: "update", transaction });
    } else {
      transactions.push(transaction);
      queueOfflineMutation({ type: "create", transaction });
    }

    syncMonthFilterOptions();
    render();
    resetForm();
    showSuccess("\uC624\uD504\uB77C\uC778 \uC0C1\uD0DC\uB85C \uC784\uC2DC \uC800\uC7A5\uB418\uC5C8\uC2B5\uB2C8\uB2E4");
    return;
  }

  if (editingTransactionId) {
    try {
      await updateDoc(
        getUserTransactionDocRef(editingTransactionId),
        getFirestoreTransactionPayload(transaction),
      );
      transactions = transactions.map((currentTransaction) =>
        currentTransaction.id === editingTransactionId ? transaction : currentTransaction,
      );
      showSuccess("\uC218\uC815\uB418\uC5C8\uC2B5\uB2C8\uB2E4");
    } catch (error) {
      console.error("Firestore에서 거래 데이터를 수정하지 못했습니다.", error);
      showError("\uC800\uC7A5\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4");
      return;
    }
  } else {
    try {
      const docRef = await addDoc(
        getUserTransactionsCollection(),
        getFirestoreTransactionPayload(transaction),
      );
      transaction.id = docRef.id;
      transactions.push(transaction);
      showSuccess("\uC800\uC7A5\uB418\uC5C8\uC2B5\uB2C8\uB2E4");
    } catch (error) {
      console.error("Firestore에 거래 데이터를 추가하지 못했습니다.", error);
      showError("\uC800\uC7A5\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4");
      return;
    }
  }

  syncMonthFilterOptions();
  render();
  resetForm();
}

function handleAmountInput(event) {
  const input = event.target;
  const digitsBeforeCursor = countDigits(input.value.slice(0, input.selectionStart ?? 0));
  const numericValue = extractDigits(input.value);

  input.value = numericValue ? formatNumberWithCommas(numericValue) : "";

  const nextCursorPosition = getCursorPositionFromDigitIndex(input.value, digitsBeforeCursor);
  input.setSelectionRange(nextCursorPosition, nextCursorPosition);
}

function handleTodayButtonClick() {
  dateInput.value = getTodayString();
}

function handleNativeMonthFilterChange() {
  setPeriodValue(monthFilterInput.value, { closePanel: false });
}

function handleTransactionTypeFilterChange() {
  currentTypeFilter = transactionTypeFilterInput.value || "all";
  render();
}

function handleTransactionSortChange() {
  currentSortOption = transactionSortInput.value || "latest";
  render();
}

function handleExportCsv() {
  const rows = getExportRows();
  const header = ["id", "clientId", "date", "type", "amount", "category", "memo", "isFixed", "source", "recurringItemId", "occurrenceKey"];
  const csvContent = [
    header.join(","),
    ...rows.map((row) => header.map((field) => escapeCsvValue(row[field])).join(",")),
  ].join("\r\n");

  downloadFile({
    content: csvContent,
    fileName: `household-account-book-${getTodayString()}.csv`,
    mimeType: "text/csv;charset=utf-8",
  });
}

function handleExportJson() {
  const rows = getExportRows();
  const jsonContent = JSON.stringify(rows, null, 2);

  downloadFile({
    content: jsonContent,
    fileName: `household-account-book-${getTodayString()}.json`,
    mimeType: "application/json;charset=utf-8",
  });
}

function togglePeriodPanel() {
  if (!periodState.isPanelOpen) {
    syncPanelYearToCurrentSelection();
  }

  periodState.isPanelOpen = !periodState.isPanelOpen;
  syncPeriodUI();
}

function handleThisMonthClick() {
  const currentMonthValue = getCurrentMonthValue();
  periodState.panelYear = Number(currentMonthValue.split("-")[0]);
  setPeriodValue(currentMonthValue);
}

function changePanelYear(delta) {
  periodState.panelYear += delta;
  syncPeriodUI();
}

function handlePeriodMonthClick(event) {
  const button = event.target.closest("[data-period-value]");
  if (!button) {
    return;
  }

  setPeriodValue(button.dataset.periodValue);
}

function setPeriodValue(value, options = {}) {
  const { closePanel = true, skipRender = false } = options;
  const nextValue = value || "all";

  periodState.value = nextValue;
  syncPanelYearToCurrentSelection();
  monthFilterInput.value = nextValue;

  if (closePanel) {
    periodState.isPanelOpen = false;
  }

  syncMonthFilterOptions();
  syncPeriodUI();

  if (!skipRender) {
    render();
  }
}

function syncPanelYearToCurrentSelection() {
  periodState.panelYear = periodState.value === "all"
    ? getCurrentYear()
    : Number(periodState.value.split("-")[0]);
}

function syncPeriodUI() {
  selectedPeriodLabel.textContent = getSelectedPeriodLabel();
  periodToggleButton.textContent = periodState.isPanelOpen ? "기간 닫기" : "기간 선택";
  periodToggleButton.setAttribute("aria-expanded", String(periodState.isPanelOpen));
  periodSelectionPanel.classList.toggle("hidden", !periodState.isPanelOpen);
  periodPanelYearLabel.textContent = `${periodState.panelYear}년`;
  allTimeButton.classList.toggle("is-active", periodState.value === "all");
  thisMonthButton.classList.toggle("is-active", periodState.value === getCurrentMonthValue());
  renderPeriodMonthButtons();
}

function renderPeriodMonthButtons() {
  periodMonthGrid.innerHTML = Array.from({ length: 12 }, (_, index) => {
    const monthNumber = index + 1;
    const monthValue = `${periodState.panelYear}-${String(monthNumber).padStart(2, "0")}`;
    const isActive = monthValue === periodState.value;

    return `
      <button
        type="button"
        class="month-chip-button${isActive ? " is-active" : ""}"
        data-period-value="${monthValue}"
      >
        ${monthNumber}월
      </button>
    `;
  }).join("");
}

function getSelectedPeriodLabel() {
  return periodState.value === "all"
    ? "전체 기간"
    : formatMonthLabel(periodState.value);
}

function render() {
  syncMonthFilterOptions();
  syncPeriodUI();
  renderSummary();
  renderStatistics();
  renderTransactions();
}

function renderSummary() {
  const visibleTransactions = getVisibleTransactions();
  const totals = calculateSummaryTotals(visibleTransactions);
  const balance = totals.income - totals.expense;
  const variableExpense = totals.expense - totals.fixedExpense;
  const fixedExpenseRatio = totals.expense === 0
    ? "-"
    : `${Math.round((totals.fixedExpense / totals.expense) * 100)}%`;

  totalIncomeElement.textContent = formatAmount(totals.income);
  totalFixedIncomeElement.textContent = formatAmount(totals.fixedIncome);
  totalExpenseElement.textContent = formatAmount(totals.expense);
  fixedExpenseRatioElement.textContent = `고정비 비율: ${fixedExpenseRatio}`;
  balanceElement.textContent = formatAmount(balance);
  totalFixedExpenseElement.textContent = formatAmount(totals.fixedExpense);
  totalVariableExpenseElement.textContent = formatAmount(variableExpense);
}

function renderTransactions() {
  const visibleTransactions = getVisibleTransactions();
  const hasAnyTransactions = transactions.length > 0;
  const searchKeyword = transactionSearchInput.value.trim();
  const hasTransactions = visibleTransactions.length > 0;

  if (!currentUser) {
    emptyState.classList.remove("hidden");
    emptyState.innerHTML = "<p>Google 계정으로 로그인하면 거래 내역을 불러올 수 있습니다.</p>";
    transactionCount.textContent = "0건";
    transactionList.innerHTML = "";
    return;
  }

  emptyState.classList.toggle("hidden", hasTransactions);
  emptyState.innerHTML = hasAnyTransactions
    ? `<p>${searchKeyword ? `‘${escapeHtml(searchKeyword)}’에 대한 검색 결과가 없습니다.` : "검색 결과가 없습니다."}</p>`
    : "<p>거래 내역이 아직 없습니다. 위에서 첫 수입 또는 지출을 추가해 보세요.</p>";
  transactionCount.textContent = `${visibleTransactions.length}건`;

  if (!hasTransactions) {
    transactionList.innerHTML = "";
    return;
  }

  transactionList.innerHTML = visibleTransactions
    .map(
      (transaction) => `
        <tr>
          <td>${escapeHtml(transaction.date)}</td>
          <td>
            <span class="type-pill type-pill-${transaction.type}">
              ${transaction.type === "income" ? "수입" : "지출"}
            </span>
          </td>
          <td>${escapeHtml(transaction.category)}</td>
          <td>${transaction.isFixed ? "고정" : "-"}</td>
          <td class="amount-${transaction.type}">
            ${transaction.type === "income" ? "+" : "-"}${formatAmount(transaction.amount)}
          </td>
          <td>${transaction.memo ? escapeHtml(transaction.memo) : "-"}</td>
          <td>
            <button type="button" class="edit-button" data-edit-id="${transaction.id}">
              수정
            </button>
            <button type="button" class="delete-button" data-delete-id="${transaction.id}">
              삭제
            </button>
          </td>
        </tr>
      `,
    )
    .join("");
}

function renderStatistics() {
  const statisticType = statisticsTypeInput.value;
  const visibleTransactions = getVisibleTransactions();

  if (statisticType === "all") {
    renderOverallStatistics(visibleTransactions);
    return;
  }

  const title = statisticType === "income" ? "수입" : "지출";
  const groupedStatistics = getCategoryStatistics(statisticType, visibleTransactions);
  const totalAmount = groupedStatistics.reduce((sum, item) => sum + item.amount, 0);

  chartTitle.textContent = title;
  chartTotal.textContent = formatAmount(totalAmount);
  statisticsEmpty.textContent = "선택한 유형에 대한 데이터가 아직 없습니다.";

  if (groupedStatistics.length === 0) {
    pieChart.style.background = "conic-gradient(#d8d1c6 0deg 360deg)";
    statisticsEmpty.classList.remove("hidden");
    statisticsList.classList.add("hidden");
    statisticsList.innerHTML = "";
    return;
  }

  pieChart.style.background = buildChartGradient(groupedStatistics, totalAmount);
  statisticsEmpty.classList.add("hidden");
  statisticsList.classList.remove("hidden");
  statisticsList.innerHTML = groupedStatistics
    .map(
      (item) => `
        <li class="statistics-item">
          <span class="statistics-swatch" style="background:${item.color}"></span>
          <span class="statistics-category">${escapeHtml(item.category)}</span>
          <span class="statistics-share">${item.share}%</span>
          <span class="statistics-amount">${formatAmount(item.amount)}</span>
        </li>
      `,
    )
    .join("");
}

function renderOverallStatistics(items) {
  const totals = calculateSummaryTotals(items);
  const totalFlow = totals.income + totals.expense;
  const balance = totals.income - totals.expense;
  const overallStatistics = [
    {
      category: "총수입",
      amount: totals.income,
      color: incomeChartColors[0],
      shareText: totalFlow > 0 ? `${Math.round((totals.income / totalFlow) * 100)}%` : "-",
    },
    {
      category: "총지출",
      amount: totals.expense,
      color: expenseChartColors[0],
      shareText: totalFlow > 0 ? `${Math.round((totals.expense / totalFlow) * 100)}%` : "-",
    },
    {
      category: "잔액",
      amount: balance,
      color: "#2e4f8f",
      shareText: "",
    },
  ];

  chartTitle.textContent = "전체";
  chartTotal.textContent = formatAmount(totalFlow);

  if (totals.income === 0 && totals.expense === 0) {
    pieChart.style.background = "conic-gradient(#d8d1c6 0deg 360deg)";
    statisticsEmpty.textContent = "선택한 기간에 수입과 지출 데이터가 없습니다.";
    statisticsEmpty.classList.remove("hidden");
    statisticsList.classList.add("hidden");
    statisticsList.innerHTML = "";
    return;
  }

  pieChart.style.background = buildChartGradient(
    overallStatistics.filter((item) => item.category !== "잔액" && item.amount > 0),
    totalFlow,
  );
  statisticsEmpty.classList.add("hidden");
  statisticsList.classList.remove("hidden");
  statisticsList.innerHTML = overallStatistics
    .map(
      (item) => `
        <li class="statistics-item">
          <span class="statistics-swatch" style="background:${item.color}"></span>
          <span class="statistics-category">${item.category}</span>
          <span class="statistics-share">${item.shareText}</span>
          <span class="statistics-amount">${formatAmount(item.amount)}</span>
        </li>
      `,
    )
    .join("");
}

function handleSummaryCardClick(event) {
  const card = event.target.closest("[data-summary-type]");
  if (!card) {
    return;
  }

  openSummaryModal(card.dataset.summaryType);
}

function handleSummaryCardKeydown(event) {
  const card = event.target.closest("[data-summary-type]");
  if (!card) {
    return;
  }

  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openSummaryModal(card.dataset.summaryType);
  }
}

function openSummaryModal(summaryType) {
  const visibleTransactions = getVisibleTransactions();
  const totals = calculateSummaryTotals(visibleTransactions);
  const modalConfig = getSummaryModalConfig(summaryType, visibleTransactions, totals);

  modalTitle.textContent = modalConfig.title;
  modalTotal.textContent = formatAmount(modalConfig.total);

  if (modalConfig.kind === "balance") {
    modalBody.innerHTML = `
      <div class="modal-balance-box">
        <p>잔액 = 총수입 - 총지출</p>
        <div class="modal-balance-row">
          <span>총수입</span>
          <strong>${formatAmount(totals.income)}</strong>
        </div>
        <div class="modal-balance-row">
          <span>총지출</span>
          <strong>${formatAmount(totals.expense)}</strong>
        </div>
        <div class="modal-balance-row">
          <span>잔액</span>
          <strong>${formatAmount(totals.income - totals.expense)}</strong>
        </div>
      </div>
    `;
  } else if (modalConfig.transactions.length === 0) {
    modalBody.innerHTML = '<div class="modal-empty">현재 필터 기준으로 해당 내역이 없습니다.</div>';
  } else {
    modalBody.innerHTML = `
      <div class="modal-transaction-list">
        <div class="modal-transaction-head">
          <span>날짜</span>
          <span>카테고리</span>
          <span>메모</span>
          <span>금액</span>
        </div>
        ${modalConfig.transactions.map(renderModalTransactionItem).join("")}
      </div>
    `;
  }

  summaryModal.classList.remove("hidden");
  summaryModal.setAttribute("aria-hidden", "false");
}

function closeSummaryModal() {
  summaryModal.classList.add("hidden");
  summaryModal.setAttribute("aria-hidden", "true");
}

function handleModalOverlayClick(event) {
  if (event.target === summaryModal) {
    closeSummaryModal();
  }
}

function handleDocumentKeydown(event) {
  if (event.key === "Escape") {
    if (!summaryModal.classList.contains("hidden")) {
      closeSummaryModal();
      return;
    }

    if (!recurringItemsModal.classList.contains("hidden")) {
      closeRecurringItemsModal();
      return;
    }

    if (periodState.isPanelOpen) {
      periodState.isPanelOpen = false;
      syncPeriodUI();
    }
  }
}

function openRecurringItemsModal() {
  if (!currentUser) {
    showError("로그인 후 이용해 주세요");
    return;
  }

  renderRecurringItems();
  recurringItemsModal.classList.remove("hidden");
  recurringItemsModal.setAttribute("aria-hidden", "false");
}

function closeRecurringItemsModal() {
  recurringItemsModal.classList.add("hidden");
  recurringItemsModal.setAttribute("aria-hidden", "true");
}

function handleRecurringModalOverlayClick(event) {
  if (event.target === recurringItemsModal) {
    closeRecurringItemsModal();
  }
}

function handleRecurringTypeChange() {
  updateRecurringCategoryOptions(recurringTypeInput.value);
}

function handleRecurringKindChange() {
  if (recurringKindInput.value === "subscription" && recurringTypeInput.value === "expense") {
    updateRecurringCategoryOptions("expense", "구독");
  }
}

function updateRecurringCategoryOptions(type, selectedCategory = "") {
  const categories = categoriesByType[type] ?? [];
  const categoryOptions = selectedCategory && !categories.includes(selectedCategory)
    ? [...categories, selectedCategory]
    : categories;
  recurringCategoryInput.innerHTML = categoryOptions
    .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
    .join("");
  recurringCategoryInput.value = selectedCategory || (recurringKindInput.value === "subscription" && type === "expense" ? "구독" : categoryOptions[0] ?? "");
}

async function handleRecurringItemSubmit(event) {
  event.preventDefault();
  if (!currentUser) {
    showError("로그인 후 이용해 주세요");
    return;
  }
  if (!navigator.onLine) {
    showError("고정 항목 관리는 온라인에서만 변경할 수 있습니다");
    return;
  }

  const recurringItem = getRecurringItemFromForm();
  if (!recurringItem) {
    return;
  }

  try {
    if (editingRecurringItemId) {
      await updateDoc(
        getUserRecurringItemDocRef(editingRecurringItemId),
        getFirestoreRecurringItemPayload(recurringItem, false),
      );
      recurringItems = recurringItems.map((item) => item.id === editingRecurringItemId
        ? { ...recurringItem, id: editingRecurringItemId }
        : item);
      showSuccess("고정 항목 설정이 수정되었습니다. 기존 거래 내역은 변경되지 않습니다.");
    } else {
      const docRef = await addDoc(
        getUserRecurringItemsCollection(),
        getFirestoreRecurringItemPayload(recurringItem, true),
      );
      recurringItems.push({ ...recurringItem, id: docRef.id });
      showSuccess("고정 항목 설정이 저장되었습니다");
    }
    resetRecurringItemForm();
    renderRecurringItems();
  } catch (error) {
    console.error("Firestore에서 고정 항목 설정을 저장하지 못했습니다.", error);
    showError("고정 항목 설정 저장에 실패했습니다");
  }
}

function getRecurringItemFromForm() {
  const name = recurringNameInput.value.trim();
  const amount = parseAmountInputValue(recurringAmountInput.value);
  const dayOfMonth = Number(recurringDayOfMonthInput.value);
  const startDate = recurringStartDateInput.value;
  if (!name) {
    recurringNameInput.focus();
    return null;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    recurringAmountInput.focus();
    return null;
  }
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
    recurringDayOfMonthInput.focus();
    showError("결제 / 발생일은 1일부터 31일 사이여야 합니다");
    return null;
  }
  if (!startDate) {
    recurringStartDateInput.focus();
    return null;
  }

  return {
    name,
    type: recurringTypeInput.value,
    amount,
    category: recurringCategoryInput.value,
    memo: recurringMemoInput.value.trim(),
    recurrence: "monthly",
    dayOfMonth,
    isActive: recurringIsActiveInput.checked,
    kind: recurringKindInput.value,
    startDate,
  };
}

function getFirestoreRecurringItemPayload(item, isNew) {
  const timestamp = new Date().toISOString();
  return {
    ...item,
    updatedAt: timestamp,
    ...(isNew ? { createdAt: timestamp } : {}),
  };
}

function renderRecurringItems() {
  recurringItemCount.textContent = `${recurringItems.length}개`;
  if (recurringItems.length === 0) {
    recurringItemsList.innerHTML = '<div class="recurring-empty">등록된 고정 항목이 없습니다. 이 설정은 거래 내역을 자동으로 만들지 않습니다.</div>';
    return;
  }
  recurringItemsList.innerHTML = [...recurringItems]
    .sort((left, right) => left.name.localeCompare(right.name, "ko"))
    .map((item) => {
      const kindLabel = item.kind === "subscription" ? "구독" : "일반 고정";
      const stateLabel = item.isActive ? "활성" : "일시정지";
      return `
        <article class="recurring-item-card ${item.isActive ? "" : "is-paused"}">
          <div class="recurring-item-top">
            <strong class="recurring-item-name">${escapeHtml(item.name)}</strong>
            <span class="recurring-state-pill ${item.isActive ? "is-active" : "is-paused"}">${stateLabel}</span>
          </div>
          <div class="recurring-item-meta">
            <span class="type-pill type-pill-${item.type}">${item.type === "income" ? "수입" : "지출"}</span>
            <span class="recurring-kind-pill">${kindLabel}</span>
            <span>매월 ${item.dayOfMonth}일</span>
            <strong class="amount-${item.type}">${item.type === "income" ? "+" : "-"}${formatAmount(item.amount)}</strong>
          </div>
          <div class="recurring-item-meta"><span>${escapeHtml(item.category)}</span><span>${item.memo ? escapeHtml(item.memo) : "메모 없음"}</span></div>
          <div class="recurring-item-actions">
            <button type="button" class="secondary-button" data-recurring-edit-id="${item.id}">수정</button>
            <button type="button" class="secondary-button" data-recurring-toggle-id="${item.id}">${item.isActive ? "일시정지" : "재개"}</button>
            <button type="button" class="delete-button" data-recurring-delete-id="${item.id}">삭제</button>
          </div>
        </article>`;
    }).join("");
}

async function handleRecurringItemAction(event) {
  const actionButton = event.target.closest("[data-recurring-edit-id], [data-recurring-toggle-id], [data-recurring-delete-id]");
  if (!actionButton || !currentUser) return;
  if (!navigator.onLine) {
    showError("고정 항목 관리는 온라인에서만 변경할 수 있습니다");
    return;
  }
  if (actionButton.dataset.recurringEditId) {
    startEditingRecurringItem(actionButton.dataset.recurringEditId);
    return;
  }
  const itemId = actionButton.dataset.recurringToggleId ?? actionButton.dataset.recurringDeleteId;
  const item = recurringItems.find((currentItem) => currentItem.id === itemId);
  if (!item) return;
  try {
    if (actionButton.dataset.recurringToggleId) {
      const isActive = !item.isActive;
      await updateDoc(getUserRecurringItemDocRef(item.id), { isActive, updatedAt: new Date().toISOString() });
      recurringItems = recurringItems.map((currentItem) => currentItem.id === item.id ? { ...currentItem, isActive } : currentItem);
      showSuccess(isActive ? "고정 항목이 재개되었습니다" : "고정 항목이 일시정지되었습니다");
    } else {
      const shouldDelete = window.confirm(`‘${item.name}’ 설정을 삭제하시겠습니까?\n\n이 설정을 삭제해도 기존 거래 내역은 유지됩니다.`);
      if (!shouldDelete) return;
      await deleteDoc(getUserRecurringItemDocRef(item.id));
      recurringItems = recurringItems.filter((currentItem) => currentItem.id !== item.id);
      if (editingRecurringItemId === item.id) resetRecurringItemForm();
      showSuccess("고정 항목 설정이 삭제되었습니다. 기존 거래 내역은 유지됩니다.");
    }
    renderRecurringItems();
  } catch (error) {
    console.error("Firestore에서 고정 항목 설정을 변경하지 못했습니다.", error);
    showError("고정 항목 설정 변경에 실패했습니다");
  }
}

function startEditingRecurringItem(itemId) {
  const item = recurringItems.find((currentItem) => currentItem.id === itemId);
  if (!item) return;
  editingRecurringItemId = item.id;
  recurringFormTitle.textContent = "고정 항목 수정";
  recurringSubmitButton.textContent = "고정 항목 수정";
  cancelRecurringEditButton.classList.remove("hidden");
  recurringNameInput.value = item.name;
  recurringTypeInput.value = item.type;
  recurringKindInput.value = item.kind;
  updateRecurringCategoryOptions(item.type, item.category);
  recurringAmountInput.value = formatNumberWithCommas(item.amount);
  recurringDayOfMonthInput.value = item.dayOfMonth;
  recurringStartDateInput.value = item.startDate;
  recurringMemoInput.value = item.memo;
  recurringIsActiveInput.checked = item.isActive;
  recurringNameInput.focus();
}

function resetRecurringItemForm() {
  if (!recurringItemForm) return;
  recurringItemForm.reset();
  editingRecurringItemId = null;
  recurringFormTitle.textContent = "새 고정 항목";
  recurringSubmitButton.textContent = "고정 항목 추가";
  cancelRecurringEditButton.classList.add("hidden");
  recurringTypeInput.value = "expense";
  recurringKindInput.value = "fixed";
  recurringStartDateInput.value = getTodayString();
  recurringIsActiveInput.checked = true;
  updateRecurringCategoryOptions("expense");
}

async function handleTransactionAction(event) {
  if (!currentUser) {
    showError("로그인 후 이용해 주세요");
    return;
  }

  const editButton = event.target.closest("[data-edit-id]");
  if (editButton) {
    startEditingTransaction(editButton.dataset.editId);
    return;
  }

  const deleteButton = event.target.closest("[data-delete-id]");
  if (!deleteButton) {
    return;
  }

  const { deleteId } = deleteButton.dataset;
  const transactionToDelete = transactions.find((transaction) => transaction.id === deleteId);
  if (!transactionToDelete) {
    return;
  }

  if (!navigator.onLine && isGeneratedRecurringTransaction(transactionToDelete)) {
    showError("자동 생성된 반복 거래는 온라인에서만 삭제할 수 있습니다");
    return;
  }

  const shouldDelete = window.confirm("이 거래를 삭제하시겠습니까?");
  if (!shouldDelete) {
    return;
  }

  if (pendingDeleteState) {
    await finalizePendingDelete();
  }

  transactions = transactions.filter((transaction) => transaction.id !== deleteId);

  if (editingTransactionId === deleteId) {
    resetForm();
  }

  pendingDeleteState = {
    transaction: transactionToDelete,
    timerId: window.setTimeout(() => {
      finalizePendingDelete();
    }, 3000),
  };

  syncMonthFilterOptions();
  render();
  showUndoDeleteMessage();
}

function updateCategoryOptions(type) {
  const categories = categoriesByType[type];
  categoryInput.innerHTML = categories
    .map((category) => `<option value="${category}">${category}</option>`)
    .join("");
}

function resetForm() {
  form.reset();
  editingTransactionId = null;
  formEyebrow.textContent = "내역 추가";
  formStatus.classList.add("hidden");
  cancelEditButton.classList.add("hidden");
  submitButton.textContent = "거래 추가";
  dateInput.value = getTodayString();
  typeInput.value = "expense";
  amountInput.value = "";
  isFixedInput.checked = false;
  updateCategoryOptions(typeInput.value);
  amountInput.focus();
}

async function handleOnlineStatusChange() {
  updateSyncStatus();
  if (!currentUser) {
    return;
  }

  await syncOfflineTransactions();
  await hydrateTransactionsFromFirestore();
  await hydrateRecurringItemsFromFirestore();
  const materializationResult = await materializeDueRecurringOccurrences();
  if (materializationResult.createdCount > 0) {
    await hydrateTransactionsFromFirestore();
  }
  syncMonthFilterOptions();
  render();
}

function handleOfflineStatusChange() {
  updateSyncStatus("offline");
  console.log("오프라인 상태입니다. 변경 사항은 임시 저장됩니다.");
}

function setSyncStatus(status, text) {
  if (!syncStatusBanner) {
    return;
  }

  if (syncStatusTimeoutId) {
    clearTimeout(syncStatusTimeoutId);
    syncStatusTimeoutId = null;
  }

  syncStatusBanner.textContent = text;
  syncStatusBanner.classList.remove("hidden");
  syncStatusBanner.classList.remove("sync-status-online", "sync-status-offline", "sync-status-syncing");
  syncStatusBanner.classList.add(`sync-status-${status}`);
}

function hideSyncStatusBanner() {
  if (!syncStatusBanner) {
    return;
  }

  if (syncStatusTimeoutId) {
    clearTimeout(syncStatusTimeoutId);
    syncStatusTimeoutId = null;
  }

  syncStatusBanner.classList.add("hidden");
}

function handleAppMessageClick(event) {
  const undoButton = event.target.closest("[data-message-action='undo-delete']");
  if (!undoButton) {
    return;
  }

  undoPendingDelete();
}

function showMessage(message, type, options = {}) {
  if (!appMessage) {
    return;
  }

  if (messageTimeoutId) {
    clearTimeout(messageTimeoutId);
  }

  const { actionLabel = "", actionName = "" } = options;

  if (actionLabel && actionName) {
    appMessage.innerHTML = `
      <span>${escapeHtml(message)}</span>
      <button type="button" class="edit-button" data-message-action="${actionName}">${escapeHtml(actionLabel)}</button>
    `;
  } else {
    appMessage.textContent = message;
  }

  appMessage.classList.remove("hidden", "app-message-error", "app-message-success");
  appMessage.classList.add(`app-message-${type}`);

  messageTimeoutId = window.setTimeout(() => {
    hideMessage();
  }, 4000);
}

function showError(message) {
  showMessage(message, "error");
}

function showSuccess(message) {
  showMessage(message, "success");
}

function hideMessage() {
  if (!appMessage) {
    return;
  }

  if (messageTimeoutId) {
    clearTimeout(messageTimeoutId);
  }

  appMessage.classList.add("hidden");
  appMessage.classList.remove("app-message-error", "app-message-success");
  appMessage.textContent = "";
  messageTimeoutId = null;
}

function showUndoDeleteMessage() {
  showMessage("삭제 예정입니다", "success", {
    actionLabel: "되돌리기",
    actionName: "undo-delete",
  });
}

async function finalizePendingDelete() {
  if (!pendingDeleteState) {
    return;
  }

  const { transaction, timerId } = pendingDeleteState;
  pendingDeleteState = null;
  clearTimeout(timerId);

  if (!navigator.onLine) {
    if (isGeneratedRecurringTransaction(transaction)) {
      transactions.push(transaction);
      syncMonthFilterOptions();
      render();
      hideMessage();
      showError("자동 생성된 반복 거래는 온라인에서만 삭제할 수 있습니다");
      return;
    }

    queueOfflineMutation({ type: "delete", transactionId: transaction.id, userId: getCurrentUserId() });
    updateSyncStatus("offline");
    hideMessage();
    showSuccess("오프라인 상태로 삭제가 예약되었습니다");
    return;
  }

  try {
    if (isGeneratedRecurringTransaction(transaction)) {
      await deleteGeneratedRecurringTransactionWithSkip(transaction);
    } else {
      await deleteDoc(getUserTransactionDocRef(transaction.id));
    }
    hideMessage();
    showSuccess("삭제되었습니다");
  } catch (error) {
    transactions.push(transaction);
    syncMonthFilterOptions();
    render();
    hideMessage();
    showError("삭제에 실패했습니다");
    console.error("Firestore에서 거래 데이터를 삭제하지 못했습니다.", error);
  }
}

async function deleteGeneratedRecurringTransactionWithSkip(transaction) {
  const skipRef = getUserRecurringOccurrenceSkipDocRef(
    transaction.recurringItemId,
    transaction.occurrenceKey,
  );
  const transactionRef = getUserTransactionDocRef(transaction.id);
  const skippedAt = new Date().toISOString();

  await runTransaction(db, async (firestoreTransaction) => {
    firestoreTransaction.set(skipRef, {
      recurringItemId: transaction.recurringItemId,
      occurrenceKey: transaction.occurrenceKey,
      skippedAt,
    });
    firestoreTransaction.delete(transactionRef);
  });
}

function isGeneratedRecurringTransaction(transaction) {
  return (
    transaction?.source === "recurringItem" &&
    typeof transaction.recurringItemId === "string" &&
    typeof transaction.occurrenceKey === "string"
  );
}

function undoPendingDelete() {
  if (!pendingDeleteState) {
    return;
  }

  const { transaction, timerId } = pendingDeleteState;
  pendingDeleteState = null;
  clearTimeout(timerId);
  transactions.push(transaction);
  syncMonthFilterOptions();
  render();
  hideMessage();
  showSuccess("삭제가 취소되었습니다");
}

function updateSyncStatus(forcedStatus) {
  if (!currentUser) {
    hideSyncStatusBanner();
    return;
  }

  if (forcedStatus === "syncing") {
    setSyncStatus("syncing", "동기화 중...");
    return;
  }

  if (forcedStatus === "saved") {
    setSyncStatus("online", "모든 변경 사항이 저장됨");
    syncStatusTimeoutId = window.setTimeout(() => {
      hideSyncStatusBanner();
    }, 1800);
    return;
  }

  if (forcedStatus === "error") {
    setSyncStatus("offline", "일부 항목 동기화 실패");
    return;
  }

  if (!navigator.onLine || forcedStatus === "offline") {
    setSyncStatus("offline", "오프라인 상태 - 변경 사항이 임시 저장됩니다");
    return;
  }

  if (loadOfflineQueue().length > 0) {
    hideSyncStatusBanner();
    return;
  }

  hideSyncStatusBanner();
}

function startEditingTransaction(transactionId) {
  const transaction = transactions.find((currentTransaction) => currentTransaction.id === transactionId);
  if (!transaction) {
    return;
  }

  editingTransactionId = transaction.id;
  formEyebrow.textContent = "내역 수정";
  formStatus.classList.remove("hidden");
  cancelEditButton.classList.remove("hidden");
  submitButton.textContent = "거래 수정";
  dateInput.value = transaction.date;
  typeInput.value = transaction.type;
  updateCategoryOptions(transaction.type);
  categoryInput.value = transaction.category;
  amountInput.value = formatNumberWithCommas(transaction.amount);
  memoInput.value = transaction.memo;
  isFixedInput.checked = Boolean(transaction.isFixed);
  amountInput.focus();
}

async function hydrateTransactionsFromFirestore() {
  if (!currentUser) {
    transactions = [];
    return;
  }

  try {
    const snapshot = await getDocs(getUserTransactionsCollection());
    const firestoreTransactions = snapshot.docs
      .map((snapshotDoc) => ({
        id: snapshotDoc.id,
        ...snapshotDoc.data(),
      }))
      .filter(isValidTransactionShape)
      .map(normalizeTransaction);
    transactions = firestoreTransactions;
  } catch (error) {
    console.error("Firestore에서 거래 데이터를 불러오지 못했습니다.", error);
    showError("\uB370\uC774\uD130\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4");
  }
}

async function hydrateRecurringItemsFromFirestore() {
  if (!currentUser) {
    recurringItems = [];
    return;
  }

  try {
    const snapshot = await getDocs(getUserRecurringItemsCollection());
    recurringItems = snapshot.docs
      .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
      .filter(isValidRecurringItemShape)
      .map(normalizeRecurringItem);
  } catch (error) {
    console.error("Firestore에서 고정 항목 설정을 불러오지 못했습니다.", error);
    showError("고정 항목 설정을 불러오지 못했습니다");
  }
}

async function materializeDueRecurringOccurrences() {
  const emptyResult = { createdCount: 0, failureCount: 0 };
  if (!currentUser || !navigator.onLine || isMaterializingRecurringOccurrences) {
    return emptyResult;
  }

  isMaterializingRecurringOccurrences = true;
  const existingOccurrenceKeys = new Set(
    transactions
      .filter((transaction) => (
        transaction.source === "recurringItem" &&
        typeof transaction.recurringItemId === "string" &&
        typeof transaction.occurrenceKey === "string"
      ))
      .map((transaction) => getRecurringOccurrenceIdentity(transaction.recurringItemId, transaction.occurrenceKey)),
  );
  const result = { createdCount: 0, failureCount: 0 };

  try {
    for (const recurringItem of recurringItems) {
      if (!isValidRecurringItemShape(recurringItem) || !recurringItem.isActive) {
        continue;
      }

      for (const occurrence of getDueMonthlyOccurrences(recurringItem)) {
        const occurrenceIdentity = getRecurringOccurrenceIdentity(recurringItem.id, occurrence.occurrenceKey);
        if (existingOccurrenceKeys.has(occurrenceIdentity)) {
          continue;
        }

        try {
          const didCreate = await createRecurringOccurrenceIfMissing(recurringItem, occurrence);
          if (didCreate) {
            result.createdCount += 1;
          }
          existingOccurrenceKeys.add(occurrenceIdentity);
        } catch (error) {
          result.failureCount += 1;
          console.error("반복 고정 항목 발생 내역을 저장하지 못했습니다.", {
            recurringItemId: recurringItem.id,
            occurrenceKey: occurrence.occurrenceKey,
            error,
          });
        }
      }
    }

    if (result.failureCount > 0) {
      showError("일부 반복 고정 항목을 거래 내역으로 저장하지 못했습니다");
    }
    return result;
  } finally {
    isMaterializingRecurringOccurrences = false;
  }
}

async function createRecurringOccurrenceIfMissing(recurringItem, occurrence) {
  const transactionId = getRecurringOccurrenceTransactionId(recurringItem.id, occurrence.occurrenceKey);
  const transactionRef = getUserTransactionDocRef(transactionId);
  const skipRef = getUserRecurringOccurrenceSkipDocRef(recurringItem.id, occurrence.occurrenceKey);
  const transaction = {
    id: transactionId,
    clientId: transactionId,
    date: occurrence.date,
    type: recurringItem.type,
    amount: recurringItem.amount,
    category: recurringItem.category,
    memo: recurringItem.memo,
    isFixed: true,
    userId: getCurrentUserId(),
    source: "recurringItem",
    recurringItemId: recurringItem.id,
    occurrenceKey: occurrence.occurrenceKey,
  };

  return runTransaction(db, async (firestoreTransaction) => {
    const existingDocument = await firestoreTransaction.get(transactionRef);
    const skipDocument = await firestoreTransaction.get(skipRef);
    if (existingDocument.exists() || skipDocument.exists()) {
      return false;
    }

    firestoreTransaction.set(transactionRef, getFirestoreTransactionPayload(transaction));
    return true;
  });
}

function getDueMonthlyOccurrences(recurringItem, today = getTodayString()) {
  if (!isValidRecurringItemShape(recurringItem) || !recurringItem.isActive || recurringItem.recurrence !== "monthly") {
    return [];
  }

  const startDateParts = parseIsoDate(recurringItem.startDate);
  const todayParts = parseIsoDate(today);
  if (!startDateParts || !todayParts || recurringItem.startDate > today) {
    return [];
  }

  const occurrences = [];
  let year = startDateParts.year;
  let month = startDateParts.month;
  while (year < todayParts.year || (year === todayParts.year && month <= todayParts.month)) {
    const date = getMonthlyOccurrenceDate(year, month, recurringItem.dayOfMonth);
    if (date >= recurringItem.startDate && date <= today) {
      occurrences.push({ occurrenceKey: `${year}-${String(month).padStart(2, "0")}`, date });
    }

    month += 1;
    if (month === 13) {
      year += 1;
      month = 1;
    }
  }

  return occurrences;
}

function parseIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  const lastDay = getLastCalendarDayOfMonth(year, month);
  if (month < 1 || month > 12 || day < 1 || day > lastDay) {
    return null;
  }

  return { year, month, day };
}

function getMonthlyOccurrenceDate(year, month, dayOfMonth) {
  const finalDayOfMonth = getLastCalendarDayOfMonth(year, month);
  const occurrenceDay = Math.min(dayOfMonth, finalDayOfMonth);
  return `${year}-${String(month).padStart(2, "0")}-${String(occurrenceDay).padStart(2, "0")}`;
}

function getLastCalendarDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function getRecurringOccurrenceIdentity(recurringItemId, occurrenceKey) {
  return `${recurringItemId}:${occurrenceKey}`;
}

function getRecurringOccurrenceTransactionId(recurringItemId, occurrenceKey) {
  return `recurring-${recurringItemId}-${occurrenceKey}`;
}

function getRecurringOccurrenceSkipId(recurringItemId, occurrenceKey) {
  return `recurring-skip-${recurringItemId}-${occurrenceKey}`;
}

function loadLegacyTransactionsFromLocalStorage() {
  try {
    const storedValue = localStorage.getItem(LEGACY_TRANSACTIONS_STORAGE_KEY);
    if (!storedValue) {
      return [];
    }

    const parsedValue = JSON.parse(storedValue);
    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue.filter(isValidTransactionShape).map(normalizeTransaction);
  } catch (error) {
    console.error("기존 localStorage 거래 데이터를 불러오지 못했습니다.", error);
    return [];
  }
}

function isLegacyMigrationCompleted() {
  return localStorage.getItem(getMigrationCompletedKey()) === "true";
}

function setLegacyMigrationCompleted() {
  localStorage.setItem(getMigrationCompletedKey(), "true");
}

async function migrateLegacyLocalStorageToFirestore() {
  if (!navigator.onLine || !currentUser) {
    return;
  }

  if (isLegacyMigrationCompleted()) {
    return;
  }

  const legacyTransactions = loadLegacyTransactionsFromLocalStorage();
  if (legacyTransactions.length === 0) {
    return;
  }

  try {
    const transactionsCollection = getUserTransactionsCollection();
    const snapshot = await getDocs(transactionsCollection);
    const existingClientIds = new Set();

    snapshot.docs.forEach((snapshotDoc) => {
      const data = snapshotDoc.data();
      if (typeof data.clientId === "string" && data.clientId) {
        existingClientIds.add(data.clientId);
      }
    });

    for (const legacyTransaction of legacyTransactions) {
      const clientId = typeof legacyTransaction.clientId === "string" && legacyTransaction.clientId
        ? legacyTransaction.clientId
        : legacyTransaction.id ?? createTransactionId();

      if (existingClientIds.has(clientId)) {
        continue;
      }

      await addDoc(
        transactionsCollection,
        getFirestoreTransactionPayload({ ...legacyTransaction, clientId, userId: getCurrentUserId() }),
      );
      existingClientIds.add(clientId);
    }

    setLegacyMigrationCompleted();
  } catch (error) {
    console.error("localStorage 데이터를 Firestore로 옮기지 못했습니다.", error);
  }
}

function loadOfflineQueue() {
  const queueKey = getOfflineQueueKey();
  if (!queueKey) {
    return [];
  }

  try {
    const storedValue = localStorage.getItem(queueKey);
    if (!storedValue) {
      return [];
    }

    const parsedValue = JSON.parse(storedValue);
    return Array.isArray(parsedValue) ? parsedValue : [];
  } catch (error) {
    console.error("오프라인 대기열을 불러오지 못했습니다.", error);
    return [];
  }
}

function saveOfflineQueue(queue) {
  const queueKey = getOfflineQueueKey();
  if (!queueKey) {
    return;
  }

  localStorage.setItem(queueKey, JSON.stringify(queue));
}

function clearOfflineQueue() {
  const queueKey = getOfflineQueueKey();
  if (!queueKey) {
    return;
  }

  localStorage.removeItem(queueKey);
}

function queueOfflineMutation(mutation) {
  if (!currentUser) {
    return;
  }

  const queue = loadOfflineQueue();

  if (mutation.type === "create") {
    queue.push(mutation);
    saveOfflineQueue(queue);
    return;
  }

  if (mutation.type === "update") {
    const createIndex = queue.findIndex(
      (item) => item.type === "create" && item.transaction.id === mutation.transaction.id,
    );
    if (createIndex >= 0) {
      queue[createIndex] = { type: "create", transaction: mutation.transaction };
      saveOfflineQueue(queue);
      return;
    }

    const updateIndex = queue.findIndex(
      (item) => item.type === "update" && item.transaction.id === mutation.transaction.id,
    );
    if (updateIndex >= 0) {
      queue[updateIndex] = mutation;
    } else {
      queue.push(mutation);
    }

    saveOfflineQueue(queue);
    return;
  }

  const createIndex = queue.findIndex(
    (item) => item.type === "create" && item.transaction.id === mutation.transactionId,
  );
  if (createIndex >= 0) {
    queue.splice(createIndex, 1);
    saveOfflineQueue(queue);
    return;
  }

  const filteredQueue = queue.filter((item) => {
    if (item.type === "delete") {
      return item.transactionId !== mutation.transactionId;
    }

    return item.transaction.id !== mutation.transactionId;
  });

  filteredQueue.push(mutation);
  saveOfflineQueue(filteredQueue);
}

function applyOfflineQueueToTransactions() {
  if (!currentUser) {
    return;
  }

  const queue = loadOfflineQueue();

  queue.forEach((item) => {
    if (item.type === "create") {
      transactions = [...transactions, normalizeTransaction(item.transaction)];
      return;
    }

    if (item.type === "update") {
      transactions = transactions.map((transaction) =>
        transaction.id === item.transaction.id ? normalizeTransaction(item.transaction) : transaction,
      );
      return;
    }

    transactions = transactions.filter((transaction) => transaction.id !== item.transactionId);
  });
}

async function syncOfflineTransactions() {
  if (!navigator.onLine || isSyncingOfflineTransactions || !currentUser) {
    return;
  }

  const queue = loadOfflineQueue();
  if (queue.length === 0) {
    updateSyncStatus();
    return;
  }

  isSyncingOfflineTransactions = true;
  updateSyncStatus("syncing");

  try {
    const transactionsCollection = getUserTransactionsCollection();
    const snapshot = await getDocs(transactionsCollection);
    const clientIdMap = new Map();

    snapshot.docs.forEach((snapshotDoc) => {
      const data = snapshotDoc.data();
      if (typeof data.clientId === "string") {
        clientIdMap.set(data.clientId, snapshotDoc.id);
      }
    });

    const remainingQueue = [];

    for (const item of queue) {
      try {
        if (item.type === "create") {
          const pendingTransaction = normalizeTransaction(item.transaction);
          const pendingClientId = pendingTransaction.clientId ?? pendingTransaction.id;
          const existingDocId = clientIdMap.get(pendingClientId);

          if (existingDocId) {
            transactions = transactions.map((transaction) =>
              transaction.id === pendingTransaction.id
                ? { ...pendingTransaction, id: existingDocId, clientId: pendingClientId }
                : transaction,
            );
            continue;
          }

          const docRef = await addDoc(
            transactionsCollection,
            getFirestoreTransactionPayload({ ...pendingTransaction, clientId: pendingClientId }),
          );

          clientIdMap.set(pendingClientId, docRef.id);
          transactions = transactions.map((transaction) =>
            transaction.id === pendingTransaction.id
              ? { ...pendingTransaction, id: docRef.id, clientId: pendingClientId }
              : transaction,
          );
          continue;
        }

        if (item.type === "update") {
          const pendingTransaction = normalizeTransaction(item.transaction);
          const targetDocId = clientIdMap.get(pendingTransaction.clientId) ?? pendingTransaction.id;
          await updateDoc(
            getUserTransactionDocRef(targetDocId),
            getFirestoreTransactionPayload({ ...pendingTransaction, id: targetDocId }),
          );
          continue;
        }

        const targetDocId = clientIdMap.get(item.transactionId) ?? item.transactionId;
        await deleteDoc(getUserTransactionDocRef(targetDocId));
      } catch (error) {
        console.error("오프라인 변경 사항 동기화에 실패했습니다.", error);
        remainingQueue.push(item);
      }
    }

    if (remainingQueue.length === 0) {
      clearOfflineQueue();
      updateSyncStatus("saved");
      showSuccess("\uBAA8\uB4E0 \uBCC0\uACBD\uC0AC\uD56D\uC774 \uC800\uC7A5\uB418\uC5C8\uC2B5\uB2C8\uB2E4");
    } else {
      saveOfflineQueue(remainingQueue);
      updateSyncStatus("error");
      showError("\uC77C\uBD80 \uD56D\uBAA9 \uB3D9\uAE30\uD654 \uC2E4\uD328");
    }
  } catch (error) {
    updateSyncStatus("error");
    showError("\uC778\uD130\uB137 \uC5F0\uACB0\uC744 \uD655\uC778\uD558\uC138\uC694");
    console.error("오프라인 변경 사항 동기화에 실패했습니다.", error);
  } finally {
    isSyncingOfflineTransactions = false;
  }
}

function calculateSummaryTotals(items) {
  return items.reduce(
    (accumulator, transaction) => {
      if (transaction.type === "income") {
        accumulator.income += transaction.amount;
        if (transaction.isFixed) {
          accumulator.fixedIncome += transaction.amount;
        }
      } else {
        accumulator.expense += transaction.amount;
        if (transaction.isFixed) {
          accumulator.fixedExpense += transaction.amount;
        }
      }

      return accumulator;
    },
    { income: 0, fixedIncome: 0, expense: 0, fixedExpense: 0 },
  );
}

function isValidTransactionShape(transaction) {
  const hasValidRecurringProvenance = transaction.source === undefined || (
    transaction.source === "recurringItem" &&
    typeof transaction.recurringItemId === "string" &&
    typeof transaction.occurrenceKey === "string"
  );
  return (
    transaction &&
    typeof transaction.id === "string" &&
    typeof transaction.date === "string" &&
    (transaction.type === "income" || transaction.type === "expense") &&
    typeof transaction.amount === "number" &&
    typeof transaction.category === "string" &&
    typeof transaction.memo === "string" &&
    (typeof transaction.isFixed === "boolean" || typeof transaction.isFixed === "undefined") &&
    hasValidRecurringProvenance
  );
}

function normalizeTransaction(transaction) {
  return {
    ...transaction,
    isFixed: Boolean(transaction.isFixed),
  };
}

function isValidRecurringItemShape(item) {
  return (
    item &&
    typeof item.id === "string" &&
    typeof item.name === "string" && item.name.trim().length > 0 &&
    (item.type === "income" || item.type === "expense") &&
    typeof item.amount === "number" && Number.isFinite(item.amount) && item.amount > 0 &&
    typeof item.category === "string" &&
    typeof item.memo === "string" &&
    item.recurrence === "monthly" &&
    Number.isInteger(item.dayOfMonth) && item.dayOfMonth >= 1 && item.dayOfMonth <= 31 &&
    typeof item.isActive === "boolean" &&
    (item.kind === "fixed" || item.kind === "subscription") &&
    typeof item.startDate === "string"
  );
}

function normalizeRecurringItem(item) {
  return {
    ...item,
    name: item.name.trim(),
    memo: item.memo.trim(),
    isActive: Boolean(item.isActive),
  };
}

function getFirestoreTransactionPayload(transaction) {
  const { id, ...payload } = transaction;
  return payload;
}

function getTodayString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCurrentYear() {
  return new Date().getFullYear();
}

function getCurrentMonthValue() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function formatAmount(value) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

function getExportRows() {
  return getSortedTransactions(transactions).map((transaction) => ({
    id: transaction.id ?? "",
    clientId: transaction.clientId ?? "",
    date: transaction.date ?? "",
    type: transaction.type ?? "",
    amount: transaction.amount ?? 0,
    category: transaction.category ?? "",
    memo: transaction.memo ?? "",
    isFixed: Boolean(transaction.isFixed),
    source: transaction.source ?? "",
    recurringItemId: transaction.recurringItemId ?? "",
    occurrenceKey: transaction.occurrenceKey ?? "",
  }));
}

function escapeCsvValue(value) {
  const stringValue = String(value ?? "");
  return `"${stringValue.replaceAll('"', '""')}"`;
}

function downloadFile({ content, fileName, mimeType }) {
  const blob = new Blob([content], { type: mimeType });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = downloadUrl;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(downloadUrl);
  }, 0);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createTransactionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `txn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getSortedTransactions(items = transactions) {
  return [...items].sort(compareTransactionsByLatest);
}

function compareTransactionsByLatest(left, right) {
  const dateComparison = right.date.localeCompare(left.date);
  if (dateComparison !== 0) {
    return dateComparison;
  }

  return right.id.localeCompare(left.id);
}

function getCategoryStatistics(type, items = transactions) {
  const colorPalette = type === "income" ? incomeChartColors : expenseChartColors;
  const categoryTotals = new Map();

  items.forEach((transaction) => {
    if (transaction.type !== type) {
      return;
    }

    categoryTotals.set(
      transaction.category,
      (categoryTotals.get(transaction.category) ?? 0) + transaction.amount,
    );
  });

  const totalAmount = [...categoryTotals.values()].reduce((sum, amount) => sum + amount, 0);

  return [...categoryTotals.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([category, amount], index) => ({
      category,
      amount,
      color: colorPalette[index % colorPalette.length],
      share: totalAmount === 0 ? 0 : Math.round((amount / totalAmount) * 100),
    }));
}

function buildChartGradient(statistics, totalAmount) {
  if (statistics.length === 0 || totalAmount <= 0) {
    return "conic-gradient(#d8d1c6 0deg 360deg)";
  }

  let currentAngle = 0;
  const segments = statistics.map((item, index) => {
    const segmentAngle = (item.amount / totalAmount) * 360;
    const startAngle = currentAngle;
    const endAngle = index === statistics.length - 1 ? 360 : currentAngle + segmentAngle;
    currentAngle = endAngle;
    return `${item.color} ${startAngle}deg ${endAngle}deg`;
  });

  return `conic-gradient(${segments.join(", ")})`;
}

function getFilteredTransactions() {
  const selectedMonth = monthFilterInput.value;
  if (!selectedMonth || selectedMonth === "all") {
    return transactions;
  }

  return transactions.filter((transaction) => transaction.date.startsWith(selectedMonth));
}

function getVisibleTransactions() {
  const searchTerm = transactionSearchInput.value.trim().toLowerCase();
  const monthFilteredTransactions = getFilteredTransactions();
  const typeFilteredTransactions = currentTypeFilter === "all"
    ? monthFilteredTransactions
    : monthFilteredTransactions.filter((transaction) => transaction.type === currentTypeFilter);

  if (!searchTerm) {
    return getSortedTransactionsForList(typeFilteredTransactions);
  }

  return getSortedTransactionsForList(typeFilteredTransactions.filter((transaction) => {
    const typeLabel = transaction.type === "income" ? "수입" : "지출";
    const amountText = String(transaction.amount ?? "");
    const amountWithCommas = formatNumberWithCommas(transaction.amount ?? 0);
    return [
      transaction.date,
      amountText,
      amountWithCommas,
      transaction.memo,
      transaction.category,
      transaction.type,
      typeLabel,
    ].some((value) => value.toLowerCase().includes(searchTerm));
  }));
}

function getSortedTransactionsForList(items = transactions) {
  const sortedItems = [...items];

  switch (currentSortOption) {
    case "oldest":
      return sortedItems.sort((left, right) => compareTransactionsByLatest(left, right) * -1);
    case "amountDesc":
      return sortedItems.sort((left, right) => {
        if (right.amount !== left.amount) {
          return right.amount - left.amount;
        }

        return compareTransactionsByLatest(left, right);
      });
    case "amountAsc":
      return sortedItems.sort((left, right) => {
        if (left.amount !== right.amount) {
          return left.amount - right.amount;
        }

        return compareTransactionsByLatest(left, right);
      });
    case "latest":
    default:
      return getSortedTransactions(sortedItems);
  }
}

function syncMonthFilterOptions() {
  const selectedValue = periodState.value || "all";
  const availableMonthSet = new Set(transactions.map((transaction) => transaction.date.slice(0, 7)));
  if (selectedValue !== "all") {
    availableMonthSet.add(selectedValue);
  }

  const availableMonths = [...availableMonthSet].sort((left, right) => right.localeCompare(left));
  monthFilterInput.innerHTML = [
    '<option value="all">전체 기간</option>',
    ...availableMonths.map((month) => `<option value="${month}">${formatMonthLabel(month)}</option>`),
  ].join("");
  monthFilterInput.value = selectedValue;
}

function formatMonthLabel(monthValue) {
  const [year, month] = monthValue.split("-");
  return `${year}년 ${Number(month)}월`;
}

function getSummaryModalConfig(summaryType, items, totals) {
  switch (summaryType) {
    case "income":
      return {
        title: "총수입 상세",
        transactions: getSortedTransactions(items.filter((transaction) => transaction.type === "income")),
        total: totals.income,
        kind: "transactions",
      };
    case "fixedIncome":
      return {
        title: "총고정수입 상세",
        transactions: getSortedTransactions(
          items.filter((transaction) => transaction.type === "income" && transaction.isFixed),
        ),
        total: totals.fixedIncome,
        kind: "transactions",
      };
    case "expense":
      return {
        title: "총지출 상세",
        transactions: getSortedTransactions(items.filter((transaction) => transaction.type === "expense")),
        total: totals.expense,
        kind: "transactions",
      };
    case "fixedExpense":
      return {
        title: "총고정지출 상세",
        transactions: getSortedTransactions(
          items.filter((transaction) => transaction.type === "expense" && transaction.isFixed),
        ),
        total: totals.fixedExpense,
        kind: "transactions",
      };
    case "variableExpense":
      return {
        title: "총변동지출 상세",
        transactions: getSortedTransactions(
          items.filter((transaction) => transaction.type === "expense" && !transaction.isFixed),
        ),
        total: totals.expense - totals.fixedExpense,
        kind: "transactions",
      };
    case "balance":
      return {
        title: "잔액 상세",
        transactions: [],
        total: totals.income - totals.expense,
        kind: "balance",
      };
    default:
      return {
        title: "요약 상세",
        transactions: [],
        total: 0,
        kind: "transactions",
      };
  }
}

function renderModalTransactionItem(transaction) {
  return `
    <div class="modal-transaction-item">
      <span>${escapeHtml(transaction.date)}</span>
      <span>${escapeHtml(transaction.category)}</span>
      <span class="modal-transaction-memo">${transaction.memo ? escapeHtml(transaction.memo) : "-"}</span>
      <strong class="amount-${transaction.type}">
        ${transaction.type === "income" ? "+" : "-"}${formatAmount(transaction.amount)}
      </strong>
    </div>
  `;
}

function parseAmountInputValue(value) {
  const digits = extractDigits(value);
  return digits ? Number(digits) : Number.NaN;
}

function extractDigits(value) {
  return value.replace(/\D/g, "");
}

function formatNumberWithCommas(value) {
  return Number(value).toLocaleString("ko-KR");
}

function countDigits(value) {
  return extractDigits(value).length;
}

function getCursorPositionFromDigitIndex(formattedValue, digitIndex) {
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

const firebaseConfig = {
  apiKey: "AIzaSyBprb4PTolR3gnPmJz9H9l102ybhcAnxCI",
  authDomain: "household-account-book-27aea.firebaseapp.com",
  projectId: "household-account-book-27aea",
  storageBucket: "household-account-book-27aea.firebasestorage.app",
  messagingSenderId: "435641439237",
  appId: "1:435641439237:web:664705f5e948d78094f86c",
  measurementId: "G-HLF7NTHP51"
};

const app = initializeFirebaseApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

onAuthStateChanged(auth, handleAuthStateChange);
