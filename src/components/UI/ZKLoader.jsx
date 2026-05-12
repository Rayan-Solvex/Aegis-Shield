import React from 'react';
import { Loader2, Shield, Lock } from 'lucide-react';

export function ZKLoader({ step = '' }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-6">
      {/* Animated ZK circuit rings */}
      <div className="relative w-24 h-24">
        {/* Outer ring */}
        <div className="absolute inset-0 rounded-full border-2 border-aegis-cyan/20 animate-spin-slow" />
        {/* Middle ring */}
        <div
          className="absolute inset-2 rounded-full border-2 border-dashed border-aegis-purple/40"
          style={{ animation: 'spin 2s linear infinite reverse' }}
        />
        {/* Inner shield */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-aegis-card border border-aegis-border flex items-center justify-center">
            <Shield className="w-5 h-5 text-aegis-cyan animate-pulse" />
          </div>
        </div>
        {/* Scan line */}
        <div className="absolute inset-0 rounded-full overflow-hidden">
          <div
            className="absolute left-0 right-0 h-[2px]"
            style={{
              background:
                'linear-gradient(90deg, transparent, rgba(0,212,255,0.8), transparent)',
              animation: 'zk-scan 1.5s linear infinite',
            }}
          />
        </div>
      </div>

      {/* Step text */}
      <div className="text-center space-y-2">
        <div className="flex items-center gap-2 justify-center text-aegis-cyan">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm font-medium">Processing...</span>
        </div>
        {step && (
          <p className="text-xs text-aegis-subtext font-mono max-w-xs text-center">
            {step}
          </p>
        )}
      </div>

      {/* Progress dots */}
      <div className="flex items-center gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-aegis-cyan/40"
            style={{ animation: `pulse 1.5s ease-in-out ${i * 0.2}s infinite` }}
          />
        ))}
      </div>

      <p className="text-[10px] text-aegis-muted font-mono">
        <Lock className="w-3 h-3 inline-block mr-1 mb-0.5" />
        ZK proof · Arcium MPC · On-chain privacy
      </p>
    </div>
  );
}
