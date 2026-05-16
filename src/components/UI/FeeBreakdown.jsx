import React from 'react';
import { Info, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

export function FeeBreakdown({ fees, tokenSymbol, showFull = false, networkSetupFee = 0 }) {
  const [expanded, setExpanded] = useState(showFull);
  if (!fees) return null;
  const totalRequiredNow = fees.total + (networkSetupFee || 0);
  const showAegisFee = fees.includesAegisFee && fees.aegisFee > 0;

  return (
    <div className="rounded-xl border border-aegis-border/60 bg-aegis-card/50 overflow-hidden">
      {/* Summary row */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-aegis-card/80 transition-colors"
      >
        <div className="flex items-center gap-2 text-sm text-aegis-subtext">
          <Info className="w-3.5 h-3.5 text-aegis-cyan" />
          <span>Fee Breakdown</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-mono text-aegis-text">
            {totalRequiredNow.toFixed(tokenSymbol === 'SOL' ? 6 : 4)} {tokenSymbol}
          </span>
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-aegis-muted" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-aegis-muted" />
          )}
        </div>
      </button>

      {/* Expanded breakdown */}
      {expanded && (
        <div className="border-t border-aegis-border/40 px-4 py-3 space-y-2">
          <FeeRow
            label="Exact amount requested by sender"
            value={`${fees.netDeposit.toFixed(6)} ${tokenSymbol}`}
            subtext="This is the clean amount that will land in the privacy pool"
            bold
            color="text-aegis-green"
          />
          <FeeRow
            label="Gross Umbra deposit"
            value={`${fees.raw.toFixed(6)} ${tokenSymbol}`}
            subtext="The on-chain Umbra deposit is grossed up so the pool receives the exact requested amount"
          />
          <FeeRow
            label={`Umbra protocol fee (${fees.umbraFeePercent}%)`}
            value={`−${fees.umbraFee.toFixed(6)} ${tokenSymbol}`}
            subtext="Deducted on-chain by Umbra smart contract"
            color="text-aegis-amber"
          />
          {showAegisFee && (
            <FeeRow
              label={`Aegis platform fee (${fees.aegisFeePercent}%)`}
              value={`−${fees.aegisFee.toFixed(6)} ${tokenSymbol}`}
              subtext="Sent to Aegis treasury during the payment flow"
              color="text-aegis-purple"
            />
          )}
          <div className="h-px bg-aegis-border/40 my-1" />
          <FeeRow
            label="Net deposited into Umbra pool"
            value={`${fees.netDeposit.toFixed(6)} ${tokenSymbol}`}
            subtext="What the recipient will claim"
            color="text-aegis-green"
            bold
          />
          <FeeRow
            label="Protocol total you pay"
            value={`${fees.total.toFixed(6)} ${tokenSymbol}`}
            subtext={showAegisFee ? 'Gross Umbra deposit + Aegis fee' : 'Baseline issue amount before temporary setup overhead'}
            bold
          />
          {networkSetupFee > 0 && (
            <FeeRow
              label="ZK network setup fee (estimate)"
              value={`${networkSetupFee.toFixed(6)} ${tokenSymbol}`}
              subtext="Umbra account setup + registration transactions + network fee margin"
              color="text-aegis-amber"
              bold
            />
          )}
          {networkSetupFee > 0 && (
            <FeeRow
              label="Estimated wallet required right now"
              value={`${totalRequiredNow.toFixed(6)} ${tokenSymbol}`}
              subtext="Needed in wallet to pass pre-check before simulation"
              color="text-aegis-cyan"
              bold
            />
          )}
          <div className="mt-2 p-2 rounded-lg bg-aegis-cyan/5 border border-aegis-cyan/20">
            <p className="text-[10px] text-aegis-muted leading-relaxed">
              <span className="text-aegis-cyan font-semibold">How Umbra fees work: </span>
              BPS_DIVISOR = 16384 · Umbra fee = 49 BPS ≈ 0.299%  
              Aegis now grosses up the Umbra deposit so the recipient still sees the exact requested net amount in the pool. The extra amount you pay is the protocol overhead, not a shortfall for the recipient.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function FeeRow({ label, value, subtext, color = 'text-aegis-text', bold = false }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <p className={`text-xs ${bold ? 'font-semibold text-aegis-text' : 'text-aegis-subtext'}`}>
          {label}
        </p>
        {subtext && <p className="text-[10px] text-aegis-muted leading-tight">{subtext}</p>}
      </div>
      <span className={`text-xs font-mono whitespace-nowrap ${bold ? `font-bold ${color}` : color}`}>
        {value}
      </span>
    </div>
  );
}
