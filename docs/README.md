# Aegis Shield

Aegis Shield is an economic privacy protocol for Solana.

This documentation is the GitBook-ready source for the public Aegis Shield architecture docs. It defines how Aegis separates Sender, Receiver, and Auditor capabilities; how Umbra privacy and disclosure grants are used; and how economic incentives secure honest auditing.

The current repository also includes a Solana audit-registry contract and a live frontend prototype that turn those role boundaries into a Devnet testable system.

## What is Aegis Shield?

Aegis Shield extends cryptographic privacy with mechanism design.

Umbra provides the underlying privacy primitives:
- unlinkable transfers
- encrypted balances
- receiver-claimable UTXOs
- scoped viewing keys
- compliance grants and re-encryption

Aegis adds the application-layer rules:
- role separation by capability
- auditor admission controls
- compliance stake requirements
- revocation and slashing policies
- reputation and on-chain credibility

## Core Principles

1. Privacy by default
A sender should not learn receiver identity, balances, or viewing capability.

2. Selective disclosure by user consent
An auditor only receives scoped access authorized by the user.

3. Economic security
Auditors must have capital at risk. Misbehavior must be more expensive than honest operation.

4. Capability-based roles
Aegis does not assume one human equals one role. It separates Sender, Receiver, and Auditor by cryptographic material and registry permissions.

## Documentation Map

- [Introduction](introduction.md)
- [Identity And Roles](identity-and-roles.md)
- [Economic Privacy](economic-privacy.md)
- [Compliance Stake](compliance-stake.md)
- [Audit Registry Contract](audit-registry-contract.md)

## Current Build Status

The current app contains:
- private gift cards
- stealth payment links
- an audit portal
- an audit-registry smart contract
- GitBook-ready documentation source

The official published docs live at <https://aegis-shield.gitbook.io/aegis-shield-docs/>.
