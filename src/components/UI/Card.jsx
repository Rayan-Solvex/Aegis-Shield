import React from 'react';

export function Card({ children, className = '', glow = false, gradient = false }) {
  return (
    <div
      className={`
        rounded-2xl border border-aegis-border/60 bg-aegis-surface/80 backdrop-blur-sm
        ${glow ? 'glow-cyan' : ''}
        ${gradient ? 'bg-card-gradient' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = '' }) {
  return (
    <div className={`px-6 pt-5 pb-4 border-b border-aegis-border/40 ${className}`}>
      {children}
    </div>
  );
}

export function CardBody({ children, className = '' }) {
  return <div className={`px-6 py-5 ${className}`}>{children}</div>;
}

export function CardFooter({ children, className = '' }) {
  return (
    <div className={`px-6 py-4 border-t border-aegis-border/40 ${className}`}>
      {children}
    </div>
  );
}

export function StatCard({ label, value, sub, icon: Icon, color = 'cyan' }) {
  const colorMap = {
    cyan: { text: 'text-aegis-cyan', bg: 'bg-aegis-cyan/10', border: 'border-aegis-cyan/20' },
    purple: { text: 'text-aegis-purple', bg: 'bg-aegis-purple/10', border: 'border-aegis-purple/20' },
    green: { text: 'text-aegis-green', bg: 'bg-aegis-green/10', border: 'border-aegis-green/20' },
    amber: { text: 'text-aegis-amber', bg: 'bg-aegis-amber/10', border: 'border-aegis-amber/20' },
    teal: { text: 'text-aegis-teal', bg: 'bg-aegis-teal/10', border: 'border-aegis-teal/20' },
  };
  const c = colorMap[color] ?? colorMap.cyan;
  return (
    <div className={`rounded-xl p-4 border ${c.border} ${c.bg}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-aegis-muted mb-1">{label}</p>
          <p className={`text-2xl font-bold font-mono ${c.text}`}>{value}</p>
          {sub && <p className="text-xs text-aegis-subtext mt-1">{sub}</p>}
        </div>
        {Icon && (
          <div className={`w-8 h-8 rounded-lg ${c.bg} flex items-center justify-center`}>
            <Icon className={`w-4 h-4 ${c.text}`} />
          </div>
        )}
      </div>
    </div>
  );
}
