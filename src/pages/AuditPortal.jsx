import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Eye,
  Shield,
  Key,
  RefreshCw,
  CheckCheck,
  ArrowRight,
  Search,
  ChevronDown,
  ChevronUp,
  Info,
  Layers,
  Calendar,
  ExternalLink,
  Copy,
} from 'lucide-react';
import { Card, CardHeader, CardBody, CardFooter } from '../components/UI/Card.jsx';
import { Button } from '../components/UI/Button.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { shortenAddress } from '../lib/umbra.js';
import {
  decryptViewingCredentialEnvelope,
  getAuditorGrantSnapshot,
  isViewingGrantActive,
  verifyViewingGrantPackage,
} from '../lib/aegisAuditRegistry.js';
import {
  clearAuditReviewSession,
  loadAuditReviewSession,
  saveAuditReviewSession,
} from '../lib/auditReviewSession.js';
import { canOpenAuditReview, shouldGateAuditPortalViews, AUDIT_PORTAL_DEV_BYPASS } from '../lib/auditPortalAccess.js';
import { AuditReview } from './AuditReview.jsx';

const LOCAL_DELIVERY_KEY_PREFIX = 'aegis:audit:delivery-secret:';
const TABS = [
  { id: 'access', path: '/audit-portal/access', label: 'Auditor Access', icon: Eye },
  { id: 'review', path: '/audit-portal/review', label: 'Audit Review', icon: Search },
  { id: 'about', path: '/audit-portal/how-it-works', label: 'How It Works', icon: Info },
];

function getPortalTab(pathname) {
  if (pathname === '/audit-portal' || pathname === '/audit-portal/') {
    return null;
  }

  if (pathname.startsWith('/audit-portal/access')) {
    return 'access';
  }

  if (pathname.startsWith('/audit-portal/review')) {
    return 'review';
  }

  if (pathname.startsWith('/audit-portal/how-it-works')) {
    return 'about';
  }

  return null;
}

function formatDateTime(timestamp) {
  if (!timestamp) {
    return '—';
  }

  return new Date(timestamp * 1000).toLocaleString();
}

function formatStakeLamports(lamports) {
  if (!lamports && lamports !== 0) {
    return '—';
  }

  return `${(lamports / 1_000_000_000).toFixed(3)} SOL`;
}

function getMetricTone(tone) {
  const toneMap = {
    success: {
      card: 'border-aegis-green/20 bg-aegis-green/5',
      label: 'text-aegis-green/80',
      value: 'text-aegis-green',
    },
    warning: {
      card: 'border-aegis-amber/20 bg-aegis-amber/5',
      label: 'text-aegis-amber/80',
      value: 'text-aegis-amber',
    },
    danger: {
      card: 'border-aegis-red/20 bg-aegis-red/5',
      label: 'text-aegis-red/80',
      value: 'text-aegis-red',
    },
    neutral: {
      card: 'border-aegis-border/60 bg-aegis-card',
      label: 'text-aegis-muted',
      value: 'text-aegis-text',
    },
  };

  return toneMap[tone] ?? toneMap.neutral;
}

function getAuditorStatusPresentation(status) {
  const normalizedStatus = String(status || 'unknown').toLowerCase();

  if (normalizedStatus === 'approved' || normalizedStatus === 'verified' || normalizedStatus === 'active') {
    return { label: status, tone: 'success' };
  }

  if (normalizedStatus === 'pending' || normalizedStatus === 'unknown') {
    return { label: status || 'unknown', tone: 'warning' };
  }

  if (normalizedStatus === 'blacklisted' || normalizedStatus === 'inactive' || normalizedStatus === 'suspended' || normalizedStatus === 'slashed') {
    return { label: status, tone: 'danger' };
  }

  return { label: status || 'unknown', tone: 'warning' };
}

function getStakePresentation(stakeLamports, minStakeLamports) {
  const currentStake = Number(stakeLamports ?? 0);
  const minimumStake = Number(minStakeLamports ?? 0);
  const meetsMinimum = currentStake > 0 && currentStake >= minimumStake;

  return {
    label: formatStakeLamports(stakeLamports),
    tone: meetsMinimum ? 'success' : 'danger',
  };
}

function getGrantStatePresentation({ verifiedPackage, activeGrant }) {
  if (verifiedPackage && activeGrant) {
    return { label: 'authorized', tone: 'success' };
  }

  if (verifiedPackage && !activeGrant) {
    return { label: 'expired', tone: 'danger' };
  }

  return { label: 'unresolved', tone: 'warning' };
}

function getStoredDeliverySecret(auditorAddress) {
  if (!auditorAddress || typeof window === 'undefined') {
    return '';
  }

  try {
    return window.localStorage.getItem(`${LOCAL_DELIVERY_KEY_PREFIX}${auditorAddress}`) || '';
  } catch {
    return '';
  }
}

function saveStoredDeliverySecret(auditorAddress, secretKey) {
  if (!auditorAddress || typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(`${LOCAL_DELIVERY_KEY_PREFIX}${auditorAddress}`, secretKey);
}

function clearStoredDeliverySecret(auditorAddress) {
  if (!auditorAddress || typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(`${LOCAL_DELIVERY_KEY_PREFIX}${auditorAddress}`);
}

async function copyText(value) {
  await navigator.clipboard.writeText(value);
}

function extractViewingKey(payload) {
  const trimmed = String(payload || '').trim();
  if (!trimmed) {
    throw new Error('Resolved payload is empty');
  }

  try {
    const parsed = JSON.parse(trimmed);
    const candidates = [
      parsed?.masterViewingKey,
      parsed?.viewingKey,
      parsed?.mvk,
      parsed?.umbraViewingKey,
      parsed?.key,
      parsed?.value,
    ];
    const match = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim());

    if (match) {
      return match.trim();
    }
  } catch {
    return trimmed;
  }

  return trimmed;
}

function ConnectPrompt() {
  return (
    <Card>
      <CardBody className="space-y-4 text-center">
        <div className="w-12 h-12 rounded-2xl mx-auto bg-aegis-teal/10 border border-aegis-teal/20 flex items-center justify-center">
          <Shield className="w-5 h-5 text-aegis-teal" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-aegis-text">Connect an Approved Auditor Wallet</h2>
          <p className="text-xs text-aegis-muted mt-1 max-w-md mx-auto">
            The simplified portal resolves disclosure material only for the connected auditor wallet.
          </p>
        </div>
        <div className="flex justify-center">
          <WalletMultiButton />
        </div>
      </CardBody>
    </Card>
  );
}

export function AuditPortal() {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [reviewSession, setReviewSession] = useState(() => loadAuditReviewSession());

  const [proofShare, setProofShare] = useState('');
  const [resolving, setResolving] = useState(false);
  const [verifiedPackage, setVerifiedPackage] = useState(null);
  const [registrySnapshot, setRegistrySnapshot] = useState(null);
  const [resolvedPayload, setResolvedPayload] = useState('');
  const [resolvedViewingKey, setResolvedViewingKey] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [localDeliveryKey, setLocalDeliveryKey] = useState('');
  const [localKeySaved, setLocalKeySaved] = useState(false);
  const [copiedViewingKey, setCopiedViewingKey] = useState(false);

  const auditorAddress = publicKey?.toBase58() ?? '';
  const activeTab = useMemo(() => getPortalTab(location.pathname), [location.pathname]);
  const canAccessReview = canOpenAuditReview(reviewSession?.resolvedViewingKey || resolvedViewingKey);

  useEffect(() => {
    const storedSecret = getStoredDeliverySecret(auditorAddress);
    setLocalDeliveryKey(storedSecret);
    setLocalKeySaved(Boolean(storedSecret));
  }, [auditorAddress]);

  useEffect(() => {
    if (activeTab) {
      return;
    }

    navigate('/audit-portal/access', { replace: true });
  }, [activeTab, navigate]);

  useEffect(() => {
    if (!shouldGateAuditPortalViews() || activeTab !== 'review' || canAccessReview) {
      return;
    }

    toast.error('Resolve access in Auditor Access before opening Audit Review', {
      title: 'Audit Review Locked',
    });
    navigate('/audit-portal/access', { replace: true });
  }, [activeTab, canAccessReview, navigate, toast]);

  const accessState = useMemo(() => {
    if (!registrySnapshot) {
      return {
        approved: false,
        activeGrant: false,
      };
    }

    return {
      approved: Boolean(registrySnapshot.isApprovedAuditor),
      activeGrant: Boolean(isViewingGrantActive(registrySnapshot.grant)),
    };
  }, [registrySnapshot]);

  const auditorStatusPresentation = useMemo(
    () => getAuditorStatusPresentation(registrySnapshot?.profile?.status),
    [registrySnapshot?.profile?.status],
  );

  const stakePresentation = useMemo(
    () => getStakePresentation(
      registrySnapshot?.profile?.stakeLockedLamports,
      registrySnapshot?.config?.minAuditorStakeLamports,
    ),
    [registrySnapshot?.config?.minAuditorStakeLamports, registrySnapshot?.profile?.stakeLockedLamports],
  );

  const grantStatePresentation = useMemo(
    () => getGrantStatePresentation({ verifiedPackage, activeGrant: accessState.activeGrant }),
    [accessState.activeGrant, verifiedPackage],
  );

  const handleResolve = useCallback(async () => {
    if (!connected || !publicKey) {
      toast.error('Connect the approved auditor wallet first');
      return;
    }

    if (!proofShare.trim()) {
      toast.error('Paste Part A before resolving');
      return;
    }

    setResolving(true);
    try {
      const initialPackage = await verifyViewingGrantPackage({
        encodedPackage: proofShare.trim(),
        connectedAuditor: publicKey,
      });

      const snapshot = await getAuditorGrantSnapshot(connection, {
        auditorAuthority: publicKey,
        grantorAuthority: initialPackage.decodedPackage.parties.grantor,
        date: initialPackage.decodedPackage.scope.date,
      });

      if (!snapshot.profile) {
        throw new Error('No auditor profile exists for the connected wallet');
      }

      if (!snapshot.isApprovedAuditor) {
        throw new Error('Connected wallet is not an approved auditor with sufficient stake');
      }

      if (!isViewingGrantActive(snapshot.grant)) {
        throw new Error('No active disclosure grant exists for this proof share');
      }

      const verified = await verifyViewingGrantPackage({
        encodedPackage: proofShare.trim(),
        connectedAuditor: publicKey,
        registrySnapshot: snapshot,
      });

      const storedSecret = getStoredDeliverySecret(auditorAddress);
      if (!storedSecret) {
        throw new Error('No local auditor delivery key is stored for this wallet');
      }

      const plaintext = await decryptViewingCredentialEnvelope(
        verified.decodedPackage.delivery.envelope,
        storedSecret,
      );

      const viewingKey = extractViewingKey(plaintext);

      const nextReviewSession = saveAuditReviewSession({
        resolvedViewingKey: viewingKey,
        grantor: verified.decodedPackage.parties.grantor,
        scopeDate: verified.decodedPackage.scope.date,
        viewingGrantPda: verified.decodedPackage.registry.viewingGrantPda,
      });

      setRegistrySnapshot(snapshot);
      setVerifiedPackage(verified);
      setResolvedPayload(plaintext);
      setResolvedViewingKey(viewingKey);
      setReviewSession(nextReviewSession);
      toast.success('Viewing key resolved');
    } catch (error) {
      setVerifiedPackage(null);
      setRegistrySnapshot(null);
      setResolvedPayload('');
      setResolvedViewingKey('');
      clearAuditReviewSession();
      setReviewSession(null);
      toast.error(error.message, { title: 'Resolve Failed' });
    } finally {
      setResolving(false);
    }
  }, [auditorAddress, connected, connection, proofShare, publicKey, toast]);

  const handleSaveLocalKey = useCallback(() => {
    if (!auditorAddress) {
      toast.error('Connect the auditor wallet first');
      return;
    }

    if (!localDeliveryKey.trim()) {
      toast.error('Paste the local auditor delivery key first');
      return;
    }

    saveStoredDeliverySecret(auditorAddress, localDeliveryKey.trim());
    setLocalKeySaved(true);
    toast.success('Local auditor delivery key saved for this browser');
  }, [auditorAddress, localDeliveryKey, toast]);

  const handleClearLocalKey = useCallback(() => {
    clearStoredDeliverySecret(auditorAddress);
    setLocalDeliveryKey('');
    setLocalKeySaved(false);
    toast.success('Local auditor delivery key cleared');
  }, [auditorAddress, toast]);

  const handleClearResolve = useCallback(() => {
    setProofShare('');
    setVerifiedPackage(null);
    setRegistrySnapshot(null);
    setResolvedPayload('');
    setResolvedViewingKey('');
    setCopiedViewingKey(false);
    clearAuditReviewSession();
    setReviewSession(null);
  }, []);

  const handleCopyViewingKey = useCallback(async () => {
    if (!resolvedViewingKey) {
      return;
    }

    await copyText(resolvedViewingKey);
    setCopiedViewingKey(true);
    setTimeout(() => setCopiedViewingKey(false), 2000);
  }, [resolvedViewingKey]);

  const handleProceedToReview = useCallback(() => {
    if (!resolvedViewingKey) {
      return;
    }

    const reviewSession = saveAuditReviewSession({
      resolvedViewingKey,
      grantor: verifiedPackage?.decodedPackage?.parties?.grantor ?? null,
      scopeDate: verifiedPackage?.decodedPackage?.scope?.date ?? null,
      viewingGrantPda: verifiedPackage?.decodedPackage?.registry?.viewingGrantPda ?? null,
    });

    setReviewSession(reviewSession);

    navigate('/audit-portal/review', {
      state: reviewSession,
    });
  }, [navigate, resolvedViewingKey, verifiedPackage]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-aegis-teal/10 border border-aegis-teal/20 flex items-center justify-center">
          <Eye className="w-5 h-5 text-aegis-teal" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-aegis-text">Audit Portal</h1>
          <p className="text-xs text-aegis-muted">
            Resolve authorized viewing access and continue with the standard Umbra workflow
          </p>
        </div>
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-aegis-card border border-aegis-border w-fit">
        {TABS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                navigate(item.path);
              }}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
                ${activeTab === item.id
                  ? 'bg-aegis-surface border border-aegis-border text-aegis-text shadow-sm'
                  : 'text-aegis-muted hover:text-aegis-text'
                }
              `}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'access' && <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-aegis-text">Resolve Viewing Key</h2>
        </CardHeader>

        <CardBody className="space-y-6">
          {AUDIT_PORTAL_DEV_BYPASS && !connected && (
            <div className="rounded-xl border border-aegis-amber/20 bg-aegis-amber/5 p-4 text-xs text-aegis-amber">
              Development bypass is active. Tabs remain open without wallet authorization, but resolving access still requires a connected auditor wallet.
            </div>
          )}

          {!AUDIT_PORTAL_DEV_BYPASS && !connected && <ConnectPrompt />}

          <div className="space-y-5">
            <div className="space-y-2">
              <label className="form-label">Part A / Proof Share</label>
              <div className="flex items-center gap-2 rounded-xl border border-aegis-border bg-aegis-bg px-4 py-3 shadow-sm">
                <input
                  type="text"
                  value={proofShare}
                  onChange={(event) => setProofShare(event.target.value)}
                  placeholder="Paste proof share"
                  className="w-full bg-transparent text-sm font-mono text-aegis-text outline-none placeholder:text-aegis-muted"
                />
              </div>
              <Button
                onClick={handleResolve}
                loading={resolving}
                disabled={!proofShare.trim()}
                size="lg"
                className="w-full md:w-auto"
                icon={RefreshCw}
              >
                Resolve Viewing Key
              </Button>
            </div>

            <div className="space-y-2">
              <label className="form-label">Resolved Umbra Viewing Key</label>
              <div className="flex items-center gap-2 rounded-xl border border-aegis-border bg-aegis-bg px-4 py-3 shadow-sm">
                <input
                  type="text"
                  value={resolvedViewingKey}
                  readOnly
                  placeholder="Resolved key"
                  className="w-full bg-transparent text-sm font-mono text-aegis-text outline-none placeholder:text-aegis-muted"
                />
                <button
                  type="button"
                  onClick={handleCopyViewingKey}
                  disabled={!resolvedViewingKey}
                  className="inline-flex items-center gap-1 rounded-lg border border-aegis-border bg-black px-3 py-1.5 text-xs font-medium text-aegis-subtext transition-colors hover:border-aegis-teal/30 hover:text-aegis-teal disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {copiedViewingKey ? <CheckCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedViewingKey ? 'Copied' : 'Copy'}
                </button>
              </div>
              {resolvedViewingKey && (
                <Button
                  onClick={handleProceedToReview}
                  size="lg"
                  className="w-full md:w-auto"
                  icon={ArrowRight}
                >
                  Proceed to Review
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className={`rounded-xl border p-3 shadow-sm ${getMetricTone(auditorStatusPresentation.tone).card}`}>
              <p className={`mb-1 ${getMetricTone(auditorStatusPresentation.tone).label}`}>Auditor Status</p>
              <p className={`font-mono ${getMetricTone(auditorStatusPresentation.tone).value}`}>
                {auditorStatusPresentation.label ?? 'unknown'}
              </p>
            </div>
            <div className={`rounded-xl border p-3 shadow-sm ${getMetricTone(stakePresentation.tone).card}`}>
              <p className={`mb-1 ${getMetricTone(stakePresentation.tone).label}`}>Stake</p>
              <p className={`font-mono ${getMetricTone(stakePresentation.tone).value}`}>
                {stakePresentation.label}
              </p>
            </div>
            <div className={`rounded-xl border p-3 shadow-sm ${getMetricTone(grantStatePresentation.tone).card}`}>
              <p className={`mb-1 ${getMetricTone(grantStatePresentation.tone).label}`}>Grant State</p>
              <p className={`font-mono ${getMetricTone(grantStatePresentation.tone).value}`}>
                {grantStatePresentation.label}
              </p>
            </div>
          </div>

          {verifiedPackage && registrySnapshot && (
            <div className="rounded-xl border border-aegis-green/20 bg-aegis-green/5 p-4 shadow-sm">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="text-aegis-muted mb-1">Grantor</p>
                  <p className="font-mono text-aegis-text">
                    {shortenAddress(verifiedPackage.decodedPackage.parties.grantor, 6)}
                  </p>
                </div>
                <div>
                  <p className="text-aegis-muted mb-1">Scope Date</p>
                  <p className="font-mono text-aegis-text">{verifiedPackage.decodedPackage.scope.date}</p>
                </div>
                <div>
                  <p className="text-aegis-muted mb-1">Grant Expiry</p>
                  <p className="font-mono text-aegis-text">{formatDateTime(registrySnapshot.grant?.expiresAt)}</p>
                </div>
                <div>
                  <p className="text-aegis-muted mb-1">Grant PDA</p>
                  <p className="font-mono text-aegis-text break-all">{verifiedPackage.decodedPackage.registry.viewingGrantPda}</p>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-aegis-border/60 overflow-hidden shadow-sm">
            <button
              type="button"
              onClick={() => setAdvancedOpen((value) => !value)}
              className="w-full flex items-center justify-between px-4 py-3 bg-aegis-card/60 hover:bg-aegis-card transition-colors"
            >
              <div className="flex items-center gap-2 text-aegis-subtext">
                <Key className="w-4 h-4" />
                <span className="text-sm">Local Auditor Key</span>
                {localKeySaved && (
                  <span className="text-[10px] text-aegis-green bg-aegis-green/10 border border-aegis-green/20 px-2 py-0.5 rounded">
                    Saved
                  </span>
                )}
              </div>
              {advancedOpen ? (
                <ChevronUp className="w-4 h-4 text-aegis-muted" />
              ) : (
                <ChevronDown className="w-4 h-4 text-aegis-muted" />
              )}
            </button>
            {advancedOpen && (
              <div className="px-4 py-3 space-y-3 border-t border-aegis-border/40 bg-aegis-card/40">
                <input
                  type="password"
                  value={localDeliveryKey}
                  onChange={(event) => {
                    setLocalDeliveryKey(event.target.value);
                    setLocalKeySaved(false);
                  }}
                  placeholder="Paste local auditor key"
                  className="input w-full font-mono text-xs"
                />
                <div className="flex flex-col md:flex-row gap-3">
                  <Button
                    onClick={handleSaveLocalKey}
                    variant="secondary"
                    size="sm"
                    className="w-full"
                  >
                    Save Key Locally
                  </Button>
                  <Button
                    onClick={handleClearLocalKey}
                    variant="ghost"
                    size="sm"
                    className="w-full"
                  >
                    Clear Local Key
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardBody>

        <CardFooter className="flex flex-col md:flex-row gap-3">
          <Button
            onClick={handleClearResolve}
            variant="secondary"
            size="lg"
            className="w-full md:w-auto"
          >
            Clear
          </Button>
        </CardFooter>
      </Card>}

      {activeTab === 'review' && canAccessReview && <AuditReview />}

      {activeTab === 'about' && <HowItWorks />}
    </div>
  );
}

function HowItWorks() {
  const sections = [
            {
              title: 'Registry Authorization Layer',
              color: 'teal',
              icon: Shield,
              desc: [
                'The Aegis audit registry decides who may act as an auditor and whether they still meet the stake threshold.',
                'Daily disclosure grants are recorded as on-chain PDAs between a grantor, an approved auditor, and a scope reference.',
                'The portal checks both the auditor profile and the grant before it exposes the resolution workflow.',
                'This remains the enforcement boundary for Pillar 3 on Devnet today.',
              ],
            },
            {
              title: 'Scoped Viewing Credentials',
              color: 'cyan',
              icon: Key,
              desc: [
                'Umbra viewing access is rooted in the master viewing key, but scoped disclosure should use a narrower child key rather than the raw root.',
                'Aegis treats that scoped credential as an off-chain secret delivered through the approved disclosure path, not something auditors derive locally in the browser.',
                'The on-chain grant stores authorization metadata and a reference to the encrypted viewing material, not the viewing key itself.',
                'That keeps the contract as the authorization plane and the viewing key as the disclosure plane.',
              ],
            },
            {
              title: 'Current Resolution Flow',
              color: 'amber',
              icon: Calendar,
              desc: [
                'The auditor pastes the proof share, and the portal resolves the linked grant context from that artifact.',
                'Aegis then validates the connected wallet against the on-chain auditor profile and active grant before resolving the viewing material.',
                'Once authorized, the portal surfaces the resulting viewing key in a single output field for the standard Umbra workflow.',
                'This keeps the front-end flow clean while preserving the registry checks already wired into Pillar 3.',
              ],
            },
            {
              title: 'Delivery Boundary',
              color: 'purple',
              icon: Layers,
              desc: [
                'Mixer-pool viewing keys and encrypted-balance compliance grants are separate Umbra mechanisms and should stay separate in the Aegis UI.',
                'The current Devnet path still uses a local auditor delivery key to unwrap the resolved disclosure payload after registry approval.',
                'That delivery key is operational overhead, not part of the main auditor UX, so it is intentionally hidden behind the advanced section.',
                'Neither the resolver flow nor the delivery path grants spending authority over user funds.',
              ],
            },
          ];

  const colorMap = {
    teal: { border: 'border-aegis-teal/20', text: 'text-aegis-teal', icon: 'bg-aegis-teal/10' },
    cyan: { border: 'border-aegis-cyan/20', text: 'text-aegis-cyan', icon: 'bg-aegis-cyan/10' },
    purple: { border: 'border-aegis-purple/20', text: 'text-aegis-purple', icon: 'bg-aegis-purple/10' },
    amber: { border: 'border-aegis-amber/20', text: 'text-aegis-amber', icon: 'bg-aegis-amber/10' },
  };

  return (
    <div className="space-y-4">
      {sections.map((section) => {
        const Icon = section.icon;
        const color = colorMap[section.color];

        return (
          <Card key={section.title}>
            <CardBody>
              <div className="flex items-start gap-4">
                <div className={`w-9 h-9 rounded-xl ${color.icon} border ${color.border} flex items-center justify-center flex-shrink-0`}>
                  <Icon className={`w-4.5 h-4.5 ${color.text}`} />
                </div>
                <div className="flex-1">
                  <h3 className={`text-sm font-semibold ${color.text} mb-2`}>{section.title}</h3>
                  <ul className="space-y-1.5">
                    {section.desc.map((item, index) => (
                      <li key={index} className="flex items-start gap-2 text-xs text-aegis-subtext">
                        <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 bg-current ${color.text}`} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </CardBody>
          </Card>
        );
      })}

      <div className="rounded-xl p-4 border border-aegis-border/60 bg-aegis-card flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-aegis-text">Aegis Shield Documentation</p>
          <p className="text-xs text-aegis-muted mt-0.5">Contract boundary, auditability model, and economic privacy notes</p>
        </div>
        <a
          href="https://aegis-shield.gitbook.io/aegis-shield-docs/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-xs text-aegis-cyan hover:underline"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Read Docs
        </a>
      </div>
    </div>
  );
}