import { createUiController } from "./uiController.js";

export async function initializeBudgetUiApp({ budgetAPI }) {
  const uiController = createUiController({ budgetAPI });
  await uiController.initialize();
}
