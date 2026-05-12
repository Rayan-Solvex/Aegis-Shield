import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Gift,
  Link2,
  Eye,
  Shield,
  ChevronLeft,
  ChevronRight,
  Lock,
  Layers,
  Zap,
  ExternalLink,
} from 'lucide-react';

const NAV_ITEMS = [
  {
    path: '/gift-cards',
    label: 'Private Gift Cards',
    icon: Gift,
    badge: 'NEW',
    description: 'Issue & redeem privacy-preserving gift cards',
    color: 'text-aegis-cyan',
  },
  {
    path: '/payment-links',
    label: 'Stealth Pay Links',
    icon: Link2,
    badge: null,
    description: 'Share stealth payment addresses',
    color: 'text-aegis-purple',
  },
  {
    path: '/audit-portal',
    label: 'Audit Portal',
    icon: Eye,
    badge: null,
    description: 'Selective disclosure with TVKs',
    color: 'text-aegis-teal',
  },
];

const PROTOCOL_LINKS = [
  { label: 'Aegis Docs', href: 'https://aegis-shield.gitbook.io/aegis-shield-docs/', icon: ExternalLink },
  { label: 'Identity & Incentives', href: 'https://aegis-shield.gitbook.io/aegis-shield-docs/identity-and-roles', icon: ExternalLink },
];

const logoPngSrc = '/assets/logo.png';
const logoJpgSrc = '/assets/logo.jpg';

function handleLogoFallback(event) {
  if (event.currentTarget.src.endsWith('/assets/logo.jpg')) {
    return;
  }

  event.currentTarget.onerror = null;
  event.currentTarget.src = logoJpgSrc;
}

export function Sidebar({ collapsed, onToggle }) {
  const location = useLocation();

  return (
    <aside
      className="fixed top-0 left-0 h-full z-40 flex flex-col border-r border-aegis-border/50 transition-all duration-300"
      style={{
        width: collapsed ? 72 : 256,
        backgroundColor: 'rgba(5,5,26,0.95)',
        backdropFilter: 'blur(20px)',
      }}
    >
      {/* Logo */}
      <div className={`flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-4'} h-20 border-b border-aegis-border/50 flex-shrink-0`}>
        <img
          src={logoPngSrc}
          alt="Aegis Shield"
          onError={handleLogoFallback}
          className={`block w-auto object-contain flex-shrink-0 ${collapsed ? 'max-h-10' : 'max-h-12'}`}
          style={{ filter: 'drop-shadow(0 0 14px rgba(0,212,255,0.28))' }}
        />
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-sm font-bold text-aegis-text leading-tight">AEGIS SHIELD</div>
            <div className="text-[10px] text-aegis-muted font-mono leading-tight">Privacy Gateway</div>
          </div>
        )}
        <button
          onClick={onToggle}
          className={`${collapsed ? 'absolute top-6 right-2' : 'ml-auto'} flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-aegis-muted hover:text-aegis-cyan hover:bg-aegis-card transition-all`}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Protocol Badge */}
      {!collapsed && (
        <div className="mx-3 mt-3 px-3 py-2 rounded-lg bg-aegis-cyan/5 border border-aegis-cyan/20">
          <div className="flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-aegis-cyan flex-shrink-0" />
            <span className="text-xs text-aegis-cyan font-semibold">Economic Privacy Protocol</span>
          </div>
          <div className="text-[10px] text-aegis-muted mt-0.5 leading-relaxed">
            Aegis Shield · Non-custodial · ZK-native
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-2">
        <div className={`${collapsed ? '' : 'mb-2 px-2'}`}>
          {!collapsed && (
            <p className="text-[10px] font-semibold text-aegis-muted uppercase tracking-widest mb-2">
              Features
            </p>
          )}
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path || location.pathname.startsWith(item.path);
            return (
              <NavLink
                key={item.path}
                to={item.path}
                title={collapsed ? item.label : undefined}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 transition-all duration-200 group relative
                  ${isActive
                    ? 'bg-aegis-card border border-aegis-border text-aegis-text'
                    : 'text-aegis-muted hover:text-aegis-text hover:bg-aegis-card/50 border border-transparent'
                  }
                `}
              >
                {/* Active left bar */}
                {isActive && (
                  <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r ${item.color} bg-current`} />
                )}
                <Icon
                  className={`w-5 h-5 flex-shrink-0 transition-colors ${
                    isActive ? item.color : 'text-aegis-muted group-hover:text-aegis-subtext'
                  }`}
                />
                {!collapsed && (
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{item.label}</span>
                      {item.badge && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-aegis-cyan/20 text-aegis-cyan border border-aegis-cyan/30">
                          {item.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-aegis-muted truncate mt-0.5">{item.description}</p>
                  </div>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className="flex-shrink-0 border-t border-aegis-border/50 p-3">
        {!collapsed && (
          <>
            <p className="text-[10px] font-semibold text-aegis-muted uppercase tracking-widest mb-2">
              Resources
            </p>
            {PROTOCOL_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-aegis-muted hover:text-aegis-cyan hover:bg-aegis-cyan/5 transition-all text-xs mb-1"
              >
                <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{link.label}</span>
              </a>
            ))}
          </>
        )}
        <div className={`flex items-center gap-2 px-2 py-2 ${collapsed ? 'justify-center' : ''}`}>
          <Lock className="w-3 h-3 text-aegis-purple flex-shrink-0" />
          {!collapsed && (
            <span className="text-[10px] text-aegis-muted font-mono">
              Aegis Shield v1.0.0
            </span>
          )}
        </div>
      </div>
    </aside>
  );
}
