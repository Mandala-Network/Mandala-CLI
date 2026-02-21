import fs from 'fs';
import path from 'path';
import * as tar from 'tar';
import { spawnSync } from 'child_process';
import chalk from 'chalk/index.js';
import inquirer from 'inquirer';
import Table from 'cli-table3';
import { loadMandalaConfigInfo, pickMandalaConfig } from './config.js';
import { npmCmd, copyIfExists, copyDirectory } from './utils.js';
import type { MandalaConfigInfo } from './types.js';

const MANDALA_ARTIFACT_PREFIX = 'mandala_artifact_';
const LEGACY_ARTIFACT_PREFIX = 'cars_artifact_';
const ARTIFACT_EXTENSION = '.tgz';

const isWindows = process.platform === 'win32';

export async function buildArtifact(nameOrIndex?: string) {
  const configInfo = loadMandalaConfigInfo();
  if (configInfo.schema !== 'bsv-app') {
    console.error(chalk.red('Invalid schema in config file'));
    process.exit(1);
  }

  const activeConfig = await pickMandalaConfig(configInfo, nameOrIndex);
  const deploy = activeConfig.deploy || [];

  console.log(chalk.blue('Building local project artifact...'));
  spawnSync(npmCmd, ['i'], { stdio: 'inherit', shell: isWindows });

  // Backend build
  if (deploy.includes('backend')) {
    if (fs.existsSync('backend/package.json')) {
      if (configInfo.contracts && configInfo.contracts.language) {
        if (configInfo.contracts.language !== 'sCrypt') {
          console.error(chalk.red(`Unsupported contracts language: ${configInfo.contracts.language}. Only 'sCrypt' is supported.`));
          process.exit(1);
        }
        spawnSync(npmCmd, ['i'], { cwd: 'backend', stdio: 'inherit', shell: isWindows });
        const backendPkg = JSON.parse(fs.readFileSync('backend/package.json', 'utf-8'));
        if (!backendPkg.scripts || !backendPkg.scripts.compile) {
          console.error(chalk.red('No "compile" script found in backend package.json for sCrypt contracts.'));
          process.exit(1);
        }
        const compileResult = spawnSync(npmCmd, ['run', 'compile'], { cwd: 'backend', stdio: 'inherit', shell: isWindows });
        if (compileResult.status !== 0) {
          console.error(chalk.red('sCrypt contract compilation failed.'));
          process.exit(1);
        }
        const buildResult = spawnSync(npmCmd, ['run', 'build'], { cwd: 'backend', stdio: 'inherit', shell: isWindows });
        if (buildResult.status !== 0) {
          console.error(chalk.red('Backend build failed.'));
          process.exit(1);
        }
      } else {
        spawnSync(npmCmd, ['i'], { cwd: 'backend', stdio: 'inherit', shell: isWindows });
        const backendPkg = JSON.parse(fs.readFileSync('backend/package.json', 'utf-8'));
        if (backendPkg.scripts && backendPkg.scripts.build) {
          const buildResult = spawnSync(npmCmd, ['run', 'build'], { cwd: 'backend', stdio: 'inherit', shell: isWindows });
          if (buildResult.status !== 0) {
            console.error(chalk.red('Backend build failed.'));
            process.exit(1);
          }
        }
      }
    } else {
      console.error(chalk.red('Backend specified in deploy but no backend/package.json found.'));
      process.exit(1);
    }
  }

  // Frontend build
  if (deploy.includes('frontend')) {
    if (!configInfo.frontend || !configInfo.frontend.language) {
      console.error(chalk.red('Frontend is included in deploy but no frontend configuration (language) found.'));
      process.exit(1);
    }
    const frontendLang = configInfo.frontend.language.toLowerCase();
    if (!fs.existsSync('frontend/package.json')) {
      if (frontendLang === 'html') {
        if (!fs.existsSync('frontend/index.html')) {
          console.error(chalk.red('Frontend language set to html but no index.html found in frontend directory.'));
          process.exit(1);
        }
      } else {
        console.error(chalk.red('Frontend language requires a build but no frontend/package.json found.'));
        process.exit(1);
      }
    }

    if (frontendLang === 'react') {
      spawnSync(npmCmd, ['i'], { cwd: 'frontend', stdio: 'inherit', shell: isWindows });
      const buildResult = spawnSync(npmCmd, ['run', 'build'], { cwd: 'frontend', stdio: 'inherit', shell: isWindows });
      if (buildResult.status !== 0) {
        console.error(chalk.red('Frontend build (react) failed.'));
        process.exit(1);
      }
      if (!fs.existsSync('frontend/build')) {
        console.error(chalk.red('React build directory not found in frontend/build after build.'));
        process.exit(1);
      }
    } else if (frontendLang === 'html') {
      if (!fs.existsSync('frontend/index.html')) {
        console.error(chalk.red('Frontend language set to html but no index.html found.'));
        process.exit(1);
      }
    } else {
      console.error(chalk.red(`Unsupported frontend language: ${configInfo.frontend.language}. Only 'react' or 'html' are currently supported.`));
      process.exit(1);
    }
  }

  const artifactName = `${MANDALA_ARTIFACT_PREFIX}${Date.now()}${ARTIFACT_EXTENSION}`;

  const tmpDir = path.join(process.cwd(), 'mandala_tmp_build_' + Date.now());
  fs.mkdirSync(tmpDir);

  // Always include config files
  copyIfExists('deployment-info.json', tmpDir);
  copyIfExists('mandala.json', tmpDir);
  copyIfExists('package.json', tmpDir);
  copyIfExists('package-lock.json', tmpDir);

  if (deploy.includes('backend')) {
    if (!fs.existsSync('backend')) {
      console.error(chalk.red('Backend deploy requested but no backend directory found.'));
      process.exit(1);
    }
    copyDirectory('backend', path.join(tmpDir, 'backend'));
  }

  if (deploy.includes('frontend')) {
    const frontendLang = configInfo.frontend?.language.toLowerCase();
    if (frontendLang === 'react') {
      if (!fs.existsSync('frontend/build')) {
        console.error(chalk.red('React frontend build output not found.'));
        process.exit(1);
      }
      copyDirectory('frontend/build', path.join(tmpDir, 'frontend'));
    } else if (frontendLang === 'html') {
      if (!fs.existsSync('frontend/index.html')) {
        console.error(chalk.red('HTML frontend index.html not found.'));
        process.exit(1);
      }
      copyDirectory('frontend', path.join(tmpDir, 'frontend'));
    }
  }

  await tar.create({ gzip: true, file: artifactName, cwd: tmpDir }, ['.']);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(chalk.green(`Artifact created: ${artifactName}`));
  return artifactName;
}

export function findArtifacts(): string[] {
  return fs.readdirSync(process.cwd()).filter(f =>
    (f.startsWith(MANDALA_ARTIFACT_PREFIX) || f.startsWith(LEGACY_ARTIFACT_PREFIX)) &&
    f.endsWith(ARTIFACT_EXTENSION)
  );
}

export function findLatestArtifact(): string {
  const artifacts = findArtifacts();
  const found = artifacts.sort().pop();
  if (!found) {
    console.error(chalk.red('No artifact found. Run `mandala build` first.'));
    process.exit(1);
  }
  return found;
}

export function printArtifactsList() {
  const artifacts = findArtifacts();
  if (artifacts.length === 0) {
    console.log(chalk.yellow('No artifacts found.'));
    return;
  }
  const table = new Table({ head: ['Artifact File', 'Created Time'] });
  artifacts.forEach(a => {
    // Handle both prefixes
    let tsStr: string;
    if (a.startsWith(MANDALA_ARTIFACT_PREFIX)) {
      tsStr = a.substring(MANDALA_ARTIFACT_PREFIX.length, a.length - ARTIFACT_EXTENSION.length);
    } else {
      tsStr = a.substring(LEGACY_ARTIFACT_PREFIX.length, a.length - ARTIFACT_EXTENSION.length);
    }
    const ts = parseInt(tsStr, 10);
    const date = new Date(ts);
    table.push([a, date.toLocaleString()]);
  });
  console.log(table.toString());
}

export async function artifactMenu() {
  const choices = [
    { name: 'List Artifacts', value: 'ls' },
    { name: 'Delete an Artifact', value: 'delete' },
    { name: 'Back to main menu', value: 'back' }
  ];

  let done = false;
  while (!done) {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Artifact Management Menu',
        choices
      }
    ]);

    if (action === 'ls') {
      printArtifactsList();
    } else if (action === 'delete') {
      const artifacts = findArtifacts();
      if (artifacts.length === 0) {
        console.log(chalk.yellow('No artifacts found to delete.'));
      } else {
        const { chosenFile } = await inquirer.prompt([
          {
            type: 'list',
            name: 'chosenFile',
            message: 'Select an artifact to delete:',
            choices: artifacts
          }
        ]);
        fs.unlinkSync(chosenFile);
        console.log(chalk.green(`Artifact "${chosenFile}" deleted.`));
      }
    } else {
      done = true;
    }
  }
}
