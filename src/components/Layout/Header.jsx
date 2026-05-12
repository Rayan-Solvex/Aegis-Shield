import React from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useWallet } from '@solana/wallet-adapter-react';
import { Shield, Activity, Wifi } from 'lucide-react';
import { useSolanaBalance } from '../../hooks/useSolanaBalance.js';
import { shortenAddress } from '../../lib/umbra.js';
import { NETWORK } from '../../config.js';

export function Header({ sidebarWidth = 256 }) {
  const { publicKey, connected } = useWallet();
  const { balances } = useSolanaBalance();

  return (
    <header
      className="fixed top-0 right-0 z-50 flex items-center justify-between px-6 h-16 border-b border-aegis-border/50 backdrop-blur-xl"
      style={{ left: sidebarWidth, backgroundColor: 'rgba(0,0,16,0.85)' }}
    >
      {/* Left: Network status */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className={`status-dot ${NETWORK === 'mainnet-beta' ? 'green' : 'amber'}`} />
          <span className="text-xs font-mono text-aegis-subtext uppercase tracking-wider">
            {NETWORK === 'mainnet-beta' ? 'Mainnet' : 'Devnet'}
          </span>
        </div>
        {connected && (
          <div className="hidden sm:flex items-center gap-3 text-xs font-mono">
            <div className="flex items-center gap-1.5 text-aegis-subtext">
              <Activity className="w-3 h-3 text-aegis-cyan" />
              <span className="text-aegis-text">{balances.SOL.toFixed(4)}</span>
              <span className="text-aegis-muted">SOL</span>
            </div>
            {balances.USDC > 0 && (
              <div className="text-aegis-subtext">
                <span className="text-aegis-text">{balances.USDC.toFixed(2)}</span>
                <span className="text-aegis-muted ml-1">USDC</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Center: protocol badge */}
      <div className="hidden md:flex items-center gap-2 text-xs text-aegis-muted">
        <Wifi className="w-3 h-3 text-aegis-cyan" />
        <span className="text-aegis-cyan font-semibold">Aegis Shield: Economic Privacy Protocol</span>
        <span className="px-1.5 py-0.5 rounded bg-aegis-cyan/10 border border-aegis-cyan/20 text-aegis-cyan text-[10px] font-mono">
          v3.0.0
        </span>
      </div>

      {/* Right: Wallet */}
      <div className="flex items-center gap-3">
        {connected && publicKey && (
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-aegis-card border border-aegis-border text-xs font-mono">
            <Shield className="w-3 h-3 text-aegis-purple" />
            <span className="text-aegis-subtext">{shortenAddress(publicKey.toString(), 4)}</span>
          </div>
        )}
        <WalletMultiButton />
      </div>
    </header>
  );
}
