# Aegis Shield Roadmap

Aegis Shield is being built as a privacy infrastructure suite for Solana, not as a single-purpose gift card application. The roadmap is organized around three pillars that share the same core thesis: private value transfer by default, bounded disclosure by permission, and zero-custody execution throughout.

## Pillar 1: Private Gift Cards

Status: Live on Devnet

Private Gift Cards are the first working product surface in the protocol. They demonstrate that Aegis can turn Umbra-native privacy flows into a usable consumer experience with zero custody, gas-aware redemption, and privacy-preserving delivery.

Current capabilities:

- Issue private gift cards through a polished issue -> success -> redeem flow
- Support gasless relayer redemption for recipients with zero SOL
- Preserve privacy through self-claimable Umbra flows
- Reclaim temporary account overhead through automated rent recovery

Immediate next improvement:

- Upfront rent aggregation, including net-of-rent pricing, so the sender sees a cleaner all-in cost before issuance

## Pillar 2: Stealth Pay Links

Status: Planned

Stealth Pay Links extend Aegis from gift-style delivery into one-click private payment and collection flows. This pillar is aimed at freelancers, OTC flows, treasury routing, and general-purpose private value transfer where a shareable payment URL is more natural than a gift-card envelope.

Planned outcome:

- One-click private payment links built on Umbra-native stealth routing
- Cleaner private collection flows for senders and recipients that do not want their canonical wallets linked on-chain
- A broader payment primitive that positions Aegis as reusable privacy infrastructure

## Pillar 3: Audit Portal

Status: Planned

The Audit Portal is the compliance and dispute-resolution layer of the protocol. Its role is to resolve the typical privacy-versus-compliance tradeoff by making disclosure explicit, permissioned, and auditor-scoped.

Planned outcome:

- Authorized metadata disclosure only for designated auditors
- Contract-backed permissioning through the audit registry
- A path for compliance, dispute resolution, and verifiable review without global wallet exposure

## Strategic Positioning

Aegis Shield is designed to prove that strong privacy and operational accountability can coexist. The protocol is not trying to weaken privacy to make compliance possible. Instead, it makes privacy the default state and introduces a separate, authorized auditor path for the limited cases where disclosure is required.

That is the long-term positioning of Aegis Shield: economic privacy infrastructure for Solana.