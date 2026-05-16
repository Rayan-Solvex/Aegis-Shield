// ─── Aegis Shield — Central Configuration ───────────────────────────────────

const DEFAULT_API_ORIGIN =
  typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : '';

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || DEFAULT_API_ORIGIN;

const PUBLIC_SOLANA_RPC_ENDPOINTS = {
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
};

const PUBLIC_SOLANA_WS_ENDPOINTS = {
  'mainnet-beta': 'wss://api.mainnet-beta.solana.com',
  devnet: 'wss://api.devnet.solana.com',
};

const PREMIUM_SOLANA_RPC_ENDPOINTS = {
  helius: {
    'mainnet-beta': import.meta.env.VITE_HELIUS_MAINNET_RPC,
    devnet: import.meta.env.VITE_HELIUS_DEVNET_RPC,
  },
  quicknode: {
    'mainnet-beta': import.meta.env.VITE_QUICKNODE_MAINNET_RPC,
    devnet: import.meta.env.VITE_QUICKNODE_DEVNET_RPC,
  },
  blocksprint: {
    'mainnet-beta': import.meta.env.VITE_BLOCKSPRINT_MAINNET_RPC,
    devnet: import.meta.env.VITE_BLOCKSPRINT_DEVNET_RPC,
  },
};

// ─── Solana Network ──────────────────────────────────────────────────────────
export const NETWORK =
  import.meta.env.VITE_SOLANA_NETWORK === 'mainnet-beta'
    ? 'mainnet-beta'
    : 'devnet';

export const SOLANA_COMMITMENT = import.meta.env.VITE_SOLANA_COMMITMENT || 'confirmed';

function normalizePreferredRpcProvider(provider) {
  const normalized = String(provider || '').trim().toLowerCase();
  if (!normalized || normalized === 'solana-public') {
    return null;
  }

  return normalized;
}

function toWebSocketEndpoint(endpoint) {
  if (!endpoint) {
    return '';
  }

  if (endpoint.startsWith('wss://') || endpoint.startsWith('ws://')) {
    return endpoint;
  }

  if (endpoint.startsWith('https://')) {
    return `wss://${endpoint.slice('https://'.length)}`;
  }

  if (endpoint.startsWith('http://')) {
    return `ws://${endpoint.slice('http://'.length)}`;
  }

  return endpoint;
}

function getPreferredRpcProviderEndpoint(transport) {
  const preferredProvider = normalizePreferredRpcProvider(import.meta.env.VITE_PREFERRED_RPC_PROVIDER);
  if (!preferredProvider) {
    return '';
  }

  const providerEndpoints = PREMIUM_SOLANA_RPC_ENDPOINTS[preferredProvider];
  if (!providerEndpoints) {
    return '';
  }

  const endpoint = providerEndpoints[NETWORK] || '';
  if (!endpoint) {
    return '';
  }

  return transport === 'ws' ? toWebSocketEndpoint(endpoint) : endpoint;
}

export function getRpcEndpoint() {
  const preferredProviderEndpoint = getPreferredRpcProviderEndpoint('rpc');
  if (preferredProviderEndpoint) {
    return preferredProviderEndpoint;
  }

  const envRpcEndpoint =
    NETWORK === 'mainnet-beta'
      ? import.meta.env.VITE_SOLANA_RPC_MAINNET
      : import.meta.env.VITE_SOLANA_RPC_DEVNET;

  if (envRpcEndpoint) {
    return envRpcEndpoint;
  }

  if (import.meta.env.VITE_API_BASE_URL) {
    return NETWORK === 'mainnet-beta'
      ? `${API_BASE_URL}/api/solana/rpc/mainnet`
      : `${API_BASE_URL}/api/solana/rpc/devnet`;
  }

  return PUBLIC_SOLANA_RPC_ENDPOINTS[NETWORK];
}

export function getWsEndpoint() {
  const preferredProviderEndpoint = getPreferredRpcProviderEndpoint('ws');
  if (preferredProviderEndpoint) {
    return preferredProviderEndpoint;
  }

  const envWsEndpoint =
    NETWORK === 'mainnet-beta'
      ? import.meta.env.VITE_SOLANA_WS_MAINNET
      : import.meta.env.VITE_SOLANA_WS_DEVNET;

  if (envWsEndpoint) {
    return envWsEndpoint;
  }

  if (import.meta.env.VITE_API_BASE_URL) {
    return '';
  }

  return PUBLIC_SOLANA_WS_ENDPOINTS[NETWORK];
}

// ─── Umbra Protocol — Official Endpoints ────────────────────────────────────
// Source: https://docs.umbraprivacy.com/docs/introduction
export const UMBRA_CONFIG = {
  // Devnet indexer — Umbra's official indexer for UTXO discovery
  indexerUrl:
    import.meta.env.VITE_UMBRA_INDEXER_URL ||
    'https://api-devnet.umbraprivacy.com',
  // Devnet relayer — used ONLY by receiver for gasless withdrawals
  relayerUrl:
    import.meta.env.VITE_UMBRA_RELAYER_URL ||
    'https://relayer-devnet.umbraprivacy.com',
  // Program IDs on devnet (from official Umbra Solana deployment)
  programId: 'DSuKkyqGVGgo4QtPABfxKJKygUDACbUhirnuv63mEpAJ',
  // Umbra base fee in BPS (from SDK: BPS_DIVISOR = 16384 → 0.3% default)
  // BPS_DIVISOR = 16384, umbra fee = 49 BPS ≈ 0.299% ≈ 0.3%
  BPS_DIVISOR: 16384,
  UMBRA_FEE_BPS: 49, // 49/16384 ≈ 0.299%
  // Umbrella memo program tag
  memoTag: 'AEGIS_SHIELD_V1',
};

// ─── Aegis Audit Registry Prototype ─────────────────────────────────────────
export const AEGIS_AUDIT_REGISTRY_PROGRAM_ID =
  'BaEYfiiK12ranC3KrMyz3XvLNVUBip3fkt2cGtWw3RG8';

// ─── Aegis Platform Fee ──────────────────────────────────────────────────────
// 0.3% platform fee applied across all Aegis product surfaces
export const AEGIS_FEE_PERCENT = 0.003; // 0.3%
export const AEGIS_FEE_BPS = 30; // 30 / 10000 = 0.3%

// Devnet fee sink for hackathon/demo revenue collection.
// IMPORTANT: Replace with the production Aegis Treasury multisig before mainnet launch.
export const AEGIS_TREASURY_ADDRESS =
  'EPEeqaP4KrmB7AXJ4xdaf1jiu73NHESGkRDLhadUHK7f';

// ─── SPL Token Mints (Devnet) ────────────────────────────────────────────────
export const TOKEN_MINTS = {
  USDC: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // Devnet USDC
  USDT: 'EJwZgeZrdC8TXTQbQBoL6bfuAnFUUy1PVCMB4DYPzVaS', // Devnet USDT
  SOL: 'So11111111111111111111111111111111111111112',   // Native SOL
  WSOL: 'So11111111111111111111111111111111111111112',  // Wrapped SOL (same mint)
};

// ─── Token Decimals ──────────────────────────────────────────────────────────
export const TOKEN_DECIMALS = {
  USDC: 6,
  USDT: 6,
  SOL: 9,
  WSOL: 9,
};

// ─── Fee Constants ────────────────────────────────────────────────────────────
// Approximate Solana rent for UTXO accounts (0.002 SOL per account)
export const UTXO_RENT_LAMPORTS = 2_000_000; // 0.002 SOL
// Base transaction fee
export const BASE_TX_FEE_LAMPORTS = 5_000; // ~0.000005 SOL per signature
// ATA rent exemption
export const ATA_RENT_LAMPORTS = 2_039_280; // SPL token account rent exemption

// ZK issue flow fixed overhead on top of deposit amount for temporary operator
// account setup/registration in current devnet integration.
export const ZK_OPERATOR_SETUP_LAMPORTS = 70_000_000; // 0.07 SOL
export const ZK_TX_FEE_MARGIN_LAMPORTS = 100_000; // safety margin for funding tx fee variance

// ─── Aegis Redeem Base URL ───────────────────────────────────────────────────
// The stateless gift card URL — keys are passed in the fragment (never sent to server)
export const AEGIS_REDEEM_BASE = 'https://aegis-shield.gitbook.io/aegis-shield-docs/redeem';

// ─── Proxy helpers ───────────────────────────────────────────────────────────
export const PROXY_API = (url) =>
  `${API_BASE_URL}/api/proxy-api?url=${encodeURIComponent(url)}`;
