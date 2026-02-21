import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import axios from 'axios';
import ora from 'ora';
import Table from 'cli-table3';
import { authFetch } from './wallet.js';
const isWindows = process.platform === 'win32';
export const npmCmd = isWindows ? 'npm.cmd' : 'npm';
// Cache registrations to avoid re-fetching
const registrations = {};
export async function ensureRegistered(mandalaConfig) {
    if (!mandalaConfig.MandalaCloudURL) {
        console.error(chalk.red('No Mandala Node URL set in the chosen configuration.'));
        process.exit(1);
    }
    if (registrations[mandalaConfig.MandalaCloudURL]) {
        return;
    }
    try {
        const response = await authFetch.fetch(`${mandalaConfig.MandalaCloudURL}/api/v1/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}'
        });
        await response.json();
        registrations[mandalaConfig.MandalaCloudURL] = true;
    }
    catch (error) {
        handleRequestError(error, 'Registration failed');
        process.exit(1);
    }
}
export function handleRequestError(error, contextMsg) {
    if (contextMsg)
        console.error(chalk.red(`${contextMsg}`));
    if (error?.response?.data?.error) {
        console.error(chalk.red(`Error from server: ${error.response.data.error}`));
    }
    else if (error.message) {
        console.error(chalk.red(`Error: ${error.message}`));
    }
    else {
        console.error(chalk.red('An unknown error occurred.'));
    }
}
export async function safeRequest(client, baseUrl, endpoint, data) {
    try {
        const response = await client.fetch(`${baseUrl}${endpoint}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(data)
        });
        return await response.json();
    }
    catch (error) {
        handleRequestError(error, `Request to ${endpoint} failed`);
        return undefined;
    }
}
export async function buildAuthFetch(config) {
    if (!config.MandalaCloudURL) {
        console.error(chalk.red('MandalaCloudURL not set on this configuration.'));
        process.exit(1);
    }
    await ensureRegistered(config);
    return authFetch;
}
export function copyIfExists(src, destDir) {
    if (fs.existsSync(src)) {
        const dest = path.join(destDir, path.basename(src));
        fs.copyFileSync(src, dest);
    }
}
export function copyDirectory(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirectory(srcPath, destPath);
        }
        else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}
export async function uploadArtifact(uploadURL, artifactPath) {
    if (!fs.existsSync(artifactPath)) {
        console.error(chalk.red(`Artifact not found: ${artifactPath}`));
        return;
    }
    const spinner = ora('Uploading artifact...').start();
    const artifactData = fs.readFileSync(artifactPath);
    try {
        await axios.post(uploadURL, artifactData, {
            headers: { 'content-type': 'application/octet-stream' },
        });
        spinner.succeed('Artifact uploaded successfully.');
    }
    catch (error) {
        spinner.fail('Artifact upload failed.');
        handleRequestError(error);
    }
}
export function printProjectList(projects) {
    if (!projects || projects.length === 0) {
        console.log(chalk.yellow('No projects found.'));
        return;
    }
    const table = new Table({ head: ['Project ID', 'Name', 'Balance', 'Created'] });
    projects.forEach(p => table.push([p.id, p.name, p.balance, new Date(p.created_at).toLocaleString()]));
    console.log(table.toString());
}
export function printAdminsList(admins) {
    if (!admins || admins.length === 0) {
        console.log(chalk.yellow('No admins found.'));
        return;
    }
    const table = new Table({ head: ['Identity Key', 'Email', 'Added At'] });
    admins.forEach(a => table.push([a.identity_key, a.email, new Date(a.added_at).toLocaleString()]));
    console.log(table.toString());
}
export function printLogs(log, title) {
    console.log(chalk.blue(`${title}:`));
    console.log(log.trim() || chalk.yellow('No logs yet.'));
}
export function printReleasesList(deploys) {
    if (!deploys || deploys.length === 0) {
        console.log(chalk.yellow('No releases found.'));
        return;
    }
    const table = new Table({ head: ['Release ID', 'Created At'] });
    deploys.forEach(d => table.push([d.deployment_uuid, new Date(d.created_at).toLocaleString()]));
    console.log(table.toString());
}
