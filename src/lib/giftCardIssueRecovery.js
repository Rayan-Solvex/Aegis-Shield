const GIFT_CARD_ISSUE_RECOVERY_KEY = 'aegis:gift-card:issue-recovery:v1';

export function loadGiftCardIssueRecovery() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(GIFT_CARD_ISSUE_RECOVERY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveGiftCardIssueRecovery(payload) {
  if (typeof window === 'undefined') {
    return payload;
  }

  const nextPayload = {
    ...payload,
    updatedAt: new Date().toISOString(),
  };

  try {
    window.sessionStorage.setItem(GIFT_CARD_ISSUE_RECOVERY_KEY, JSON.stringify(nextPayload));
  } catch {
    // Ignore storage failures.
  }

  return nextPayload;
}

export function clearGiftCardIssueRecovery() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.removeItem(GIFT_CARD_ISSUE_RECOVERY_KEY);
  } catch {
    // Ignore storage failures.
  }
}