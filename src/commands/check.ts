import chalk from 'chalk';
import ora from 'ora';
import { Wallet, xrpToDrops, dropsToXrp } from 'xrpl';
import { loadConfig, resolveNetwork } from '../core/config';
import { NetworkManager } from '../core/network';
import { LOCAL_WS_URL } from '../core/compose';
import { WalletStore } from '../core/wallet-store';
import { logger } from '../utils/logger';
import { parseRippleTime } from './escrow';

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

/**
 * Parse an asset amount string into an XRPL Amount.
 * "5"           → XRP drops string
 * "10.USD.rX"   → IOU object
 * "10.5.USD.rX" → IOU with decimal value
 */
function parseAmount(raw: string): string | { currency: string; issuer: string; value: string } {
  if (/^\d+(\.\d+)?$/.test(raw)) {
    return xrpToDrops(raw);
  }
  const match = raw.match(/^(\d+(?:\.\d+)?)\.([A-Za-z0-9]{3,40})\.(.+)$/);
  if (!match) {
    throw new Error(
      `Invalid amount "${raw}". Use "5" for 5 XRP or "10.USD.rIssuerAddress" for IOU.`
    );
  }
  const [, value, currency, issuer] = match;
  return { currency: currency.toUpperCase(), issuer, value };
}

function formatAmount(amount: string | { currency: string; issuer: string; value: string }): string {
  if (typeof amount === 'string') {
    return dropsToXrp(amount) + ' XRP';
  }
  return `${amount.value} ${amount.currency}`;
}

const RIPPLE_EPOCH = 946684800;
function fromRippleTime(rippleSec: number): string {
  return new Date((rippleSec + RIPPLE_EPOCH) * 1000).toISOString();
}

// ── check create ──────────────────────────────────────────────────────────────

export interface CheckCreateOptions {
  destination: string;
  sendMax: string;         // max amount the destination can cash
  local?: boolean;
  network?: string;
  seed: string;
  expiry?: string;         // time expression or Unix timestamp
  destinationTag?: number;
}

export async function checkCreateCommand(options: CheckCreateOptions): Promise<void> {
  if (!options.seed) {
    logger.error('--seed <seed> is required');
    process.exit(1);
  }

  let sendMax: string | { currency: string; issuer: string; value: string };
  try {
    sendMax = parseAmount(options.sendMax);
  } catch (err: unknown) {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const { networkName, networkConfig, isLocal } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);
  const wallet  = Wallet.fromSeed(options.seed);

  const spinner = ora({
    text: `Creating check on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();

    const tx: Record<string, unknown> = {
      TransactionType: 'CheckCreate',
      Account: wallet.address,
      Destination: options.destination,
      SendMax: sendMax,
    };

    if (options.expiry) {
      try { tx['Expiration'] = parseRippleTime(options.expiry); }
      catch (e: unknown) { logger.error((e as Error).message); process.exit(1); }
    }
    if (options.destinationTag != null) tx['DestinationTag'] = options.destinationTag;

    spinner.text = 'Submitting CheckCreate…';
    const prepared = await manager.client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    const result   = await manager.client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    // Extract CheckID from metadata
    const meta      = (result.result as any).meta as any;
    const checkNode = meta?.AffectedNodes?.find(
      (n: any) => n.CreatedNode?.LedgerEntryType === 'Check'
    );
    const checkId = checkNode?.CreatedNode?.LedgerIndex as string | undefined;

    spinner.succeed(chalk.green('Check created'));
    logger.blank();

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W = 14;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    if (checkId) row('CheckID',    chalk.cyan(checkId));
    row('Sender',      chalk.dim(wallet.address));
    row('Destination', chalk.dim(options.destination));
    row('SendMax',     chalk.green(formatAmount(sendMax)));
    if (tx['Expiration'])
      row('Expires', chalk.dim(fromRippleTime(tx['Expiration'] as number)));
    logger.blank();

    if (checkId) {
      const net = isLocal ? ' --local' : '';
      logger.dim(`  Cash:   xrpl-up check cash ${checkId} <amount>${net} --seed <dest-seed>`);
      logger.dim(`  Cancel: xrpl-up check cancel ${checkId}${net} --seed <seed>`);
      logger.blank();
    }
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to create check');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── check cash ────────────────────────────────────────────────────────────────

export interface CheckCashOptions {
  checkId: string;
  amount?: string;      // exact amount to receive (XRP or IOU)
  deliverMin?: string;  // minimum amount to receive (flexible)
  local?: boolean;
  network?: string;
  seed: string;
}

export async function checkCashCommand(options: CheckCashOptions): Promise<void> {
  if (!options.seed) {
    logger.error('--seed <seed> is required');
    process.exit(1);
  }
  if (!options.amount && !options.deliverMin) {
    logger.error('Provide either <amount> (exact) or --deliver-min <amount> (flexible minimum).');
    process.exit(1);
  }
  if (options.amount && options.deliverMin) {
    logger.error('<amount> and --deliver-min are mutually exclusive.');
    process.exit(1);
  }

  const { networkName, networkConfig } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);
  const wallet  = Wallet.fromSeed(options.seed);

  const spinner = ora({
    text: `Cashing check on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();

    const tx: Record<string, unknown> = {
      TransactionType: 'CheckCash',
      Account: wallet.address,
      CheckID: options.checkId,
    };

    if (options.amount) {
      try { tx['Amount'] = parseAmount(options.amount); }
      catch (e: unknown) { logger.error((e as Error).message); process.exit(1); }
    }
    if (options.deliverMin) {
      try { tx['DeliverMin'] = parseAmount(options.deliverMin); }
      catch (e: unknown) { logger.error((e as Error).message); process.exit(1); }
    }

    const prepared = await manager.client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    await manager.client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    const received = options.amount ?? `≥ ${options.deliverMin}`;
    spinner.succeed(chalk.green(`Check cashed — received ${received}`));
    logger.blank();
    logger.dim(`  CheckID: ${options.checkId}`);
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to cash check');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── check cancel ──────────────────────────────────────────────────────────────

export interface CheckCancelOptions {
  checkId: string;
  local?: boolean;
  network?: string;
  seed: string;
}

export async function checkCancelCommand(options: CheckCancelOptions): Promise<void> {
  if (!options.seed) {
    logger.error('--seed <seed> is required');
    process.exit(1);
  }

  const { networkName, networkConfig } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);
  const wallet  = Wallet.fromSeed(options.seed);

  const spinner = ora({
    text: `Cancelling check on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();
    const tx = {
      TransactionType: 'CheckCancel',
      Account: wallet.address,
      CheckID: options.checkId,
    };
    const prepared = await manager.client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    await manager.client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    spinner.succeed(chalk.green('Check cancelled'));
    logger.blank();
    logger.dim(`  CheckID: ${options.checkId}`);
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to cancel check');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── check list ────────────────────────────────────────────────────────────────

export interface CheckListOptions {
  account?: string;
  local?: boolean;
  network?: string;
}

export async function checkListCommand(options: CheckListOptions): Promise<void> {
  const { networkName, networkConfig } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);

  const spinner = ora({
    text: `Fetching checks on ${chalk.cyan(manager.displayName)}…`,
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
      type: 'check',
      ledger_index: 'current',
    } as any);
    await manager.disconnect();

    const checks = (res.result as any).account_objects as any[];
    spinner.succeed(`${checks.length} check${checks.length === 1 ? '' : 's'} for ${chalk.dim(address)}`);
    logger.blank();

    if (checks.length === 0) {
      logger.dim('  No checks found.');
      logger.blank();
      return;
    }

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W = 14;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    for (let i = 0; i < checks.length; i++) {
      const c = checks[i];
      if (i > 0) logger.blank();
      const shortId = String(c.index ?? c.LedgerIndex ?? '').slice(0, 16);
      logger.log(chalk.dim(`  ── Check ${shortId}… ${'─'.repeat(40)}`));
      row('CheckID',     chalk.cyan(c.index ?? c.LedgerIndex ?? '—'));
      row('Sender',      chalk.dim(c.Account));
      row('Destination', chalk.dim(c.Destination));
      row('SendMax',     chalk.green(formatAmount(c.SendMax)));
      if (c.Expiration)  row('Expires', chalk.dim(fromRippleTime(c.Expiration)));
    }
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to list checks');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
