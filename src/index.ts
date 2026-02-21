#!/usr/bin/env node
import { program } from 'commander';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk/index.js';
import inquirer from 'inquirer';
import { remakeWallet } from './wallet.js';
import { authFetch } from './wallet.js';
import {
  loadMandalaConfigInfo, saveMandalaConfigInfo, pickMandalaConfig,
  isMandalaConfig, addMandalaConfigInteractive, editMandalaConfigInteractive,
  deleteMandalaConfig, findConfigByNameOrIndex, chooseMandalaCloudURL,
  printAllConfigsWithIndex, configMenu, listAllConfigs
} from './config.js';
import { buildArtifact, findArtifacts, findLatestArtifact, printArtifactsList, artifactMenu } from './artifact.js';
import { projectMenu, showProjectInfo, fetchResourceLogs, pickReleaseId, showGlobalPublicInfo } from './project.js';
import { releaseMenu } from './release.js';
import { agentInit, agentDeploy, agentStatus, agentConfigSet, agentConfigGet, agentLogs, agentRestart, agentMenu } from './agent.js';
import {
  ensureRegistered, safeRequest, buildAuthFetch, handleRequestError,
  uploadArtifact, printProjectList, printAdminsList, printLogs, printReleasesList
} from './utils.js';
import type { MandalaConfig, MandalaConfigInfo, ProjectListing, AdminInfo, DeployInfo, AccountingRecord } from './types.js';

program
  .name('mandala')
  .description('Mandala CLI — Deploy agents and overlays on the Mandala Network')
  .version('1.0.0');

// ─── Config Commands ───────────────────────────────────────────────────────────

const configCommand = program
  .command('config')
  .description('Manage Mandala configurations');

configCommand
  .command('ls')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .description('List all configurations')
  .action(async (options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    const info = loadMandalaConfigInfo();
    printAllConfigsWithIndex(info);
  });

configCommand
  .command('add')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .description('Add a new Mandala configuration')
  .action(async (options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    const info = loadMandalaConfigInfo();
    await addMandalaConfigInteractive(info);
  });

configCommand
  .command('edit <nameOrIndex>')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .description('Edit a Mandala configuration')
  .action(async (nameOrIndex, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    const info = loadMandalaConfigInfo();
    const cfg = findConfigByNameOrIndex(info, nameOrIndex);
    if (!cfg) { console.error(chalk.red(`Configuration "${nameOrIndex}" not found.`)); process.exit(1); }
    if (!isMandalaConfig(cfg)) { console.error(chalk.red(`Configuration "${nameOrIndex}" is not a Mandala configuration.`)); process.exit(1); }
    await editMandalaConfigInteractive(info, cfg);
  });

configCommand
  .command('delete <nameOrIndex>')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .description('Delete a Mandala configuration')
  .action(async (nameOrIndex, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    const info = loadMandalaConfigInfo();
    const cfg = findConfigByNameOrIndex(info, nameOrIndex);
    if (!cfg) { console.error(chalk.red(`Configuration "${nameOrIndex}" not found.`)); process.exit(1); }
    if (!isMandalaConfig(cfg)) { console.error(chalk.red(`Configuration "${nameOrIndex}" is not a Mandala configuration.`)); process.exit(1); }
    deleteMandalaConfig(info, cfg);
  });

configCommand
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .action(async (options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    await configMenu();
  });

// ─── Build Command ─────────────────────────────────────────────────────────────

program
  .command('build [nameOrIndex]')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .description('Build local artifact for release')
  .action(async (nameOrIndex, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    await buildArtifact(nameOrIndex);
  });

// ─── Project Commands ──────────────────────────────────────────────────────────

const projectCommand = program
  .command('project')
  .description('Manage projects');

projectCommand
  .command('ls [nameOrIndex]')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .description('List all projects on a Mandala Node')
  .action(async (nameOrIndex, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    const info = loadMandalaConfigInfo();
    const chosenURL = await chooseMandalaCloudURL(info, nameOrIndex);
    await ensureRegistered({ provider: 'mandala', MandalaCloudURL: chosenURL, name: 'mandala' });
    try {
      const result = await authFetch.fetch(`${chosenURL}/api/v1/project/list`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      });
      const resultJson = await result.json();
      printProjectList(resultJson.projects);
    } catch (e: any) {
      handleRequestError(e, 'Failed to list projects');
    }
  });

projectCommand
  .command('info [nameOrIndex]')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .description('Show detailed info about a project')
  .action(async (nameOrIndex, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    const info = loadMandalaConfigInfo();
    const cfg = await pickMandalaConfig(info, nameOrIndex);
    await showProjectInfo(cfg);
  });

projectCommand
  .command('add-admin <identityKeyOrEmail> [nameOrIndex]')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .description('Add an admin to the project')
  .action(async (identityKeyOrEmail, nameOrIndex, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    const info = loadMandalaConfigInfo();
    const cfg = await pickMandalaConfig(info, nameOrIndex);
    if (!cfg.projectID) { console.error(chalk.red('No project ID set.')); process.exit(1); }
    const client = await buildAuthFetch(cfg);
    const result = await safeRequest(client, cfg.MandalaCloudURL, `/api/v1/project/${cfg.projectID}/addAdmin`, { identityKeyOrEmail });
    if (result.message) { console.log(chalk.green(`${result.message}`)); }
    else { console.error(chalk.red(`${result.error || 'Could not add project admin.'}`)); }
  });

projectCommand
  .command('remove-admin <identityKeyOrEmail> [nameOrIndex]')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .description('Remove an admin from the project')
  .action(async (identityKeyOrEmail, nameOrIndex, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    const info = loadMandalaConfigInfo();
    const cfg = await pickMandalaConfig(info, nameOrIndex);
    if (!cfg.projectID) { console.error(chalk.red('No project ID set.')); process.exit(1); }
    const client = await buildAuthFetch(cfg);
    const rmResult = await safeRequest(client, cfg.MandalaCloudURL, `/api/v1/project/${cfg.projectID}/removeAdmin`, { identityKeyOrEmail });
    if (rmResult.message) { console.log(chalk.green(`${rmResult.message}`)); }
    else { console.error(chalk.red(`${rmResult.error || 'Could not remove project admin.'}`)); }
  });

projectCommand
  .command('list-admins [nameOrIndex]')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .description('List the admins for the project')
  .action(async (nameOrIndex, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    const info = loadMandalaConfigInfo();
    const cfg = await pickMandalaConfig(info, nameOrIndex);
    if (!cfg.projectID) { console.error(chalk.red('No project ID set.')); process.exit(1); }
    const client = await buildAuthFetch(cfg);
    const result = await safeRequest<{ admins: AdminInfo[] }>(client, cfg.MandalaCloudURL, `/api/v1/project/${cfg.projectID}/admins/list`, {});
    if (result && result.admins) printAdminsList(result.admins);
  });

projectCommand
  .command('logs [nameOrIndex]')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .description('View project logs')
  .action(async (nameOrIndex, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    const info = loadMandalaConfigInfo();
    const cfg = await pickMandalaConfig(info, nameOrIndex);
    if (!cfg.projectID) { console.error(chalk.red('No project ID set.')); process.exit(1); }
    const client = await buildAuthFetch(cfg);
    const result = await safeRequest<{ logs: string }>(client, cfg.MandalaCloudURL, `/api/v1/project/${cfg.projectID}/logs/project`, {});
    if (result) printLogs(result.logs, 'Project Logs');
  });

projectCommand
  .command('resource-logs [nameOrIndex]')
  .description('View resource logs')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .option('--resource <resource>', 'Resource type: frontend|backend|mongo|mysql')
  .option('--since <period>', 'Time period', '1h')
  .option('--tail <lines>', 'Number of lines', '1000')
  .option('--level <level>', 'Log level: all|error|warn|info', 'all')
  .action(async (nameOrIndex, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    const info = loadMandalaConfigInfo();
    const cfg = await pickMandalaConfig(info, nameOrIndex);
    await fetchResourceLogs(cfg, {
      resource: options.resource,
      since: options.since,
      tail: parseInt(options.tail, 10),
      level: options.level
    });
  });

projectCommand
  .command('releases [nameOrIndex]')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .description('List all releases for the project')
  .action(async (nameOrIndex, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    const info = loadMandalaConfigInfo();
    const cfg = await pickMandalaConfig(info, nameOrIndex);
    if (!cfg.projectID) { console.error(chalk.red('No project ID set.')); process.exit(1); }
    const client = await buildAuthFetch(cfg);
    const result = await safeRequest<{ deploys: DeployInfo[] }>(client, cfg.MandalaCloudURL, `/api/v1/project/${cfg.projectID}/deploys/list`, {});
    if (result && Array.isArray(result.deploys)) printReleasesList(result.deploys);
  });

projectCommand
  .command('domain:frontend <domain> [nameOrIndex]')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .description('Set the frontend custom domain (non-interactive)')
  .action(async (domain, nameOrIndex, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    const info = loadMandalaConfigInfo();
    const cfg = await pickMandalaConfig(info, nameOrIndex);
    // Use project's setCustomDomain via project module — inline for non-interactive
    if (!cfg.projectID) { console.error(chalk.red('No project ID.')); process.exit(1); }
    const client = await buildAuthFetch(cfg);
    try {
      let result: any = await client.fetch(`${cfg.MandalaCloudURL}/api/v1/project/${cfg.projectID}/domains/frontend`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain })
      });
      result = await result.json();
      if (result && result.domain) {
        console.log(chalk.green('Frontend custom domain set successfully.'));
      }
    } catch (error: any) {
      handleRequestError(error, 'Domain verification failed');
    }
  });

projectCommand
  .command('domain:backend <domain> [nameOrIndex]')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .description('Set the backend custom domain (non-interactive)')
  .action(async (domain, nameOrIndex, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    const info = loadMandalaConfigInfo();
    const cfg = await pickMandalaConfig(info, nameOrIndex);
    if (!cfg.projectID) { console.error(chalk.red('No project ID.')); process.exit(1); }
    const client = await buildAuthFetch(cfg);
    try {
      let result: any = await client.fetch(`${cfg.MandalaCloudURL}/api/v1/project/${cfg.projectID}/domains/backend`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain })
      });
      result = await result.json();
      if (result && result.domain) {
        console.log(chalk.green('Backend custom domain set successfully.'));
      }
    } catch (error: any) {
      handleRequestError(error, 'Domain verification failed');
    }
  });

projectCommand
  .command('webui-config:view [nameOrIndex]')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .description('View the current Web UI config')
  .action(async (nameOrIndex, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    const info = loadMandalaConfigInfo();
    const cfg = await pickMandalaConfig(info, nameOrIndex);
    if (!cfg.projectID) { console.error(chalk.red('No project ID.')); process.exit(1); }
    const client = await buildAuthFetch(cfg);
    const projectInfo = await safeRequest<any>(client, cfg.MandalaCloudURL, `/api/v1/project/${cfg.projectID}/info`, {});
    if (projectInfo && projectInfo.webUIConfig) {
      const Table = (await import('cli-table3')).default;
      const wtable = new Table({ head: ['Key', 'Value'] });
      Object.keys(projectInfo.webUIConfig).forEach(k => wtable.push([k, JSON.stringify(projectInfo.webUIConfig[k])]));
      console.log(wtable.toString());
    } else {
      console.log(chalk.yellow('No Web UI config found.'));
    }
  });

projectCommand
  .command('webui-config:set <configKey> <value> [nameOrIndex]')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .description('Set a key in the Web UI config')
  .action(async (configKey, value, nameOrIndex, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    const info = loadMandalaConfigInfo();
    const cfg = await pickMandalaConfig(info, nameOrIndex);
    if (!cfg.projectID) { console.error(chalk.red('No project ID.')); process.exit(1); }
    let parsedVal: any = value;
    try { parsedVal = JSON.parse(value); } catch (_) { }
    const client = await buildAuthFetch(cfg);
    const projectInfo = await safeRequest<any>(client, cfg.MandalaCloudURL, `/api/v1/project/${cfg.projectID}/info`, {});
    if (!projectInfo) return;
    const webUIConfig = projectInfo.webUIConfig || {};
    webUIConfig[configKey] = parsedVal;
    const resp = await safeRequest(client, cfg.MandalaCloudURL, `/api/v1/project/${cfg.projectID}/webui/config`, { config: webUIConfig });
    if (resp) console.log(chalk.green('Web UI config updated.'));
  });

projectCommand
  .command('webui-config:delete <configKey> [nameOrIndex]')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .description('Delete a key from the Web UI config')
  .action(async (configKey, nameOrIndex, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    const info = loadMandalaConfigInfo();
    const cfg = await pickMandalaConfig(info, nameOrIndex);
    if (!cfg.projectID) { console.error(chalk.red('No project ID.')); process.exit(1); }
    const client = await buildAuthFetch(cfg);
    const projectInfo = await safeRequest<any>(client, cfg.MandalaCloudURL, `/api/v1/project/${cfg.projectID}/info`, {});
    if (!projectInfo) return;
    const webUIConfig = projectInfo.webUIConfig || {};
    if (!(configKey in webUIConfig)) {
      console.log(chalk.yellow(`Key "${configKey}" not found in config.`));
      return;
    }
    delete webUIConfig[configKey];
    const resp = await safeRequest(client, cfg.MandalaCloudURL, `/api/v1/project/${cfg.projectID}/webui/config`, { config: webUIConfig });
    if (resp) console.log(chalk.green('Web UI config updated.'));
  });

projectCommand
  .command('billing-stats [nameOrIndex]')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .option('--start <date>', 'Start date (YYYY-MM-DD)')
  .option('--end <date>', 'End date (YYYY-MM-DD)')
  .option('--type <type>', 'Record type: all|debit|credit', 'all')
  .description('View billing statistics')
  .action(async (nameOrIndex, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    const info = loadMandalaConfigInfo();
    const cfg = await pickMandalaConfig(info, nameOrIndex);
    if (!cfg.projectID) { console.error(chalk.red('No project ID set.')); process.exit(1); }
    const data: any = {};
    if (options.start) data.start = new Date(options.start.trim()).toISOString();
    if (options.end) data.end = new Date(options.end.trim()).toISOString();
    if (options.type && options.type !== 'all') data.type = options.type;
    const client = await buildAuthFetch(cfg);
    const records = await safeRequest<{ records: AccountingRecord[] }>(client, cfg.MandalaCloudURL, `/api/v1/project/${cfg.projectID}/billing/stats`, data);
    if (!records) return;
    if (records.records.length === 0) {
      console.log(chalk.yellow('No billing records found.'));
      return;
    }
    const Table = (await import('cli-table3')).default;
    const table = new Table({ head: ['Timestamp', 'Type', 'Amount (sats)', 'Balance After', 'Metadata'] });
    records.records.forEach(r => {
      table.push([new Date(r.timestamp).toLocaleString(), r.type, r.amount_sats, r.balance_after, JSON.stringify(r.metadata, null, 2)]);
    });
    console.log(table.toString());
  });

projectCommand
  .command('topup [nameOrIndex]')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .option('--amount <sats>', 'Amount in satoshis')
  .description('Top up project balance')
  .action(async (nameOrIndex, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    const info = loadMandalaConfigInfo();
    const cfg = await pickMandalaConfig(info, nameOrIndex);
    if (!cfg.projectID) { console.error(chalk.red('No project ID set.')); process.exit(1); }
    let amount = options.amount ? parseInt(options.amount, 10) : undefined;
    if (!amount || amount <= 0) {
      const answers = await inquirer.prompt([
        { type: 'number', name: 'amount', message: 'Enter amount in satoshis:', validate: (val: number) => val > 0 ? true : 'Amount must be positive.' }
      ]);
      amount = answers.amount;
    }
    const client = await buildAuthFetch(cfg);
    const result = await safeRequest(client, cfg.MandalaCloudURL, `/api/v1/project/${cfg.projectID}/pay`, { amount });
    if (result) console.log(chalk.green(`Balance topped up by ${amount} sats.`));
  });

projectCommand
  .command('delete [nameOrIndex]')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .option('--force', 'Skip confirmation')
  .description('Delete the project (cannot be undone)')
  .action(async (nameOrIndex, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    const info = loadMandalaConfigInfo();
    const cfg = await pickMandalaConfig(info, nameOrIndex);
    if (!cfg.projectID) { console.error(chalk.red('No project ID set.')); process.exit(1); }
    if (!options.force) {
      const { confirm } = await inquirer.prompt([
        { type: 'confirm', name: 'confirm', message: 'Are you ABSOLUTELY SURE you want to delete this project?', default: false }
      ]);
      if (!confirm) return;
      const { confirmAgain } = await inquirer.prompt([
        { type: 'confirm', name: 'confirmAgain', message: 'Really delete the entire project permanently?', default: false }
      ]);
      if (!confirmAgain) return;
    }
    const client = await buildAuthFetch(cfg);
    const result = await safeRequest(client, cfg.MandalaCloudURL, `/api/v1/project/${cfg.projectID}/delete`, {});
    if (result) console.log(chalk.green('Project deleted.'));
  });

projectCommand
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .action(async (options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    await projectMenu();
  });

// ─── Release Commands ──────────────────────────────────────────────────────────

const releaseCommand = program
  .command('release')
  .description('Manage releases');

releaseCommand
  .command('get-upload-url [nameOrIndex]')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .description('Create a new release and get the upload URL')
  .action(async (nameOrIndex, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    const info = loadMandalaConfigInfo();
    const cfg = await pickMandalaConfig(info, nameOrIndex);
    if (!cfg.projectID) { console.error(chalk.red('No project ID set.')); process.exit(1); }
    const client = await buildAuthFetch(cfg);
    const result = await safeRequest<{ url: string, deploymentId: string }>(client, cfg.MandalaCloudURL, `/api/v1/project/${cfg.projectID}/deploy`, {});
    if (result && result.url && result.deploymentId) {
      console.log(chalk.green(`Release created. Release ID: ${result.deploymentId}`));
      console.log(`Upload URL: ${result.url}`);
    }
  });

releaseCommand
  .command('upload-files <uploadURL> <artifactPath>')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .description('Upload an artifact to the given URL')
  .action(async (uploadURL, artifactPath, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    await uploadArtifact(uploadURL, artifactPath);
  });

releaseCommand
  .command('logs [releaseId] [nameOrIndex]')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .description('View logs of a release')
  .action(async (releaseId, nameOrIndex, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    const info = loadMandalaConfigInfo();
    const cfg = await pickMandalaConfig(info, nameOrIndex);
    if (!cfg.projectID) { console.error(chalk.red('No project ID set.')); process.exit(1); }
    const finalReleaseId = await pickReleaseId(cfg, releaseId);
    if (!finalReleaseId) return;
    const client = await buildAuthFetch(cfg);
    const result = await safeRequest<{ logs: string }>(client, cfg.MandalaCloudURL, `/api/v1/project/${cfg.projectID}/logs/deployment/${finalReleaseId}`, {});
    if (result) printLogs(result.logs, 'Release Logs');
  });

releaseCommand
  .command('now [nameOrIndex]')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .description('Create a new release and upload the latest artifact')
  .action(async (nameOrIndex, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    const info = loadMandalaConfigInfo();
    const cfg = await pickMandalaConfig(info, nameOrIndex);
    if (!cfg.projectID) { console.error(chalk.red('No project ID set.')); process.exit(1); }
    const artifactPath = findLatestArtifact();
    const client = await buildAuthFetch(cfg);
    const result = await safeRequest<{ url: string, deploymentId: string }>(client, cfg.MandalaCloudURL, `/api/v1/project/${cfg.projectID}/deploy`, {});
    if (result && result.url && result.deploymentId) {
      await uploadArtifact(result.url, artifactPath);
    }
  });

releaseCommand
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .action(async (options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    await releaseMenu();
  });

// ─── Artifact Commands ─────────────────────────────────────────────────────────

const artifactCommand = program
  .command('artifact')
  .description('Manage Mandala artifacts');

artifactCommand
  .command('ls')
  .description('List all local artifacts')
  .action(() => { printArtifactsList(); });

artifactCommand
  .command('delete <artifactName>')
  .description('Delete a local artifact')
  .action(async (artifactName) => {
    const artifacts = findArtifacts();
    if (!artifacts.includes(artifactName)) {
      console.error(chalk.red(`Artifact "${artifactName}" not found.`));
      process.exit(1);
    }
    fs.unlinkSync(artifactName);
    console.log(chalk.green(`Artifact "${artifactName}" deleted.`));
  });

artifactCommand.action(async () => { await artifactMenu(); });

// ─── Global Info Command ───────────────────────────────────────────────────────

program
  .command('global-info [nameOrIndex]')
  .description('View global public info (public keys, pricing)')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .action(async (nameOrIndex, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    await showGlobalPublicInfo();
  });

// ─── Agent Commands (NEW) ──────────────────────────────────────────────────────

const agentCommand = program
  .command('agent')
  .description('Manage AI agents on the Mandala Network');

agentCommand
  .command('init')
  .description('Initialize a new agent-manifest.json')
  .action(async () => { await agentInit(); });

agentCommand
  .command('deploy [configName]')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .description('Deploy the agent to the Mandala Network')
  .action(async (configName, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    await agentDeploy(configName);
  });

agentCommand
  .command('status [configName]')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .description('View the agent deployment status')
  .action(async (configName, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    await agentStatus(configName);
  });

const agentConfigCommand = agentCommand
  .command('config')
  .description('Manage agent configuration');

agentConfigCommand
  .command('set <configKey> <value> [configName]')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .description('Set an agent config key')
  .action(async (configKey, value, configName, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    await agentConfigSet(configKey, value, configName);
  });

agentConfigCommand
  .command('get [configName]')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .description('View agent configuration')
  .action(async (configName, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    await agentConfigGet(configName);
  });

agentCommand
  .command('logs [configName]')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .option('--since <period>', 'Time period', '1h')
  .option('--tail <lines>', 'Number of lines', '1000')
  .option('--level <level>', 'Log level: all|error|warn|info', 'all')
  .description('View agent logs')
  .action(async (configName, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    await agentLogs(configName, {
      since: options.since,
      tail: parseInt(options.tail, 10),
      level: options.level
    });
  });

agentCommand
  .command('restart [configName]')
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .description('Restart the agent')
  .action(async (configName, options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    await agentRestart(configName);
  });

agentCommand
  .option('--key <key>', 'Private key')
  .option('--network <network>', 'Network')
  .option('--storage <storage>', 'Wallet storage')
  .action(async (options) => {
    if (options.key) await remakeWallet(options.key, options.network, options.storage);
    await agentMenu();
  });

// ─── Main Menu ─────────────────────────────────────────────────────────────────

async function mainMenu() {
  console.log(chalk.cyanBright('\nWelcome to Mandala CLI'));
  console.log(chalk.cyan('Deploy agents and overlays on the Mandala Network\n'));

  const choices = [
    { name: 'Manage Agents', value: 'agent' },
    { name: 'Manage Mandala Configurations', value: 'config' },
    { name: 'Manage Projects', value: 'project' },
    { name: 'Manage Releases', value: 'release' },
    { name: 'Manage Artifacts', value: 'artifact' },
    { name: 'View Global Info (Public Keys, Pricing)', value: 'global-info' },
    { name: 'Build Artifact', value: 'build' },
    { name: 'Exit', value: 'exit' }
  ];

  let done = false;
  while (!done) {
    const { action } = await inquirer.prompt([
      { type: 'list', name: 'action', message: 'Main Menu', choices }
    ]);

    if (action === 'agent') {
      await agentMenu();
    } else if (action === 'config') {
      await configMenu();
    } else if (action === 'project') {
      await projectMenu();
    } else if (action === 'release') {
      await releaseMenu();
    } else if (action === 'artifact') {
      await artifactMenu();
    } else if (action === 'global-info') {
      await showGlobalPublicInfo();
    } else if (action === 'build') {
      await buildArtifact();
    } else {
      done = true;
    }
  }
}

// ─── Entry Point ───────────────────────────────────────────────────────────────

const MANDALA_CONFIG_PATH = path.resolve(process.cwd(), 'mandala.json');
const LEGACY_CONFIG_PATH = path.resolve(process.cwd(), 'deployment-info.json');
const AGENT_MANIFEST_PATH = path.resolve(process.cwd(), 'agent-manifest.json');

(async function main() {
  if (process.argv.length <= 2) {
    // Auto-detect context
    const hasAgentManifest = fs.existsSync(AGENT_MANIFEST_PATH);
    const hasConfig = fs.existsSync(MANDALA_CONFIG_PATH) || fs.existsSync(LEGACY_CONFIG_PATH);

    if (!hasConfig && !hasAgentManifest) {
      // Nothing found — ask what they want to do
      const { mode } = await inquirer.prompt([
        {
          type: 'list',
          name: 'mode',
          message: 'No configuration found. What would you like to do?',
          choices: [
            { name: 'Initialize an Agent (agent-manifest.json)', value: 'agent-init' },
            { name: 'Create an Overlay/App configuration (mandala.json)', value: 'overlay-init' }
          ]
        }
      ]);

      if (mode === 'agent-init') {
        await agentInit();
      } else {
        const basicInfo = { schema: 'bsv-app', schemaVersion: '1.0' };
        saveMandalaConfigInfo(basicInfo);
        const info = loadMandalaConfigInfo();
        await addMandalaConfigInteractive(info);
      }
    }

    await mainMenu();
  } else {
    program.parse(process.argv);
  }
})();
