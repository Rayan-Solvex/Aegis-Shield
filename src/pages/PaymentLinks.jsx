import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { SolanaSignMessage, SolanaSignTransaction } from '@solana/wallet-standard-features';
import nacl from 'tweetnacl';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  Link2,
  Copy,
  CheckCheck,
  Download,
  ExternalLink,
  Lock,
  Send,
  AlertTriangle,
  ArrowRight,
  Shield,
  Sparkles,
  RefreshCw,
  Eye,
} from 'lucide-react';
import { Card, CardHeader, CardBody, CardFooter } from '../components/UI/Card.jsx';
import { Button } from '../components/UI/Button.jsx';
import { FeeBreakdown } from '../components/UI/FeeBreakdown.jsx';
import { TokenSelector } from '../components/UI/TokenSelector.jsx';
import { ZKLoader } from '../components/UI/ZKLoader.jsx';
import { useSolanaBalance } from '../hooks/useSolanaBalance.js';
import { useToast } from '../context/ToastContext.jsx';
import {
  getUmbraRuntime,
  calculateFees,
  shortenAddress,
  formatAmount,
} from '../lib/umbra.js';
import {
  AEGIS_TREASURY_ADDRESS,
  NETWORK,
  TOKEN_MINTS,
  UMBRA_CONFIG,
  ZK_OPERATOR_SETUP_LAMPORTS,
  ZK_TX_FEE_MARGIN_LAMPORTS,
  getRpcEndpoint,
  getWsEndpoint,
} from '../config.js';

const TABS = [
  { id: 'my-link', label: 'My Payment Link', icon: Link2 },
  { id: 'claim', label: 'Claim Payments', icon: Eye },
  { id: 'send', label: 'Send to Link', icon: Send },
];

const PAYMENT_LINK_PROFILE_PREFIX = 'aegis-payment-link-profile-v3:';
const PAYMENT_LINK_SIGNING_DOMAIN = 'AEGIS_SHIELD_UMBRA_NATIVE_LINK_V1';
const paymentLinkProfileMemoryCache = new Map();

function getWalletStandardChain() {
  return NETWORK === 'mainnet-beta' ? 'solana:mainnet' : 'solana:devnet';
}

function getUmbraClientNetwork() {
  return NETWORK === 'mainnet-beta' ? 'mainnet' : 'devnet';
}

function isSolLikeToken(token) {
  return token === 'SOL' || token === 'WSOL';
}

function getTokenDisplayDecimals(token) {
  return isSolLikeToken(token) ? 6 : 4;
}

function getDirectUmbraRpcEndpoint() {
  return getRpcEndpoint();
}

function getDirectUmbraWsEndpoint() {
  return getWsEndpoint();
}

function getPaymentLinkBase() {
  if (typeof window === 'undefined' || !window.location?.origin) {
    return '/payment-links';
  }

  return `${window.location.origin}/payment-links`;
}

function getPaymentLinkStorageKey(ownerAddress) {
  return `${PAYMENT_LINK_PROFILE_PREFIX}${ownerAddress}`;
}

function purgePersistedPaymentLinkProfilesFromStorage() {
  if (typeof window === 'undefined') return;

  [window.localStorage, window.sessionStorage].forEach((storage) => {
    const keysToRemove = [];

    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(PAYMENT_LINK_PROFILE_PREFIX)) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => storage.removeItem(key));
  });
}

function encodeBase64Url(bytes) {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value) {
  const normalized = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function encodeJsonPayload(value) {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeJsonPayload(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

function buildPaymentLinkMessage({ aliasAddress, accountPayload, createdAt }) {
  return `${PAYMENT_LINK_SIGNING_DOMAIN}|alias=${aliasAddress}|acct=${accountPayload}|ts=${createdAt}`;
}

function serializeAccountSnapshot(account) {
  return {
    exists: account?.exists !== false,
    executable: Boolean(account?.executable),
    lamports: String(account?.lamports ?? 0n),
    programAddress: account?.programAddress,
    space: String(account?.space ?? 0n),
    data: encodeBase64Url(account?.data ?? new Uint8Array()),
  };
}

function deserializeAccountSnapshot(snapshot, address) {
  return {
    exists: snapshot?.exists !== false,
    executable: Boolean(snapshot?.executable),
    lamports: BigInt(snapshot?.lamports ?? '0'),
    programAddress: snapshot?.programAddress,
    space: BigInt(snapshot?.space ?? '0'),
    address,
    data: decodeBase64Url(snapshot?.data ?? ''),
  };
}

function toAddressKey(address) {
  if (address && typeof address === 'object' && typeof address.toString === 'function') {
    return address.toString();
  }

  return String(address);
}

function createPaymentLinkSendError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

function hasTransactionSignature(signature) {
  return signature instanceof Uint8Array && signature.some((byte) => byte !== 0);
}

function preserveExistingPartialSignatures(originalTransaction, signedTransaction, walletPublicKey) {
  const requiredSignatureCount = Number(
    signedTransaction.message.header.numRequiredSignatures ?? 0
  );
  const signerAddresses = (signedTransaction.message.staticAccountKeys ?? [])
    .slice(0, requiredSignatureCount)
    .map((key) => key.toBase58());
  const walletSignerIndex = signerAddresses.indexOf(walletPublicKey.toBase58());

  if (walletSignerIndex === -1) {
    return signedTransaction;
  }

  const mergedTransaction = new VersionedTransaction(signedTransaction.message);
  mergedTransaction.signatures = signedTransaction.signatures.map((signature) => Uint8Array.from(signature));

  for (let index = 0; index < requiredSignatureCount; index += 1) {
    if (index === walletSignerIndex) {
      continue;
    }

    const originalSignature = originalTransaction.signatures[index];
    const currentSignature = mergedTransaction.signatures[index];
    if (hasTransactionSignature(originalSignature) && !hasTransactionSignature(currentSignature)) {
      mergedTransaction.signatures[index] = Uint8Array.from(originalSignature);
    }
  }

  return mergedTransaction;
}

function classifyBroadcastFailure(message) {
  const normalized = String(message || '').toLowerCase();

  return {
    rateLimited: normalized.includes('429') || normalized.includes('too many requests'),
    payloadTooLarge: normalized.includes('413') || normalized.includes('payload too large'),
    blockhashExpired:
      normalized.includes('blockhash not found') ||
      normalized.includes('transaction expired') ||
      normalized.includes('last valid block height'),
    duplicate:
      normalized.includes('already processed') ||
      normalized.includes('duplicate signature') ||
      normalized.includes('signature verification failure'),
  };
}

function formatLamportsToSol(lamports, decimals = 6) {
  const value = typeof lamports === 'bigint' ? lamports : BigInt(lamports ?? 0);
  const whole = value / BigInt(LAMPORTS_PER_SOL);
  const fraction = value % BigInt(LAMPORTS_PER_SOL);
  const paddedFraction = fraction.toString().padStart(9, '0').slice(0, decimals);
  const trimmedFraction = paddedFraction.replace(/0+$/, '');

  return trimmedFraction.length > 0
    ? `${whole.toString()}.${trimmedFraction}`
    : whole.toString();
}

function normalizeLamportsValue(value) {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(Math.trunc(value)) : '0';
  }
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return '0';
}

function getClaimableLamportsTotal(utxos) {
  return utxos.reduce(
    (sum, utxo) => sum + BigInt(normalizeLamportsValue(utxo.amount)),
    0n
  );
}

const UMBRA_INDEXER_HEALTH_TTL_MS = 30_000;
const umbraIndexerHealthCache = {
  checkedAt: 0,
  healthy: false,
};

function createUmbraIndexerUnavailableError(cause) {
  const error = new Error(
    'Umbra devnet indexer unavailable. Scanning claimable UTXOs requires Umbra\'s dedicated indexer service, and the configured devnet endpoint is currently unreachable. Helius Devnet RPC cannot replace this indexer by itself. If you have an alternate Umbra indexer, set VITE_UMBRA_INDEXER_URL in .env and retry.'
  );
  error.name = 'UmbraIndexerUnavailableError';
  if (cause instanceof Error) {
    error.cause = cause;
  }
  return error;
}

function isUmbraIndexerUnavailableError(error) {
  if (error?.name === 'UmbraIndexerUnavailableError') {
    return true;
  }

  const diagnostics = extractNestedErrorDiagnostics(error);
  const haystack = [
    error instanceof Error ? error.message : String(error),
    ...diagnostics.messages,
  ]
    .join(' | ')
    .toLowerCase();

  const mentionsIndexerRead =
    haystack.includes('fetchutxodata') ||
    haystack.includes('getutxodata') ||
    haystack.includes('indexer operation');
  const mentionsNetworkFailure =
    haystack.includes('network error') ||
    haystack.includes('failed to fetch') ||
    haystack.includes('networkerror when attempting to fetch resource') ||
    haystack.includes('read service');

  return mentionsIndexerRead && mentionsNetworkFailure;
}

async function assertUmbraIndexerAvailable() {
  const now = Date.now();
  if (umbraIndexerHealthCache.healthy && now - umbraIndexerHealthCache.checkedAt < UMBRA_INDEXER_HEALTH_TTL_MS) {
    return;
  }

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutId = controller
    ? window.setTimeout(() => controller.abort(), 5000)
    : null;

  try {
    const response = await fetch(UMBRA_CONFIG.indexerUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json, text/plain, */*',
      },
      signal: controller?.signal,
    });

    umbraIndexerHealthCache.checkedAt = now;
    umbraIndexerHealthCache.healthy = Boolean(response);
  } catch (error) {
    umbraIndexerHealthCache.checkedAt = now;
    umbraIndexerHealthCache.healthy = false;
    throw createUmbraIndexerUnavailableError(error instanceof Error ? error : undefined);
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
}

function toClaimableUtxoDisplay(utxo, index) {
  const amountLamports = normalizeLamportsValue(utxo.amount);
  const stealthAddress = typeof utxo.destinationAddress === 'string' && utxo.destinationAddress.length > 0
    ? utxo.destinationAddress
    : typeof utxo.senderAddress === 'string' && utxo.senderAddress.length > 0
      ? utxo.senderAddress
      : 'Unknown stealth address';
  const treeIndex = normalizeLamportsValue(utxo.treeIndex);
  const insertionIndex = normalizeLamportsValue(utxo.insertionIndex);

  return {
    id: `${treeIndex}:${insertionIndex}:${index}`,
    amountLamports,
    stealthAddress,
  };
}

function reconstructSignedUmbraTransaction(transaction) {
  if (typeof transaction?.__umbraSignedWireTransactionBase64 === 'string') {
    return VersionedTransaction.deserialize(
      decodeBase64(transaction.__umbraSignedWireTransactionBase64)
    );
  }

  const message = VersionedMessage.deserialize(transaction.messageBytes);
  const versionedTransaction = new VersionedTransaction(message);
  const requiredSignatureCount = Number(message.header.numRequiredSignatures ?? 0);
  const signerAddresses = (message.staticAccountKeys ?? [])
    .slice(0, requiredSignatureCount)
    .map((key) => key.toBase58());
  const signatures = signerAddresses.map((address) => transaction.signatures?.[address]);

  if (signatures.some((signature) => !(signature instanceof Uint8Array))) {
    throw createPaymentLinkSendError('Signed Umbra transaction is missing one or more signatures', {
      signerAddresses,
      availableSigners: Object.keys(transaction.signatures ?? {}),
    });
  }

  versionedTransaction.signatures = signatures.map((signature) => Uint8Array.from(signature));
  return versionedTransaction;
}

function getVersionedTransactionAccounts(versionedTransaction) {
  return (versionedTransaction.message.staticAccountKeys ?? []).map((key) => key.toBase58());
}

async function getCreatePublicProofAccountRentDiagnostics(connection) {
  const { getPublicStealthPoolDepositInputBufferSize } = await import('@umbra-privacy/umbra-codama');
  const proofAccountSize = getPublicStealthPoolDepositInputBufferSize();
  const proofAccountRentExemptLamports = await connection.getMinimumBalanceForRentExemption(
    proofAccountSize,
    'confirmed'
  );

  return {
    proofAccountSize,
    proofAccountRentExemptLamports,
    proofAccountRentExemptSol: proofAccountRentExemptLamports / LAMPORTS_PER_SOL,
  };
}

function createSignedTransactionDiagnosticsHook(connection, label) {
  return async (signedTransaction) => {
    const web3Transaction = reconstructSignedUmbraTransaction(signedTransaction);
    const transactionAccounts = getVersionedTransactionAccounts(web3Transaction);
    const proofAccountRentDiagnostics = label === 'CreatePublicUtxoProofAccount'
      ? await getCreatePublicProofAccountRentDiagnostics(connection)
      : null;
    const simulation = await connection.simulateTransaction(web3Transaction, {
      commitment: 'confirmed',
      sigVerify: true,
    });

    if (simulation.value.err) {
      throw createPaymentLinkSendError(`${label} simulation failed before broadcast`, {
        signature: web3Transaction.signatures[0]
          ? Buffer.from(web3Transaction.signatures[0]).toString('base64')
          : null,
        cause: JSON.stringify(simulation.value.err),
        simulationLogs: simulation.value.logs ?? [],
        unitsConsumed: simulation.value.unitsConsumed ?? null,
        recentBlockhash: web3Transaction.message.recentBlockhash,
        transactionAccounts,
        ...proofAccountRentDiagnostics,
        broadcastFailure: classifyBroadcastFailure(JSON.stringify(simulation.value.err)),
      });
    }

    console.debug('[PaymentLinks] Umbra transaction simulation passed', {
      label,
      recentBlockhash: web3Transaction.message.recentBlockhash,
      unitsConsumed: simulation.value.unitsConsumed ?? null,
      instructionCount: web3Transaction.message.compiledInstructions.length,
      transactionAccounts,
      ...proofAccountRentDiagnostics,
    });
  };
}

function buildSignedPaymentLink(profile) {
  const params = new URLSearchParams({
    tab: 'send',
    a: profile.aliasAddress,
    u: profile.accountPayload,
    ts: String(profile.createdAt),
    sig: profile.signature,
  });

  return `${getPaymentLinkBase()}?${params.toString()}`;
}

function verifyPaymentLinkProfile(profile) {
  try {
    const aliasPubkey = new PublicKey(profile.aliasAddress);
    const signatureBytes = decodeBase64Url(profile.signature);
    const messageBytes = new TextEncoder().encode(
      buildPaymentLinkMessage({
        aliasAddress: aliasPubkey.toBase58(),
        accountPayload: profile.accountPayload,
        createdAt: Number(profile.createdAt),
      })
    );

    decodeJsonPayload(profile.accountPayload);
    return nacl.sign.detached.verify(messageBytes, signatureBytes, aliasPubkey.toBytes());
  } catch {
    return false;
  }
}

function loadStoredPaymentLinkProfile(ownerAddress) {
  if (!ownerAddress) return null;

  const parsed = paymentLinkProfileMemoryCache.get(ownerAddress) ?? null;
  if (!parsed) return null;

  if (!verifyPaymentLinkProfile(parsed)) {
    paymentLinkProfileMemoryCache.delete(ownerAddress);
    return null;
  }

  return parsed;
}

function persistPaymentLinkProfile(profile) {
  paymentLinkProfileMemoryCache.set(profile.ownerAddress, profile);
}

function clearPaymentLinkProfile(ownerAddress) {
  if (!ownerAddress) return;
  paymentLinkProfileMemoryCache.delete(ownerAddress);
}

function resolveSignedPaymentLink(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Enter a valid Umbra payment link');
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Paste the full payment link');
  }

  const aliasAddress = url.searchParams.get('a');
  const accountPayload = url.searchParams.get('u');
  const createdAt = Number(url.searchParams.get('ts'));
  const signature = url.searchParams.get('sig');

  if (!aliasAddress || !accountPayload || !signature || !Number.isFinite(createdAt)) {
    throw new Error('Payment link is missing Umbra receiver metadata');
  }

  const profile = { aliasAddress, accountPayload, createdAt, signature };
  if (!verifyPaymentLinkProfile(profile)) {
    throw new Error('Payment link signature verification failed');
  }

  return profile;
}

function getPaymentFees(amount, tokenSymbol) {
  const baseFees = calculateFees(amount, tokenSymbol, 'net');
  const networkSetupFeeLamports = ZK_OPERATOR_SETUP_LAMPORTS + ZK_TX_FEE_MARGIN_LAMPORTS;
  const tokenDecimals = tokenSymbol === 'SOL' || tokenSymbol === 'WSOL' ? 9 : 6;

  return {
    ...baseFees,
    tokenSymbol,
    tokenDecimals,
    networkSetupFeeLamports,
    networkSetupFee: networkSetupFeeLamports / LAMPORTS_PER_SOL,
    walletRequiredLamports: isSolLikeToken(tokenSymbol)
      && tokenSymbol === 'SOL'
      ? baseFees.totalLamports + networkSetupFeeLamports
      : networkSetupFeeLamports,
    walletRequired: isSolLikeToken(tokenSymbol)
      && tokenSymbol === 'SOL'
      ? (baseFees.totalLamports + networkSetupFeeLamports) / LAMPORTS_PER_SOL
      : networkSetupFeeLamports / LAMPORTS_PER_SOL,
  };
}

function formatTokenAmount(value, tokenSymbol) {
  const decimals = getTokenDisplayDecimals(tokenSymbol);
  return Number(value ?? 0).toFixed(decimals);
}

function buildPaymentReceiptHtml(receipt) {
  const escaped = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Aegis Shield Private Payment Receipt</title>
    <style>
      body { font-family: Arial, sans-serif; background: #0b1020; color: #e6eefc; padding: 32px; }
      .card { max-width: 720px; margin: 0 auto; background: #121a2b; border: 1px solid #25324d; border-radius: 18px; padding: 28px; }
      h1 { margin: 0 0 8px; font-size: 24px; }
      p { color: #9eb0cf; }
      .grid { display: grid; grid-template-columns: 180px 1fr; gap: 12px 16px; margin-top: 24px; }
      .label { color: #7f91b2; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
      .value { color: #e6eefc; word-break: break-word; }
      .note { margin-top: 28px; padding: 14px 16px; border-radius: 12px; background: rgba(71, 181, 255, 0.08); border: 1px solid rgba(71, 181, 255, 0.2); color: #9ed8ff; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Aegis Shield Payment Receipt</h1>
      <p>Verified Private Payment via Aegis Shield</p>
      <div class="grid">
        <div class="label">Date & Time</div><div class="value">${escaped(receipt.timestamp)}</div>
        <div class="label">Amount</div><div class="value">${escaped(receipt.amount)} ${escaped(receipt.tokenSymbol)}</div>
        <div class="label">Destination Alias</div><div class="value">${escaped(receipt.aliasAddress)}</div>
        <div class="label">Transaction Signature</div><div class="value">${escaped(receipt.signature)}</div>
        <div class="label">Network</div><div class="value">${escaped(receipt.network)}</div>
      </div>
      <div class="note">Verified Private Payment via Aegis Shield</div>
    </div>
  </body>
</html>`;
}

function downloadPaymentReceipt(receipt) {
  const blob = new Blob([buildPaymentReceiptHtml(receipt)], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `aegis-payment-receipt-${receipt.signature.slice(0, 12)}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractNestedErrorDiagnostics(error) {
  const visited = new Set();
  const queue = [error];
  const messages = [];
  const logs = [];
  const codes = [];
  const instructionIndexes = [];
  const signatures = [];
  const recentBlockhashes = [];
  const transactionAccounts = [];
  const proofAccountSizes = [];
  const proofAccountRentExemptLamports = [];
  const proofAccountRentExemptSol = [];
  let unitsConsumed = null;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || visited.has(current)) {
      continue;
    }
    visited.add(current);

    const message = current instanceof Error
      ? current.message
      : typeof current.message === 'string'
        ? current.message
        : null;
    if (message && !messages.includes(message)) {
      messages.push(message);
    }

    if (typeof current.signature === 'string' && !signatures.includes(current.signature)) {
      signatures.push(current.signature);
    }

    if (typeof current.recentBlockhash === 'string' && !recentBlockhashes.includes(current.recentBlockhash)) {
      recentBlockhashes.push(current.recentBlockhash);
    }

    if (Array.isArray(current.transactionAccounts)) {
      current.transactionAccounts.forEach((account) => {
        const normalized = String(account);
        if (!transactionAccounts.includes(normalized)) {
          transactionAccounts.push(normalized);
        }
      });
    }

    if (typeof current.proofAccountSize === 'number') {
      proofAccountSizes.push(current.proofAccountSize);
    }
    if (typeof current.proofAccountRentExemptLamports === 'number') {
      proofAccountRentExemptLamports.push(current.proofAccountRentExemptLamports);
    }
    if (typeof current.proofAccountRentExemptSol === 'number') {
      proofAccountRentExemptSol.push(current.proofAccountRentExemptSol);
    }

    if (Array.isArray(current.simulationLogs)) {
      current.simulationLogs.forEach((log) => {
        if (log && !logs.includes(log)) {
          logs.push(log);
        }
      });
    }

    if (typeof current.unitsConsumed === 'number' || typeof current.unitsConsumed === 'bigint') {
      unitsConsumed = current.unitsConsumed;
    }

    if (typeof current.instructionIndex === 'number') {
      instructionIndexes.push(current.instructionIndex);
    }

    if (typeof current.errorCode === 'number') {
      codes.push(current.errorCode);
    }

    if (current.context && typeof current.context === 'object') {
      if (Array.isArray(current.context.logs)) {
        current.context.logs.forEach((log) => {
          if (log && !logs.includes(log)) {
            logs.push(log);
          }
        });
      }
      if (typeof current.context.unitsConsumed === 'number' || typeof current.context.unitsConsumed === 'bigint') {
        unitsConsumed = current.context.unitsConsumed;
      }
      if (typeof current.context.index === 'number') {
        instructionIndexes.push(current.context.index);
      }
      if (typeof current.context.code === 'number') {
        codes.push(current.context.code);
      }
    }

    if (current.cause) {
      queue.push(current.cause);
    }
  }

  return {
    messages,
    logs,
    codes: [...new Set(codes)],
    instructionIndexes: [...new Set(instructionIndexes)],
    signatures,
    recentBlockhashes,
    transactionAccounts,
    proofAccountSizes: [...new Set(proofAccountSizes)],
    proofAccountRentExemptLamports: [...new Set(proofAccountRentExemptLamports)],
    proofAccountRentExemptSol: [...new Set(proofAccountRentExemptSol.map((value) => value.toFixed(9)))],
    unitsConsumed,
  };
}

function appendDiagnosticLine(detailLines, label, values) {
  const normalizedValues = (Array.isArray(values) ? values : [values])
    .filter((value) => value !== null && value !== undefined && `${value}`.length > 0)
    .map((value) => (typeof value === 'bigint' ? value.toString() : String(value)));

  if (normalizedValues.length === 0) {
    return;
  }

  detailLines.push(`${label}: ${normalizedValues.join(', ')}`);
}

function formatErrorForDisplay(error, fallbackPrefix) {
  const diagnostics = extractNestedErrorDiagnostics(error);
  const message = diagnostics.messages[0] ?? (error instanceof Error ? error.message : String(error));

  const detailLines = [];
  appendDiagnosticLine(detailLines, 'Signature', diagnostics.signatures);
  appendDiagnosticLine(detailLines, 'Recent blockhash', diagnostics.recentBlockhashes);
  appendDiagnosticLine(detailLines, 'Failing instruction index', diagnostics.instructionIndexes);
  appendDiagnosticLine(detailLines, 'Program error code', diagnostics.codes);
  appendDiagnosticLine(detailLines, 'Units consumed', diagnostics.unitsConsumed);
  appendDiagnosticLine(detailLines, 'Public proof account size', diagnostics.proofAccountSizes);
  appendDiagnosticLine(detailLines, 'Public proof rent-exempt lamports', diagnostics.proofAccountRentExemptLamports);
  appendDiagnosticLine(detailLines, 'Public proof rent-exempt SOL', diagnostics.proofAccountRentExemptSol);
  const nestedMessages = diagnostics.messages.slice(1).filter((value) => value !== message);
  if (nestedMessages.length > 0) {
    detailLines.push('Causes:');
    detailLines.push(...nestedMessages);
  }
  if (diagnostics.transactionAccounts.length > 0) {
    detailLines.push('Transaction accounts:');
    detailLines.push(...diagnostics.transactionAccounts);
  }
  if (diagnostics.logs.length > 0) {
    detailLines.push('Simulation logs:');
    detailLines.push(...diagnostics.logs);
  }

  if (detailLines.length === 0) {
    return fallbackPrefix ? `${fallbackPrefix}: ${message}` : message;
  }

  return [fallbackPrefix ? `${fallbackPrefix}: ${message}` : message, ...detailLines].join('\n');
}

function createCodamaSignerPlaceholder(address) {
  return {
    address,
    async signTransactions(transactions) {
      return transactions;
    },
  };
}

function convertKitInstructionToWeb3(kitInstruction) {
  return new TransactionInstruction({
    programId: new PublicKey(kitInstruction.programAddress),
    keys: kitInstruction.accounts.map((account) => ({
      pubkey: new PublicKey(account.address),
      isSigner: account.role === 2 || account.role === 3,
      isWritable: account.role === 1 || account.role === 3,
    })),
    data: Buffer.from(kitInstruction.data),
  });
}

async function createNativeUmbraSession(walletContext, setStep) {
  const ownerAddress = walletContext.publicKey?.toBase58();
  const adapter = walletContext.wallet?.adapter;
  const signTransaction = walletContext.signTransaction;
  const signMessage = walletContext.signMessage;

  if (!ownerAddress || !adapter || !signTransaction || !signMessage) {
    throw new Error('Wallet not connected');
  }

  const runtime = await getUmbraRuntime();
  setStep?.('Authorizing Umbra key derivation in your wallet...');
  const walletAccount = {
    address: ownerAddress,
    publicKey: walletContext.publicKey.toBytes(),
    chains: [getWalletStandardChain()],
    features: [SolanaSignTransaction, SolanaSignMessage],
  };
  const directWalletStandardSigner = {
    name: adapter.name || 'Connected Wallet',
    features: {
      [SolanaSignTransaction]: {
        version: '1.0.0',
        signTransaction: async (...inputs) => {
          const outputs = [];
          for (const input of inputs) {
            const transaction = VersionedTransaction.deserialize(input.transaction);
            const signedTransaction = await signTransaction(transaction);
            const mergedTransaction = preserveExistingPartialSignatures(
              transaction,
              signedTransaction,
              walletContext.publicKey
            );
            outputs.push({ signedTransaction: mergedTransaction.serialize() });
          }
          return outputs;
        },
      },
      [SolanaSignMessage]: {
        version: '1.0.0',
        signMessage: async (...inputs) => {
          const outputs = [];
          for (const input of inputs) {
            const signature = await signMessage(input.message);
            outputs.push({ signedMessage: input.message, signature });
          }
          return outputs;
        },
      },
    },
  };

  const signer = runtime.createSignerFromWalletAccount(directWalletStandardSigner, walletAccount);
  const client = await runtime.getUmbraClient({
    signer,
    network: getUmbraClientNetwork(),
    rpcUrl: getDirectUmbraRpcEndpoint(),
    rpcSubscriptionsUrl: getDirectUmbraWsEndpoint(),
    indexerApiEndpoint: UMBRA_CONFIG.indexerUrl,
    deferMasterSeedSignature: false,
  });

  return {
    runtime,
    client,
    ownerAddress,
    destroy() {
      return undefined;
    },
  };
}

async function waitForSignatureConfirmation(connection, signature, label, options = {}) {
  const maxAttempts = options.maxAttempts ?? 20;
  const pollingIntervalMs = options.pollingIntervalMs ?? 1200;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = await connection.getSignatureStatus(signature, {
      searchTransactionHistory: true,
    });
    const value = status?.value;

    if (value?.err) {
      throw new Error(`${label} failed on-chain: ${JSON.stringify(value.err)}`);
    }

    if (value?.confirmationStatus === 'confirmed' || value?.confirmationStatus === 'finalized') {
      return signature;
    }

    await delay(pollingIntervalMs);
  }

  const lastStatus = await connection.getSignatureStatus(signature, {
    searchTransactionHistory: true,
  });

  throw createPaymentLinkSendError(`${label} confirmation timed out after broadcast`, {
    signature,
    confirmationStatus: lastStatus?.value?.confirmationStatus ?? null,
    cause: lastStatus?.value?.err
      ? `Last observed on-chain error: ${JSON.stringify(lastStatus.value.err)}`
      : null,
  });
}

async function sendPaymentLinkAegisFeeTransfer(connection, walletContext, tokenSymbol, amountInSmallestUnit, setStep) {
  if (!walletContext.publicKey || !walletContext.signTransaction || amountInSmallestUnit <= 0) {
    return null;
  }

  const transferTransaction = new Transaction();

  if (tokenSymbol === 'SOL') {
    transferTransaction.add(
      SystemProgram.transfer({
        fromPubkey: walletContext.publicKey,
        toPubkey: new PublicKey(AEGIS_TREASURY_ADDRESS),
        lamports: amountInSmallestUnit,
      })
    );
  } else {
    const mint = new PublicKey(TOKEN_MINTS[tokenSymbol]);
    const owner = walletContext.publicKey;
    const treasuryOwner = new PublicKey(AEGIS_TREASURY_ADDRESS);
    const senderAta = await getAssociatedTokenAddress(mint, owner, false, TOKEN_PROGRAM_ID);
    const treasuryAta = await getAssociatedTokenAddress(mint, treasuryOwner, true, TOKEN_PROGRAM_ID);
    const treasuryAtaInfo = await connection.getAccountInfo(treasuryAta, 'confirmed');

    if (!treasuryAtaInfo) {
      transferTransaction.add(
        createAssociatedTokenAccountInstruction(
          owner,
          treasuryAta,
          treasuryOwner,
          mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }

    transferTransaction.add(
      createTransferInstruction(
        senderAta,
        treasuryAta,
        owner,
        amountInSmallestUnit,
        [],
        TOKEN_PROGRAM_ID
      )
    );
  }

  transferTransaction.feePayer = walletContext.publicKey;
  const latestBlockhash = await connection.getLatestBlockhash('confirmed');
  transferTransaction.recentBlockhash = latestBlockhash.blockhash;

  setStep?.(`Routing Aegis protocol fee in ${tokenSymbol}...`);
  const signedTransaction = await walletContext.signTransaction(transferTransaction);

  const signature = await connection.sendRawTransaction(signedTransaction.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
    preflightCommitment: 'confirmed',
  });

  const confirmation = await connection.confirmTransaction(
    {
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    },
    'confirmed'
  );

  if (confirmation.value.err) {
    throw createPaymentLinkSendError('Aegis fee transfer failed during confirmation', {
      signature,
      cause: JSON.stringify(confirmation.value.err),
    });
  }

  return signature;
}

async function pollForReceiverCommitmentRegistration(queryUserAccount, ownerAddress, setStep) {
  const maxAttempts = 120;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    setStep?.(
      `Umbra anonymous registration was broadcast. No more wallet approvals are needed. Waiting for on-chain finalization (${attempt + 1}/${maxAttempts})...`
    );
    const result = await queryUserAccount(ownerAddress);
    if (result.state === 'exists' && result.data?.isUserCommitmentRegistered) {
      return result;
    }
    await delay(3000);
  }

  return null;
}

async function initializeUmbraReceiverAccount(session, walletContext, connection, setStep) {
  const ownerAddress = session.ownerAddress;
  const ownerPublicKey = walletContext.publicKey;
  const signTransaction = walletContext.signTransaction;

  if (!ownerPublicKey || !signTransaction) {
    throw new Error('Wallet not connected');
  }

  const { getInitialiseEncryptedUserAccountInstructionAsync } = await import('@umbra-privacy/umbra-codama');
  const placeholderSigner = createCodamaSignerPlaceholder(ownerAddress);
  const instruction = await getInitialiseEncryptedUserAccountInstructionAsync(
    {
      userAddress: ownerAddress,
      signer: placeholderSigner,
      feePayer: placeholderSigner,
      randomGenerationSeed: {
        first: crypto.getRandomValues(new Uint8Array(32)),
      },
      optionalData: {
        first: new Uint8Array(32),
      },
    },
    {
      programAddress: UMBRA_CONFIG.programId,
    }
  );

  const transaction = new Transaction().add(convertKitInstructionToWeb3(instruction));
  transaction.feePayer = ownerPublicKey;
  const latestBlockhash = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = latestBlockhash.blockhash;

  setStep?.('Phantom approval: create Umbra receiver account...');
  const signedTransaction = await signTransaction(transaction);

  const simulation = await connection.simulateTransaction(signedTransaction);

  if (simulation.value.err) {
    throw new Error(
      formatErrorForDisplay(
        {
          message: `Umbra receiver account initialization simulation failed: ${JSON.stringify(simulation.value.err)}`,
          simulationLogs: simulation.value.logs ?? [],
        },
        'Umbra confidential registration failed during Creating Umbra receiver account'
      )
    );
  }

  const signature = await connection.sendRawTransaction(signedTransaction.serialize(), {
    skipPreflight: true,
    maxRetries: 3,
    preflightCommitment: 'confirmed',
  });

  await waitForSignatureConfirmation(connection, signature, 'Umbra receiver account initialization');
  return signature;
}

async function ensureRegisteredReceiverMetadata(session, walletContext, setStep) {
  const ownerAddress = session.ownerAddress;
  const connection = new Connection(getDirectUmbraRpcEndpoint(), 'confirmed');
  const queryUserAccount = session.runtime.getUserAccountQuerierFunction({ client: session.client });
  const baseRegistrationForwarder = session.runtime.sdk.getPollingTransactionForwarder({
    rpcUrl: getDirectUmbraRpcEndpoint(),
  });
  const registrationForwarder = {
    forwardSequentially: async (transactions) => {
      const signatures = [];

      for (let index = 0; index < transactions.length; index += 1) {
        const signature = await baseRegistrationForwarder.fireAndForget(transactions[index]);
        signatures.push(
          await waitForSignatureConfirmation(connection, signature, `Umbra registration transaction ${index + 1}`)
        );
      }

      return signatures;
    },
    forwardInParallel: async (transactions) => {
      const signatures = await Promise.all(
        transactions.map(async (transaction, index) => {
          const signature = await baseRegistrationForwarder.fireAndForget(transaction);
          return waitForSignatureConfirmation(
            connection,
            signature,
            `Umbra registration transaction ${index + 1}`
          );
        })
      );

      return signatures;
    },
    fireAndForget: baseRegistrationForwarder.fireAndForget,
  };
  const registerUser = session.runtime.getUserRegistrationFunction(
    { client: session.client },
    {
      zkProver: session.runtime.getUserRegistrationProver(),
      rpc: {
        transactionForwarder: registrationForwarder,
      },
    }
  );
  const registrationStatus = {
    currentStep: 'Preparing Umbra registration',
  };

  const updateRegistrationStep = (message, nextStep = message) => {
    registrationStatus.currentStep = nextStep;
    setStep?.(message);
  };

  const callbacks = {
    userAccountInitialisation: {
      pre: (ctx) => {
        if (ctx?.skipped) {
          registrationStatus.currentStep = 'Umbra receiver account already exists';
          return;
        }
        updateRegistrationStep('Creating Umbra receiver account...', 'Creating Umbra receiver account');
      },
      post: (ctx) => {
        if (ctx?.skipped) {
          return;
        }
        updateRegistrationStep('Umbra receiver account created. Registering X25519 key next...', 'Umbra receiver account created');
      },
    },
    registerX25519PublicKey: {
      pre: (ctx) => {
        if (ctx?.skipped) {
          registrationStatus.currentStep = 'Umbra X25519 key already registered';
          return;
        }
        updateRegistrationStep('Registering Umbra X25519 receiver key...', 'Registering Umbra X25519 receiver key');
      },
      post: (ctx) => {
        if (ctx?.skipped) {
          return;
        }
        updateRegistrationStep('Umbra X25519 key registered.', 'Umbra X25519 key registered');
      },
    },
    registerUserForAnonymousUsage: {
      pre: (ctx) => {
        if (ctx?.skipped) {
          registrationStatus.currentStep = 'Umbra anonymous commitment already registered';
          return;
        }
        updateRegistrationStep('Generating Umbra anonymous registration proof...', 'Registering Umbra anonymous receiver commitment');
      },
      post: (ctx) => {
        if (ctx?.skipped) {
          return;
        }
        updateRegistrationStep('Umbra anonymous receiver commitment registered.', 'Umbra anonymous receiver commitment registered');
      },
    },
  };

  const maybeRecoverRegistrationAfterRpcFailure = async ({
    stepName,
    registrationError,
    requirementMet,
  }) => {
    const message = registrationError instanceof Error ? registrationError.message : String(registrationError);
    const looksLikeRpcFalseNegative = /simulation failed|failed to send transaction/i.test(message);
    const detailedStepName = registrationStatus.currentStep || stepName;

    if (!looksLikeRpcFalseNegative) {
      throw new Error(
        formatErrorForDisplay(
          registrationError,
          `${stepName} failed during ${detailedStepName}`
        )
      );
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      setStep?.(`Verifying ${stepName.toLowerCase()} after RPC false negative (${attempt + 1}/4)...`);
      const refreshedResult = await queryUserAccount(ownerAddress);
      if (refreshedResult.state === 'exists' && requirementMet(refreshedResult.data)) {
        return refreshedResult;
      }

      if (attempt < 3) {
        await delay(1200);
      }
    }

    throw new Error(
      formatErrorForDisplay(
        registrationError,
        `${stepName} failed during ${detailedStepName}`
      )
    );
  };

  setStep?.('Checking Umbra receiver registration...');
  let result = await queryUserAccount(ownerAddress);

  if (result.state !== 'exists') {
    updateRegistrationStep('Creating Umbra receiver account...', 'Creating Umbra receiver account');
    await initializeUmbraReceiverAccount(session, walletContext, connection, setStep);
    result = await queryUserAccount(ownerAddress);
    if (result.state !== 'exists') {
      throw new Error('Umbra receiver account initialization completed, but the account is still missing on-chain.');
    }
  }

  const needsConfidentialRegistration =
    result.state !== 'exists' || !result.data?.isUserAccountX25519KeyRegistered;
  if (needsConfidentialRegistration) {
    const ownerBalanceLamports = await connection.getBalance(new PublicKey(ownerAddress), 'confirmed');
    const minimumRegistrationLamports = ZK_OPERATOR_SETUP_LAMPORTS + ZK_TX_FEE_MARGIN_LAMPORTS;

    if (ownerBalanceLamports < minimumRegistrationLamports) {
      const shortfallLamports = minimumRegistrationLamports - ownerBalanceLamports;
      const shortfallSol = (shortfallLamports / LAMPORTS_PER_SOL).toFixed(4);
      const requiredSol = (minimumRegistrationLamports / LAMPORTS_PER_SOL).toFixed(4);
      const currentSol = (ownerBalanceLamports / LAMPORTS_PER_SOL).toFixed(4);
      throw new Error(
        `Umbra confidential registration requires about ${requiredSol} SOL for account setup and fees. Wallet has ${currentSol} SOL, short by ${shortfallSol} SOL.`
      );
    }

    updateRegistrationStep('Registering Umbra X25519 receiver key...', 'Registering Umbra X25519 receiver key');
    try {
      await registerUser({
        confidential: true,
        anonymous: false,
        callbacks,
      });
    } catch (err) {
      result = await maybeRecoverRegistrationAfterRpcFailure({
        stepName: 'Umbra confidential registration',
        registrationError: err,
        requirementMet: (data) => Boolean(data?.isUserAccountX25519KeyRegistered),
      });
    }

    if (!result?.data?.isUserAccountX25519KeyRegistered) {
      result = await queryUserAccount(ownerAddress);
    }
  }

  const needsAnonymousRegistration =
    result.state !== 'exists' || !result.data?.isUserCommitmentRegistered;
  if (needsAnonymousRegistration) {
    updateRegistrationStep(
      'Generating Umbra anonymous registration proof locally... This can take a while.',
      'Registering Umbra anonymous receiver commitment'
    );
    try {
      const anonymousRegistrationPromise = registerUser({
        confidential: false,
        anonymous: true,
        callbacks,
      });
      anonymousRegistrationPromise.catch(() => {});

      await Promise.race([
        anonymousRegistrationPromise,
        new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error('Umbra anonymous registration is taking longer than expected'));
          }, 90_000);
        }),
      ]);
    } catch (err) {
      if (err instanceof Error && err.message === 'Umbra anonymous registration is taking longer than expected') {
        setStep?.('Umbra anonymous registration was broadcast. Waiting for the Arcium callback to finalize on-chain...');
        const polledResult = await pollForReceiverCommitmentRegistration(
          queryUserAccount,
          ownerAddress,
          setStep
        );

        if (polledResult) {
          result = polledResult;
        } else {
          const refreshedResult = await queryUserAccount(ownerAddress);
          const canBypassAnonymousFinalization =
            NETWORK === 'devnet' &&
            refreshedResult.state === 'exists' &&
            Boolean(refreshedResult.data?.isUserAccountX25519KeyRegistered);

          if (!canBypassAnonymousFinalization) {
            throw new Error(
              'Umbra anonymous registration is still processing after extended on-chain polling. No further wallet approvals are needed. Wait a few minutes and retry to refresh the registration state.'
            );
          }

          setStep?.('Devnet anonymous registration callback is being bypassed locally to continue payment-link generation...');
          result = {
            ...refreshedResult,
            data: {
              ...refreshedResult.data,
              isUserCommitmentRegistered: true,
            },
          };
        }
      } else {
      result = await maybeRecoverRegistrationAfterRpcFailure({
        stepName: 'Umbra anonymous registration',
        registrationError: err,
        requirementMet: (data) => Boolean(data?.isUserCommitmentRegistered),
      });
      }
    }

    if (!result?.data?.isUserCommitmentRegistered) {
      result = await queryUserAccount(ownerAddress);
    }
  }

  if (
    result.state !== 'exists' ||
    !result.data?.isUserAccountX25519KeyRegistered ||
    !result.data?.isUserCommitmentRegistered
  ) {
    throw new Error('Umbra receiver registration is incomplete. X25519 key and user commitment are both required.');
  }

  const baseAccountInfoProvider = session.runtime.getRpcAccountInfoProvider({
    rpcUrl: getDirectUmbraRpcEndpoint(),
  });
  const userAccountPda = await session.runtime.findEncryptedUserAccountPda(
    ownerAddress,
    UMBRA_CONFIG.programId
  );
  const accountMap = await baseAccountInfoProvider([userAccountPda]);
  const userAccount = accountMap.get(userAccountPda);

  if (!userAccount?.exists) {
    throw new Error('Unable to fetch the registered Umbra receiver account snapshot');
  }

  return {
    ownerAddress,
    userAccountPda,
    userAccount,
  };
}

async function createAliasAccountInfoProvider(runtime, linkProfile) {
  const baseAccountInfoProvider = runtime.getRpcAccountInfoProvider({
    rpcUrl: getDirectUmbraRpcEndpoint(),
  });
  const aliasPda = await runtime.findEncryptedUserAccountPda(
    linkProfile.aliasAddress,
    UMBRA_CONFIG.programId
  );
  const accountSnapshot = deserializeAccountSnapshot(
    decodeJsonPayload(linkProfile.accountPayload),
    aliasPda
  );
  const aliasPdaKey = toAddressKey(aliasPda);

  console.debug('[PaymentLinks] alias provider prepared', {
    aliasAddress: linkProfile.aliasAddress,
    aliasPda: aliasPdaKey,
    snapshotExists: accountSnapshot.exists,
    snapshotProgramAddress: accountSnapshot.programAddress,
    snapshotDataLength: accountSnapshot.data.length,
  });

  return async (addresses, options) => {
    const requestedKeys = addresses.map((address) => toAddressKey(address));
    const requestedAliasAddress = addresses.find((address) => toAddressKey(address) === aliasPdaKey);
    const passthroughAddresses = addresses.filter((address) => toAddressKey(address) !== aliasPdaKey);
    const result = passthroughAddresses.length > 0
      ? await baseAccountInfoProvider(passthroughAddresses, options)
      : new Map();

    console.debug('[PaymentLinks] alias provider lookup', {
      aliasAddress: linkProfile.aliasAddress,
      aliasPda: aliasPdaKey,
      requestedKeys,
      matchedAliasKey: requestedAliasAddress ? toAddressKey(requestedAliasAddress) : null,
      passthroughKeys: passthroughAddresses.map((address) => toAddressKey(address)),
      baseResultKeys: [...result.keys()].map((address) => toAddressKey(address)),
      options,
    });

    if (requestedAliasAddress) {
      result.set(requestedAliasAddress, {
        ...accountSnapshot,
        address: requestedAliasAddress,
      });

      console.debug('[PaymentLinks] alias snapshot injected', {
        aliasPda: aliasPdaKey,
        mapHasAlias: result.has(requestedAliasAddress),
        snapshotExists: accountSnapshot.exists,
        snapshotProgramAddress: accountSnapshot.programAddress,
        snapshotDataLength: accountSnapshot.data.length,
      });
    }

    return result;
  };
}

async function scanNativeClaimables(session, aliasAddress = null) {
  const scanClaimable = session.runtime.getClaimableUtxoScannerFunction({ client: session.client });
  const scanResult = await scanClaimable(0n, 0n);

  const claimables = [...(scanResult.received ?? []), ...(scanResult.publicReceived ?? [])];
  const filteredClaimables = aliasAddress
    ? claimables.filter((utxo) => utxo.destinationAddress === aliasAddress)
    : claimables;

  return filteredClaimables.map((utxo) => ({
    ...utxo,
    amount: normalizeLamportsValue(utxo.amount),
  }));
}

export function PaymentLinks() {
  const [tab, setTab] = useState('my-link');
  const { connected, publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58() ?? null;
  const previousWalletAddressRef = useRef(walletAddress);
  const [sessionResetKey, setSessionResetKey] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    purgePersistedPaymentLinkProfilesFromStorage();

    const search = new URLSearchParams(window.location.search);
    if (search.get('tab') === 'send' || search.get('a')) {
      setTab('send');
    }
  }, []);

  useEffect(() => {
    const previousWalletAddress = previousWalletAddressRef.current;
    if (previousWalletAddress === walletAddress) {
      return;
    }

    purgePersistedPaymentLinkProfilesFromStorage();
    setSessionResetKey((current) => current + 1);
    previousWalletAddressRef.current = walletAddress;
  }, [walletAddress]);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-aegis-purple/10 border border-aegis-purple/20 flex items-center justify-center">
            <Link2 className="w-5 h-5 text-aegis-purple" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-aegis-text">Stealth Pay Links</h1>
            <p className="text-xs text-aegis-muted">
              Umbra-native receiver-claimable payment links with no owner wallet in the URL
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-start gap-3 p-3 rounded-xl bg-aegis-purple/5 border border-aegis-purple/20">
          <Shield className="w-4 h-4 text-aegis-purple flex-shrink-0 mt-0.5" />
          <p className="text-xs text-aegis-muted leading-relaxed">
            <span className="text-aegis-purple font-semibold">Umbra receiver metadata links. </span>
            Each link carries a signed alias address plus the owner&apos;s registered Umbra receiver account snapshot.
            Senders deposit through Umbra&apos;s native receiver-claimable path, while the owner wallet stays out of the URL.
          </p>
        </div>
      </div>

      {!connected ? (
        <div className="flex flex-col items-center py-16 gap-4">
          <div className="w-16 h-16 rounded-2xl bg-aegis-purple/10 border border-aegis-purple/20 flex items-center justify-center">
            <Lock className="w-7 h-7 text-aegis-purple" />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-semibold text-aegis-text">Connect Your Wallet</h3>
            <p className="text-sm text-aegis-muted max-w-xs">
              Connect your wallet to generate or manage your Umbra-native payment link.
            </p>
          </div>
          <WalletMultiButton />
        </div>
      ) : (
        <>
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

          {tab === 'my-link' ? (
            <MyPaymentLink key={`my-link:${walletAddress ?? 'disconnected'}:${sessionResetKey}`} />
          ) : tab === 'claim' ? (
            <ClaimPayments key={`claim:${walletAddress ?? 'disconnected'}:${sessionResetKey}`} />
          ) : (
            <SendToAddress key={`send:${walletAddress ?? 'disconnected'}:${sessionResetKey}`} />
          )}
        </>
      )}
    </div>
  );
}

function MyPaymentLink() {
  const walletContext = useWallet();
  const toast = useToast();
  const activeSessionRef = useRef(null);
  const operationTokenRef = useRef(0);

  const [paymentProfile, setPaymentProfile] = useState(null);
  const [error, setError] = useState(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');

  const destroyActiveSession = useCallback(() => {
    activeSessionRef.current?.destroy?.();
    activeSessionRef.current = null;
  }, []);

  const beginOperation = useCallback(() => {
    destroyActiveSession();
    operationTokenRef.current += 1;
    return operationTokenRef.current;
  }, [destroyActiveSession]);

  const isCurrentOperation = useCallback(
    (token) => operationTokenRef.current === token,
    []
  );

  useEffect(() => () => {
    operationTokenRef.current += 1;
    destroyActiveSession();
  }, [destroyActiveSession]);

  useEffect(() => {
    if (!walletContext.publicKey) {
      setPaymentProfile(null);
      setError(null);
      setCopiedLink(false);
      setLoading(false);
      setLoadingStep('');
      return;
    }

    setError(null);
    setCopiedLink(false);
    setLoading(false);
    setLoadingStep('');
    setPaymentProfile(loadStoredPaymentLinkProfile(walletContext.publicKey.toBase58()));
  }, [walletContext.publicKey]);

  const paymentLink = paymentProfile ? buildSignedPaymentLink(paymentProfile) : null;

  const handleGenerate = useCallback(async () => {
    const operationToken = beginOperation();
    setError(null);
    setLoading(true);

    let session;
    try {
      session = await createNativeUmbraSession(walletContext, setLoadingStep);
      activeSessionRef.current = session;
      const receiverMetadata = await ensureRegisteredReceiverMetadata(session, walletContext, setLoadingStep);

      setLoadingStep('Creating owner-hidden alias for this payment link...');
      const aliasKeypair = nacl.sign.keyPair();
      const aliasAddress = new PublicKey(aliasKeypair.publicKey).toBase58();
      const accountPayload = encodeJsonPayload(serializeAccountSnapshot(receiverMetadata.userAccount));
      const createdAt = Date.now();

      setLoadingStep('Signing public link payload with alias key...');
      const signature = encodeBase64Url(
        nacl.sign.detached(
          new TextEncoder().encode(
            buildPaymentLinkMessage({ aliasAddress, accountPayload, createdAt })
          ),
          aliasKeypair.secretKey
        )
      );

      const nextProfile = {
        ownerAddress: receiverMetadata.ownerAddress,
        aliasAddress,
        accountPayload,
        createdAt,
        signature,
      };

      persistPaymentLinkProfile(nextProfile);
      if (!isCurrentOperation(operationToken)) {
        return;
      }
      setPaymentProfile(nextProfile);
      toast.info('Umbra-native payment link created');
    } catch (err) {
      const formattedError = formatErrorForDisplay(err, 'Payment link generation failed');
      if (!isCurrentOperation(operationToken)) {
        return;
      }
      setError(formattedError);
      toast.error(formattedError, { title: 'Failed' });
    } finally {
      activeSessionRef.current = null;
      session?.destroy?.();
      if (isCurrentOperation(operationToken)) {
        setLoading(false);
        setLoadingStep('');
      }
    }
  }, [beginOperation, isCurrentOperation, toast, walletContext]);

  const copyLink = async () => {
    if (!paymentLink) return;
    await navigator.clipboard.writeText(paymentLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  if (loading) {
    return (
      <Card>
        <CardBody>
          <ZKLoader step={loadingStep} />
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-aegis-text">Your Native Umbra Payment Link</h2>
              <p className="text-xs text-aegis-muted mt-0.5">
                Share this link to receive receiver-claimable private payments on {NETWORK}
              </p>
            </div>
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-aegis-card border border-aegis-border text-xs text-aegis-muted hover:text-aegis-cyan hover:border-aegis-cyan/30 transition-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              {paymentProfile ? 'Refresh' : 'Create'}
            </button>
          </div>
        </CardHeader>

        <CardBody className="space-y-5">
          {!paymentProfile && !error && (
            <div className="flex flex-col items-center py-10 gap-4">
              <div className="w-12 h-12 rounded-xl bg-aegis-purple/10 border border-aegis-purple/20 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-aegis-purple" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-aegis-text">Create Your Umbra Receiver Link</p>
                <p className="text-xs text-aegis-muted mt-1 max-w-xs">
                  This registers your wallet with Umbra if needed, snapshots the receiver account metadata,
                  and produces a signed alias link that does not reveal your public wallet address.
                </p>
              </div>
              <Button onClick={handleGenerate} icon={Link2}>
                Create Native Payment Link
              </Button>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-3 p-3 rounded-xl bg-aegis-red/5 border border-aegis-red/20">
              <AlertTriangle className="w-4 h-4 text-aegis-red flex-shrink-0 mt-0.5" />
              <p className="text-xs text-aegis-red">{error}</p>
            </div>
          )}

          {paymentProfile && (
            <>
              <div>
                <label className="form-label">Your Payment Link</label>
                <div className="mt-1 flex gap-2">
                  <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-aegis-card border border-aegis-border overflow-hidden">
                    <span className="text-xs font-mono text-aegis-subtext truncate">
                      {paymentLink}
                    </span>
                  </div>
                  <Button
                    onClick={copyLink}
                    variant="secondary"
                    size="sm"
                    icon={copiedLink ? CheckCheck : Copy}
                  >
                    {copiedLink ? 'Copied!' : 'Copy'}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl p-3 border border-aegis-purple/20 bg-aegis-purple/5">
                  <p className="text-[10px] text-aegis-muted mb-1">Public Alias</p>
                  <p className="text-sm font-mono text-aegis-purple">
                    {shortenAddress(paymentProfile.aliasAddress, 6)}
                  </p>
                </div>
                <div className="rounded-xl p-3 border border-aegis-cyan/20 bg-aegis-cyan/5">
                  <p className="text-[10px] text-aegis-muted mb-1">Routing Material</p>
                  <p className="text-sm font-mono text-aegis-cyan">X25519 + Commitment</p>
                </div>
              </div>

              <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-aegis-green/5 border border-aegis-green/20">
                <Shield className="w-3.5 h-3.5 text-aegis-green flex-shrink-0 mt-0.5" />
                <p className="text-[10px] text-aegis-green leading-relaxed">
                  <span className="font-semibold">This link exposes only an alias address and a signed Umbra receiver-account snapshot.</span>{' '}
                  The owner wallet address is not embedded in the URL, and senders route through Umbra&apos;s native receiver-claimable ECDH flow.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-aegis-card border border-aegis-border">
                <p className="text-xs font-semibold text-aegis-subtext mb-2">How the Native Flow Works</p>
                <div className="space-y-2">
                  {[
                    'Owner wallet registers native Umbra receiver metadata if needed',
                    'Link publishes a signed alias address plus receiver account snapshot',
                    'Sender verifies the signed link and creates a receiver-claimable UTXO',
                    'Umbra derives the AES recovery key via sender/receiver X25519 ECDH',
                    'Owner scans, claims, and withdraws without ever publishing the main wallet in the link',
                  ].map((step, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className="w-4 h-4 rounded-full bg-aegis-cyan/20 border border-aegis-cyan/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-[10px] font-bold text-aegis-cyan">{i + 1}</span>
                      </div>
                      <span className="text-xs text-aegis-subtext">{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function ClaimPayments() {
  const walletContext = useWallet();
  const toast = useToast();
  const activeSessionRef = useRef(null);
  const rawClaimableUtxosRef = useRef([]);
  const operationTokenRef = useRef(0);

  const [mvkReady, setMvkReady] = useState(false);
  const [claimableUtxos, setClaimableUtxos] = useState([]);
  const [claimableLamports, setClaimableLamports] = useState('0');
  const [claimResult, setClaimResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');

  const destroyActiveSession = useCallback(() => {
    activeSessionRef.current?.destroy?.();
    activeSessionRef.current = null;
  }, []);

  const beginOperation = useCallback(() => {
    destroyActiveSession();
    operationTokenRef.current += 1;
    return operationTokenRef.current;
  }, [destroyActiveSession]);

  const isCurrentOperation = useCallback(
    (token) => operationTokenRef.current === token,
    []
  );

  useEffect(() => () => {
    operationTokenRef.current += 1;
    destroyActiveSession();
  }, [destroyActiveSession]);

  useEffect(() => {
    setMvkReady(false);
    rawClaimableUtxosRef.current = [];
    setClaimableUtxos([]);
    setClaimableLamports('0');
    setClaimResult(null);
    setError(null);
    setLoading(false);
    setLoadingStep('');
  }, [walletContext.publicKey]);

  const handleDeriveMvk = useCallback(async () => {
    const operationToken = beginOperation();
    setError(null);
    setClaimResult(null);
    rawClaimableUtxosRef.current = [];
    setClaimableUtxos([]);
    setClaimableLamports('0');
    setLoading(true);

    let session;
    try {
      session = await createNativeUmbraSession(walletContext, setLoadingStep);
      activeSessionRef.current = session;

      if (!isCurrentOperation(operationToken)) {
        session.destroy?.();
        return;
      }

      setMvkReady(true);
      toast.success('Master Viewing Key derived for this session', { title: 'Ready' });
    } catch (err) {
      const formattedError = formatErrorForDisplay(err, 'MVK derivation failed');
      if (!isCurrentOperation(operationToken)) {
        return;
      }
      activeSessionRef.current = null;
      session?.destroy?.();
      setMvkReady(false);
      setError(formattedError);
      toast.error(formattedError, { title: 'Claim Setup Failed' });
    } finally {
      if (isCurrentOperation(operationToken)) {
        setLoading(false);
        setLoadingStep('');
      }
    }
  }, [beginOperation, isCurrentOperation, toast, walletContext]);

  const handleScan = useCallback(async () => {
    const operationToken = operationTokenRef.current + 1;
    operationTokenRef.current = operationToken;
    setError(null);
    setClaimResult(null);
    setLoading(true);

    let session = activeSessionRef.current;
    try {
      if (!walletContext.publicKey) {
        throw new Error('Connect your wallet first');
      }
      if (!mvkReady) {
        throw new Error('Derive your Master Viewing Key before scanning');
      }

      if (!session) {
        session = await createNativeUmbraSession(walletContext, setLoadingStep);
        activeSessionRef.current = session;
      }

      setLoadingStep('Checking Umbra devnet indexer...');
      await assertUmbraIndexerAvailable();

      setLoadingStep('Scanning stealth addresses...');
      const scannedUtxos = await scanNativeClaimables(session);
      const normalizedUtxos = scannedUtxos.map(toClaimableUtxoDisplay);
      const totalLamports = getClaimableLamportsTotal(scannedUtxos);

      if (!isCurrentOperation(operationToken)) {
        return;
      }

      rawClaimableUtxosRef.current = scannedUtxos;
      setClaimableUtxos(normalizedUtxos);
      setClaimableLamports(totalLamports.toString());
      toast.info(
        normalizedUtxos.length > 0
          ? `Found ${normalizedUtxos.length} claimable UTXO${normalizedUtxos.length === 1 ? '' : 's'}`
          : 'No claimable payments found for this wallet'
      );
    } catch (err) {
      if (!isCurrentOperation(operationToken)) {
        return;
      }
      const formattedError = isUmbraIndexerUnavailableError(err)
        ? err.message
        : formatErrorForDisplay(err, 'UTXO scan failed');
      rawClaimableUtxosRef.current = [];
      setClaimableUtxos([]);
      setClaimableLamports('0');
      setError(formattedError);
      toast.error(formattedError, { title: 'Scan Failed' });
    } finally {
      if (isCurrentOperation(operationToken)) {
        setLoading(false);
        setLoadingStep('');
      }
    }
  }, [isCurrentOperation, mvkReady, toast, walletContext]);

  const handleSweep = useCallback(async () => {
    const operationToken = operationTokenRef.current + 1;
    operationTokenRef.current = operationToken;
    setError(null);
    setClaimResult(null);
    setLoading(true);

    let session = activeSessionRef.current;
    let claimStage = 'Claim preparation';
    try {
      if (!walletContext.publicKey) {
        throw new Error('Connect your wallet first');
      }
      if (!mvkReady) {
        throw new Error('Derive your Master Viewing Key before claiming');
      }
      if (rawClaimableUtxosRef.current.length === 0) {
        throw new Error('Scan for claimable UTXOs before sweeping');
      }

      if (!session) {
        claimStage = 'Umbra session setup';
        session = await createNativeUmbraSession(walletContext, setLoadingStep);
        activeSessionRef.current = session;
      }

      const claimableUtxosForClaim = rawClaimableUtxosRef.current.map((utxo) => ({
        ...utxo,
        amount: BigInt(utxo.amount),
      }));

      const totalAmount = getClaimableLamportsTotal(rawClaimableUtxosRef.current);

      setLoadingStep('Claiming scanned UTXOs into Umbra encrypted balance...');
      const relayer = session.runtime.getUmbraRelayer({ apiEndpoint: UMBRA_CONFIG.relayerUrl });
      const claimToEncryptedBalance =
        session.runtime.getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction(
          { client: session.client },
          {
            zkProver: session.runtime.getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver(),
            relayer,
          }
        );

      claimStage = 'Relayer claim';
  const claimResponse = await claimToEncryptedBalance(claimableUtxosForClaim);

      claimStage = 'Wallet withdrawal';
      setLoadingStep('Sweeping claimed SOL into your connected wallet...');
      const withdrawToWallet =
        session.runtime.getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction({
          client: session.client,
        });

      const withdrawSignature = await withdrawToWallet(
        walletContext.publicKey.toBase58(),
        TOKEN_MINTS.SOL,
        totalAmount
      );

      const firstBatch = claimResponse.batches.values().next().value;
      if (!isCurrentOperation(operationToken)) {
        return;
      }

      setClaimResult({
        claimSignature: firstBatch?.callbackSignature ?? firstBatch?.txSignature ?? null,
        withdrawSignature,
        amountLamports: totalAmount.toString(),
        destinationAddress: walletContext.publicKey.toBase58(),
      });
      rawClaimableUtxosRef.current = [];
      setClaimableUtxos([]);
      setClaimableLamports('0');

      toast.success('Claimable payments swept into connected wallet', {
        title: 'Success',
        txSig: withdrawSignature,
      });
    } catch (err) {
      if (!isCurrentOperation(operationToken)) {
        return;
      }
      const formattedError = formatErrorForDisplay(err, `${claimStage} failed`);
      setError(formattedError);
      toast.error(formattedError, { title: 'Sweep Failed' });
    } finally {
      if (isCurrentOperation(operationToken)) {
        setLoading(false);
        setLoadingStep('');
      }
    }
  }, [isCurrentOperation, mvkReady, toast, walletContext]);

  if (loading) {
    return (
      <Card>
        <CardBody>
          <ZKLoader step={loadingStep} />
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div>
            <h2 className="text-base font-semibold text-aegis-text">Claim Stealth Payments</h2>
            <p className="text-xs text-aegis-muted mt-0.5">
              Derive your MVK, scan Umbra claimables for the connected wallet, and sweep them home on {NETWORK}
            </p>
          </div>
        </CardHeader>

        <CardBody className="space-y-5">
          <div className="grid gap-3 md:grid-cols-3">
            <div className={`rounded-xl p-3 border ${mvkReady ? 'border-aegis-green/20 bg-aegis-green/5' : 'border-aegis-purple/20 bg-aegis-purple/5'}`}>
              <p className="text-[10px] text-aegis-muted mb-1">Step 1</p>
              <p className="text-sm font-semibold text-aegis-text">Derive MVK</p>
              <p className="text-[10px] text-aegis-muted mt-1">
                Authorize a wallet message signature so Umbra can derive your master viewing key for this session.
              </p>
            </div>
            <div className={`rounded-xl p-3 border ${mvkReady ? 'border-aegis-cyan/20 bg-aegis-cyan/5' : 'border-aegis-border bg-aegis-card'}`}>
              <p className="text-[10px] text-aegis-muted mb-1">Step 2</p>
              <p className="text-sm font-semibold text-aegis-text">Scan UTXOs</p>
              <p className="text-[10px] text-aegis-muted mt-1">
                Search Umbra stealth addresses for receiver-claimable UTXOs controlled by this wallet.
              </p>
            </div>
            <div className={`rounded-xl p-3 border ${claimableUtxos.length > 0 ? 'border-aegis-green/20 bg-aegis-green/5' : 'border-aegis-border bg-aegis-card'}`}>
              <p className="text-[10px] text-aegis-muted mb-1">Step 3</p>
              <p className="text-sm font-semibold text-aegis-text">Sweep Funds</p>
              <p className="text-[10px] text-aegis-muted mt-1">
                Claim scanned UTXOs into Umbra encrypted balance, then withdraw the total to your connected wallet.
              </p>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-3 p-3 rounded-xl bg-aegis-red/5 border border-aegis-red/20">
              <AlertTriangle className="w-4 h-4 text-aegis-red flex-shrink-0 mt-0.5" />
              <p className="text-xs text-aegis-red whitespace-pre-wrap">{error}</p>
            </div>
          )}

          <div className="rounded-xl border border-aegis-border bg-aegis-card p-4 space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-semibold text-aegis-subtext">Master Viewing Key Session</p>
                <p className="text-[10px] text-aegis-muted mt-1">
                  Status: {mvkReady ? 'Derived and ready to scan' : 'Not derived yet'}
                </p>
              </div>
              <Button onClick={handleDeriveMvk} icon={Eye}>
                {mvkReady ? 'Re-Derive MVK' : 'Derive MVK'}
              </Button>
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-semibold text-aegis-subtext">Available Claimables</p>
                <p className="text-[10px] text-aegis-muted mt-1">
                  Scan all receiver-claimable UTXOs associated with this connected wallet.
                </p>
              </div>
              <Button
                onClick={handleScan}
                variant="secondary"
                icon={RefreshCw}
                disabled={!mvkReady}
              >
                Scan UTXOs
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl p-4 border border-aegis-cyan/20 bg-aegis-cyan/5">
              <p className="text-[10px] text-aegis-muted mb-1">Claimable Balance</p>
              <p className="text-2xl font-semibold text-aegis-text">
                {formatLamportsToSol(claimableLamports)} SOL
              </p>
              <p className="text-[10px] text-aegis-muted mt-1">
                {claimableUtxos.length} claimable UTXO{claimableUtxos.length === 1 ? '' : 's'} found
              </p>
            </div>
            <div className="rounded-xl p-4 border border-aegis-purple/20 bg-aegis-purple/5">
              <p className="text-[10px] text-aegis-muted mb-1">Sweep Destination</p>
              <p className="text-sm font-mono text-aegis-purple">
                {walletContext.publicKey ? shortenAddress(walletContext.publicKey.toBase58(), 8) : 'Wallet not connected'}
              </p>
              <p className="text-[10px] text-aegis-muted mt-1">
                Uses the existing direct withdraw path into the connected main wallet.
              </p>
            </div>
          </div>

          {claimableUtxos.length > 0 && (
            <div className="rounded-xl border border-aegis-border bg-aegis-card p-4 space-y-3">
              <div>
                <p className="text-xs font-semibold text-aegis-subtext">UTXOs Ready To Sweep</p>
                <p className="text-[10px] text-aegis-muted mt-1">
                  Preview of the individual stealth UTXOs that will be aggregated into the final sweep.
                </p>
              </div>
              <div className="space-y-2">
                {claimableUtxos.map((utxo, index) => (
                  <div
                    key={utxo.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-aegis-border px-3 py-2"
                  >
                    <p className="text-xs text-aegis-subtext">
                      {index + 1}. {formatLamportsToSol(utxo.amountLamports)} SOL from stealth address {shortenAddress(utxo.stealthAddress, 6)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-aegis-border bg-aegis-card p-4 space-y-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-semibold text-aegis-subtext">Sweep Claimable Payments</p>
                <p className="text-[10px] text-aegis-muted mt-1">
                  Execute the Umbra claim, then withdraw the aggregated balance into the connected wallet.
                </p>
              </div>
              <Button
                onClick={handleSweep}
                variant="secondary"
                size="sm"
                icon={ArrowRight}
                disabled={!mvkReady || claimableUtxos.length === 0}
              >
                Claim & Sweep
              </Button>
            </div>

            {claimResult && (
              <div className="text-xs text-aegis-subtext space-y-2">
                <p>
                  Swept {formatLamportsToSol(claimResult.amountLamports)} SOL to {shortenAddress(claimResult.destinationAddress, 6)}
                </p>
                {claimResult.claimSignature && (
                  <a
                    href={`https://explorer.solana.com/tx/${claimResult.claimSignature}?cluster=${NETWORK}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-aegis-cyan underline mr-4"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    View claim transaction
                  </a>
                )}
                <a
                  href={`https://explorer.solana.com/tx/${claimResult.withdrawSignature}?cluster=${NETWORK}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-aegis-cyan underline"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  View withdraw transaction
                </a>
              </div>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function SendToAddress() {
  const walletContext = useWallet();
  const { balances, refetch } = useSolanaBalance();
  const toast = useToast();
  const activeSessionRef = useRef(null);
  const operationTokenRef = useRef(0);

  const [recipientLink, setRecipientLink] = useState('');
  const [amount, setAmount] = useState('');
  const [token, setToken] = useState('SOL');
  const [resolvedPaymentLink, setResolvedPaymentLink] = useState(null);
  const [resolveError, setResolveError] = useState(null);
  const [result, setResult] = useState(null);
  const [sendError, setSendError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');

  const destroyActiveSession = useCallback(() => {
    activeSessionRef.current?.destroy?.();
    activeSessionRef.current = null;
  }, []);

  const beginOperation = useCallback(() => {
    destroyActiveSession();
    operationTokenRef.current += 1;
    return operationTokenRef.current;
  }, [destroyActiveSession]);

  const isCurrentOperation = useCallback(
    (token) => operationTokenRef.current === token,
    []
  );

  useEffect(() => () => {
    operationTokenRef.current += 1;
    destroyActiveSession();
  }, [destroyActiveSession]);

  const fees = amount && !isNaN(parseFloat(amount)) && parseFloat(amount) > 0
    ? getPaymentFees(parseFloat(amount), token)
    : null;
  const hasSufficientTokenBalance = !fees || balances[token] >= fees.total;
  const hasSufficientSolBalance = !fees || (token === 'SOL'
    ? balances.SOL >= fees.walletRequired
    : balances.SOL >= fees.networkSetupFee);
  const hasSufficientBalance = hasSufficientTokenBalance && hasSufficientSolBalance;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const search = new URLSearchParams(window.location.search);
    const aliasAddress = search.get('a');
    const accountPayload = search.get('u');
    const createdAt = search.get('ts');
    const signature = search.get('sig');
    if (!aliasAddress || !accountPayload || !createdAt || !signature) return;

    const fullLink = `${getPaymentLinkBase()}?tab=send&a=${aliasAddress}&u=${accountPayload}&ts=${createdAt}&sig=${encodeURIComponent(signature)}`;
    setRecipientLink((current) => current || fullLink);
    try {
      setResolvedPaymentLink(resolveSignedPaymentLink(fullLink));
    } catch {
      setResolvedPaymentLink(null);
    }
  }, []);

  const handleResolve = useCallback(async () => {
    setResolveError(null);
    setSendError(null);
    setResolvedPaymentLink(null);
    try {
      const profile = resolveSignedPaymentLink(recipientLink);
      setResolvedPaymentLink(profile);
      toast.info('Umbra-native payment link verified');
    } catch (err) {
      setResolveError(err.message);
      toast.error(err.message);
    }
  }, [recipientLink, toast]);

  const handleSend = useCallback(async () => {
    if (!resolvedPaymentLink) {
      toast.error('Verify the recipient payment link first');
      return;
    }
    if (!amount || !fees) {
      toast.error('Enter a valid amount');
      return;
    }
    if (!hasSufficientBalance) {
      if (!hasSufficientTokenBalance) {
        toast.error(`Insufficient ${token} balance. Estimated sender requirement is ${formatTokenAmount(fees.total, token)} ${token}.`);
      } else {
        toast.error(`Insufficient SOL balance for network overhead. Estimated SOL required is ${fees.networkSetupFee.toFixed(6)} SOL.`);
      }
      return;
    }

    setLoading(true);
  setSendError(null);
    const operationToken = beginOperation();
    let session;
    try {
      session = await createNativeUmbraSession(walletContext, setLoadingStep);
      activeSessionRef.current = session;
      const connection = new Connection(getDirectUmbraRpcEndpoint(), 'confirmed');
      const confirmedTransactions = [];
      const recordConfirmedTransaction = (label) => async (_transaction, signature) => {
        confirmedTransactions.push({ label, signature });
      };
      const simulateSignedTransaction = (label) =>
        createSignedTransactionDiagnosticsHook(connection, label);

      setLoadingStep('Preparing alias-backed Umbra receiver metadata...');
      const accountInfoProvider = await createAliasAccountInfoProvider(
        session.runtime,
        resolvedPaymentLink
      );

      let aegisFeeSignature = null;

      if (fees.aegisFeeLamports > 0) {
        aegisFeeSignature = await sendPaymentLinkAegisFeeTransfer(
          connection,
          walletContext,
          token,
          fees.aegisFeeLamports,
          setLoadingStep
        );
        confirmedTransactions.push({ label: 'aegis-fee-transfer', signature: aegisFeeSignature });
      }

      setLoadingStep('Creating Umbra receiver-claimable UTXO from public balance...');
      const createReceiverClaimableUtxo =
        session.runtime.getPublicBalanceToReceiverClaimableUtxoCreatorFunction(
          { client: session.client },
          {
            zkProver: session.runtime.getCreateReceiverClaimableUtxoFromPublicBalanceProver(),
            rpc: { accountInfoProvider },
            hooks: {
              closeProofAccount: {
                pre: simulateSignedTransaction('ClosePublicUtxoProofAccount'),
                post: recordConfirmedTransaction('close-proof-account'),
              },
              createProofAccount: {
                pre: simulateSignedTransaction('CreatePublicUtxoProofAccount'),
                post: recordConfirmedTransaction('create-proof-account'),
              },
              createUtxo: {
                pre: simulateSignedTransaction('CreateDepositIntoMixerTreeFromPublicBalance'),
                post: recordConfirmedTransaction('create-utxo'),
              },
            },
          }
        );

      console.debug('[PaymentLinks] sender claimable UTXO creator configured', {
        aliasAddress: resolvedPaymentLink.aliasAddress,
        providerInjectedViaRpc: true,
        sdkForwarderEnabled: true,
        customTransactionMutationEnabled: false,
      });

      const signatures = await createReceiverClaimableUtxo({
        destinationAddress: resolvedPaymentLink.aliasAddress,
        mint: TOKEN_MINTS[token],
        amount: BigInt(fees.grossDepositLamports),
      });

      const primaryTransaction = confirmedTransactions.find((transaction) => transaction.label === 'create-utxo');
      const finalSignature = primaryTransaction?.signature ?? signatures[0] ?? signatures[signatures.length - 1] ?? aegisFeeSignature;

      if (!isCurrentOperation(operationToken)) {
        return;
      }
      setResult({
        status: 'confirmed',
        signature: finalSignature,
        fees,
        transactions: confirmedTransactions,
        token,
        amount,
        aliasAddress: resolvedPaymentLink.aliasAddress,
        createdAt: new Date().toISOString(),
      });
      toast.success('Payment confirmed and ready for recipient claim.', {
        title: 'Confirmed',
        txSig: finalSignature,
      });
      refetch();
    } catch (err) {
      if (!isCurrentOperation(operationToken)) {
        return;
      }
      console.error('[PaymentLinks] send failed', err);
      const formattedError = formatErrorForDisplay(err, 'Payment link send failed');
      console.error('[PaymentLinks] send diagnostics', extractNestedErrorDiagnostics(err));
      setSendError(formattedError);
      setResult({
        status: 'failed',
        signature: null,
        fees,
        transactions: confirmedTransactions,
        failureMessage: formattedError,
        token,
        amount,
        aliasAddress: resolvedPaymentLink.aliasAddress,
        createdAt: new Date().toISOString(),
      });
      toast.error(formattedError, { title: 'Send Failed' });
    } finally {
      activeSessionRef.current = null;
      session?.destroy?.();
      if (isCurrentOperation(operationToken)) {
        setLoading(false);
        setLoadingStep('');
      }
    }
  }, [beginOperation, isCurrentOperation, resolvedPaymentLink, amount, fees, hasSufficientBalance, hasSufficientTokenBalance, toast, refetch, token, walletContext]);

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
        <CardBody>
          <div className="flex flex-col items-center py-8 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-aegis-green/10 border border-aegis-green/20 flex items-center justify-center">
              <CheckCheck className="w-7 h-7 text-aegis-green" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-semibold text-aegis-text">
                {result.status === 'confirmed'
                  ? 'Payment Confirmed!'
                  : result.status === 'failed'
                    ? 'Payment Failed'
                    : 'Payment Complete!'}
              </h3>
              <p className="text-sm text-aegis-muted mt-1">
                {result.status === 'failed'
                  ? 'The payment did not complete successfully.'
                  : 'Funds were routed through Umbra\'s receiver-claimable path. The recipient can scan and claim when ready.'}
              </p>
            </div>
            {result.status === 'failed' && result.failureMessage && (
              <div className="max-w-xl rounded-xl border border-aegis-amber/30 bg-aegis-amber/5 px-3 py-2 text-xs text-aegis-amber text-left">
                {result.failureMessage}
              </div>
            )}
            <div className="text-xs font-mono text-aegis-muted">
              Estimated net claimable: {formatTokenAmount(result.fees.netDeposit, result.token)} {result.token}
            </div>
            <div className="w-full max-w-xl rounded-xl border border-aegis-border bg-aegis-card px-4 py-4 text-left space-y-2">
              <p className="text-xs text-aegis-muted">Date & Time</p>
              <p className="text-sm text-aegis-text">{new Date(result.createdAt).toLocaleString()}</p>
              <p className="text-xs text-aegis-muted pt-2">Amount & Token</p>
              <p className="text-sm text-aegis-text">{formatTokenAmount(result.amount, result.token)} {result.token}</p>
              <p className="text-xs text-aegis-muted pt-2">Destination Alias</p>
              <p className="text-sm font-mono text-aegis-text">{result.aliasAddress}</p>
              <p className="text-xs text-aegis-muted pt-2">Transaction Signature</p>
              <p className="text-sm font-mono text-aegis-text break-all">{result.signature ?? 'Unavailable'}</p>
              <p className="text-xs text-aegis-cyan pt-2">Verified Private Payment via Aegis Shield</p>
            </div>
            <div className="space-y-2 text-sm flex flex-col items-center">
              {result.signature && (
                <a
                  href={`https://explorer.solana.com/tx/${result.signature}?cluster=${NETWORK}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-aegis-cyan underline"
                >
                  <ExternalLink className="w-4 h-4" />
                  View Transaction on Explorer
                </a>
              )}
              {result.signature && (
                <Button
                  onClick={() => downloadPaymentReceipt({
                    timestamp: new Date(result.createdAt).toLocaleString(),
                    amount: formatTokenAmount(result.amount, result.token),
                    tokenSymbol: result.token,
                    aliasAddress: result.aliasAddress,
                    signature: result.signature,
                    network: NETWORK,
                  })}
                  variant="secondary"
                  icon={Download}
                >
                  Download Receipt
                </Button>
              )}
            </div>
            <Button onClick={() => setResult(null)} variant="secondary">
              Send Another
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold text-aegis-text">Send Native Private Payment</h2>
        <p className="text-xs text-aegis-muted mt-0.5">
          Paste the recipient&apos;s Umbra-native payment link
        </p>
      </CardHeader>

      <CardBody className="space-y-5">
        <div>
          <label className="form-label">Recipient Payment Link</label>
          <div className="flex gap-2 mt-1">
            <input
              type="text"
              value={recipientLink}
              onChange={(e) => {
                setRecipientLink(e.target.value);
                setResolvedPaymentLink(null);
                setResolveError(null);
              }}
              placeholder="Paste recipient's Umbra-native payment link"
              className="input flex-1"
            />
            <Button
              onClick={handleResolve}
              variant="secondary"
              size="lg"
              disabled={!recipientLink}
              icon={Eye}
              className="shrink-0"
            >
              Verify
            </Button>
          </div>
          {resolveError && (
            <p className="text-xs text-aegis-red mt-1 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              {resolveError}
            </p>
          )}
          {resolvedPaymentLink && (
            <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-aegis-green/5 border border-aegis-green/20">
              <CheckCheck className="w-3.5 h-3.5 text-aegis-green flex-shrink-0" />
              <div className="text-xs space-y-0.5">
                <div>
                  <span className="text-aegis-muted">Alias address: </span>
                  <span className="text-aegis-text font-mono">{shortenAddress(resolvedPaymentLink.aliasAddress, 8)}</span>
                </div>
                <div>
                  <span className="text-aegis-muted">Owner wallet in URL: </span>
                  <span className="text-aegis-green font-semibold">Hidden</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {sendError && (
          <div className="rounded-xl border border-aegis-red/20 bg-aegis-red/5 px-3 py-3 text-xs text-aegis-red whitespace-pre-wrap break-words">
            {sendError}
          </div>
        )}

        <div>
          <label className="form-label">Amount</label>
          <div className="mt-1 flex gap-2">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              min="0"
              step="any"
              className="input w-full"
            />
            <TokenSelector value={token} onChange={setToken} disabled={loading} />
          </div>
          <p className="mt-1 text-xs text-aegis-muted">
            Balance: {formatTokenAmount(balances[token], token)} {token}
          </p>
          {fees && (
            <p className="mt-1 text-xs text-aegis-muted">
              {token === 'SOL'
                ? `Estimated wallet required right now: ${fees.walletRequired.toFixed(6)} SOL`
                : `Estimated SOL network overhead right now: ${fees.networkSetupFee.toFixed(6)} SOL`}
              <span className="text-aegis-muted/70"> (exact recipient amount + protocol fees + ZK setup overhead)</span>
            </p>
          )}
          {fees && !hasSufficientTokenBalance && (
            <p className="mt-1 text-xs text-aegis-red flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              Wallet balance is below the estimated {token} amount required to send this payment.
            </p>
          )}
          {fees && hasSufficientTokenBalance && !hasSufficientSolBalance && (
            <p className="mt-1 text-xs text-aegis-red flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              Wallet balance is below the estimated SOL overhead required to send this payment.
            </p>
          )}
        </div>

        {fees && (
          <FeeBreakdown
            fees={fees}
            tokenSymbol={token}
            showFull
            networkSetupFee={token === 'SOL' ? fees.networkSetupFee : 0}
          />
        )}
        {fees && token !== 'SOL' && (
          <div className="rounded-xl border border-aegis-border/60 bg-aegis-card/50 px-4 py-3 text-xs text-aegis-muted">
            In addition to the {token} amount above, this flow still requires about {fees.networkSetupFee.toFixed(6)} SOL for transaction fees, proof-account rent, and sender setup overhead.
          </div>
        )}
      </CardBody>

      <CardFooter>
        <Button
          onClick={handleSend}
          loading={loading}
          disabled={!resolvedPaymentLink || !amount || !fees || !hasSufficientBalance}
          size="lg"
          className="w-full"
          icon={Send}
        >
          Send Privately
          {fees && (
            <span className="ml-1 text-aegis-cyan/60">
              — {formatTokenAmount(fees.total, token)} {token}
            </span>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
