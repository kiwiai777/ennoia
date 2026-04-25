import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function resolveWorkspacePath(explicitPath?: string): string {
  if (explicitPath) {
    if (!fs.existsSync(explicitPath)) {
      throw new Error(`Workspace path does not exist: ${explicitPath}`);
    }
    const stat = fs.statSync(explicitPath);
    if (!stat.isDirectory()) {
      throw new Error(`Workspace path is not a directory: ${explicitPath}`);
    }
    return path.resolve(explicitPath);
  }

  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  if (!fs.existsSync(configPath)) {
    throw new Error("OpenClaw config not found at ~/.openclaw/openclaw.json. Run 'openclaw onboard' first or pass --workspace explicitly.");
  }

  let configStr;
  try {
    configStr = fs.readFileSync(configPath, 'utf8');
  } catch (err: any) {
    throw new Error(`Failed to read openclaw.json: ${err.message}`);
  }

  let config;
  try {
    config = JSON.parse(configStr);
  } catch (err: any) {
    throw new Error(`Failed to parse openclaw.json: ${err.message}`);
  }

  const workspacePath = config?.agents?.defaults?.workspace;
  if (!workspacePath) {
    throw new Error("agents.defaults.workspace not configured. Pass --workspace explicitly.");
  }

  // Handle ~ expansion
  const resolvedPath = workspacePath.startsWith('~') 
    ? path.join(os.homedir(), workspacePath.slice(1)) 
    : path.resolve(workspacePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Resolved workspace path does not exist: ${resolvedPath}`);
  }
  
  const stat = fs.statSync(resolvedPath);
  if (!stat.isDirectory()) {
    throw new Error(`Resolved workspace path is not a directory: ${resolvedPath}`);
  }

  return resolvedPath;
}
