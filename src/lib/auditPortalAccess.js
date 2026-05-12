export const AUDIT_PORTAL_DEV_BYPASS = true;

export function canOpenAuditReview(hasResolvedViewingKey) {
  if (AUDIT_PORTAL_DEV_BYPASS) {
    return true;
  }

  return Boolean(hasResolvedViewingKey);
}

export function shouldGateAuditPortalViews() {
  return !AUDIT_PORTAL_DEV_BYPASS;
}