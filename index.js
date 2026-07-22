#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';
import prompts from 'prompts';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REGISTRY_FILE = path.join(__dirname, 'registry.json');
const SKILLS_DIR = path.join(__dirname, 'skills');
const TMP_DIR = path.join(__dirname, '.tmp');

// Load registry
async function loadRegistry() {
  if (!(await fs.pathExists(REGISTRY_FILE))) {
    await fs.writeJson(REGISTRY_FILE, { repositories: [] }, { spaces: 2 });
  }
  return fs.readJson(REGISTRY_FILE);
}

// Save registry
async function saveRegistry(registry) {
  await fs.writeJson(REGISTRY_FILE, registry, { spaces: 2 });
}

// Resolve Git URL
function resolveGitUrl(repo) {
  if (repo.startsWith('http://') || repo.startsWith('https://') || repo.startsWith('git@')) {
    return repo;
  }
  // Assume github username/repo
  return `https://github.com/${repo}.git`;
}

// Add a repository
async function addRepo(repoUrlOrShorthand, category = 'general') {
  const url = resolveGitUrl(repoUrlOrShorthand);
  const registry = await loadRegistry();
  
  // Check if already exists
  const exists = registry.repositories.some(r => r.url.toLowerCase() === url.toLowerCase());
  if (exists) {
    console.log(`Repository ${url} is already in the registry.`);
    return;
  }

  registry.repositories.push({ url, category });
  await saveRegistry(registry);
  console.log(`Added repository: ${url} (Category: ${category})`);
  
  console.log('Running sync to fetch the new repository...');
  await syncRepos();
}

// Robust directory removal with retries to handle EBUSY on Windows
async function removeDirWithRetry(dirPath, retries = 5, delay = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      if (await fs.pathExists(dirPath)) {
        await fs.remove(dirPath);
      }
      return;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Sync all repositories
async function syncRepos() {
  const registry = await loadRegistry();
  if (registry.repositories.length === 0) {
    console.log('No repositories registered. Use "add" command to add one.');
    return;
  }

  await fs.ensureDir(SKILLS_DIR);
  await fs.ensureDir(TMP_DIR);

  // Clear existing skills folder to keep it clean and up to date
  await removeDirWithRetry(SKILLS_DIR);
  await fs.ensureDir(SKILLS_DIR);

  for (const repo of registry.repositories) {
    const repoName = repo.url.split('/').pop().replace('.git', '');
    const tempRepoPath = path.join(TMP_DIR, repoName);
    
    console.log(`\nCloning ${repo.url}...`);
    try {
      await removeDirWithRetry(tempRepoPath);
      
      execSync(`git clone --depth 1 ${repo.url} "${tempRepoPath}"`, { stdio: 'inherit' });
      
      const categoryDir = path.join(SKILLS_DIR, repo.category);
      await fs.ensureDir(categoryDir);

      const sourceSkillsPath = path.join(tempRepoPath, 'skills');
      const hasSkillsDir = await fs.pathExists(sourceSkillsPath);
      const hasSkillMd = await fs.pathExists(path.join(tempRepoPath, 'SKILL.md'));

      if (hasSkillsDir) {
        // Import all skills inside the root skills/ folder
        const items = await fs.readdir(sourceSkillsPath);
        for (const item of items) {
          const itemPath = path.join(sourceSkillsPath, item);
          const stat = await fs.stat(itemPath);
          if (stat.isDirectory()) {
            const destPath = path.join(categoryDir, item);
            await fs.copy(itemPath, destPath);
            console.log(`-> Imported skill: ${item} (Category: ${repo.category})`);
          }
        }
      } else if (hasSkillMd) {
        // Import repository as a single skill
        const destPath = path.join(categoryDir, repoName);
        await fs.copy(tempRepoPath, destPath, {
          filter: (src) => !src.includes('.git')
        });
        console.log(`-> Imported repository as a single skill: ${repoName} (Category: ${repo.category})`);
      } else {
        // Scan subdirectories for nested skills (e.g. plugins containing skills/)
        let foundAny = false;
        const subdirs = await fs.readdir(tempRepoPath);
        for (const sub of subdirs) {
          const subPath = path.join(tempRepoPath, sub);
          const stat = await fs.stat(subPath);
          if (stat.isDirectory() && !sub.startsWith('.')) {
            const nestedSkillsPath = path.join(subPath, 'skills');
            const hasNestedSkills = await fs.pathExists(nestedSkillsPath);
            const hasNestedSkillMd = await fs.pathExists(path.join(subPath, 'SKILL.md'));

            if (hasNestedSkills) {
              const items = await fs.readdir(nestedSkillsPath);
              for (const item of items) {
                const itemPath = path.join(nestedSkillsPath, item);
                const itemStat = await fs.stat(itemPath);
                if (itemStat.isDirectory()) {
                  const destPath = path.join(categoryDir, item);
                  await fs.copy(itemPath, destPath);
                  console.log(`-> Imported nested skill: ${item} (Category: ${repo.category})`);
                  foundAny = true;
                }
              }
            } else if (hasNestedSkillMd) {
              const destPath = path.join(categoryDir, sub);
              await fs.copy(subPath, destPath);
              console.log(`-> Imported nested skill module: ${sub} (Category: ${repo.category})`);
              foundAny = true;
            }
          }
        }

        if (!foundAny) {
          console.log(`Warning: Repository ${repoName} does not contain any "skills/" directories or "SKILL.md" files. Skipping.`);
        }
      }
    } catch (error) {
      console.error(`Error syncing repository ${repo.url}:`, error.message);
    } finally {
      try {
        await removeDirWithRetry(tempRepoPath);
      } catch (err) {
        console.error(`Warning: Could not remove temporary path ${tempRepoPath}:`, err.message);
      }
    }
  }

  // Clean up tmp dir
  try {
    await removeDirWithRetry(TMP_DIR);
  } catch (err) {
    console.error(`Warning: Could not remove temporary directory ${TMP_DIR}:`, err.message);
  }
  console.log('\nSync complete.');
}

// List all imported skills
async function listSkills() {
  if (!(await fs.pathExists(SKILLS_DIR))) {
    console.log('No skills imported yet. Run sync first.');
    return;
  }

  const categories = await fs.readdir(SKILLS_DIR);
  if (categories.length === 0) {
    console.log('No skills found.');
    return;
  }

  console.log('\nAvailable Skills:');
  for (const cat of categories) {
    const catPath = path.join(SKILLS_DIR, cat);
    const stat = await fs.stat(catPath);
    if (stat.isDirectory()) {
      console.log(`\n📂 [Category: ${cat}]`);
      const skills = await fs.readdir(catPath);
      for (const skill of skills) {
        console.log(`  - ${skill}`);
      }
    }
  }
}

// Interactive Installation of skills
async function installSkills() {
  if (!(await fs.pathExists(SKILLS_DIR))) {
    console.log('No skills available to install. Run sync first.');
    return;
  }

  const categories = await fs.readdir(SKILLS_DIR);
  const allSkills = [];

  for (const cat of categories) {
    const catPath = path.join(SKILLS_DIR, cat);
    const stat = await fs.stat(catPath);
    if (stat.isDirectory()) {
      const skills = await fs.readdir(catPath);
      for (const skill of skills) {
        allSkills.push({
          name: skill,
          category: cat,
          path: path.join(catPath, skill)
        });
      }
    }
  }

  if (allSkills.length === 0) {
    console.log('No skills found to install.');
    return;
  }

  // Prepare choices
  // Group them, and add category select-all options
  const choices = [];
  const categoryMap = {};

  allSkills.forEach(s => {
    if (!categoryMap[s.category]) {
      categoryMap[s.category] = [];
    }
    categoryMap[s.category].push(s);
  });

  // For each category, add a "Select All in [Category]" shortcut option
  Object.keys(categoryMap).forEach(cat => {
    choices.push({
      title: `--- SELECT ALL IN CATEGORY: ${cat.toUpperCase()} ---`,
      value: `all_in_${cat}`,
      description: `Selects all ${categoryMap[cat].length} skills in this category`
    });

    categoryMap[cat].forEach(s => {
      choices.push({
        title: `  [${cat}] ${s.name}`,
        value: s.path,
        selected: false
      });
    });
  });

  const response = await prompts([
    {
      type: 'multiselect',
      name: 'selected',
      message: 'Select the skills you want to install (Space to select, Enter to confirm):',
      choices: choices,
      hint: '- Space to select. Return to submit.',
      instructions: false
    },
    {
      type: 'select',
      name: 'destType',
      message: 'Where would you like to install the selected skills?',
      choices: [
        { title: 'Workspace (.agents/skills)', value: 'workspace' },
        { title: 'Global (C:\\Users\\user\\.gemini\\config\\skills)', value: 'global' },
        { title: 'Custom directory', value: 'custom' }
      ]
    },
    {
      type: prev => prev === 'custom' ? 'text' : null,
      name: 'customDest',
      message: 'Enter the custom absolute directory path to install to:'
    }
  ]);

  if (!response.selected || response.selected.length === 0) {
    console.log('No skills selected. Exiting.');
    return;
  }

  // Resolve selection including category select-alls
  let targetPaths = new Set();
  response.selected.forEach(val => {
    if (val.startsWith('all_in_')) {
      const cat = val.replace('all_in_', '');
      categoryMap[cat].forEach(s => targetPaths.add(s.path));
    } else {
      targetPaths.add(val);
    }
  });

  if (targetPaths.size === 0) {
    console.log('No skills selected.');
    return;
  }

  // Determine destination
  let destDir = '';
  if (response.destType === 'workspace') {
    destDir = path.join(process.cwd(), '.agents', 'skills');
  } else if (response.destType === 'global') {
    destDir = 'C:\\Users\\user\\.gemini\\config\\skills';
  } else {
    destDir = response.customDest;
  }

  if (!destDir) {
    console.log('Invalid destination path.');
    return;
  }

  await fs.ensureDir(destDir);
  console.log(`\nInstalling ${targetPaths.size} skills to ${destDir}...`);

  for (const srcPath of targetPaths) {
    const skillName = path.basename(srcPath);
    const targetPath = path.join(destDir, skillName);
    
    await fs.ensureDir(targetPath);
    await fs.copy(srcPath, targetPath);
    console.log(`Installed: ${skillName}`);
  }

  console.log('\nInstallation completed successfully!');
}

// CLI entrypoint
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case 'add':
        if (!args[1]) {
          console.error('Usage: skills add <repo_url_or_shorthand> [category]');
          process.exit(1);
        }
        await addRepo(args[1], args[2]);
        break;
      case 'sync':
        await syncRepos();
        break;
      case 'list':
        await listSkills();
        break;
      case 'install':
        await installSkills();
        break;
      default:
        console.log(`
Goto-Skills CLI Tool

Commands:
  node index.js add <repo_url_or_shorthand> [category]
  node index.js sync
  node index.js list
  node index.js install
`);
        break;
    }
  } catch (err) {
    console.error('An error occurred:', err);
    process.exit(1);
  }
}

main();
