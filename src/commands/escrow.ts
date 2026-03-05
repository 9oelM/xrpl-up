import chalk from 'chalk';
import ora from 'ora';
import { Wallet, xrpToDrops, dropsToXrp } from 'xrpl';
import { loadConfig, resolveNetwork } from '../core/config';
import { NetworkManager } from '../core/network';
import { LOCAL_WS_URL } from '../core/compose';
import { fundWalletFromGenesis } from '../core/standalone';
import { WalletStore } from '../core/wallet-store';
import { logger } from '../utils/logger';

// ── Ripple epoch helpers ──────────────────────────────────────────────────────
const RIPPLE_EPOCH = 946684800; // seconds between Unix epoch and Ripple epoch (Jan 1 2000)

function toRippleTime(unixSec: number): number {
  return Math.floor(unixSec) - RIPPLE_EPOCH;
}

function fromRippleTime(rippleSec: number): Date {
  return new Date((rippleSec + RIPPLE_EPOCH) * 1000);
}

/**
 * Parse a time expression into a Ripple epoch timestamp.
 *   Relative: "+1h", "+30m", "+1d", "+7d"
 *   Absolute Unix timestamp: "1700000000"
 */
export function parseRippleTime(input: string): number {
  const rel = input.match(/^\+(\d+)(s|m|h|d)$/i);
  if (rel) {
    const n    = parseInt(rel[1], 10);
    const unit = rel[2].toLowerCase();
    const mult = unit === 's' ? 1
               : unit === 'm' ? 60
               : unit === 'h' ? 3600
               : /* d */        86400;
    return toRippleTime(Date.now() / 1000 + n * mult);
  }
  const abs = parseInt(input, 10);
  if (!isNaN(abs) && abs > 0) {
    // If it looks like a Ripple epoch already (< 2^31 and reasonable), use directly
    // Otherwise treat as Unix timestamp
    return abs > RIPPLE_EPOCH ? toRippleTime(abs) : abs;
  }
  throw new Error(
    `Invalid time "${input}". Use relative ("+1h", "+30m", "+1d") or Unix timestamp.`
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

interface NetworkInfo {
  networkName: string;
  networkConfig: { url: string; name?: string };
  isLocal: boolean;
}

function resolveNetworkInfo(options: { local?: boolean; network?: string }): NetworkInfo {
  if (options.local) {
    return {
      networkName: 'local',
      networkConfig: { url: LOCAL_WS_URL, name: 'Local rippled (Docker)' },
      isLocal: true,
    };
  }
  const config = loadConfig();
  const resolved = resolveNetwork(config, options.network);
  return {
    networkName: resolved.name,
    networkConfig: resolved.config,
    isLocal: resolved.name === 'local',
  };
}

// ── escrow create ─────────────────────────────────────────────────────────────

export interface EscrowCreateOptions {
  destination: string;
  amount: string;          // XRP amount
  local?: boolean;
  network?: string;
  seed?: string;
  finishAfter?: string;    // time expression or Unix ts
  cancelAfter?: string;    // time expression or Unix ts
  condition?: string;      // PREIMAGE-SHA-256 hex condition
  destinationTag?: number;
}

export async function escrowCreateCommand(options: EscrowCreateOptions): Promise<void> {
  if (!options.finishAfter && !options.cancelAfter && !options.condition) {
    logger.error(
      'At least one of --finish-after, --cancel-after, or --condition is required.\n' +
      '  Examples:\n' +
      '    --finish-after +1h          (allow finish after 1 hour)\n' +
      '    --cancel-after +7d          (auto-cancel after 7 days)\n' +
      '    --condition <hex>           (crypto-condition PREIMAGE-SHA-256)'
    );
    process.exit(1);
  }

  const { networkName, networkConfig, isLocal } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);

  const spinner = ora({
    text: `Creating escrow on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();
    const client = manager.client;

    let wallet: Wallet;
    if (options.seed) {
      wallet = Wallet.fromSeed(options.seed);
    } else if (isLocal) {
      spinner.text = 'Funding wallet…';
      const r = await fundWalletFromGenesis(client, Number(options.amount) + 20);
      wallet = r.wallet;
    } else {
      spinner.text = 'Funding wallet via faucet…';
      const r = await client.fundWallet();
      wallet = r.wallet;
    }

    const tx: Record<string, unknown> = {
      TransactionType: 'EscrowCreate',
      Account: wallet.address,
      Destination: options.destination,
      Amount: xrpToDrops(options.amount),
    };

    if (options.finishAfter) {
      try { tx['FinishAfter'] = parseRippleTime(options.finishAfter); }
      catch (e: unknown) { logger.error((e as Error).message); process.exit(1); }
    }
    if (options.cancelAfter) {
      try { tx['CancelAfter'] = parseRippleTime(options.cancelAfter); }
      catch (e: unknown) { logger.error((e as Error).message); process.exit(1); }
    }
    if (options.condition) tx['Condition'] = options.condition.toUpperCase();
    if (options.destinationTag != null) tx['DestinationTag'] = options.destinationTag;

    spinner.text = 'Submitting EscrowCreate…';
    const prepared = await client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    const result   = await client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    // Extract escrow sequence from metadata
    const meta      = (result.result as any).meta as any;
    const escrowNode = meta?.AffectedNodes?.find(
      (n: any) => n.CreatedNode?.LedgerEntryType === 'Escrow'
    );
    const sequence = escrowNode?.CreatedNode?.NewFields?.Sequence as number | undefined;

    spinner.succeed(chalk.green('Escrow created'));
    logger.blank();

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W = 14;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    if (sequence != null) row('Sequence',    chalk.cyan(String(sequence)));
    row('Owner',        chalk.dim(wallet.address));
    row('Destination',  chalk.dim(options.destination));
    row('Amount',       chalk.green(options.amount + ' XRP'));
    if (tx['FinishAfter'])  row('FinishAfter',  chalk.dim(fromRippleTime(tx['FinishAfter'] as number).toISOString()));
    if (tx['CancelAfter'])  row('CancelAfter',  chalk.dim(fromRippleTime(tx['CancelAfter'] as number).toISOString()));
    if (options.condition)  row('Condition',    chalk.dim(options.condition.slice(0, 20) + '…'));
    logger.blank();

    if (sequence != null) {
      const net = isLocal ? ' --local' : '';
      logger.dim(`  Finish: xrpl-up escrow finish ${wallet.address} ${sequence}${net} --seed <dest-seed>`);
      logger.dim(`  Cancel: xrpl-up escrow cancel ${wallet.address} ${sequence}${net} --seed <seed>`);
      logger.blank();
    }
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to create escrow');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── escrow finish ─────────────────────────────────────────────────────────────

export interface EscrowFinishOptions {
  owner: string;
  sequence: number;
  local?: boolean;
  network?: string;
  seed: string;
  fulfillment?: string; // hex fulfillment for crypto-condition escrows
  condition?: string;   // hex condition (required with fulfillment)
}

export async function escrowFinishCommand(options: EscrowFinishOptions): Promise<void> {
  if (!options.seed) {
    logger.error('--seed <seed> is required');
    process.exit(1);
  }
  if (options.fulfillment && !options.condition) {
    logger.error('--condition <hex> is required when --fulfillment is provided');
    process.exit(1);
  }

  const { networkName, networkConfig } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);
  const wallet  = Wallet.fromSeed(options.seed);

  const spinner = ora({
    text: `Finishing escrow on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();
    const tx: Record<string, unknown> = {
      TransactionType: 'EscrowFinish',
      Account: wallet.address,
      Owner: options.owner,
      OfferSequence: options.sequence,
    };
    if (options.fulfillment) tx['Fulfillment'] = options.fulfillment.toUpperCase();
    if (options.condition)   tx['Condition']   = options.condition.toUpperCase();

    const prepared = await manager.client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    await manager.client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    spinner.succeed(chalk.green('Escrow finished — funds released'));
    logger.blank();
    logger.dim(`  Owner: ${options.owner}  Sequence: ${options.sequence}`);
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to finish escrow');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── escrow cancel ─────────────────────────────────────────────────────────────

export interface EscrowCancelOptions {
  owner: string;
  sequence: number;
  local?: boolean;
  network?: string;
  seed: string;
}

export async function escrowCancelCommand(options: EscrowCancelOptions): Promise<void> {
  if (!options.seed) {
    logger.error('--seed <seed> is required');
    process.exit(1);
  }

  const { networkName, networkConfig } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);
  const wallet  = Wallet.fromSeed(options.seed);

  const spinner = ora({
    text: `Cancelling escrow on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();
    const tx = {
      TransactionType: 'EscrowCancel',
      Account: wallet.address,
      Owner: options.owner,
      OfferSequence: options.sequence,
    };
    const prepared = await manager.client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    await manager.client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    spinner.succeed(chalk.green('Escrow cancelled — funds returned to owner'));
    logger.blank();
    logger.dim(`  Owner: ${options.owner}  Sequence: ${options.sequence}`);
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to cancel escrow');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── escrow list ───────────────────────────────────────────────────────────────

export interface EscrowListOptions {
  account?: string;
  local?: boolean;
  network?: string;
}

export async function escrowListCommand(options: EscrowListOptions): Promise<void> {
  const { networkName, networkConfig } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);

  const spinner = ora({
    text: `Fetching escrows on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    let address = options.account;
    if (!address) {
      const store = new WalletStore(networkName);
      const accounts = store.all();
      if (accounts.length === 0) {
        spinner.fail('No accounts found');
        logger.warning('Run xrpl-up node --local first, or pass --account <address>.');
        process.exit(1);
      }
      address = accounts[0].address;
    }

    await manager.connect();
    const res = await manager.client.request({
      command: 'account_objects',
      account: address,
      type: 'escrow',
      ledger_index: 'current',
    } as any);
    await manager.disconnect();

    const escrows = (res.result as any).account_objects as any[];
    spinner.succeed(`${escrows.length} escrow${escrows.length === 1 ? '' : 's'} for ${chalk.dim(address)}`);
    logger.blank();

    if (escrows.length === 0) {
      logger.dim('  No escrows found.');
      logger.blank();
      return;
    }

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W = 14;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    for (let i = 0; i < escrows.length; i++) {
      const e = escrows[i];
      if (i > 0) logger.blank();
      logger.log(chalk.dim(`  ── Escrow #${e.Sequence} ${'─'.repeat(46)}`));
      row('Sequence',    chalk.cyan(String(e.Sequence)));
      row('Owner',       chalk.dim(e.Account));
      row('Destination', chalk.dim(e.Destination));
      row('Amount',      chalk.green(dropsToXrp(e.Amount) + ' XRP'));
      if (e.FinishAfter)  row('FinishAfter',  chalk.dim(fromRippleTime(e.FinishAfter).toISOString()));
      if (e.CancelAfter)  row('CancelAfter',  chalk.dim(fromRippleTime(e.CancelAfter).toISOString()));
      if (e.Condition)    row('Condition',    chalk.dim(String(e.Condition).slice(0, 24) + '…'));
    }
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to list escrows');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
