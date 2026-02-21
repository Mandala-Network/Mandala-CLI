import fs from 'fs';
import path from 'path';
import * as tar from 'tar';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import Table from 'cli-table3';
import { loadMandalaConfigInfo, pickMandalaConfig } from './config.js';
import { ensureRegistered, safeRequest, buildAuthFetch, uploadArtifact } from './utils.js';
import { MAX_TAIL_LINES } from './types.js';
const MANIFEST_FILE = 'agent-manifest.json';
function loadAgentManifest() {
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
async function resolveDeploymentConfig(manifest, configName) {
    const deployments = manifest.deployments || [];
    // If configName provided, try to find matching deployment or use mandala.json config
    if (configName) {
        try {
            const info = loadMandalaConfigInfo();
            const config = await pickMandalaConfig(info, configName);
            return {
                cloudUrl: config.MandalaCloudURL,
                projectID: config.projectID,
                network: config.network || 'mainnet'
            };
        }
        catch {
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
            cloudUrl: config.MandalaCloudURL,
            projectID: config.projectID,
            network: config.network || 'mainnet'
        };
    }
    catch {
        console.error(chalk.red('No deployment configuration found. Add deployments to agent-manifest.json or create a Mandala config.'));
        process.exit(1);
    }
}
export async function agentInit() {
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
    let storageConfig = { enabled: false };
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
    let deployments = [];
    if (wantDeployment) {
        const { cloudUrl } = await inquirer.prompt([
            { type: 'input', name: 'cloudUrl', message: 'Mandala Node URL:', default: 'https://cars.babbage.systems' }
        ]);
        const { projectID } = await inquirer.prompt([
            { type: 'input', name: 'projectID', message: 'Project ID (leave empty to create later):', default: '' }
        ]);
        const { network } = await inquirer.prompt([
            { type: 'input', name: 'network', message: 'Network:', default: 'mainnet' }
        ]);
        deployments = [{
                provider: 'mandala',
                MandalaCloudURL: cloudUrl,
                projectID: projectID || undefined,
                network
            }];
    }
    const manifest = {
        schema: 'mandala-agent',
        schemaVersion: '1.0',
        agent: {
            type: agentType,
            runtime
        },
        env: {},
        resources: { cpu, memory },
        ports: [port],
        healthCheck: {
            path: healthPath,
            port,
            intervalSeconds: 30
        },
        frontend: {},
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
    console.log(chalk.cyan('Next steps:'));
    console.log(chalk.cyan('  1. Edit agent-manifest.json to add environment variables'));
    console.log(chalk.cyan('  2. Run "mandala agent deploy" to deploy your agent'));
}
export async function agentDeploy(configName) {
    const manifest = loadAgentManifest();
    const { cloudUrl, projectID, network } = await resolveDeploymentConfig(manifest, configName);
    const config = { name: 'agent-deploy', provider: 'mandala', MandalaCloudURL: cloudUrl, projectID, network };
    await ensureRegistered(config);
    console.log(chalk.blue(`Deploying agent to ${cloudUrl} (project: ${projectID})...`));
    // Package cwd as tarball
    const spinner = ora('Packaging agent...').start();
    const artifactName = `mandala_agent_${Date.now()}.tgz`;
    const cwd = process.cwd();
    // Get list of files to include, excluding common patterns
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
    await tar.create({
        gzip: true,
        file: artifactName,
        cwd,
        filter: (filePath) => {
            const relative = filePath.startsWith('./') ? filePath.slice(2) : filePath;
            for (const pattern of excludePatterns) {
                if (pattern.includes('*')) {
                    const prefix = pattern.replace('*', '');
                    if (relative.startsWith(prefix))
                        return false;
                }
                else {
                    if (relative === pattern || relative.startsWith(pattern + '/') || relative.startsWith(pattern + '\\'))
                        return false;
                }
            }
            return true;
        }
    }, ['.']);
    spinner.succeed('Agent packaged.');
    // Create deployment
    spinner.start('Creating deployment...');
    const client = await buildAuthFetch(config);
    const result = await safeRequest(client, cloudUrl, `/api/v1/project/${projectID}/deploy`, {});
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
    console.log(chalk.cyan(`Use "mandala agent status" to check deployment progress.`));
}
export async function agentStatus(configName) {
    let config;
    try {
        const manifest = loadAgentManifest();
        const { cloudUrl, projectID, network } = await resolveDeploymentConfig(manifest, configName);
        config = { name: 'agent-status', provider: 'mandala', MandalaCloudURL: cloudUrl, projectID, network };
    }
    catch {
        const info = loadMandalaConfigInfo();
        config = await pickMandalaConfig(info, configName);
    }
    await ensureRegistered(config);
    const client = await buildAuthFetch(config);
    const spinner = ora('Fetching agent status...').start();
    const info = await safeRequest(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/info`, {});
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
    if (info.agent_config) {
        console.log(chalk.blue('\nAgent Configuration:'));
        const configTable = new Table({ head: ['Key', 'Value'] });
        Object.entries(info.agent_config).forEach(([k, v]) => configTable.push([k, v]));
        console.log(configTable.toString());
    }
}
export async function agentConfigSet(key, value, configName) {
    let config;
    try {
        const manifest = loadAgentManifest();
        const { cloudUrl, projectID, network } = await resolveDeploymentConfig(manifest, configName);
        config = { name: 'agent-config', provider: 'mandala', MandalaCloudURL: cloudUrl, projectID, network };
    }
    catch {
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
export async function agentConfigGet(configName) {
    let config;
    try {
        const manifest = loadAgentManifest();
        const { cloudUrl, projectID, network } = await resolveDeploymentConfig(manifest, configName);
        config = { name: 'agent-config', provider: 'mandala', MandalaCloudURL: cloudUrl, projectID, network };
    }
    catch {
        const info = loadMandalaConfigInfo();
        config = await pickMandalaConfig(info, configName);
    }
    await ensureRegistered(config);
    const client = await buildAuthFetch(config);
    const info = await safeRequest(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/info`, {});
    if (!info)
        return;
    if (info.agent_config && Object.keys(info.agent_config).length > 0) {
        const table = new Table({ head: ['Key', 'Value'] });
        Object.entries(info.agent_config).forEach(([k, v]) => table.push([k, v]));
        console.log(table.toString());
    }
    else {
        console.log(chalk.yellow('No agent configuration found.'));
    }
}
export async function agentLogs(configName, options) {
    let config;
    try {
        const manifest = loadAgentManifest();
        const { cloudUrl, projectID, network } = await resolveDeploymentConfig(manifest, configName);
        config = { name: 'agent-logs', provider: 'mandala', MandalaCloudURL: cloudUrl, projectID, network };
    }
    catch {
        const info = loadMandalaConfigInfo();
        config = await pickMandalaConfig(info, configName);
    }
    await ensureRegistered(config);
    const client = await buildAuthFetch(config);
    const since = options?.since || '1h';
    const tail = Math.min(Math.max(1, options?.tail || 1000), MAX_TAIL_LINES);
    const level = options?.level || 'all';
    const result = await safeRequest(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/logs/resource/backend`, { since, tail, level });
    if (result && typeof result.logs === 'string') {
        console.log(chalk.blue('Agent Logs:'));
        console.log(result.logs.trim() || chalk.yellow('No logs yet.'));
    }
}
export async function agentRestart(configName) {
    let config;
    try {
        const manifest = loadAgentManifest();
        const { cloudUrl, projectID, network } = await resolveDeploymentConfig(manifest, configName);
        config = { name: 'agent-restart', provider: 'mandala', MandalaCloudURL: cloudUrl, projectID, network };
    }
    catch {
        const info = loadMandalaConfigInfo();
        config = await pickMandalaConfig(info, configName);
    }
    const { confirm } = await inquirer.prompt([
        { type: 'confirm', name: 'confirm', message: 'Are you sure you want to restart the agent?', default: false }
    ]);
    if (!confirm)
        return;
    await ensureRegistered(config);
    const client = await buildAuthFetch(config);
    const spinner = ora('Restarting agent...').start();
    const result = await safeRequest(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/admin/restart`, {});
    if (result) {
        spinner.succeed('Agent restart initiated.');
    }
    else {
        spinner.fail('Failed to restart agent.');
    }
}
export async function agentMenu() {
    const choices = [
        { name: 'Initialize Agent Manifest', value: 'init' },
        { name: 'Deploy Agent', value: 'deploy' },
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
        }
        else if (action === 'deploy') {
            await agentDeploy();
        }
        else if (action === 'status') {
            await agentStatus();
        }
        else if (action === 'config-get') {
            await agentConfigGet();
        }
        else if (action === 'config-set') {
            const { key } = await inquirer.prompt([
                { type: 'input', name: 'key', message: 'Config key:', validate: (v) => v.trim() ? true : 'Key is required' }
            ]);
            const { value } = await inquirer.prompt([
                { type: 'input', name: 'value', message: 'Config value:' }
            ]);
            await agentConfigSet(key, value);
        }
        else if (action === 'logs') {
            await agentLogs();
        }
        else if (action === 'restart') {
            await agentRestart();
        }
        else {
            done = true;
        }
    }
}
