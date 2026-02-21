import chalk from 'chalk';
import inquirer from 'inquirer';
import { loadMandalaConfigInfo, pickMandalaConfig } from './config.js';
import { safeRequest, buildAuthFetch, uploadArtifact, printLogs } from './utils.js';
import { findLatestArtifact } from './artifact.js';
import { pickReleaseId } from './project.js';
export async function releaseMenu() {
    const info = loadMandalaConfigInfo();
    const choices = [
        { name: 'Auto-create new release and upload latest artifact now', value: 'now' },
        { name: 'View logs for a release', value: 'logs' },
        { name: 'Create new release for manual upload (get upload URL)', value: 'get-upload-url' },
        { name: 'Upload artifact to a manual release URL', value: 'upload-files' },
        { name: 'View deployment logs (manual input)', value: 'logs-deployment-manual' },
        { name: 'Back to main menu', value: 'back' }
    ];
    let done = false;
    while (!done) {
        const { action } = await inquirer.prompt([
            { type: 'list', name: 'action', message: 'Release Management Menu', choices }
        ]);
        if (action === 'get-upload-url') {
            const config = await pickMandalaConfig(info);
            if (!config.projectID) {
                console.error(chalk.red('No project ID set in this configuration.'));
                continue;
            }
            const client = await buildAuthFetch(config);
            const result = await safeRequest(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/deploy`, {});
            if (result && result.url && result.deploymentId) {
                console.log(chalk.green(`Release created. Release ID: ${result.deploymentId}`));
                console.log(`Upload URL: ${result.url}`);
            }
        }
        else if (action === 'upload-files') {
            const { uploadURL } = await inquirer.prompt([
                { type: 'input', name: 'uploadURL', message: 'Enter the upload URL:' }
            ]);
            const { artifactPath } = await inquirer.prompt([
                { type: 'input', name: 'artifactPath', message: 'Enter the path to the artifact:' }
            ]);
            await uploadArtifact(uploadURL, artifactPath);
        }
        else if (action === 'logs') {
            const config = await pickMandalaConfig(info);
            if (!config.projectID) {
                console.error(chalk.red('No project ID set in this configuration.'));
                continue;
            }
            const releaseId = await pickReleaseId(config);
            if (!releaseId)
                continue;
            const client = await buildAuthFetch(config);
            const result = await safeRequest(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/logs/deployment/${releaseId}`, {});
            if (result && typeof result.logs === 'string') {
                printLogs(result.logs, 'Release Logs');
            }
        }
        else if (action === 'logs-deployment-manual') {
            const config = await pickMandalaConfig(info);
            if (!config.projectID) {
                console.error(chalk.red('No project ID set in this configuration.'));
                continue;
            }
            const { deploymentId } = await inquirer.prompt([
                { type: 'input', name: 'deploymentId', message: 'Enter Deployment (Release) ID:' }
            ]);
            const client = await buildAuthFetch(config);
            const result = await safeRequest(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/logs/deployment/${deploymentId}`, {});
            if (result && typeof result.logs === 'string') {
                printLogs(result.logs, 'Release Logs');
            }
        }
        else if (action === 'now') {
            const config = await pickMandalaConfig(info);
            if (!config.projectID) {
                console.error(chalk.red('No project ID set.'));
                continue;
            }
            const artifactPath = findLatestArtifact();
            const client = await buildAuthFetch(config);
            const result = await safeRequest(client, config.MandalaCloudURL, `/api/v1/project/${config.projectID}/deploy`, {});
            if (result && result.url && result.deploymentId) {
                await uploadArtifact(result.url, artifactPath);
            }
        }
        else {
            done = true;
        }
    }
}
