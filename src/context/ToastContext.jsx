import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

let toastId = 0;

const ICONS = {
  success: <CheckCircle className="w-5 h-5 text-aegis-green flex-shrink-0" />,
  error: <XCircle className="w-5 h-5 text-aegis-red flex-shrink-0" />,
  warning: <AlertTriangle className="w-5 h-5 text-aegis-amber flex-shrink-0" />,
  info: <Info className="w-5 h-5 text-aegis-cyan flex-shrink-0" />,
};

const BORDER = {
  success: 'border-aegis-green/30',
  error: 'border-aegis-red/30',
  warning: 'border-aegis-amber/30',
  info: 'border-aegis-cyan/30',
};

const BG = {
  success: 'bg-aegis-green/5',
  error: 'bg-aegis-red/5',
  warning: 'bg-aegis-amber/5',
  info: 'bg-aegis-cyan/5',
};

function Toast({ toast, onRemove }) {
  const [exiting, setExiting] = React.useState(false);

  const handleRemove = useCallback(() => {
    setExiting(true);
    setTimeout(() => onRemove(toast.id), 300);
  }, [toast.id, onRemove]);

  return (
    <div
      className={`
        flex items-start gap-3 p-4 rounded-xl border backdrop-blur-md
        ${BORDER[toast.type]} ${BG[toast.type]} bg-aegis-surface/90
        shadow-2xl max-w-sm w-full
        ${exiting ? 'toast-exit' : 'toast-enter'}
      `}
    >
      {ICONS[toast.type]}
      <div className="flex-1 min-w-0">
        {toast.title && (
          <p className="text-sm font-semibold text-aegis-text mb-0.5">{toast.title}</p>
        )}
        <p className="text-xs text-aegis-subtext leading-relaxed">{toast.message}</p>
        {toast.txSig && (
          <a
            href={`https://explorer.solana.com/tx/${toast.txSig}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-aegis-cyan underline mt-1 inline-block"
          >
            View on Explorer →
          </a>
        )}
      </div>
      <button
        onClick={handleRemove}
        className="text-aegis-muted hover:text-aegis-text transition-colors flex-shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timeoutRefs = useRef({});

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    if (timeoutRefs.current[id]) {
      clearTimeout(timeoutRefs.current[id]);
      delete timeoutRefs.current[id];
    }
  }, []);

  const addToast = useCallback(
    ({ type = 'info', title, message, duration = 6000, txSig }) => {
      const id = ++toastId;
      setToasts((prev) => [...prev.slice(-4), { id, type, title, message, txSig }]);
      if (duration > 0) {
        timeoutRefs.current[id] = setTimeout(() => removeToast(id), duration);
      }
    },
    [removeToast]
  );

  const toast = {
    success: (message, opts = {}) => addToast({ type: 'success', message, ...opts }),
    error: (message, opts = {}) => addToast({ type: 'error', message, ...opts }),
    warning: (message, opts = {}) => addToast({ type: 'warning', message, ...opts }),
    info: (message, opts = {}) => addToast({ type: 'info', message, ...opts }),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-3 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <Toast toast={t} onRemove={removeToast} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
