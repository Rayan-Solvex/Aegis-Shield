const AUDIT_REVIEW_SESSION_KEY = 'aegis:audit-review-session:v1';

export function saveAuditReviewSession(payload) {
  if (typeof window === 'undefined') {
    return payload;
  }

  try {
    const nextPayload = {
      ...payload,
      savedAt: new Date().toISOString(),
    };
    window.sessionStorage.setItem(AUDIT_REVIEW_SESSION_KEY, JSON.stringify(nextPayload));
    return nextPayload;
  } catch {
    return payload;
  }
}

export function loadAuditReviewSession() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(AUDIT_REVIEW_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearAuditReviewSession() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.removeItem(AUDIT_REVIEW_SESSION_KEY);
  } catch {
    // Ignore storage failures.
  }
}