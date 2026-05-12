import React from 'react';
import { Loader2 } from 'lucide-react';

const VARIANTS = {
  primary: 'bg-gradient-to-r from-aegis-cyan/20 to-aegis-purple/20 border-aegis-cyan/40 text-aegis-cyan hover:from-aegis-cyan/30 hover:to-aegis-purple/30 hover:border-aegis-cyan/70 active:scale-[0.98]',
  secondary: 'bg-aegis-bg border-aegis-border text-aegis-text hover:border-aegis-cyan/30 hover:bg-black active:scale-[0.98]',
  success: 'bg-gradient-to-r from-aegis-green/20 to-aegis-teal/20 border-aegis-green/40 text-aegis-green hover:from-aegis-green/30 hover:border-aegis-green/70 active:scale-[0.98]',
  danger: 'bg-gradient-to-r from-aegis-red/20 to-aegis-red/10 border-aegis-red/40 text-aegis-red hover:from-aegis-red/30 hover:border-aegis-red/70 active:scale-[0.98]',
  ghost: 'bg-transparent border-transparent text-aegis-muted hover:text-aegis-text hover:bg-aegis-card/50 active:scale-[0.98]',
};

const SIZES = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-sm gap-2.5',
  xl: 'h-14 px-8 text-base gap-3',
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon: Icon,
  className = '',
  type = 'button',
  ...props
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`
        relative inline-flex items-center justify-center
        border rounded-xl font-semibold
        transition-all duration-200
        disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none
        ${VARIANTS[variant]}
        ${SIZES[size]}
        ${className}
      `}
      {...props}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
      ) : Icon ? (
        <Icon className="w-4 h-4 flex-shrink-0" />
      ) : null}
      {children}
    </button>
  );
}
