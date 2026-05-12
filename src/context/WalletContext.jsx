import React, { useMemo, useEffect } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { getRpcEndpoint, getWsEndpoint, SOLANA_COMMITMENT } from '../config.js';

const endpoint = getRpcEndpoint();
const wsEndpoint = getWsEndpoint();

const connectionConfig = {
  commitment: SOLANA_COMMITMENT,
  wsEndpoint,
  disableRetryOnRateLimit: false,
};

function useSolflareRecommended() {
  useEffect(() => {
    const STYLE_ID = 'solflare-recommended-styles';
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        .wallet-adapter-modal-list li.solflare-recommended {
          order: -1;
          border: 1px solid rgba(0,212,255,0.4);
          border-radius: 8px;
          background: rgba(0,212,255,0.06);
          position: relative;
        }
        .solflare-recommended-badge {
          display: inline-flex;
          align-items: center;
          background: linear-gradient(135deg, #00d4ff, #8b5cf6);
          color: #000;
          font-size: 10px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 4px;
          margin-left: auto;
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }
      `;
      document.head.appendChild(style);
    }

    function promoteSolflare(modalList) {
      const items = modalList.querySelectorAll('li');
      let solflareItem = null;
      items.forEach((li) => {
        const btn = li.querySelector('.wallet-adapter-button');
        if (btn && btn.textContent?.toLowerCase().includes('solflare')) {
          solflareItem = li;
        }
      });
      if (solflareItem && !solflareItem.classList.contains('solflare-recommended')) {
        modalList.prepend(solflareItem);
        solflareItem.classList.add('solflare-recommended');
        const btn = solflareItem.querySelector('.wallet-adapter-button');
        if (btn && !btn.querySelector('.solflare-recommended-badge')) {
          const badge = document.createElement('span');
          badge.className = 'solflare-recommended-badge';
          badge.textContent = 'Recommended';
          btn.appendChild(badge);
        }
      }
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) {
            const el = node;
            const modalList = el.classList?.contains('wallet-adapter-modal-list')
              ? el
              : el.querySelector?.('.wallet-adapter-modal-list');
            if (modalList) promoteSolflare(modalList);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const existing = document.querySelector('.wallet-adapter-modal-list');
    if (existing) promoteSolflare(existing);
    return () => observer.disconnect();
  }, []);
}

function InnerWalletProvider({ children }) {
  useSolflareRecommended();
  // Wallet Standard auto-detection — empty array picks up Phantom, Solflare, etc.
  const wallets = useMemo(() => [], []);

  return (
    <WalletProvider wallets={wallets} autoConnect>
      <WalletModalProvider>{children}</WalletModalProvider>
    </WalletProvider>
  );
}

export function WalletContextProvider({ children }) {
  return (
    <ConnectionProvider endpoint={endpoint} config={connectionConfig}>
      <InnerWalletProvider>{children}</InnerWalletProvider>
    </ConnectionProvider>
  );
}
