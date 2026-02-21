import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import Table from 'cli-table3';
import { authFetch } from './wallet.js';
import { ensureRegistered, handleRequestError } from './utils.js';
const MANDALA_CONFIG_PATH = path.resolve(process.cwd(), 'mandala.json');
const LEGACY_CONFIG_PATH = path.resolve(process.cwd(), 'deployment-info.json');
function getConfigPath() {
    if (fs.existsSync(MANDALA_CONFIG_PATH))
        return MANDALA_CONFIG_PATH;
    if (fs.existsSync(LEGACY_CONFIG_PATH))
        return LEGACY_CONFIG_PATH;
    return MANDALA_CONFIG_PATH; // default for new projects
}
export function loadMandalaConfigInfo() {
    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) {
        console.error(chalk.red('No mandala.json or deployment-info.json found in the current directory.'));
        process.exit(1);
    }
    const info = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    // Migrate if using old "deployments" field
    if (info.deployments && !info.configs) {
        info.configs = info.deployments;
        delete info.deployments;
        saveMandalaConfigInfo(info);
    }
    // Migrate old CARSCloudURL → MandalaCloudURL in configs
    if (info.configs) {
        for (const c of info.configs) {
            if (c.CARSCloudURL && !c.MandalaCloudURL) {
                c.MandalaCloudURL = c.CARSCloudURL;
                delete c.CARSCloudURL;
            }
        }
    }
    info.configs = info.configs || [];
    return info;
}
export function saveMandalaConfigInfo(info) {
    const configPath = getConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(info, null, 2));
}
export function isMandalaConfig(c) {
    return c.provider === 'CARS' || c.provider === 'mandala';
}
export function listAllConfigs(info) {
    return info.configs || [];
}
export function printAllConfigsWithIndex(info) {
    const all = listAllConfigs(info);
    if (all.length === 0) {
        console.log(chalk.yellow('No configurations found.'));
        return;
    }
    console.log(chalk.blue('All configurations:'));
    const table = new Table({ head: ['Index', 'Name', 'Provider', 'MandalaCloudURL', 'ProjectID', 'Network'] });
    all.forEach((c, i) => {
        table.push([i.toString(), c.name, c.provider, c.MandalaCloudURL || '', c.projectID || 'none', c.network || '']);
    });
    console.log(table.toString());
}
export function findConfigByNameOrIndex(info, nameOrIndex) {
    const all = listAllConfigs(info);
    const index = parseInt(nameOrIndex, 10);
    if (!isNaN(index) && index >= 0 && index < all.length) {
        return all[index];
    }
    return all.find(c => c.name === nameOrIndex);
}
export async function pickMandalaConfig(info, nameOrIndex) {
    const all = listAllConfigs(info);
    const mandalaConfigs = all.filter(isMandalaConfig);
    if (nameOrIndex) {
        const cfg = findConfigByNameOrIndex(info, nameOrIndex);
        if (!cfg) {
            console.error(chalk.red(`Configuration "${nameOrIndex}" not found.`));
            process.exit(1);
        }
        if (!isMandalaConfig(cfg)) {
            console.error(chalk.red(`Configuration "${nameOrIndex}" is not a Mandala configuration.`));
            process.exit(1);
        }
        return cfg;
    }
    if (mandalaConfigs.length === 0) {
        console.log(chalk.yellow('No Mandala configurations found. Let\'s create one.'));
        const newCfg = await addMandalaConfigInteractive(info);
        return newCfg;
    }
    const choices = mandalaConfigs.map((c) => {
        const idx = all.indexOf(c);
        return {
            name: `${idx}: ${c.name} (URL: ${c.MandalaCloudURL}, ProjectID: ${c.projectID || 'none'})`,
            value: idx
        };
    });
    const { chosenIndex } = await inquirer.prompt([
        {
            type: 'list',
            name: 'chosenIndex',
            message: 'Select a Mandala configuration:',
            choices
        }
    ]);
    return all[chosenIndex];
}
async function chooseOrCreateProjectID(cloudUrl, currentProjectID, network = 'mainnet') {
    await ensureRegistered({ provider: 'mandala', MandalaCloudURL: cloudUrl, name: 'mandala' });
    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'Project ID configuration:',
            choices: [
                { name: 'Use existing project ID', value: 'existing' },
                { name: 'Create a new project on this Mandala Node', value: 'new' }
            ],
            default: currentProjectID ? 'existing' : 'new'
        }
    ]);
    if (action === 'existing') {
        const { projectID } = await inquirer.prompt([
            {
                type: 'input',
                name: 'projectID',
                message: 'Enter existing Project ID:',
                default: currentProjectID,
                validate: (val) => val.trim() ? true : 'Project ID is required.'
            }
        ]);
        let projects;
        try {
            let response = await authFetch.fetch(`${cloudUrl}/api/v1/project/list`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{}'
            });
            projects = await response.json();
        }
        catch (error) {
            handleRequestError(error, 'Failed to retrieve projects from Mandala Node.');
            process.exit(1);
        }
        if (!projects || !Array.isArray(projects.projects)) {
            console.error(chalk.red('Invalid response from Mandala Node when checking projects.'));
            process.exit(1);
        }
        if (!projects.projects.some(x => x.network === network && x.id === projectID.trim())) {
            console.error(chalk.red(`Project ID "${projectID}" not found on ${network} at server ${cloudUrl}.`));
            process.exit(1);
        }
        return projectID.trim();
    }
    else {
        const { name } = await inquirer.prompt([
            {
                type: 'input',
                name: 'name',
                message: 'What should this Mandala Node name this project:',
                default: 'Unnamed Project',
                validate: (val) => val.trim() ? true : 'Project name is required.'
            }
        ]);
        let result;
        try {
            result = await authFetch.fetch(`${cloudUrl}/api/v1/project/create`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name, network })
            });
            result = await result.json();
        }
        catch (error) {
            handleRequestError(error, 'Failed to create new project.');
            process.exit(1);
        }
        if (!result.projectId) {
            console.error(chalk.red('Failed to create new project. No projectId returned.'));
            process.exit(1);
        }
        console.log(chalk.green(`New project created with ID: ${result.projectId}`));
        return result.projectId;
    }
}
export async function addMandalaConfigInteractive(info) {
    const cloudChoices = [
        { name: 'Babbage (cars.babbage.systems)', value: 'https://cars.babbage.systems' },
        { name: 'ATX (cars.atx.systems)', value: 'https://cars.atx.systems' },
        { name: 'Enter Custom URL', value: 'custom' },
        { name: 'Local (dev) localhost:7777', value: 'http://localhost:7777' },
    ];
    const { name, cloudUrlChoice, customCloudUrl, network, deployTargets } = await inquirer.prompt([
        {
            type: 'input',
            name: 'name',
            message: 'Name of this Mandala configuration:',
            validate: (val) => val.trim() ? true : 'Name is required.'
        },
        {
            type: 'list',
            name: 'cloudUrlChoice',
            message: 'Select a Mandala Node URL:',
            choices: cloudChoices
        },
        {
            type: 'input',
            name: 'customCloudUrl',
            message: 'Enter custom Mandala Node URL:',
            when: (ans) => ans.cloudUrlChoice === 'custom',
            default: 'http://localhost:7777'
        },
        {
            type: 'input',
            name: 'network',
            message: 'Network (e.g. testnet/mainnet):',
            default: 'mainnet'
        },
        {
            type: 'checkbox',
            name: 'deployTargets',
            message: 'Select what to release with this config:',
            choices: [
                { name: 'frontend', value: 'frontend', checked: true },
                { name: 'backend', value: 'backend', checked: true },
            ]
        }
    ]);
    let frontendHostingMethod = undefined;
    if (deployTargets.includes('frontend')) {
        const { frontendHosting } = await inquirer.prompt([
            {
                type: 'list',
                name: 'frontendHosting',
                message: 'Frontend hosting method (HTTPS/UHRP/none):',
                choices: ['HTTPS', 'UHRP', 'none'],
                default: 'HTTPS'
            }
        ]);
        frontendHostingMethod = frontendHosting === 'none' ? undefined : frontendHosting;
    }
    const finalCloudUrl = cloudUrlChoice === 'custom' ? customCloudUrl : cloudUrlChoice;
    const projectID = await chooseOrCreateProjectID(finalCloudUrl, undefined, network);
    const newCfg = {
        name,
        provider: 'mandala',
        MandalaCloudURL: finalCloudUrl,
        projectID: projectID,
        network: network.trim(),
        deploy: deployTargets,
        frontendHostingMethod
    };
    info.configs = info.configs || [];
    info.configs.push(newCfg);
    saveMandalaConfigInfo(info);
    await ensureRegistered(newCfg);
    console.log(chalk.green(`Mandala configuration "${name}" created.`));
    return newCfg;
}
export async function editMandalaConfigInteractive(info, config) {
    const cloudChoices = [
        { name: 'localhost:7777', value: 'http://localhost:7777' },
        { name: 'cars.babbage.systems', value: 'https://cars.babbage.systems' },
        { name: 'cars.atx.systems', value: 'https://cars.atx.systems' },
        { name: 'Custom', value: 'custom' }
    ];
    const currentCloudChoice = cloudChoices.find(ch => ch.value === config.MandalaCloudURL) ? config.MandalaCloudURL : 'custom';
    const { name, cloudUrlChoice, customCloudUrl, network, deployTargets } = await inquirer.prompt([
        {
            type: 'input',
            name: 'name',
            message: 'Configuration name:',
            default: config.name,
            validate: (val) => val.trim() ? true : 'Name is required.'
        },
        {
            type: 'list',
            name: 'cloudUrlChoice',
            message: 'Mandala Node URL:',
            choices: cloudChoices,
            default: currentCloudChoice
        },
        {
            type: 'input',
            name: 'customCloudUrl',
            message: 'Enter custom Mandala Node URL:',
            when: (ans) => ans.cloudUrlChoice === 'custom',
            default: config.MandalaCloudURL || 'http://localhost:7777'
        },
        {
            type: 'input',
            name: 'network',
            message: 'Network:',
            default: config.network || 'testnet'
        },
        {
            type: 'checkbox',
            name: 'deployTargets',
            message: 'What to release?',
            choices: [
                { name: 'frontend', value: 'frontend', checked: config.deploy?.includes('frontend') },
                { name: 'backend', value: 'backend', checked: config.deploy?.includes('backend') },
            ]
        }
    ]);
    let frontendHostingMethod = undefined;
    if (deployTargets.includes('frontend')) {
        const { frontendHosting } = await inquirer.prompt([
            {
                type: 'list',
                name: 'frontendHosting',
                message: 'Frontend hosting method:',
                choices: ['HTTPS', 'UHRP', 'none'],
                default: config.frontendHostingMethod || 'none'
            }
        ]);
        frontendHostingMethod = frontendHosting === 'none' ? undefined : frontendHosting;
    }
    const finalCloudUrl = cloudUrlChoice === 'custom' ? customCloudUrl : cloudUrlChoice;
    const projectID = await chooseOrCreateProjectID(finalCloudUrl, config.projectID, config.network);
    config.name = name.trim();
    config.MandalaCloudURL = finalCloudUrl;
    config.projectID = projectID;
    config.network = network.trim();
    config.deploy = deployTargets;
    config.frontendHostingMethod = frontendHostingMethod;
    saveMandalaConfigInfo(info);
    await ensureRegistered(config);
    console.log(chalk.green(`Mandala configuration "${name}" updated.`));
}
export function deleteMandalaConfig(info, config) {
    info.configs = (info.configs || []).filter(c => c !== config);
    saveMandalaConfigInfo(info);
    console.log(chalk.green(`Mandala configuration "${config.name}" deleted.`));
}
export function getDistinctMandalaCloudURLs(info) {
    const urls = (info.configs || [])
        .filter(isMandalaConfig)
        .map(c => c.MandalaCloudURL)
        .filter(u => !!u);
    return Array.from(new Set(urls));
}
export async function chooseMandalaCloudURL(info, specifiedNameOrIndex) {
    if (specifiedNameOrIndex) {
        const cfg = findConfigByNameOrIndex(info, specifiedNameOrIndex);
        if (!cfg) {
            console.error(chalk.red(`Configuration "${specifiedNameOrIndex}" not found.`));
            process.exit(1);
        }
        if (!isMandalaConfig(cfg)) {
            console.error(chalk.red(`Configuration "${specifiedNameOrIndex}" is not a Mandala configuration.`));
            process.exit(1);
        }
        if (!cfg.MandalaCloudURL) {
            console.error(chalk.red('This Mandala configuration has no MandalaCloudURL set.'));
            process.exit(1);
        }
        return cfg.MandalaCloudURL;
    }
    const urls = getDistinctMandalaCloudURLs(info);
    if (urls.length === 0) {
        console.error(chalk.red('No Mandala Node configurations found.'));
        process.exit(1);
    }
    if (urls.length === 1) {
        return urls[0];
    }
    const { chosenURL } = await inquirer.prompt([
        {
            type: 'list',
            name: 'chosenURL',
            message: 'Select a Mandala Node:',
            choices: urls
        }
    ]);
    return chosenURL;
}
export async function configMenu() {
    const info = loadMandalaConfigInfo();
    const all = listAllConfigs(info);
    const mandalaConfigs = all.filter(isMandalaConfig);
    const baseChoices = [
        { name: 'List all configurations', value: 'ls' },
        { name: 'Add a new Mandala configuration', value: 'add' },
    ];
    if (mandalaConfigs.length > 0) {
        baseChoices.push({ name: 'Edit an existing Mandala configuration', value: 'edit' });
        baseChoices.push({ name: 'Delete a Mandala configuration', value: 'delete' });
    }
    baseChoices.push({ name: 'Back to main menu', value: 'back' });
    let done = false;
    while (!done) {
        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'Mandala Configurations Menu',
                choices: baseChoices
            }
        ]);
        if (action === 'ls') {
            printAllConfigsWithIndex(loadMandalaConfigInfo());
        }
        else if (action === 'add') {
            const updatedInfo = loadMandalaConfigInfo();
            await addMandalaConfigInteractive(updatedInfo);
        }
        else if (action === 'edit') {
            const updatedInfo = loadMandalaConfigInfo();
            const configs = updatedInfo.configs.filter(isMandalaConfig);
            if (configs.length === 0) {
                console.log(chalk.yellow('No Mandala configurations to edit.'));
            }
            else {
                const { chosenIndex } = await inquirer.prompt([
                    {
                        type: 'list',
                        name: 'chosenIndex',
                        message: 'Select a Mandala configuration to edit:',
                        choices: configs.map(c => {
                            const idx = updatedInfo.configs.indexOf(c);
                            return {
                                name: `${idx}: ${c.name} (URL: ${c.MandalaCloudURL})`,
                                value: idx
                            };
                        })
                    }
                ]);
                const cfgToEdit = updatedInfo.configs[chosenIndex];
                await editMandalaConfigInteractive(updatedInfo, cfgToEdit);
            }
        }
        else if (action === 'delete') {
            const updatedInfo = loadMandalaConfigInfo();
            const configs = updatedInfo.configs.filter(isMandalaConfig);
            if (configs.length === 0) {
                console.log(chalk.yellow('No Mandala configurations to delete.'));
            }
            else {
                const { chosenIndex } = await inquirer.prompt([
                    {
                        type: 'list',
                        name: 'chosenIndex',
                        message: 'Select a Mandala configuration to delete:',
                        choices: configs.map(c => {
                            const idx = updatedInfo.configs.indexOf(c);
                            return {
                                name: `${idx}: ${c.name} (URL: ${c.MandalaCloudURL})`,
                                value: idx
                            };
                        })
                    }
                ]);
                deleteMandalaConfig(updatedInfo, updatedInfo.configs[chosenIndex]);
            }
        }
        else {
            done = true;
        }
    }
}
