import React from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { WalletContextProvider } from './context/WalletContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { Layout } from './components/Layout/Layout.jsx';
import { GiftCards } from './pages/GiftCards.jsx';
import { PaymentLinks } from './pages/PaymentLinks.jsx';
import { AuditPortal } from './pages/AuditPortal.jsx';
import { Shield, Lock, Eye, Gift, ArrowRight, Zap, Link2 } from 'lucide-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

const logoPngSrc = '/assets/logo.png';
const logoJpgSrc = '/assets/logo.jpg';

function handleLogoFallback(event) {
  if (event.currentTarget.src.endsWith('/assets/logo.jpg')) {
    return;
  }

  event.currentTarget.onerror = null;
  event.currentTarget.src = logoJpgSrc;
}

function Navbar() {
  const navigate = useNavigate();
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 border-b border-aegis-border bg-aegis-surface/80 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <img
          src={logoPngSrc}
          alt="Aegis Shield"
          onError={handleLogoFallback}
          className="block max-h-10 w-auto object-contain"
          style={{ filter: 'drop-shadow(0 0 14px rgba(0,212,255,0.22))' }}
        />
        <span className="text-aegis-text font-bold text-lg tracking-wide">
          AEGIS <span className="text-aegis-cyan">SHIELD</span>
        </span>
      </div>
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/gift-cards')}
          className="hidden sm:flex items-center gap-1.5 px-4 py-2 rounded-lg border border-aegis-border bg-aegis-card text-aegis-subtext text-sm hover:text-aegis-cyan hover:border-aegis-cyan/30 transition-all"
        >
          <Gift className="w-4 h-4" />
          Launch App
        </button>
        <WalletMultiButton />
      </div>
    </nav>
  );
}

function HeroSection() {
  const navigate = useNavigate();
  return (
    <section className="relative flex flex-col items-center justify-center min-h-screen text-center px-6 pt-20 pb-16 bg-hero-gradient">
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(0,212,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(0,212,255,1) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      <div className="relative z-10 max-w-4xl mx-auto">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-aegis-cyan/30 bg-aegis-cyan/5 text-aegis-cyan text-sm font-medium mb-8">
          <Zap className="w-4 h-4" />
          <span>Privacy-first payments on Solana</span>
        </div>

        <h1 className="text-5xl md:text-7xl font-bold text-aegis-text mb-6 leading-tight">
          The{' '}
          <span className="bg-clip-text text-transparent bg-aegis-gradient">
            Privacy Gateway
          </span>{' '}
          for Solana
        </h1>

        <p className="text-xl text-aegis-subtext mb-10 max-w-2xl mx-auto leading-relaxed">
          100% serverless, non-custodial privacy gateway. Private gift cards, stealth payment
          links, and selective audit portal — secured by Aegis Shield economic privacy.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <button
            onClick={() => navigate('/gift-cards')}
            className="flex items-center gap-2 px-8 py-4 rounded-xl bg-aegis-gradient text-white font-semibold text-base hover:opacity-90 transition-opacity shadow-lg shadow-aegis-cyan/20"
          >
            <Shield className="w-5 h-5" />
            Launch App
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
            className="flex items-center gap-2 px-8 py-4 rounded-xl border border-aegis-border bg-aegis-surface/50 text-aegis-subtext font-semibold text-base hover:border-aegis-cyan/40 hover:text-aegis-text transition-all"
          >
            <Eye className="w-5 h-5" />
            Learn More
          </button>
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ icon: Icon, title, description, gradient, path }) {
  const navigate = useNavigate();
  return (
    <div
      onClick={() => navigate(path)}
      className="flex flex-col gap-4 p-6 rounded-2xl border border-aegis-border bg-card-gradient hover:border-aegis-cyan/30 transition-all group cursor-pointer"
    >
      <div
        className={`w-12 h-12 rounded-xl flex items-center justify-center ${gradient}`}
      >
        <Icon className="w-6 h-6 text-white" />
      </div>
      <div>
        <h3 className="text-aegis-text font-semibold text-lg mb-2 group-hover:text-aegis-cyan transition-colors">{title}</h3>
        <p className="text-aegis-subtext text-sm leading-relaxed">{description}</p>
      </div>
      <div className="flex items-center gap-1 text-xs text-aegis-cyan opacity-0 group-hover:opacity-100 transition-opacity mt-auto">
        <span>Open</span>
        <ArrowRight className="w-3 h-3" />
      </div>
    </div>
  );
}

function FeaturesSection() {
  const features = [
    {
      icon: Gift,
      title: 'Private Gift Cards',
      description:
        'Send value privately with stealth gift cards. Recipients redeem with a single link — no on-chain link between sender and receiver.',
      gradient: 'bg-gradient-to-br from-aegis-cyan/30 to-aegis-purple/30',
      path: '/gift-cards',
    },
    {
      icon: Link2,
      title: 'Stealth Payment Links',
      description:
        'Generate one-time stealth addresses for receiving payments. Your identity stays private while funds arrive on-chain.',
      gradient: 'bg-gradient-to-br from-aegis-purple/30 to-aegis-teal/30',
      path: '/payment-links',
    },
    {
      icon: Eye,
      title: 'Selective Audit Portal',
      description:
        'Prove your transaction history to auditors without revealing your full wallet. Cryptographic proofs, not trust.',
      gradient: 'bg-gradient-to-br from-aegis-teal/30 to-aegis-green/30',
      path: '/audit-portal',
    },
    {
      icon: Shield,
      title: 'Non-Custodial Security',
      description:
        'Your keys, your funds. Aegis Shield never holds assets or private keys. All operations happen client-side.',
      gradient: 'bg-gradient-to-br from-aegis-green/30 to-aegis-cyan/30',
      path: '/gift-cards',
    },
  ];

  return (
    <section id="features" className="max-w-6xl mx-auto px-6 py-24">
      <div className="text-center mb-16">
        <h2 className="text-3xl md:text-4xl font-bold text-aegis-text mb-4">
          Privacy without compromise
        </h2>
        <p className="text-aegis-subtext text-lg max-w-xl mx-auto">
          Built for Aegis Shield — privacy enforced by cryptography and aligned incentives.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {features.map((f) => (
          <FeatureCard key={f.title} {...f} />
        ))}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-aegis-border py-8 px-6 text-center text-aegis-muted text-sm">
      <p>
        © {new Date().getFullYear()} Aegis Shield. Non-custodial. Serverless. Private.
      </p>
    </footer>
  );
}

function HomePage() {
  return (
    <div className="min-h-screen bg-aegis-bg flex flex-col">
      <Navbar />
      <main className="flex-1">
        <HeroSection />
        <FeaturesSection />
      </main>
      <Footer />
    </div>
  );
}

function AppLayout({ children }) {
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <WalletContextProvider>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route
            path="/gift-cards"
            element={<AppLayout><GiftCards /></AppLayout>}
          />
          <Route
            path="/payment-links"
            element={<AppLayout><PaymentLinks /></AppLayout>}
          />
          <Route
            path="/audit-portal/*"
            element={<AppLayout><AuditPortal /></AppLayout>}
          />
          <Route
            path="/audit-review"
            element={<Navigate to="/audit-portal/review" replace />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </WalletContextProvider>
  );
}
