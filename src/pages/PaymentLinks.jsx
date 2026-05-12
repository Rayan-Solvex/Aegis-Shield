import React, { useState, useCallback, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from '@solana/web3.js';
import { SolanaSignMessage, SolanaSignTransaction } from '@solana/wallet-standard-features';
import nacl from 'tweetnacl';
import {
  Link2,
  Copy,
  CheckCheck,
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
  { id: 'send', label: 'Send to Link', icon: Send },
];

const PAYMENT_LINK_PROFILE_PREFIX = 'aegis-payment-link-profile-v3:';
const PAYMENT_LINK_SIGNING_DOMAIN = 'AEGIS_SHIELD_UMBRA_NATIVE_LINK_V1';

function getWalletStandardChain() {
  return NETWORK === 'mainnet-beta' ? 'solana:mainnet' : 'solana:devnet';
}

function getUmbraClientNetwork() {
  return NETWORK === 'mainnet-beta' ? 'mainnet' : 'devnet';
}

function getDirectUmbraRpcEndpoint() {
  return NETWORK === 'mainnet-beta'
    ? 'https://api.mainnet-beta.solana.com'
    : 'https://api.devnet.solana.com';
}

function getDirectUmbraWsEndpoint() {
  return NETWORK === 'mainnet-beta'
    ? 'wss://api.mainnet-beta.solana.com'
    : 'wss://api.devnet.solana.com';
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
  if (typeof window === 'undefined' || !ownerAddress) return null;

  try {
    const raw = window.localStorage.getItem(getPaymentLinkStorageKey(ownerAddress));
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!verifyPaymentLinkProfile(parsed)) {
      window.localStorage.removeItem(getPaymentLinkStorageKey(ownerAddress));
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function persistPaymentLinkProfile(profile) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(getPaymentLinkStorageKey(profile.ownerAddress), JSON.stringify(profile));
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

function getNativePaymentFees(amount) {
  const baseFees = calculateFees(amount, 'SOL');
  return {
    ...baseFees,
    aegisFeeLamports: 0,
    aegisFee: 0,
    aegisFeePercent: '0.0',
    includesAegisFee: false,
    totalFeeLamports: baseFees.umbraFeeLamports,
    totalFees: baseFees.umbraFee,
    totalLamports: baseFees.rawLamports,
    total: baseFees.raw,
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatErrorForDisplay(error, fallbackPrefix) {
  const message = error instanceof Error ? error.message : String(error);
  const signature = typeof error?.signature === 'string' ? error.signature : null;
  const simulationLogs = Array.isArray(error?.simulationLogs)
    ? error.simulationLogs.filter(Boolean)
    : [];
  const causeMessage = error?.cause instanceof Error
    ? error.cause.message
    : typeof error?.cause === 'string'
      ? error.cause
      : null;

  const detailLines = [];
  if (signature) {
    detailLines.push(`Signature: ${signature}`);
  }
  if (causeMessage && causeMessage !== message) {
    detailLines.push(`Cause: ${causeMessage}`);
  }
  if (simulationLogs.length > 0) {
    detailLines.push('Simulation logs:');
    detailLines.push(...simulationLogs);
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
            outputs.push({ signedTransaction: signedTransaction.serialize() });
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

async function waitForSignatureConfirmation(connection, signature, label) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
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

    await delay(1200);
  }

  throw new Error(`${label} confirmation timed out after broadcast`);
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
          throw new Error(
            'Umbra anonymous registration is still processing after extended on-chain polling. No further wallet approvals are needed. Wait a few minutes and retry to refresh the registration state.'
          );
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

  return async (addresses, options) => {
    const passthroughAddresses = addresses.filter((address) => address !== aliasPda);
    const result = passthroughAddresses.length > 0
      ? await baseAccountInfoProvider(passthroughAddresses, options)
      : new Map();

    if (addresses.includes(aliasPda)) {
      result.set(aliasPda, accountSnapshot);
    }

    return result;
  };
}

async function scanNativeClaimables(session, aliasAddress) {
  const scanClaimable = session.runtime.getClaimableUtxoScannerFunction({ client: session.client });
  const scanResult = await scanClaimable(0, 0);

  return [...(scanResult.received ?? []), ...(scanResult.publicReceived ?? [])].filter(
    (utxo) => utxo.destinationAddress === aliasAddress
  );
}

export function PaymentLinks() {
  const [tab, setTab] = useState('my-link');
  const { connected } = useWallet();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const search = new URLSearchParams(window.location.search);
    if (search.get('tab') === 'send' || search.get('a')) {
      setTab('send');
    }
  }, []);

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

          {tab === 'my-link' ? <MyPaymentLink /> : <SendToAddress />}
        </>
      )}
    </div>
  );
}

function MyPaymentLink() {
  const walletContext = useWallet();
  const toast = useToast();

  const [paymentProfile, setPaymentProfile] = useState(null);
  const [error, setError] = useState(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [claimResult, setClaimResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');

  useEffect(() => {
    if (!walletContext.publicKey) {
      setPaymentProfile(null);
      return;
    }

    setPaymentProfile(loadStoredPaymentLinkProfile(walletContext.publicKey.toBase58()));
  }, [walletContext.publicKey]);

  const paymentLink = paymentProfile ? buildSignedPaymentLink(paymentProfile) : null;

  const handleGenerate = useCallback(async () => {
    setError(null);
    setClaimResult(null);
    setLoading(true);

    let session;
    try {
      session = await createNativeUmbraSession(walletContext, setLoadingStep);
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
      setPaymentProfile(nextProfile);
      toast.info('Umbra-native payment link created');
    } catch (err) {
      const formattedError = formatErrorForDisplay(err, 'Payment link generation failed');
      setError(formattedError);
      toast.error(formattedError, { title: 'Failed' });
    } finally {
      session?.destroy?.();
      setLoading(false);
      setLoadingStep('');
    }
  }, [toast, walletContext]);

  const handleClaim = useCallback(async () => {
    setError(null);
    setClaimResult(null);
    setLoading(true);

    let session;
    try {
      if (!walletContext.publicKey || !paymentProfile) {
        throw new Error('Load your payment link first');
      }

      session = await createNativeUmbraSession(walletContext, setLoadingStep);

      setLoadingStep('Scanning Umbra claimable UTXOs for this link...');
      const claimableUtxos = await scanNativeClaimables(session, paymentProfile.aliasAddress);
      if (claimableUtxos.length === 0) {
        throw new Error('No pending receiver-claimable payments were found for this link');
      }

      const totalAmount = claimableUtxos.reduce(
        (sum, utxo) => sum + BigInt(utxo.amount),
        0n
      );

      setLoadingStep('Claiming receiver-claimable UTXOs into Umbra encrypted balance...');
      const relayer = session.runtime.getUmbraRelayer({ apiEndpoint: UMBRA_CONFIG.relayerUrl });
      const claimToEncryptedBalance =
        session.runtime.getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction(
          { client: session.client },
          {
            zkProver: session.runtime.getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver(),
            relayer,
          }
        );

      const claimResponse = await claimToEncryptedBalance(claimableUtxos);

      setLoadingStep('Withdrawing claimed SOL from Umbra encrypted balance to connected wallet...');
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
      setClaimResult({
        claimSignature: firstBatch?.callbackSignature ?? firstBatch?.txSignature ?? null,
        withdrawSignature,
        amount: Number(totalAmount) / LAMPORTS_PER_SOL,
        destinationAddress: walletContext.publicKey.toBase58(),
      });

      toast.success('Receiver-claimable payments claimed to connected wallet', {
        title: 'Success',
        txSig: withdrawSignature,
      });
    } catch (err) {
      setError(err.message);
      toast.error(err.message, { title: 'Claim Failed' });
    } finally {
      session?.destroy?.();
      setLoading(false);
      setLoadingStep('');
    }
  }, [paymentProfile, toast, walletContext]);

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

              <div className="p-3 rounded-xl bg-aegis-card border border-aegis-border space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-aegis-subtext">Claim Incoming Payments</p>
                    <p className="text-[10px] text-aegis-muted mt-1">
                      Scan this link&apos;s receiver-claimable UTXOs, claim them into Umbra encrypted balance, then withdraw SOL to the connected wallet.
                    </p>
                  </div>
                  <Button onClick={handleClaim} variant="secondary" size="sm" icon={ArrowRight}>
                    Claim Now
                  </Button>
                </div>
                {claimResult && (
                  <div className="text-xs text-aegis-subtext space-y-2">
                    <p>
                      Claimed {formatAmount(claimResult.amount)} SOL to {shortenAddress(claimResult.destinationAddress, 6)}
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

function SendToAddress() {
  const walletContext = useWallet();
  const { balances, refetch } = useSolanaBalance();
  const toast = useToast();

  const [recipientLink, setRecipientLink] = useState('');
  const [amount, setAmount] = useState('');
  const [resolvedPaymentLink, setResolvedPaymentLink] = useState(null);
  const [resolveError, setResolveError] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');

  const fees = amount && !isNaN(parseFloat(amount)) && parseFloat(amount) > 0
    ? getNativePaymentFees(parseFloat(amount))
    : null;

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
    if (parseFloat(amount) > balances.SOL) {
      toast.error('Insufficient SOL balance');
      return;
    }

    setLoading(true);
    let session;
    try {
      session = await createNativeUmbraSession(walletContext, setLoadingStep);

      setLoadingStep('Preparing alias-backed Umbra receiver metadata...');
      const accountInfoProvider = await createAliasAccountInfoProvider(
        session.runtime,
        resolvedPaymentLink
      );

      setLoadingStep('Creating Umbra receiver-claimable UTXO from public balance...');
      const createReceiverClaimableUtxo =
        session.runtime.getPublicBalanceToReceiverClaimableUtxoCreatorFunction(
          { client: session.client },
          {
            zkProver: session.runtime.getCreateReceiverClaimableUtxoFromPublicBalanceProver(),
            accountInfoProvider,
          }
        );

      const signatures = await createReceiverClaimableUtxo({
        destinationAddress: resolvedPaymentLink.aliasAddress,
        mint: TOKEN_MINTS.SOL,
        amount: BigInt(Math.round(parseFloat(amount) * LAMPORTS_PER_SOL)),
      });

      const finalSignature = signatures[signatures.length - 1] ?? signatures[0];
      setResult({ signature: finalSignature, fees });
      toast.success('Payment sent through Umbra receiver-claimable flow', {
        title: 'Success',
        txSig: finalSignature,
      });
      refetch();
    } catch (err) {
      toast.error(err.message, { title: 'Send Failed' });
    } finally {
      session?.destroy?.();
      setLoading(false);
      setLoadingStep('');
    }
  }, [resolvedPaymentLink, amount, fees, balances.SOL, toast, refetch, walletContext]);

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
              <h3 className="text-lg font-semibold text-aegis-text">Payment Sent!</h3>
              <p className="text-sm text-aegis-muted mt-1">
                Funds were routed through Umbra&apos;s receiver-claimable path. The recipient can scan and claim when ready.
              </p>
            </div>
            <div className="text-xs font-mono text-aegis-muted">
              Estimated net claimable: {result.fees.netDeposit.toFixed(6)} SOL
            </div>
            <a
              href={`https://explorer.solana.com/tx/${result.signature}?cluster=${NETWORK}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-aegis-cyan underline"
            >
              <ExternalLink className="w-4 h-4" />
              View on Explorer
            </a>
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

        <div>
          <label className="form-label">Amount (SOL)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            min="0"
            step="any"
            className="input mt-1 w-full"
          />
          <p className="mt-1 text-xs text-aegis-muted">
            Balance: {balances.SOL.toFixed(6)} SOL
          </p>
        </div>

        {fees && <FeeBreakdown fees={fees} tokenSymbol="SOL" />}
      </CardBody>

      <CardFooter>
        <Button
          onClick={handleSend}
          loading={loading}
          disabled={!resolvedPaymentLink || !amount || !fees}
          size="lg"
          className="w-full"
          icon={Send}
        >
          Send Privately
          {fees && (
            <span className="ml-1 text-aegis-cyan/60">
              — {fees.total.toFixed(4)} SOL
            </span>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
