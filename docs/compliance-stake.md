# Compliance Stake

The compliance stake is the admission bond for auditors in the Aegis network.

## Purpose

The stake exists to make auditor dishonesty economically irrational.

## Requirements

An auditor must register:
- auditor wallet
- auditor X25519 public key
- stake amount
- policy acceptance signature

## Valid Uses

A registered auditor may receive:
- receiver-issued compliance grants
- scoped viewing access
- authorized re-encryption outputs

## Slashable Offenses

Slashable offenses must be objectively provable.

Examples:
- acting through a suspended auditor identity
- requesting audit execution without an active valid grant
- violating signed Aegis policy commitments proven by signed evidence
- confirmed revocation-for-cause in an Aegis dispute process

## Non-Slashable Without Stronger Proof

The following should not be slashable unless externally proven:
- local key derivation attempts
- off-chain curiosity
- suspected same-human control of multiple wallets

## Reputation

Each auditor accumulates a public record:
- active stake
- successful disclosures
- revocations
- slashes
- suspensions

That record becomes the economic reputation layer for Aegis.
