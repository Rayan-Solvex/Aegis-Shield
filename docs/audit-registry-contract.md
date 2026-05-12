# Audit Registry Contract

The Aegis audit-registry contract is the on-chain boundary between ordinary private users and approved auditors.

It exists for one reason: a viewing key should not become an open capability that any Sender or Receiver can self-assign.

## Problem It Solves

Umbra gives Aegis the privacy primitives:
- ZK-protected private transfers
- stealth addressing via ECDH
- viewing keys and selective disclosure

But Umbra alone does not decide who Aegis will recognize as an Auditor.

Without an Aegis-side registry, any wallet could claim to be an auditor at the application layer. That breaks the mechanism design. Sender and Receiver anonymity would still exist on-chain, but the audit role would be socially unenforced and easy to abuse.

## Contract Objective

The prototype contract establishes four on-chain guarantees:

1. Auditor admission is explicit.
Only wallets that stake and are approved by the protocol admin can become Aegis auditors.

2. Viewing grants are explicit.
An audit permission is recorded as a grant from a grantor wallet to an approved auditor wallet.

3. Self-assigned auditor access is blocked.
The contract forbids a wallet from creating a viewing grant to itself.

4. Misbehavior can be punished.
Auditor stake is locked in a vault PDA and can be slashed by the protocol admin.

## Current Instruction Set

The prototype lives in `programs/aegis-audit-registry/src/lib.rs` and exposes these instructions:

- `initialize_protocol`
- `register_auditor`
- `approve_auditor`
- `create_viewing_grant`
- `revoke_viewing_grant`
- `slash_auditor`

## Account Model

The program stores four account types:

- `ProtocolConfig`
- `AuditorProfile`
- `AuditorVault`
- `ViewingGrant`

### ProtocolConfig

Stores:
- protocol admin
- minimum auditor stake
- slash destination wallet

### AuditorProfile

Stores:
- auditor authority
- metadata hash
- locked stake amount
- status: `Pending`, `Approved`, `Suspended`, `Slashed`

### AuditorVault

Stores:
- auditor authority
- PDA bump

It also holds the auditor's locked SOL stake.

### ViewingGrant

Stores:
- grantor wallet
- auditor wallet
- scope type
- scope reference hash
- encrypted TVK reference hash
- creation time
- expiry time
- revocation time

The encrypted TVK itself does not need to live on-chain in plaintext. The contract only needs a verifiable reference anchor for the grant.

## How This Protects The Three Roles

### Sender

The Sender can continue using Umbra gift-card or payment-link flows without becoming an auditor.

The Sender never receives audit capability automatically.

### Receiver

The Receiver can continue receiving through Umbra stealth flows.

The Receiver cannot read someone else's protected history unless the contract records a valid grant to an approved auditor wallet.

### Auditor

The Auditor must:
- register
- lock stake
- be approved
- receive a viewing grant from a user

This makes Auditor a distinct on-chain role rather than a UI label.

## Why Pillars 1 And 2 Can Keep Moving

Pillars 1 and 2 do not need to stop while this contract is being developed.

They can continue to use Umbra's privacy rails for:
- private gift-card issuance and redemption
- stealth payment links
- receiver-claimable UTXOs
- ZK proof-based claim and withdrawal

The contract sits beside those flows and governs who Aegis recognizes as an Auditor.

That means frontend work can continue with `npm run dev` while the audit boundary is hardened in parallel.

## Current Scope Limits

This is a prototype foundation, not the final compliance product.

It does not yet include:
- DAO or multisig governance for approvals
- decentralized dispute resolution
- cryptographic proof that an uploaded TVK belongs to a specific Umbra MVK tree
- automatic revocation propagation to off-chain storage
- reputation scoring
- frontend transaction builders for the registry

## Recommended Next Step

Integrate the Audit Portal with this registry before exposing any auditor-facing decryption flow.

The frontend rule should become:

`No approved registry entry + no valid viewing grant = no auditor access flow.`