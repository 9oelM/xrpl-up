import chalk from 'chalk';
import ora from 'ora';
import { Wallet, xrpToDrops, dropsToXrp } from 'xrpl';
import { loadConfig, resolveNetwork } from '../core/config';
import { NetworkManager } from '../core/network';
import { LOCAL_WS_URL } from '../core/compose';
import { fundWalletFromGenesis } from '../core/standalone';
import { WalletStore } from '../core/wallet-store';
import { logger } from '../utils/logger';

// ── OfferCreate flag constants ────────────────────────────────────────────────
const TF_PASSIVE              = 0x00010000;
const TF_IMMEDIATE_OR_CANCEL  = 0x00020000;
const TF_FILL_OR_KILL         = 0x00040000;
const TF_SELL                 = 0x00080000;

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
function parseAssetAmount(raw: string): string | { currency: string; issuer: string; value: string } {
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

// ── offer create ──────────────────────────────────────────────────────────────

export interface OfferCreateOptions {
  pays: string;    // what you put in (TakerPays)
  gets: string;    // what you want out (TakerGets)
  local?: boolean;
  network?: string;
  seed?: string;
  passive?: boolean;
  immediateOrCancel?: boolean;
  fillOrKill?: boolean;
  sell?: boolean;
}

export async function offerCreateCommand(options: OfferCreateOptions): Promise<void> {
  const { networkName, networkConfig, isLocal } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);

  let pays: string | { currency: string; issuer: string; value: string };
  let gets: string | { currency: string; issuer: string; value: string };
  try {
    pays = parseAssetAmount(options.pays);
    gets = parseAssetAmount(options.gets);
  } catch (err: unknown) {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const spinner = ora({
    text: `Creating DEX offer on ${chalk.cyan(manager.displayName)}…`,
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
      const r = await fundWalletFromGenesis(client, 100);
      wallet = r.wallet;
    } else {
      spinner.text = 'Funding wallet via faucet…';
      const r = await client.fundWallet();
      wallet = r.wallet;
    }

    let flags = 0;
    if (options.passive)            flags |= TF_PASSIVE;
    if (options.immediateOrCancel)  flags |= TF_IMMEDIATE_OR_CANCEL;
    if (options.fillOrKill)         flags |= TF_FILL_OR_KILL;
    if (options.sell)               flags |= TF_SELL;

    spinner.text = 'Submitting OfferCreate…';
    const tx = {
      TransactionType: 'OfferCreate',
      Account: wallet.address,
      TakerPays: pays,
      TakerGets: gets,
      Flags: flags,
    };
    const prepared = await client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    const result   = await client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    // Extract offer sequence from metadata (offer may have already filled)
    const meta = (result.result as any).meta as any;
    const offerNode = meta?.AffectedNodes?.find(
      (n: any) => n.CreatedNode?.LedgerEntryType === 'Offer'
    );
    const sequence = offerNode?.CreatedNode?.NewFields?.Sequence as number | undefined;

    spinner.succeed(chalk.green('DEX offer created'));
    logger.blank();

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W = 14;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    if (sequence != null) row('Sequence',   chalk.cyan(String(sequence)));
    row('Account',     chalk.dim(wallet.address));
    row('TakerPays',   chalk.green(formatAmount(pays)));
    row('TakerGets',   chalk.green(formatAmount(gets)));
    logger.blank();

    if (sequence != null) {
      const net = isLocal ? ' --local' : '';
      logger.dim(`  Cancel with: xrpl-up offer cancel ${sequence}${net} --seed <seed>`);
      logger.blank();
    } else {
      logger.dim('  Offer was fully consumed immediately (no resting order).');
      logger.blank();
    }
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to create offer');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── offer cancel ──────────────────────────────────────────────────────────────

export interface OfferCancelOptions {
  sequence: number;
  local?: boolean;
  network?: string;
  seed: string;
}

export async function offerCancelCommand(options: OfferCancelOptions): Promise<void> {
  if (!options.seed) {
    logger.error('--seed <seed> is required');
    process.exit(1);
  }

  const { networkName, networkConfig } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);
  const wallet  = Wallet.fromSeed(options.seed);

  const spinner = ora({
    text: `Cancelling offer #${options.sequence} on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();
    const tx = {
      TransactionType: 'OfferCancel',
      Account: wallet.address,
      OfferSequence: options.sequence,
    };
    const prepared = await manager.client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    await manager.client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    spinner.succeed(chalk.green(`Offer #${options.sequence} cancelled`));
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to cancel offer');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── offer list ────────────────────────────────────────────────────────────────

export interface OfferListOptions {
  account?: string;
  local?: boolean;
  network?: string;
}

export async function offerListCommand(options: OfferListOptions): Promise<void> {
  const { networkName, networkConfig } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);

  const spinner = ora({
    text: `Fetching offers on ${chalk.cyan(manager.displayName)}…`,
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
      command: 'account_offers',
      account: address,
      ledger_index: 'current',
    } as any);
    await manager.disconnect();

    const offers = (res.result as any).offers as any[];
    spinner.succeed(`${offers.length} open offer${offers.length === 1 ? '' : 's'} for ${chalk.dim(address)}`);
    logger.blank();

    if (offers.length === 0) {
      logger.dim('  No open offers.');
      logger.blank();
      return;
    }

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W = 14;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    for (let i = 0; i < offers.length; i++) {
      const o = offers[i];
      if (i > 0) logger.blank();
      logger.log(chalk.dim(`  ── Offer #${o.seq} ${'─'.repeat(50)}`));
      row('Sequence', chalk.cyan(String(o.seq)));
      row('TakerPays', chalk.green(formatAmount(o.taker_pays)));
      row('TakerGets', chalk.green(formatAmount(o.taker_gets)));
      if (o.expiration) {
        const unixExp = o.expiration + 946684800;
        row('Expires', chalk.dim(new Date(unixExp * 1000).toISOString()));
      }
      if (o.flags) {
        const flagNames: string[] = [];
        if (o.flags & TF_PASSIVE)             flagNames.push('Passive');
        if (o.flags & TF_IMMEDIATE_OR_CANCEL) flagNames.push('ImmediateOrCancel');
        if (o.flags & TF_FILL_OR_KILL)        flagNames.push('FillOrKill');
        if (o.flags & TF_SELL)                flagNames.push('Sell');
        if (flagNames.length) row('Flags', chalk.dim(flagNames.join(', ')));
      }
    }
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to list offers');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
