import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { assertSafeTestTarget, TEST_COLLECTION } from './firestoreCleanup.mjs';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const CLI_PATH = path.join(REPO_ROOT, 'query-runs.mjs');

export async function runQueryRunsCli({
  collection = TEST_COLLECTION,
  athlete,
  limit,
  runId,
  json = true,
  timeoutMs = 20000,
} = {}) {
  assertSafeTestTarget(collection, athlete);

  const args = [CLI_PATH, '--collection', collection, '--athlete', athlete];
  if (limit !== undefined && limit !== null) {
    args.push('--limit', String(limit));
  }
  if (runId) {
    args.push('--runId', String(runId));
  }
  if (json) {
    args.push('--json');
  }

  const { stdout, stderr } = await execFileAsync(process.execPath, args, {
    cwd: REPO_ROOT,
    timeout: timeoutMs,
    env: { ...process.env, NO_COLOR: '1' },
  });

  if (!json) {
    return { stdout, stderr, data: null };
  }

  const trimmed = stdout.trim();
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(
      `query-runs.mjs --json returned invalid JSON: ${err.message}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
    );
  }

  return { stdout, stderr, data: parsed };
}

export function extractRunsList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.runs)) return data.runs;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

function isLikelyRunObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  return (
    'id' in obj ||
    'distanceMeters' in obj ||
    'distanceKm' in obj ||
    'activeDurationSec' in obj ||
    'segments' in obj ||
    'startedAt' in obj
  );
}

export function extractSingleRun(data, expectedRunId = null) {
  if (!data || typeof data !== 'object') {
    return null;
  }

  if (Array.isArray(data)) {
    if (expectedRunId) {
      return data.find((r) => r?.id === expectedRunId) ?? null;
    }
    return data[0] ?? null;
  }

  if ('run' in data) {
    if (!data.run || typeof data.run !== 'object' || Array.isArray(data.run)) {
      return null;
    }
    if (!isLikelyRunObject(data.run)) {
      return null;
    }
    if (expectedRunId && data.run.id !== expectedRunId) {
      return null;
    }
    return data.run;
  }

  if (Array.isArray(data.runs)) {
    if (expectedRunId) {
      return data.runs.find((r) => r?.id === expectedRunId) ?? null;
    }
    return data.runs[0] ?? null;
  }

  if (Array.isArray(data.items)) {
    if (expectedRunId) {
      return data.items.find((r) => r?.id === expectedRunId) ?? null;
    }
    return data.items[0] ?? null;
  }

  if (!isLikelyRunObject(data)) {
    return null;
  }
  if (expectedRunId && data.id !== expectedRunId) {
    return null;
  }
  return data;
}
