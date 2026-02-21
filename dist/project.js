import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import axios from 'axios';
import ora from 'ora';
import Table from 'cli-table3';
import { PrivateKey } from '@bsv/sdk';
import { authFetch, walletClient, remakeWallet } from './wallet.js';
import { loadMandalaConfigInfo, pickMandalaConfig, chooseMandalaCloudURL } from './config.js';
import { ensureRegistered, safeRequest, buildAuthFetch, handleRequestError, printProjectList, printAdminsList, printLogs, printReleasesList } from './utils.js';
import { VALID_LOG_PERIODS, VALID_LOG_LEVELS, MAX_TAIL_LINES } from './types.js';
function isValidLogPeriod(period) {
    return VALID_LOG_PERIODS.includes(period);
}
function isValidLogLevel(level) {
    return VALID_LOG_LEVELS.includes(level);
}
// Print domain instructions
function printDomainInstructions(projectID, domain, domainType) {
    console.log(chalk.blue('\nCustom Domain DNS Validation Instructions:'));
    console.log(`Please create a DNS TXT record at:   mandala_project.${domain}`);
    console.log(`With the exact value (no quotes):    "mandala-project-verification=${projectID}:${domainType}"`);
    console.log('Once this TXT record is in place, continue with validation.\n');
}
async function setCustomDomain(config, domainType, domain, interactive) {
    if (!config.projectID) {
        console.error(chalk.red('No project ID set in this configuration.'));
        return;
    }
    const client = await buildAuthFetch(config);
    if (interactive) {
        printDomainInstructions(config.projectID, domain, domainType);
        const { confirm } = await inquirer.prompt([
            { type: 'confirm', name: 'confirm', message: 'Ready to proceed?', default: true }
        ]);
        if (!confirm)
            return;
    }
    let retry = true;
    while (retry) {
        try {
            let result = await client.fetch(`${config.MandalaCloudURL}/api/v1/project/${config.projectID}/domains/${domainType}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ domain })
            });
            result = await result.json();
            if (result && result.domain) {
                console.log(chalk.green(`${domainType.charAt(0).toUpperCase() + domainType.slice(1)} custom domain set successfully.`));
                return;
            }
            else {
                throw new Error('No domain in response.');
            }
        }
        catch (error) {
            if (!interactive) {
                handleRequestError(error, 'Domain verification failed');
                return;
            }
            printDomainInstructions(config.projectID, domain, domainType);
            const { confirm } = await inquirer.prompt([
                { type: 'confirm', name: 'confirm', message: 'DNS not verified yet, allow some time to propagate. Try again now?', default: false }
            ]);
            if (!confirm) {
                retry = false;
            }
        }
    }
}
async function viewAndEditWebUIConfig(config) {
    if (!config.projectID) {
        console.error(chalk.red('No project ID set.'));
        return;
    }
    const client = await buildAuthFetch(config);
    const info = await safeRequest(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/info`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
    });
    if (!info)
        return;
    let webUIConfig = info.webUIConfig || {};
    let done = false;
    while (!done) {
        console.log(chalk.blue('\nCurrent Web UI Config:'));
        const table = new Table({ head: ['Key', 'Value'] });
        Object.keys(webUIConfig).forEach(k => table.push([k, JSON.stringify(webUIConfig[k])]));
        console.log(table.toString());
        const choices = [
            { name: 'Add/Update a key', value: 'update' },
            { name: 'Remove a key', value: 'remove' },
            { name: 'Done', value: 'done' }
        ];
        const { action } = await inquirer.prompt([
            { type: 'list', name: 'action', message: 'What do you want to do?', choices }
        ]);
        if (action === 'done') {
            done = true;
        }
        else if (action === 'update') {
            const { key } = await inquirer.prompt([
                { type: 'input', name: 'key', message: 'Enter the key:' }
            ]);
            const { val } = await inquirer.prompt([
                { type: 'input', name: 'val', message: 'Enter the value (JSON, string, number, etc.):' }
            ]);
            let parsedVal = val;
            try {
                parsedVal = JSON.parse(val);
            }
            catch (ignore) { }
            webUIConfig[key] = parsedVal;
        }
        else if (action === 'remove') {
            const keys = Object.keys(webUIConfig);
            if (keys.length === 0) {
                console.log(chalk.yellow('No keys to remove.'));
                continue;
            }
            const { keyToRemove } = await inquirer.prompt([
                { type: 'list', name: 'keyToRemove', message: 'Select a key to remove:', choices: keys }
            ]);
            delete webUIConfig[keyToRemove];
        }
        if (action !== 'done') {
            const resp = await safeRequest(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/webui/config`, { config: webUIConfig });
            if (resp) {
                console.log(chalk.green('Web UI config updated.'));
            }
        }
    }
}
async function viewBillingStats(config) {
    const client = await buildAuthFetch(config);
    const { start } = await inquirer.prompt([
        { type: 'input', name: 'start', message: 'Start time (YYYY-MM-DD or empty for none):', default: '' }
    ]);
    const { end } = await inquirer.prompt([
        { type: 'input', name: 'end', message: 'End time (YYYY-MM-DD or empty for none):', default: '' }
    ]);
    const { type } = await inquirer.prompt([
        { type: 'list', name: 'type', message: 'Type of records to show:', choices: ['all', 'debit', 'credit'], default: 'all' }
    ]);
    const data = {};
    if (start.trim())
        data.start = new Date(start.trim()).toISOString();
    if (end.trim())
        data.end = new Date(end.trim()).toISOString();
    if (type !== 'all')
        data.type = type;
    const records = await safeRequest(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/billing/stats`, data);
    if (!records)
        return;
    if (records.records.length === 0) {
        console.log(chalk.yellow('No billing records found for specified filters.'));
        return;
    }
    const table = new Table({ head: ['Timestamp', 'Type', 'Amount (sats)', 'Balance After', 'Metadata'] });
    records.records.forEach(r => {
        table.push([new Date(r.timestamp).toLocaleString(), r.type, r.amount_sats, r.balance_after, JSON.stringify(r.metadata, null, 2)]);
    });
    console.log(table.toString());
}
export async function showProjectInfo(config) {
    if (!config.projectID) {
        console.error(chalk.red('No project ID set.'));
        return;
    }
    const client = await buildAuthFetch(config);
    const info = await safeRequest(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/info`, {});
    if (!info)
        return;
    console.log(chalk.magentaBright(`\nProject "${info.name}" (ID: ${info.id}) Info:`));
    const table = new Table();
    table.push(['Network', info.network]);
    table.push(['Balance', info.billing.balance.toString()]);
    table.push(['Online', info.status.online ? 'Yes' : 'No']);
    table.push(['Last Checked', new Date(info.status.lastChecked).toLocaleString()]);
    table.push(['Current Deployment', info.status.deploymentId || 'None']);
    table.push(['SSL Enabled', info.sslEnabled ? 'Yes' : 'No']);
    table.push(['Frontend Domain', info.status.domains.frontend || info.customDomains.frontend || 'None']);
    table.push(['Backend Domain', info.status.domains.backend || info.customDomains.backend || 'None']);
    console.log(table.toString());
    if (info.webUIConfig) {
        console.log(chalk.blue('\nWeb UI Config:'));
        const wtable = new Table({ head: ['Key', 'Value'] });
        Object.keys(info.webUIConfig).forEach(k => wtable.push([k, JSON.stringify(info.webUIConfig[k])]));
        console.log(wtable.toString());
    }
    if (info.billing.balance < 50000) {
        console.log(chalk.yellow('Your balance is low. Consider topping up to prevent disruptions.'));
        const { confirm } = await inquirer.prompt([
            { type: 'confirm', name: 'confirm', message: 'Do you want to add funds now?', default: true }
        ]);
        if (confirm) {
            await topUpProjectBalance(config);
        }
    }
}
async function topUpProjectBalance(config) {
    if (!config.projectID) {
        console.error(chalk.red('No project ID set.'));
        return;
    }
    const { amount } = await inquirer.prompt([
        { type: 'number', name: 'amount', message: 'Enter amount in satoshis to add:', validate: (val) => val > 0 ? true : 'Amount must be positive.' }
    ]);
    const client = await buildAuthFetch(config);
    const result = await safeRequest(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/pay`, { amount });
    if (result) {
        console.log(chalk.green(`Balance topped up by ${amount} sats.`));
    }
}
async function deleteProject(config) {
    if (!config.projectID) {
        console.error(chalk.red('No project ID set.'));
        return;
    }
    const { confirm } = await inquirer.prompt([
        { type: 'confirm', name: 'confirm', message: 'Are you ABSOLUTELY CERTAIN that you want to delete this project (this cannot be undone)?', default: false }
    ]);
    if (!confirm)
        return;
    const { confirmAgain } = await inquirer.prompt([
        { type: 'confirm', name: 'confirmAgain', message: 'Really delete the entire project and all its data permanently?', default: false }
    ]);
    if (!confirmAgain)
        return;
    const client = await buildAuthFetch(config);
    const result = await safeRequest(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/delete`, {});
    if (result) {
        console.log(chalk.green('Project deleted.'));
    }
}
async function setupGitHubActionsWizard(config) {
    console.log(chalk.blue('\nStarting GitHub Actions Deployment Setup Wizard...'));
    if (!config.projectID || !config.MandalaCloudURL) {
        console.error(chalk.red('The selected configuration is missing a Project ID or Mandala Node URL.'));
        return;
    }
    const info = loadMandalaConfigInfo();
    const configIndex = (info.configs || []).findIndex(c => c.name === config.name && c.provider === config.provider && c.MandalaCloudURL === config.MandalaCloudURL && c.projectID === config.projectID);
    if (configIndex === -1) {
        console.error(chalk.red('Could not find the selected configuration. This is unexpected.'));
        return;
    }
    const spinner = ora('Generating a new private key for GitHub Actions...').start();
    const newPrivateKey = PrivateKey.fromRandom();
    const newKeyHex = newPrivateKey.toHex();
    const newIdentityKey = newPrivateKey.toPublicKey().toString();
    spinner.succeed('New private key generated.');
    spinner.start('Registering the new key with Mandala Node...');
    const originalWalletClient = walletClient;
    const originalAuthFetch = authFetch;
    try {
        await remakeWallet(newKeyHex, config.network);
        const registrationResponse = await authFetch.fetch(`${config.MandalaCloudURL}/api/v1/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}'
        });
        if (!registrationResponse.ok) {
            const errorBody = await registrationResponse.text();
            throw new Error(`Registration call failed with status ${registrationResponse.status}: ${errorBody}`);
        }
        spinner.succeed('New key registered with Mandala Node.');
    }
    catch (error) {
        spinner.fail('Failed to register the new key.');
        handleRequestError(error);
        return;
    }
    finally {
        // Restore original wallet - note: wallet.ts exports are mutable via module
        await remakeWallet(originalWalletClient, config.network);
    }
    spinner.start(`Adding the new key as an admin to project "${config.projectID}"...`);
    const addAdminResult = await safeRequest(authFetch, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/addAdmin`, { identityKeyOrEmail: newIdentityKey });
    if (addAdminResult && addAdminResult.message) {
        spinner.succeed('New key added as a project admin.');
    }
    else {
        spinner.fail('Failed to add the new key as a project admin.');
        console.error(chalk.red(addAdminResult?.error || 'Unknown error.'));
        return;
    }
    const { branch } = await inquirer.prompt([
        { type: 'input', name: 'branch', message: 'Enter the name of the branch to deploy from:', default: 'master' }
    ]);
    const yamlContent = `name: Deployment
on:
  push:
    branches:
      - ${branch.trim()}

jobs:
  build:
    name: Deploy
    runs-on: ubuntu-latest
    steps:
      - name: Check out code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install Mandala CLI globally
        run: npm i -g @bsv/mandala-cli@latest

      - name: Build artifact
        run: mandala build ${configIndex}

      - name: Release artifact
        run: mandala release now ${configIndex} --key "\${{ secrets.MANDALA_PRIVATE_KEY }}"
`;
    console.log(chalk.greenBright('\n--- GitHub Actions Setup Instructions ---'));
    console.log(chalk.bold('\nStep 1: Add Repository Secret'));
    console.log('Go to your GitHub repository settings page: Settings > Secrets and variables > Actions.');
    console.log('Click "New repository secret" and add the following:');
    console.log(chalk.cyan('Name:   ') + chalk.bold('MANDALA_PRIVATE_KEY'));
    console.log(chalk.cyan('Secret: '));
    console.log(chalk.magenta(newKeyHex));
    console.log(chalk.yellow('\nThis key allows GitHub Actions to deploy on your behalf. Keep it safe!'));
    console.log(chalk.bold('\nStep 2: Add Workflow File'));
    console.log('Create a file named ' + chalk.bold('.github/workflows/deploy.yaml') + ' in your repository with the following content:');
    console.log(chalk.gray('--------------------------------------------------'));
    console.log(chalk.white(yamlContent));
    console.log(chalk.gray('--------------------------------------------------'));
    const workflowsDir = path.join(process.cwd(), '.github', 'workflows');
    const deployFilePath = path.join(workflowsDir, 'deploy.yaml');
    if (fs.existsSync(deployFilePath)) {
        console.log(chalk.yellow(`\nA file already exists at ${deployFilePath}.`));
        console.log('Please update it manually with the content above if needed.');
    }
    else {
        const { createFile } = await inquirer.prompt([
            { type: 'confirm', name: 'createFile', message: `Create the ${chalk.bold('.github/workflows/deploy.yaml')} file automatically?`, default: true }
        ]);
        if (createFile) {
            try {
                fs.mkdirSync(workflowsDir, { recursive: true });
                fs.writeFileSync(deployFilePath, yamlContent, 'utf-8');
                console.log(chalk.green(`Successfully created ${deployFilePath}.`));
            }
            catch (error) {
                console.error(chalk.red('Failed to create workflow file.'));
                handleRequestError(error);
            }
        }
    }
    console.log(chalk.bold.green('\nAll set!'));
    console.log(`Commit and push the new workflow file. Any future pushes to the "${branch.trim()}" branch will now automatically deploy your project.`);
}
export async function showGlobalPublicInfo() {
    const info = loadMandalaConfigInfo();
    const chosenURL = await chooseMandalaCloudURL(info);
    const spinner = ora('Fetching global public info...').start();
    try {
        const res = await axios.get(`${chosenURL}/api/v1/public`);
        spinner.succeed('Fetched global info:');
        const data = res.data;
        console.log(chalk.blue('Mainnet Public Key:'), data.mainnetPublicKey);
        console.log(chalk.blue('Testnet Public Key:'), data.testnetPublicKey);
        console.log(chalk.blue('Pricing:'));
        const table = new Table({ head: ['Resource', 'Cost (per 5m)'] });
        table.push(['CPU (per core)', data.pricing.cpu_rate_per_5min + ' sat']);
        table.push(['Memory (per GB)', data.pricing.mem_rate_per_gb_5min + ' sat']);
        table.push(['Disk (per GB)', data.pricing.disk_rate_per_gb_5min + ' sat']);
        table.push(['Network (per GB)', data.pricing.net_rate_per_gb_5min + ' sat']);
        console.log(table.toString());
        console.log(chalk.blue('Project Deployment Domain:'), data.projectDeploymentDomain);
    }
    catch (error) {
        spinner.fail('Failed to fetch public info.');
        handleRequestError(error);
    }
}
async function editAdvancedEngineConfig(config) {
    if (!config.projectID) {
        console.error(chalk.red('No project ID set.'));
        return;
    }
    const client = await buildAuthFetch(config);
    const infoResp = await safeRequest(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/info`, {});
    if (!infoResp)
        return;
    let engineConfig = infoResp.engine_config || {};
    if (!engineConfig || typeof engineConfig !== 'object') {
        engineConfig = {};
    }
    let done = false;
    while (!done) {
        console.log(chalk.blue('\nCurrent Engine Config:'));
        console.log(JSON.stringify(engineConfig, null, 2));
        const choices = [
            { name: 'Toggle requestLogging', value: 'requestLogging' },
            { name: 'Toggle gaspSync', value: 'gaspSync' },
            { name: 'Toggle logTime', value: 'logTime' },
            { name: 'Set logPrefix', value: 'logPrefix' },
            { name: 'Toggle throwOnBroadcastFailure', value: 'throwFail' },
            { name: 'Toggle suppressDefaultSyncAdvertisements', value: 'suppressDefaultSyncAds' },
            { name: 'Edit syncConfiguration', value: 'syncConfig' },
            { name: 'Done', value: 'done' }
        ];
        const { action } = await inquirer.prompt([
            { type: 'list', name: 'action', message: 'Select an advanced config to edit:', choices }
        ]);
        if (action === 'done') {
            done = true;
        }
        else if (action === 'requestLogging') {
            engineConfig.requestLogging = !engineConfig.requestLogging;
        }
        else if (action === 'gaspSync') {
            engineConfig.gaspSync = !engineConfig.gaspSync;
        }
        else if (action === 'logTime') {
            engineConfig.logTime = !engineConfig.logTime;
        }
        else if (action === 'logPrefix') {
            const { prefix } = await inquirer.prompt([
                { type: 'input', name: 'prefix', message: 'Enter new log prefix:', default: engineConfig.logPrefix || '[MANDALA OVERLAY ENGINE] ' }
            ]);
            engineConfig.logPrefix = prefix;
        }
        else if (action === 'throwFail') {
            engineConfig.throwOnBroadcastFailure = !engineConfig.throwOnBroadcastFailure;
        }
        else if (action === 'suppressDefaultSyncAds') {
            engineConfig.suppressDefaultSyncAdvertisements = !(engineConfig.suppressDefaultSyncAdvertisements ?? true);
        }
        else if (action === 'syncConfig') {
            await editSyncConfiguration(engineConfig);
        }
        const updateResult = await safeRequest(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/settings/update`, { ...engineConfig });
        if (updateResult && updateResult.engineConfig) {
            engineConfig = updateResult.engineConfig;
            console.log(chalk.green('Engine settings updated successfully.'));
        }
        else {
            console.log(chalk.yellow('No update response or partial update.'));
        }
    }
}
async function editSyncConfiguration(engineConfig) {
    engineConfig.syncConfiguration = engineConfig.syncConfiguration || {};
    let done = false;
    while (!done) {
        console.log(chalk.blue('\nSync Configuration Menu'));
        const existingTopics = Object.keys(engineConfig.syncConfiguration);
        const topicChoices = existingTopics.map(t => {
            const val = engineConfig.syncConfiguration[t];
            let valDesc = '';
            if (val === false)
                valDesc = 'false';
            else if (val === 'SHIP')
                valDesc = 'SHIP';
            else if (Array.isArray(val))
                valDesc = JSON.stringify(val);
            else
                valDesc = `${val}`;
            return { name: `${t}: ${valDesc}`, value: t };
        });
        topicChoices.push({ name: 'Add new topic', value: 'addNewTopic' });
        topicChoices.push({ name: 'Back', value: 'back' });
        const { selectedTopic } = await inquirer.prompt([
            { type: 'list', name: 'selectedTopic', message: 'Select a topic to edit or add new:', choices: topicChoices }
        ]);
        if (selectedTopic === 'back') {
            done = true;
        }
        else if (selectedTopic === 'addNewTopic') {
            const { newTopic } = await inquirer.prompt([
                { type: 'input', name: 'newTopic', message: 'Enter the new topic name:' }
            ]);
            engineConfig.syncConfiguration[newTopic.trim()] = 'SHIP';
        }
        else {
            const topicVal = engineConfig.syncConfiguration[selectedTopic];
            const { action } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'action',
                    message: `Editing "${selectedTopic}" (current: ${JSON.stringify(topicVal)}). Choose an action:`,
                    choices: [
                        { name: 'Set to false (no sync)', value: 'false' },
                        { name: 'Set to SHIP (global discovery)', value: 'SHIP' },
                        { name: 'Set to array of custom endpoints', value: 'array' },
                        { name: 'Remove topic from the config', value: 'remove' },
                        { name: 'Cancel', value: 'cancel' }
                    ]
                }
            ]);
            if (action === 'remove') {
                delete engineConfig.syncConfiguration[selectedTopic];
            }
            else if (action === 'false') {
                engineConfig.syncConfiguration[selectedTopic] = false;
            }
            else if (action === 'SHIP') {
                engineConfig.syncConfiguration[selectedTopic] = 'SHIP';
            }
            else if (action === 'array') {
                const { endpoints } = await inquirer.prompt([
                    { type: 'input', name: 'endpoints', message: 'Enter comma-separated endpoints (e.g. https://peer1,https://peer2):' }
                ]);
                const splitted = endpoints.split(',').map((e) => e.trim()).filter((x) => !!x);
                engineConfig.syncConfiguration[selectedTopic] = splitted;
            }
        }
    }
}
async function triggerAdminEndpoint(config, endpoint, txid, outputIndex, service) {
    if (!config.projectID) {
        console.error(chalk.red('No project ID set.'));
        return;
    }
    const client = await buildAuthFetch(config);
    const route = endpoint === 'syncAdvertisements'
        ? `/api/v1/project/${config.projectID}/admin/syncAdvertisements`
        : endpoint === 'startGASPSync'
            ? `/api/v1/project/${config.projectID}/admin/startGASPSync`
            : `/api/v1/project/${config.projectID}/admin/evictOutpoint`;
    const spinner = ora(`Triggering admin endpoint: ${endpoint}...`).start();
    try {
        let resp = await client.fetch(`${config.MandalaCloudURL}${route}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: endpoint === 'evictOutpoint' ? JSON.stringify({ txid, outputIndex: Number(outputIndex) }) : '{}'
        });
        resp = await resp.json();
        spinner.succeed(`${endpoint} responded: ${JSON.stringify(resp)}`);
    }
    catch (error) {
        spinner.fail(`${endpoint} failed.`);
        handleRequestError(error);
    }
}
async function promptResourceLogParameters() {
    const { resource } = await inquirer.prompt([
        { type: 'list', name: 'resource', message: 'Select resource to view logs from:', choices: ['frontend', 'backend', 'mongo', 'mysql'] }
    ]);
    const { since } = await inquirer.prompt([
        { type: 'list', name: 'since', message: 'Select time period:', choices: [...VALID_LOG_PERIODS], default: '1h' }
    ]);
    const { tail } = await inquirer.prompt([
        { type: 'number', name: 'tail', message: 'Number of lines to tail (1-10000):', default: 1000, validate: (val) => val > 0 && val <= MAX_TAIL_LINES ? true : 'Invalid tail number' }
    ]);
    const { level } = await inquirer.prompt([
        { type: 'list', name: 'level', message: 'Select log level filter:', choices: [...VALID_LOG_LEVELS], default: 'all' }
    ]);
    return { resource, since: since, tail, level: level };
}
export async function fetchResourceLogs(config, params) {
    if (!config.projectID) {
        console.error(chalk.red('No project ID in configuration.'));
        return;
    }
    const finalParams = { ...params };
    if (!finalParams.resource || !['frontend', 'backend', 'mongo', 'mysql'].includes(finalParams.resource)) {
        const userParams = await promptResourceLogParameters();
        Object.assign(finalParams, userParams);
    }
    if (!isValidLogPeriod(finalParams.since || '1h')) {
        finalParams.since = '1h';
    }
    if (!isValidLogLevel(finalParams.level || 'all')) {
        finalParams.level = 'all';
    }
    const tailVal = Math.min(Math.max(1, Math.floor(finalParams.tail || 1000)), MAX_TAIL_LINES);
    const client = await buildAuthFetch(config);
    const result = await safeRequest(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/logs/resource/${finalParams.resource}`, { since: finalParams.since, tail: tailVal, level: finalParams.level });
    if (result && typeof result.logs === 'string') {
        printLogs(result.logs, `Resource ${finalParams.resource} Logs`);
    }
}
export async function pickReleaseId(config, providedReleaseId) {
    if (providedReleaseId)
        return providedReleaseId;
    const client = await buildAuthFetch(config);
    const result = await safeRequest(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/deploys/list`, {});
    if (!result || !Array.isArray(result.deploys) || result.deploys.length === 0) {
        console.log(chalk.yellow('No releases found. Cannot select a release ID.'));
        return undefined;
    }
    const { chosenRelease } = await inquirer.prompt([
        {
            type: 'list',
            name: 'chosenRelease',
            message: 'Select a release ID:',
            choices: result.deploys.map(d => ({
                name: `${d.deployment_uuid} (Created: ${new Date(d.created_at).toLocaleString()})`,
                value: d.deployment_uuid
            }))
        }
    ]);
    return chosenRelease;
}
export async function projectMenu() {
    const info = loadMandalaConfigInfo();
    const choices = [
        { name: 'List Projects', value: 'ls' },
        { name: 'View Project Info', value: 'info' },
        { name: 'Add Admin', value: 'add-admin' },
        { name: 'Remove Admin', value: 'remove-admin' },
        { name: 'List Admins', value: 'list-admins' },
        { name: 'View Project Logs', value: 'logs-project' },
        { name: 'View Resource (Runtime) Logs', value: 'logs-resource' },
        { name: 'List Releases', value: 'releases' },
        { name: 'Set Frontend Custom Domain', value: 'domain-frontend' },
        { name: 'Set Backend Custom Domain', value: 'domain-backend' },
        { name: 'View/Edit Web UI Config', value: 'webui-config' },
        { name: 'Billing: View Stats', value: 'billing-stats' },
        { name: 'Billing: Top Up Balance', value: 'topup' },
        { name: 'Delete Project', value: 'delete' },
        { name: 'Setup GitHub Actions Deployment', value: 'setup-github-actions' },
        { name: 'Edit Advanced Engine Config', value: 'edit-engine-config' },
        { name: 'Trigger admin syncAdvertisements', value: 'admin-sync-ads' },
        { name: 'Trigger admin startGASPSync', value: 'admin-start-gasp' },
        { name: 'Evict an outpoint', value: 'admin-evict' },
        { name: 'Back to main menu', value: 'back' }
    ];
    let done = false;
    while (!done) {
        const { action } = await inquirer.prompt([
            { type: 'list', name: 'action', message: 'Project Management Menu', choices }
        ]);
        if (action === 'ls') {
            const chosenURL = await chooseMandalaCloudURL(info);
            await ensureRegistered({ provider: 'mandala', MandalaCloudURL: chosenURL, name: 'mandala' });
            try {
                const res = await authFetch.fetch(`${chosenURL}/api/v1/project/list`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: '{}'
                });
                const result = await res.json();
                printProjectList(result.projects);
            }
            catch (e) {
                handleRequestError(e, 'Failed to list projects');
            }
        }
        else if (action === 'info') {
            const config = await pickMandalaConfig(info);
            await showProjectInfo(config);
        }
        else if (action === 'add-admin') {
            const config = await pickMandalaConfig(info);
            if (!config.projectID) {
                console.error(chalk.red('No project ID.'));
                continue;
            }
            const client = await buildAuthFetch(config);
            console.log(chalk.yellow('Please enter Identity Key or Email of the user to add as admin:'));
            const { identityKeyOrEmail } = await inquirer.prompt([
                { type: 'input', name: 'identityKeyOrEmail', message: 'IdentityKey or Email:' }
            ]);
            const result = await safeRequest(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/addAdmin`, { identityKeyOrEmail });
            if (result.message) {
                console.log(chalk.green(`${result.message}`));
            }
            else {
                console.error(chalk.red(`${result.error || 'Could not add project admin.'}`));
            }
        }
        else if (action === 'remove-admin') {
            const config = await pickMandalaConfig(info);
            if (!config.projectID) {
                console.error(chalk.red('No project ID.'));
                continue;
            }
            const client = await buildAuthFetch(config);
            const result = await safeRequest(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/admins/list`, {});
            if (result) {
                if (result.admins.length === 0) {
                    console.log(chalk.yellow('No admins found.'));
                    continue;
                }
                const { chosenAdmin } = await inquirer.prompt([
                    {
                        type: 'list',
                        name: 'chosenAdmin',
                        message: 'Select admin to remove:',
                        choices: result.admins.map(a => ({
                            name: `${a.identity_key} (${a.email}) added at ${new Date(a.added_at).toLocaleString()}`,
                            value: a.identity_key
                        }))
                    }
                ]);
                const rmResult = await safeRequest(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/removeAdmin`, { identityKeyOrEmail: chosenAdmin });
                if (rmResult.message) {
                    console.log(chalk.green(`${rmResult.message}`));
                }
                else {
                    console.error(chalk.red(`${rmResult.error || 'Could not remove project admin.'}`));
                }
            }
        }
        else if (action === 'list-admins') {
            const config = await pickMandalaConfig(info);
            if (!config.projectID) {
                console.error(chalk.red('No project ID.'));
                continue;
            }
            const client = await buildAuthFetch(config);
            const result = await safeRequest(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/admins/list`, {});
            if (result && result.admins) {
                printAdminsList(result.admins);
            }
        }
        else if (action === 'logs-project') {
            const config = await pickMandalaConfig(info);
            if (!config.projectID) {
                console.error(chalk.red('No project ID.'));
                continue;
            }
            const client = await buildAuthFetch(config);
            const result = await safeRequest(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/logs/project`, {});
            if (result && typeof result.logs === 'string') {
                printLogs(result.logs, 'Project Logs');
            }
        }
        else if (action === 'logs-resource') {
            const config = await pickMandalaConfig(info);
            await fetchResourceLogs(config);
        }
        else if (action === 'releases') {
            const config = await pickMandalaConfig(info);
            if (!config.projectID) {
                console.error(chalk.red('No project ID.'));
                continue;
            }
            const client = await buildAuthFetch(config);
            const result = await safeRequest(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/deploys/list`, {});
            if (result && Array.isArray(result.deploys)) {
                printReleasesList(result.deploys);
            }
        }
        else if (action === 'domain-frontend') {
            const config = await pickMandalaConfig(info);
            const { domain } = await inquirer.prompt([
                { type: 'input', name: 'domain', message: 'Enter the frontend domain (e.g. example.com):' }
            ]);
            await setCustomDomain(config, 'frontend', domain, true);
        }
        else if (action === 'domain-backend') {
            const config = await pickMandalaConfig(info);
            const { domain } = await inquirer.prompt([
                { type: 'input', name: 'domain', message: 'Enter the backend domain (e.g. backend.example.com):' }
            ]);
            await setCustomDomain(config, 'backend', domain, true);
        }
        else if (action === 'webui-config') {
            const config = await pickMandalaConfig(info);
            await viewAndEditWebUIConfig(config);
        }
        else if (action === 'billing-stats') {
            const config = await pickMandalaConfig(info);
            await viewBillingStats(config);
        }
        else if (action === 'topup') {
            const config = await pickMandalaConfig(info);
            await topUpProjectBalance(config);
        }
        else if (action === 'delete') {
            const config = await pickMandalaConfig(info);
            await deleteProject(config);
        }
        else if (action === 'setup-github-actions') {
            const config = await pickMandalaConfig(info);
            await setupGitHubActionsWizard(config);
        }
        else if (action === 'edit-engine-config') {
            const config = await pickMandalaConfig(info);
            await editAdvancedEngineConfig(config);
        }
        else if (action === 'admin-sync-ads') {
            const config = await pickMandalaConfig(info);
            await triggerAdminEndpoint(config, 'syncAdvertisements');
        }
        else if (action === 'admin-start-gasp') {
            const config = await pickMandalaConfig(info);
            await triggerAdminEndpoint(config, 'startGASPSync');
        }
        else if (action === 'admin-evict') {
            const config = await pickMandalaConfig(info);
            const { txid, outputIndex, service } = await inquirer.prompt([
                { type: 'input', name: 'txid', validate: x => x.length === 64 ? true : 'Must be 64 character hex', message: 'TXID to evict' },
                { type: 'input', name: 'outputIndex', validate: x => Number.isInteger(Number(x)) ? true : 'Must be an integer', message: 'Output index to evict' },
                { type: 'input', name: 'service', message: 'Lookup service to evict from (enter for all)', validate: x => x.length === 0 || x.startsWith('ls_') ? true : 'Must start with ls_' }
            ]);
            await triggerAdminEndpoint(config, 'evictOutpoint', txid, outputIndex, service.length === 0 ? undefined : service);
        }
        else {
            done = true;
        }
    }
}
