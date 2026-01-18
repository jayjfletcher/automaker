#!/usr/bin/env node
/**
 * Cross-platform launcher for Automaker
 * Works on Windows (CMD, PowerShell, Git Bash) and Unix (macOS, Linux)
 */

import { spawn, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { platform } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isWindows = platform() === 'win32';
const args = process.argv.slice(2);

/**
 * Find bash executable on Windows
 */
function findBashOnWindows() {
  const possiblePaths = [
    // Git Bash (most common)
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    // MSYS2
    'C:\\msys64\\usr\\bin\\bash.exe',
    'C:\\msys32\\usr\\bin\\bash.exe',
    // Cygwin
    'C:\\cygwin64\\bin\\bash.exe',
    'C:\\cygwin\\bin\\bash.exe',
    // WSL bash (available in PATH on Windows 10+)
    'bash.exe',
  ];

  for (const bashPath of possiblePaths) {
    if (bashPath === 'bash.exe') {
      // Check if bash is in PATH
      try {
        const result = spawnSync('where', ['bash.exe'], { stdio: 'pipe' });
        if (result?.status === 0) {
          return 'bash.exe';
        }
      } catch (err) {
        // where command failed, continue checking other paths
      }
    } else if (existsSync(bashPath)) {
      return bashPath;
    }
  }

  return null;
}

/**
 * Run the bash script
 */
function runBashScript() {
  const scriptPath = join(__dirname, 'start-automaker.sh');

  if (!existsSync(scriptPath)) {
    console.error('Error: start-automaker.sh not found');
    process.exit(1);
  }

  let bashCmd;
  let bashArgs;

  if (isWindows) {
    bashCmd = findBashOnWindows();

    if (!bashCmd) {
      console.error('Error: Could not find bash on Windows.');
      console.error('Please install Git for Windows from https://git-scm.com/download/win');
      console.error('');
      console.error('Alternatively, you can run these commands directly:');
      console.error('  npm run dev:web      - Web browser mode');
      console.error('  npm run dev:electron - Desktop app mode');
      process.exit(1);
    }

    // Convert Windows path to Unix-style for bash
    // Handle both C:\path and /c/path styles
    let unixPath = scriptPath.replace(/\\/g, '/');
    if (/^[A-Za-z]:/.test(unixPath)) {
      // Convert C:/path to /c/path for MSYS/Git Bash
      unixPath = '/' + unixPath[0].toLowerCase() + unixPath.slice(2);
    }

    bashArgs = [unixPath, ...args];
  } else {
    bashCmd = '/bin/bash';
    bashArgs = [scriptPath, ...args];
  }

  const child = spawn(bashCmd, bashArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      // Ensure proper terminal handling
      TERM: process.env.TERM || 'xterm-256color',
    },
    // shell: false ensures signals are forwarded directly to the child process
    shell: false,
  });

  child.on('error', (err) => {
    if (err.code === 'ENOENT') {
      console.error(`Error: Could not find bash at "${bashCmd}"`);
      console.error('Please ensure Git Bash or another bash shell is installed.');
    } else {
      console.error('Error launching Automaker:', err.message);
    }
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  // Forward signals to child process (guard against race conditions)
  process.on('SIGINT', () => {
    if (!child.killed) child.kill('SIGINT');
  });
  process.on('SIGTERM', () => {
    if (!child.killed) child.kill('SIGTERM');
  });
}

runBashScript();
