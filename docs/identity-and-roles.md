# Identity And Roles

Aegis distinguishes roles by capability, not by username.

## Sender

A Sender can:
- create a payment or private transfer
- sign the funding transaction
- use receiver public data only

A Sender must not have:
- receiver private spending keys
- receiver viewing keys
- auditor-only compliance access

## Receiver

A Receiver can:
- discover claimable UTXOs
- decrypt receiver-addressed ciphertexts
- claim funds
- optionally grant scoped disclosure to an auditor

A Receiver must control the private material required for claim and disclosure.

## Auditor

An Auditor can:
- receive scoped disclosure from a receiver
- hold a valid compliance grant
- request authorized re-encryption
- maintain bonded reputation in the Aegis registry

An Auditor must not gain sender or receiver privileges merely by using the app. Any elevated capability must be backed by explicit cryptographic authorization and economic stake.

## Panic Factor

One human may control multiple wallets. Aegis does not assume personhood from a wallet address.

Instead, Aegis separates roles using:
- distinct registered keys
- explicit grant flows
- auditor registry membership
- stake-backed accountability

This does not eliminate collusion. It makes dishonest multi-role behavior more costly and more detectable.
