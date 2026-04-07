---
name: xrpl-up
description: Command-line interface for the XRP Ledger — send transactions, manage wallets, query accounts, and interact with AMM/NFT/DeFi features without writing scripts
---

## How to use this skill

The user has made a natural language request: **$ARGUMENTS**

Your job is to translate it into one or more `xrpl-up` CLI commands using the reference below, then execute them.

Steps:
1. Identify the intent (e.g. send payment, check balance, create offer, mint NFT).
2. Select the matching command and flags from this reference.
3. If required information is missing (e.g. destination address, amount, seed), ask the user before proceeding.
4. Construct the full CLI invocation and run it via Bash.
5. Explain the result to the user in plain language.

If `$ARGUMENTS` is empty, ask the user what they'd like to do on the XRP Ledger.

---

## Installation

**Requirements:** Node.js 22 or higher.

```bash
# Global install (recommended)
npm install -g xrpl-up

# Zero-install alternative (no global install required)
npx xrpl-up <command>
```

Smoke-test after install:

```bash
xrpl-up --version
```

## Security Rules for Agents

> **These rules are mandatory. Never bypass them.**

1. **Never log, echo, or store `--seed` / `--private-key` values.** Treat them as ephemeral secrets that must not appear in stdout, stderr, log files, or shell history.
2. **Prefer `--keystore <path> --password <pass>` over raw `--seed` in automated pipelines.** Keystores encrypt the private key at rest; raw seeds do not.
3. **Never commit seed values to version control.** If a seed appears in a file that is tracked by git, rotate it immediately.
4. **Rotate any seed that appears in shell history or logs.** Run `history -c` or equivalent, then generate a new wallet with `xrpl-up wallet new`.
5. **`wallet private-key` output must be treated as a secret.** Do not forward it to downstream tools, store it in environment variables, or include it in CI/CD output.

## Global Options

These options apply to every command:

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--node <url\|mainnet\|testnet\|devnet>` | string | `testnet` | XRPL node WebSocket URL or named network shorthand |
| `--version` | — | — | Print the installed version and exit |
| `--help` | — | — | Show help for the command or subcommand and exit |

Named network shorthands:
- `mainnet` → `wss://xrplcluster.com`
- `testnet` → `wss://s.altnet.rippletest.net:51233`
- `devnet` → `wss://s.devnet.rippletest.net:51233`

### When to use each network

| Scenario | Use |
|----------|-----|
| Learning, experimenting, running tests | `testnet` (default) — free faucet funds, no real value at risk |
| Testing features only on devnet (e.g. Vault, MPT early amendments) | `devnet` — bleeding-edge amendments enabled before testnet |
| Real transactions with real XRP | `mainnet` — irreversible; double-check all parameters |
| Private or enterprise XRPL node | `--node wss://your-node.example.com:51233` — pass the full WebSocket URL |

> **Rule:** Never pass `--node mainnet` in automated agent pipelines unless the intent is explicitly to spend real XRP. Default to `testnet` for all experiments and CI runs.

**Custom endpoint example:**

```bash
xrpl-up --node wss://xrpl.example.com:51233 account balance rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh
```

**Example — query balance on testnet:**

```bash
xrpl-up --node testnet account balance rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh
```

## Common Signing Flags

Every command that submits a transaction supports these flags (omitted from individual tables below for brevity):

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--seed <seed>` | string | — | Family seed for signing (`sXXX...`) |
| `--mnemonic <phrase>` | string | — | BIP39 mnemonic for signing |
| `--account <address-or-alias>` | string | — | Account address or alias to load from keystore |
| `--password <password>` | string | — | Keystore decryption password (insecure; prefer interactive prompt) |
| `--keystore <dir>` | string | `~/.xrpl/keystore/` | Keystore directory (env: `XRPL_KEYSTORE`) |
| `--no-wait` | boolean | false | Submit without waiting for validation |
| `--json` | boolean | false | Output result as JSON |
| `--dry-run` | boolean | false | Print signed tx without submitting |

### Storing the keystore password for agent pipelines

In automated agent workflows the CLI cannot prompt interactively. The recommended approach is to store the password in a file with restricted permissions and pipe it via the `XRPL_PASSWORD` environment variable or a file read:

**Option 1 — environment variable (recommended for CI/agents):**

```bash
# Store once (chmod 600 so only your user can read it)
echo 'my-keystore-password' > ~/.xrpl/keystore.pwd
chmod 600 ~/.xrpl/keystore.pwd

# Export before running the agent session
export XRPL_PASSWORD=$(cat ~/.xrpl/keystore.pwd)

# Pass to CLI via --password
xrpl-up --node testnet payment \
  --account rSenderXXX \
  --destination rReceiverXXX \
  --amount 10 \
  --password "$XRPL_PASSWORD"
```

**Option 2 — inline pipe (one-off commands):**

```bash
xrpl-up --node testnet payment \
  --account rSenderXXX \
  --destination rReceiverXXX \
  --amount 10 \
  --password "$(cat ~/.xrpl/keystore.pwd)"
```

> **Security note:** Never hard-code the password string in a script file or agent prompt. Always read it from a `chmod 600` file or a secrets manager (e.g. `op read op://vault/item/password` for 1Password). The `--password` flag value is visible to all processes on the host via `ps aux` — keep the value short-lived and avoid logging the full command line.

## wallet

Manage XRPL wallets: create, import, sign, verify, and maintain an encrypted local keystore.

### wallet new

Generate a new random XRPL wallet.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--save` | boolean | No | false | Encrypt and save the wallet to the keystore |
| `--show-secret` | boolean | No | false | Show the seed and private key (hidden by default) |
| `--alias <name>` | string | No | — | Human-readable alias when saving to keystore |

```bash
xrpl-up wallet new --key-type ed25519 --save --alias alice
```

### wallet new-mnemonic

Generate a new BIP39 mnemonic wallet.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--save` | boolean | No | false | Encrypt and save the wallet to the keystore |
| `--show-secret` | boolean | No | false | Show the mnemonic and private key (hidden by default) |
| `--alias <name>` | string | No | — | Human-readable alias when saving to keystore |

```bash
xrpl-up wallet new-mnemonic --save --alias alice-mnemonic
```

### wallet import

Import key material (seed, mnemonic, or private key) into the encrypted keystore.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--key-type <type>` | string | No | — | Key algorithm (required for unprefixed hex private keys) |
| `--alias <name>` | string | No | — | Human-readable alias for this wallet |
| `--force` | boolean | No | false | Overwrite existing keystore entry |

```bash
xrpl-up wallet import sEd... --alias bob
```

### wallet list

List accounts stored in the keystore.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|

```bash
xrpl-up wallet list --json
```

### wallet address

Derive the XRPL address from key material.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--seed <seed>` | string | No | — | Family seed (`sXXX...`) |
| `--private-key <hex>` | string | No | — | Raw private key hex (ED- or 00-prefixed) |
| `--key-type <type>` | string | No | — | Key algorithm (required for unprefixed hex private keys) |

```bash
xrpl-up wallet address --seed sEd...
```

### wallet public-key

Derive the public key from key material.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--seed <seed>` | string | No | — | Family seed (`sXXX...`) |
| `--private-key <hex>` | string | No | — | Raw private key hex |

```bash
xrpl-up wallet public-key --seed sEd...
```

### wallet private-key

> **Secret output — see Security Rules.** Do not forward this output to other tools.

Derive the private key from a seed or mnemonic.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--seed <seed>` | string | No | — | Family seed (`sXXX...`) |

```bash
xrpl-up wallet private-key --seed sEd...
```

### wallet sign

Sign a UTF-8 message or an XRPL transaction blob.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--message <string>` | string | No | — | UTF-8 message to sign |
| `--from-hex` | boolean | No | false | Treat `--message` as hex-encoded |
| `--tx <json-or-path>` | string | No | — | Transaction JSON (inline or file path) to sign |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up wallet sign --message "hello xrpl" --seed sEd...
```

### wallet verify

Verify a message signature or a signed transaction blob.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--message <msg>` | string | No | — | Message to verify (UTF-8 or hex if `--from-hex`) |
| `--from-hex` | boolean | No | false | Treat `--message` as hex-encoded |
| `--signature <hex>` | string | No | — | Signature hex (used with `--message`) |
| `--public-key <hex>` | string | No | — | Signer public key hex (used with `--message`) |
| `--tx <tx_blob_hex>` | string | No | — | Signed transaction blob hex to verify |

```bash
xrpl-up wallet verify --message "hello xrpl" --signature <hex> --public-key <hex>
```

### wallet fund

Fund an address from the testnet or devnet faucet.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|

```bash
xrpl-up wallet fund rXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### wallet alias

Manage human-readable aliases for keystore entries.

**wallet alias set** — Assign an alias to a keystore address.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--force` | boolean | No | false | Overwrite existing alias |

```bash
xrpl-up wallet alias set rXXX... alice
```

**wallet alias list** — List all aliases.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|

```bash
xrpl-up wallet alias list
```

**wallet alias remove** — Remove the alias for an address.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|

```bash
xrpl-up wallet alias remove rXXX...
```

### wallet change-password

Re-encrypt a keystore entry with a new password.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--password <current>` | string | No | — | Current password (insecure; prefer interactive prompt) |
| `--new-password <new>` | string | No | — | New password (insecure; prefer interactive prompt) |

```bash
xrpl-up wallet change-password rXXX...
```

### wallet decrypt-keystore

Decrypt a keystore file to retrieve the seed or private key.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--file <path>` | string | No | — | Explicit keystore file path (overrides address lookup) |
| `--show-private-key` | boolean | No | false | Also print the private key hex |

```bash
xrpl-up wallet decrypt-keystore rXXX... --show-private-key
```

### wallet remove

Remove a wallet from the keystore.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|

```bash
xrpl-up wallet remove rXXX...
```

### Example flow: Alice creates a wallet, saves it to the keystore, funds it, and signs a message

```bash
# 1. Generate a new ed25519 wallet for Alice and save it to the keystore
xrpl-up wallet new --key-type ed25519 --save --alias alice
# → Address: rAliceXXXX...  (note this address)

# 2. Fund Alice's account from the testnet faucet
xrpl-up --node testnet wallet fund rAliceXXXX...

# 3. Import Bob's existing seed into the keystore under an alias
xrpl-up wallet import sEdBobSeedXXXXXXXXXXXXXXXXXXXX --alias bob

# 4. List all keystore entries to confirm both wallets are saved
xrpl-up wallet list

# 5. Sign a message as Alice — plain output is the raw hex signature
SIG=$(xrpl-up wallet sign --message "I am Alice" --seed sEdAliceXXXX...)
# → 8BD9A15AFC7F22BC2...

# 6. Get Alice's public key (use --json for clean single-value extraction)
PUBKEY=$(xrpl-up wallet public-key --seed sEdAliceXXXX... --json | python3 -c "import sys,json; print(json.load(sys.stdin)['publicKey'])")

# 7. Verify the signature (anyone can do this without secrets)
xrpl-up wallet verify \
  --message "I am Alice" \
  --signature "$SIG" \
  --public-key "$PUBKEY"
# → ✓ Valid signature

# 8. Derive Alice's address from her seed alone
xrpl-up wallet address --seed sEdAliceXXXX...
```

## account

Query and configure XRPL accounts: balances, settings, trust lines, offers, channels, transactions, NFTs, and MPTs.

### account info

Get full on-ledger account information (balance, sequence, owner count, flags, reserve).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|

```bash
xrpl-up account info rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh
```

### account balance

Get the XRP balance of an account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--drops` | boolean | No | false | Output raw drops as a plain integer string |

```bash
xrpl-up account balance rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh
```

### account set

Update account settings with an AccountSet transaction.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--seed <seed>` | string | No* | — | Family seed for signing |
| `--domain <utf8-string>` | string | No | — | Domain to set (auto hex-encoded) |
| `--email-hash <32-byte-hex>` | string | No | — | Email hash (32-byte hex) |
| `--transfer-rate <integer>` | string | No | — | Transfer rate (0 or 1000000000–2000000000) |
| `--tick-size <n>` | string | No | — | Tick size (0 or 3–15) |
| `--set-flag <name>` | string | No | — | Account flag to set: `requireDestTag\|requireAuth\|disallowXRP\|disableMaster\|noFreeze\|globalFreeze\|defaultRipple\|depositAuth` |
| `--clear-flag <name>` | string | No | — | Account flag to clear (same names as `--set-flag`) |
| `--allow-clawback` | boolean | No | false | Enable clawback (irreversible — requires `--confirm`) |
| `--confirm` | boolean | No | false | Acknowledge irreversible operations |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl-up account set --seed sEd... --set-flag defaultRipple
```

### account delete

> **Warning:** Permanently removes the account from the ledger; requires destination and fee reserve. This operation is irreversible and costs ~2 XRP (owner reserve, non-refundable).

Submit an AccountDelete transaction to delete an account and send remaining XRP to a destination.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--destination <address-or-alias>` | string | Yes | — | Destination address or alias to receive remaining XRP |
| `--destination-tag <n>` | string | No | — | Destination tag for the destination account |
| `--seed <seed>` | string | No* | — | Family seed for signing |
| `--confirm` | boolean | No | false | Acknowledge permanent account deletion (required unless `--dry-run`) |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl-up account delete --seed sEd... --destination rXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX --confirm
```

### account set-regular-key

Assign or remove the regular signing key on an account (SetRegularKey).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--key <address>` | string | No† | — | Base58 address of the new regular key to assign |
| `--remove` | boolean | No† | false | Remove the existing regular key |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.
† Exactly one of `--key` or `--remove` is required; they are mutually exclusive.

```bash
xrpl-up account set-regular-key --seed sEd... --key rRegularKeyAddress...
```

### account trust-lines

List trust lines for an account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--peer <address>` | string | No | — | Filter to trust lines with a specific peer |
| `--limit <n>` | string | No | — | Number of trust lines to return |
| `--marker <json-string>` | string | No | — | Pagination marker from a previous `--json` response |

```bash
xrpl-up account trust-lines rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh
```

### account offers

List open DEX offers for an account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--limit <n>` | string | No | — | Number of offers to return |
| `--marker <json-string>` | string | No | — | Pagination marker from a previous `--json` response |

```bash
xrpl-up account offers rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh
```

### account channels

List payment channels for an account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--destination-account <address>` | string | No | — | Filter by destination account |
| `--limit <n>` | string | No | — | Number of channels to return |
| `--marker <json-string>` | string | No | — | Pagination marker from a previous `--json` response |

```bash
xrpl-up account channels rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh
```

### account transactions

List recent transactions for an account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--limit <n>` | string | No | `20` | Number of transactions to return (max 400) |
| `--marker <json-string>` | string | No | — | Pagination marker from a previous `--json` response |

```bash
xrpl-up account transactions rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh --limit 10
```

### account nfts

List NFTs owned by an account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--limit <n>` | string | No | — | Number of NFTs to return |
| `--marker <json-string>` | string | No | — | Pagination marker from a previous `--json` response |

```bash
xrpl-up account nfts rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh
```

### account mptokens

List Multi-Purpose Tokens (MPT) held by an account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--limit <n>` | string | No | `20` | Number of tokens to return |
| `--marker <json-string>` | string | No | — | Pagination marker from a previous `--json` response |

```bash
xrpl-up account mptokens rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh
```

### Example flow: Query Alice's account, set flags, assign a regular key, inspect holdings

```bash
# 1. Check Alice's full account info and XRP balance
xrpl-up --node testnet account info rAliceXXXX...
xrpl-up --node testnet account balance rAliceXXXX...

# 2. Set Alice's domain (auto hex-encoded) and enable RequireDestTag
xrpl-up --node testnet account set \
  --domain "alice.example.com" \
  --set-flag requireDestTag \
  --seed sEdAliceXXXX...

# 3. Assign a separate regular key so the master key can stay cold
xrpl-up --node testnet account set-regular-key \
  --key rRegularKeyXXXX... --seed sEdAliceXXXX...

# 4. Inspect Alice's trust lines, open DEX offers, and recent transactions
xrpl-up --node testnet account trust-lines rAliceXXXX...
xrpl-up --node testnet account offers rAliceXXXX...
xrpl-up --node testnet account transactions rAliceXXXX... --limit 5

# 5. List NFTs and MPT balances on Alice's account
xrpl-up --node testnet account nfts rAliceXXXX...
xrpl-up --node testnet account mptokens rAliceXXXX...
```

## payment

Alias: `send`. Send a Payment transaction on the XRP Ledger.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--to <address-or-alias>` | string | Yes | — | Destination address or alias |
| `--amount <amount>` | string | Yes | — | Amount to send: `1.5` for XRP, `10/USD/rIssuer` for IOU, `100/<48-hex>` for MPT |
| `--seed <seed>` | string | No* | — | Family seed for signing |
| `--destination-tag <n>` | string | No | — | Destination tag (unsigned 32-bit integer) |
| `--memo <text>` | string | No | — | Memo text to attach (repeatable) |
| `--memo-type <hex>` | string | No | — | MemoType hex for the last memo |
| `--memo-format <hex>` | string | No | — | MemoFormat hex for the last memo |
| `--send-max <amount>` | string | No | — | SendMax field; supports XRP, IOU, and MPT amounts |
| `--deliver-min <amount>` | string | No | — | DeliverMin field; sets `tfPartialPayment` automatically |
| `--paths <json-or-file>` | string | No | — | Payment paths as JSON array or path to a `.json` file |
| `--partial` | boolean | No | false | Set `tfPartialPayment` flag |
| `--no-ripple-direct` | boolean | No | false | Set `tfNoRippleDirect` flag |
| `--limit-quality` | boolean | No | false | Set `tfLimitQuality` flag |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl-up payment --to rDestination... --amount 1.5 --seed sEd...
```

### Example flow: Alice sends XRP to Bob, then Bob receives USD IOU, then Alice sends MPT to Bob

```bash
# 1. Alice sends 10 XRP to Bob
xrpl-up --node testnet payment \
  --to rBobXXXX... --amount 10 \
  --seed sEdAliceXXXX...

# 2. Bob sets up a USD trust line, then Alice (as issuer) sends 100 USD to Bob
xrpl-up --node testnet trust set \
  --currency USD --issuer rAliceXXXX... --limit 1000 \
  --seed sEdBobXXXX...
xrpl-up --node testnet payment \
  --to rBobXXXX... --amount 100/USD/rAliceXXXX... \
  --seed sEdAliceXXXX...

# 3. Alice creates an MPToken issuance with can-transfer flag
xrpl-up --node testnet mptoken issuance create \
  --flags can-transfer --max-amount 1000000 \
  --seed sEdAliceXXXX... --json
# → {"issuanceId":"0000001AABBCC..."}

# 4. Bob opts into the MPT issuance
xrpl-up --node testnet mptoken authorize 0000001AABBCC... \
  --seed sEdBobXXXX...

# 5. Alice sends 500 MPT units to Bob
xrpl-up --node testnet payment \
  --to rBobXXXX... --amount 500/0000001AABBCC... \
  --seed sEdAliceXXXX...
```

## trust

Manage XRPL trust lines.

### trust set

Create or update a trust line (TrustSet transaction). Setting `--limit 0` effectively removes the trust line.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--currency <code>` | string | Yes | — | Currency code (3-char ASCII or 40-char hex) |
| `--issuer <address-or-alias>` | string | Yes | — | Issuer address or alias |
| `--limit <value>` | string | Yes | — | Trust line limit (`0` removes the trust line) |
| `--seed <seed>` | string | No* | — | Family seed for signing |
| `--no-ripple` | boolean | No | false | Set `NoRipple` flag on the trust line |
| `--clear-no-ripple` | boolean | No | false | Clear `NoRipple` flag on the trust line |
| `--freeze` | boolean | No | false | Freeze the trust line |
| `--unfreeze` | boolean | No | false | Unfreeze the trust line |
| `--auth` | boolean | No | false | Authorize the trust line |
| `--quality-in <n>` | string | No | — | Set `QualityIn` (unsigned integer) |
| `--quality-out <n>` | string | No | — | Set `QualityOut` (unsigned integer) |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.
`--no-ripple` and `--clear-no-ripple` are mutually exclusive. `--freeze` and `--unfreeze` are mutually exclusive.

```bash
xrpl-up trust set --currency USD --issuer rIssuer... --limit 1000 --seed sEd...
```

### trust delete

Remove a trust line by setting its limit to zero.

```bash
xrpl-up trust set --currency USD --issuer rIssuer... --limit 0 --seed sEd...
```

### Example flow: Alice enables DefaultRipple, Bob creates a trust line, Alice issues USD to Bob

```bash
# 1. Alice (the IOU issuer) enables DefaultRipple so her tokens can ripple between holders
xrpl-up --node testnet account set \
  --set-flag defaultRipple --seed sEdAliceXXXX...

# 2. Bob creates a USD trust line to Alice with a limit of 10,000
xrpl-up --node testnet trust set \
  --currency USD --issuer rAliceXXXX... --limit 10000 \
  --seed sEdBobXXXX...

# 3. Alice sends 500 USD to Bob (direct issuance — no SendMax needed)
xrpl-up --node testnet payment \
  --to rBobXXXX... --amount 500/USD/rAliceXXXX... \
  --seed sEdAliceXXXX...

# 4. Verify Bob's trust lines
xrpl-up --node testnet account trust-lines rBobXXXX...

# 5. Bob removes the trust line after the balance reaches zero
xrpl-up --node testnet trust set \
  --currency USD --issuer rAliceXXXX... --limit 0 \
  --seed sEdBobXXXX...
```

## offer

Manage DEX offers on the XRP Ledger.

### offer create

Create a DEX offer (OfferCreate transaction).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--taker-pays <amount>` | string | Yes | — | Amount the taker pays (e.g. `1.5` for XRP, `10/USD/rIssuer` for IOU) |
| `--taker-gets <amount>` | string | Yes | — | Amount the taker gets (e.g. `1.5` for XRP, `10/USD/rIssuer` for IOU) |
| `--seed <seed>` | string | No* | — | Family seed for signing |
| `--sell` | boolean | No | false | Set `tfSell` flag |
| `--passive` | boolean | No | false | Set `tfPassive` flag (do not consume matching offers) |
| `--immediate-or-cancel` | boolean | No | false | Set `tfImmediateOrCancel` flag |
| `--fill-or-kill` | boolean | No | false | Set `tfFillOrKill` flag |
| `--expiration <iso>` | string | No | — | Offer expiration as ISO 8601 string (e.g. `2030-01-01T00:00:00Z`) |
| `--replace <sequence>` | string | No | — | Cancel offer with this sequence and replace it atomically |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.
`--immediate-or-cancel` and `--fill-or-kill` are mutually exclusive.

```bash
xrpl-up offer create --taker-pays 10/USD/rIssuer... --taker-gets 1.5 --seed sEd...
```

### offer cancel

Cancel an existing DEX offer (OfferCancel transaction).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--sequence <n>` | string | Yes | — | Sequence number of the offer to cancel |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl-up offer cancel --sequence 12 --seed sEd...
```

### Example flow: Alice places a USD sell offer, Bob's matching offer fills it; Alice cancels a leftover offer

```bash
# Prerequisite: Alice holds USD from rIssuerXXX... and Bob has a USD trust line

# 1. Alice creates a sell offer: she pays 10 USD to get 5 XRP
#    --json output has "offerSequence" — the value needed for offer cancel
xrpl-up --node testnet offer create \
  --taker-pays 5 \
  --taker-gets 10/USD/rIssuerXXX... \
  --sell \
  --seed sEdAliceXXXX... --json
# → {"hash":"...","result":"tesSUCCESS","offerSequence":16331330}

# 2. Bob creates a matching buy offer: he pays 10 USD to get 5 XRP (crosses Alice's offer)
xrpl-up --node testnet offer create \
  --taker-pays 10/USD/rIssuerXXX... \
  --taker-gets 5 \
  --seed sEdBobXXXX...

# 3. Verify Alice's remaining open offers (should be empty if fully filled)
xrpl-up --node testnet account offers rAliceXXXX...

# 4. If Alice's offer was only partially filled, cancel using "offerSequence" from step 1
xrpl-up --node testnet offer cancel \
  --sequence 16331330 --seed sEdAliceXXXX...
```

## clawback

Claw back issued tokens (IOU or MPT) from a holder account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--amount <amount>` | string | Yes | — | For IOU: `value/CURRENCY/holder-address`; for MPT: `value/MPT_ISSUANCE_ID` |
| `--holder <address>` | string | No† | — | Holder address to claw back from (required for MPT mode only) |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.
† `--holder` is required when `--amount` is an MPT amount; must be omitted for IOU amounts.

```bash
# IOU clawback
xrpl-up clawback --amount 50/USD/rHolder... --seed sEd...

# MPT clawback
xrpl-up clawback --amount 100/0000000000000000000000000000000000000001 --holder rHolder... --seed sEd...
```

### Example flow: Alice enables clawback, issues USD to Bob, then claws back 50 USD

```bash
# 1. Alice enables AllowTrustLineClawback on her account (irreversible)
xrpl-up --node testnet account set \
  --allow-clawback --confirm --seed sEdAliceXXXX...

# 2. Bob creates a USD trust line to Alice
xrpl-up --node testnet trust set \
  --currency USD --issuer rAliceXXXX... --limit 1000 \
  --seed sEdBobXXXX...

# 3. Alice issues 100 USD to Bob
xrpl-up --node testnet payment \
  --to rBobXXXX... --amount 100/USD/rAliceXXXX... \
  --seed sEdAliceXXXX...

# 4. Alice claws back 50 USD from Bob (IOU clawback)
xrpl-up --node testnet clawback \
  --amount 50/USD/rBobXXXX... \
  --seed sEdAliceXXXX...

# --- MPT clawback variant ---
# 5. Alice creates an MPT issuance with can-clawback flag
xrpl-up --node testnet mptoken issuance create \
  --flags can-transfer,can-clawback \
  --seed sEdAliceXXXX... --json
# → {"issuanceId":"0000002CCDDEE..."}

# 6. Bob opts in and Alice sends 500 MPT units
xrpl-up --node testnet mptoken authorize 0000002CCDDEE... --seed sEdBobXXXX...
xrpl-up --node testnet payment \
  --to rBobXXXX... --amount 500/0000002CCDDEE... --seed sEdAliceXXXX...

# 7. Alice claws back 200 MPT units from Bob
xrpl-up --node testnet clawback \
  --amount 200/0000002CCDDEE... --holder rBobXXXX... \
  --seed sEdAliceXXXX...
```

## channel

Manage XRPL payment channels: open, fund, sign off-chain claims, verify claims, redeem claims, and list channels.

### channel create

Open a new payment channel (PaymentChannelCreate transaction).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--to <address-or-alias>` | string | Yes | — | Destination address or alias |
| `--amount <xrp>` | string | Yes | — | XRP to lock in the channel (decimal, e.g. `10`) |
| `--settle-delay <seconds>` | string | Yes | — | Seconds the source must wait before closing with unclaimed funds |
| `--public-key <hex>` | string | No | derived | 33-byte public key hex (derived from key material if omitted) |
| `--cancel-after <iso8601>` | string | No | — | Hard expiry in ISO 8601 format |
| `--destination-tag <n>` | string | No | — | Destination tag (unsigned 32-bit integer) |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl-up channel create --to rDestination... --amount 10 --settle-delay 86400 --seed sEd...
```

### channel fund

Add XRP to an existing payment channel (PaymentChannelFund transaction).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--channel <hex>` | string | Yes | — | 64-character payment channel ID |
| `--amount <xrp>` | string | Yes | — | XRP to add (decimal, e.g. `5`) |
| `--expiration <iso8601>` | string | No | — | New soft expiry in ISO 8601 format |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl-up channel fund --channel <64-hex-id> --amount 5 --seed sEd...
```

### channel sign

Sign an off-chain payment channel claim (offline — no network call).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--channel <hex>` | string | Yes | — | 64-character payment channel ID |
| `--amount <xrp>` | string | Yes | — | XRP amount to authorize (decimal, e.g. `5`) |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl-up channel sign --channel <64-hex-id> --amount 5 --seed sEd...
```

### channel verify

Verify an off-chain payment channel claim signature (offline — no network call).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--channel <hex>` | string | Yes | — | 64-character payment channel ID |
| `--amount <xrp>` | string | Yes | — | Amount in the claim (decimal) |
| `--signature <hex>` | string | Yes | — | Hex-encoded claim signature |
| `--public-key <hex>` | string | Yes | — | Hex-encoded public key of the signer |

```bash
xrpl-up channel verify --channel <64-hex-id> --amount 5 --signature <hex> --public-key <hex>
```

### channel claim

Redeem a signed payment channel claim or request channel closure (PaymentChannelClaim transaction).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--channel <hex>` | string | Yes | — | 64-character payment channel ID |
| `--amount <xrp>` | string | No | — | XRP amount authorized by the signature |
| `--balance <xrp>` | string | No | — | Total XRP delivered by this claim |
| `--signature <hex>` | string | No | — | Hex-encoded claim signature (requires `--amount`, `--balance`, `--public-key`) |
| `--public-key <hex>` | string | No | — | Hex-encoded public key of the channel source |
| `--close` | boolean | No | false | Request channel closure (`tfClose` flag) |
| `--renew` | boolean | No | false | Clear channel expiration (`tfRenew` flag, source account only) |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl-up channel claim --channel <64-hex-id> --amount 5 --balance 5 --signature <hex> --public-key <hex> --seed sEd...
```

### channel list

List open payment channels for an account (read-only, no key material needed).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--destination <address>` | string | No | — | Filter channels by destination account |

```bash
xrpl-up channel list rSource...
```

### Example flow: Alice opens a payment channel to Bob, signs off-chain claims, Bob redeems the final claim

```bash
# 1. Alice opens a payment channel locking 10 XRP, with a 24 h settle delay
xrpl-up --node testnet channel create \
  --to rBobXXXX... --amount 10 --settle-delay 86400 \
  --seed sEdAliceXXXX... --json
# → {"channelId":"AABBCC...64chars","result":"tesSUCCESS"}

# 2. Get Alice's public key (needed for verify and claim steps)
ALICE_PUBKEY=$(xrpl-up wallet public-key --seed sEdAliceXXXX... --json | python3 -c "import sys,json; print(json.load(sys.stdin)['publicKey'])")

# 3. Alice signs an off-chain claim for 3 XRP (no network call — instant)
#    plain output is the raw hex signature
SIG=$(xrpl-up channel sign --channel AABBCC...64chars --amount 3 --seed sEdAliceXXXX...)

# 4. Bob verifies the claim signature before accepting payment
xrpl-up channel verify \
  --channel AABBCC...64chars --amount 3 \
  --signature "$SIG" --public-key "$ALICE_PUBKEY"
# → valid

# 5. Alice signs a larger claim for 7 XRP later (accumulated total)
SIG2=$(xrpl-up channel sign --channel AABBCC...64chars --amount 7 --seed sEdAliceXXXX...)

# 6. Bob redeems the final 7 XRP claim on-chain (submits once, not once per payment)
xrpl-up --node testnet channel claim \
  --channel AABBCC...64chars \
  --amount 7 --balance 7 \
  --signature "$SIG2" --public-key "$ALICE_PUBKEY" \
  --seed sEdBobXXXX...

# 6. Alice tops up the channel with 5 more XRP
xrpl-up --node testnet channel fund \
  --channel AABBCC...64chars --amount 5 \
  --seed sEdAliceXXXX...

# 7. Alice requests channel closure (funds return after settle delay)
xrpl-up --node testnet channel claim \
  --channel AABBCC...64chars --close \
  --seed sEdAliceXXXX...

# 8. List all open channels for Alice
xrpl-up --node testnet channel list rAliceXXXX...
```

## escrow

Manage XRPL escrows: create time-locked or crypto-condition escrows, release funds, cancel expired escrows, and list pending escrows.

### escrow create

Create an escrow on the XRP Ledger (EscrowCreate transaction). At least one of `--finish-after`, `--cancel-after`, or `--condition` is required.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--to <address>` | string | Yes | — | Destination address for escrowed funds |
| `--amount <xrp>` | string | Yes | — | Amount to escrow in XRP (decimal, e.g. `10`) |
| `--finish-after <iso>` | string | No† | — | Time after which funds can be released (ISO 8601) |
| `--cancel-after <iso>` | string | No† | — | Expiration; escrow can be cancelled after this (ISO 8601) |
| `--condition <hex>` | string | No† | — | PREIMAGE-SHA-256 crypto-condition hex blob |
| `--destination-tag <n>` | string | No | — | Destination tag (unsigned 32-bit integer) |
| `--source-tag <n>` | string | No | — | Source tag (unsigned 32-bit integer) |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.
† At least one of `--finish-after`, `--cancel-after`, or `--condition` must be provided.

```bash
xrpl-up escrow create --to rDestination... --amount 10 --finish-after 2030-01-01T00:00:00Z --seed sEd...
```

### escrow finish

Release funds from an escrow (EscrowFinish transaction).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--owner <address>` | string | Yes | — | Address of the account that created the escrow |
| `--sequence <n>` | string | Yes | — | Sequence number of the EscrowCreate transaction |
| `--condition <hex>` | string | No‡ | — | PREIMAGE-SHA-256 condition hex blob |
| `--fulfillment <hex>` | string | No‡ | — | Matching crypto-condition fulfillment hex blob |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.
‡ `--condition` and `--fulfillment` must be provided together (or both omitted).

```bash
xrpl-up escrow finish --owner rCreator... --sequence 12 --seed sEd...
```

### escrow cancel

Cancel an expired escrow and return funds to the owner (EscrowCancel transaction).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--owner <address>` | string | Yes | — | Address of the account that created the escrow |
| `--sequence <n>` | string | Yes | — | Sequence number of the EscrowCreate transaction |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl-up escrow cancel --owner rCreator... --sequence 12 --seed sEd...
```

### escrow list

List pending escrows for an account (read-only, no key material needed).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|

```bash
xrpl-up escrow list rAccount...
```

### Example flow: Alice creates a time-based escrow for Bob, Bob releases it; crypto-condition variant included

```bash
# 1. Alice locks 5 XRP in an escrow for Bob, releasable after 5 minutes, expires in 1 hour
xrpl-up --node testnet escrow create \
  --to rBobXXXX... --amount 5 \
  --finish-after 2030-06-01T00:05:00Z \
  --cancel-after 2030-06-01T01:00:00Z \
  --seed sEdAliceXXXX... --json
# → {"sequence":17,"result":"tesSUCCESS"}

# 2. List Alice's pending escrows to confirm
xrpl-up --node testnet escrow list rAliceXXXX...

# 3. After the finish-after time passes, Bob (or anyone) finishes the escrow
xrpl-up --node testnet escrow finish \
  --owner rAliceXXXX... --sequence 17 \
  --seed sEdBobXXXX...

# 4. If the escrow expires (after cancel-after), Alice cancels it to reclaim the XRP
xrpl-up --node testnet escrow cancel \
  --owner rAliceXXXX... --sequence 17 \
  --seed sEdAliceXXXX...

# --- Crypto-condition variant ---
# 5. Alice creates a condition-locked escrow (preimage required to release)
xrpl-up --node testnet escrow create \
  --to rBobXXXX... --amount 10 \
  --condition A025802066687AADF862BD776C8FC18B8E9F8E20089714856EE233B3902A591D0D5F2925810120 \
  --cancel-after 2030-12-31T00:00:00Z \
  --seed sEdAliceXXXX...

# 6. Bob (who knows the preimage) finishes the condition escrow
xrpl-up --node testnet escrow finish \
  --owner rAliceXXXX... --sequence 18 \
  --condition A025802066687AADF862BD776C8FC18B8E9F8E20089714856EE233B3902A591D0D5F2925810120 \
  --fulfillment A0228020000000000000000000000000000000000000000000000000000000000000000081010 \
  --seed sEdBobXXXX...
```

## check

Manage XRPL Checks: create deferred payment authorizations, cash them, cancel them, and list pending checks.

### check create

Create a Check on the XRP Ledger (CheckCreate transaction).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--to <address>` | string | Yes | — | Destination address that can cash the Check |
| `--send-max <amount>` | string | Yes | — | Maximum amount the Check can debit (XRP decimal or `value/CURRENCY/issuer`) |
| `--expiration <iso>` | string | No | — | Check expiration time (ISO 8601) |
| `--destination-tag <n>` | string | No | — | Destination tag (unsigned 32-bit integer) |
| `--invoice-id <string>` | string | No | — | Invoice identifier (≤32 bytes UTF-8, auto hex-encoded to UInt256) |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl-up check create --to rReceiver... --send-max 10 --seed sEd...
```

### check cash

Cash a Check on the XRP Ledger (CheckCash transaction). Exactly one of `--amount` or `--deliver-min` is required.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--check <id>` | string | Yes | — | 64-character Check ID (hex) |
| `--amount <amount>` | string | No† | — | Exact amount to cash (XRP decimal or `value/CURRENCY/issuer`) |
| `--deliver-min <amount>` | string | No† | — | Minimum amount to receive (flexible cash; sets partial delivery) |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.
† Exactly one of `--amount` or `--deliver-min` is required; they are mutually exclusive.

```bash
xrpl-up check cash --check <64-hex-id> --amount 10 --seed sEd...
```

### check cancel

Cancel a Check on the XRP Ledger (CheckCancel transaction).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--check <id>` | string | Yes | — | 64-character Check ID (hex) |
| `--seed <seed>` | string | No* | — | Family seed for signing |

\* Exactly one of `--seed`, `--mnemonic`, or `--account` is required.

```bash
xrpl-up check cancel --check <64-hex-id> --seed sEd...
```

### check list

List pending checks for an account (read-only, no key material needed).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|

```bash
xrpl-up check list rAccount...
```

### Example flow: Alice writes a Check for Bob, Bob cashes it; Alice cancels an unused check

```bash
# 1. Alice creates a Check — authorizing Bob to pull up to 20 XRP from her account
xrpl-up --node testnet check create \
  --to rBobXXXX... --send-max 20 \
  --seed sEdAliceXXXX... --json
# → {"checkId":"CCDDEE...64chars","result":"tesSUCCESS"}

# 2. List Bob's incoming checks
xrpl-up --node testnet check list rBobXXXX...

# 3. Bob cashes the check for exactly 15 XRP
xrpl-up --node testnet check cash \
  --check CCDDEE...64chars --amount 15 \
  --seed sEdBobXXXX...

# 4. Alternatively, if Bob doesn't cash it, Alice cancels the check to reclaim the reserve
xrpl-up --node testnet check cancel \
  --check CCDDEE...64chars --seed sEdAliceXXXX...
```

## amm

Interact with Automated Market Maker (AMM) pools.

### amm create

Create a new AMM liquidity pool.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset <spec>` | string | **Yes** | — | First asset: `XRP` or `CURRENCY/issuer` |
| `--asset2 <spec>` | string | **Yes** | — | Second asset: `XRP` or `CURRENCY/issuer` |
| `--amount <value>` | string | **Yes** | — | Amount of first asset |
| `--amount2 <value>` | string | **Yes** | — | Amount of second asset |
| `--trading-fee <n>` | integer | **Yes** | — | Trading fee in units of 1/100000 (0–1000, where 1000 = 1%) |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up amm create --asset XRP --asset2 USD/rIssuerXXX... --amount 1000000 --amount2 100 --trading-fee 500 --seed sEd...
```

### amm deposit

Deposit assets into an AMM pool.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset <spec>` | string | **Yes** | — | First asset spec |
| `--asset2 <spec>` | string | **Yes** | — | Second asset spec |
| `--amount <value>` | string | No | — | Amount of first asset to deposit |
| `--amount2 <value>` | string | No | — | Amount of second asset to deposit |
| `--lp-token-out <value>` | string | No | — | LP token amount to receive |
| `--ePrice <value>` | string | No | — | Maximum effective price per LP token |
| `--for-empty` | boolean | No | false | Use tfTwoAssetIfEmpty mode |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up amm deposit --asset XRP --asset2 USD/rIssuerXXX... --amount 500000 --seed sEd...
```

### amm withdraw

Withdraw assets from an AMM pool by redeeming LP tokens.

Withdraw modes (exactly one valid combination required):
- `--lp-token-in` → tfLPToken
- `--all` → tfWithdrawAll
- `--all --amount` → tfOneAssetWithdrawAll
- `--amount` → tfSingleAsset
- `--amount --amount2` → tfTwoAsset
- `--amount --lp-token-in` → tfOneAssetLPToken
- `--amount --ePrice` → tfLimitLPToken

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset <spec>` | string | **Yes** | — | First asset spec |
| `--asset2 <spec>` | string | **Yes** | — | Second asset spec |
| `--lp-token-in <value>` | string | No | — | LP token amount to redeem (currency/issuer auto-fetched) |
| `--amount <value>` | string | No | — | Amount of first asset to withdraw |
| `--amount2 <value>` | string | No | — | Amount of second asset to withdraw |
| `--ePrice <value>` | string | No | — | Minimum effective price in LP tokens per unit withdrawn |
| `--all` | boolean | No | false | Withdraw all LP tokens (tfWithdrawAll or tfOneAssetWithdrawAll) |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up amm withdraw --asset XRP --asset2 USD/rIssuerXXX... --all --seed sEd...
```

### amm vote

Vote on the trading fee for an AMM pool. Vote weight is proportional to LP token holdings.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset <spec>` | string | **Yes** | — | First asset spec |
| `--asset2 <spec>` | string | **Yes** | — | Second asset spec |
| `--trading-fee <n>` | integer | **Yes** | — | Desired trading fee in units of 1/100000 (0–1000) |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up amm vote --asset XRP --asset2 USD/rIssuerXXX... --trading-fee 300 --seed sEd...
```

### amm bid

Bid on an AMM auction slot to earn a reduced trading fee for a time window.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset <spec>` | string | **Yes** | — | First asset spec |
| `--asset2 <spec>` | string | **Yes** | — | Second asset spec |
| `--bid-min <value>` | string | No | — | Minimum LP token amount to bid (currency/issuer auto-fetched) |
| `--bid-max <value>` | string | No | — | Maximum LP token amount to bid (currency/issuer auto-fetched) |
| `--auth-account <address>` | string | No | — | Address to authorize for discounted trading (repeatable, max 4) |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up amm bid --asset XRP --asset2 USD/rIssuerXXX... --bid-min 100 --bid-max 200 --seed sEd...
```

### amm delete

Delete an empty AMM pool (all LP tokens must have been returned first).

> **Note:** Only succeeds when the AMM pool has >512 LP token holders and `tfWithdrawAll` returned `tecINCOMPLETE`; with few holders, `AMMWithdraw(tfWithdrawAll)` auto-deletes the pool.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset <spec>` | string | **Yes** | — | First asset spec |
| `--asset2 <spec>` | string | **Yes** | — | Second asset spec |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up amm delete --asset XRP --asset2 USD/rIssuerXXX... --seed sEd...
```

### amm info

Query AMM pool state.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset <spec>` | string | **Yes** | — | First asset spec |
| `--asset2 <spec>` | string | **Yes** | — | Second asset spec |

```bash
xrpl-up amm info --asset XRP --asset2 USD/rIssuerXXX... --json
```

### Example flow: Alice creates an XRP/USD AMM pool, deposits liquidity, votes on fee, withdraws all

```bash
# Prerequisite: Alice holds USD issued by rIssuerXXX... and has set up a trust line

# 1. Alice creates an XRP/USD AMM pool with 1,000,000 drops (1 XRP) and 100 USD, fee = 0.3%
xrpl-up --node testnet amm create \
  --asset XRP \
  --asset2 USD/rIssuerXXX... \
  --amount 1000000 \
  --amount2 100 \
  --trading-fee 300 \
  --seed sEdAliceXXXX... --json
# → {"ammAccount":"rAMMXXXX...","lpTokenCurrency":"03...","result":"tesSUCCESS"}

# 2. Query the pool state (balances, LP token supply, current fee)
xrpl-up --node testnet amm info --asset XRP --asset2 USD/rIssuerXXX...

# 3. Alice deposits an additional 500,000 drops of XRP (single-asset deposit)
xrpl-up --node testnet amm deposit \
  --asset XRP --asset2 USD/rIssuerXXX... \
  --amount 500000 \
  --seed sEdAliceXXXX...

# 4. Alice votes to lower the trading fee to 0.1%
xrpl-up --node testnet amm vote \
  --asset XRP --asset2 USD/rIssuerXXX... \
  --trading-fee 100 \
  --seed sEdAliceXXXX...

# 5. Alice withdraws all liquidity (auto-deletes the pool when she is the sole LP)
xrpl-up --node testnet amm withdraw \
  --asset XRP --asset2 USD/rIssuerXXX... \
  --all \
  --seed sEdAliceXXXX...
```

## nft

Manage NFTs on the XRP Ledger.

### nft mint

Mint an NFT.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--taxon <n>` | integer | **Yes** | — | NFT taxon (UInt32) |
| `--uri <string>` | string | No | — | Metadata URI |
| `--transfer-fee <bps>` | integer | No | — | Secondary sale fee in basis points (0–50000); requires `--transferable` |
| `--burnable` | boolean | No | false | Allow issuer to burn (tfBurnable) |
| `--only-xrp` | boolean | No | false | Restrict sales to XRP (tfOnlyXRP) |
| `--transferable` | boolean | No | false | Allow peer-to-peer transfers (tfTransferable) |
| `--mutable` | boolean | No | false | Allow URI modification (tfMutable) |
| `--issuer <address>` | string | No | — | Issuer when minting on behalf of another |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up nft mint --taxon 42 --uri https://example.com/nft.json --transferable --seed sEd...
```

### nft burn

Burn (destroy) an NFT.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--nft <hex>` | string | **Yes** | — | 64-char NFTokenID to burn |
| `--owner <address>` | string | No | — | NFT owner (when issuer burns a token they don't hold) |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up nft burn --nft <64hexNFTokenID> --seed sEd...
```

### nft offer create

Create a buy or sell offer for an NFT.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--nft <hex>` | string | **Yes** | — | 64-char NFTokenID |
| `--amount <amount>` | string | **Yes** | — | Offer amount (XRP decimal or `value/CURRENCY/issuer`; `0` valid for sell giveaways) |
| `--sell` | boolean | No | false | Create a sell offer (absence = buy offer) |
| `--owner <address>` | string | No† | — | NFT owner address (required for buy offers) |
| `--expiration <ISO8601>` | string | No | — | Offer expiration datetime |
| `--destination <address>` | string | No | — | Only this account may accept the offer |
| `--seed <seed>` | string | No | — | Family seed for signing |

† `--owner` is required for buy offers.

```bash
xrpl-up nft offer create --nft <64hexID> --amount 10 --sell --seed sEd...
```

### nft offer accept

Accept a buy or sell NFT offer (direct or brokered mode).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--sell-offer <hex>` | string | No† | — | Sell offer ID (64-char hex) |
| `--buy-offer <hex>` | string | No† | — | Buy offer ID (64-char hex) |
| `--broker-fee <amount>` | string | No | — | Broker fee; only valid with both offers present |
| `--seed <seed>` | string | No | — | Family seed for signing |

† At least one of `--sell-offer` or `--buy-offer` is required.

```bash
xrpl-up nft offer accept --sell-offer <64hexOfferID> --seed sEd...
```

### nft offer cancel

Cancel one or more NFT offers.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--offer <hex>` | string | **Yes** | — | NFTokenOffer ID to cancel (repeatable for multiple) |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up nft offer cancel --offer <64hexOfferID> --seed sEd...
```

### nft offer list

List all buy and sell offers for an NFT (read-only, no key material needed).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|

```bash
xrpl-up nft offer list <64hexNFTokenID> --json
```

### Example flow: Alice mints an NFT, creates a sell offer, Bob buys it; brokered sale variant included

```bash
# 1. Alice mints a transferable NFT with a metadata URI and 1% royalty fee
xrpl-up --node testnet nft mint \
  --taxon 42 \
  --uri https://example.com/nft-metadata.json \
  --transferable \
  --transfer-fee 1000 \
  --seed sEdAliceXXXX... --json
# → {"nftokenId":"AABBCC...64chars","result":"tesSUCCESS"}

# 2. Alice creates a sell offer for 10 XRP
xrpl-up --node testnet nft offer create \
  --nft AABBCC...64chars --amount 10 --sell \
  --seed sEdAliceXXXX... --json
# → {"offerId":"DDEE...64chars","result":"tesSUCCESS"}

# 3. List all buy/sell offers for the NFT
xrpl-up --node testnet nft offer list AABBCC...64chars

# 4. Bob accepts Alice's sell offer (direct sale — Bob pays 10 XRP, receives NFT)
xrpl-up --node testnet nft offer accept \
  --sell-offer DDEE...64chars --seed sEdBobXXXX...

# 5. Verify Bob now holds the NFT
xrpl-up --node testnet account nfts rBobXXXX...

# --- Brokered sale variant ---
# Alice creates a sell offer, Carol creates a buy offer, broker executes both

# 6. Bob (now owner) creates a sell offer
xrpl-up --node testnet nft offer create \
  --nft AABBCC...64chars --amount 15 --sell \
  --seed sEdBobXXXX... --json
# → {"offerId":"SELL...64chars"}

# 7. Carol creates a buy offer for 16 XRP
xrpl-up --node testnet nft offer create \
  --nft AABBCC...64chars --amount 16 --owner rBobXXXX... \
  --seed sEdCarolXXXX... --json
# → {"offerId":"BUY...64chars"}

# 8. Broker matches both offers (keeping 0.5 XRP as fee)
xrpl-up --node testnet nft offer accept \
  --sell-offer SELL...64chars \
  --buy-offer BUY...64chars \
  --broker-fee 0.5 \
  --seed sEdBrokerXXXX...

# 9. Cancel an unused offer
xrpl-up --node testnet nft offer cancel \
  --offer DDEE...64chars --seed sEdAliceXXXX...

# 10. Burn the NFT to remove it from the ledger
xrpl-up --node testnet nft burn --nft AABBCC...64chars --seed sEdAliceXXXX...
```

## multisig

Manage XRPL multi-signature signer lists.

### multisig set

Configure a multi-signature signer list on an account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--quorum <n>` | integer | **Yes** | — | Required signature weight threshold |
| `--signers <json>` | string | No | — | JSON array of `{account, weight}` signers |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up multisig set --quorum 2 --signers '[{"account":"rSigner1...","weight":1},{"account":"rSigner2...","weight":1}]' --seed sEd...
```

### Example flow: Alice sets up 2-of-3 multisig; two signers authorize a payment

```bash
# 1. Alice configures a 2-of-3 signer list (signer1, signer2, signer3 are separate accounts)
xrpl-up --node testnet multisig set \
  --quorum 2 \
  --signer rSigner1XXXX...:1 \
  --signer rSigner2XXXX...:1 \
  --signer rSigner3XXXX...:1 \
  --seed sEdAliceXXXX...

# 2. Verify the signer list
xrpl-up --node testnet multisig list rAliceXXXX...
# → Quorum: 2
#   rSigner1XXXX... (weight: 1)
#   rSigner2XXXX... (weight: 1)
#   rSigner3XXXX... (weight: 1)

# 3. Remove the signer list (replace with an updated one or delete entirely)
xrpl-up --node testnet multisig delete --seed sEdAliceXXXX...
```

## oracle

Manage on-chain price oracles.

### oracle set

Publish or update an on-chain price oracle (OracleSet).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--document-id <n>` | integer | **Yes** | — | Oracle document ID (UInt32) |
| `--price <json>` | string | No | — | Price data entry (repeatable) |
| `--price-data <json>` | string | No | — | JSON array of price pairs |
| `--provider <string>` | string | No | — | Oracle provider string |
| `--asset-class <string>` | string | No | — | Asset class string |
| `--last-update-time <ts>` | integer | No | now | Unix timestamp for LastUpdateTime |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up oracle set --document-id 1 --price-data '[{"base_asset":"XRP","quote_asset":"USD","asset_price":100,"scale":2}]' --seed sEd...
```

### oracle delete

Delete an on-chain price oracle (OracleDelete).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--document-id <n>` | integer | **Yes** | — | Oracle document ID |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up oracle delete --document-id 1 --seed sEd...
```

### Example flow: An oracle provider publishes a BTC/USD price feed and keeps it updated

```bash
# 1. Publish a BTC/USD price feed (oracle document ID = 1)
xrpl-up --node testnet oracle set \
  --document-id 1 \
  --price BTC/USD:155000:6 \
  --provider pyth \
  --asset-class currency \
  --seed sEdOracleXXXX...

# 2. Update the price — same document-id overwrites the previous entry
xrpl-up --node testnet oracle set \
  --document-id 1 \
  --price BTC/USD:160000:6 \
  --provider pyth \
  --asset-class currency \
  --seed sEdOracleXXXX...

# 3. Publish multiple pairs in one transaction using --price-data
xrpl-up --node testnet oracle set \
  --document-id 2 \
  --price-data '[{"BaseAsset":"ETH","QuoteAsset":"USD","AssetPrice":3000000,"Scale":6},{"BaseAsset":"XRP","QuoteAsset":"USD","AssetPrice":5000,"Scale":6}]' \
  --provider chainlink \
  --asset-class currency \
  --seed sEdOracleXXXX...

# 4. Delete the oracle when the feed is discontinued
xrpl-up --node testnet oracle delete \
  --document-id 1 --seed sEdOracleXXXX...
```

## ticket

Manage XRPL Tickets for sequence-independent transaction ordering.

### ticket create

Reserve ticket sequence numbers on an XRPL account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--count <n>` | integer | **Yes** | — | Number of tickets to create (1–250) |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up ticket create --count 5 --seed sEd...
```

### Example flow: Alice reserves ticket sequences for parallel transaction submission

```bash
# 1. Alice creates 5 tickets (sequence numbers she can use independently of her main sequence)
xrpl-up --node testnet ticket create \
  --count 5 --seed sEdAliceXXXX... --json
# → {"hash":"...","result":"tesSUCCESS","sequences":[16331356,16331357,16331358,16331359,16331360]}

# 2. List available ticket sequences on Alice's account
xrpl-up --node testnet ticket list rAliceXXXX...
# → Ticket sequence: 12
#   Ticket sequence: 13
#   ...

# 3. Tickets let Alice submit transactions out of order or in parallel;
#    the CLI will automatically use an available ticket when --ticket <seq> is specified.
```

## credential

Manage on-chain credentials (XLS-70).

### credential create

Create an on-chain credential for a subject account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--subject <address>` | string | **Yes** | — | Subject account address |
| `--credential-type <string>` | string | No | — | Credential type as plain string (auto hex-encoded, max 64 bytes) |
| `--credential-type-hex <hex>` | string | No | — | Credential type as raw hex |
| `--uri <string>` | string | No | — | URI as plain string |
| `--expiration <ISO8601>` | string | No | — | Expiration date/time |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up credential create --subject rSubjectXXX... --credential-type KYCVerified --seed sIssuerEd...
```

### credential accept

Accept an on-chain credential issued to you.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--issuer <address>` | string | **Yes** | — | Address of the credential issuer |
| `--credential-type <string>` | string | No | — | Credential type as plain string |
| `--credential-type-hex <hex>` | string | No | — | Credential type as raw hex |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up credential accept --issuer rIssuerXXX... --credential-type KYCVerified --seed sSubjectEd...
```

### credential delete

Delete an on-chain credential (revoke or clean up).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--credential-type <string>` | string | No | — | Credential type as plain string |
| `--credential-type-hex <hex>` | string | No | — | Credential type as raw hex |
| `--subject <address>` | string | No | — | Subject account address |
| `--issuer <address>` | string | No | — | Issuer account address |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up credential delete --subject rSubjectXXX... --credential-type KYCVerified --seed sIssuerEd...
```

### Example flow: A KYC issuer creates a credential for Alice, Alice accepts it, issuer revokes it

```bash
# 1. Issuer (KYC provider) creates a credential for Alice
xrpl-up --node testnet credential create \
  --subject rAliceXXXX... \
  --credential-type KYCVerified \
  --uri https://kyc.example.com/credentials/alice \
  --expiration 2027-01-01T00:00:00Z \
  --seed sEdIssuerXXXX... --json
# → {"credentialId":"AABB...","result":"tesSUCCESS"}

# 2. Alice accepts the credential issued to her
xrpl-up --node testnet credential accept \
  --issuer rIssuerXXXX... \
  --credential-type KYCVerified \
  --seed sEdAliceXXXX...

# 3. Issuer revokes the credential (e.g. Alice failed re-verification)
xrpl-up --node testnet credential delete \
  --subject rAliceXXXX... \
  --credential-type KYCVerified \
  --seed sEdIssuerXXXX...
```

## mptoken

Manage Multi-Purpose Tokens (MPT) — XLS-33.

### mptoken create-issuance

Create a new MPT issuance (MPTokenIssuanceCreate).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset-scale <n>` | integer | No | `0` | Decimal precision for display (0–255) |
| `--max-amount <string>` | string | No | — | Maximum token supply (UInt64 string) |
| `--transfer-fee <n>` | integer | No | — | Transfer fee in basis points × 10 (0–50000) |
| `--flags <list>` | string | No | — | Comma-separated: `can-lock,require-auth,can-escrow,can-trade,can-transfer,can-clawback` |
| `--metadata <string>` | string | No | — | Metadata as plain string (auto hex-encoded) |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up mptoken create-issuance --max-amount 1000000 --flags can-transfer --seed sEd...
```

### mptoken destroy-issuance

Destroy an MPT issuance (MPTokenIssuanceDestroy).

```bash
xrpl-up mptoken destroy-issuance --issuance-id <hex> --seed sEd...
```

### mptoken authorize

Authorize a holder to hold an MPT (when require-auth is set).

```bash
xrpl-up mptoken authorize --issuance-id <hex> --holder rHolderXXX... --seed sIssuerEd...
```

### mptoken unauthorize

Revoke holder authorization for an MPT.

```bash
xrpl-up mptoken unauthorize --issuance-id <hex> --holder rHolderXXX... --seed sIssuerEd...
```

### mptoken mint

Opt a holder into receiving an MPT issuance.

```bash
xrpl-up mptoken mint --issuance-id <hex> --seed sHolderEd...
```

### mptoken burn

Opt a holder out of an MPT issuance (burn their balance).

```bash
xrpl-up mptoken burn --issuance-id <hex> --seed sHolderEd...
```

### Example flow: Alice issues an MPToken, Bob opts in and receives tokens, Alice locks Bob's balance

```bash
# 1. Alice creates an MPToken issuance with can-transfer and can-lock flags
#    Note: --metadata must be a valid JSON string; plain strings produce a warning on stdout.
#    Use --json and tail -1 to parse the output if warnings are present.
xrpl-up --node testnet mptoken issuance create \
  --flags can-transfer,can-lock \
  --max-amount 1000000000 \
  --seed sEdAliceXXXX... --json
# → {"hash":"...","result":"tesSUCCESS","issuanceId":"00F93262CC0FE0E07B010597BD7364690BE2B042C62003D9"}

# 2. Bob opts into the issuance (MPTokenAuthorize — holds his slot open for this token)
xrpl-up --node testnet mptoken authorize 0000001AABBCC... \
  --seed sEdBobXXXX...

# 3. Alice sends 1000 tokens to Bob via payment
xrpl-up --node testnet payment \
  --to rBobXXXX... --amount 1000/0000001AABBCC... \
  --seed sEdAliceXXXX...

# 4. Alice locks Bob's token balance (freezes his specific holding)
xrpl-up --node testnet mptoken issuance set 0000001AABBCC... \
  --lock --holder rBobXXXX... --seed sEdAliceXXXX...

# 5. Alice unlocks Bob's balance
xrpl-up --node testnet mptoken issuance set 0000001AABBCC... \
  --unlock --holder rBobXXXX... --seed sEdAliceXXXX...

# 6. Bob opts out after his balance reaches zero
xrpl-up --node testnet mptoken authorize 0000001AABBCC... \
  --unauthorize --seed sEdBobXXXX...

# 7. Alice destroys the issuance when there is no outstanding supply
xrpl-up --node testnet mptoken issuance destroy 0000001AABBCC... \
  --seed sEdAliceXXXX...
```

## permissioned-domain

Manage XRPL permissioned domains (XLS-80).

### permissioned-domain create

Create a new permissioned domain with a set of accepted credentials.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--credentials <list>` | string | No | — | Repeatable `issuer:credential_type_hex` credential specs |
| `--credentials-json <json>` | string | No | — | JSON array of `{issuer, credential_type}` objects (credential_type must be hex) |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up permissioned-domain create --credentials-json '[{"issuer":"rIssuerXXX...","credential_type":"4b5943"}]' --seed sEd...
```

### permissioned-domain update

Update the accepted credentials for a permissioned domain.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--domain-id <hash>` | string | **Yes** | — | 64-char hex domain ID |
| `--credentials-json <json>` | string | No | — | Updated credential list |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up permissioned-domain update --domain-id <64hexID> --credentials-json '[...]' --seed sEd...
```

### permissioned-domain delete

Delete a permissioned domain, reclaiming the reserve.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--domain-id <hash>` | string | **Yes** | — | 64-char hex domain ID |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up permissioned-domain delete --domain-id <64hexID> --seed sEd...
```

### Example flow: Alice creates a permissioned domain, updates its credentials, then deletes it

```bash
# 1. Alice creates a permissioned domain requiring KYC credentials from a trusted issuer
xrpl-up --node testnet permissioned-domain create \
  --credential rCredIssuerXXXX...:KYC \
  --seed sEdAliceXXXX...
# → Domain ID: AABB...64chars  Tx: CCDD...

# 2. Alice updates the domain to require both KYC and AML credentials
xrpl-up --node testnet permissioned-domain update \
  --domain-id AABB...64chars \
  --credentials-json '[{"issuer":"rCredIssuerXXXX...","credential_type":"4b5943"},{"issuer":"rCredIssuerXXXX...","credential_type":"414d4c"}]' \
  --seed sEdAliceXXXX...

# 3. Alice deletes the domain when no longer needed
xrpl-up --node testnet permissioned-domain delete \
  --domain-id AABB...64chars --seed sEdAliceXXXX...
```

## vault

Manage single-asset vaults (XLS-65).

### vault create

Create a single-asset vault on the XRP Ledger.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--asset <spec>` | string | **Yes** | — | Asset: `0` for XRP, `CURRENCY/issuer` for IOU, or MPT spec |
| `--assets-maximum <n>` | string | No | — | Maximum total assets (UInt64) |
| `--data <hex>` | string | No | — | Arbitrary metadata hex (max 256 bytes) |
| `--domain-id <hash>` | string | No | — | 64-char hex DomainID for private vault |
| `--private` | boolean | No | false | Set tfVaultPrivate (requires `--domain-id`) |
| `--non-transferable` | boolean | No | false | Set tfVaultShareNonTransferable |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up vault create --asset 0 --assets-maximum 1000000 --seed sEd...
```

### vault deposit

Deposit assets into a vault and receive vault shares.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--vault-id <hash>` | string | **Yes** | — | 64-char hex VaultID |
| `--amount <amount>` | string | **Yes** | — | Amount to deposit |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up vault deposit --vault-id <64hexID> --amount 10 --seed sEd...
```

### vault withdraw

Withdraw assets from a vault by burning vault shares.

```bash
xrpl-up vault withdraw --vault-id <64hexID> --amount 10 --seed sEd...
```

### vault delete

Delete a vault you own.

```bash
xrpl-up vault delete --vault-id <64hexID> --seed sEd...
```

### vault clawback

Claw back assets from a vault (issuer only).

```bash
xrpl-up vault clawback --vault-id <64hexID> --holder rHolderXXX... --seed sIssuerEd...
```

### Example flow: Alice creates an XRP vault, deposits, withdraws, and deletes it (devnet only)

> **Note:** Vault is a devnet-only feature (XLS-65 amendment not yet on testnet/mainnet).

```bash
# 1. Alice creates an XRP vault with a maximum capacity of 1,000,000 drops
#    Use --asset 0 for XRP (not --asset XRP); vault is devnet-only (XLS-65)
xrpl-up --node devnet vault create \
  --asset 0 --assets-maximum 1000000 \
  --seed sEdAliceXXXX... --json
# → {"result":"success","vaultId":"69FE309...64chars","tx":"2DE659..."}

# 2. Alice deposits 1 XRP into the vault
xrpl-up --node devnet vault deposit \
  --vault-id AABBCC...64chars --amount 1 --seed sEdAliceXXXX...

# 3. Alice withdraws 0.5 XRP from the vault
xrpl-up --node devnet vault withdraw \
  --vault-id AABBCC...64chars --amount 0.5 --seed sEdAliceXXXX...

# 4. Alice deletes the vault after withdrawing all assets
xrpl-up --node devnet vault delete \
  --vault-id AABBCC...64chars --seed sEdAliceXXXX...
```

## did

Manage Decentralized Identifiers (DIDs) on the XRP Ledger (XLS-40).

### did set

Publish or update a Decentralized Identifier (DID) on-chain (DIDSet).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--uri <string>` | string | No | — | URI for the DID (auto hex-encoded) |
| `--data <string>` | string | No | — | Public attestation data (auto hex-encoded) |
| `--did-document <string>` | string | No | — | DID document (auto hex-encoded) |
| `--clear-uri` | boolean | No | false | Clear the URI field |
| `--clear-data` | boolean | No | false | Clear the Data field |
| `--clear-did-document` | boolean | No | false | Clear the DIDDocument field |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up did set --uri https://example.com/did.json --seed sEd...
```

### did delete

Delete the sender's on-chain Decentralized Identifier (DIDDelete).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up did delete --seed sEd...
```

### Example flow: Alice publishes her DID, links it to a document, then deletes it

```bash
# 1. Alice publishes a DID with a URI pointing to her DID document
xrpl-up --node testnet did set \
  --uri https://alice.example.com/did.json \
  --seed sEdAliceXXXX...

# 2. Alice updates the DID to add attestation data
xrpl-up --node testnet did set \
  --uri https://alice.example.com/did-v2.json \
  --data "attestation-payload" \
  --seed sEdAliceXXXX...

# 3. Alice deletes her on-chain DID
xrpl-up --node testnet did delete --seed sEdAliceXXXX...
```

## deposit-preauth

Manage deposit preauthorizations on XRPL accounts.

### deposit-preauth set

Grant or revoke deposit preauthorization for an account or credential.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--authorize <address>` | string | No | — | Preauthorize an account to send payments |
| `--unauthorize <address>` | string | No | — | Revoke preauthorization from an account |
| `--authorize-credential <issuer>` | string | No | — | Preauthorize a credential by issuer address |
| `--unauthorize-credential <issuer>` | string | No | — | Revoke credential-based preauthorization |
| `--credential-type <string>` | string | No | — | Credential type as plain string (auto hex-encoded) |
| `--credential-type-hex <hex>` | string | No | — | Credential type as raw hex |
| `--seed <seed>` | string | No | — | Family seed for signing |

```bash
xrpl-up deposit-preauth set --authorize rAllowedXXX... --seed sEd...
```

### deposit-preauth list

List deposit preauthorizations for an account.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|

```bash
xrpl-up deposit-preauth list rXXX... --json
```

### Example flow: Alice enables DepositAuth, pre-authorizes Bob, Bob sends a payment

```bash
# 1. Alice enables DepositAuth on her account (requires preauthorization to receive payments)
xrpl-up --node testnet account set \
  --set-flag depositAuth --seed sEdAliceXXXX...

# 2. Alice pre-authorizes Bob to send payments directly to her
xrpl-up --node testnet deposit-preauth set \
  --authorize rBobXXXX... --seed sEdAliceXXXX...

# 3. List Alice's preauthorizations
xrpl-up --node testnet deposit-preauth list rAliceXXXX...

# 4. Bob can now send XRP to Alice (bypasses DepositAuth)
xrpl-up --node testnet payment \
  --to rAliceXXXX... --amount 5 --seed sEdBobXXXX...

# 5. Alice revokes Bob's preauthorization
xrpl-up --node testnet deposit-preauth set \
  --unauthorize rBobXXXX... --seed sEdAliceXXXX...
```

## Common Agent Workflows

### Workflow 1: Fund a new wallet and send XRP

```bash
# 1. Generate and save a new wallet
xrpl-up --node testnet wallet new --save --alias sender

# 2. Fund from testnet faucet
xrpl-up --node testnet wallet fund rSenderXXXXXXXXXXXXXXXXXXXXXXXXX

# 3. Send XRP to another address
xrpl-up --node testnet payment \
  --to rReceiverXXXXXXXXXXXXXXXXXXXXXXX \
  --amount 1.5 \
  --account rSenderXXXXXXXXXXXXXXXXXXXXXXXXX \
  --password mypassword
```

### Workflow 2: Create an IOU trust line and receive tokens

```bash
# 1. Set up a trust line for the token
xrpl-up --node testnet trust set \
  --currency USD \
  --issuer rIssuerXXXXXXXXXXXXXXXXXXXXXXXXX \
  --limit 1000 \
  --account rHolderXXXXXXXXXXXXXXXXXXXXXXXXX \
  --password mypassword

# 2. Receive tokens via payment from the issuer
xrpl-up --node testnet payment \
  --to rHolderXXXXXXXXXXXXXXXXXXXXXXXXX \
  --amount 100/USD/rIssuerXXXXXXXXXXXXXXXXXXXXXXXXX \
  --account rIssuerXXXXXXXXXXXXXXXXXXXXXXXXX \
  --password issuerpassword
```

### Workflow 3: Create and drain an AMM pool

```bash
# 1. Create AMM pool with XRP and USD
xrpl-up --node testnet amm create \
  --asset XRP \
  --asset2 USD/rIssuerXXXXXXXXXXXXXXXXXXXXXXXXX \
  --amount 10000000 \
  --amount2 1000 \
  --trading-fee 500 \
  --account rOwnerXXXXXXXXXXXXXXXXXXXXXXXXX \
  --password mypassword

# 2. Withdraw all liquidity using tfWithdrawAll (auto-deletes pool when no other LP holders)
xrpl-up --node testnet amm withdraw \
  --asset XRP \
  --asset2 USD/rIssuerXXXXXXXXXXXXXXXXXXXXXXXXX \
  --all \
  --account rOwnerXXXXXXXXXXXXXXXXXXXXXXXXX \
  --password mypassword
```

---

## xrpl-up Local Node Management

These commands are unique to xrpl-up and manage the local rippled Docker sandbox.

### `node` — Start local sandbox

```bash
# Start local rippled node with 10 pre-funded accounts
xrpl-up start --local

# Run in background (detached)
xrpl-up start --local --detach

# Persist ledger state across restarts
xrpl-up start --local --local-network

# Custom ledger interval
xrpl-up start --local --ledger-interval 500

# Use a specific Docker image
xrpl-up start --local --image xrpllabsofficial/xrpld:2.3.0
```

### `status` — Show node health

```bash
xrpl-up status --local
xrpl-up status --network testnet
```

### `accounts` — List sandbox accounts

```bash
# List all local sandbox accounts and their balances
xrpl-up accounts --local

# Query a specific address
xrpl-up accounts --local --address rXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### `faucet` — Fund an account

```bash
# Fund a new random wallet on testnet
xrpl-up faucet

# Fund a specific seed on the local sandbox
xrpl-up faucet --local --seed sEdXXXXXXXXXXXXXXXXXXXXXXXXXX

# Fund on devnet
xrpl-up faucet --network devnet
```

### `logs` — Stream Docker logs

```bash
xrpl-up logs
xrpl-up logs rippled
xrpl-up logs faucet
```

### `stop` — Stop the sandbox

```bash
xrpl-up stop
```

### `reset` — Wipe all sandbox state

```bash
xrpl-up reset
xrpl-up reset --snapshots   # also delete saved snapshots
```

### `snapshot` — Save/restore ledger state

Requires `--local-network` mode.

```bash
xrpl-up snapshot save my-state
xrpl-up snapshot restore my-state
xrpl-up snapshot list
```

### `config` — Manage rippled configuration

```bash
# Print the generated rippled.cfg
xrpl-up config export

# Save to file
xrpl-up config export --output ./rippled.cfg

# Validate a custom config
xrpl-up config validate ./rippled.cfg
```

### `amendment` — Inspect and manage amendments

```bash
# List all amendments and their enabled/disabled status
xrpl-up amendment list --local

# Show details for a specific amendment
xrpl-up amendment info DynamicNFT --local
xrpl-up amendment info C1CE18F2A268E --local

# Force-enable an amendment (local sandbox only, admin RPC)
xrpl-up amendment enable DynamicNFT --local

# Veto an amendment
xrpl-up amendment disable DynamicNFT --local

# Sync amendments from testnet to local
xrpl-up amendment sync --local
```

### `run` — Run a script against an XRPL network

```bash
xrpl-up run ./my-script.ts
xrpl-up run --local ./my-script.ts
xrpl-up run --network devnet ./my-script.ts arg1 arg2
```

### `init` — Scaffold a new XRPL project

```bash
xrpl-up init
xrpl-up init my-project
```
