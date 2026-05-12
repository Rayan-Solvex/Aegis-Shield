import { useState, useEffect, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_MINTS, TOKEN_DECIMALS } from '../config.js';

export function useSolanaBalance() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [balances, setBalances] = useState({
    SOL: 0,
    WSOL: 0,
    USDC: 0,
    USDT: 0,
  });
  const [loading, setLoading] = useState(false);

  const fetchBalances = useCallback(async () => {
    if (!publicKey) {
      setBalances({ SOL: 0, WSOL: 0, USDC: 0, USDT: 0 });
      return;
    }
    setLoading(true);
    try {
      // SOL balance — getBalance returns { context, value }
      const solResult = await connection.getBalance(publicKey);
      // @solana/web3.js connection.getBalance() unwraps .value for us
      const solBalance = (solResult ?? 0) / LAMPORTS_PER_SOL;

      const tokenBalances = {};
      for (const [symbol, mintAddr] of Object.entries(TOKEN_MINTS)) {
        if (symbol === 'SOL') continue;
        try {
          const mint = new PublicKey(mintAddr);
          const ata = await getAssociatedTokenAddress(mint, publicKey);
          const accountInfo = await connection.getTokenAccountBalance(ata);
          // getTokenAccountBalance returns { context, value }
          const uiAmount = accountInfo?.value?.uiAmount ?? 0;
          tokenBalances[symbol] = uiAmount;
        } catch {
          tokenBalances[symbol] = 0;
        }
      }

      setBalances({
        SOL: solBalance,
        WSOL: tokenBalances.WSOL ?? 0,
        USDC: tokenBalances.USDC ?? 0,
        USDT: tokenBalances.USDT ?? 0,
      });
    } catch (err) {
      console.error('Balance fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [connection, publicKey]);

  useEffect(() => {
    fetchBalances();
    // Poll every 30 seconds
    const interval = setInterval(fetchBalances, 30_000);
    return () => clearInterval(interval);
  }, [fetchBalances]);

  return { balances, loading, refetch: fetchBalances };
}
