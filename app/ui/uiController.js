import { ITEMS_PER_PAGE, categoriesByType, statisticsFlowColors } from "../config.js";
import {
  countDigits,
  escapeHtml,
  formatAmount,
  formatMonthLabel,
  formatNumberWithCommas,
  getCurrentMonthValue,
  getCurrentYear,
  getCursorPositionFromDigitIndex,
  getTodayString,
  parseAmountInputValue,
} from "../utils.js";

export function createUiController({ budgetAPI }) {
  const dom = getDomRefs();
  const uiState = {
    currentTypeFilter: "all",
    currentSortOption: "latest",
    currentPage: 1,
    editingTransactionId: null,
    editingRecurringItemId: null,
    expandedTransactionId: null,
    periodValue: "all",
    periodPanelYear: getCurrentYear(),
    periodPanelOpen: false,
    pendingDelete: null,
    isDeleting: false,
    isExporting: false,
    messageTimeoutId: null,
    syncStatusTimeoutId: null,
    currentSnapshot: budgetAPI.getState(),
  };

  return {
    async initialize() {
      bindEvents();
      dom.dateInput.value = getTodayString();
      updateCategoryOptions(dom.typeInput.value);
      syncSavingsOptionVisibility();
      budgetAPI.subscribe((snapshot) => {
        uiState.currentSnapshot = snapshot;
        render();
      });
      window.householdBudgetAPI = budgetAPI;
      render();
    },
  };

  function bindEvents() {
    dom.typeInput.addEventListener("change", () => {
      updateCategoryOptions(dom.typeInput.value);
      syncSavingsOptionVisibility();
    });
    dom.form.addEventListener("submit", handleSubmit);
    dom.amountInput.addEventListener("input", handleAmountInput);
    dom.todayButton.addEventListener("click", () => {
      dom.dateInput.value = getTodayString();
    });
    dom.cancelEditButton.addEventListener("click", resetForm);
    dom.recurringManagementButton.addEventListener("click", openRecurringModal);
    dom.recurringModalCloseButton.addEventListener("click", closeRecurringModal);
    dom.recurringModal.addEventListener("click", (event) => { if (event.target === dom.recurringModal) closeRecurringModal(); });
    dom.recurringItemForm.addEventListener("submit", handleRecurringSubmit);
    dom.recurringCancelEditButton.addEventListener("click", resetRecurringForm);
    dom.recurringType.addEventListener("change", () => { updateRecurringCategoryOptions(dom.recurringType.value); syncRecurringSavingsOptionVisibility(); });
    dom.recurringKind.addEventListener("change", () => { if (dom.recurringKind.value === "subscription" && dom.recurringType.value === "expense") dom.recurringCategory.value = "구독"; });
    dom.recurringAmount.addEventListener("input", handleAmountInput);
    dom.recurringItemList.addEventListener("click", handleRecurringListClick);
    dom.transactionTypeFilterInput.addEventListener("change", () => {
      uiState.currentTypeFilter = dom.transactionTypeFilterInput.value || "all";
      uiState.currentPage = 1;
      render();
    });
    dom.transactionSortInput.addEventListener("change", () => {
      uiState.currentSortOption = dom.transactionSortInput.value || "latest";
      uiState.currentPage = 1;
      render();
    });
    dom.transactionSearchInput.addEventListener("input", () => {
      uiState.currentPage = 1;
      render();
    });
    dom.statisticsTypeInput.addEventListener("change", render);
    dom.monthFilterInput.addEventListener("change", () => setPeriodValue(dom.monthFilterInput.value, { closePanel: false }));
    dom.periodToggleButton.addEventListener("click", togglePeriodPanel);
    dom.allTimeButton.addEventListener("click", () => setPeriodValue("all"));
    dom.thisMonthButton.addEventListener("click", () => {
      const value = getCurrentMonthValue();
      uiState.periodPanelYear = Number(value.split("-")[0]);
      setPeriodValue(value);
    });
    dom.prevYearButton.addEventListener("click", () => {
      uiState.periodPanelYear -= 1;
      syncPeriodUi();
    });
    dom.nextYearButton.addEventListener("click", () => {
      uiState.periodPanelYear += 1;
      syncPeriodUi();
    });
    dom.periodMonthGrid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-period-value]");
      if (button) {
        setPeriodValue(button.dataset.periodValue);
      }
    });
    dom.transactionList.addEventListener("click", handleTransactionTableClick);
    dom.paginationElement.addEventListener("click", handlePaginationClick);
    dom.summarySection.addEventListener("click", handleSummaryCardClick);
    dom.summarySection.addEventListener("keydown", handleSummaryCardKeydown);
    dom.summaryModal.addEventListener("click", (event) => {
      if (event.target === dom.summaryModal) {
        closeSummaryModal();
        closeRecurringModal();
      }
    });
    dom.modalCloseButton.addEventListener("click", closeSummaryModal);
    dom.appMessage.addEventListener("click", (event) => {
      const undoButton = event.target.closest("[data-message-action='undo-delete']");
      if (undoButton) {
        undoPendingDelete();
      }
    });
    dom.authGateSignInButton.addEventListener("click", async () => {
      try {
        await budgetAPI.signInWithGoogle();
      } catch (error) {
        console.error(error);
        showMessage("로그인에 실패했습니다", "error");
      }
    });
    dom.signOutButton.addEventListener("click", async () => {
      try {
        await budgetAPI.signOut();
      } catch (error) {
        console.error(error);
        showMessage("로그아웃에 실패했습니다", "error");
      }
    });
    window.addEventListener("online", async () => {
      budgetAPI.setOnlineStatus(true);
      setSyncStatus("syncing", "동기화 중입니다...");
      await budgetAPI.syncPendingChanges();
      await budgetAPI.refresh();
      setSyncStatus("online", "모든 변경 사항이 저장되었습니다");
      uiState.syncStatusTimeoutId = window.setTimeout(hideSyncStatusBanner, 1800);
    });
    window.addEventListener("offline", () => {
      budgetAPI.setOnlineStatus(false);
      setSyncStatus("offline", "오프라인 상태입니다. 변경 사항은 기기에 임시 저장됩니다");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeSummaryModal();
        if (uiState.periodPanelOpen) {
          uiState.periodPanelOpen = false;
          syncPeriodUi();
        }
      }
    });
    dom.exportCsvButton.addEventListener("click", () => handleExport("csv"));
    dom.exportJsonButton.addEventListener("click", () => handleExport("json"));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const amount = parseAmountInputValue(dom.amountInput.value);
    if (!Number.isFinite(amount) || amount <= 0) {
      dom.amountInput.focus();
      return;
    }

    const existing = uiState.editingTransactionId
      ? uiState.currentSnapshot.transactions.find((item) => item.id === uiState.editingTransactionId)
      : null;

    const payload = {
      id: uiState.editingTransactionId ?? undefined,
      clientId: existing?.clientId,
      date: dom.dateInput.value,
      type: dom.typeInput.value,
      amount,
      category: dom.categoryInput.value,
      memo: dom.memoInput.value.trim(),
      isFixed: dom.isFixedInput.checked,
      recordClass: dom.recordClassSavingsInput.checked ? "savings" : "normal",
      recurringSeriesId: existing?.recurringSeriesId,
      recurringDay: existing?.recurringDay,
      recurringStartDate: existing?.recurringStartDate || dom.dateInput.value,
      recurringSkipMonths: existing?.recurringSkipMonths ?? [],
      generatedMonth: existing?.generatedMonth ?? "",
    };

    try {
      const isEditing = Boolean(uiState.editingTransactionId);
      const result = isEditing
        ? await budgetAPI.updateTransaction(uiState.editingTransactionId, payload)
        : await budgetAPI.addTransaction(payload);

      if (!result.ok) {
        showMessage(result.reason ?? "저장에 실패했습니다", "error");
        return;
      }

      resetForm();
      showMessage(
        result.mode === "offline"
          ? "오프라인 상태로 임시 저장되었습니다"
          : (isEditing ? "수정되었습니다" : "저장되었습니다"),
        "success",
      );
    } catch (error) {
      console.error(error);
      showMessage("저장에 실패했습니다", "error");
    }
  }

  function handleAmountInput(event) {
    const input = event.target;
    const digitsBeforeCursor = countDigits(input.value.slice(0, input.selectionStart ?? 0));
    const numericValue = input.value.replace(/\D/g, "");
    input.value = numericValue ? formatNumberWithCommas(numericValue) : "";
    const nextCursorPosition = getCursorPositionFromDigitIndex(input.value, digitsBeforeCursor);
    input.setSelectionRange(nextCursorPosition, nextCursorPosition);
  }

  function handleTransactionTableClick(event) {
    const editButton = event.target.closest("[data-edit-id]");
    if (editButton) {
      startEditing(editButton.dataset.editId);
      return;
    }

    const deleteButton = event.target.closest("[data-delete-id]");
    if (deleteButton) {
      if (uiState.isDeleting || uiState.pendingDelete) {
        return;
      }

      const shouldDelete = window.confirm("이 거래를 삭제하시겠습니까?");
      if (shouldDelete) {
        stageDelete(deleteButton.dataset.deleteId);
      }
      return;
    }

    const row = event.target.closest("[data-row-id]");
    if (!row || !window.matchMedia("(max-width: 640px)").matches) {
      return;
    }

    uiState.expandedTransactionId = uiState.expandedTransactionId === row.dataset.rowId ? null : row.dataset.rowId;
    renderTransactions();
  }

  function handlePaginationClick(event) {
    const button = event.target.closest("[data-page-action]");
    if (!button || button.disabled) {
      return;
    }

    if (button.dataset.pageAction === "prev") {
      uiState.currentPage = Math.max(1, uiState.currentPage - 1);
    } else if (button.dataset.pageAction === "next") {
      uiState.currentPage += 1;
    } else if (button.dataset.pageAction === "page") {
      uiState.currentPage = Number(button.dataset.page) || 1;
    }

    renderTransactions();
  }

  function handleSummaryCardClick(event) {
    const card = event.target.closest("[data-summary-type]");
    if (card) {
      openSummary(card.dataset.summaryType);
    }
  }

  function handleSummaryCardKeydown(event) {
    const card = event.target.closest("[data-summary-type]");
    if (card && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      openSummary(card.dataset.summaryType);
    }
  }

  function openSummary(summaryType) {
    const details = budgetAPI.getSummaryDetails(summaryType, getViewTransactions(getFilter()));
    dom.modalTitle.textContent = details.title;
    dom.modalTotal.textContent = formatAmount(details.total);

    if (details.kind === "balance") {
      dom.modalBody.innerHTML = `
        <div class="modal-balance-box">
          <p>잔액 = 총수입 - 총지출 - 총저축</p>
          <div class="modal-balance-row"><span>총수입</span><strong>${formatAmount(details.summary.income)}</strong></div>
          <div class="modal-balance-row"><span>총지출</span><strong>${formatAmount(details.summary.expense)}</strong></div>
          <div class="modal-balance-row"><span>총저축</span><strong>${formatAmount(details.summary.savings)}</strong></div>
          <div class="modal-balance-row"><span>잔액</span><strong>${formatAmount(details.summary.balance)}</strong></div>
        </div>
      `;
    } else if (details.transactions.length === 0) {
      dom.modalBody.innerHTML = '<div class="modal-empty">현재 필터 기준으로 해당 내역이 없습니다.</div>';
    } else {
      dom.modalBody.innerHTML = `
        <div class="modal-transaction-list">
          <div class="modal-transaction-head"><span>날짜</span><span>카테고리</span><span>메모</span><span>금액</span></div>
          ${details.transactions.map((transaction) => `
            <div class="modal-transaction-item">
              <span>${escapeHtml(transaction.date)}</span>
              <span class="modal-transaction-category">
                ${escapeHtml(transaction.category)}
                ${transaction.recordClass === "savings" ? '<span class="type-pill type-pill-savings">저축</span>' : ""}
              </span>
              <span class="modal-transaction-memo">${transaction.memo ? escapeHtml(transaction.memo) : "-"}</span>
              <strong class="amount-${transaction.type}">${transaction.type === "income" ? "+" : "-"}${formatAmount(transaction.amount)}</strong>
            </div>
          `).join("")}
        </div>
      `;
    }

    dom.summaryModal.classList.remove("hidden");
    dom.summaryModal.setAttribute("aria-hidden", "false");
  }

  function closeSummaryModal() {
    dom.summaryModal.classList.add("hidden");
    dom.summaryModal.setAttribute("aria-hidden", "true");
  }

  function startEditing(id) {
    const transaction = uiState.currentSnapshot.transactions.find((item) => item.id === id);
    if (!transaction) {
      return;
    }

    uiState.editingTransactionId = id;
    dom.formEyebrow.textContent = "내역 수정";
    dom.formStatus.classList.remove("hidden");
    dom.cancelEditButton.classList.remove("hidden");
    dom.submitButton.textContent = "거래 수정";
    dom.dateInput.value = transaction.date;
    dom.typeInput.value = transaction.type;
    updateCategoryOptions(transaction.type);
    dom.categoryInput.value = transaction.category;
    dom.amountInput.value = formatNumberWithCommas(transaction.amount);
    dom.memoInput.value = transaction.memo;
    dom.isFixedInput.checked = Boolean(transaction.isFixed);
    dom.recordClassSavingsInput.checked = transaction.recordClass === "savings";
    syncSavingsOptionVisibility();
    dom.amountInput.focus();
  }

  function resetForm() {
    dom.form.reset();
    uiState.editingTransactionId = null;
    dom.formEyebrow.textContent = "내역 추가";
    dom.formStatus.classList.add("hidden");
    dom.cancelEditButton.classList.add("hidden");
    dom.submitButton.textContent = "거래 추가";
    dom.dateInput.value = getTodayString();
    dom.typeInput.value = "expense";
    updateCategoryOptions("expense");
    syncSavingsOptionVisibility();
  }

  function openRecurringModal() {
    if (!uiState.currentSnapshot.currentUser) return;
    resetRecurringForm(); renderRecurringItems();
    dom.recurringModal.classList.remove("hidden"); dom.recurringModal.setAttribute("aria-hidden", "false");
  }

  function closeRecurringModal() { dom.recurringModal.classList.add("hidden"); dom.recurringModal.setAttribute("aria-hidden", "true"); }

  function resetRecurringForm() {
    uiState.editingRecurringItemId = null; dom.recurringItemForm.reset();
    dom.recurringType.value = "expense"; dom.recurringKind.value = "fixed";
    dom.recurringDayOfMonth.value = String(new Date().getDate()); dom.recurringStartDate.value = getTodayString();
    dom.recurringIsActive.checked = true; dom.recurringRecordClassSavings.checked = false; dom.recurringSubmitButton.textContent = "고정 항목 추가";
    dom.recurringCancelEditButton.classList.add("hidden"); updateRecurringCategoryOptions("expense");
    syncRecurringSavingsOptionVisibility();
  }

  function updateRecurringCategoryOptions(type, selected = "") {
    dom.recurringCategory.innerHTML = (categoriesByType[type] ?? []).map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
    if (selected && [...dom.recurringCategory.options].some((option) => option.value === selected)) dom.recurringCategory.value = selected;
  }

  async function handleRecurringSubmit(event) {
    event.preventDefault();
    const data = { name: dom.recurringName.value, type: dom.recurringType.value, amount: parseAmountInputValue(dom.recurringAmount.value), category: dom.recurringCategory.value, memo: dom.recurringMemo.value, kind: dom.recurringKind.value, dayOfMonth: Number(dom.recurringDayOfMonth.value), startDate: dom.recurringStartDate.value, recordClass: dom.recurringRecordClassSavings.checked ? "savings" : "normal", isActive: dom.recurringIsActive.checked };
    const result = uiState.editingRecurringItemId ? await budgetAPI.updateRecurringItem(uiState.editingRecurringItemId, data) : await budgetAPI.createRecurringItem(data);
    if (!result.ok) { showMessage(result.reason ?? "고정 항목 저장에 실패했습니다", "error"); return; }
    resetRecurringForm(); renderRecurringItems(); showMessage("고정 항목이 저장되었습니다", "success");
  }

  function handleRecurringListClick(event) {
    const button = event.target.closest("[data-recurring-action]"); if (!button) return;
    const item = uiState.currentSnapshot.recurringItems.find((current) => current.id === button.dataset.recurringId); if (!item) return;
    if (button.dataset.recurringAction === "edit") {
      uiState.editingRecurringItemId = item.id; dom.recurringName.value = item.name; dom.recurringType.value = item.type; updateRecurringCategoryOptions(item.type, item.category); dom.recurringAmount.value = formatNumberWithCommas(item.amount); dom.recurringKind.value = item.kind; dom.recurringDayOfMonth.value = item.dayOfMonth; dom.recurringStartDate.value = item.startDate; dom.recurringMemo.value = item.memo ?? ""; dom.recurringRecordClassSavings.checked = item.recordClass === "savings"; dom.recurringIsActive.checked = item.isActive !== false; syncRecurringSavingsOptionVisibility(); dom.recurringSubmitButton.textContent = "고정 항목 수정"; dom.recurringCancelEditButton.classList.remove("hidden"); dom.recurringModalBody.scrollTo({ top: 0, behavior: "smooth" }); window.setTimeout(() => dom.recurringName.focus(), 180); return;
    }
    if (button.dataset.recurringAction === "toggle") {
      budgetAPI.updateRecurringItem(item.id, { isActive: !item.isActive }).then((result) => { if (!result.ok) showMessage(result.reason ?? "상태 변경에 실패했습니다", "error"); }); return;
    }
    if (button.dataset.recurringAction === "delete" && window.confirm("이 설정을 삭제해도 기존 거래 내역은 유지됩니다. 삭제할까요?")) {
      budgetAPI.deleteRecurringItem(item.id).then((result) => { if (!result.ok) showMessage(result.reason ?? "삭제에 실패했습니다", "error"); });
    }
  }

  function renderRecurringItems() {
    const items = uiState.currentSnapshot.recurringItems ?? [];
    dom.recurringItemList.innerHTML = items.length ? items.map((item) => `<article class="recurring-item-card ${item.isActive === false ? "is-paused" : ""}"><div><strong>${escapeHtml(item.name)}</strong><span>${item.type === "income" ? "수입" : "지출"} · ${item.kind === "subscription" ? "구독" : "고정"} · 매월 ${item.dayOfMonth}일</span>${item.recordClass === "savings" ? '<span class="recurring-savings-badge">저축</span>' : ""}</div><div class="recurring-item-meta"><b>${formatAmount(item.amount)}</b><span>${item.isActive === false ? "일시 중지" : "활성"}</span></div><div class="recurring-item-actions"><button type="button" class="secondary-button" data-recurring-action="edit" data-recurring-id="${item.id}">수정</button><button type="button" class="secondary-button" data-recurring-action="toggle" data-recurring-id="${item.id}">${item.isActive === false ? "재개" : "일시 중지"}</button><button type="button" class="delete-button" data-recurring-action="delete" data-recurring-id="${item.id}">삭제</button></div></article>`).join("") : "<p class=\"modal-empty\">등록된 고정 항목이 없습니다.</p>";
  }

  function syncRecurringSavingsOptionVisibility() {
    const visible = dom.recurringType.value === "expense";
    dom.recurringRecordClassSavingsField.classList.toggle("hidden", !visible);
    dom.recurringRecordClassSavings.disabled = !visible;
    if (!visible) dom.recurringRecordClassSavings.checked = false;
  }

  function stageDelete(id) {
    if (uiState.pendingDelete?.timerId) {
      window.clearTimeout(uiState.pendingDelete.timerId);
    }

    const transaction = uiState.currentSnapshot.transactions.find((item) => item.id === id);
    if (!transaction) {
      return;
    }

    uiState.pendingDelete = {
      transaction,
      timerId: window.setTimeout(async () => {
        await commitDelete();
      }, 3000),
    };

    uiState.currentSnapshot = {
      ...uiState.currentSnapshot,
      transactions: uiState.currentSnapshot.transactions.filter((item) => item.id !== id),
    };
    render();
    showMessage("삭제 대기 중입니다", "success", {
      actionLabel: "실행 취소",
      actionName: "undo-delete",
      sticky: true,
    });
  }

  async function commitDelete() {
    if (!uiState.pendingDelete || uiState.isDeleting) {
      return;
    }

    const target = uiState.pendingDelete.transaction;
    uiState.pendingDelete = null;
    uiState.isDeleting = true;
    render();

    try {
      const confirmation = await budgetAPI.deleteTransaction(target.id);
      if (!confirmation.requiresConfirmation) {
        showMessage(confirmation.reason ?? "삭제에 실패했습니다", "error");
        await budgetAPI.refresh();
        return;
      }

      const result = await budgetAPI.confirmAction(confirmation.confirmationId);
      if (!result.ok) {
        showMessage(result.reason ?? "삭제에 실패했습니다", "error");
        await budgetAPI.refresh();
        return;
      }

      showMessage(
        result.stoppedRecurring
          ? (result.mode === "offline" ? "오프라인 상태로 고정 항목 자동 생성 중단이 예약되었습니다" : "고정 항목 자동 생성을 중단했습니다")
          : (result.mode === "offline" ? "오프라인 상태로 삭제가 예약되었습니다" : "삭제되었습니다"),
        "success",
      );
    } catch (error) {
      console.error(error);
      showMessage("삭제에 실패했습니다", "error");
      await budgetAPI.refresh();
    } finally {
      uiState.isDeleting = false;
      render();
    }
  }

  async function undoPendingDelete() {
    if (!uiState.pendingDelete) {
      return;
    }

    window.clearTimeout(uiState.pendingDelete.timerId);
    uiState.pendingDelete = null;
    await budgetAPI.refresh();
    showMessage("삭제가 취소되었습니다", "success");
  }

  async function handleExport(format) {
    if (uiState.isExporting) {
      return;
    }

    const label = format === "csv" ? "CSV" : "JSON";
    const shouldExport = window.confirm(`${label} 파일로 내보내시겠습니까?`);
    if (!shouldExport) {
      return;
    }

    uiState.isExporting = true;
    render();

    try {
      const result = budgetAPI.exportTransactions(format, getFilter());
      if (!result.ok) {
        showMessage(`${label} 내보내기에 실패했습니다`, "error");
        return;
      }

      showMessage(`${label} 내보내기가 완료되었습니다`, "success");
    } catch (error) {
      console.error(error);
      showMessage(`${label} 내보내기에 실패했습니다`, "error");
    } finally {
      uiState.isExporting = false;
      render();
    }
  }

  function render() {
    renderAuthState();
    syncMonthOptions();
    syncPeriodUi();
    renderSummary();
    renderStatistics();
    renderTransactions();
    renderSyncStatus();
    if (!dom.recurringModal.classList.contains("hidden")) renderRecurringItems();
  }

  function renderAuthState() {
    const isAuthenticated = Boolean(uiState.currentSnapshot.currentUser);
    dom.authStatusText.textContent = isAuthenticated
      ? `${uiState.currentSnapshot.currentUser.displayName ?? uiState.currentSnapshot.currentUser.email ?? "사용자"} 로그인됨`
      : "로그인이 필요합니다";
    dom.authBar.classList.toggle("hidden", !isAuthenticated);
    dom.authGate.classList.toggle("hidden", isAuthenticated);
    document.body.classList.toggle("auth-locked", !isAuthenticated);
    dom.signOutButton.classList.toggle("hidden", !isAuthenticated);

    [
      ...dom.form.querySelectorAll("input, select, button"),
      dom.transactionTypeFilterInput,
      dom.transactionSortInput,
      dom.transactionSearchInput,
      dom.statisticsTypeInput,
      dom.periodToggleButton,
      dom.allTimeButton,
      dom.thisMonthButton,
      dom.prevYearButton,
      dom.nextYearButton,
    ].forEach((element) => {
      element.disabled = !isAuthenticated;
    });

    dom.exportCsvButton.disabled = !isAuthenticated || uiState.isExporting;
    dom.exportJsonButton.disabled = !isAuthenticated || uiState.isExporting;
    dom.recurringManagementButton.disabled = !isAuthenticated;
  }

  function renderSummary() {
    const summary = budgetAPI.calculateSummary(getViewTransactions(getFilter()));
    dom.totalIncomeElement.textContent = formatAmount(summary.income);
    dom.totalFixedIncomeElement.textContent = formatAmount(summary.fixedIncome);
    dom.totalExpenseElement.textContent = formatAmount(summary.expense);
    dom.totalSavingsElement.textContent = formatAmount(summary.savings);
    dom.fixedExpenseRatioElement.textContent = `고정비 비율: ${summary.expense === 0 ? "-" : `${summary.fixedExpenseRatio}%`}`;
    dom.balanceElement.textContent = formatAmount(summary.balance);
    dom.totalFixedExpenseElement.textContent = formatAmount(summary.fixedExpense);
    dom.totalVariableExpenseElement.textContent = formatAmount(summary.variableExpense);
  }

  function renderStatistics() {
    const items = getViewTransactions(getFilter());
    const statisticType = dom.statisticsTypeInput.value;

    if (statisticType === "all") {
      const overall = budgetAPI.calculateOverallStats(items);
      dom.chartTitle.textContent = "전체";
      dom.chartTotal.textContent = formatAmount(overall.totalFlow);
      if (overall.totalFlow === 0) {
        dom.pieChart.style.background = "conic-gradient(#d8d1c6 0deg 360deg)";
        dom.statisticsEmpty.textContent = "선택한 기간에 수입, 지출, 저축 데이터가 없습니다.";
        dom.statisticsEmpty.classList.remove("hidden");
        dom.statisticsList.classList.add("hidden");
        dom.statisticsList.innerHTML = "";
        return;
      }

      const flowItems = overall.items.filter((item) => item.category !== "잔액" && item.amount > 0);
      dom.pieChart.style.background = buildGradient(flowItems, overall.totalFlow);
      dom.statisticsEmpty.classList.add("hidden");
      dom.statisticsList.classList.remove("hidden");
      dom.statisticsList.innerHTML = overall.items.map((item) => `
        <li class="statistics-item">
          <span class="statistics-swatch" style="background:${item.color}"></span>
          <span class="statistics-category">${item.category}</span>
          <span class="statistics-share">${item.shareText}</span>
          <span class="statistics-amount">${formatAmount(item.amount)}</span>
        </li>
      `).join("");
      return;
    }

    const stats = budgetAPI.calculateCategoryStats(items, statisticType);
    const totalAmount = stats.reduce((sum, item) => sum + item.amount, 0);
    dom.chartTitle.textContent = statisticType === "income" ? "수입" : "지출";
    dom.chartTotal.textContent = formatAmount(totalAmount);
    dom.statisticsEmpty.textContent = "선택한 유형에 대한 데이터가 아직 없습니다.";

    if (stats.length === 0) {
      dom.pieChart.style.background = "conic-gradient(#d8d1c6 0deg 360deg)";
      dom.statisticsEmpty.classList.remove("hidden");
      dom.statisticsList.classList.add("hidden");
      dom.statisticsList.innerHTML = "";
      return;
    }

    dom.pieChart.style.background = buildGradient(stats, totalAmount);
    dom.statisticsEmpty.classList.add("hidden");
    dom.statisticsList.classList.remove("hidden");
    dom.statisticsList.innerHTML = stats.map((item) => `
      <li class="statistics-item">
        <span class="statistics-swatch" style="background:${item.color}"></span>
        <span class="statistics-category">${escapeHtml(item.category)}</span>
        <span class="statistics-share">${item.share}%</span>
        <span class="statistics-amount">${formatAmount(item.amount)}</span>
      </li>
    `).join("");
  }

  function renderTransactions() {
    const allVisible = getViewTransactions(getFilter());
    const totalPages = Math.max(1, Math.ceil(allVisible.length / ITEMS_PER_PAGE));
    uiState.currentPage = Math.min(uiState.currentPage, totalPages);
    const startIndex = (uiState.currentPage - 1) * ITEMS_PER_PAGE;
    const visibleItems = allVisible.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    const hasAnyTransactions = uiState.currentSnapshot.transactions.length > 0;
    const isAuthenticated = Boolean(uiState.currentSnapshot.currentUser);
    const searchKeyword = dom.transactionSearchInput.value.trim();

    if (!isAuthenticated) {
      dom.emptyState.classList.remove("hidden");
      dom.emptyState.innerHTML = "<p>Google 계정으로 로그인하면 거래 내역을 불러올 수 있습니다.</p>";
      dom.transactionCount.textContent = "0건";
      dom.transactionList.innerHTML = "";
      renderPagination(0);
      return;
    }

    dom.transactionCount.textContent = `${allVisible.length}건`;
    dom.emptyState.classList.toggle("hidden", allVisible.length > 0);
    dom.emptyState.innerHTML = hasAnyTransactions
      ? `<p>${searchKeyword ? `"${escapeHtml(searchKeyword)}"에 대한 검색 결과가 없습니다.` : "검색 결과가 없습니다."}</p>`
      : "<p>거래 내역이 아직 없습니다. 위에서 첫 수입 또는 지출을 추가해 보세요.</p>";

    if (allVisible.length === 0) {
      dom.transactionList.innerHTML = "";
      renderPagination(0);
      return;
    }

    let previousDate = "";
    dom.transactionList.innerHTML = visibleItems.map((transaction) => {
      const badgeLabel = transaction.recordClass === "savings" ? "저축" : (transaction.type === "income" ? "수입" : "지출");
      const badgeClass = transaction.recordClass === "savings" ? "type-pill-savings" : `type-pill-${transaction.type}`;
      const isExpanded = uiState.expandedTransactionId === transaction.id;
      const startsNewDateGroup = transaction.date !== previousDate;
      previousDate = transaction.date;
      const dateHeader = startsNewDateGroup
        ? `<tr class="transaction-date-row"><td colspan="7">${escapeHtml(transaction.date)}</td></tr>`
        : "";
      return `
        ${dateHeader}
        <tr class="transaction-row${isExpanded ? " is-expanded" : ""}" data-row-id="${transaction.id}" aria-expanded="${isExpanded ? "true" : "false"}">
          <td></td>
          <td><div class="type-pill-group"><span class="type-pill ${badgeClass}">${badgeLabel}</span></div></td>
          <td>${escapeHtml(transaction.category)}</td>
          <td>${transaction.isFixed ? "고정" : "-"}</td>
          <td class="amount-${transaction.type}">${transaction.type === "income" ? "+" : "-"}${formatAmount(transaction.amount)}</td>
          <td>${transaction.memo ? escapeHtml(transaction.memo) : "-"}</td>
          <td>
            <button type="button" class="edit-button" data-edit-id="${transaction.id}">수정</button>
            <button type="button" class="delete-button" data-delete-id="${transaction.id}" ${uiState.isDeleting || uiState.pendingDelete ? "disabled" : ""}>삭제</button>
          </td>
        </tr>
      `;
    }).join("");

    renderPagination(allVisible.length);
  }

  function renderPagination(totalItems) {
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
    if (totalPages <= 1) {
      dom.paginationElement.classList.add("hidden");
      dom.paginationElement.innerHTML = "";
      return;
    }

    const pageButtons = Array.from({ length: totalPages }, (_, index) => {
      const pageNumber = index + 1;
      return `
        <button type="button" class="pagination-button${pageNumber === uiState.currentPage ? " is-active" : ""}" data-page-action="page" data-page="${pageNumber}">
          ${pageNumber}
        </button>
      `;
    }).join("");

    dom.paginationElement.classList.remove("hidden");
    dom.paginationElement.innerHTML = `
      <button type="button" class="pagination-button pagination-nav-button" data-page-action="prev" ${uiState.currentPage === 1 ? "disabled" : ""}>&lt; Prev</button>
      ${pageButtons}
      <button type="button" class="pagination-button pagination-nav-button" data-page-action="next" ${uiState.currentPage === totalPages ? "disabled" : ""}>Next &gt;</button>
    `;
  }

  function renderSyncStatus() {
    if (!uiState.currentSnapshot.currentUser) {
      hideSyncStatusBanner();
      return;
    }

    if (!uiState.currentSnapshot.online) {
      setSyncStatus("offline", "오프라인 상태입니다. 변경 사항은 기기에 임시 저장됩니다");
      return;
    }

    if (uiState.currentSnapshot.loading) {
      setSyncStatus("syncing", "데이터를 불러오는 중입니다...");
      return;
    }

    setSyncStatus("online", "온라인 상태");
    uiState.syncStatusTimeoutId = window.setTimeout(hideSyncStatusBanner, 1200);
  }

  function syncMonthOptions() {
    const months = [...new Set(
      uiState.currentSnapshot.transactions
        .map((item) => item.date?.slice(0, 7))
        .filter((value) => /^\d{4}-\d{2}$/.test(value)),
    )].sort((left, right) => right.localeCompare(left));

    dom.monthFilterInput.innerHTML = [
      '<option value="all">전체 기간</option>',
      ...months.map((month) => `<option value="${month}">${formatMonthLabel(month)}</option>`),
    ].join("");

    if (uiState.periodValue !== "all" && !months.includes(uiState.periodValue)) {
      uiState.periodValue = "all";
    }

    dom.monthFilterInput.value = uiState.periodValue;
  }

  function syncPeriodUi() {
    dom.selectedPeriodLabel.textContent = uiState.periodValue === "all" ? "전체 기간" : formatMonthLabel(uiState.periodValue);
    dom.periodSelectionPanel.classList.toggle("hidden", !uiState.periodPanelOpen);
    dom.periodToggleButton.setAttribute("aria-expanded", uiState.periodPanelOpen ? "true" : "false");
    dom.periodPanelYearLabel.textContent = `${uiState.periodPanelYear}년`;
    dom.allTimeButton.classList.toggle("is-active", uiState.periodValue === "all");

    const monthButtons = Array.from({ length: 12 }, (_, index) => {
      const month = String(index + 1).padStart(2, "0");
      const value = `${uiState.periodPanelYear}-${month}`;
      const isActive = uiState.periodValue === value;
      return `
        <button type="button" class="period-option-button${isActive ? " is-active" : ""}" data-period-value="${value}">
          ${index + 1}월
        </button>
      `;
    }).join("");

    dom.periodMonthGrid.innerHTML = monthButtons;
    dom.monthFilterInput.value = uiState.periodValue;
  }

  function togglePeriodPanel() {
    uiState.periodPanelOpen = !uiState.periodPanelOpen;
    syncPeriodUi();
  }

  function setPeriodValue(value, options = {}) {
    const nextValue = value || "all";
    uiState.periodValue = nextValue;
    uiState.currentPage = 1;
    if (nextValue !== "all") {
      uiState.periodPanelYear = Number(nextValue.split("-")[0]) || uiState.periodPanelYear;
    }
    if (options.closePanel !== false) {
      uiState.periodPanelOpen = false;
    }
    render();
  }

  function updateCategoryOptions(type) {
    const categories = categoriesByType[type] ?? [];
    const previousValue = dom.categoryInput.value;
    dom.categoryInput.innerHTML = categories.map((category) => `
      <option value="${escapeHtml(category)}">${escapeHtml(category)}</option>
    `).join("");

    if (categories.includes(previousValue)) {
      dom.categoryInput.value = previousValue;
    } else if (categories.length > 0) {
      dom.categoryInput.value = categories[0];
    }
  }

  function syncSavingsOptionVisibility() {
    const visible = dom.typeInput.value === "expense";
    dom.recordClassSavingsField.classList.toggle("hidden", !visible);
    if (!visible) {
      dom.recordClassSavingsInput.checked = false;
    }
  }

  function getFilter() {
    return {
      month: uiState.periodValue,
      type: uiState.currentTypeFilter,
      sort: uiState.currentSortOption,
      search: dom.transactionSearchInput.value.trim(),
    };
  }

  function getViewTransactions(filter) {
    return budgetAPI.queryTransactions(uiState.currentSnapshot.transactions, filter);
  }

  function showMessage(message, type = "success", options = {}) {
    if (uiState.messageTimeoutId) {
      window.clearTimeout(uiState.messageTimeoutId);
      uiState.messageTimeoutId = null;
    }

    const actionHtml = options.actionLabel && options.actionName
      ? `<button type="button" class="secondary-button" data-message-action="${escapeHtml(options.actionName)}">${escapeHtml(options.actionLabel)}</button>`
      : "";

    dom.appMessage.className = `app-message app-message-${type}`;
    dom.appMessage.innerHTML = `
      <span>${escapeHtml(message)}</span>
      ${actionHtml}
    `;
    dom.appMessage.classList.remove("hidden");

    if (!options.sticky) {
      uiState.messageTimeoutId = window.setTimeout(() => {
        dom.appMessage.classList.add("hidden");
        uiState.messageTimeoutId = null;
      }, 2400);
    }
  }

  function setSyncStatus(status, message) {
    if (uiState.syncStatusTimeoutId) {
      window.clearTimeout(uiState.syncStatusTimeoutId);
      uiState.syncStatusTimeoutId = null;
    }

    dom.syncStatusBanner.textContent = message;
    dom.syncStatusBanner.classList.remove("hidden", "sync-status-online", "sync-status-offline", "sync-status-syncing");
    dom.syncStatusBanner.classList.add(`sync-status-${status}`);
  }

  function hideSyncStatusBanner() {
    dom.syncStatusBanner.classList.add("hidden");
  }
}

function buildGradient(statistics, totalAmount) {
  if (!Array.isArray(statistics) || statistics.length === 0 || totalAmount <= 0) {
    return "conic-gradient(#d8d1c6 0deg 360deg)";
  }

  let offset = 0;
  const slices = statistics.map((item) => {
    const start = offset;
    const size = (item.amount / totalAmount) * 360;
    offset += size;
    return `${item.color} ${start}deg ${offset}deg`;
  });
  return `conic-gradient(${slices.join(", ")})`;
}

function getDomRefs() {
  return {
    authBar: document.getElementById("authBar"),
    authStatusText: document.getElementById("authStatusText"),
    signOutButton: document.getElementById("signOutButton"),
    authGate: document.getElementById("authGate"),
    authGateSignInButton: document.getElementById("authGateSignInButton"),
    syncStatusBanner: document.getElementById("syncStatusBanner"),
    appMessage: document.getElementById("appMessage"),
    summarySection: document.getElementById("summary"),
    selectedPeriodLabel: document.getElementById("selectedPeriodLabel"),
    periodToggleButton: document.getElementById("periodToggleButton"),
    periodSelectionPanel: document.getElementById("periodSelectionPanel"),
    allTimeButton: document.getElementById("allTimeButton"),
    thisMonthButton: document.getElementById("thisMonthButton"),
    prevYearButton: document.getElementById("prevYearButton"),
    nextYearButton: document.getElementById("nextYearButton"),
    periodPanelYearLabel: document.getElementById("periodPanelYearLabel"),
    periodMonthGrid: document.getElementById("periodMonthGrid"),
    form: document.getElementById("transactionForm"),
    formEyebrow: document.getElementById("formEyebrow"),
    formStatus: document.getElementById("formStatus"),
    recurringManagementButton: document.getElementById("recurringManagementButton"),
    dateInput: document.getElementById("date"),
    todayButton: document.getElementById("todayButton"),
    typeInput: document.getElementById("type"),
    amountInput: document.getElementById("amount"),
    categoryInput: document.getElementById("category"),
    memoInput: document.getElementById("memo"),
    isFixedInput: document.getElementById("isFixed"),
    recordClassSavingsField: document.getElementById("recordClassSavingsField"),
    recordClassSavingsInput: document.getElementById("recordClassSavings"),
    submitButton: document.getElementById("submitButton"),
    cancelEditButton: document.getElementById("cancelEditButton"),
    recurringModal: document.getElementById("recurringModal"),
    recurringModalBody: document.getElementById("recurringModalBody"),
    recurringModalCloseButton: document.getElementById("recurringModalCloseButton"),
    recurringItemForm: document.getElementById("recurringItemForm"),
    recurringName: document.getElementById("recurringName"),
    recurringType: document.getElementById("recurringType"),
    recurringAmount: document.getElementById("recurringAmount"),
    recurringCategory: document.getElementById("recurringCategory"),
    recurringKind: document.getElementById("recurringKind"),
    recurringDayOfMonth: document.getElementById("recurringDayOfMonth"),
    recurringStartDate: document.getElementById("recurringStartDate"),
    recurringMemo: document.getElementById("recurringMemo"),
    recurringRecordClassSavingsField: document.getElementById("recurringRecordClassSavingsField"),
    recurringRecordClassSavings: document.getElementById("recurringRecordClassSavings"),
    recurringIsActive: document.getElementById("recurringIsActive"),
    recurringSubmitButton: document.getElementById("recurringSubmitButton"),
    recurringCancelEditButton: document.getElementById("recurringCancelEditButton"),
    recurringItemList: document.getElementById("recurringItemList"),
    statisticsTypeInput: document.getElementById("statisticsType"),
    pieChart: document.getElementById("pieChart"),
    chartTitle: document.getElementById("chartTitle"),
    chartTotal: document.getElementById("chartTotal"),
    statisticsEmpty: document.getElementById("statisticsEmpty"),
    statisticsList: document.getElementById("statisticsList"),
    monthFilterInput: document.getElementById("monthFilter"),
    transactionCount: document.getElementById("transactionCount"),
    transactionTypeFilterInput: document.getElementById("transactionTypeFilter"),
    transactionSortInput: document.getElementById("transactionSort"),
    transactionSearchInput: document.getElementById("transactionSearch"),
    exportCsvButton: document.getElementById("exportCsvButton"),
    exportJsonButton: document.getElementById("exportJsonButton"),
    emptyState: document.getElementById("emptyState"),
    transactionList: document.getElementById("transactionList"),
    paginationElement: document.getElementById("pagination"),
    summaryModal: document.getElementById("summaryModal"),
    modalCloseButton: document.getElementById("modalCloseButton"),
    modalTitle: document.getElementById("modalTitle"),
    modalBody: document.getElementById("modalBody"),
    modalTotal: document.getElementById("modalTotal"),
    totalIncomeElement: document.getElementById("totalIncome"),
    totalFixedIncomeElement: document.getElementById("totalFixedIncome"),
    totalExpenseElement: document.getElementById("totalExpense"),
    totalSavingsElement: document.getElementById("totalSavings"),
    fixedExpenseRatioElement: document.getElementById("fixedExpenseRatio"),
    balanceElement: document.getElementById("balance"),
    totalFixedExpenseElement: document.getElementById("totalFixedExpense"),
    totalVariableExpenseElement: document.getElementById("totalVariableExpense"),
  };
}
