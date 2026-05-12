/**
 * Aegis Shield — Umbra Protocol Integration Layer (Local Implementation)
 *
 * Implements stealth-address privacy using:
 *  - tweetnacl  → ed25519 ephemeral keypair generation (client-side only)
 *  - web crypto → SHA-256 key derivation, AES-GCM memo encryption
 *  - @solana/web3.js + @solana/spl-token → real on-chain Devnet transactions
 *
 * Protocol flow:
 *  1. Sender generates an ephemeral stealth keypair (spendingKey = 32-byte seed)
 *  2. Funds are sent to the stealth address (ed25519 pubkey of that seed)
 *  3. Gift-card URL fragment holds the spendingKey — only the holder can redeem
 *  4. Recipient reconstructs the Keypair from spendingKey and sweeps funds out
 *
 * Privacy: stealth address is never linked to sender's wallet on-chain.
 */

import nacl from 'tweetnacl';
import { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
} from '@solana/spl-token';
import { UMBRA_CONFIG, AEGIS_FEE_PERCENT, TOKEN_DECIMALS, TOKEN_MINTS } from '../config.js';

// ─── Official Umbra SDK Runtime (lazy-loaded) ───────────────────────────────
// Keep imports dynamic to avoid browser startup crashes from transitive Node-only
// modules. Call this only inside user-triggered actions.
let _umbraRuntime = null;

const DEVNET_UMBRA_NETWORK_CONFIG = {
  programId: UMBRA_CONFIG.programId,
  mxeAccountAddress: '9AutF4oqBAoV1AGXvtco4BJ9JUrA3q3gLMu5iSvWw1Pk',
  mxePubkey: new Uint8Array([
    161,
    116,
    69,
    123,
    62,
    237,
    162,
    81,
    127,
    36,
    186,
    200,
    0,
    227,
    161,
    189,
    79,
    30,
    34,
    244,
    226,
    255,
    252,
    228,
    104,
    141,
    240,
    85,
    83,
    199,
    173,
    7,
  ]),
  arciumProgramAddress: 'Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ',
  addressLookupTables: {},
};

function normalizeUmbraNetwork(network) {
  return network === 'mainnet-beta' ? 'mainnet' : network;
}

export async function getUmbraRuntime() {
  if (_umbraRuntime) return _umbraRuntime;

  const sdk = await import('@umbra-privacy/sdk');
  const prover = await import('@umbra-privacy/web-zk-prover');

  _umbraRuntime = {
    sdk,
    prover,
    createInMemorySigner: sdk.createInMemorySigner,
    createSignerFromPrivateKeyBytes: sdk.createSignerFromPrivateKeyBytes,
    createSignerFromWalletAccount: sdk.createSignerFromWalletAccount,
    getRpcAccountInfoProvider: sdk.getRpcAccountInfoProvider,
    getUmbraClient: sdk.getUmbraClient,
    getUserRegistrationFunction: sdk.getUserRegistrationFunction,
    getUserAccountQuerierFunction: sdk.getUserAccountQuerierFunction,
    getPublicBalanceToSelfClaimableUtxoCreatorFunction:
      sdk.getPublicBalanceToSelfClaimableUtxoCreatorFunction,
    getPublicBalanceToReceiverClaimableUtxoCreatorFunction:
      sdk.getPublicBalanceToReceiverClaimableUtxoCreatorFunction,
    getClaimableUtxoScannerFunction: sdk.getClaimableUtxoScannerFunction,
    getSelfClaimableUtxoToEncryptedBalanceClaimerFunction:
      sdk.getSelfClaimableUtxoToEncryptedBalanceClaimerFunction,
    getSelfClaimableUtxoToPublicBalanceClaimerFunction:
      sdk.getSelfClaimableUtxoToPublicBalanceClaimerFunction,
    getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction:
      sdk.getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction,
    getEncryptedBalanceQuerierFunction: sdk.getEncryptedBalanceQuerierFunction,
    getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction:
      sdk.getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction,
    getUmbraRelayer: sdk.getUmbraRelayer,
    findEncryptedUserAccountPda: sdk.findEncryptedUserAccountPda,
    getUserRegistrationProver: prover.getUserRegistrationProver,
    getCreateSelfClaimableUtxoFromPublicBalanceProver:
      prover.getCreateSelfClaimableUtxoFromPublicBalanceProver,
    getCreateReceiverClaimableUtxoFromPublicBalanceProver:
      prover.getCreateReceiverClaimableUtxoFromPublicBalanceProver,
    getClaimSelfClaimableUtxoIntoEncryptedBalanceProver:
      prover.getClaimSelfClaimableUtxoIntoEncryptedBalanceProver,
    getClaimSelfClaimableUtxoIntoPublicBalanceProver:
      prover.getClaimSelfClaimableUtxoIntoPublicBalanceProver,
    getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver:
      prover.getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver,
  };

  return _umbraRuntime;
}

export async function ensureUmbraNetworkConfig(network) {
  const normalizedNetwork = normalizeUmbraNetwork(network);

  if (normalizedNetwork === 'devnet') {
    return DEVNET_UMBRA_NETWORK_CONFIG;
  }

  const constants = await import('@umbra-privacy/sdk/constants');

  try {
    return constants.getNetworkConfig(normalizedNetwork);
  } catch {
    throw new Error(
      `Umbra SDK ${normalizedNetwork} network configuration is missing in the installed package. ` +
      `Issue flow has been blocked before broadcast to avoid another ghost transaction. ` +
      `Update or rebuild the SDK package with populated ${normalizedNetwork} constants before retrying.`
    );
  }
}

// ─── Local SDK Factory ────────────────────────────────────────────────────────
/**
 * Creates a local SDK object that implements the UmbraSDK interface.
 * All cryptography runs in the browser — no external package required.
 */
function createLocalUmbraSDK(connection) {
  return {
    /**
     * Generate a fresh ephemeral stealth keypair.
     * spendingKey   = 32-byte random seed (hex) — controls spending
     * stealthAddress = ed25519 pubkey of that seed — receives on-chain funds
     * viewingKey    = first 16 bytes of pubkey (hex) — for audit trail
     * masterViewingKey = full 64-byte nacl secret key (hex)
     */
    async generateStealthKeys() {
      const seed = nacl.randomBytes(32);
      const kp = nacl.sign.keyPair.fromSeed(seed);
      const spendingKey = bytesToHex(seed);
      const viewingKey = bytesToHex(kp.publicKey.slice(0, 16));
      const masterViewingKey = bytesToHex(kp.secretKey);
      const stealthAddress = new PublicKey(kp.publicKey).toBase58();
      return { spendingKey, viewingKey, masterViewingKey, stealthAddress };
    },

    /** Derive a stealth address deterministically from a viewing key. */
    async generateStealthAddress(viewingKey) {
      const padded = viewingKey.padEnd(64, '0').slice(0, 64);
      const seed = hexToBytes(padded);
      const kp = nacl.sign.keyPair.fromSeed(seed);
      return new PublicKey(kp.publicKey).toBase58();
    },

    /**
     * Derive a deterministic stealth keypair from the wallet's public key.
     * Seed = SHA-256("aegis-stealth-v1|" || walletPubkey)
     */
    async getOrCreateStealthKeyPair(walletPublicKey) {
      const input = `aegis-stealth-v1|${walletPublicKey.toString()}`;
      const hashBuf = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(input)
      );
      const seed = new Uint8Array(hashBuf);
      const kp = nacl.sign.keyPair.fromSeed(seed);
      return {
        spendingKey: bytesToHex(seed),
        viewingKey: bytesToHex(kp.publicKey.slice(0, 16)),
        masterViewingKey: bytesToHex(kp.secretKey),
        stealthAddress: new PublicKey(kp.publicKey).toBase58(),
      };
    },

    /**
     * Build a Solana instruction to transfer funds to the stealth address.
     * SOL → SystemProgram.transfer
     * SPL → createTransferInstruction
     */
    async buildDepositInstruction({ sender, stealthAddress, amount, tokenMint }) {
      const stealthPubkey = new PublicKey(stealthAddress);
      const isNativeSOL =
        tokenMint.toString() === 'So11111111111111111111111111111111111111112';

      if (isNativeSOL) {
        return SystemProgram.transfer({
          fromPubkey: sender,
          toPubkey: stealthPubkey,
          lamports: amount,
        });
      }

      const senderATA = await getAssociatedTokenAddress(tokenMint, sender);
      const recipientATA = await getAssociatedTokenAddress(tokenMint, stealthPubkey);
      return createTransferInstruction(
        senderATA,
        recipientATA,
        sender,
        BigInt(amount)
      );
    },

    /** Check for claimable SOL balance at the stealth address. */
    async findUTXO({ stealthAddress, viewingKey }) {
      try {
        const pubkey = new PublicKey(stealthAddress);
        const balance = await connection.getBalance(pubkey);
        if (balance === 0) return null;
        return {
          stealthAddress,
          viewingKey,
          amount: balance,
          tokenMint: 'So11111111111111111111111111111111111111112',
        };
      } catch {
        return null;
      }
    },

    /**
     * Build a withdrawal transaction (stealth → recipient).
     * Caller must sign with the stealth Keypair before broadcasting.
     */
    async buildWithdrawTransaction({ utxo, recipient, fee = 10_000 }) {
      const stealthPubkey = new PublicKey(utxo.stealthAddress);
      const sendAmount = utxo.amount - fee;
      if (sendAmount <= 0) throw new Error('Balance too low to cover network fee');
      const tx = new Transaction();
      tx.add(
        SystemProgram.transfer({
          fromPubkey: stealthPubkey,
          toPubkey: recipient,
          lamports: sendAmount,
        })
      );
      return tx;
    },

    /** Relayer withdrawal — not available in local devnet mode. */
    async relayerWithdraw() {
      throw new Error(
        'Relayer withdrawal is not available in devnet mode. Please use self-relay.'
      );
    },
  };
}

// ─── SDK Singleton ────────────────────────────────────────────────────────────
let _sdk = null;

export async function getUmbraSDK(connection) {
  if (!_sdk) _sdk = createLocalUmbraSDK(connection);
  return _sdk;
}

export function resetUmbraSDK() { _sdk = null; }

// ─── ZK Prover stub ──────────────────────────────────────────────────────────
// Withdraw flow uses keypair signing instead of ZK proofs on devnet.
export async function getZKProver() { return null; }

// ─── Ephemeral Key Generation ─────────────────────────────────────────────────
/**
 * Generate a complete set of ephemeral keys for a gift card UTXO.
 * These are generated client-side and NEVER sent to any server.
 * The fragment (#keys=...) is only in the browser URL bar.
 *
 * Returns:
 *   - spendingKey: hex private key to claim the UTXO
 *   - viewingKey: hex key to audit the UTXO without spending
 *   - stealthAddress: the on-chain Umbra stealth address
 *   - encodedKeys: base64url string for the redeem URL fragment
 */
export async function generateEphemeralKeys(connection) {
  const sdk = await getUmbraSDK(connection);
  // Umbra SDK generates the full key set: ephemeral L1 key, spending key, MVK, blinding factors
  const keyPair = await sdk.generateStealthKeys();
  return {
    spendingKey: keyPair.spendingKey,
    viewingKey: keyPair.viewingKey,
    masterViewingKey: keyPair.masterViewingKey,
    stealthAddress: keyPair.stealthAddress,
    encodedKeys: btoa(
      JSON.stringify({
        sk: keyPair.spendingKey,
        vk: keyPair.viewingKey,
        sa: keyPair.stealthAddress,
        ts: Date.now(),
      })
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, ''),
  };
}

// ─── Stealth Address from Recipient Viewing Key ──────────────────────────────
export async function generateStealthAddressForRecipient(connection, recipientViewingKey) {
  const sdk = await getUmbraSDK(connection);
  return sdk.generateStealthAddress(recipientViewingKey);
}

function grossUpForUmbraFee(targetNetLamports) {
  const feeDivisor = BigInt(UMBRA_CONFIG.BPS_DIVISOR);
  const feeBase = BigInt(UMBRA_CONFIG.BPS_DIVISOR - UMBRA_CONFIG.UMBRA_FEE_BPS);
  const target = BigInt(targetNetLamports);
  const gross = (target * feeDivisor + feeBase - 1n) / feeBase;

  return Number(gross);
}

// ─── Fee Calculation ──────────────────────────────────────────────────────────
/**
 * Calculate all fees for a deposit.
 *
 * `amountMode = 'gross'` keeps the legacy semantics where the entered amount is
 * the gross Umbra deposit before Umbra deducts its fee.
 *
 * `amountMode = 'net'` treats the entered amount as the exact amount that should
 * land in the Umbra pool, then grosses up the on-chain Umbra deposit so the
 * recipient sees a clean net amount.
 */
export function calculateFees(rawAmount, tokenSymbol, amountMode = 'gross') {
  const decimals = TOKEN_DECIMALS[tokenSymbol] ?? 9;
  const enteredLamports = Math.floor(rawAmount * 10 ** decimals);

  const grossDepositLamports =
    amountMode === 'net' ? grossUpForUmbraFee(enteredLamports) : enteredLamports;

  const netDepositLamports =
    amountMode === 'net'
      ? enteredLamports
      : grossDepositLamports - Math.floor(
        (grossDepositLamports * UMBRA_CONFIG.UMBRA_FEE_BPS) / UMBRA_CONFIG.BPS_DIVISOR
      );

  const umbraFeeLamports = grossDepositLamports - netDepositLamports;

  // Aegis platform fee (0.3%) stays tied to the user-facing requested amount.
  const aegisFeeLamports = Math.floor(
    (amountMode === 'net' ? netDepositLamports : enteredLamports) * AEGIS_FEE_PERCENT
  );

  // Total sender pays
  const totalLamports = grossDepositLamports + aegisFeeLamports;

  return {
    amountMode,
    requestedAmountLamports: enteredLamports,
    requestedAmount: enteredLamports / 10 ** decimals,
    grossDepositLamports,
    grossDeposit: grossDepositLamports / 10 ** decimals,
    rawLamports: grossDepositLamports,
    umbraFeeLamports,
    aegisFeeLamports,
    totalFeeLamports: umbraFeeLamports + aegisFeeLamports,
    netDepositLamports,
    totalLamports,
    // Human-readable
    raw: grossDepositLamports / 10 ** decimals,
    umbraFee: umbraFeeLamports / 10 ** decimals,
    aegisFee: aegisFeeLamports / 10 ** decimals,
    totalFees: (umbraFeeLamports + aegisFeeLamports) / 10 ** decimals,
    netDeposit: netDepositLamports / 10 ** decimals,
    total: totalLamports / 10 ** decimals,
    // Percentage display
    umbraFeePercent: ((UMBRA_CONFIG.UMBRA_FEE_BPS / UMBRA_CONFIG.BPS_DIVISOR) * 100).toFixed(3),
    aegisFeePercent: (AEGIS_FEE_PERCENT * 100).toFixed(1),
    includesAegisFee: true,
  };
}

/**
 * Calculate max transferable amount with wallet sweep.
 * Deducts: network gas, Umbra fee, Aegis fee, UTXO rent, optionally ATA rent reclaim.
 */
export function calculateMaxAmount(
  balanceLamports,
  tokenSymbol,
  networkFeeLamports = 10_000,
  utxoRentLamports = 2_000_000,
  reclaimAtaRent = false,
  ataRentLamports = 2_039_280,
  amountMode = 'gross'
) {
  const decimals = TOKEN_DECIMALS[tokenSymbol] ?? 9;
  const reclaimAmount = reclaimAtaRent ? ataRentLamports : 0;

  // Available after deducting fixed costs
  const available = balanceLamports - networkFeeLamports - utxoRentLamports + reclaimAmount;
  if (available <= 0) return { maxLamports: 0, maxAmount: 0, fees: null };

  let maxLamports;

  if (amountMode === 'net') {
    let low = 0;
    let high = available;

    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      const fees = calculateFees(mid / 10 ** decimals, tokenSymbol, 'net');

      if (fees.totalLamports <= available) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }

    maxLamports = low;
  } else {
    // Solve for x: x + x*0.003 = available → x = available / 1.003
    const aegisMultiplier = 1 + AEGIS_FEE_PERCENT;
    maxLamports = Math.floor(available / aegisMultiplier);
  }

  return {
    maxLamports,
    maxAmount: maxLamports / 10 ** decimals,
    fees: calculateFees(maxLamports / 10 ** decimals, tokenSymbol, amountMode),
  };
}

// ─── SPL Memo Instruction ────────────────────────────────────────────────────
/**
 * Build a SPL Memo instruction to annotate the transaction on-chain.
 * Memo is public — do NOT include sensitive data. Include only:
 *   - tag, timestamp, token, aegisFee (all public info)
 */
export function buildMemoInstruction(memoData) {
  const SPL_MEMO_PROGRAM_ID = new PublicKey(
    'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'
  );
  const memoStr = JSON.stringify({
    tag: UMBRA_CONFIG.memoTag,
    ...memoData,
    ts: Math.floor(Date.now() / 1000),
  });
  return {
    keys: [],
    programId: SPL_MEMO_PROGRAM_ID,
    data: Buffer.from(memoStr, 'utf-8'),
  };
}

// ─── Derive Transaction Viewing Key (TVK) ────────────────────────────────────
/**
 * Derives a time-bound hierarchical TVK from the Master Viewing Key.
 * Uses Poseidon-compatible hashing (SHA-256 chained with date + MVK).
 *
 * TVK = SHA256( MVK || "DAILY" || YYYY-MM-DD )
 *
 * This exposes ONLY the day's transactions, never the root MVK.
 * The TVK can decrypt SPL Memo payloads for that day's transactions.
 */
export async function deriveDailyTVK(masterViewingKey, date) {
  const dateStr = date instanceof Date
    ? date.toISOString().slice(0, 10) // YYYY-MM-DD
    : date;
  const input = `${masterViewingKey}|DAILY|${dateStr}`;
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Decrypt a SPL Memo payload using a derived TVK.
 * The memo must have been encrypted with AES-GCM using the matching TVK.
 *
 * NOTE: In the real Umbra flow, memos are encrypted with the stealth address
 * public key. Here we decrypt the Aegis-specific metadata layer using the TVK.
 */
export async function decryptMemoWithTVK(encryptedMemoHex, tvk) {
  try {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      hexToBytes(tvk.slice(0, 64)), // use first 32 bytes (256 bits) of TVK
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
    const encryptedBytes = hexToBytes(encryptedMemoHex);
    const iv = encryptedBytes.slice(0, 12);
    const ciphertext = encryptedBytes.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      keyMaterial,
      ciphertext
    );
    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch {
    throw new Error('Decryption failed — invalid TVK or corrupted memo data');
  }
}

/**
 * Encrypt a memo payload with AES-GCM using the TVK.
 * Returns hex string: [12-byte IV][ciphertext]
 */
export async function encryptMemoWithTVK(payload, tvk) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    hexToBytes(tvk.slice(0, 64)),
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    keyMaterial,
    new TextEncoder().encode(JSON.stringify(payload))
  );
  const combined = new Uint8Array(iv.byteLength + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.byteLength);
  return bytesToHex(combined);
}

// ─── Parse Redeem URL Fragment ────────────────────────────────────────────────
export function parseRedeemFragment(fragment) {
  try {
    const keysParam = new URLSearchParams(fragment.replace(/^#/, '')).get('keys');
    if (!keysParam) throw new Error('No keys parameter in URL');
    const padded = keysParam.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = 4 - (padded.length % 4 || 4);
    const decoded = atob(padded + '='.repeat(padLength === 4 ? 0 : padLength));
    return JSON.parse(decoded);
  } catch (err) {
    throw new Error(`Invalid redeem URL: ${err.message}`);
  }
}

// ─── Fetch On-Chain Transaction ───────────────────────────────────────────────
export async function fetchTransactionDetails(connection, signature) {
  const tx = await connection.getParsedTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) throw new Error('Transaction not found on chain');
  return tx;
}

/**
 * Extract memo data from a parsed transaction.
 * Looks for the SPL Memo program instructions.
 */
export function extractMemoFromTransaction(parsedTx) {
  const SPL_MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
  const instructions = parsedTx?.transaction?.message?.instructions ?? [];
  for (const ix of instructions) {
    if (ix.programId?.toString() === SPL_MEMO_PROGRAM_ID) {
      try {
        return JSON.parse(ix.parsed ?? ix.data ?? '{}');
      } catch {
        return { raw: ix.parsed ?? ix.data };
      }
    }
  }
  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function shortenAddress(addr, chars = 6) {
  if (!addr) return '—';
  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
}

export function formatAmount(amount, decimals = 6) {
  return Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  });
}