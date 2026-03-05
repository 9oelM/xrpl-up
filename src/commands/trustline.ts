import chalk from 'chalk';
import ora from 'ora';
import { Wallet, AccountSetAsfFlags } from 'xrpl';
import { loadConfig, resolveNetwork } from '../core/config';
import { NetworkManager } from '../core/network';
import { LOCAL_WS_URL } from '../core/compose';
import { WalletStore } from '../core/wallet-store';
import { logger } from '../utils/logger';

// ── TrustSet flag constants ───────────────────────────────────────────────────
const TF_SET_NO_RIPPLE    = 0x00020000;
const TF_CLEAR_NO_RIPPLE  = 0x00040000;
const TF_SET_FREEZE       = 0x00100000;
const TF_CLEAR_FREEZE     = 0x00200000;
const TF_SET_AUTH         = 0x00010000;

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
 * Parse "USD.rIssuerAddress" → { currency: "USD", issuer: "rIssuerAddress" }
 * Also accepts "USD.rIssuer.with.dots" (joins remainder).
 */
function parseCurrencyIssuer(raw: string): { currency: string; issuer: string } {
  const dot = raw.indexOf('.');
  if (dot === -1) {
    throw new Error(
      `Invalid format "${raw}". Use "USD.rIssuerAddress" (currency.issuer).`
    );
  }
  const currency = raw.slice(0, dot).toUpperCase();
  const issuer   = raw.slice(dot + 1);
  if (!issuer.startsWith('r')) {
    throw new Error(
      `Issuer address must start with "r". Got "${issuer}".`
    );
  }
  return { currency, issuer };
}

// ── trustline set ─────────────────────────────────────────────────────────────

export interface TrustlineSetOptions {
  currencyIssuer: string; // "USD.rIssuer"
  limit: string;          // trust limit as a number string
  local?: boolean;
  network?: string;
  seed: string;
  noRipple?: boolean;     // set NoRipple flag
  auth?: boolean;         // set auth flag (lsfHighAuth / lsfLowAuth)
}

export async function trustlineSetCommand(options: TrustlineSetOptions): Promise<void> {
  if (!options.seed) {
    logger.error('--seed <seed> is required');
    process.exit(1);
  }

  let currency: string, issuer: string;
  try {
    ({ currency, issuer } = parseCurrencyIssuer(options.currencyIssuer));
  } catch (err: unknown) {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const { networkName, networkConfig } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);
  const wallet  = Wallet.fromSeed(options.seed);

  const spinner = ora({
    text: `Setting ${currency} trust line on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();

    let flags = 0;
    if (options.noRipple) flags |= TF_SET_NO_RIPPLE;
    if (options.auth)     flags |= TF_SET_AUTH;

    const tx = {
      TransactionType: 'TrustSet',
      Account: wallet.address,
      LimitAmount: { currency, issuer, value: options.limit },
      Flags: flags,
    };
    const prepared = await manager.client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    await manager.client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    spinner.succeed(chalk.green('Trust line set'));
    logger.blank();

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W = 12;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    row('Currency', chalk.cyan(currency));
    row('Issuer',   chalk.dim(issuer));
    row('Limit',    chalk.green(options.limit));
    row('NoRipple', options.noRipple ? chalk.yellow('yes') : chalk.dim('no'));
    row('Auth',     options.auth     ? chalk.yellow('yes') : chalk.dim('no'));
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to set trust line');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── trustline freeze ──────────────────────────────────────────────────────────

export interface TrustlineFreezeOptions {
  currencyIssuer: string;
  local?: boolean;
  network?: string;
  seed: string;
  unfreeze?: boolean;
}

export async function trustlineFreezeCommand(options: TrustlineFreezeOptions): Promise<void> {
  if (!options.seed) {
    logger.error('--seed <seed> is required');
    process.exit(1);
  }

  let currency: string, issuer: string;
  try {
    ({ currency, issuer } = parseCurrencyIssuer(options.currencyIssuer));
  } catch (err: unknown) {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const { networkName, networkConfig } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);
  const wallet  = Wallet.fromSeed(options.seed);
  const action  = options.unfreeze ? 'Unfreezing' : 'Freezing';
  const done    = options.unfreeze ? 'unfrozen' : 'frozen';

  const spinner = ora({
    text: `${action} ${currency} trust line on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();
    const flags = options.unfreeze ? TF_CLEAR_FREEZE : TF_SET_FREEZE;
    const tx = {
      TransactionType: 'TrustSet',
      Account: wallet.address,
      LimitAmount: { currency, issuer, value: '0' },
      Flags: flags,
    };
    const prepared = await manager.client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    await manager.client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    spinner.succeed(chalk.green(`Trust line ${done}`));
    logger.blank();
    logger.dim(`  Currency: ${currency}  Issuer: ${issuer}`);
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail(`Failed to ${options.unfreeze ? 'unfreeze' : 'freeze'} trust line`);
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── trustline list ────────────────────────────────────────────────────────────

export interface TrustlineListOptions {
  account?: string;
  local?: boolean;
  network?: string;
}

export async function trustlineListCommand(options: TrustlineListOptions): Promise<void> {
  const { networkName, networkConfig } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);

  const spinner = ora({
    text: `Fetching trust lines on ${chalk.cyan(manager.displayName)}…`,
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
      command: 'account_lines',
      account: address,
      ledger_index: 'current',
    } as any);
    await manager.disconnect();

    const lines = (res.result as any).lines as any[];
    spinner.succeed(`${lines.length} trust line${lines.length === 1 ? '' : 's'} for ${chalk.dim(address)}`);
    logger.blank();

    if (lines.length === 0) {
      logger.dim('  No trust lines.');
      logger.blank();
      return;
    }

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W = 12;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (i > 0) logger.blank();
      logger.log(chalk.dim(`  ── ${l.currency} ${'─'.repeat(50)}`));
      row('Currency', chalk.cyan(l.currency));
      row('Issuer',   chalk.dim(l.account));
      row('Balance',  Number(l.balance) >= 0
        ? chalk.green(l.balance)
        : chalk.yellow(l.balance));
      row('Limit',    chalk.dim(l.limit));
      row('NoRipple', l.no_ripple    ? chalk.yellow('yes') : chalk.dim('no'));
      row('Freeze',   l.freeze       ? chalk.red('yes')    : chalk.dim('no'));
      row('Auth',     l.authorized   ? chalk.green('yes')  : chalk.dim('no'));
    }
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to list trust lines');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── trustline issuer-defaults ─────────────────────────────────────────────────

export interface TrustlineIssuerDefaultsOptions {
  local?: boolean;
  network?: string;
  seed: string;
  noRipple?: boolean; // if true: CLEAR DefaultRipple; default: SET DefaultRipple
}

export async function trustlineIssuerDefaultsCommand(options: TrustlineIssuerDefaultsOptions): Promise<void> {
  if (!options.seed) {
    logger.error('--seed <seed> is required');
    process.exit(1);
  }

  const { networkName, networkConfig } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);
  const wallet  = Wallet.fromSeed(options.seed);

  const setting = options.noRipple ? 'Clearing DefaultRipple' : 'Setting DefaultRipple';
  const spinner = ora({
    text: `${setting} on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();
    const tx: Record<string, unknown> = {
      TransactionType: 'AccountSet',
      Account: wallet.address,
    };
    if (options.noRipple) {
      tx['ClearFlag'] = AccountSetAsfFlags.asfDefaultRipple;
    } else {
      tx['SetFlag'] = AccountSetAsfFlags.asfDefaultRipple;
    }
    const prepared = await manager.client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    await manager.client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    const done = options.noRipple ? 'DefaultRipple cleared' : 'DefaultRipple enabled';
    spinner.succeed(chalk.green(done));
    logger.blank();

    if (!options.noRipple) {
      logger.dim('  New trust lines from this issuer will have rippling enabled by default.');
    } else {
      logger.dim('  New trust lines from this issuer will have rippling disabled by default.');
    }
    logger.dim(`  Undo: xrpl-up trustline issuer-defaults --seed <seed>${options.noRipple ? '' : ' --no-ripple'}`);
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to update issuer defaults');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
