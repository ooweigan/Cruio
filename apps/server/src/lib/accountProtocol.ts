import { z } from "zod";

export const accountWalletSchema = z.object({
  balance: z.number().finite(),
  currency: z.string().min(1).max(32),
  group: z.string().min(1).max(128),
  billingGroup: z.string().min(1).max(128),
  groupRatio: z.number().finite().nonnegative().nullable(),
});
export type AccountWallet = z.infer<typeof accountWalletSchema>;

export const accountRedemptionSchema = z.object({
  amount: z.number().finite().positive(),
  currency: z.string().min(1).max(32),
});
export type AccountRedemption = z.infer<typeof accountRedemptionSchema>;

export type AccountStatus = "anonymous" | "authenticated" | "expired" | "disabled";

export type AccountModelStatus = "available" | "notProvisioned" | "unavailable";

export type AccountUser = {
  id: string;
  displayName: string;
  account: string;
};

export type AccountBootstrap = {
  configured: boolean;
  supportUrl: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
  rememberSession: boolean;
};

export type AccountSession = {
  status: AccountStatus;
  contextId: string | null;
  user: AccountUser | null;
  expiresAt: string | null;
  modelAccess: {
    status: AccountModelStatus;
    message: string;
  };
};

export type AccountLoginRequest = {
  account: string;
  password: string;
};

export type AccountErrorReason =
  | "invalidCredentials"
  | "sessionExpired"
  | "accountDisabled"
  | "accountServiceUnavailable"
  | "accountServiceNotConfigured"
  | "rateLimited"
  | "modelNotProvisioned"
  | "modelAuthorizationUnavailable"
  | "walletUnavailable"
  | "redemptionRejected"
  | "redemptionUncertain"
  | "forbidden"
  | "accountConflict";

export type AccountErrorData = {
  reason: AccountErrorReason;
  retryAfter?: number;
};

export type AccountLogoutResult = {
  remoteRevoked: boolean;
};
