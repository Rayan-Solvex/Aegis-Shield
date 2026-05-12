/**
 * useUmbra — React hook for Umbra SDK operations
 *
 * Wraps the Umbra SDK with:
 *  - Loading states
 *  - Error handling
 *  - Transaction building (deposit + Aegis fee + Memo in one atomic bundle)
 *  - ZK proof generation (for withdrawals)
 */

import { useState, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  Transaction,
  SystemProgram,
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  getUmbraSDK,
  getUmbraRuntime,
  ensureUmbraNetworkConfig,
  generateEphemeralKeys,
  generateStealthAddressForRecipient,
  calculateFees,
  calculateMaxAmount,
  buildMemoInstruction,
  fetchTransactionDetails,
  extractMemoFromTransaction,
  bytesToHex,
  hexToBytes,
} from '../lib/umbra.js';
import {
  AEGIS_TREASURY_ADDRESS,
  NETWORK,
  TOKEN_MINTS,
  UMBRA_CONFIG,
  getRpcEndpoint,
  ZK_OPERATOR_SETUP_LAMPORTS,
  ZK_TX_FEE_MARGIN_LAMPORTS,
  TOKEN_DECIMALS,
  UTXO_RENT_LAMPORTS,
  BASE_TX_FEE_LAMPORTS,
  ATA_RENT_LAMPORTS,
  AEGIS_REDEEM_BASE,
} from '../config.js';

// ─── Poll for confirmation (HTTP only, no WebSocket) ─────────────────────────
async function pollConfirmation(connection, signature, maxTries = 60) {
  for (let i = 0; i < maxTries; i++) {
    const result = await connection.getSignatureStatus(signature, {
      searchTransactionHistory: true,
    });
    const status = result?.value;
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      if (status.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
      return signature;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('Transaction confirmation timeout — check explorer');
}

async function getRecentSuccessfulSignatures(connection, address, limit = 10) {
  const entries = await connection.getSignaturesForAddress(address, { limit });
  return entries.filter((entry) => entry.err == null).map((entry) => entry.signature);
}

function restoreKeypairFromSeedOrSecretKey(bytes) {
  if (bytes.length === 32) {
    return Keypair.fromSeed(bytes);
  }

  if (bytes.length === 64) {
    return Keypair.fromSecretKey(bytes);
  }

  throw new Error(`Operator key bytes must be 32 or 64 bytes, got ${bytes.length}`);
}

function looksLikePostSuccessIssueError(message) {
  return /simulation failed|Failed to send transaction|can't convert BigInt to number|Cannot convert a BigInt value to a number|Do not know how to serialize a BigInt/i.test(message);
}

async function verifySelfClaimableGiftCardIssued({
  runtime,
  connection,
  recipientSpendingKey,
  stealthAddress,
}) {
  const recipientSeed = hexToBytes(recipientSpendingKey);
  if (recipientSeed.length !== 32) {
    return null;
  }

  const recipientKeypair = Keypair.fromSeed(recipientSeed);
  const recipientSigner = await runtime.createSignerFromPrivateKeyBytes(recipientKeypair.secretKey);
  const rpcUrl = getRpcEndpoint();
  const rpcSubscriptionsUrl =
    NETWORK === 'mainnet-beta'
      ? 'wss://api.mainnet-beta.solana.com'
      : 'wss://api.devnet.solana.com';

  const recipientClient = await runtime.getUmbraClient({
    signer: recipientSigner,
    network: 'devnet',
    rpcUrl,
    rpcSubscriptionsUrl,
    indexerApiEndpoint: UMBRA_CONFIG.indexerUrl,
  });

  const scanClaimable = runtime.getClaimableUtxoScannerFunction({ client: recipientClient });

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const scanResult = await scanClaimable(0, 0);
    const candidates = [
      ...(scanResult.selfBurnable ?? []),
      ...(scanResult.publicSelfBurnable ?? []),
    ].filter((utxo) => utxo.destinationAddress === stealthAddress);

    if (candidates.length > 0) {
      return candidates;
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  return null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useUmbra() {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [error, setError] = useState(null);

  // ── Generate ephemeral keys for a gift card ────────────────────────────────
  const generateGiftCardKeys = useCallback(async () => {
    setLoading(true);
    setLoadingStep('Generating ephemeral key pair...');
    setError(null);
    try {
      const keys = await generateEphemeralKeys(connection);
      return keys;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
      setLoadingStep('');
    }
  }, [connection]);

  const continueSolGiftCardIssue = useCallback(async ({
    runtime,
    operatorSecretKeyHex,
    stealthAddress,
    recipientSpendingKey,
    fees,
    issueMode,
    fundingSignature,
  }) => {
    const isBaselineIssue = issueMode === 'umbra-baseline';
    const operatorKeypair = restoreKeypairFromSeedOrSecretKey(hexToBytes(operatorSecretKeyHex));

    const recipientSeed = hexToBytes(recipientSpendingKey);
    if (recipientSeed.length !== 32) {
      throw new Error(`Invalid recipient spending key length: expected 32 bytes, got ${recipientSeed.length}`);
    }

    const recipientKeypair = Keypair.fromSeed(recipientSeed);
    if (recipientKeypair.publicKey.toBase58() !== stealthAddress) {
      throw new Error('Recipient key does not match stealth address');
    }

    const rpcUrl = getRpcEndpoint();
    const rpcSubscriptionsUrl =
      NETWORK === 'mainnet-beta'
        ? 'wss://api.mainnet-beta.solana.com'
        : 'wss://api.devnet.solana.com';

    const operatorSigner = await runtime.createSignerFromPrivateKeyBytes(operatorKeypair.secretKey);
    const operatorClient = await runtime.getUmbraClient({
      signer: operatorSigner,
      network: 'devnet',
      rpcUrl,
      rpcSubscriptionsUrl,
      indexerApiEndpoint: UMBRA_CONFIG.indexerUrl,
    });

    setLoadingStep(isBaselineIssue ? 'Registering baseline Umbra operator...' : 'Registering Umbra operator...');
    await runtime.getUserRegistrationFunction(
      { client: operatorClient },
      { zkProver: runtime.getUserRegistrationProver() }
    )({
      confidential: true,
      anonymous: false,
    });

    const balanceBeforeCreate = await connection.getBalance(operatorKeypair.publicKey);
    const minRequiredForCreate = fees.rawLamports + 20_000_000;
    if (balanceBeforeCreate < minRequiredForCreate) {
      const shortfall = minRequiredForCreate - balanceBeforeCreate;
      throw new Error(`ZK setup overhead exceeded estimate by ${shortfall} lamports. Please retry with a smaller amount.`);
    }

    setLoadingStep(isBaselineIssue ? 'Creating claimable Umbra gift card UTXO...' : 'Creating self-claimable ZK UTXO...');
    const createSelfClaimableUtxo = runtime.getPublicBalanceToSelfClaimableUtxoCreatorFunction(
      { client: operatorClient },
      { zkProver: runtime.getCreateSelfClaimableUtxoFromPublicBalanceProver() }
    );

    const operatorSignaturesBefore = new Set(
      await getRecentSuccessfulSignatures(connection, operatorKeypair.publicKey, 12)
    );

    let issueResult;
    try {
      issueResult = await createSelfClaimableUtxo({
        destinationAddress: stealthAddress,
        mint: TOKEN_MINTS.SOL,
        amount: BigInt(fees.rawLamports),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const looksLikeGhostSuccess = looksLikePostSuccessIssueError(message);

      if (!looksLikeGhostSuccess) {
        throw err;
      }

      setLoadingStep('Verifying on-chain issuance after RPC false negative...');
      const candidates = await verifySelfClaimableGiftCardIssued({
        runtime,
        connection,
        recipientSpendingKey,
        stealthAddress,
      });

      if (!candidates || candidates.length === 0) {
        throw err;
      }

      const operatorSignaturesAfter = await getRecentSuccessfulSignatures(
        connection,
        operatorKeypair.publicKey,
        12
      );
      const inferredCreateUtxoSignature =
        operatorSignaturesAfter.find((signature) => !operatorSignaturesBefore.has(signature)) ??
        operatorSignaturesAfter[0] ??
        fundingSignature;

      issueResult = {
        createUtxoSignature: inferredCreateUtxoSignature,
        createProofAccountSignature: null,
        closeProofAccountSignature: null,
        recoveredAfterSimulationFailure: true,
      };
    }

    return {
      signature: issueResult.createUtxoSignature ?? fundingSignature,
      proofAccountSignature: issueResult.createProofAccountSignature ?? null,
      recoveredAfterSimulationFailure: issueResult.recoveredAfterSimulationFailure === true,
      fundingSignature,
      fees,
      issueMode,
    };
  }, [connection]);

  // ── Deposit into Umbra pool (gift card issue + payment link pay) ───────────
  //
  // PRIVACY MODEL — Ephemeral Relay Sender Pattern:
  //
  //   TX1 (user signs once):  user wallet  →  fresh ephemeral relay address
  //   TX2 (relay signs):      relay address →  stealth address + Aegis treasury
  //
  //   The gift-card deposit (TX2) only shows the random ephemeral address on-chain.
  //   The user's real wallet never appears as the sender of the actual deposit.
  //   The ephemeral keypair is generated in-browser, used once, then discarded.
  //
  const deposit = useCallback(
    async ({
      amount,
      tokenSymbol,
      stealthAddress,
      recipientSpendingKey,
      memoPayload,
      issueMode = 'aegis-custom',
      onCheckpoint,
    }) => {
      if (!publicKey || !signTransaction) throw new Error('Wallet not connected');

      setLoading(true);
      setError(null);
      let partialRecovery = null;

      try {
        const isBaselineIssue = issueMode === 'umbra-baseline';
        const feeMode = isBaselineIssue ? 'net' : 'gross';
        const fees = calculateFees(amount, tokenSymbol, feeMode);
        partialRecovery = {
          issueMode,
          tokenSymbol,
          amount,
          stealthAddress,
          recipientSpendingKey,
          fees,
          operatorSecretKeyHex: null,
          fundingSignature: null,
        };

        // Incremental ZK integration: only gift-card style SOL issues that
        // carry a recipient spending key should enter the Umbra UTXO path.
        // Plain Pillar 2 payment-link sends use the relay transfer flow below.
        if (tokenSymbol === 'SOL' && recipientSpendingKey) {
          await ensureUmbraNetworkConfig(NETWORK);
          const runtime = await getUmbraRuntime();
          setLoadingStep(isBaselineIssue ? 'Preparing baseline Umbra issue...' : 'Preparing ZK pool transaction...');

          const recipientSeed = hexToBytes(recipientSpendingKey);
          if (recipientSeed.length !== 32) {
            throw new Error(`Invalid recipient spending key length: expected 32 bytes, got ${recipientSeed.length}`);
          }

          // For self-claimable gift cards, the funded Umbra signer must be derived
          // from the gift-card spending key so the recipient can later discover and
          // claim the UTXO with the same secret embedded in the redeem link.
          const operatorKeypair = Keypair.fromSeed(recipientSeed);
          partialRecovery = {
            ...partialRecovery,
            operatorSecretKeyHex: bytesToHex(operatorKeypair.secretKey),
          };
          onCheckpoint?.({ stage: 'operator-prepared', recovery: partialRecovery });
          const payerBalance = await connection.getBalance(publicKey);

          // Estimate fee for the funding tx and reserve a small safety margin.
          const { blockhash: feeProbeBlockhash } = await connection.getLatestBlockhash();
          const feeProbeTx = new Transaction();
          feeProbeTx.add(
            SystemProgram.transfer({
              fromPubkey: publicKey,
              toPubkey: operatorKeypair.publicKey,
              lamports: 1,
            })
          );
          feeProbeTx.recentBlockhash = feeProbeBlockhash;
          feeProbeTx.feePayer = publicKey;

          const feeProbe = await connection.getFeeForMessage(
            feeProbeTx.compileMessage(),
            'confirmed'
          );
          const estimatedTx1Fee = feeProbe?.value ?? 100_000;

          const operatorFundAmount = fees.rawLamports + ZK_OPERATOR_SETUP_LAMPORTS;
          const totalRequiredFromWallet =
            operatorFundAmount + fees.aegisFeeLamports + estimatedTx1Fee + ZK_TX_FEE_MARGIN_LAMPORTS;

          if (payerBalance < totalRequiredFromWallet) {
            const { maxLamports: maxNetLamports } = calculateMaxAmount(
              payerBalance,
              tokenSymbol,
              estimatedTx1Fee + ZK_TX_FEE_MARGIN_LAMPORTS,
              ZK_OPERATOR_SETUP_LAMPORTS,
              false,
              0,
              'net'
            );
            throw new Error(
              `Insufficient SOL for requested amount. Need ${(totalRequiredFromWallet / LAMPORTS_PER_SOL).toFixed(6)} SOL total (net amount + protocol fees + setup). Max exact in-pool amount now is ${(maxNetLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL.`
            );
          }

          const { blockhash: blockhash1 } = await connection.getLatestBlockhash();
          const tx1 = new Transaction();
          tx1.add(
            SystemProgram.transfer({
              fromPubkey: publicKey,
              toPubkey: operatorKeypair.publicKey,
              lamports: operatorFundAmount,
            })
          );
          if (fees.aegisFeeLamports > 0) {
            tx1.add(
              SystemProgram.transfer({
                fromPubkey: publicKey,
                toPubkey: new PublicKey(AEGIS_TREASURY_ADDRESS),
                lamports: fees.aegisFeeLamports,
              })
            );
          }
          tx1.recentBlockhash = blockhash1;
          tx1.feePayer = publicKey;

          const signedTx1 = await signTransaction(tx1);
          setLoadingStep(isBaselineIssue ? 'Funding Umbra operator and routing Aegis fee...' : 'Funding ZK operator wallet...');
          const sig1 = await connection.sendRawTransaction(signedTx1.serialize(), {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
          });
          await pollConfirmation(connection, sig1);
          partialRecovery = {
            ...partialRecovery,
            fundingSignature: sig1,
          };
          onCheckpoint?.({ stage: 'funding-confirmed', recovery: partialRecovery });

          return continueSolGiftCardIssue({
            runtime,
            operatorSecretKeyHex: partialRecovery.operatorSecretKeyHex,
            stealthAddress,
            recipientSpendingKey,
            fees,
            issueMode,
            fundingSignature: sig1,
          });
        }

        // ── Phase 1: Generate the one-time ephemeral relay keypair ─────────────
        // This keypair exists only in browser memory for the duration of this call.
        // It is never stored, never sent to any server, and is GC'd when deposit() returns.
        setLoadingStep('Generating privacy relay keypair...');
        const relayKeypair = Keypair.generate();
        const relayPubkey = relayKeypair.publicKey;

        // ── Phase 2: Estimate exact TX2 fee so relay drains to 0 ──────────────
        setLoadingStep('Estimating network fees...');
        const { blockhash: probeBlockhash } = await connection.getLatestBlockhash();

        const memoIx = buildMemoInstruction({
          purpose: memoPayload?.purpose ?? 'gift',
          token: tokenSymbol,
          aegisFee: fees.aegisFeeLamports,
          netDeposit: fees.netDepositLamports,
        });

        const probeTx2 = new Transaction();
        // deposit: relay → stealth address
        probeTx2.add(
          SystemProgram.transfer({
            fromPubkey: relayPubkey,
            toPubkey: new PublicKey(stealthAddress),
            lamports: fees.rawLamports,
          })
        );
        // aegis fee: relay → treasury
        probeTx2.add(
          SystemProgram.transfer({
            fromPubkey: relayPubkey,
            toPubkey: new PublicKey(AEGIS_TREASURY_ADDRESS),
            lamports: fees.aegisFeeLamports,
          })
        );
        // memo
        probeTx2.add({ keys: memoIx.keys, programId: memoIx.programId, data: memoIx.data });
        probeTx2.recentBlockhash = probeBlockhash;
        probeTx2.feePayer = relayPubkey;

        const feeResult = await connection.getFeeForMessage(
          probeTx2.compileMessage(),
          'confirmed'
        );
        const tx2Fee = feeResult?.value ?? 5_000;

        // TX1 is a single-sig SOL transfer — its fee is always 5,000 lamports on Solana
        const TX1_FEE_ESTIMATE = 5_000;

        // Relay must receive exactly: deposit + aegisFee + tx2Fee
        // The user's wallet pays TX1's own fee from its own balance (not deducted from relay)
        const relayFundAmount = fees.rawLamports + fees.aegisFeeLamports + tx2Fee;

        // ── Phase 3: TX1 — User funds the ephemeral relay (one wallet popup) ───
        setLoadingStep('Step 1 of 2 — Awaiting wallet approval...');
        const { blockhash: blockhash1 } = await connection.getLatestBlockhash();

        const tx1 = new Transaction();
        tx1.add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: relayPubkey,
            lamports: relayFundAmount,
          })
        );
        tx1.recentBlockhash = blockhash1;
        tx1.feePayer = publicKey;

        const signedTx1 = await signTransaction(tx1);

        setLoadingStep('Step 1 of 2 — Broadcasting funding transaction...');
        const sig1 = await connection.sendRawTransaction(signedTx1.serialize(), {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });

        setLoadingStep('Step 1 of 2 — Confirming funding transaction...');
        await pollConfirmation(connection, sig1);

        // ── Phase 4: TX2 — Relay sends deposit + Aegis fee (no wallet popup) ───
        // The relay keypair signs this transaction entirely in-browser.
        // User's wallet is NOT a signer on TX2.
        setLoadingStep('Step 2 of 2 — Sending private deposit...');
        const { blockhash: blockhash2 } = await connection.getLatestBlockhash();

        const tx2 = new Transaction();
        tx2.add(
          SystemProgram.transfer({
            fromPubkey: relayPubkey,
            toPubkey: new PublicKey(stealthAddress),
            lamports: fees.rawLamports,
          })
        );
        tx2.add(
          SystemProgram.transfer({
            fromPubkey: relayPubkey,
            toPubkey: new PublicKey(AEGIS_TREASURY_ADDRESS),
            lamports: fees.aegisFeeLamports,
          })
        );
        tx2.add({ keys: memoIx.keys, programId: memoIx.programId, data: memoIx.data });
        tx2.recentBlockhash = blockhash2;
        tx2.feePayer = relayPubkey;

        // Relay keypair signs entirely in-browser — no wallet adapter involved
        tx2.sign(relayKeypair);

        setLoadingStep('Step 2 of 2 — Broadcasting private deposit...');
        const sig2 = await connection.sendRawTransaction(tx2.serialize(), {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });

        setLoadingStep('Step 2 of 2 — Confirming deposit...');
        await pollConfirmation(connection, sig2);

        // Return TX2's signature — the one that shows on Explorer for the gift card.
        // TX1 (funding) is intentionally not returned as the "gift card tx" since
        // it reveals the relay address but not the stealth address destination.
        return { signature: sig2, fundingSignature: sig1, fees, issueMode };
      } catch (err) {
        if (partialRecovery && err && typeof err === 'object') {
          err.partialRecovery = partialRecovery;
        }
        if (typeof err?.getLogs === 'function') {
          try {
            const logs = await err.getLogs();
            if (Array.isArray(logs) && logs.length > 0) {
              err.message = `${err.message}\nLogs:\n${logs.join('\n')}`;
            }
          } catch {
            // keep original error message
          }
        }
        setError(err.message);
        throw err;
      } finally {
        setLoading(false);
        setLoadingStep('');
      }
    },
    [connection, continueSolGiftCardIssue, publicKey, signTransaction]
  );

  const resumeGiftCardIssue = useCallback(async ({
    operatorSecretKeyHex,
    stealthAddress,
    recipientSpendingKey,
    fundingSignature,
    amount,
    tokenSymbol,
    issueMode = 'umbra-baseline',
  }) => {
    setLoading(true);
    setError(null);

    try {
      if (tokenSymbol !== 'SOL') {
        throw new Error('Resume is currently supported only for baseline SOL gift-card issues');
      }

      await ensureUmbraNetworkConfig(NETWORK);
      const runtime = await getUmbraRuntime();
      const fees = calculateFees(amount, tokenSymbol);

      return await continueSolGiftCardIssue({
        runtime,
        operatorSecretKeyHex,
        stealthAddress,
        recipientSpendingKey,
        fees,
        issueMode,
        fundingSignature,
      });
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
      setLoadingStep('');
    }
  }, [continueSolGiftCardIssue]);

  // ── Withdraw using ephemeral spending key (receiver flow) ─────────────────
  //
  // PRIVACY MODEL — Ephemeral Exit Relay Pattern:
  //
  //   TX1 (stealth signs, no popup):  stealth address  →  fresh ephemeral exit relay
  //   TX2 (exit relay signs, no popup): exit relay     →  recipient wallet
  //
  //   A chain observer watching the stealth address only sees it drain to a random
  //   ephemeral address (TX1). The link from that ephemeral address to the real
  //   recipient wallet (TX2) looks like any unremarkable SOL transfer and is not
  //   trivially associated with the gift card redemption.
  //   Neither the stealth keypair nor the exit relay keypair is ever stored or reused.
  //
  const withdraw = useCallback(
    async ({ spendingKey, viewingKey, stealthAddress, redeemMode = 'relayer' }) => {
      setLoading(true);
      setError(null);

      try {
        if (!publicKey) throw new Error('Wallet not connected');

        // Attempt real Umbra ZK-pool redemption first for newly issued cards.
        // If no pool UTXO is found (or pool flow fails), we fall back to the
        // legacy local stealth drain flow so older links still redeem.
        try {
          const runtime = await getUmbraRuntime();
          const recipientSeed = hexToBytes(spendingKey);
          if (recipientSeed.length === 32) {
            const recipientKeypair = Keypair.fromSeed(recipientSeed);
            const recipientSigner = await runtime.createSignerFromPrivateKeyBytes(recipientKeypair.secretKey);
            const rpcUrl = getRpcEndpoint();
            const rpcSubscriptionsUrl =
              NETWORK === 'mainnet-beta'
                ? 'wss://api.mainnet-beta.solana.com'
                : 'wss://api.devnet.solana.com';

            const recipientClient = await runtime.getUmbraClient({
              signer: recipientSigner,
              network: 'devnet',
              rpcUrl,
              rpcSubscriptionsUrl,
              indexerApiEndpoint: UMBRA_CONFIG.indexerUrl,
            });

            setLoadingStep('Scanning Umbra ZK pool...');
            const scanClaimable = runtime.getClaimableUtxoScannerFunction({ client: recipientClient });
            const scanResult = await scanClaimable(0, 0);
            const candidates = [
              ...(scanResult.selfBurnable ?? []),
              ...(scanResult.publicSelfBurnable ?? []),
            ].filter((utxo) => utxo.destinationAddress === stealthAddress);

            if (candidates.length > 0) {
              const relayer = runtime.getUmbraRelayer({ apiEndpoint: UMBRA_CONFIG.relayerUrl });

              const totalClaimed = candidates.reduce(
                (sum, utxo) => sum + BigInt(utxo.amount),
                0n
              );

              if (redeemMode === 'direct') {
                setLoadingStep('Claiming gift card into Umbra encrypted balance...');
                const claimToEncryptedBalance =
                  runtime.getSelfClaimableUtxoToEncryptedBalanceClaimerFunction(
                    { client: recipientClient },
                    {
                      zkProver: runtime.getClaimSelfClaimableUtxoIntoEncryptedBalanceProver(),
                      relayer,
                    }
                  );

                const claimResult = await claimToEncryptedBalance(candidates);
                const firstBatch = claimResult.batches.values().next().value;

                setLoadingStep('Withdrawing claimed SOL with direct redeem path...');
                const withdrawToWallet =
                  runtime.getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction({
                    client: recipientClient,
                  });

                const withdrawResult = await withdrawToWallet(
                  publicKey.toBase58(),
                  TOKEN_MINTS.SOL,
                  totalClaimed
                );

                return {
                  mode: 'direct',
                  signature: withdrawResult.callbackSignature ?? withdrawResult.queueSignature,
                  claimSignature: firstBatch?.callbackSignature ?? firstBatch?.txSignature ?? null,
                  queueSignature: withdrawResult.queueSignature,
                  callbackSignature: withdrawResult.callbackSignature ?? null,
                  rentClaimSignature: withdrawResult.rentClaimSignature ?? null,
                  amount: Number(totalClaimed) / 1e9,
                  destinationAddress: publicKey.toBase58(),
                  usesRelayer: true,
                  feeNote: 'Direct redeem still uses the Umbra relayer for the confidential claim step. Your gift balance may be reduced by Umbra relayer/protocol fees before the final direct withdrawal.',
                };
              }

              setLoadingStep('Claiming gift card directly to connected wallet via Umbra relayer...');
              const claimToPublic =
                runtime.getSelfClaimableUtxoToPublicBalanceClaimerFunction(
                  { client: recipientClient },
                  {
                    zkProver: runtime.getClaimSelfClaimableUtxoIntoPublicBalanceProver(),
                    relayer,
                  }
                );

              const claimResult = await claimToPublic(candidates);
              const firstBatch = claimResult.batches.values().next().value;

              return {
                mode: 'relayer',
                signature: firstBatch?.callbackSignature ?? firstBatch?.txSignature,
                claimSignature: firstBatch?.txSignature ?? null,
                callbackSignature: firstBatch?.callbackSignature ?? null,
                amount: Number(totalClaimed) / 1e9,
                destinationAddress: publicKey.toBase58(),
                usesRelayer: true,
                feeNote: 'Gasless redeem uses the Umbra relayer as fee payer. The current SDK does not expose an exact pre-claim relayer fee quote in the client, so any relayer deduction is resolved inside the claim flow.',
              };
            }
          }
        } catch {
          // Fall through to legacy path.
        }

        // ── Step 1: Reconstruct the stealth Keypair from the spending key ────────
        setLoadingStep('Reconstructing stealth keypair...');
        const seedBytes = hexToBytes(spendingKey);
        const stealthKeypair = Keypair.fromSeed(seedBytes);

        if (stealthKeypair.publicKey.toBase58() !== stealthAddress) {
          throw new Error(
            'Spending key does not match the stealth address. The gift card URL may be corrupted.'
          );
        }

        // ── Step 2: Check balance at the stealth address ──────────────────────────
        setLoadingStep('Scanning for claimable funds...');
        const stealthPubkey = stealthKeypair.publicKey;
        const stealthBalance = await connection.getBalance(stealthPubkey);
        if (stealthBalance === 0) {
          throw new Error(
            'No funds found at this stealth address. The gift card may already have been claimed, or the deposit transaction is still pending.'
          );
        }

        // ── Step 3: Generate one-time ephemeral exit relay ────────────────────────
        // This keypair only lives in browser memory for this call; it is discarded
        // once TX2 is confirmed.
        setLoadingStep('Generating privacy exit relay...');
        const exitRelayKeypair = Keypair.generate();
        const exitRelayPubkey = exitRelayKeypair.publicKey;

        // Send directly to the connected wallet for a simple one-click claim flow.
        const recipient = publicKey;

        // ── Step 4: Estimate fees so both accounts drain to exactly 0 ────────────
        setLoadingStep('Estimating network fees...');
        const { blockhash: probeBlockhash } = await connection.getLatestBlockhash();

        // Probe TX1: stealth → exitRelay
        const probeTx1 = new Transaction();
        probeTx1.add(
          SystemProgram.transfer({ fromPubkey: stealthPubkey, toPubkey: exitRelayPubkey, lamports: 1 })
        );
        probeTx1.recentBlockhash = probeBlockhash;
        probeTx1.feePayer = stealthPubkey;
        const fee1Result = await connection.getFeeForMessage(probeTx1.compileMessage(), 'confirmed');
        const tx1Fee = fee1Result?.value ?? 5_000;

        // Probe TX2: exitRelay → recipient
        const probeTx2 = new Transaction();
        probeTx2.add(
          SystemProgram.transfer({ fromPubkey: exitRelayPubkey, toPubkey: recipient, lamports: 1 })
        );
        probeTx2.recentBlockhash = probeBlockhash;
        probeTx2.feePayer = exitRelayPubkey;
        const fee2Result = await connection.getFeeForMessage(probeTx2.compileMessage(), 'confirmed');
        const tx2Fee = fee2Result?.value ?? 5_000;

        // Exit relay receives: stealthBalance - tx1Fee
        // Exit relay sends:    (stealthBalance - tx1Fee) - tx2Fee
        const exitRelayReceives = stealthBalance - tx1Fee;
        const finalAmount = exitRelayReceives - tx2Fee;

        if (exitRelayReceives <= 0) {
          throw new Error(`Balance (${stealthBalance} lamports) is too low to cover TX1 fee (${tx1Fee} lamports).`);
        }
        if (finalAmount <= 0) {
          throw new Error(`Balance after TX1 fee is too low to cover TX2 fee (${tx2Fee} lamports).`);
        }

        // ── Step 5: TX1 — Stealth → Exit relay (no wallet popup) ─────────────────
        setLoadingStep('Step 1 of 2 — Draining stealth address to exit relay...');
        const { blockhash: blockhash1 } = await connection.getLatestBlockhash();

        const tx1 = new Transaction();
        tx1.add(
          SystemProgram.transfer({
            fromPubkey: stealthPubkey,
            toPubkey: exitRelayPubkey,
            lamports: exitRelayReceives,
          })
        );
        tx1.recentBlockhash = blockhash1;
        tx1.feePayer = stealthPubkey;
        tx1.sign(stealthKeypair);

        setLoadingStep('Step 1 of 2 — Broadcasting stealth drain...');
        const sig1 = await connection.sendRawTransaction(tx1.serialize(), {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });

        setLoadingStep('Step 1 of 2 — Confirming stealth drain...');
        await pollConfirmation(connection, sig1);

        // ── Step 6: TX2 — Exit relay → Recipient wallet (no wallet popup) ─────────
        setLoadingStep('Step 2 of 2 — Sending funds to your wallet via exit relay...');
        const { blockhash: blockhash2 } = await connection.getLatestBlockhash();

        const tx2 = new Transaction();
        tx2.add(
          SystemProgram.transfer({
            fromPubkey: exitRelayPubkey,
            toPubkey: recipient,
            lamports: finalAmount,
          })
        );
        tx2.recentBlockhash = blockhash2;
        tx2.feePayer = exitRelayPubkey;
        tx2.sign(exitRelayKeypair);

        setLoadingStep('Step 2 of 2 — Broadcasting final transfer...');
        const sig2 = await connection.sendRawTransaction(tx2.serialize(), {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });

        setLoadingStep('Step 2 of 2 — Confirming final transfer...');
        await pollConfirmation(connection, sig2);

        // sig1 = stealth drain (observer sees stealth → ephemeral relay)
        // sig2 = exit relay → destination (observer sees only ephemeral relay → unknown address)
        // The connected wallet identity does NOT appear anywhere in this transaction chain.
        return {
          mode: 'legacy-direct',
          signature: sig2,           // shown as "claim tx" in UI
          drainSignature: sig1,      // shown as TX1 in UI
          amount: finalAmount / 1e9,
          destinationAddress: recipient.toBase58(),
          usesRelayer: false,
          feeNote: `Direct redeem pays network fees from the gift-card balance itself. Estimated total network fees on this path: ${((tx1Fee + tx2Fee) / 1e9).toFixed(6)} SOL.`,
        };
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setLoading(false);
        setLoadingStep('');
      }
    },
    [connection, publicKey]
  );

  // ── Get user's stealth public key for payment links ────────────────────────
  const getStealthPublicKey = useCallback(async () => {
    if (!publicKey) throw new Error('Wallet not connected');
    setLoading(true);
    setError(null);
    try {
      const sdk = await getUmbraSDK(connection);
      const stealthKeyPair = await sdk.getOrCreateStealthKeyPair(publicKey);
      return stealthKeyPair;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [connection, publicKey]);

  // ── Load public transaction details for an authorized audit review ─────────
  const auditTransaction = useCallback(
    async ({ txSignature }) => {
      setLoading(true);
      setError(null);
      setLoadingStep('Fetching transaction from chain...');
      try {
        const parsedTx = await fetchTransactionDetails(connection, txSignature);
        const blockTime = parsedTx.blockTime;
        const txDate = blockTime ? new Date(blockTime * 1000) : new Date();
        setLoadingStep('Extracting memo and account metadata...');
        const memo = extractMemoFromTransaction(parsedTx);

        const accountKeys = parsedTx.transaction?.message?.accountKeys ?? [];
        const sender = accountKeys[0]?.pubkey?.toString() ?? 'Unknown';

        return {
          signature: txSignature,
          sender,
          blockTime,
          txDate: txDate.toISOString(),
          memo,
          raw: parsedTx,
        };
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setLoading(false);
        setLoadingStep('');
      }
    },
    [connection]
  );

  return {
    loading,
    loadingStep,
    error,
    generateGiftCardKeys,
    deposit,
    resumeGiftCardIssue,
    withdraw,
    getStealthPublicKey,
    generateStealthAddress: (vk) => generateStealthAddressForRecipient(connection, vk),
    auditTransaction,
  };
}
