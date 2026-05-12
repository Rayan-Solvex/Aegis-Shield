import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useSolanaBalance } from '../../hooks/useSolanaBalance.js';

const TOKEN_ICONS = {
  SOL: '◎',
  WSOL: '◎',
  USDC: '○',
  USDT: '₮',
};

const TOKEN_COLORS = {
  SOL: 'text-aegis-purple',
  WSOL: 'text-aegis-purple',
  USDC: 'text-blue-400',
  USDT: 'text-green-400',
};

const TOKENS = ['SOL', 'WSOL', 'USDC', 'USDT'];

function getDisplayDecimals(token) {
  return token === 'SOL' || token === 'WSOL' ? 4 : 2;
}

export function TokenSelector({ value, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const { balances } = useSolanaBalance();

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 h-12 pl-4 pr-3 rounded-xl bg-aegis-bg border border-aegis-border hover:border-aegis-cyan/40 hover:bg-black transition-all disabled:opacity-50 disabled:cursor-not-allowed min-w-[112px] shadow-sm"
      >
        <span className={`text-lg font-bold ${TOKEN_COLORS[value]}`}>
          {TOKEN_ICONS[value]}
        </span>
        <span className="text-sm font-semibold text-aegis-text">{value}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-aegis-muted transition-transform ml-auto ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute top-full mt-2 right-0 z-50 w-48 rounded-xl bg-aegis-bg border border-aegis-border shadow-xl overflow-hidden">
          {TOKENS.map((token) => (
            <button
              key={token}
              type="button"
              onClick={() => { onChange(token); setOpen(false); }}
              className={`
                w-full flex items-center justify-between px-4 py-3 transition-colors
                hover:bg-black text-sm
                ${value === token ? 'bg-black' : ''}
              `}
            >
              <div className="flex items-center gap-2">
                <span className={`text-lg font-bold ${TOKEN_COLORS[token]}`}>
                  {TOKEN_ICONS[token]}
                </span>
                <div>
                  <div className="font-semibold text-aegis-text">{token}</div>
                  <div className="text-[10px] text-aegis-muted">
                    {balances[token]?.toFixed(getDisplayDecimals(token)) ?? '0.00'} available
                  </div>
                </div>
              </div>
              {value === token && (
                <div className="w-2 h-2 rounded-full bg-aegis-cyan" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
