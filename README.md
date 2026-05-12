# Aegis Shield

Aegis Shield is economic privacy infrastructure for Solana: a zero-custody protocol layer that combines private value transfer, selective disclosure, and compliance-aware coordination without introducing a custodial backend.

The current submission turns that thesis into a working product surface judges can test immediately. It combines Umbra-native stealth flows, gasless redemption for recipients, and contract-backed audit permissions so privacy is usable, composable, and operationally credible.

## Why It Matters

Solana is fast and transparent, but transparency creates a structural cost for normal users, operators, and businesses. Wallet clustering, public treasury exposure, copy-trading, and permanent transaction graph linkage all turn basic payments into identity leakage.

Aegis Shield addresses that problem as infrastructure, not as a one-off app. It gives users a way to move value privately while preserving an explicit path for consent-based review when disclosure is necessary. That is the core proposition: privacy by default, auditability by permission, and no custody tradeoff in between.

At the peer-to-peer layer, Aegis is designed for the highest practical level of privacy in the current stack: the sender and receiver do not need to expose or link each other's canonical wallet addresses on-chain. At the compliance layer, access is not public and not discretionary to the frontend. The smart-contract boundary is designed to authorize only designated auditors, so review access remains bounded, accountable, and useful for compliance or dispute resolution without collapsing into blanket surveillance.

## Core Differentiators

- Zero-custody architecture with no central fund holder and no Web2 settlement dependency
- Umbra-native stealth links and privacy-preserving redemption flows on Solana
- Peer-to-peer anonymity so sender and receiver do not directly link one another's wallet identities on-chain
- Gasless gift card redemption for recipients who hold zero SOL
- Automated rent reclamation to recover temporary account overhead and reduce capital leakage
- Contract-backed auditor authorization for selective disclosure instead of blanket wallet exposure

## Privacy And Auditor Logic

### Peer-to-Peer Anonymity

Aegis Shield is built so private transfers do not require sender and receiver wallet addresses to become trivially linked on-chain. The protocol relies on Umbra-native stealth and self-claimable flows so value can move without exposing the receiver's canonical wallet relationship in the transfer path.

### Authorized Auditor Access

The audit path is intentionally gated. The Aegis audit registry is designed to authorize access only to designated auditors that have been admitted into the protocol boundary. That makes the privacy model stronger, not weaker: ordinary observers do not get disclosure rights, while compliance, dispute resolution, and authorized review can still happen through explicit, contract-backed permissioning.

## Read The Full Docs

Official documentation is published on GitBook:

<https://aegis-shield.gitbook.io/aegis-shield-docs/>

The `docs/` directory in this repository is the GitBook-ready source. Use the GitBook site for the full architecture walkthrough, role model, and protocol rationale.

The product roadmap for the three-pillar rollout is in `ROADMAP.md`.

## What This Repo Contains

- A Vite + React frontend for the hackathon demo
- Umbra-powered private gift card and stealth payment flows on Solana Devnet
- An Audit Portal for selective disclosure and auditor grant management
- An Anchor program for the Aegis audit registry under `programs/aegis-audit-registry/`

## What Judges Can Evaluate

- Private Gift Cards: issue a privacy-preserving gift card and redeem it through a polished issue -> success -> redeem flow
- Umbra-native Stealth Links: generate payment links built on Umbra routing primitives
- Audit Portal: inspect the selective disclosure model backed by the Aegis audit registry contract

## Product Surfaces

### Private Gift Cards

Recipients receive a redeemable link backed by Umbra self-claimable flows. The current Pillar 1 demo supports a polished issue -> success -> redeem path with gasless relayer redemption, a direct-withdraw finish path, and fee-aware redemption messaging.

### Stealth Payment Links

The payment-link surface extends the same infrastructure to privacy-preserving collection flows. This is the Umbra-native stealth link thesis in product form: asynchronous value transfer without exposing the receiver's canonical wallet relationship on-chain.

### Audit Portal

The Audit Portal is the compliance layer of Aegis Shield. It uses the on-chain registry plus scoped off-chain delivery packages so users can authorize review access without exposing global wallet history.

## Architecture Summary

Aegis Shield separates three concerns that are usually collapsed into a single tradeoff:

- Privacy execution through Umbra primitives
- Solana-native settlement and application UX
- Selective disclosure through an Arcium-aligned compliance architecture and an Anchor registry

That separation is what makes Aegis infrastructure. Users do not need to choose between full exposure and opaque black-box custody. They can use private payment rails now and authorize bounded review later.

## Roadmap Snapshot

- Pillar 1, current: Private Gift Cards are live on Devnet, with upfront rent aggregation planned as the next pricing refinement so users can see cleaner net-of-rent costs.
- Pillar 2, planned: Stealth Pay Links extend Aegis into one-click private payment and collection flows.
- Pillar 3, planned: The Audit Portal expands into production-grade authorized metadata disclosure for designated auditors.

## Technical Stack

- Umbra SDK and zk provers for confidential balance and claim flows
- Solana Devnet, `@solana/web3.js`, and SPL Token primitives
- Anchor for the audit-registry program and migrations
- React 18, Vite 5, Tailwind CSS, and wallet-adapter UI components
- Arcium-aligned selective disclosure architecture for the protocol's compliance roadmap

## Quick Start

### Prerequisites

- Node.js 18+
- npm
- A Solana wallet supported by wallet-adapter
- Solana Devnet funds for testing

### Run The App

```bash
npm install
npm run dev
```

The frontend runs with Vite. For a production build:

```bash
npm run build
npm run preview
```

## Environment

The demo is configured for Devnet. Use `.env.example` as the starting point for local configuration and keep the network on Devnet for hackathon review.

Key frontend variables:

```bash
VITE_SOLANA_NETWORK=devnet
VITE_SOLANA_RPC_DEVNET=https://api.devnet.solana.com
VITE_SOLANA_WS_DEVNET=wss://api.devnet.solana.com
VITE_SOLANA_COMMITMENT=confirmed
```

Optional provider and routing overrides are supported through the additional RPC environment variables already documented in the template.

## Contract Workspace

This repository is also an Anchor workspace. The Rust workspace root and the on-chain program manifest are both required and should remain in place.

Useful contract commands:

```bash
npm run contract:check
npm run anchor:build-local
npm run anchor:test
```

Canonical deployment flow for Devnet:

```bash
anchor build
anchor deploy --provider.cluster devnet
anchor idl build -p aegis_audit_registry
anchor migrate --provider.cluster devnet
```

Optional migration environment variables:

```bash
AEGIS_MIN_AUDITOR_STAKE_LAMPORTS=1000000000
AEGIS_MIN_AUDITOR_STAKE_SOL=1
AEGIS_SLASH_DESTINATION=<devnet-pubkey>
AEGIS_PROTOCOL_ADMIN=<devnet-pubkey>
```

If neither minimum-stake variable is set, initialization defaults to `1 SOL`.

## Audit Registry Scope

The current on-chain registry covers:

- protocol initialization and config updates
- auditor registration, approval, suspension, and stake management
- viewing-grant creation, revocation, and closure
- slashing and auditor stake withdrawal flows

This contract is the authorization boundary for the audit portal in the current Devnet architecture.

## Repository Notes For Reviewers

- The hackathon demo target is Solana Devnet.
- `docs/` is the source of truth for long-form protocol documentation.
- `public/docs/` is a bundled fallback preview surface, not the primary published docs channel.
- `patches/` contains the local Umbra SDK patch required by this build.
- The current build highlights zero-custody private gift cards, stealth payment links, and contract-backed selective disclosure.

## Validation

The frontend production build is validated with:

```bash
npm run build
```
