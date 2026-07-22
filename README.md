# Goto-Skills

An agent skills aggregator and manager. This repository tracks multiple external agent skills repositories, groups/categorizes them, keeps them updated automatically using GitHub Actions, and provides an interactive installer to selectively install them globally or to a local workspace.

## Features

- **Centralized Registry**: Keep track of multiple source repositories in a single file (`registry.json`).
- **Grouping / Categorization**: Group skills into custom categories like `coding`, `databases`, `science`, etc.
- **Auto-Syncing**: A GitHub Action runs daily, checks for updates in the tracked repositories, pulls the changes, and pushes them back here.
- **Interactive Installer**: Run a single command, view categorised skills, use space to select multiple (or entire categories), and install them directly.
- **Flexible Source Resolution**: Works with Git URLs or GitHub shorthands (e.g. `username/repo`).

## Getting Started

### Installation

Clone this repository:

```bash
git clone https://github.com/dchumari/goto-skills.git
cd goto-skills
npm install
```

### Commands

All commands can be run using Node.js:

#### 1. Add a source repository
Adds a new repository to the registry and automatically triggers a sync for it. You can optionally specify a category (default is `general`).

```bash
node index.js add <username/repo_or_git_url> [category]

# Examples:
node index.js add anthropics/skills general
node index.js add https://github.com/addyosmani/agent-skills.git general
node index.js add obra/superpowers coding
```

#### 2. Sync all skills
Clones all registered repositories, extracts their skills (looks for a `skills/` folder, or treats the entire repo as a single skill if it contains `SKILL.md` in the root), and copies them under `skills/<category>/`.

```bash
node index.js sync
```

#### 3. List all imported skills
Shows a list of all skills grouped by category.

```bash
node index.js list
```

#### 4. Install selected skills
Launches an interactive checklist. Select skills or entire categories, and choose whether to install them to:
- **Workspace**: `.agents/skills` relative to the directory where you ran the command.
- **Global**: `C:\Users\user\.gemini\config\skills`
- **Custom Location**: Any absolute path you specify.

```bash
node index.js install
```
