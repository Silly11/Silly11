import { getState } from "./domain";
import { findUser } from "./auth";
import { aiEnabled } from "./ai";
import { billingEnabled } from "./billing";
import { oauthProviders } from "./oauth";
import type { User } from "./types";
export function appState(user: User | null) {
  const state = getState(user);
  if (user) state.user = findUser(user.id);
  state.config = {
    aiEnabled: aiEnabled(),
    billingEnabled: billingEnabled(),
    oauthProviders: oauthProviders(),
    backupRetentionDays: Number(process.env.BACKUP_RETENTION_DAYS || 30),
  };
  return state;
}
