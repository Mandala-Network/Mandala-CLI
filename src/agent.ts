import fs from 'fs';
import path from 'path';
import * as tar from 'tar';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import Table from 'cli-table3';
import { spawn } from 'child_process';
import { loadMandalaConfigInfo, tryLoadMandalaConfigInfo, saveMandalaConfigInfo, pickMandalaConfig, chooseMandalaCloudURL, isMandalaConfig, addMandalaConfigInteractive } from './config.js';
import { ensureRegistered, safeRequest, buildAuthFetch, handleRequestError, uploadArtifact } from './utils.js';
import { authFetch, walletClient } from './wallet.js';
import { PrivateKey, PublicKey, P2PKH } from '@bsv/sdk';
import type { AgentManifest, MandalaConfig, MandalaConfigInfo, ProjectInfo, ProjectListing } from './types.js';
import { VALID_LOG_PERIODS, VALID_LOG_LEVELS, MAX_TAIL_LINES } from './types.js';
import type { LogPeriod, LogLevel } from './types.js';

const MANIFEST_FILE = 'agent-manifest.json';

function loadAgentManifest(): AgentManifest {
  const manifestPath = path.resolve(process.cwd(), MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) {
    console.error(chalk.red(`No ${MANIFEST_FILE} found in the current directory.`));
    console.error(chalk.yellow(`Run "mandala agent init" to create one.`));
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  if (manifest.schema !== 'mandala-agent') {
    console.error(chalk.red(`Invalid manifest schema: "${manifest.schema}". Expected "mandala-agent".`));
    process.exit(1);
  }
  return manifest;
}

function tryLoadAgentManifest(): AgentManifest | null {
  const manifestPath = path.resolve(process.cwd(), MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  if (manifest.schema !== 'mandala-agent') return null;
  return manifest;
}

function tryResolveDeploymentConfig(manifest: AgentManifest, configName?: string): { cloudUrl: string; projectID: string; network: string } | null {
  const deployments = manifest.deployments || [];

  // If configName provided, try mandala.json config
  if (configName) {
    const info = tryLoadMandalaConfigInfo();
    if (info) {
      const all = info.configs || [];
      const cfg = all.find(c => c.name === configName) || all[parseInt(configName, 10)];
      if (cfg && isMandalaConfig(cfg) && cfg.MandalaCloudURL && cfg.projectID) {
        return { cloudUrl: cfg.MandalaCloudURL, projectID: cfg.projectID, network: cfg.network || 'mainnet' };
      }
    }
  }

  // Try manifest deployments
  if (deployments.length === 1) {
    const d = deployments[0];
    if (d.MandalaCloudURL && d.projectID) {
      return { cloudUrl: d.MandalaCloudURL, projectID: d.projectID, network: d.network || 'mainnet' };
    }
  }

  // No configName provided, try mandala.json
  if (!configName) {
    const info = tryLoadMandalaConfigInfo();
    if (info) {
      const mandalaConfigs = (info.configs || []).filter(c => isMandalaConfig(c) && c.MandalaCloudURL && c.projectID);
      if (mandalaConfigs.length === 1) {
        const c = mandalaConfigs[0];
        return { cloudUrl: c.MandalaCloudURL!, projectID: c.projectID!, network: c.network || 'mainnet' };
      }
    }
  }

  return null;
}

async function checkProjectBalance(cloudUrl: string, projectID: string): Promise<number> {
  const config: MandalaConfig = { name: 'balance-check', provider: 'mandala', MandalaCloudURL: cloudUrl, projectID };
  await ensureRegistered(config);
  const client = await buildAuthFetch(config);
  const info = await safeRequest<ProjectInfo>(client, cloudUrl, `/api/v1/project/${projectID}/info`, {});
  if (!info || !info.billing) return 0;
  return info.billing.balance;
}

function ensureManifestDeploymentEntry(manifest: AgentManifest, cloudUrl: string, projectID: string, network: string): void {
  if (!manifest.deployments) manifest.deployments = [];
  const existing = manifest.deployments.find(
    d => d.MandalaCloudURL === cloudUrl && d.projectID === projectID
  );
  if (existing) return;
  manifest.deployments.push({ provider: 'mandala', MandalaCloudURL: cloudUrl, projectID, network });
  const manifestPath = path.resolve(process.cwd(), MANIFEST_FILE);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(chalk.cyan('Updated agent-manifest.json with deployment entry.'));
}

async function resolveDeploymentConfig(manifest: AgentManifest, configName?: string): Promise<{ cloudUrl: string; projectID: string; network: string }> {
  const deployments = manifest.deployments || [];

  // If configName provided, try to find matching deployment or use mandala.json config
  if (configName) {
    try {
      const info = loadMandalaConfigInfo();
      const config = await pickMandalaConfig(info, configName);
      return {
        cloudUrl: config.MandalaCloudURL!,
        projectID: config.projectID!,
        network: config.network || 'mainnet'
      };
    } catch {
      // Fall through to manifest deployments
    }
  }

  // Try manifest deployments
  if (deployments.length === 1) {
    const d = deployments[0];
    if (!d.MandalaCloudURL || !d.projectID) {
      console.error(chalk.red('Deployment in manifest is missing MandalaCloudURL or projectID.'));
      process.exit(1);
    }
    return { cloudUrl: d.MandalaCloudURL, projectID: d.projectID, network: d.network || 'mainnet' };
  }

  if (deployments.length > 1) {
    const { chosenIndex } = await inquirer.prompt([
      {
        type: 'list',
        name: 'chosenIndex',
        message: 'Select a deployment target:',
        choices: deployments.map((d, i) => ({
          name: `${d.provider} - ${d.MandalaCloudURL || 'no URL'} (project: ${d.projectID || 'none'})`,
          value: i
        }))
      }
    ]);
    const d = deployments[chosenIndex];
    if (!d.MandalaCloudURL || !d.projectID) {
      console.error(chalk.red('Selected deployment is missing MandalaCloudURL or projectID.'));
      process.exit(1);
    }
    return { cloudUrl: d.MandalaCloudURL, projectID: d.projectID, network: d.network || 'mainnet' };
  }

  // No deployments in manifest, try mandala.json
  try {
    const info = loadMandalaConfigInfo();
    const config = await pickMandalaConfig(info);
    return {
      cloudUrl: config.MandalaCloudURL!,
      projectID: config.projectID!,
      network: config.network || 'mainnet'
    };
  } catch {
    console.error(chalk.red('No deployment configuration found. Add deployments to agent-manifest.json or create a Mandala config.'));
    process.exit(1);
  }
}

export async function agentInit(options?: { silent?: boolean }) {
  console.log(chalk.blue('Agent Manifest Initialization Wizard\n'));

  const { agentType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'agentType',
      message: 'Agent type:',
      choices: [
        { name: 'AGIdentity - Autonomous BSV wallet agent', value: 'agidentity' },
        { name: 'OpenClaw - General purpose AI agent', value: 'openclaw' },
        { name: 'Custom - Your own agent implementation', value: 'custom' }
      ]
    }
  ]);

  const { runtime } = await inquirer.prompt([
    {
      type: 'list',
      name: 'runtime',
      message: 'Runtime:',
      choices: ['node', 'python', 'docker'],
      default: 'node'
    }
  ]);

  const { cpu, memory } = await inquirer.prompt([
    { type: 'input', name: 'cpu', message: 'CPU limit (e.g. 500m, 1000m):', default: '500m' },
    { type: 'input', name: 'memory', message: 'Memory limit (e.g. 512Mi, 1Gi):', default: '512Mi' }
  ]);

  const { port } = await inquirer.prompt([
    { type: 'number', name: 'port', message: 'Primary port:', default: 3000 }
  ]);

  const { healthPath } = await inquirer.prompt([
    { type: 'input', name: 'healthPath', message: 'Health check path:', default: '/health' }
  ]);

  const { enableStorage } = await inquirer.prompt([
    { type: 'confirm', name: 'enableStorage', message: 'Enable persistent storage?', default: false }
  ]);

  let storageConfig: any = { enabled: false };
  if (enableStorage) {
    const { size, mountPath } = await inquirer.prompt([
      { type: 'input', name: 'size', message: 'Storage size:', default: '1Gi' },
      { type: 'input', name: 'mountPath', message: 'Mount path:', default: '/data' }
    ]);
    storageConfig = { enabled: true, size, mountPath };
  }

  const { enableMySQL, enableMongo, enableRedis } = await inquirer.prompt([
    { type: 'confirm', name: 'enableMySQL', message: 'Enable MySQL?', default: false },
    { type: 'confirm', name: 'enableMongo', message: 'Enable MongoDB?', default: false },
    { type: 'confirm', name: 'enableRedis', message: 'Enable Redis?', default: true }
  ]);

  const { wantDeployment } = await inquirer.prompt([
    { type: 'confirm', name: 'wantDeployment', message: 'Configure a Mandala Node deployment target now?', default: true }
  ]);

  let deployments: AgentManifest['deployments'] = [];
  if (wantDeployment) {
    // Pull defaults from mandala.json if it exists
    const existingConfig = tryLoadMandalaConfigInfo();
    const mandalaConfigs = (existingConfig?.configs || []).filter(c => isMandalaConfig(c) && c.MandalaCloudURL);
    const defaultCfg = mandalaConfigs.length === 1 ? mandalaConfigs[0] : undefined;

    if (defaultCfg) {
      console.log(chalk.cyan(`Found existing config "${defaultCfg.name}" in mandala.json`));
    }

    const { cloudUrl } = await inquirer.prompt([
      { type: 'input', name: 'cloudUrl', message: 'Mandala Node URL:', default: defaultCfg?.MandalaCloudURL || 'https://cars.babbage.systems' }
    ]);
    const { projectID } = await inquirer.prompt([
      { type: 'input', name: 'projectID', message: 'Project ID (leave empty to create later):', default: defaultCfg?.projectID || '' }
    ]);
    const { network } = await inquirer.prompt([
      { type: 'input', name: 'network', message: 'Network:', default: defaultCfg?.network || 'mainnet' }
    ]);
    deployments = [{
      provider: 'mandala',
      MandalaCloudURL: cloudUrl,
      projectID: projectID || undefined,
      network
    }];
  }

  // Environment variables -- offer type-specific defaults
  const envVars: Record<string, string> = {};

  if (agentType === 'agidentity') {
    console.log(chalk.blue('\nAGIdentity environment variables:'));
    const { keyAction } = await inquirer.prompt([
      {
        type: 'list',
        name: 'keyAction',
        message: 'AGENT_PRIVATE_KEY (hex private key for the agent wallet):',
        choices: [
          { name: 'Generate a new private key', value: 'generate' },
          { name: 'Enter an existing private key', value: 'manual' },
          { name: 'Skip (configure later)', value: 'skip' }
        ]
      }
    ]);

    let serverPrivateKey = '';
    if (keyAction === 'generate') {
      const key = PrivateKey.fromRandom();
      serverPrivateKey = key.toHex();
      console.log(chalk.green(`Generated private key: ${serverPrivateKey}`));
    } else if (keyAction === 'manual') {
      const { manualKey } = await inquirer.prompt([
        {
          type: 'input',
          name: 'manualKey',
          message: 'Enter hex private key:',
          validate: (val: string) => /^[0-9a-fA-F]{64}$/.test(val.trim()) ? true : 'Must be a 64-character hex string'
        }
      ]);
      serverPrivateKey = manualKey.trim();
    }
    const { agidModel } = await inquirer.prompt([
      {
        type: 'list',
        name: 'agidModel',
        message: 'AGID_MODEL (AI model to use):',
        choices: [
          { name: 'claude-sonnet-4-6', value: 'claude-sonnet-4-6' },
          { name: 'claude-opus-4-6', value: 'claude-opus-4-6' },
          { name: 'Other (enter manually)', value: 'custom' }
        ],
        default: 'claude-sonnet-4-6'
      }
    ]);

    let modelValue = agidModel;
    if (agidModel === 'custom') {
      const { customModel } = await inquirer.prompt([
        { type: 'input', name: 'customModel', message: 'Enter model identifier:' }
      ]);
      modelValue = customModel;
    }

    const { anthropicApiKey } = await inquirer.prompt([
      {
        type: 'password',
        name: 'anthropicApiKey',
        message: 'ANTHROPIC_API_KEY:',
        mask: '*'
      }
    ]);

    if (serverPrivateKey) envVars['AGENT_PRIVATE_KEY'] = serverPrivateKey;
    if (modelValue) envVars['AGID_MODEL'] = modelValue;
    if (anthropicApiKey) envVars['ANTHROPIC_API_KEY'] = anthropicApiKey;
  } else {
    const { configureEnv } = await inquirer.prompt([
      { type: 'confirm', name: 'configureEnv', message: 'Configure environment variables now?', default: false }
    ]);

    if (configureEnv) {
      let addMore = true;
      while (addMore) {
        const { key, value } = await inquirer.prompt([
          { type: 'input', name: 'key', message: 'Variable name:', validate: (v: string) => v.trim() ? true : 'Name is required' },
          { type: 'input', name: 'value', message: 'Variable value:' }
        ]);
        envVars[key.trim()] = value;
        const { another } = await inquirer.prompt([
          { type: 'confirm', name: 'another', message: 'Add another variable?', default: false }
        ]);
        addMore = another;
      }
    }
  }

  const manifest: AgentManifest = {
    schema: 'mandala-agent',
    schemaVersion: '1.0',
    agent: {
      type: agentType,
      runtime
    },
    env: envVars,
    resources: { cpu, memory },
    ports: [port],
    healthCheck: {
      path: healthPath,
      port,
      intervalSeconds: 30
    },
    frontend: null,
    storage: storageConfig,
    databases: {
      mysql: enableMySQL,
      mongo: enableMongo,
      redis: enableRedis
    },
    deployments
  };

  const manifestPath = path.resolve(process.cwd(), MANIFEST_FILE);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(chalk.green(`\nAgent manifest created: ${MANIFEST_FILE}`));
  if (!options?.silent) {
    console.log(chalk.cyan('Next steps:'));
    console.log(chalk.cyan('  1. Edit agent-manifest.json to add environment variables'));
    console.log(chalk.cyan('  2. Run "mandala agent deploy" to deploy your agent'));
  }
}

export async function agentDeploy(configName?: string) {
  // ── Stage 1: Ensure agent-manifest.json exists ──
  let manifest = tryLoadAgentManifest();
  if (!manifest) {
    console.log(chalk.yellow(`No ${MANIFEST_FILE} found in the current directory.`));
    const { createNow } = await inquirer.prompt([
      { type: 'confirm', name: 'createNow', message: 'Create one now?', default: true }
    ]);
    if (!createNow) {
      console.log(chalk.red('Cannot deploy without an agent manifest. Run "mandala agent init" first.'));
      return;
    }
    await agentInit({ silent: true });
    manifest = tryLoadAgentManifest();
    if (!manifest) {
      console.error(chalk.red('Failed to create agent manifest.'));
      return;
    }
  }

  // ── Stage 2: Ensure deployment config exists ──
  let resolved = tryResolveDeploymentConfig(manifest, configName);
  if (!resolved) {
    console.log(chalk.yellow('No deployment configuration found.'));
    let info = tryLoadMandalaConfigInfo();
    if (!info) {
      info = { schema: 'mandala-config', schemaVersion: '1.0', configs: [] };
      saveMandalaConfigInfo(info);
      console.log(chalk.cyan('Created mandala.json'));
    }

    // If there are multiple mandala configs and no configName, let the user pick
    const mandalaConfigs = (info.configs || []).filter(c => isMandalaConfig(c) && c.MandalaCloudURL && c.projectID);
    if (mandalaConfigs.length > 1 && !configName) {
      const config = await pickMandalaConfig(info);
      resolved = { cloudUrl: config.MandalaCloudURL!, projectID: config.projectID!, network: config.network || 'mainnet' };
    } else {
      console.log(chalk.cyan('Let\'s set up a deployment configuration.\n'));
      const newCfg = await addMandalaConfigInteractive(info, { projectType: 'agent' });
      resolved = { cloudUrl: newCfg.MandalaCloudURL!, projectID: newCfg.projectID!, network: newCfg.network || 'mainnet' };
    }
  }

  const { cloudUrl, projectID, network } = resolved;

  // ── Stage 3: Ensure manifest has deployment entry ──
  ensureManifestDeploymentEntry(manifest, cloudUrl, projectID, network);

  // ── Stage 4: Check project balance ──
  const balance = await checkProjectBalance(cloudUrl, projectID);
  if (balance < 1) {
    console.log(chalk.yellow(`Project balance is ${balance} sats. You need to top up before deploying.`));
    const { topupAmount } = await inquirer.prompt([
      { type: 'number', name: 'topupAmount', message: 'Enter amount in satoshis to add:', default: 10000, validate: (val: number) => val > 0 ? true : 'Amount must be positive.' }
    ]);
    const topupConfig: MandalaConfig = { name: 'topup', provider: 'mandala', MandalaCloudURL: cloudUrl, projectID, network };
    await ensureRegistered(topupConfig);
    const topupClient = await buildAuthFetch(topupConfig);
    const topupResult = await safeRequest(topupClient, cloudUrl, `/api/v1/project/${projectID}/pay`, { amount: topupAmount });
    if (topupResult) {
      console.log(chalk.green(`Balance topped up by ${topupAmount} sats.`));
    } else {
      console.error(chalk.red('Failed to top up balance.'));
      const { continueAnyway } = await inquirer.prompt([
        { type: 'confirm', name: 'continueAnyway', message: 'Continue with deployment anyway?', default: false }
      ]);
      if (!continueAnyway) return;
    }
  }

  // ── Stage 5: Package, deploy, upload (existing logic) ──
  const config: MandalaConfig = { name: 'agent-deploy', provider: 'mandala', MandalaCloudURL: cloudUrl, projectID, network };
  await ensureRegistered(config);

  console.log(chalk.blue(`\nDeploying agent to ${cloudUrl} (project: ${projectID})...`));

  // Package cwd as tarball
  const spinner = ora('Packaging agent...').start();

  const artifactName = `mandala_agent_${Date.now()}.tgz`;
  const cwd = process.cwd();

  const excludePatterns = [
    'node_modules',
    '.git',
    'dist',
    '.env',
    '*.tgz',
    'mandala_artifact_*',
    'cars_artifact_*',
    'mandala_agent_*'
  ];

  await tar.create(
    {
      gzip: true,
      file: artifactName,
      cwd,
      filter: (filePath) => {
        const relative = filePath.startsWith('./') ? filePath.slice(2) : filePath;
        for (const pattern of excludePatterns) {
          if (pattern.includes('*')) {
            const prefix = pattern.replace('*', '');
            if (relative.startsWith(prefix)) return false;
          } else {
            if (relative === pattern || relative.startsWith(pattern + '/') || relative.startsWith(pattern + '\\')) return false;
          }
        }
        return true;
      }
    },
    ['.']
  );

  spinner.succeed('Agent packaged.');

  // Create deployment
  spinner.start('Creating deployment...');
  const client = await buildAuthFetch(config);
  const result = await safeRequest<{ url: string; deploymentId: string }>(
    client, cloudUrl, `/api/v1/project/${projectID}/deploy`, {}
  );

  if (!result || !result.url || !result.deploymentId) {
    spinner.fail('Failed to create deployment.');
    fs.unlinkSync(artifactName);
    return;
  }

  spinner.succeed(`Deployment created. ID: ${result.deploymentId}`);

  // Upload
  await uploadArtifact(result.url, artifactName);

  // Cleanup
  fs.unlinkSync(artifactName);

  console.log(chalk.green('\nAgent deployment initiated successfully.'));
  console.log(chalk.cyan(`Deployment ID: ${result.deploymentId}`));

  // Sync manifest env vars to server agent_config so they persist for later lookups
  if (manifest.env && Object.keys(manifest.env).length > 0) {
    await safeRequest(client, cloudUrl, `/api/v1/project/${projectID}/settings/update`, {
      env: manifest.env
    });
  }

  // Derive and display the agent's public key from the manifest env
  const agentPrivateKeyHex = manifest.env?.['AGENT_PRIVATE_KEY'];
  if (agentPrivateKeyHex && /^[0-9a-fA-F]{64}$/.test(agentPrivateKeyHex)) {
    try {
      const pk = PrivateKey.fromString(agentPrivateKeyHex);
      const publicKey = pk.toPublicKey().toString();
      console.log(chalk.cyan(`Agent Public Key: ${publicKey}`));
    } catch { /* ignore derivation errors */ }
  }

  console.log(chalk.cyan(`Use "mandala agent status" to check deployment progress.`));
}

export async function agentStatus(configName?: string) {
  let config: MandalaConfig;
  try {
    const manifest = loadAgentManifest();
    const { cloudUrl, projectID, network } = await resolveDeploymentConfig(manifest, configName);
    config = { name: 'agent-status', provider: 'mandala', MandalaCloudURL: cloudUrl, projectID, network };
  } catch {
    const info = loadMandalaConfigInfo();
    config = await pickMandalaConfig(info, configName);
  }

  await ensureRegistered(config);
  const client = await buildAuthFetch(config);

  const spinner = ora('Fetching agent status...').start();

  const info = await safeRequest<ProjectInfo>(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/info`, {});
  if (!info) {
    spinner.fail('Failed to fetch agent info.');
    return;
  }

  spinner.succeed('Agent status retrieved.');

  const table = new Table();
  table.push(['Project', `${info.name} (${info.id})`]);
  table.push(['Network', info.network]);
  table.push(['Online', info.status.online ? chalk.green('Yes') : chalk.red('No')]);
  table.push(['Last Checked', new Date(info.status.lastChecked).toLocaleString()]);
  table.push(['Current Deployment', info.status.deploymentId || 'None']);
  table.push(['Balance', `${info.billing.balance} sats`]);
  table.push(['SSL', info.sslEnabled ? 'Yes' : 'No']);
  if (info.status.domains.backend) {
    table.push(['Agent URL', info.status.domains.backend]);
  }
  if (info.customDomains.backend) {
    table.push(['Custom Domain', info.customDomains.backend]);
  }
  if (info.status.domains.frontend) {
    table.push(['Frontend URL', info.status.domains.frontend]);
  }
  console.log(table.toString());

  if (info.agentConfig) {
    console.log(chalk.blue('\nAgent Configuration:'));
    const configTable = new Table({ head: ['Key', 'Value'] });
    Object.entries(info.agentConfig).forEach(([k, v]) => configTable.push([k, v]));
    console.log(configTable.toString());
  }
}

export async function agentConfigSet(key: string, value: string, configName?: string) {
  let config: MandalaConfig;
  try {
    const manifest = loadAgentManifest();
    const { cloudUrl, projectID, network } = await resolveDeploymentConfig(manifest, configName);
    config = { name: 'agent-config', provider: 'mandala', MandalaCloudURL: cloudUrl, projectID, network };
  } catch {
    const info = loadMandalaConfigInfo();
    config = await pickMandalaConfig(info, configName);
  }

  await ensureRegistered(config);
  const client = await buildAuthFetch(config);

  const result = await safeRequest(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/settings/update`, {
    env: { [key]: value }
  });

  if (result) {
    console.log(chalk.green(`Agent config "${key}" set to "${value}".`));
  }
}

export async function agentConfigGet(configName?: string) {
  let config: MandalaConfig;
  try {
    const manifest = loadAgentManifest();
    const { cloudUrl, projectID, network } = await resolveDeploymentConfig(manifest, configName);
    config = { name: 'agent-config', provider: 'mandala', MandalaCloudURL: cloudUrl, projectID, network };
  } catch {
    const info = loadMandalaConfigInfo();
    config = await pickMandalaConfig(info, configName);
  }

  await ensureRegistered(config);
  const client = await buildAuthFetch(config);

  const info = await safeRequest<ProjectInfo>(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/info`, {});
  if (!info) return;

  if (info.agentConfig && Object.keys(info.agentConfig).length > 0) {
    const table = new Table({ head: ['Key', 'Value'] });
    Object.entries(info.agentConfig).forEach(([k, v]) => table.push([k, v]));
    console.log(table.toString());
  } else {
    console.log(chalk.yellow('No agent configuration found.'));
  }
}

export async function agentLogs(configName?: string, options?: { since?: string; tail?: number; level?: string }) {
  let config: MandalaConfig;
  try {
    const manifest = loadAgentManifest();
    const { cloudUrl, projectID, network } = await resolveDeploymentConfig(manifest, configName);
    config = { name: 'agent-logs', provider: 'mandala', MandalaCloudURL: cloudUrl, projectID, network };
  } catch {
    const info = loadMandalaConfigInfo();
    config = await pickMandalaConfig(info, configName);
  }

  await ensureRegistered(config);
  const client = await buildAuthFetch(config);

  const since = options?.since || '1h';
  const tail = Math.min(Math.max(1, options?.tail || 1000), MAX_TAIL_LINES);
  const level = options?.level || 'all';

  const result = await safeRequest<{ logs: string; metadata: any }>(
    client,
    config.MandalaCloudURL,
    `/api/v1/project/${config.projectID}/logs/resource/backend`,
    { since, tail, level }
  );

  if (result && typeof result.logs === 'string') {
    console.log(chalk.blue('Agent Logs:'));
    console.log(result.logs.trim() || chalk.yellow('No logs yet.'));
  }
}

export async function agentRestart(configName?: string) {
  let config: MandalaConfig;
  try {
    const manifest = loadAgentManifest();
    const { cloudUrl, projectID, network } = await resolveDeploymentConfig(manifest, configName);
    config = { name: 'agent-restart', provider: 'mandala', MandalaCloudURL: cloudUrl, projectID, network };
  } catch {
    const info = loadMandalaConfigInfo();
    config = await pickMandalaConfig(info, configName);
  }

  const { confirm } = await inquirer.prompt([
    { type: 'confirm', name: 'confirm', message: 'Are you sure you want to restart the agent?', default: false }
  ]);
  if (!confirm) return;

  await ensureRegistered(config);
  const client = await buildAuthFetch(config);

  const spinner = ora('Restarting agent...').start();
  const result = await safeRequest(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/admin/restart`, {});

  if (result) {
    spinner.succeed('Agent restart initiated.');
  } else {
    spinner.fail('Failed to restart agent.');
  }
}

export async function agentChat() {
  const info = tryLoadMandalaConfigInfo();
  if (!info || !info.configs?.length) {
    console.error(chalk.red('No mandala.json found. Run "mandala init" first.'));
    return;
  }

  const mandalaConfigs = info.configs.filter(c => isMandalaConfig(c) && c.MandalaCloudURL);
  const urls = [...new Set(mandalaConfigs.map(c => c.MandalaCloudURL!))];

  if (urls.length === 0) {
    console.error(chalk.red('No Mandala Node URLs configured. Run "mandala init" first.'));
    return;
  }

  const spinner = ora('Fetching deployed agents...').start();
  const agents: { name: string; projectID: string; publicKey: string; cloudUrl: string }[] = [];

  for (const cloudUrl of urls) {
    try {
      await ensureRegistered({ provider: 'mandala', MandalaCloudURL: cloudUrl, name: 'mandala' });
      const listResult = await safeRequest<{ projects: ProjectListing[] }>(
        authFetch, cloudUrl, '/api/v1/project/list', {}
      );
      if (!listResult?.projects) continue;

      for (const project of listResult.projects) {
        const config: MandalaConfig = {
          name: 'chat-lookup',
          provider: 'mandala',
          MandalaCloudURL: cloudUrl,
          projectID: project.id,
          network: project.network
        };
        const client = await buildAuthFetch(config);
        const projectInfo = await safeRequest<ProjectInfo>(
          client, cloudUrl, `/api/v1/project/${project.id}/info`, {}
        );
        if (!projectInfo?.agentConfig) continue;

        const privateKeyHex = projectInfo.agentConfig['AGENT_PRIVATE_KEY'];
        if (!privateKeyHex || !/^[0-9a-fA-F]{64}$/.test(privateKeyHex)) continue;

        try {
          const pk = PrivateKey.fromString(privateKeyHex);
          const publicKey = pk.toPublicKey().toString();
          agents.push({ name: project.name, projectID: project.id, publicKey, cloudUrl });
        } catch { /* skip invalid keys */ }
      }
    } catch { /* skip unreachable nodes */ }
  }

  spinner.stop();

  if (agents.length === 0) {
    console.error(chalk.yellow('No deployed agents with AGENT_PRIVATE_KEY found.'));
    return;
  }

  const { chosen } = await inquirer.prompt([{
    type: 'list',
    name: 'chosen',
    message: 'Select an agent to chat with:',
    choices: agents.map((a, i) => ({
      name: `${a.name} (${a.publicKey.slice(0, 10)}...)`,
      value: i
    }))
  }]);

  const agent = agents[chosen];
  console.log(chalk.blue(`\nStarting chat with ${agent.name}...\n`));

  const child = spawn('npx', ['agid', 'chat', agent.publicKey], { stdio: 'inherit' });
  await new Promise<void>((resolve) => child.on('close', () => resolve()));
}

export async function agentFund() {
  const info = tryLoadMandalaConfigInfo();
  if (!info || !info.configs?.length) {
    console.error(chalk.red('No mandala.json found. Run "mandala init" first.'));
    return;
  }

  const mandalaConfigs = info.configs.filter(c => isMandalaConfig(c) && c.MandalaCloudURL);
  const urls = [...new Set(mandalaConfigs.map(c => c.MandalaCloudURL!))];

  if (urls.length === 0) {
    console.error(chalk.red('No Mandala Node URLs configured. Run "mandala init" first.'));
    return;
  }

  const spinner = ora('Fetching deployed agents...').start();
  const agents: { name: string; projectID: string; publicKey: string; cloudUrl: string }[] = [];

  for (const cloudUrl of urls) {
    try {
      await ensureRegistered({ provider: 'mandala', MandalaCloudURL: cloudUrl, name: 'mandala' });
      const listResult = await safeRequest<{ projects: ProjectListing[] }>(
        authFetch, cloudUrl, '/api/v1/project/list', {}
      );
      if (!listResult?.projects) continue;

      for (const project of listResult.projects) {
        const config: MandalaConfig = {
          name: 'fund-lookup',
          provider: 'mandala',
          MandalaCloudURL: cloudUrl,
          projectID: project.id,
          network: project.network
        };
        const client = await buildAuthFetch(config);
        const projectInfo = await safeRequest<ProjectInfo>(
          client, cloudUrl, `/api/v1/project/${project.id}/info`, {}
        );
        if (!projectInfo?.agentConfig) continue;

        const privateKeyHex = projectInfo.agentConfig['AGENT_PRIVATE_KEY'];
        if (!privateKeyHex || !/^[0-9a-fA-F]{64}$/.test(privateKeyHex)) continue;

        try {
          const pk = PrivateKey.fromString(privateKeyHex);
          const publicKey = pk.toPublicKey().toString();
          agents.push({ name: project.name, projectID: project.id, publicKey, cloudUrl });
        } catch { /* skip invalid keys */ }
      }
    } catch { /* skip unreachable nodes */ }
  }

  spinner.stop();

  if (agents.length === 0) {
    console.error(chalk.yellow('No deployed agents with AGENT_PRIVATE_KEY found.'));
    return;
  }

  // Select agent
  let agent: typeof agents[0];
  if (agents.length === 1) {
    agent = agents[0];
    console.log(chalk.cyan(`Agent: ${agent.name} (${agent.publicKey.slice(0, 10)}...)`));
  } else {
    const { chosen } = await inquirer.prompt([{
      type: 'list',
      name: 'chosen',
      message: 'Select an agent to fund:',
      choices: agents.map((a, i) => ({
        name: `${a.name} (${a.publicKey.slice(0, 10)}...)`,
        value: i
      }))
    }]);
    agent = agents[chosen];
  }

  // Get amount
  const { amount } = await inquirer.prompt([{
    type: 'number',
    name: 'amount',
    message: 'Amount in satoshis to send to agent wallet:',
    default: 10000,
    validate: (val: number) => val > 0 ? true : 'Amount must be positive.'
  }]);

  // Derive locking script from agent's public key
  const pubKey = PublicKey.fromString(agent.publicKey);
  const lockingScript = new P2PKH().lock(pubKey.toHash());

  // Send payment from user's wallet to agent's address
  const fundSpinner = ora(`Sending ${amount} sats to ${agent.name}...`).start();
  try {
    await walletClient.createAction({
      outputs: [{
        lockingScript: lockingScript.toHex(),
        satoshis: amount,
        outputDescription: `Fund agent ${agent.name}`
      }],
      description: `Fund agent wallet: ${agent.name}`
    });
    fundSpinner.succeed(`Sent ${amount} sats to ${agent.name} (${agent.publicKey.slice(0, 10)}...)`);
  } catch (err: any) {
    fundSpinner.fail(`Failed to fund agent: ${err.message || err}`);
  }
}

export async function agentMenu() {
  const choices = [
    { name: 'Initialize Agent Manifest', value: 'init' },
    { name: 'Deploy Agent', value: 'deploy' },
    { name: 'Chat with Agent', value: 'chat' },
    { name: 'Fund Agent Wallet', value: 'fund' },
    { name: 'View Agent Status', value: 'status' },
    { name: 'Get Agent Config', value: 'config-get' },
    { name: 'Set Agent Config', value: 'config-set' },
    { name: 'View Agent Logs', value: 'logs' },
    { name: 'Restart Agent', value: 'restart' },
    { name: 'Back to main menu', value: 'back' }
  ];

  let done = false;
  while (!done) {
    const { action } = await inquirer.prompt([
      { type: 'list', name: 'action', message: 'Agent Management Menu', choices }
    ]);

    if (action === 'init') {
      await agentInit();
    } else if (action === 'deploy') {
      await agentDeploy();
    } else if (action === 'chat') {
      await agentChat();
    } else if (action === 'fund') {
      await agentFund();
    } else if (action === 'status') {
      await agentStatus();
    } else if (action === 'config-get') {
      await agentConfigGet();
    } else if (action === 'config-set') {
      const { key } = await inquirer.prompt([
        { type: 'input', name: 'key', message: 'Config key:', validate: (v: string) => v.trim() ? true : 'Key is required' }
      ]);
      const { value } = await inquirer.prompt([
        { type: 'input', name: 'value', message: 'Config value:' }
      ]);
      await agentConfigSet(key, value);
    } else if (action === 'logs') {
      await agentLogs();
    } else if (action === 'restart') {
      await agentRestart();
    } else {
      done = true;
    }
  }
}
