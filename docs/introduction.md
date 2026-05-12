# Introduction

Aegis Shield is the economic privacy layer built on top of Umbra-compatible privacy primitives.

## Why Aegis Exists

Cryptography alone is not enough to create trustworthy private finance. If the same actor can cheaply impersonate a sender, receiver, and auditor, the privacy model becomes socially fragile even if the cryptography remains correct.

Aegis addresses that gap by combining:
- Umbra privacy primitives
- application-layer role separation
- capital-backed auditor admission
- revocation, evidence, and reputation

## Privacy Stack

The stack is divided into two layers.

### Umbra Layer

Umbra provides:
- encrypted balances
- receiver-claimable UTXOs
- scoped viewing keys
- compliance grants
- re-encryption for authorized recipients

### Aegis Layer

Aegis provides:
- role definitions
- auditor registry rules
- compliance stake
- incentive-compatible disclosure flows
- case and reputation management

## Design Goal

The design goal is simple:

> Honest behavior should be cheaper, safer, and more profitable than dishonest behavior.

That is the core of economic privacy.
