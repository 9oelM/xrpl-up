import chalk from 'chalk';
import ora from 'ora';
import { Wallet, xrpToDrops, getNFTokenID } from 'xrpl';
import { stringToHex } from '@xrplf/isomorphic/utils';
import { loadConfig, resolveNetwork } from '../core/config';
import { NetworkManager } from '../core/network';
import { LOCAL_WS_URL } from '../core/compose';
import { fundWalletFromGenesis } from '../core/standalone';
import { WalletStore } from '../core/wallet-store';
import { logger } from '../utils/logger';

// ── NFToken flag constants ────────────────────────────────────────────────────
const NFT_FLAG_BURNABLE     = 0x00000001;
const NFT_FLAG_TRANSFERABLE = 0x00000008;

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
 * Parse a price string into an XRPL Amount.
 * "1"          → XRP drops string  (1 XRP)
 * "10.USD.rX"  → IOU object
 */
function parsePrice(raw: string): string | { currency: string; issuer: string; value: string } {
  if (/^\d+(\.\d+)?$/.test(raw)) {
    return xrpToDrops(raw);
  }
  const parts = raw.split('.');
  if (parts.length < 3) {
    throw new Error(
      `Invalid price "${raw}". Use "1" for 1 XRP or "10.USD.rIssuerAddress" for IOU.`
    );
  }
  const value    = parts[0];
  const currency = parts[1];
  const issuer   = parts.slice(2).join('.');
  return { currency, issuer, value };
}

function formatAmount(amount: string | { currency: string; issuer: string; value: string }): string {
  if (typeof amount === 'string') {
    return (Number(amount) / 1_000_000).toFixed(6) + ' XRP';
  }
  return `${amount.value} ${amount.currency}`;
}

// ── nft mint ──────────────────────────────────────────────────────────────────

export interface NftMintOptions {
  local?: boolean;
  network?: string;
  seed?: string;
  uri?: string;
  transferable?: boolean;
  burnable?: boolean;
  taxon?: number;
  transferFee?: number; // percentage, e.g. 5 = 5%
}

export async function nftMintCommand(options: NftMintOptions): Promise<void> {
  const { networkName, networkConfig, isLocal } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);

  const spinner = ora({
    text: `Minting NFT on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();
    const client = manager.client;

    // Resolve wallet
    let wallet: Wallet;
    if (options.seed) {
      wallet = Wallet.fromSeed(options.seed);
    } else if (isLocal) {
      spinner.text = 'Funding fresh wallet…';
      const r = await fundWalletFromGenesis(client, 100);
      wallet = r.wallet;
    } else {
      spinner.text = 'Funding wallet via faucet…';
      const r = await client.fundWallet();
      wallet = r.wallet;
    }

    // Build flags
    let flags = 0;
    if (options.burnable)     flags |= NFT_FLAG_BURNABLE;
    if (options.transferable) flags |= NFT_FLAG_TRANSFERABLE;

    // Transfer fee: 0–50% expressed as 0–50000 in rippled
    const transferFee = options.transferFee !== undefined
      ? Math.round(options.transferFee * 1000)
      : 0;
    if (transferFee < 0 || transferFee > 50000) {
      spinner.fail('--transfer-fee must be between 0% and 50%');
      process.exit(1);
    }

    const tx: Record<string, unknown> = {
      TransactionType: 'NFTokenMint',
      Account: wallet.address,
      NFTokenTaxon: options.taxon ?? 0,
      Flags: flags,
    };
    if (options.uri)       tx['URI'] = stringToHex(options.uri);
    if (transferFee > 0)   tx['TransferFee'] = transferFee;

    spinner.text = 'Submitting NFTokenMint…';
    const prepared = await client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    const result   = await client.submitAndWait(signed.tx_blob);

    const meta      = (result.result as any).meta as any;
    const nftokenId = getNFTokenID(meta) as string | undefined;

    await manager.disconnect();

    spinner.succeed(chalk.green('NFT minted'));
    logger.blank();

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W = 14;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    row('NFTokenID', nftokenId ? chalk.cyan(nftokenId) : chalk.dim('(could not extract)'));
    row('Account',   chalk.dim(wallet.address));
    if (!options.seed && isLocal) row('Seed', chalk.dim(wallet.seed ?? '—'));
    row('Taxon',    chalk.dim(String(options.taxon ?? 0)));
    if (options.uri) row('URI', chalk.dim(options.uri));
    row('Network',  chalk.dim(manager.displayName));
    logger.blank();

    if (nftokenId) {
      logger.dim(`  List:  xrpl-up nft list${isLocal ? ' --local' : ''}`);
      logger.dim(`  Sell:  xrpl-up nft sell ${nftokenId} <price>${isLocal ? ' --local' : ''} --seed <seed>`);
      logger.blank();
    }
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('NFT mint failed');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── nft list ──────────────────────────────────────────────────────────────────

export interface NftListOptions {
  local?: boolean;
  network?: string;
  account?: string;
}

export async function nftListCommand(options: NftListOptions): Promise<void> {
  const { networkName, networkConfig, isLocal } = resolveNetworkInfo(options);

  let address = options.account;
  if (!address) {
    if (isLocal) {
      const store    = new WalletStore('local');
      const accounts = store.all();
      if (accounts.length === 0) {
        logger.warning('No local accounts found. Run xrpl-up node --local first.');
        return;
      }
      address = accounts[0].address;
    } else {
      logger.error('Specify an account with --account <address>');
      process.exit(1);
    }
  }

  const manager = new NetworkManager(networkName, networkConfig);
  const spinner = ora({
    text: `Fetching NFTs for ${chalk.cyan(address)} on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();
    const res = await manager.client.request({
      command: 'account_nfts',
      account: address,
      ledger_index: 'validated',
    } as any);
    await manager.disconnect();

    const nfts = (res.result as any).account_nfts as any[];
    spinner.succeed(`${nfts.length} NFT${nfts.length === 1 ? '' : 's'} for ${chalk.cyan(address)}`);
    logger.blank();

    if (nfts.length === 0) {
      logger.dim('  No NFTs found for this account.');
      logger.blank();
      return;
    }

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W = 12;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    for (const [i, nft] of nfts.entries()) {
      logger.log(chalk.dim(`  ── NFT ${i + 1} ────────────────────────────────────────────────────────────`));
      row('NFTokenID', chalk.cyan(nft.NFTokenID));
      row('Taxon',     chalk.dim(String(nft.NFTokenTaxon)));
      row('Serial',    chalk.dim(String(nft.nft_serial)));
      row('Flags',     chalk.dim(String(nft.Flags)));
      if (nft.URI) {
        try {
          row('URI', chalk.dim(Buffer.from(nft.URI, 'hex').toString('utf8')));
        } catch {
          row('URI', chalk.dim(nft.URI));
        }
      }
      if (i < nfts.length - 1) logger.blank();
    }
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to fetch NFTs');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── nft offers ────────────────────────────────────────────────────────────────

export interface NftOffersOptions {
  nftokenId: string;
  local?: boolean;
  network?: string;
}

export async function nftOffersCommand(options: NftOffersOptions): Promise<void> {
  const { networkName, networkConfig } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);
  const shortId = options.nftokenId.slice(0, 12) + '…';

  const spinner = ora({
    text: `Fetching offers for ${chalk.cyan(shortId)} on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();

    let sellOffers: any[] = [];
    let buyOffers:  any[] = [];

    try {
      const res = await manager.client.request({
        command: 'nft_sell_offers',
        nft_id: options.nftokenId,
      } as any);
      sellOffers = (res.result as any).offers ?? [];
    } catch { /* no sell offers */ }

    try {
      const res = await manager.client.request({
        command: 'nft_buy_offers',
        nft_id: options.nftokenId,
      } as any);
      buyOffers = (res.result as any).offers ?? [];
    } catch { /* no buy offers */ }

    await manager.disconnect();

    const total = sellOffers.length + buyOffers.length;
    spinner.succeed(`${total} offer${total === 1 ? '' : 's'} for NFT`);
    logger.blank();

    if (total === 0) {
      logger.dim('  No open offers for this NFT.');
      logger.blank();
      return;
    }

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W = 12;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    const printOffers = (offers: any[], type: 'Sell' | 'Buy') => {
      for (const o of offers) {
        logger.log(chalk.dim(`  ── ${type} Offer ──────────────────────────────────────────────────────`));
        row('Offer ID',    chalk.cyan(o.nft_offer_index));
        row('Amount',      chalk.green(formatAmount(o.amount)));
        row('Owner',       chalk.dim(o.owner));
        if (o.destination) row('Destination', chalk.dim(o.destination));
        logger.blank();
      }
    };

    printOffers(sellOffers, 'Sell');
    printOffers(buyOffers,  'Buy');
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to fetch offers');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── nft burn ──────────────────────────────────────────────────────────────────

export interface NftBurnOptions {
  nftokenId: string;
  local?: boolean;
  network?: string;
  seed: string;
}

export async function nftBurnCommand(options: NftBurnOptions): Promise<void> {
  if (!options.seed) {
    logger.error('--seed <seed> is required to sign the burn transaction');
    process.exit(1);
  }

  const { networkName, networkConfig } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);
  const wallet  = Wallet.fromSeed(options.seed);
  const shortId = options.nftokenId.slice(0, 12) + '…';

  const spinner = ora({
    text: `Burning NFT ${chalk.cyan(shortId)} on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();
    const tx = {
      TransactionType: 'NFTokenBurn',
      Account: wallet.address,
      NFTokenID: options.nftokenId,
    };
    const prepared = await manager.client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    await manager.client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    spinner.succeed(chalk.green('NFT burned'));
    logger.blank();
    logger.dim(`  NFTokenID: ${options.nftokenId}`);
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('NFT burn failed');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── nft sell ──────────────────────────────────────────────────────────────────

export interface NftSellOptions {
  nftokenId: string;
  price: string; // "1" = 1 XRP | "10.USD.rIssuer" = IOU
  local?: boolean;
  network?: string;
  seed: string;
}

export async function nftSellCommand(options: NftSellOptions): Promise<void> {
  if (!options.seed) {
    logger.error('--seed <seed> is required to sign the offer transaction');
    process.exit(1);
  }

  let amount: string | { currency: string; issuer: string; value: string };
  try {
    amount = parsePrice(options.price);
  } catch (e) {
    logger.error((e as Error).message);
    process.exit(1);
  }

  const { networkName, networkConfig, isLocal } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);
  const wallet  = Wallet.fromSeed(options.seed);

  const spinner = ora({
    text: `Creating sell offer on ${chalk.cyan(manager.displayName)}…`,
    color: 'cyan',
    indent: 2,
  }).start();

  try {
    await manager.connect();
    const tx = {
      TransactionType: 'NFTokenCreateOffer',
      Account: wallet.address,
      NFTokenID: options.nftokenId,
      Amount: amount,
      Flags: 0x00000001, // tfSellNFToken
    };
    const prepared = await manager.client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    const result   = await manager.client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    // Extract offer ID from metadata
    const meta      = (result.result as any).meta as any;
    const offerNode = meta?.AffectedNodes?.find(
      (n: any) => n.CreatedNode?.LedgerEntryType === 'NFTokenOffer'
    );
    const offerId = offerNode?.CreatedNode?.LedgerIndex as string | undefined;

    spinner.succeed(chalk.green('Sell offer created'));
    logger.blank();

    const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
    const W = 12;
    const row = (key: string, val: string) =>
      logger.log(`${chalk.dim(pad(key + ':', W))} ${val}`);

    if (offerId) row('Offer ID',  chalk.cyan(offerId));
    row('Price',     chalk.green(formatAmount(amount)));
    row('NFTokenID', chalk.dim(options.nftokenId));
    logger.blank();

    if (offerId) {
      logger.dim(`  Accept with: xrpl-up nft accept ${offerId}${isLocal ? ' --local' : ''} --seed <buyer-seed>`);
      logger.blank();
    }
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to create sell offer');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── nft accept ────────────────────────────────────────────────────────────────

export interface NftAcceptOptions {
  offerId: string;
  local?: boolean;
  network?: string;
  seed?: string;
  buy?: boolean; // if true, use BuyOffer field; default: SellOffer
}

export async function nftAcceptCommand(options: NftAcceptOptions): Promise<void> {
  const { networkName, networkConfig, isLocal } = resolveNetworkInfo(options);
  const manager = new NetworkManager(networkName, networkConfig);

  const spinner = ora({
    text: `Accepting ${options.buy ? 'buy' : 'sell'} offer on ${chalk.cyan(manager.displayName)}…`,
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
      spinner.text = 'Funding fresh wallet…';
      const r = await fundWalletFromGenesis(client, 100);
      wallet = r.wallet;
    } else {
      logger.error('--seed <seed> is required on remote networks');
      process.exit(1);
    }

    const tx: Record<string, unknown> = {
      TransactionType: 'NFTokenAcceptOffer',
      Account: wallet.address,
    };
    if (options.buy) {
      tx['BuyOffer'] = options.offerId;
    } else {
      tx['SellOffer'] = options.offerId;
    }

    spinner.text = 'Submitting NFTokenAcceptOffer…';
    const prepared = await client.autofill(tx as any);
    const signed   = wallet.sign(prepared as any);
    await client.submitAndWait(signed.tx_blob);
    await manager.disconnect();

    spinner.succeed(chalk.green('Offer accepted'));
    logger.blank();
    logger.dim(`  Offer ID: ${options.offerId}`);
    logger.blank();
  } catch (err: unknown) {
    await manager.disconnect().catch(() => {});
    spinner.fail('Failed to accept offer');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
