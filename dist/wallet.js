#!/usr/bin/env node
import { AuthFetch, KeyDeriver, PrivateKey, WalletClient } from '@bsv/sdk';
import { Services, StorageClient, Wallet, WalletSigner, WalletStorageManager } from '@bsv/wallet-toolbox-client';
import * as crypto from 'crypto';
global.self = { crypto };
// Create a Wallet Client and AuthFetch
export let walletClient = new WalletClient('auto', 'localhost');
export let authFetch = new AuthFetch(walletClient);
export const remakeWallet = async (key, network = 'mainnet', storage) => {
    if (typeof storage !== 'string') {
        if (network === 'mainnet') {
            storage = 'https://storage.babbage.systems';
        }
        else {
            storage = 'https://staging-storage.babbage.systems';
        }
    }
    const keyDeriver = new KeyDeriver(new PrivateKey(key, 'hex'));
    const storageManager = new WalletStorageManager(keyDeriver.identityKey);
    const chain = network === 'mainnet' ? 'main' : 'test';
    const signer = new WalletSigner(chain, keyDeriver, storageManager);
    const services = new Services(chain);
    const wallet = new Wallet(signer, services);
    const client = new StorageClient(wallet, storage);
    await client.makeAvailable();
    await storageManager.addWalletStorageProvider(client);
    walletClient = wallet;
    authFetch = new AuthFetch(walletClient);
};
