const LOG_STORAGE_KEY = "household-budget-action-log";
const MAX_LOG_ENTRIES = 500;
const MAX_STRING_LENGTH = 200;

export function createLoggerService() {
  return {
    // Keep a local audit trail so UI and future AI agents share the same accountability path.
    logAction({ action, permission, params, success, error = null, metadata = {} }) {
      return writeLog({
        kind: "action",
        action,
        permission,
        params,
        success,
        error,
        metadata,
      });
    },

    logSync({ action = "sync", params, success, error = null, metadata = {} }) {
      return writeLog({
        kind: "sync",
        action,
        permission: "WRITE",
        params,
        success,
        error,
        metadata,
      });
    },

    logValidationFailure({ action = "validation", params, reason, metadata = {} }) {
      return writeLog({
        kind: "validation",
        action,
        permission: "WRITE",
        params,
        success: false,
        error: reason,
        metadata,
      });
    },

    getLogs() {
      return loadLogs();
    },
  };
}

function writeLog({ kind, action, permission, params, success, error = null, metadata = {} }) {
  const entry = {
    id: createLogId(),
    kind,
    action,
    permission,
    params: sanitizeValue(params),
    success: Boolean(success),
    error: error ? String(error).slice(0, MAX_STRING_LENGTH) : "",
    metadata: sanitizeValue(metadata),
    timestamp: new Date().toISOString(),
  };

  const existing = loadLogs();
  const next = [...existing, entry].slice(-MAX_LOG_ENTRIES);
  localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(next));
  return entry;
}

function loadLogs() {
  try {
    const stored = localStorage.getItem(LOG_STORAGE_KEY);
    if (!stored) {
      return [];
    }
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("액션 로그를 불러오지 못했습니다.", error);
    return [];
  }
}

function createLogId() {
  return `log-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function sanitizeValue(value, depth = 0) {
  if (depth > 3) {
    return "[truncated]";
  }

  if (typeof value === "string") {
    return value.slice(0, MAX_STRING_LENGTH);
  }

  if (typeof value === "number" || typeof value === "boolean" || value == null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 20)
        .map(([key, item]) => [key, sanitizeValue(item, depth + 1)]),
    );
  }

  return String(value).slice(0, MAX_STRING_LENGTH);
}
