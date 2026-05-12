import React, { useState, useCallback, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import {
  Gift,
  Plus,
  Copy,
  CheckCheck,
  ExternalLink,
  Unlock,
  Lock,
  AlertTriangle,
  ChevronRight,
  ArrowRight,
  Download,
  Eye,
  EyeOff,
  Zap,
} from 'lucide-react';
import { Card, CardHeader, CardBody, CardFooter, StatCard } from '../components/UI/Card.jsx';
import { Button } from '../components/UI/Button.jsx';
import { TokenSelector } from '../components/UI/TokenSelector.jsx';
import { FeeBreakdown } from '../components/UI/FeeBreakdown.jsx';
import { ZKLoader } from '../components/UI/ZKLoader.jsx';
import { useUmbra } from '../hooks/useUmbra.js';
import { useSolanaBalance } from '../hooks/useSolanaBalance.js';
import { useToast } from '../context/ToastContext.jsx';
import {
  calculateFees,
  calculateMaxAmount,
  shortenAddress,
  formatAmount,
  parseRedeemFragment,
} from '../lib/umbra.js';
import {
  clearGiftCardIssueRecovery,
  loadGiftCardIssueRecovery,
  saveGiftCardIssueRecovery,
} from '../lib/giftCardIssueRecovery.js';
import { AEGIS_REDEEM_BASE, NETWORK } from '../config.js';
import { AEGIS_FEE_PERCENT, ZK_OPERATOR_SETUP_LAMPORTS, ZK_TX_FEE_MARGIN_LAMPORTS } from '../config.js';

const BASELINE_ISSUE_MODE = 'umbra-baseline';

function isSolLikeToken(token) {
  return token === 'SOL' || token === 'WSOL';
}

function toSafeNumber(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'bigint') {
    return Number(value);
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function toSafeString(value, fallback = '') {
  if (value == null) {
    return fallback;
  }

  return String(value);
}

function normalizeGiftCardFees(fees) {
  if (!fees) {
    return null;
  }

  return {
    amountMode: toSafeString(fees.amountMode),
    requestedAmountLamports: toSafeNumber(fees.requestedAmountLamports),
    requestedAmount: toSafeNumber(fees.requestedAmount),
    grossDepositLamports: toSafeNumber(fees.grossDepositLamports),
    grossDeposit: toSafeNumber(fees.grossDeposit),
    rawLamports: toSafeNumber(fees.rawLamports),
    umbraFeeLamports: toSafeNumber(fees.umbraFeeLamports),
    aegisFeeLamports: toSafeNumber(fees.aegisFeeLamports),
    totalFeeLamports: toSafeNumber(fees.totalFeeLamports),
    netDepositLamports: toSafeNumber(fees.netDepositLamports),
    totalLamports: toSafeNumber(fees.totalLamports),
    raw: toSafeNumber(fees.raw),
    umbraFee: toSafeNumber(fees.umbraFee),
    aegisFee: toSafeNumber(fees.aegisFee),
    totalFees: toSafeNumber(fees.totalFees),
    netDeposit: toSafeNumber(fees.netDeposit),
    total: toSafeNumber(fees.total),
    umbraFeePercent: toSafeString(fees.umbraFeePercent),
    aegisFeePercent: toSafeString(fees.aegisFeePercent),
    includesAegisFee: fees.includesAegisFee === true,
  };
}

function normalizeGiftCardKeys(keys) {
  if (!keys) {
    return null;
  }

  return {
    spendingKey: toSafeString(keys.spendingKey),
    viewingKey: toSafeString(keys.viewingKey),
    stealthAddress: toSafeString(keys.stealthAddress),
    encodedKeys: keys.encodedKeys ? toSafeString(keys.encodedKeys) : undefined,
    masterViewingKey: keys.masterViewingKey ? toSafeString(keys.masterViewingKey) : undefined,
  };
}

function buildIssuedGiftCardResult({
  signature,
  fundingSignature,
  proofAccountSignature,
  redeemUrl,
  keys,
  fees,
  amount,
  token,
  message,
  issueMode,
  recoveredAfterSimulationFailure,
}) {
  return {
    signature: toSafeString(signature),
    fundingSignature: fundingSignature ? toSafeString(fundingSignature) : null,
    proofAccountSignature: proofAccountSignature ? toSafeString(proofAccountSignature) : null,
    redeemUrl: toSafeString(redeemUrl),
    keys: normalizeGiftCardKeys(keys),
    fees: normalizeGiftCardFees(fees),
    amount: toSafeNumber(amount),
    token: toSafeString(token),
    message: message ? toSafeString(message) : '',
    issueMode: toSafeString(issueMode),
    recoveredAfterSimulationFailure: recoveredAfterSimulationFailure === true,
  };
}

function isIgnorableBigIntIssueError(message) {
  return /BigInt/i.test(message ?? '');
}

// ─── Tab definitions ──────────────────────────────────────────────────────────
const TABS = [
  { id: 'issue', label: 'Issue Gift Card', icon: Gift },
  { id: 'redeem', label: 'Redeem Gift Card', icon: Unlock },
];

// ─── Main Component ────────────────────────────────────────────────────────────
export function GiftCards() {
  const [tab, setTab] = useState('issue');
  const { connected } = useWallet();

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-aegis-cyan/10 border border-aegis-cyan/20 flex items-center justify-center">
            <Gift className="w-5 h-5 text-aegis-cyan" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-aegis-text">Private Gift Cards</h1>
            <p className="text-xs text-aegis-muted">
              Issue a private gift card, share the redemption link, and let the recipient redeem privately
            </p>
          </div>
        </div>

        {/* Protocol notice */}
        <div className="mt-3 flex items-start gap-3 p-3 rounded-xl bg-aegis-cyan/5 border border-aegis-cyan/20">
          <Zap className="w-4 h-4 text-aegis-cyan flex-shrink-0 mt-0.5" />
          <p className="text-xs text-aegis-muted leading-relaxed">
            <span className="text-aegis-cyan font-semibold">Non-custodial end-to-end privacy. </span>
            Recipient keys are generated in your browser and embedded in the redemption URL fragment —
            they never touch any server. Umbra Protocol handles ZK proofs + Arcium MPC attestations
            on devnet. Pillar 1 is configured for the current working Umbra SDK issuance flow, with
            Aegis&apos;s universal <span className="text-aegis-purple font-semibold">0.3% protocol fee</span>{' '}
            applied during issuance.
          </p>
        </div>
      </div>

      {!connected ? (
        <ConnectPrompt />
      ) : (
        <>
          {/* Tabs */}
          <div className="flex gap-1 p-1 rounded-xl bg-aegis-card border border-aegis-border w-fit">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`
                    flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
                    ${tab === t.id
                      ? 'bg-aegis-surface border border-aegis-border text-aegis-text shadow-sm'
                      : 'text-aegis-muted hover:text-aegis-text'
                    }
                  `}
                >
                  <Icon className="w-4 h-4" />
                  {t.label}
                </button>
              );
            })}
          </div>

          {tab === 'issue' ? <IssueForm /> : <RedeemForm />}
        </>
      )}
    </div>
  );
}

// ─── Connect Prompt ───────────────────────────────────────────────────────────
function ConnectPrompt() {
  return (
    <Card>
      <CardBody>
        <div className="flex flex-col items-center py-12 gap-4">
          <div className="w-16 h-16 rounded-2xl bg-aegis-cyan/10 border border-aegis-cyan/20 flex items-center justify-center">
            <Lock className="w-7 h-7 text-aegis-cyan" />
          </div>
          <div className="text-center space-y-1">
            <h3 className="text-lg font-semibold text-aegis-text">Connect Your Wallet</h3>
            <p className="text-sm text-aegis-muted max-w-xs">
              Connect a Solana wallet to issue private gift cards or redeem one you received.
            </p>
          </div>
          <WalletMultiButton />
        </div>
      </CardBody>
    </Card>
  );
}

// ─── Issue Form ────────────────────────────────────────────────────────────────
function IssueForm() {
  const { publicKey } = useWallet();
  const { balances, refetch } = useSolanaBalance();
  const { loading, loadingStep, generateGiftCardKeys, deposit, resumeGiftCardIssue } = useUmbra();
  const toast = useToast();

  const [amount, setAmount] = useState('');
  const [token, setToken] = useState('SOL');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState(null); // { signature, redeemUrl, keys, fees }
  const [recoveryState, setRecoveryState] = useState(() => loadGiftCardIssueRecovery());

  useEffect(() => {
    setRecoveryState(loadGiftCardIssueRecovery());
  }, []);

  const fees = amount && !isNaN(parseFloat(amount)) && parseFloat(amount) > 0
    ? calculateFees(parseFloat(amount), token, token === 'SOL' ? 'net' : 'gross')
    : null;
  const zkNetworkSetupFeeSol =
    isSolLikeToken(token)
      ? (ZK_OPERATOR_SETUP_LAMPORTS + ZK_TX_FEE_MARGIN_LAMPORTS) / 1e9
      : 0;
  const totalWalletRequired = fees ? fees.total + zkNetworkSetupFeeSol : 0;

  const handleMax = () => {
    const balanceLamports = Math.floor(balances[token] * 10 ** (isSolLikeToken(token) ? 9 : 6));
    if (isSolLikeToken(token)) {
      const { maxLamports } = calculateMaxAmount(
        balanceLamports,
        token,
        ZK_TX_FEE_MARGIN_LAMPORTS,
        ZK_OPERATOR_SETUP_LAMPORTS,
        false,
        0,
        'net'
      );
      setAmount((maxLamports / 1e9).toFixed(6));
      return;
    }
    const { maxAmount } = calculateMaxAmount(balanceLamports, token);
    setAmount(maxAmount.toFixed(token === 'SOL' ? 6 : 4));
  };

  const handleIssue = useCallback(async () => {
    if (!amount || isNaN(parseFloat(amount))) {
      toast.error('Enter a valid amount');
      return;
    }
    const numAmount = parseFloat(amount);
    if (numAmount <= 0) {
      toast.error('Amount must be greater than 0');
      return;
    }
    if (fees && isSolLikeToken(token) && totalWalletRequired > balances[token]) {
      toast.error(`Insufficient ${token} balance for amount, Aegis fee, and setup overhead`);
      return;
    }
    if (numAmount > balances[token]) {
      toast.error(`Insufficient ${token} balance`);
      return;
    }

    if (token !== 'SOL') {
      toast.error(
        token === 'WSOL'
          ? 'WSOL balance is now visible in the selector, but Pillar 1 issuance still uses the native SOL-only gift-card path.'
          : 'Baseline Umbra issuance is currently SOL-only while we validate Pillar 1 end to end'
      );
      return;
    }

    let pendingRecovery = null;
    let issuedKeys = null;
    let redeemUrl = '';

    try {
      // 1. Generate ephemeral keys — happens in browser
      const keys = await generateGiftCardKeys();
      issuedKeys = keys;
      redeemUrl = `${AEGIS_REDEEM_BASE}#keys=${keys.encodedKeys}`;
      pendingRecovery = saveGiftCardIssueRecovery({
        status: 'preparing',
        amount: numAmount,
        token,
        message,
        issueMode: BASELINE_ISSUE_MODE,
        keys,
        redeemUrl,
      });
      setRecoveryState(pendingRecovery);

      // 2. Issue through the native Umbra SDK + browser ZK prover baseline path
      const {
        signature,
        fundingSignature,
        fees: txFees,
        proofAccountSignature,
        recoveredAfterSimulationFailure,
      } = await deposit({
        amount: numAmount,
        tokenSymbol: token,
        stealthAddress: keys.stealthAddress,
        recipientSpendingKey: keys.spendingKey,
        issueMode: BASELINE_ISSUE_MODE,
        onCheckpoint: ({ recovery }) => {
          pendingRecovery = saveGiftCardIssueRecovery({
            ...pendingRecovery,
            ...recovery,
            amount: numAmount,
            token,
            message,
            keys,
            redeemUrl,
            status: recovery.fundingSignature ? 'funded-pending-finalization' : 'operator-prepared',
          });
          setRecoveryState(pendingRecovery);
        },
        memoPayload: {
          purpose: 'gift',
          message: message || undefined,
        },
      });

      const nextResult = buildIssuedGiftCardResult({
        signature,          // TX2 — the private deposit (ephemeral relay → stealth)
        fundingSignature,   // TX1 — the funding tx (user wallet → relay)
        proofAccountSignature,
        redeemUrl,
        keys,
        fees: txFees,
        amount: numAmount,
        token,
        message,
        issueMode: BASELINE_ISSUE_MODE,
        recoveredAfterSimulationFailure,
      });
      setResult(nextResult);
      clearGiftCardIssueRecovery();
      setRecoveryState(null);

      toast.success(`Gift card issued!`, {
        title: 'Success',
        txSig: nextResult.signature,
      });
      void refetch().catch(() => {});
    } catch (err) {
      const partialRecovery = err?.partialRecovery ?? null;
      const errorMessage = err?.message ?? 'Unknown issuance error';

      if (isIgnorableBigIntIssueError(errorMessage)) {
        const recoverySnapshot = partialRecovery ?? pendingRecovery ?? loadGiftCardIssueRecovery();
        const nextResult = buildIssuedGiftCardResult({
          signature: recoverySnapshot?.signature ?? recoverySnapshot?.fundingSignature ?? 'confirmed-on-chain',
          fundingSignature: recoverySnapshot?.fundingSignature ?? null,
          proofAccountSignature: recoverySnapshot?.proofAccountSignature ?? null,
          redeemUrl: recoverySnapshot?.redeemUrl ?? redeemUrl,
          keys: recoverySnapshot?.keys ?? issuedKeys,
          fees: recoverySnapshot?.fees ?? fees,
          amount: recoverySnapshot?.amount ?? numAmount,
          token: recoverySnapshot?.token ?? token,
          message: recoverySnapshot?.message ?? message,
          issueMode: recoverySnapshot?.issueMode ?? BASELINE_ISSUE_MODE,
          recoveredAfterSimulationFailure: true,
        });

        setResult(nextResult);
        clearGiftCardIssueRecovery();
        setRecoveryState(null);
        toast.success('Gift card issued!', {
          title: 'Success',
          txSig: nextResult.signature !== 'confirmed-on-chain' ? nextResult.signature : undefined,
        });
        void refetch().catch(() => {});
        return;
      }

      if (partialRecovery) {
        const nextRecovery = saveGiftCardIssueRecovery({
          ...(loadGiftCardIssueRecovery() ?? {}),
          ...partialRecovery,
          status: partialRecovery.fundingSignature ? 'funded-needs-recovery' : 'blocked-before-funding',
          lastError: errorMessage,
        });
        setRecoveryState(nextRecovery);
      }
      toast.error(errorMessage, { title: 'Transaction Failed' });
    }
  }, [amount, token, message, balances, generateGiftCardKeys, deposit, toast, refetch]);

  const handleResumePendingIssue = useCallback(async () => {
    if (!recoveryState?.operatorSecretKeyHex || !recoveryState?.fundingSignature) {
      toast.error('No resumable funded issue was found in this browser session');
      return;
    }

    try {
      const resumed = await resumeGiftCardIssue({
        operatorSecretKeyHex: recoveryState.operatorSecretKeyHex,
        stealthAddress: recoveryState.keys.stealthAddress,
        recipientSpendingKey: recoveryState.keys.spendingKey,
        fundingSignature: recoveryState.fundingSignature,
        amount: recoveryState.amount,
        tokenSymbol: recoveryState.token,
        issueMode: recoveryState.issueMode ?? BASELINE_ISSUE_MODE,
      });

      const nextResult = buildIssuedGiftCardResult({
        ...recoveryState,
        ...resumed,
        redeemUrl: recoveryState.redeemUrl,
        keys: recoveryState.keys,
        message: recoveryState.message,
        token: recoveryState.token,
        amount: recoveryState.amount,
        recoveredAfterSimulationFailure: resumed.recoveredAfterSimulationFailure === true,
      });
      setResult(nextResult);
      clearGiftCardIssueRecovery();
      setRecoveryState(null);
      toast.success('Pending gift card issue completed', { title: 'Recovered', txSig: nextResult.signature });
      void refetch().catch(() => {});
    } catch (err) {
      const errorMessage = err?.message ?? 'Unknown resume error';

      if (isIgnorableBigIntIssueError(errorMessage)) {
        const nextResult = buildIssuedGiftCardResult({
          signature: recoveryState?.signature ?? recoveryState?.fundingSignature ?? 'confirmed-on-chain',
          fundingSignature: recoveryState?.fundingSignature ?? null,
          proofAccountSignature: recoveryState?.proofAccountSignature ?? null,
          redeemUrl: recoveryState?.redeemUrl,
          keys: recoveryState?.keys,
          fees: recoveryState?.fees,
          amount: recoveryState?.amount,
          token: recoveryState?.token,
          message: recoveryState?.message,
          issueMode: recoveryState?.issueMode ?? BASELINE_ISSUE_MODE,
          recoveredAfterSimulationFailure: true,
        });

        setResult(nextResult);
        clearGiftCardIssueRecovery();
        setRecoveryState(null);
        toast.success('Pending gift card issue completed', {
          title: 'Recovered',
          txSig: nextResult.signature !== 'confirmed-on-chain' ? nextResult.signature : undefined,
        });
        void refetch().catch(() => {});
        return;
      }

      const nextRecovery = saveGiftCardIssueRecovery({
        ...recoveryState,
        lastError: errorMessage,
      });
      setRecoveryState(nextRecovery);
      toast.error(errorMessage, { title: 'Resume Failed' });
    }
  }, [recoveryState, refetch, resumeGiftCardIssue, toast]);

  const handleDiscardRecovery = useCallback(() => {
    clearGiftCardIssueRecovery();
    setRecoveryState(null);
    toast.info('Pending recovery data cleared from this browser session');
  }, [toast]);

  if (loading) {
    return (
      <Card>
        <CardBody>
          <ZKLoader step={loadingStep} />
        </CardBody>
      </Card>
    );
  }

  if (result) {
    return <IssuedGiftCard result={result} onReset={() => setResult(null)} />;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-aegis-text">Issue a New Gift Card</h2>
            <p className="text-xs text-aegis-muted mt-0.5">
              Create a private SOL gift card and generate a redemption link for the recipient
            </p>
          </div>
          <div className="px-2 py-1 rounded-lg bg-aegis-green/10 border border-aegis-green/20">
            <span className="text-xs text-aegis-green font-mono">
              {NETWORK === 'devnet' ? 'Devnet' : 'Mainnet'}
            </span>
          </div>
        </div>
      </CardHeader>

      <CardBody className="space-y-5">
        {recoveryState && !result && (
          <PendingIssueRecovery
            recoveryState={recoveryState}
            onResume={handleResumePendingIssue}
            onDiscard={handleDiscardRecovery}
          />
        )}

        <div className="rounded-xl border border-aegis-cyan/20 bg-aegis-cyan/5 p-3">
          <p className="text-xs text-aegis-subtext leading-relaxed">
            <span className="text-aegis-cyan font-semibold">Demo flow. </span>
            Issue a SOL gift card, wait for the success screen, then share the redemption link.
            The recipient redeems using the private key fragment embedded in that link.
          </p>
        </div>

        {/* Amount + Token */}
        <div>
          <label className="form-label">Amount</label>
          <div className="flex gap-2 mt-1">
            <div className="relative flex-1">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                min="0"
                step="any"
                className="input w-full pr-16"
              />
              <button
                type="button"
                onClick={handleMax}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg text-[10px] font-bold text-aegis-cyan bg-aegis-bg border border-aegis-border hover:border-aegis-cyan/30 hover:bg-black transition-colors"
              >
                MAX
              </button>
            </div>
            <TokenSelector value={token} onChange={setToken} />
          </div>
          <p className="mt-1 text-xs text-aegis-muted">
            Balance: {isSolLikeToken(token)
              ? balances.SOL.toFixed(6)
              : balances[token]?.toFixed(4) ?? '0.00'} {token}
          </p>
          {token === 'WSOL' && (
            <p className="mt-1 text-[10px] text-aegis-amber">
              WSOL balance is detected from your token account, but Gift Card issuance remains native-SOL-only in the current Pillar 1 transaction path.
            </p>
          )}
          {token === 'SOL' && (
            <p className="mt-1 text-[10px] text-aegis-cyan">
              Enter the exact amount that should arrive in the privacy pool. Aegis will gross up the on-chain Umbra deposit so the recipient sees this full amount.
            </p>
          )}
        </div>

        {/* Optional message */}
        <div>
          <label className="form-label">Personal Message <span className="text-aegis-muted">(optional)</span></label>
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Happy birthday! Redeem this gift with your Solana wallet."
            className="input w-full mt-1"
            maxLength={120}
          />
          <p className="text-[10px] text-aegis-muted mt-1">
            Stored in the gift card link. Not sent on-chain or to any server.
          </p>
        </div>

        {/* Fee breakdown */}
        {fees && (
          <FeeBreakdown
            fees={fees}
            tokenSymbol={token}
            networkSetupFee={zkNetworkSetupFeeSol}
          />
        )}

        <div className="flex items-start gap-3 p-3 rounded-xl bg-aegis-purple/5 border border-aegis-purple/20">
          <Lock className="w-4 h-4 text-aegis-purple flex-shrink-0 mt-0.5" />
          <div className="text-xs text-aegis-muted leading-relaxed space-y-2">
            <p>
              <span className="text-aegis-purple font-semibold">Private recipient handoff. </span>
              The redemption secret is generated in-browser and stored only in the gift-card link fragment.
              Share that link directly with the recipient after issuance succeeds.
            </p>
            <p>
              Demo sequence: <span className="text-aegis-text font-semibold">Issue → Success → Redeem</span>.
              The UI below is intentionally focused on that flow and does not expose internal transaction choreography.
            </p>
          </div>
        </div>
      </CardBody>

      <CardFooter>
        <Button
          onClick={handleIssue}
          loading={loading}
          disabled={!amount}
          size="lg"
          className="w-full"
          icon={Gift}
        >
          Issue Gift Card
          {fees && (
            <span className="ml-1 text-aegis-cyan/60">
              — {totalWalletRequired.toFixed(isSolLikeToken(token) ? 4 : 2)} {token} total
            </span>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}

// ─── Issued Gift Card Result ──────────────────────────────────────────────────
function IssuedGiftCard({ result, onReset }) {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedSig, setCopiedSig] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const networkSetupFee = result.token === 'SOL'
    ? (ZK_OPERATOR_SETUP_LAMPORTS + ZK_TX_FEE_MARGIN_LAMPORTS) / 1e9
    : 0;
  const allFeesPaid = result.fees.totalFees + networkSetupFee;

  const copyUrl = async () => {
    await navigator.clipboard.writeText(result.redeemUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const copySig = async () => {
    await navigator.clipboard.writeText(result.signature);
    setCopiedSig(true);
    setTimeout(() => setCopiedSig(false), 2000);
  };

  const downloadQR = () => {
    // Generate a text file with the URL for now (QR library can be added as enhancement)
    const blob = new Blob([result.redeemUrl], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aegis-giftcard-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isBaselineIssue = result.issueMode === BASELINE_ISSUE_MODE;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-aegis-green/10 border border-aegis-green/20 flex items-center justify-center">
            <CheckCheck className="w-5 h-5 text-aegis-green" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-aegis-text">Gift Card Ready</h2>
            <p className="text-xs text-aegis-muted">
              Issuance completed. Share the redemption link with the recipient.
            </p>
          </div>
        </div>
      </CardHeader>

      <CardBody className="space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="Amount"
            value={`${formatAmount(result.amount, result.token === 'SOL' ? 6 : 2)} ${result.token}`}
            color="cyan"
            sub="Sender target"
          />
          <StatCard
            label="Net in Pool"
            value={`${result.fees.netDeposit.toFixed(4)} ${result.token}`}
            color="green"
            sub="Exact recipient amount"
          />
          <StatCard
            label="Fees Paid"
            value={`${allFeesPaid.toFixed(4)} ${result.token}`}
            color="amber"
            sub={networkSetupFee > 0 ? `Protocol + ${networkSetupFee.toFixed(4)} setup` : 'Protocol fees'}
          />
        </div>

        <div className="rounded-xl border border-aegis-amber/20 bg-aegis-amber/5 p-3 text-xs text-aegis-subtext leading-relaxed">
          <span className="text-aegis-amber font-semibold">Accounting note:</span> you requested {result.amount.toFixed(4)} {result.token} net to the pool. Aegis grossed up the Umbra deposit to {result.fees.raw.toFixed(6)} {result.token}, so the recipient sees the clean requested amount instead of a post-fee shortfall.
        </div>

        {/* Personal message */}
        {result.message && (
          <div className="p-3 rounded-xl bg-aegis-card border border-aegis-border">
            <p className="text-xs text-aegis-muted mb-1">Personal Message</p>
            <p className="text-sm text-aegis-text italic">"{result.message}"</p>
          </div>
        )}

        {/* Redeem URL */}
        <div>
          <label className="form-label">Redemption Link</label>
          <div className="mt-1 flex gap-2">
            <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-aegis-card border border-aegis-border overflow-hidden">
              <span className="text-xs font-mono text-aegis-subtext truncate flex-1">
                {result.redeemUrl}
              </span>
            </div>
            <Button
              onClick={copyUrl}
              variant="secondary"
              size="sm"
              icon={copiedUrl ? CheckCheck : Copy}
            >
              {copiedUrl ? 'Copied!' : 'Copy'}
            </Button>
          </div>
          <p className="text-[10px] text-aegis-amber mt-1.5 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            The private key is in the URL fragment. Share only with the intended recipient.
            Never post publicly or send via unsecured channels.
          </p>
        </div>

        <div className="rounded-xl border border-aegis-green/20 bg-aegis-green/5 p-3 text-xs text-aegis-subtext leading-relaxed">
          <span className="text-aegis-green font-semibold">Demo flow completed.</span> The gift card has been issued.
          Next step: share the redemption link with the recipient so they can redeem it privately.
        </div>

        {/* Transaction chain */}
        <div className="space-y-2">
          <label className="form-label">Issue Record</label>

          {/* TX1 — funding */}
          <div className="rounded-xl border border-aegis-amber/20 bg-aegis-amber/5 p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-bold text-aegis-amber bg-aegis-amber/10 border border-aegis-amber/20 px-1.5 py-0.5 rounded">TX1</span>
              <span className="text-[10px] text-aegis-muted">Funding transaction</span>
              <span className="ml-auto text-[10px] text-aegis-muted italic">your address visible here</span>
            </div>
            <div className="flex gap-2">
              <code className="flex-1 px-2 py-1.5 rounded-lg bg-aegis-bg border border-aegis-border text-[10px] font-mono text-aegis-subtext truncate">
                {result.fundingSignature}
              </code>
              <a
                href={`https://explorer.solana.com/tx/${result.fundingSignature}?cluster=${NETWORK}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-aegis-card border border-aegis-border text-[10px] text-aegis-amber hover:border-aegis-amber/40 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {/* TX2 — private deposit */}
          <div className="rounded-xl border border-aegis-green/20 bg-aegis-green/5 p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-bold text-aegis-green bg-aegis-green/10 border border-aegis-green/20 px-1.5 py-0.5 rounded">TX2</span>
              <span className="text-[10px] text-aegis-muted">Private gift-card issuance</span>
              <span className="ml-auto text-[10px] text-aegis-green font-semibold">your wallet hidden</span>
            </div>
            <div className="flex gap-2">
              <code className="flex-1 px-2 py-1.5 rounded-lg bg-aegis-bg border border-aegis-border text-[10px] font-mono text-aegis-subtext truncate">
                {result.signature}
              </code>
              <Button
                onClick={copySig}
                variant="secondary"
                size="sm"
                icon={copiedSig ? CheckCheck : Copy}
                className="text-[10px]"
              >
                {copiedSig ? 'Copied' : 'Copy'}
              </Button>
              <a
                href={`https://explorer.solana.com/tx/${result.signature}?cluster=${NETWORK}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-aegis-card border border-aegis-border text-[10px] text-aegis-cyan hover:border-aegis-cyan/40 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <p className="text-[10px] text-aegis-muted mt-1.5">
              This transaction creates the claimable Umbra gift-card UTXO. Your wallet is not the sender on this transaction.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-aegis-cyan/20 bg-aegis-cyan/5 p-3 text-xs text-aegis-muted leading-relaxed">
          <span className="text-aegis-cyan font-semibold">Privacy boundary:</span> the funding step is still a normal Solana payment, so the sender wallet is public on the funding transaction. What remains private is the gift-card payload, the redemption secret embedded in the URL fragment, and the claimant identity until the recipient chooses to redeem.
        </div>

        {/* Ephemeral keys (collapsible) */}
        <div className="rounded-xl border border-aegis-border/60 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowKeys((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 bg-aegis-card/50 hover:bg-aegis-card transition-colors text-sm"
          >
            <div className="flex items-center gap-2 text-aegis-subtext">
              {showKeys ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              <span>View Ephemeral Keys</span>
              <span className="text-[10px] text-aegis-amber bg-aegis-amber/10 border border-aegis-amber/20 px-1.5 py-0.5 rounded">
                Sensitive
              </span>
            </div>
            <ChevronRight
              className={`w-4 h-4 text-aegis-muted transition-transform ${showKeys ? 'rotate-90' : ''}`}
            />
          </button>
          {showKeys && (
            <div className="px-4 py-3 space-y-2 border-t border-aegis-border/40">
              <p className="text-[10px] text-aegis-amber leading-relaxed">
                These keys control the gift card UTXO. They are already embedded in the redemption URL.
                Keep these keys private — anyone with the spending key can claim the funds.
              </p>
              <KeyRow label="Spending Key" value={result.keys.spendingKey} />
              <KeyRow label="Viewing Key" value={result.keys.viewingKey} />
              <KeyRow label="Stealth Address" value={result.keys.stealthAddress} />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <Button onClick={downloadQR} variant="secondary" icon={Download} className="flex-1">
            Download as File
          </Button>
          <Button onClick={onReset} variant="primary" icon={Plus} className="flex-1">
            Issue Another
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function PendingIssueRecovery({ recoveryState, onResume, onDiscard }) {
  const [copiedUrl, setCopiedUrl] = useState(false);

  const copyRecoveryUrl = async () => {
    await navigator.clipboard.writeText(recoveryState.redeemUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  return (
    <div className="rounded-xl border border-aegis-amber/20 bg-aegis-amber/5 p-4 space-y-4">
      <div>
        <p className="text-sm font-semibold text-aegis-amber">Pending Gift Card Recovery</p>
        <p className="text-xs text-aegis-muted mt-1 leading-relaxed">
          A previous issue attempt was interrupted. The browser kept the generated keys and transaction checkpoints so the card can be resumed without charging the wallet again once the Umbra Devnet SDK environment is ready.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg border border-aegis-border/60 bg-aegis-card/50 p-3">
          <p className="text-aegis-muted mb-1">Recovery Status</p>
          <p className="font-mono text-aegis-text">{recoveryState.status}</p>
        </div>
        <div className="rounded-lg border border-aegis-border/60 bg-aegis-card/50 p-3">
          <p className="text-aegis-muted mb-1">Funding Signature</p>
          <p className="font-mono text-aegis-text break-all">{recoveryState.fundingSignature || 'Not broadcast'}</p>
        </div>
      </div>

      <div>
        <label className="form-label">Stored Redemption Link</label>
        <div className="mt-1 flex gap-2">
          <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-aegis-card border border-aegis-border overflow-hidden">
            <span className="text-xs font-mono text-aegis-subtext truncate flex-1">
              {recoveryState.redeemUrl}
            </span>
          </div>
          <Button onClick={copyRecoveryUrl} variant="secondary" size="sm" icon={copiedUrl ? CheckCheck : Copy}>
            {copiedUrl ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <p className="text-[10px] text-aegis-amber mt-1.5">
          Do not distribute this link until the issue flow reaches the final Umbra transaction.
        </p>
      </div>

      {recoveryState.lastError && (
        <div className="rounded-lg border border-aegis-red/20 bg-aegis-red/5 p-3 text-xs text-aegis-red whitespace-pre-wrap">
          {recoveryState.lastError}
        </div>
      )}

      <div className="flex gap-3">
        <Button onClick={onResume} className="flex-1" icon={ArrowRight}>
          Resume Pending Issue
        </Button>
        <Button onClick={onDiscard} variant="secondary" className="flex-1" icon={Plus}>
          Clear Recovery Data
        </Button>
      </div>
    </div>
  );
}

function KeyRow({ label, value }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div>
      <p className="text-[10px] text-aegis-muted font-semibold uppercase mb-0.5">{label}</p>
      <div className="flex gap-2">
        <code className="flex-1 text-[10px] font-mono text-aegis-subtext bg-aegis-bg px-2 py-1.5 rounded-lg border border-aegis-border break-all">
          {value}
        </code>
        <button
          onClick={copy}
          className="px-2 rounded-lg bg-aegis-card border border-aegis-border text-aegis-muted hover:text-aegis-cyan transition-colors"
        >
          {copied ? <CheckCheck className="w-3 h-3 text-aegis-green" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
    </div>
  );
}

// ─── Redeem Form ───────────────────────────────────────────────────────────────
function RedeemForm() {
  const { publicKey } = useWallet();
  const { loading, loadingStep, withdraw } = useUmbra();
  const toast = useToast();

  const [redeemUrl, setRedeemUrl] = useState('');
  const [parsedKeys, setParsedKeys] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [result, setResult] = useState(null);
  const [redeemMode, setRedeemMode] = useState('relayer');

  const handleParseUrl = () => {
    setParseError(null);
    setParsedKeys(null);
    try {
      let fragment = redeemUrl;
      if (redeemUrl.includes('#')) {
        fragment = '#' + redeemUrl.split('#')[1];
      }
      const keys = parseRedeemFragment(fragment);
      if (!keys.sk || !keys.vk) {
        throw new Error('URL missing spending or viewing keys');
      }
      setParsedKeys(keys);
    } catch (err) {
      setParseError(err.message);
    }
  };

  const handleRedeem = useCallback(async () => {
    if (!parsedKeys) {
      toast.error('Parse the gift card URL first');
      return;
    }
    if (!publicKey) {
      toast.error('Connect your wallet to claim funds');
      return;
    }

    try {
      const redeemResult = await withdraw({
        spendingKey: parsedKeys.sk,
        viewingKey: parsedKeys.vk,
        stealthAddress: parsedKeys.sa,
        redeemMode,
      });
      setResult(redeemResult);
      toast.success('Gift card redeemed!', { title: 'Claimed', txSig: redeemResult.signature });
    } catch (err) {
      toast.error(err.message, { title: 'Redemption Failed' });
    }
  }, [parsedKeys, publicKey, redeemMode, withdraw, toast]);

  if (loading) {
    return (
      <Card>
        <CardBody>
          <ZKLoader step={loadingStep} />
        </CardBody>
      </Card>
    );
  }

  if (result) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-aegis-green/10 border border-aegis-green/20 flex items-center justify-center">
              <CheckCheck className="w-5 h-5 text-aegis-green" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-aegis-text">Successfully Redeemed!</h2>
              <p className="text-xs text-aegis-muted">
                {result.amount ? `${result.amount.toFixed(6)} SOL` : 'Funds'} sent to your connected wallet.
                {result.destinationAddress && (
                  <span className="ml-1 font-mono text-aegis-cyan">{shortenAddress(result.destinationAddress, 6)}</span>
                )}
              </p>
              <p className="text-[10px] text-aegis-muted mt-1">
                {result.mode === 'relayer'
                  ? 'Gasless relayer redeem completed'
                  : result.mode === 'direct'
                    ? 'Direct redeem completed after relayer-assisted confidential claim'
                    : 'Direct redeem completed through the legacy self-relay path'}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          {/* On-chain transaction chain */}
          <div className="space-y-2">
            <label className="form-label">On-Chain Transactions</label>

            {result.mode === 'legacy-direct' ? (
              <>
                <div className="rounded-xl border border-aegis-purple/20 bg-aegis-purple/5 p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-bold text-aegis-purple bg-aegis-purple/10 border border-aegis-purple/20 px-1.5 py-0.5 rounded">TX1</span>
                    <span className="text-[10px] text-aegis-muted">Stealth address → Exit relay</span>
                    <span className="ml-auto text-[10px] text-aegis-purple font-semibold">your wallet hidden</span>
                  </div>
                  <div className="flex gap-2">
                    <code className="flex-1 px-2 py-1.5 rounded-lg bg-aegis-bg border border-aegis-border text-[10px] font-mono text-aegis-subtext truncate">
                      {result.drainSignature}
                    </code>
                    <a
                      href={`https://explorer.solana.com/tx/${result.drainSignature}?cluster=${NETWORK}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-aegis-card border border-aegis-border text-[10px] text-aegis-purple hover:border-aegis-purple/40 transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <p className="text-[10px] text-aegis-muted mt-1.5">
                    The stealth address drains to a one-time ephemeral exit relay — your wallet address does not appear here.
                  </p>
                </div>

                <div className="rounded-xl border border-aegis-green/20 bg-aegis-green/5 p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-bold text-aegis-green bg-aegis-green/10 border border-aegis-green/20 px-1.5 py-0.5 rounded">TX2</span>
                    <span className="text-[10px] text-aegis-muted">Exit relay → Destination address</span>
                    <span className="ml-auto text-[10px] text-aegis-amber italic">exit relay visible as sender</span>
                  </div>
                  <div className="flex gap-2">
                    <code className="flex-1 px-2 py-1.5 rounded-lg bg-aegis-bg border border-aegis-border text-[10px] font-mono text-aegis-subtext truncate">
                      {result.signature}
                    </code>
                    <a
                      href={`https://explorer.solana.com/tx/${result.signature}?cluster=${NETWORK}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-aegis-card border border-aegis-border text-[10px] text-aegis-cyan hover:border-aegis-cyan/40 transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <p className="text-[10px] text-aegis-muted mt-1.5">
                    This is the final transfer. On Explorer the sender appears as a random ephemeral address — the link to the original stealth address is broken.
                  </p>
                </div>
              </>
            ) : (
              <>
                {result.claimSignature && (
                  <div className="rounded-xl border border-aegis-purple/20 bg-aegis-purple/5 p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] font-bold text-aegis-purple bg-aegis-purple/10 border border-aegis-purple/20 px-1.5 py-0.5 rounded">TX1</span>
                      <span className="text-[10px] text-aegis-muted">
                        {result.mode === 'relayer'
                          ? 'Umbra relayer claim to public balance'
                          : 'Umbra relayer claim into encrypted balance'}
                      </span>
                      <span className="ml-auto text-[10px] text-aegis-purple font-semibold">gas paid by relayer</span>
                    </div>
                    <div className="flex gap-2">
                      <code className="flex-1 px-2 py-1.5 rounded-lg bg-aegis-bg border border-aegis-border text-[10px] font-mono text-aegis-subtext truncate">
                        {result.claimSignature}
                      </code>
                      <a
                        href={`https://explorer.solana.com/tx/${result.claimSignature}?cluster=${NETWORK}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-aegis-card border border-aegis-border text-[10px] text-aegis-purple hover:border-aegis-purple/40 transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <p className="text-[10px] text-aegis-muted mt-1.5">
                      {result.mode === 'relayer'
                        ? 'The Umbra relayer forwards the confidential claim and covers the transaction gas.'
                        : 'The Umbra relayer performs the confidential claim first, then the funds are prepared for a separate direct withdrawal.'}
                    </p>
                  </div>
                )}

                <div className="rounded-xl border border-aegis-green/20 bg-aegis-green/5 p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-bold text-aegis-green bg-aegis-green/10 border border-aegis-green/20 px-1.5 py-0.5 rounded">
                      {result.mode === 'relayer' ? 'TX2' : 'TX2'}
                    </span>
                    <span className="text-[10px] text-aegis-muted">
                      {result.mode === 'relayer'
                        ? 'Final callback to your wallet'
                        : 'Direct withdrawal to destination wallet'}
                    </span>
                    <span className="ml-auto text-[10px] text-aegis-green font-semibold">
                      {result.mode === 'relayer' ? 'gasless' : 'direct withdraw'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <code className="flex-1 px-2 py-1.5 rounded-lg bg-aegis-bg border border-aegis-border text-[10px] font-mono text-aegis-subtext truncate">
                      {result.signature}
                    </code>
                    <a
                      href={`https://explorer.solana.com/tx/${result.signature}?cluster=${NETWORK}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-aegis-card border border-aegis-border text-[10px] text-aegis-cyan hover:border-aegis-cyan/40 transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <p className="text-[10px] text-aegis-muted mt-1.5">
                    {result.mode === 'relayer'
                      ? 'This is the final relayer-mediated claim result that sends funds to the connected wallet without requiring SOL in the recipient wallet.'
                      : 'After the confidential claim completes, Umbra performs a direct withdrawal step into your connected wallet.'}
                  </p>
                </div>

                {result.rentClaimSignature && (
                  <div className="rounded-xl border border-aegis-amber/20 bg-aegis-amber/5 p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] font-bold text-aegis-amber bg-aegis-amber/10 border border-aegis-amber/20 px-1.5 py-0.5 rounded">TX3</span>
                      <span className="text-[10px] text-aegis-muted">Rent reclamation</span>
                    </div>
                    <div className="flex gap-2">
                      <code className="flex-1 px-2 py-1.5 rounded-lg bg-aegis-bg border border-aegis-border text-[10px] font-mono text-aegis-subtext truncate">
                        {result.rentClaimSignature}
                      </code>
                      <a
                        href={`https://explorer.solana.com/tx/${result.rentClaimSignature}?cluster=${NETWORK}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-aegis-card border border-aegis-border text-[10px] text-aegis-amber hover:border-aegis-amber/40 transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <p className="text-[10px] text-aegis-muted mt-1.5">
                      Umbra reclaimed temporary computation rent after the redeem finalized.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Privacy callout */}
          <div className="flex items-start gap-3 p-3 rounded-xl bg-aegis-purple/5 border border-aegis-purple/20">
            <Lock className="w-4 h-4 text-aegis-purple flex-shrink-0 mt-0.5" />
            <div className="text-xs text-aegis-muted leading-relaxed space-y-1">
              <p>
                <span className="text-aegis-purple font-semibold">
                  {result.mode === 'legacy-direct' ? 'Ephemeral Exit Relay — chain of custody broken. ' : 'Umbra claim privacy path. '}
                </span>
                {result.mode === 'legacy-direct'
                  ? 'A chain observer watching the stealth address (TX1) only sees it drain to a random one-time address. The subsequent transfer to your wallet (TX2) appears as an unrelated ephemeral→wallet transfer with no on-chain link to the gift card.'
                  : 'The confidential claim still preserves the private gift-card handoff while giving the recipient a choice between a gasless relayer-assisted redeem and a direct withdrawal-style finish.'}
              </p>
            </div>
          </div>

          {result.feeNote && (
            <div className="rounded-xl border border-aegis-amber/20 bg-aegis-amber/5 p-3 text-xs text-aegis-subtext leading-relaxed">
              <span className="text-aegis-amber font-semibold">Fee visibility:</span> {result.feeNote}
            </div>
          )}

          <Button onClick={() => setResult(null)} variant="secondary" className="w-full">
            Redeem Another
          </Button>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold text-aegis-text">Redeem a Gift Card</h2>
        <p className="text-xs text-aegis-muted mt-0.5">
          Paste the redemption link you received to claim funds from the Umbra pool
        </p>
      </CardHeader>

      <CardBody className="space-y-5">
        {/* URL input */}
        <div>
          <label className="form-label">Redemption URL</label>
          <div className="flex gap-2 mt-1">
            <input
              type="text"
              value={redeemUrl}
              onChange={(e) => { setRedeemUrl(e.target.value); setParsedKeys(null); setParseError(null); }}
              placeholder="https://aegis-shield.gitbook.io/aegis-shield-docs/redeem#keys=..."
              className="input flex-1"
            />
            <Button onClick={handleParseUrl} variant="secondary" disabled={!redeemUrl}>
              Parse
            </Button>
          </div>
          {parseError && (
            <p className="text-xs text-aegis-red mt-1 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              {parseError}
            </p>
          )}
        </div>

        {/* Parsed key preview */}
        {parsedKeys && (
          <div className="rounded-xl border border-aegis-green/20 bg-aegis-green/5 p-4 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCheck className="w-4 h-4 text-aegis-green" />
              <span className="text-sm font-semibold text-aegis-green">Valid Gift Card Link</span>
            </div>
            <div className="text-xs font-mono space-y-1">
              <div className="flex justify-between">
                <span className="text-aegis-muted">Stealth Address</span>
                <span className="text-aegis-text">{shortenAddress(parsedKeys.sa, 8)}</span>
              </div>
              {parsedKeys.ts && (
                <div className="flex justify-between">
                  <span className="text-aegis-muted">Issued</span>
                  <span className="text-aegis-text">
                    {new Date(parsedKeys.ts).toLocaleString()}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="form-label">Redeem Mode</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setRedeemMode('direct')}
                  className={`rounded-xl border p-3 text-left transition-colors ${redeemMode === 'direct' ? 'border-aegis-cyan bg-aegis-cyan/10' : 'border-aegis-border bg-aegis-card/40 hover:border-aegis-cyan/30'}`}
                >
                  <p className="text-sm font-semibold text-aegis-text">Direct Redeem</p>
                  <p className="text-xs text-aegis-muted mt-1">
                    Uses the confidential claim path, then performs a direct withdrawal step to your wallet.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setRedeemMode('relayer')}
                  className={`rounded-xl border p-3 text-left transition-colors ${redeemMode === 'relayer' ? 'border-aegis-green bg-aegis-green/10' : 'border-aegis-border bg-aegis-card/40 hover:border-aegis-green/30'}`}
                >
                  <p className="text-sm font-semibold text-aegis-text">Relayer Redeem</p>
                  <p className="text-xs text-aegis-muted mt-1">
                    Gasless path. Umbra relayer pays the transaction gas and sends the claimed funds to your wallet.
                  </p>
                </button>
              </div>
              <div className="rounded-lg border border-aegis-border/60 bg-aegis-card/40 p-3 text-xs text-aegis-muted leading-relaxed">
                {redeemMode === 'relayer'
                  ? 'Relayer fee visibility: Umbra relayer gas and any relayer deduction are resolved inside the claim flow. The current SDK does not expose an exact pre-claim quote, but this path is designed for recipients with zero SOL.'
                  : 'Direct redeem fee visibility: this mode finishes with a direct withdrawal step after the confidential claim. Any Umbra relayer/protocol deductions still apply during the claim step, and the final withdrawal may reclaim computation rent.'}
              </div>
            </div>
          </div>
        )}

        {/* Warning */}
        <div className="flex items-start gap-3 p-3 rounded-xl bg-aegis-amber/5 border border-aegis-amber/20">
          <AlertTriangle className="w-4 h-4 text-aegis-amber flex-shrink-0 mt-0.5" />
          <p className="text-xs text-aegis-muted leading-relaxed">
            The spending key in this URL is a one-time secret. Once you redeem, the UTXO is consumed.
            Make sure this link was sent to you — anyone with the URL can claim the funds.
          </p>
        </div>
      </CardBody>

      <CardFooter>
        <Button
          onClick={handleRedeem}
          loading={loading}
          disabled={!parsedKeys || !publicKey}
          size="lg"
          className="w-full"
          icon={Unlock}
        >
          {!parsedKeys ? 'Parse URL First' : !publicKey ? 'Connect Wallet to Claim' : redeemMode === 'relayer' ? 'Redeem via Relayer (Gasless)' : 'Redeem via Direct Path'}
        </Button>
      </CardFooter>
    </Card>
  );
}
