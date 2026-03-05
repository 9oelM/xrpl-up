import chalk from 'chalk';
import ora from 'ora';
import { Wallet, xrpToDrops } from 'xrpl';
import { loadConfig, resolveNetwork } from '../core/config';
import { NetworkManager } from '../core/network';
import { LOCAL_WS_URL } from '../core/compose';
import { fundWalletFromGenesis } from '../core/standalone';
import { WalletStore } from '../core/wallet-store';
import { logger } from '../utils/logger';

// ── MPTokenIssuanceCreate flag constants ──────────────────────────────────────
const MPT_FLAG_CAN_LOCK      = 0x0002;
const MPT_FLAG_REQUIRE_AUTH  = 0x0004;
// const MPT_FLAG_CAN_ESCROW = 0x0008; // reserved
// const MPT_FLAG_CAN_TRADE  = 0x0010; // reserved
const MPT_FLAG_CAN_TRANSFER  = 0x0020;
const MPT_FLAG_CAN_CLAWBACK  = 0x0040;

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

// ── mpt create ────────────────────────────────────────────────────────────────

export interface MptCreateOptions {
  maxAmount?: string;    // maximum supply (integer string)
  assetScale?: number;  // decimal places, 0-19
  transferFee?: number; // 0-50000 (hundredths of a percent)
  metadata?: string;    // hex or plain string metadata
  transferable?: boolean;
  requireAuth?: boolean;
  canLock?: boolean;
  canClawback?: boolean;
  local?: boolean;
  network?: string;
  seed?: string;
}

export async function mptCreateCommand(options: MptCreateOptions): Promise<void> {
  const { networkName, networkConfig, isLocal } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);

  const spinner = ora({
    text: `Creating MPT issuance on ${chalk.cyan(manager.displayName)}…`,
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
      spinner.text = 'Funding issuer wallet…';
      const r = await fundWalletFromGenesis(client, 100);
      wallet = r.wallet;
    } else {
      logger.error('--seed <seed> is required on remote networks');
      process.exit(1);
    }

    // Build flags
    let flags = 0;
    if (options.transferable) flags |= MPT_FLAG_CAN_TRANSFER;
    if (options.requireAuth)  flags |= MPT_FLAG_REQUIRE_AUTH;
    if (options.canLock)      flags |= MPT_FLAG_CAN_LOCK;
    if (options.canClawback)  flags |= MPT_FLAG_CAN_CLAWBACK;

    const tx: Record<string, unknown> = {
      TransactionType: 'MPTokenIssuanceCreate',
      Account: wallet.address,
      Flags: flags,
    };

    if (options.maxAmount  != null) tx['MaximumAmount'] = options.maxAmount;
    if (options.assetScale != null) tx['AssetScale']    = options.assetScale;
    if (options.transferFee != null) tx['TransferFee']  = options.transferFee;
    if (options.metadata)  tx['MPTokenMetadata'] = Buffer.from(options.metadata, 'utf8').toString('hex').toUpperCase();

    spinner.text = 'Submitting MPTokenIssuanceCreate…';
    const prepared = await client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    const result   = await client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    // Extract issuance ID from metadata
    const meta        = (result.result as any).meta as any;
    const issuanceNode = meta?.AffectedNodes?.find(
      (n: any) => n.CreatedNode?.LedgerEntryType === 'MPTokenIssuance'
    );
    const issuanceId = issuanceNode?.CreatedNode?.LedgerIndex as string | undefined;

    spinner.succeed(chalk.green('MPT issuance created'));
    logger.blank();

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W = 16;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    if (issuanceId) row('Issuance ID',   chalk.cyan(issuanceId));
    row('Issuer',         chalk.dim(wallet.address));
    if (options.maxAmount != null)  row('Max amount',   chalk.dim(options.maxAmount));
    if (options.assetScale != null) row('Asset scale',  chalk.dim(String(options.assetScale)));
    if (options.transferFee != null) row('Transfer fee', chalk.dim(String(options.transferFee)));
    row('Transferable',   options.transferable ? chalk.green('yes') : chalk.dim('no'));
    row('Require auth',   options.requireAuth  ? chalk.yellow('yes') : chalk.dim('no'));
    row('Can lock',       options.canLock      ? chalk.yellow('yes') : chalk.dim('no'));
    row('Can clawback',   options.canClawback  ? chalk.yellow('yes') : chalk.dim('no'));
    logger.blank();

    if (issuanceId) {
      const net = isLocal ? ' --local' : '';
      logger.dim(`  Info:    xrpl-up mpt info ${issuanceId}${net}`);
      logger.dim(`  Destroy: xrpl-up mpt destroy ${issuanceId}${net} --seed <seed>`);
      logger.blank();
    }
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to create MPT issuance');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── mpt destroy ───────────────────────────────────────────────────────────────

export interface MptDestroyOptions {
  issuanceId: string;
  local?: boolean;
  network?: string;
  seed: string;
}

export async function mptDestroyCommand(options: MptDestroyOptions): Promise<void> {
  if (!options.seed) {
    logger.error('--seed <seed> is required');
    process.exit(1);
  }

  const { networkName, networkConfig } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);
  const wallet  = Wallet.fromSeed(options.seed);

  const spinner = ora({
    text: `Destroying MPT issuance ${chalk.cyan(options.issuanceId)} on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();
    const tx = {
      TransactionType: 'MPTokenIssuanceDestroy',
      Account: wallet.address,
      MPTokenIssuanceID: options.issuanceId,
    };
    const prepared = await manager.client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    await manager.client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    spinner.succeed(chalk.green('MPT issuance destroyed'));
    logger.blank();
    logger.dim(`  Issuance: ${options.issuanceId}`);
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to destroy MPT issuance');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── mpt authorize ─────────────────────────────────────────────────────────────

export interface MptAuthorizeOptions {
  issuanceId: string;
  holder?: string;      // address to authorize (issuer-side auth)
  unauthorize?: boolean; // set tfMPTUnauthorize flag
  local?: boolean;
  network?: string;
  seed: string;
}

export async function mptAuthorizeCommand(options: MptAuthorizeOptions): Promise<void> {
  if (!options.seed) {
    logger.error('--seed <seed> is required');
    process.exit(1);
  }

  const { networkName, networkConfig } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);
  const wallet  = Wallet.fromSeed(options.seed);

  // tfMPTUnauthorize = 0x0001
  const flags = options.unauthorize ? 0x0001 : 0;

  const action = options.unauthorize ? 'unauthorize' : 'authorize';
  const spinner = ora({
    text: `${action.charAt(0).toUpperCase() + action.slice(1)}ing MPT holder on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();
    const tx: Record<string, unknown> = {
      TransactionType: 'MPTokenAuthorize',
      Account: wallet.address,
      MPTokenIssuanceID: options.issuanceId,
      Flags: flags,
    };
    if (options.holder) tx['MPTokenHolder'] = options.holder;

    const prepared = await manager.client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    await manager.client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    spinner.succeed(chalk.green(`MPT holder ${action}d`));
    logger.blank();
    logger.dim(`  Issuance: ${options.issuanceId}`);
    if (options.holder) logger.dim(`  Holder:   ${options.holder}`);
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail(`Failed to ${action} MPT holder`);
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── mpt set ───────────────────────────────────────────────────────────────────

export interface MptSetOptions {
  issuanceId: string;
  lock?: boolean;
  unlock?: boolean;
  holder?: string;  // if set, lock/unlock a specific holder; otherwise applies to the issuance
  local?: boolean;
  network?: string;
  seed: string;
}

export async function mptSetCommand(options: MptSetOptions): Promise<void> {
  if (!options.seed) {
    logger.error('--seed <seed> is required');
    process.exit(1);
  }
  if (!options.lock && !options.unlock) {
    logger.error('Specify --lock or --unlock');
    process.exit(1);
  }
  if (options.lock && options.unlock) {
    logger.error('--lock and --unlock are mutually exclusive');
    process.exit(1);
  }

  const { networkName, networkConfig } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);
  const wallet  = Wallet.fromSeed(options.seed);

  // tfMPTLock=0x0001, tfMPTUnlock=0x0002
  const flags = options.lock ? 0x0001 : 0x0002;

  const action = options.lock ? 'Locking' : 'Unlocking';
  const spinner = ora({
    text: `${action} MPT issuance on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();
    const tx: Record<string, unknown> = {
      TransactionType: 'MPTokenIssuanceSet',
      Account: wallet.address,
      MPTokenIssuanceID: options.issuanceId,
      Flags: flags,
    };
    if (options.holder) tx['MPTokenHolder'] = options.holder;

    const prepared = await manager.client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    await manager.client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    const done = options.lock ? 'locked' : 'unlocked';
    spinner.succeed(chalk.green(`MPT issuance ${done}`));
    logger.blank();
    logger.dim(`  Issuance: ${options.issuanceId}`);
    if (options.holder) logger.dim(`  Holder:   ${options.holder}`);
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to set MPT issuance state');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── mpt info ──────────────────────────────────────────────────────────────────

export interface MptInfoOptions {
  issuanceId: string;
  local?: boolean;
  network?: string;
}

export async function mptInfoCommand(options: MptInfoOptions): Promise<void> {
  const { networkName, networkConfig } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);

  const spinner = ora({
    text: `Fetching MPT issuance ${chalk.cyan(options.issuanceId)} on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();
    const res = await manager.client.request({
      command: 'ledger_entry',
      mpt_issuance: { mpt_issuance_id: options.issuanceId },
      ledger_index: 'validated',
    } as any);
    await manager.disconnect();

    const node = (res.result as any).node as any;

    spinner.succeed(chalk.green('MPT issuance info'));
    logger.blank();

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W = 18;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    row('Issuance ID',     chalk.cyan(options.issuanceId));
    row('Issuer',          chalk.dim(node.Issuer ?? node.Account ?? '—'));
    if (node.MaximumAmount != null) row('Max amount',     chalk.dim(String(node.MaximumAmount)));
    if (node.OutstandingAmount != null)
      row('Outstanding',   chalk.green(String(node.OutstandingAmount)));
    if (node.AssetScale != null) row('Asset scale',    chalk.dim(String(node.AssetScale)));
    if (node.TransferFee != null) row('Transfer fee',   chalk.dim(String(node.TransferFee)));
    if (node.MPTokenMetadata) {
      const raw = node.MPTokenMetadata as string;
      let decoded = raw;
      try { decoded = Buffer.from(raw, 'hex').toString('utf8'); } catch { /* keep hex */ }
      row('Metadata',       chalk.dim(decoded));
    }

    const flags: string[] = [];
    const f = node.Flags ?? 0;
    if (f & 0x0002) flags.push('CanLock');
    if (f & 0x0004) flags.push('RequireAuth');
    if (f & 0x0020) flags.push('CanTransfer');
    if (f & 0x0040) flags.push('CanClawback');
    row('Flags',           flags.length ? chalk.dim(flags.join(', ')) : chalk.dim('none'));

    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to fetch MPT issuance info');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
