export const DEFAULT_DERIV_APP_ID = "34ARk0NOmxpaMAqV6Bwgg";

export const isLegacyAppId = (value: string) => /^\d{1,8}$/.test(value.trim());
export const isValidAppId = (value: string) => isLegacyAppId(value) || /^[A-Za-z0-9]{20,32}$/.test(value.trim());
export const isPersonalAccessToken = (value: string) => /^pat_[a-fA-F0-9]{64}$/.test(value.trim());
export const isValidToken = (value: string) => /^[A-Za-z0-9]{12,40}$/.test(value.trim()) || isPersonalAccessToken(value);

export function validateCredentials(appId: string, token: string): string | null {
  if (!isValidAppId(appId)) return "Enter a numeric legacy App ID or your new alphanumeric Deriv App ID.";
  if (token && !isValidToken(token)) return "Enter a valid Deriv API token or personal access token (pat_…).";
  if (token && isLegacyAppId(appId) === isPersonalAccessToken(token)) {
    return isLegacyAppId(appId)
      ? "A personal access token needs the new alphanumeric Deriv App ID."
      : "This App ID needs a Deriv personal access token (pat_…).";
  }
  return null;
}