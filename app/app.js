import { initializeApp as initializeFirebaseApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { createBudgetAPI } from "./api/budgetApi.js";
import { firebaseConfig } from "./config.js";
import { createLoggerService } from "./services/logger.js";
import { createStorageService } from "./services/storage.js";
import { createSyncService } from "./services/sync.js";
import { createValidationService } from "./services/validation.js";
import { initializeBudgetUiApp } from "./ui/app.js";

export async function initializeBudgetApp() {
  const firebaseApp = initializeFirebaseApp(firebaseConfig);
  const auth = getAuth(firebaseApp);
  const db = getFirestore(firebaseApp);
  const googleProvider = new GoogleAuthProvider();

  const logger = createLoggerService();
  const storage = createStorageService({ db });
  const syncService = createSyncService({ storage, logger });
  const validation = createValidationService();
  const budgetAPI = createBudgetAPI({
    auth,
    googleProvider,
    storage,
    syncService,
    validation,
    logger,
  });

  await initializeBudgetUiApp({ budgetAPI });

  onAuthStateChanged(auth, async (user) => {
    await budgetAPI.setCurrentUser(user);
  });
}
