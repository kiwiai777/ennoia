#!/usr/bin/env node
// Cortex CLI entry
// Commands:
//   cortex save "<text>"          Write to user model (goals)
//   cortex context                Output current user context
//   cortex import <path> [--llm]  Import from file/directory, write after interactive selection
//
// Design principles:
//   - Use only process.argv, no CLI framework
//   - CLI does not assemble read/modify/write itself; all writes go through updateUserModel
//   - LLM disabled by default; only enabled when --llm and OPENAI_API_KEY both present

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import {
  loadUserModel,
  updateUserModel,
  saveUserModel,
  getUserModelPath,
} from './core/user-model/storage.js';
import {
  selectRuntimeContext,
  renderContextForHuman,
} from './core/runtime/context.js';
import { createInjectionPackage } from './core/runtime/injection.js';
import {
  buildInjectionPack,
  serializeInjectionPack,
} from './core/runtime/injection-pack.js';
import { projectPackForClaudeCode } from './adapters/claude-code/projector.js';
import type { Goal, BaseItem, UserModel } from './core/user-model/types.js';
import {
  writeItemsToUserModel,
  targetFromCategory,
  type WriteableItem,
  type WriteCategory,
  type WriteTarget,
} from './core/user-model/write-items.js';

import { getAdapterForSource } from './adapters/registry.js';
import { createDescriptorFromPath } from './core/source/types.js';
import { basicExtract } from './core/extraction/basic-extractor.js';
import { llmExtract } from './core/extraction/llm-extractor.js';
import type {
  CandidateItem,
  CandidateType,
  ExtractionCandidate,
} from './core/extraction/types.js';
import { cmdSetup } from './setup/index.js';
import { extractFromClaudeCodeWorkspace } from './adapters/claude-code/index.js';
import { extractFromOpenClawWorkspace, injectToOpenClaw } from './adapters/openclaw/index.js';
import { resolveWorkspacePath } from './adapters/openclaw/workspace.js';
import { extractFromChatGPTExport } from './adapters/chatgpt-export/index.js';
import { extractContentBlocksFromChatGPT } from './adapters/chatgpt-export/content-blocks.js';
import { ALL_INJECT_TARGETS, injectToTarget, type InjectTarget } from './adapters/inject-targets.js';

// CT-0027-04: Pipeline + backends
import { loadConfig } from './backends/config.js';
import { createLLMBackend, createEmbeddingBackend } from './backends/factory.js';
import { runExtractionPipeline } from './core/extraction/pipeline.js';
import { migrateUserModelV0_2, migrateUserModelV0_3, needsMigration } from './core/user-model/migrate.js';
import type { ContentBlock } from './core/extraction/types.js';

import { basicSuggest } from './core/suggestion/basic-suggester.js';
import { llmSuggest } from './core/suggestion/llm-suggester.js';
import type { SuggestionItem } from './core/suggestion/types.js';
import {
  appendObservation,
  loadObservationLog,
  renderObservation,
  buildRecap,
  renderRecap,
  buildHealthSignals,
  renderHealthSignals,
  buildTriggerHints,
  renderTriggerHints,
} from './core/runtime/observation.js';

import { generateCandidatesFromRecent } from './core/suggest-loop/generateCandidatesFromRecent.js';
import { buildSuggestions } from './core/suggest-loop/buildSuggestions.js';

function usage(): void {
  console.log('Cortex CLI');
  console.log('');
  console.log('Usage：');
  console.log('  cortex save "<text>"       Write text to user model (goals)');
  console.log('  cortex setup [--reset] [--check]');
  console.log('                                 Configure LLM and Embedding backend');
  console.log('                                 Can be run repeatedly: shows current config and asks to modify');
  console.log('  cortex context [--scope <scope>] [--task-hint "<hint>"]');
  console.log('                                 Output current user context');
  console.log('                                 Focus on specific project (name/id)');
  console.log('                                 --task-hint Filter by task hint');
  console.log('  cortex inject --target openclaw [--workspace <path>] [--dry-run]');
  console.log('  cortex inject --all-targets [--workspace <path>] [--dry-run]');
  console.log('  cortex inject [--agent <id>] [--format text|json]');
  console.log('                [--scope <scope>] [--task-hint "<hint>"]');
  console.log('                [--with-observation]');
  console.log('                                 Generate injection content for agent');
  console.log('                                 Default: --agent generic --format text');
  console.log('                                 --scope Specify scope (project name/id)');
  console.log('                                 --task-hint Provide current task hint (text matching)');
  console.log('                                 --with-observation Include runtime usage summary');
  console.log('  cortex import <path> [--llm]   Import from file/directory and write interactively');
  console.log('  cortex suggest "<text>" [--llm] Generate suggestions from text and write interactively');
  console.log('  cortex observe                 View recent context/inject usage record');
  console.log('  cortex reflect "<text>"        Extract suggestions from recent activity and write interactively');
  console.log('  cortex reflect "<text>" --description "detailed description"');
  console.log('                                 Optionally add extra context for extracted candidates');
  console.log('  cortex reflect --stdin [--accept-all]');
  console.log('                                 Read multiple inputs line by line from stdin;');
  console.log('                                 --accept-all Skip interaction, auto-confirm all candidates');
  console.log('                                 (Pipe/non-TTY scenarios require --accept-all)');
  console.log('  cortex reflect --list          View recent 20 confirmed suggest-loop records');
  console.log('  cortex delete                  Delete entry interactively');
  console.log('  cortex delete --id <id>        Delete specific entry');
  console.log('  cortex edit                    Edit entry interactively');
  console.log('  cortex edit --id <id>          Edit specific entry');
  console.log('  cortex sync --from claude-code|openclaw|chatgpt-export|file [--accept-all] [--dry-run]');
  console.log('                                 Scan Claude Code workspace for candidates and write to user model');
  console.log('  cortex sync --from file --path <file-or-directory> [--accept-all] [--dry-run]');
  console.log('                                 Extract content from file/directory and write to user model');
  console.log('                                 Supported formats: .md, .txt, .json, .pdf, .docx');
  console.log('                                 Scan Claude Code workspace for candidates and write to user model');
  console.log('');
  console.log(`Storage location: ${getUserModelPath()}`);
}

// CT-0014/CT-0020: minimal observation viewer entry.
// Convergent refactor: keep only trigger hints, health signals, recap, records (4 layers).
// Removed candidates layer to eliminate duplicate semantics.
export function cmdObserve(args: string[] = []): void {
  if (args.length > 0) {
    console.error(`Error: observe does not support argument ${args[0]}`);
    process.exit(1);
  }
  const log = loadObservationLog();
  const all = log.observations;
  if (all.length === 0) {
    console.log('(No usage records yet)');
    return;
  }

  // CT-0017/CT-0020: trigger hints (top layer, candidate logic already converged)
  const hintsText = renderTriggerHints(buildTriggerHints(all));
  if (hintsText) {
    console.log(hintsText);
    console.log('');
  }

  // CT-0016: health signals
  const signalsText = renderHealthSignals(buildHealthSignals(all));
  if (signalsText) {
    console.log(signalsText);
    console.log('');
  }

  // CT-0015: recap layer
  const recap = buildRecap(all);
  console.log(renderRecap(recap));
  console.log('');

  const SHOW = 20;
  const recent = all.slice(-SHOW).reverse();
  console.log('[Recent Usage Records]');
  console.log('');
  for (const obs of recent) {
    console.log('  ' + renderObservation(obs));
  }
  if (all.length > SHOW) {
    console.log('');
    console.log(`  (Total ${all.length} records, showing recent ${SHOW})`);
  }
}

function cmdSave(text: string): void {
  const trimmed = text.trim();
  if (trimmed === '') {
    console.error('Error: save requires text. Example: cortex save "avoid single point of failure"');
    process.exit(1);
  }

  const now = new Date().toISOString();
  const goal: Goal = {
    id: `goal_${randomUUID()}`,
    label: trimmed,
    scope: 'global',
    source: 'cli:save',
    created_at: now,
    updated_at: now,
  };

  updateUserModel((model) => {
    model.goals.push(goal);
    model.meta.last_updated = now;
    if (!model.meta.sources.includes('cli:save')) {
      model.meta.sources.push('cli:save');
    }
  });

  console.log('Saved to user model (goals):');
  console.log(`  - ${goal.label}`);
}

// CT-0034-02: Delete command
async function cmdDelete(args: string[]): Promise<void> {
  const model = loadUserModel();

  const idIdx = args.indexOf('--id');
  const targetId = idIdx !== -1 && args[idIdx + 1] ? args[idIdx + 1] : null;

  if (targetId) {
    await deleteById(model, targetId);
  } else {
    await deleteInteractive(model);
  }
}

async function deleteInteractive(model: UserModel): Promise<void> {
  const allEntries: Array<{ kind: string; entry: BaseItem }> = [];

  for (const kind of ['goals', 'preferences', 'constraints'] as const) {
    for (const entry of model[kind]) {
      if (entry.status !== 'deleted') {
        allEntries.push({ kind, entry });
      }
    }
  }

  if (allEntries.length === 0) {
    console.log('No entries found in user model.');
    return;
  }

  allEntries.sort((a, b) =>
    new Date(b.entry.created_at).getTime() - new Date(a.entry.created_at).getTime()
  );

  const recent = allEntries.slice(0, 20);

  console.log('Recent entries:');
  console.log('');
  recent.forEach((item, idx) => {
    const date = new Date(item.entry.created_at).toLocaleDateString();
    console.log(`[${idx + 1}] ${item.kind}: ${item.entry.label}`);
    console.log(`    (source: ${item.entry.source || 'unknown'}, created: ${date})`);
  });
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await rl.question('Enter number to delete (or q to quit): ');

  if (answer.trim() === 'q') {
    rl.close();
    return;
  }

  const num = parseInt(answer, 10);
  if (isNaN(num) || num < 1 || num > recent.length) {
    console.error('Invalid selection');
    rl.close();
    return;
  }

  const selected = recent[num - 1];
  const confirm = await rl.question(`Delete "${selected.entry.label}"? (y/n): `);
  rl.close();

  if (confirm.trim() !== 'y') {
    console.log('Cancelled');
    return;
  }

  deleteEntry(model, selected.entry.id);
  saveUserModel(model);
  console.log('✓ Entry deleted');
}

async function deleteById(model: UserModel, id: string): Promise<void> {
  const found = findEntryById(model, id);

  if (!found) {
    console.error(`Entry not found: ${id}`);
    process.exit(1);
  }

  if (found.entry.status === 'deleted') {
    console.log('Entry already deleted');
    return;
  }

  console.log(`${found.kind}: ${found.entry.label}`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const confirm = await rl.question('Delete this entry? (y/n): ');
  rl.close();

  if (confirm.trim() !== 'y') {
    console.log('Cancelled');
    return;
  }

  deleteEntry(model, id);
  saveUserModel(model);
  console.log('✓ Entry deleted');
}

function findEntryById(model: UserModel, id: string): { kind: WriteTarget; entry: BaseItem } | null {
  for (const kind of ['goals', 'preferences', 'constraints'] as const) {
    const entry = model[kind].find(e => e.id === id);
    if (entry) {
      return { kind, entry };
    }
  }
  return null;
}

function deleteEntry(model: UserModel, id: string): void {
  for (const kind of ['goals', 'preferences', 'constraints'] as const) {
    const entry = model[kind].find(e => e.id === id);
    if (entry) {
      entry.status = 'deleted';
      entry.updated_at = new Date().toISOString();
      return;
    }
  }
}

// CT-0034-03: Edit command
interface EditChanges {
  kind?: WriteTarget;
  label?: string;
  description?: string;
}

async function cmdEdit(args: string[]): Promise<void> {
  const config = loadConfig();
  const model = loadUserModel();

  const idIdx = args.indexOf('--id');
  const targetId = idIdx !== -1 && args[idIdx + 1] ? args[idIdx + 1] : null;

  if (targetId) {
    await editById(model, targetId, config);
  } else {
    await editInteractive(model, config);
  }
}

async function editInteractive(model: UserModel, config: any): Promise<void> {
  const allEntries: Array<{ kind: WriteTarget; entry: BaseItem }> = [];

  for (const kind of ['goals', 'preferences', 'constraints'] as const) {
    for (const entry of model[kind]) {
      if (entry.status !== 'deleted') {
        allEntries.push({ kind, entry });
      }
    }
  }

  if (allEntries.length === 0) {
    console.log('No entries found in user model.');
    return;
  }

  allEntries.sort((a, b) =>
    new Date(b.entry.created_at).getTime() - new Date(a.entry.created_at).getTime()
  );

  const recent = allEntries.slice(0, 20);

  console.log('Recent entries:');
  console.log('');
  recent.forEach((item, idx) => {
    const date = new Date(item.entry.created_at).toLocaleDateString();
    console.log(`[${idx + 1}] ${item.kind}: ${item.entry.label}`);
    console.log(`    (source: ${item.entry.source || 'unknown'}, created: ${date})`);
  });
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await rl.question('Enter number to edit (or q to quit): ');

  if (answer.trim() === 'q') {
    rl.close();
    return;
  }

  const num = parseInt(answer, 10);
  if (isNaN(num) || num < 1 || num > recent.length) {
    console.error('Invalid selection');
    rl.close();
    return;
  }

  const selected = recent[num - 1];
  await promptEditChanges(rl, model, selected.entry.id, config);
  rl.close();
}

async function editById(model: UserModel, id: string, config: any): Promise<void> {
  const found = findEntryById(model, id);

  if (!found) {
    console.error(`Entry not found: ${id}`);
    process.exit(1);
  }

  if (found.entry.status === 'deleted') {
    console.log('Cannot edit deleted entry');
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  await promptEditChanges(rl, model, id, config);
  rl.close();
}

async function promptEditChanges(
  rl: readline.Interface,
  model: UserModel,
  id: string,
  config: any
): Promise<void> {
  const found = findEntryById(model, id);
  if (!found) return;

  const { kind, entry } = found;

  console.log('');
  console.log('Current entry:');
  console.log(`  Kind: ${kind}`);
  console.log(`  Label: ${entry.label}`);
  console.log(`  Description: ${entry.description || '(none)'}`);
  console.log('');
  console.log('What would you like to edit?');
  console.log('  [1] Change kind');
  console.log('  [2] Edit label');
  console.log('  [3] Edit description');
  console.log('  [4] Cancel');
  console.log('');

  const choice = await rl.question('Enter choice: ');

  if (choice.trim() === '4' || choice.trim() === '') {
    console.log('Cancelled');
    return;
  }

  const changes: EditChanges = {};

  if (choice.trim() === '1') {
    console.log('');
    console.log(`Current kind: ${kind}`);
    console.log('Available kinds: goal, preference, constraint');
    console.log('');
    const newKindInput = await rl.question('Enter new kind (or q to cancel): ');
    if (newKindInput.trim() === 'q') {
      console.log('Cancelled');
      return;
    }
    const newKind = newKindInput.trim();
    if (newKind !== 'goal' && newKind !== 'preference' && newKind !== 'constraint') {
      console.error('Invalid kind. Must be: goal, preference, or constraint');
      return;
    }
    const targetKind = (newKind + 's') as WriteTarget;
    if (targetKind !== kind) {
      changes.kind = targetKind;
    }
  } else if (choice.trim() === '2') {
    console.log('');
    console.log(`Current label: ${entry.label}`);
    console.log('');
    const newLabel = await rl.question('Enter new label (or q to cancel): ');
    if (newLabel.trim() === 'q') {
      console.log('Cancelled');
      return;
    }
    if (newLabel.trim() && newLabel.trim() !== entry.label) {
      changes.label = newLabel.trim();
    }
  } else if (choice.trim() === '3') {
    console.log('');
    console.log(`Current description: ${entry.description || '(none)'}`);
    console.log('');
    const newDesc = await rl.question('Enter new description (or q to cancel): ');
    if (newDesc.trim() === 'q') {
      console.log('Cancelled');
      return;
    }
    changes.description = newDesc.trim() || undefined;
  } else {
    console.error('Invalid choice');
    return;
  }

  if (Object.keys(changes).length === 0) {
    console.log('No changes made');
    return;
  }

  console.log('');
  console.log('Confirm changes?');
  if (changes.kind) {
    const oldKindSingular = kind.slice(0, -1);
    const newKindSingular = changes.kind.slice(0, -1);
    console.log(`  Kind: ${oldKindSingular} → ${newKindSingular}`);
  }
  if (changes.label) {
    console.log(`  Label: ${entry.label} → ${changes.label}`);
  }
  if (changes.description !== undefined) {
    const oldDesc = entry.description || '(none)';
    const newDesc = changes.description || '(none)';
    console.log(`  Description: ${oldDesc} → ${newDesc}`);
  }
  console.log('');

  const confirm = await rl.question('[y/n]: ');
  if (confirm.trim() !== 'y') {
    console.log('Cancelled');
    return;
  }

  await editEntry(model, id, changes, config);
  saveUserModel(model);
  console.log('✓ Entry updated');
}

async function editEntry(
  model: UserModel,
  id: string,
  changes: EditChanges,
  config: any
): Promise<void> {
  const found = findEntryById(model, id);
  if (!found) throw new Error(`Entry not found: ${id}`);

  const { kind: oldKind, entry } = found;

  const needsEmbedding = changes.kind || changes.label;

  let newEmbedding: number[] | undefined;
  if (needsEmbedding && config.embedding?.enabled) {
    const embeddingBackend = createEmbeddingBackend(config.embedding);
    const textToEmbed = changes.label || entry.label;
    newEmbedding = await embeddingBackend.embed(textToEmbed);
  }

  if (changes.kind && changes.kind !== oldKind) {
    moveEntryBetweenKinds(model, id, oldKind, changes.kind);
  }

  if (changes.label) entry.label = changes.label;
  if (changes.description !== undefined) entry.description = changes.description;
  if (newEmbedding) {
    entry.embedding = newEmbedding;
    entry.embedding_model = config.embedding?.model || 'unknown';
  }

  entry.updated_at = new Date().toISOString();
}

function moveEntryBetweenKinds(
  model: UserModel,
  id: string,
  fromKind: WriteTarget,
  toKind: WriteTarget
): void {
  const fromArray = model[fromKind];
  const idx = fromArray.findIndex(e => e.id === id);
  if (idx === -1) throw new Error(`Entry not found in ${fromKind}: ${id}`);

  const [entry] = fromArray.splice(idx, 1);
  model[toKind].push(entry as any);
}

// CT-0013: support --scope / --task-hint, share same selection result with inject.
export function cmdContext(args: string[] = []): void {
  const model = loadUserModel();

  let scope: string | undefined;
  let taskHint: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--scope') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('Error: --scope missing argument value. Example: --scope Cortex');
        process.exit(1);
      }
      scope = args[++i];
    } else if (arg === '--task-hint') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('Error: --task-hint missing argument value. Example: --task-hint "planning injection"');
        process.exit(1);
      }
      taskHint = args[++i];
    } else {
      console.error(`Error: context does not support argument ${arg}`);
      process.exit(1);
    }
  }

  const ctx = selectRuntimeContext(model, { scope, taskHint });
  console.log(renderContextForHuman(ctx));

  // CT-0014: record usage event (fail-soft: write failure does not affect main function)
  appendObservation({
    event_type: 'context',
    scope,
    task_hint: taskHint,
    selection_strategy: ctx.meta.selection_strategy,
    selected_entries: ctx.meta.selected_entries,
    total_entries: ctx.meta.total_model_entries,
  });
}

export async function injectAllTargets(opts: {
  workspacePath?: string;
  dryRun?: boolean;
}): Promise<void> {
  const results: { target: InjectTarget; ok: boolean; error?: string }[] = [];

  for (const target of ALL_INJECT_TARGETS) {
    try {
      console.log(`\n--- ${target} ---`);
      await injectToTarget(target, opts);
      results.push({ target, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`✗ ${target}: ${msg}`);
      results.push({ target, ok: false, error: msg });
      // continue-on-error: do not interrupt, continue to next target
    }
  }

  // Summary
  console.log('\n=== Summary ===');
  const okCount = results.filter(r => r.ok).length;
  const failCount = results.length - okCount;
  console.log(`\u2713 ${okCount} target(s) succeeded`);
  if (failCount > 0) {
    console.log(`\u2717 ${failCount} target(s) failed`);
    for (const r of results.filter(r => !r.ok)) {
      console.log(`   - ${r.target}: ${r.error}`);
    }
    process.exit(1);   // Overall non-zero exit code, signaling failures
  }
}

type InjectFormat = 'text' | 'json';

// CT-0011: support --scope and --task-hint, three output paths share same selection result.
export async function cmdInject(args: string[]): Promise<void> {
  const model = loadUserModel();

  let agentId = 'generic';
  let format: InjectFormat = 'text';
  let scope: string | undefined;
  let taskHint: string | undefined;
  let withObservation = false;
  let target: string | undefined;
  let allTargets = false;
  let workspace: string | undefined;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--target') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('Error: --target missing argument value. Example: --target openclaw');
        process.exit(1);
      }
      target = args[i + 1];
      i++;
    } else if (arg === '--all-targets') {
      allTargets = true;
    } else if (arg === '--workspace') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('Error: --workspace missing argument value.');
        process.exit(1);
      }
      workspace = args[i + 1];
      i++;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--agent') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('Error: --agent missing argument value. Example: --agent claude-code');
        process.exit(1);
      }
      agentId = args[i + 1];
      i++;
    } else if (arg === '--format') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('Error: --format missing argument value. Valid values: text | json');
        process.exit(1);
      }
      const value = args[i + 1];
      if (value !== 'text' && value !== 'json') {
        console.error(`Error: --format invalid value（${value})。Valid values: text | json`);
        process.exit(1);
      }
      format = value;
      i++;
    } else if (arg === '--scope') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('`Error: --scope missing argument value. Example: --scope Cortex');
        process.exit(1);
      }
      scope = args[i + 1];
      i++;
    } else if (arg === '--task-hint') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('`Error: --task-hint missing argument value. Example: --task-hint "planning injection"');
        process.exit(1);
      }
      taskHint = args[i + 1];
      i++;
    } else if (arg === '--with-observation') {
      withObservation = true;
    } else {
      console.error(`Error: unknown argument ${arg}`);
      process.exit(1);
    }
  }

  if (allTargets) {
    if (target) {
      console.error('Error: --all-targets and --target cannot be used together');
      process.exit(1);
    }
    await injectAllTargets({ workspacePath: workspace, dryRun });
    return;
  }

  if (target === 'openclaw') {
    await injectToOpenClaw({ workspacePath: workspace, dryRun });
    return;
  }

  // CT-0019: if enabled, read observation log to build recap (no effect on json format, kept to avoid side effects)
  let recap;
  if (withObservation && format === 'text') {
    const log = loadObservationLog();
    recap = buildRecap(log.observations);
  }

  // CT-0014: run selection once before successful path to obtain meta (in-memory only, no IO)
  const injectCtx = selectRuntimeContext(model, { agent: agentId, scope, taskHint });

  if (format === 'json') {
    const pack = buildInjectionPack(model, { agent: agentId, scope, taskHint });
    console.log(serializeInjectionPack(pack));
    appendObservation({
      event_type: 'inject',
      agent: agentId,
      scope,
      task_hint: taskHint,
      selection_strategy: injectCtx.meta.selection_strategy,
      selected_entries: injectCtx.meta.selected_entries,
      total_entries: injectCtx.meta.total_model_entries,
    });
    return;
  }

  // text path: claude-code goes through structured pack -> projector; other agents keep CT-0008 behavior.
  if (agentId === 'claude-code') {
    const pack = buildInjectionPack(model, { agent: agentId, scope, taskHint });
    const projection = projectPackForClaudeCode(pack, { recap });
    console.log(projection.instruction_text);
    appendObservation({
      event_type: 'inject',
      agent: agentId,
      scope,
      task_hint: taskHint,
      selection_strategy: injectCtx.meta.selection_strategy,
      selected_entries: injectCtx.meta.selected_entries,
      total_entries: injectCtx.meta.total_model_entries,
    });
    return;
  }

  const pkg = createInjectionPackage(model, agentId, { scope, taskHint, recap });
  console.log(pkg.instruction_text);
  appendObservation({
    event_type: 'inject',
    agent: agentId,
    scope,
    task_hint: taskHint,
    selection_strategy: injectCtx.meta.selection_strategy,
    selected_entries: injectCtx.meta.selected_entries,
    total_entries: injectCtx.meta.total_model_entries,
  });
}


// --- import ---

function printCandidates(items: CandidateItem[]): void {
  console.log('');
  console.log('Detected the following candidates:');
  console.log('');
  items.forEach((item, i) => {
    const tag = item.type ? `[${item.type}]` : '[uncategorized]';
    const basename = path.basename(item.source_path);
    console.log(`${i + 1}. ${tag} ${item.text} (${basename})`);
  });
  console.log('');
}

// Parse user input: supports "all" / "none" (or empty) / "1,2,3"
function parseSelection(input: string, total: number): number[] {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === '' || trimmed === 'none') return [];
  if (trimmed === 'all') return Array.from({ length: total }, (_, i) => i);

  const picked = new Set<number>();
  for (const part of trimmed.split(/[,\s]+/)) {
    if (!part) continue;
    const n = Number.parseInt(part, 10);
    if (Number.isNaN(n) || n < 1 || n > total) {
      throw new Error(`Invalid number: ${part} (should be between 1 and ${total})`);
    }
    picked.add(n - 1);
  }
  return [...picked].sort((a, b) => a - b);
}

async function promptSelection(total: number): Promise<number[]> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(
      'Select items to add (numbers like "1,2", or "all" / "none"): '
    );
    return parseSelection(answer, total);
  } finally {
    rl.close();
  }
}

// Write result summary
interface WriteResult {
  written: CandidateItem[];
  skipped: CandidateItem[];
}

// Dispatch candidates by type into the corresponding arrays of user model.
// - Missing type -> defaults to goals
// - Each source generated independently from source_path (file-level provenance)
// - Exact normalized dedupe against existing model + this batch; duplicates skipped
//
// CT-0005: switched to shared write layer writeItemsToUserModel
function writeCandidates(
  items: CandidateItem[],
  mode: 'basic' | 'llm'
): WriteResult {
  const written: CandidateItem[] = [];
  const skipped: CandidateItem[] = [];
  if (items.length === 0) return { written, skipped };

  // Convert to WriteableItem[]
  const writeables: WriteableItem[] = items.map((item) => {
    const rawType = item.type ?? 'goal';
    const validCategories = new Set<string>(['goal', 'constraint', 'preference']);
    const type: WriteCategory = validCategories.has(rawType) ? rawType as WriteCategory : 'goal';
    return {
      target: targetFromCategory(type),
      label: item.text,
      source: `cli:import:${mode}:${path.basename(item.source_path)}`,
    };
  });

  const result = writeItemsToUserModel(writeables);

  // Reconstruct written / skipped lists from indices returned by shared layer
  for (const w of result.writtenItems) {
    const idx = writeables.indexOf(w);
    if (idx !== -1) written.push(items[idx]);
  }
  for (const s of result.skippedItems) {
    const idx = writeables.indexOf(s);
    if (idx !== -1) skipped.push(items[idx]);
  }

  return { written, skipped };
}

async function cmdImport(args: string[]): Promise<void> {
  let useLlmFlag = false;
  let adapterId: string | undefined = undefined;
  const targets: string[] = [];

  // 1. Scan args
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--llm') {
      useLlmFlag = true;
    } else if (arg === '--adapter') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('Error: --adapter missing argument value. Example: --adapter claude-code');
        process.exit(1);
      }
      adapterId = args[i + 1];
      i++; // Skip next argument
    } else if (arg.startsWith('--')) {
      console.error(`Error: unknown argument ${arg}`);
      process.exit(1);
    } else {
      targets.push(arg);
    }
  }

  if (targets.length === 0) {
    console.error('Error: import requires a path. Example: cortex import ./notes.md');
    process.exit(1);
  }
  
  if (targets.length > 1) {
    console.error(`Error: import only allows one path, but received multiple: ${targets.join(', ')}`);
    process.exit(1);
  }

  const target = targets[0];

  // CT-0006/CT-0007: build SourceDescriptor, select adapter via registry
  let descriptor;
  try {
    descriptor = createDescriptorFromPath(target);
    if (adapterId) {
      descriptor.adapter = adapterId;
    }
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error(`Error: ${err.message}`);
    } else {
      console.error('Error: cannot identify the path');
    }
    process.exit(1);
  }

  let adapter;
  try {
    adapter = getAdapterForSource(descriptor);
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error(`Error: ${err.message}`);
    } else {
      console.error('Error: no adapter can handle this source');
    }
    process.exit(1);
  }

  const blocks = await adapter.load(descriptor);
  console.log(`Read ${blocks.length} text block(s) (from ${target})`);

  // LLM mode is enabled only when --llm flag and key are both present, otherwise fall back to basic
  const llmAvailable = useLlmFlag && Boolean(process.env.OPENAI_API_KEY);
  let candidates: CandidateItem[];
  let mode: 'basic' | 'llm';

  if (useLlmFlag && !process.env.OPENAI_API_KEY) {
    console.log('LLM not enabled, using basic mode (missing OPENAI_API_KEY)');
  }

  if (llmAvailable) {
    console.log('Extracting candidates with LLM...');
    candidates = await llmExtract(blocks);
    mode = 'llm';
  } else {
    if (!useLlmFlag) {
      console.log('LLM not enabled, using basic mode');
    }
    candidates = basicExtract(blocks);
    mode = 'basic';
  }

  if (candidates.length === 0) {
    console.log('No candidates extracted, exiting.');
    return;
  }

  printCandidates(candidates);
  const indices = await promptSelection(candidates.length);

  if (indices.length === 0) {
    console.log('No candidates selected, exiting.');
    return;
  }

  const picked = indices.map((i) => candidates[i]);
  const { written, skipped } = writeCandidates(picked, mode);

  console.log('');
  if (written.length > 0) {
    console.log(`Wrote ${written.length} item(s) to user model:`);
    for (const item of written) {
      const tag = item.type ?? 'goal';
      const basename = path.basename(item.source_path);
      console.log(`  - [${tag}] ${item.text} (${basename})`);
    }
    console.log(`\n\u2139\ufe0f  Run cortex inject --all-targets to sync to all agents`);
  } else {
    console.log('No items written.');
  }
  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length} duplicate item(s)`);
  }
}

// --- suggest ---

function printSuggestions(items: SuggestionItem[]): void {
  console.log('');
  console.log('Detected the following suggestions:');
  console.log('');
  items.forEach((item, i) => {
    console.log(`${i + 1}. [${item.type}] ${item.text}`);
  });
  console.log('');
}

interface SuggestWriteResult {
  written: SuggestionItem[];
  skipped: SuggestionItem[];
}

// Dispatch selected suggestions into corresponding arrays of user model.
// - Each source uses SuggestionItem.source directly (cli:suggest:basic / llm)
// - Exact normalized dedupe against existing model + this batch (consistent with CT-0003 write semantics)
//
// CT-0005: switched to shared write layer writeItemsToUserModel
function writeSuggestions(items: SuggestionItem[]): SuggestWriteResult {
  const written: SuggestionItem[] = [];
  const skipped: SuggestionItem[] = [];
  if (items.length === 0) return { written, skipped };

  // Convert to WriteableItem[]
  const writeables: WriteableItem[] = items.map((item) => ({
    target: targetFromCategory(item.type),
    label: item.text,
    source: item.source,
  }));

  const result = writeItemsToUserModel(writeables);

  // Reconstruct written / skipped lists from indices returned by shared layer
  for (const w of result.writtenItems) {
    const idx = writeables.indexOf(w);
    if (idx !== -1) written.push(items[idx]);
  }
  for (const s of result.skippedItems) {
    const idx = writeables.indexOf(s);
    if (idx !== -1) skipped.push(items[idx]);
  }

  return { written, skipped };
}

async function cmdSuggest(args: string[]): Promise<void> {
  const useLlmFlag = args.includes('--llm');
  const text = args
    .filter((a) => !a.startsWith('--'))
    .join(' ')
    .trim();

  if (!text) {
    console.error(
      'Error: suggest requires text. Example: cortex suggest "I want to advance Cortex but avoid single point of failure"'
    );
    process.exit(1);
  }

  const llmAvailable = useLlmFlag && Boolean(process.env.OPENAI_API_KEY);

  if (useLlmFlag && !process.env.OPENAI_API_KEY) {
    console.log('LLM not enabled, using basic mode (missing OPENAI_API_KEY)');
  }

  let suggestions: SuggestionItem[];
  if (llmAvailable) {
    console.log('Extracting suggestions with LLM...');
    suggestions = await llmSuggest(text);
  } else {
    if (!useLlmFlag) {
      console.log('LLM not enabled, using basic mode');
    }
    suggestions = basicSuggest(text);
  }

  if (suggestions.length === 0) {
    console.log('No suggestions extracted, exiting.');
    return;
  }

  printSuggestions(suggestions);
  const indices = await promptSelection(suggestions.length);

  if (indices.length === 0) {
    console.log('No suggestions selected, exiting.');
    return;
  }

  const picked = indices.map((i) => suggestions[i]);
  const { written, skipped } = writeSuggestions(picked);

  console.log('');
  if (written.length > 0) {
    console.log(`Wrote ${written.length} item(s) to user model:`);
    for (const item of written) {
      console.log(`  - [${item.type}] ${item.text}`);
    }
    console.log(`\n\u2139\ufe0f  Run cortex inject --all-targets to sync to all agents`);
  } else {
    console.log('No items written.');
  }
  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length} duplicate item(s)`);
  }
}

// --- sync ---

function printExtractionCandidates(items: ExtractionCandidate[]): void {
  items.forEach((item, i) => {
    console.log(`\n[${i + 1}] ${item.kind}: ${item.content}`);
    console.log(`    (from: ${item.provenance.path})`);
  });
}

export interface SyncOptions {
  // Injection points for testing
  promptFn?: (total: number) => Promise<number[]>;
  extractFn?: (rootPath: string) => Promise<ExtractionCandidate[]>;
}

export async function cmdSync(args: string[], opts: SyncOptions = {}): Promise<void> {
  const _promptFn = opts.promptFn ?? promptSelection;
  const _extractFn = opts.extractFn ?? extractFromClaudeCodeWorkspace;

  // Argument parsing
  const fromIdx = args.indexOf('--from');
  const acceptAll = args.includes('--accept-all');
  const dryRun = args.includes('--dry-run');

  // --accept-all and --dry-run are mutually exclusive
  if (acceptAll && dryRun) {
    console.error('Error: --accept-all and --dry-run are mutually exclusive');
    process.exit(1);
  }

  // --from is required
  if (fromIdx === -1 || !args[fromIdx + 1]) {
    console.error('Usage: cortex sync --from <adapter-id> [--accept-all] [--dry-run]');
    console.error('Currently supported adapters: claude-code, openclaw, chatgpt-export, file');
    process.exit(1);
  }

  const adapterId = args[fromIdx + 1];
  if (adapterId !== 'claude-code' && adapterId !== 'openclaw' && adapterId !== 'chatgpt-export' && adapterId !== 'file') {
    console.error(`Adapter not supported: ${adapterId}`);
    console.error('Currently supported adapters: claude-code, openclaw, chatgpt-export, file');
    process.exit(1);
  }

  // Check unknown arguments
  const knownArgs = new Set(['--from', adapterId, '--accept-all', '--dry-run', '--workspace', '--since', '--min-length', '--max-conversations', '--path']);
  const unknown = args.filter(a => a.startsWith('-') && !knownArgs.has(a));
  if (unknown.length > 0) {
    console.error(`Unknown argument(s): ${unknown.join(', ')}`);
    process.exit(1);
  }

  const workspaceRoot = process.cwd();

  let targetWorkspace = workspaceRoot;
  const posArg = args.find(a => !a.startsWith('-') && a !== 'sync' && a !== 'cortex' && a !== adapterId && args[args.indexOf(a) - 1] !== '--from');
  if (posArg) {
    targetWorkspace = posArg;
  } else if (adapterId === 'openclaw') {
    targetWorkspace = undefined as any;
  }

  let displayWorkspace = targetWorkspace;
  if (adapterId === 'openclaw') {
    try {
      displayWorkspace = resolveWorkspacePath(targetWorkspace);
    } catch (e) {
      displayWorkspace = 'OpenClaw Workspace';
    }
  }

  // Scan
  console.log('Cortex is understanding you (not recording you) from your workspace...');
  console.log(`Scan path: ${displayWorkspace}`);


  // Parse chatgpt-export specific arguments
  let chatgptWorkspace: string | undefined;
  let chatgptSince: Date | undefined;
  let chatgptMinLength: number | undefined;
  let chatgptMaxConversations: number | undefined;

  if (adapterId === 'chatgpt-export') {
    const workspaceIdx = args.indexOf('--workspace');
    if (workspaceIdx !== -1 && args[workspaceIdx + 1]) {
      chatgptWorkspace = args[workspaceIdx + 1];
    }

    const sinceIdx = args.indexOf('--since');
    if (sinceIdx !== -1 && args[sinceIdx + 1]) {
      chatgptSince = new Date(args[sinceIdx + 1]);
    }

    const minLengthIdx = args.indexOf('--min-length');
    if (minLengthIdx !== -1 && args[minLengthIdx + 1]) {
      chatgptMinLength = parseInt(args[minLengthIdx + 1], 10);
    }

    const maxConvIdx = args.indexOf('--max-conversations');
    if (maxConvIdx !== -1 && args[maxConvIdx + 1]) {
      chatgptMaxConversations = parseInt(args[maxConvIdx + 1], 10);
    }

    if (!chatgptWorkspace) {
      console.error('Error: chatgpt-export adapter requires --workspace argument');
      console.error('Usage: cortex sync --from chatgpt-export --workspace <path> [--since YYYY-MM] [--min-length N] [--max-conversations N]');
      process.exit(1);
    }
  }

  // Parse file adapter specific arguments
  let filePath: string | undefined;
  
  if (adapterId === 'file') {
    const pathIdx = args.indexOf('--path');
    if (pathIdx !== -1 && args[pathIdx + 1]) {
      filePath = args[pathIdx + 1];
    }

    if (!filePath) {
      console.error('Error: file adapter requires --path argument');
      console.error('Usage: cortex sync --from file --path <file-or-directory> [--accept-all] [--dry-run]');
      process.exit(1);
    }
  }

  // Update displayWorkspace for file adapter
  if (adapterId === 'file') {
    displayWorkspace = filePath || 'File/Directory';
  }


  // Update displayWorkspace for chatgpt-export
  if (adapterId === 'chatgpt-export') {
    displayWorkspace = chatgptWorkspace || 'ChatGPT Export';
  }

  // CT-0027-04: load config and create backends
  const config = loadConfig();
  const llmBackend = config.llm.enabled ? createLLMBackend(config.llm) : undefined;
  const embeddingBackend = config.embedding.enabled ? createEmbeddingBackend(config.embedding) : undefined;

  // CT-0027-05: Step 4 - LLM health check
  if (llmBackend) {
    const health = await llmBackend.healthCheck();
    if (!health.ok) {
      console.error('⚠️  Cortex requires an LLM backend to work.');
      console.error('   Run "cortex setup" to configure your LLM provider.');
      console.error(`   Error: ${health.error}`);
      process.exit(1);
    }
  }

  // CT-0027-04: auto-migrate user_model on startup (if needed)
  if (embeddingBackend) {
    const currentModel = loadUserModel();
    if (needsMigration(currentModel)) {
      let migratedModel = await migrateUserModelV0_2(currentModel, embeddingBackend);
      if (migratedModel.schema_version === '0.2') {
        migratedModel = migrateUserModelV0_3(migratedModel);
      }
      saveUserModel(migratedModel);
    }
  }

  // CT-0027-04: get ContentBlock[] instead of directly getting ExtractionCandidate[]
  let contentBlocks: ContentBlock[];
  if (adapterId === 'chatgpt-export') {
    contentBlocks = await extractContentBlocksFromChatGPT({
      exportPath: chatgptWorkspace!,
      since: chatgptSince,
      minChars: chatgptMinLength,
      maxConversations: chatgptMaxConversations,
    });
  } else if (adapterId === 'file') {
    // CT-0033-01: File adapter
    const { extractFromFile } = await import('./adapters/file/index.js');
    contentBlocks = await extractFromFile({ path: filePath! });
  } else {
    // Other adapters temporarily use old logic (returning ExtractionCandidate[])
    // Future: gradually migrate to ContentBlock[]
    const oldCandidates = adapterId === 'openclaw'
      ? await extractFromOpenClawWorkspace(targetWorkspace)
      : await _extractFn(targetWorkspace);

    if (oldCandidates.length === 0) {
      console.log('No candidates extracted from workspace.');
      console.log('Please confirm workspace contains CLAUDE.md / README.md / package.json / .claude/ directories.');
      return;
    }

    console.log(`\nScanned ${oldCandidates.length} candidate fact(s).`);

    // Old logic: directly use ExtractionCandidate[]
    const SUPPORTED_KINDS = new Set<string>(['goal', 'constraint', 'preference']);
    const supportedCandidates = oldCandidates.filter(c => SUPPORTED_KINDS.has(c.kind));
    const unsupportedCandidates = oldCandidates.filter(c => !SUPPORTED_KINDS.has(c.kind));

    if (unsupportedCandidates.length > 0) {
      const unsupportedKinds = [...new Set(unsupportedCandidates.map(c => c.kind))];
      const kindList = unsupportedKinds.map(k => `'${k}'`).join(' / ');
      console.warn(`\u26a0 ${unsupportedCandidates.length} candidate(s) skipped due to kind ${kindList} not supported by write layer:`);
      for (const c of unsupportedCandidates) {
        const snippet = c.content.length > 60 ? c.content.slice(0, 60) + '...' : c.content;
        console.warn(`  - ${c.kind}: ${snippet}  (from: ${c.provenance.path})`);
      }
      console.warn(`(Future tasks will extend write layer to support all kinds)`);
    }

    if (supportedCandidates.length === 0) {
      console.log('No writeable candidates after filtering.');
      return;
    }

    // Display candidates
    printExtractionCandidates(supportedCandidates);
    console.log('');

    // dry-run: only display, do not write
    if (dryRun) {
      console.log('[dry-run] Above candidates not written. Use --accept-all or interactive mode to write.');
      return;
    }

    // Determine which candidates to write
    let selectedIndices: number[];

    if (acceptAll) {
      selectedIndices = supportedCandidates.map((_, i) => i);
    } else {
      // Interactive confirmation
      if (!process.stdin.isTTY) {
        console.error('Error: interactive mode requires TTY. Use --accept-all to skip interaction, or pipe input via --stdin.');
        process.exit(1);
      }
      console.log('Select candidates to write to user model (input numbers, comma-separated, or "a" for all):');
      selectedIndices = await _promptFn(supportedCandidates.length);
    }

    if (selectedIndices.length === 0) {
      console.log('No candidates selected, exiting.');
      return;
    }

    const selectedCandidates = selectedIndices.map(i => supportedCandidates[i]);

    // Build WriteableItem[]
    const writeables: WriteableItem[] = selectedCandidates.map(c => ({
      target: targetFromCategory(c.kind as WriteCategory),
      label: c.content,
      source: `cli:sync:${adapterId}:${c.provenance.path}`,
    }));

    const result = writeItemsToUserModel(writeables, {
      embeddingBackend,
      threshold: config.embedding.similarityThreshold,
    });

    // Success output
    const writtenCount = result.writtenItems.length;
    const skippedCount = result.skippedItems.length;
    const supersededCount = result.superseded;

    console.log(`\n\u2713 Wrote ${writtenCount} fact(s) to your user model`);

    if (writtenCount > 0) {
      const byKind: Record<string, number> = {};
      for (let i = 0; i < selectedCandidates.length; i++) {
        if (result.writtenItems.includes(writeables[i])) {
          const k = selectedCandidates[i].kind;
          byKind[k] = (byKind[k] ?? 0) + 1;
        }
      }
      const summary = Object.entries(byKind).map(([k, v]) => `${k}s: ${v}`).join(', ');
      if (summary) console.log(`  ( ${summary} )`);
    }

    if (supersededCount > 0) {
      console.log(`  (${supersededCount} replaced older preference(s) (marked superseded))`);
    }

    if (skippedCount > 0) {
      console.log(`  (${skippedCount} skipped due to duplicates)`);
    }

    console.log(`\nYour user model is now ${writtenCount} facts richer.`);
    console.log('Run `cortex context` to view full user model.');
    console.log('Run `cortex inject --format text` to get context paste-ready for other AIs.');

    if (!dryRun && writtenCount > 0) {
      console.log(`\n\u2139\ufe0f  Run cortex inject --all-targets to sync to all agents`);
    }
    return;
  }

  // CT-0027-04: new logic - using pipeline
  if (contentBlocks.length === 0) {
    console.log('No content blocks extracted from workspace.');
    return;
  }

  // Run pipeline
  const allCandidates = await runExtractionPipeline(contentBlocks, {
    llmBackend,
    embeddingBackend,
    config,
  });

  if (allCandidates.length === 0) {
    console.log('No candidates extracted from workspace.');
    console.log('Please confirm workspace contains CLAUDE.md / README.md / package.json / .claude/ directories.');
    return;
  }

  console.log(`\nScanned ${allCandidates.length} candidate fact(s).`);

  // kind filter: write layer only supports goal | constraint | preference
  const SUPPORTED_KINDS = new Set<string>(['goal', 'constraint', 'preference']);
  const supportedCandidates = allCandidates.filter(c => SUPPORTED_KINDS.has(c.kind));
  const unsupportedCandidates = allCandidates.filter(c => !SUPPORTED_KINDS.has(c.kind));

  if (unsupportedCandidates.length > 0) {
    const unsupportedKinds = [...new Set(unsupportedCandidates.map(c => c.kind))];
    const kindList = unsupportedKinds.map(k => `'${k}'`).join(' / ');
    console.warn(`\u26a0 ${unsupportedCandidates.length} candidate(s) skipped due to kind ${kindList} not supported by write layer:`);
    for (const c of unsupportedCandidates) {
      const snippet = c.content.length > 60 ? c.content.slice(0, 60) + '...' : c.content;
      console.warn(`  - ${c.kind}: ${snippet}  (from: ${c.provenance.path})`);
    }
    console.warn(`(Future tasks will extend write layer to support all kinds)`);
  }

  if (supportedCandidates.length === 0) {
    console.log('No writeable candidates after filtering.');
    return;
  }

  // Display candidates
  printExtractionCandidates(supportedCandidates);
  console.log('');

  // dry-run: only display, do not write
  if (dryRun) {
    console.log('[dry-run] Above candidates not written. Use --accept-all or interactive mode to write.');
    return;
  }

  // Determine which candidates to write
  let selectedIndices: number[];

  if (acceptAll) {
    selectedIndices = supportedCandidates.map((_, i) => i);
  } else {
    // Interactive confirmation
    if (!process.stdin.isTTY) {
      console.error('Error: interactive mode requires TTY. Use --accept-all to skip interaction, or pipe input via --stdin.');
      process.exit(1);
    }
    console.log('Select candidates to write to user model (input numbers, comma-separated, or "a" for all):');
    selectedIndices = await _promptFn(supportedCandidates.length);
  }

  if (selectedIndices.length === 0) {
    console.log('No candidates selected, exiting.');
    return;
  }

  const selectedCandidates = selectedIndices.map(i => supportedCandidates[i]);

  // Build WriteableItem[]
  const writeables: WriteableItem[] = selectedCandidates.map(c => ({
    target: targetFromCategory(c.kind as WriteCategory),
    label: c.content,
    source: `cli:sync:${adapterId}:${c.provenance.path}`,
  }));

  const result = writeItemsToUserModel(writeables, {
    embeddingBackend,
    threshold: config.embedding.similarityThreshold,
  });

  // Success output
  const writtenCount = result.writtenItems.length;
  const skippedCount = result.skippedItems.length;

  console.log(`\n\u2713 Wrote ${writtenCount} fact(s) to your user model`);

  if (writtenCount > 0) {
    const byKind: Record<string, number> = {};
    for (let i = 0; i < selectedCandidates.length; i++) {
      if (result.writtenItems.includes(writeables[i])) {
        const k = selectedCandidates[i].kind;
        byKind[k] = (byKind[k] ?? 0) + 1;
      }
    }
    const summary = Object.entries(byKind).map(([k, v]) => `${k}s: ${v}`).join(', ');
    if (summary) console.log(`  ( ${summary} )`);
  }

  if (skippedCount > 0) {
    console.log(`  (${skippedCount} skipped due to duplicates)`);
  }

  console.log(`\nYour user model is now ${writtenCount} facts richer.`);
  console.log('Run `cortex context` to view full user model.');
  console.log('Run `cortex inject --format text` to get context paste-ready for other AIs.');

  if (!dryRun && writtenCount > 0) {
    console.log(`\n\u2139\ufe0f  Run cortex inject --all-targets to sync to all agents`);
  }
}

// --- reflect ---

export interface ReflectOptions {
  // Injection points for testing
  promptFn?: (total: number) => Promise<number[]>;
  readStdinFn?: () => Promise<string[]>;
}

async function defaultReadStdinLines(): Promise<string[]> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', (line) => lines.push(line));
    rl.on('close', () => resolve(lines));
  });
}

export async function cmdReflect(args: string[], opts: ReflectOptions = {}): Promise<void> {
  const _promptFn = opts.promptFn ?? promptSelection;
  const _readStdinFn = opts.readStdinFn ?? defaultReadStdinLines;

  let useStdin = false;
  let acceptAll = false;
  let listMode = false;
  let description: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--stdin') {
      useStdin = true;
    } else if (arg === '--accept-all') {
      acceptAll = true;
    } else if (arg === '--list') {
      listMode = true;
    } else if (arg === '--description') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        console.error('Error: --description missing argument value');
        process.exit(1);
      }
      description = args[i + 1];
      i++; // Skip next arg
    } else if (arg.startsWith('--')) {
      console.error(`Error: reflect does not support argument ${arg}`);
      process.exit(1);
    } else {
      positional.push(arg);
    }
  }

  // --list mode is no longer supported with the deprecation of suggest-loop-store.json
  if (listMode) {
    console.error('Error: --list is deprecated. reflect now writes directly to main user model; please use cortex context to view.');
    process.exit(1);
  }

  // --accept-all is only meaningful with --stdin; combining with positional args is ambiguous.
  if (acceptAll && positional.length > 0) {
    console.error('Error: --accept-all cannot be combined with positional arguments; use --stdin --accept-all instead');
    process.exit(1);
  }

  // Mutual exclusion: --stdin and positional args.
  if (useStdin && positional.length > 0) {
    console.error('Error: --stdin and positional arguments are mutually exclusive');
    process.exit(1);
  }

  // Preflight: non-TTY stdin without --accept-all would silently fail at interactive selection.
  if (useStdin && !acceptAll && process.stdin.isTTY !== true) {
    console.error(
      'Error: detected non-interactive input (stdin is not TTY), cannot enter interactive selection.\n' +
      'Please add --accept-all to auto-confirm all candidates, or use positional arguments: cortex reflect "text"',
    );
    process.exit(1);
  }

  let inputs: string[];
  if (useStdin) {
    const lines = await _readStdinFn();
    inputs = lines.map((l) => l.trim()).filter((l) => l !== '');
    if (inputs.length === 0) {
      console.error('Error: stdin is empty, no candidate input');
      process.exit(1);
    }
  } else {
    const text = positional.join(' ').trim();
    if (!text) {
      console.error('Error: reflect requires text. Example: cortex reflect "..."');
      process.exit(1);
    }
    inputs = [text];
  }

  // CT-0032-01: Load config and create backends
  const config = loadConfig();
  const llmBackend = config.llm.enabled ? createLLMBackend(config.llm) : undefined;
  const embeddingBackend = config.embedding.enabled ? createEmbeddingBackend(config.embedding) : undefined;

  // CT-0032-01: LLM health check
  if (!llmBackend) {
    console.error('\u26a0\ufe0f  Cortex requires an LLM backend to work.');
    console.error('   Run "cortex setup" to configure your LLM provider.');
    process.exit(1);
  }

  const health = await llmBackend.healthCheck();
  if (!health.ok) {
    console.error('\u26a0\ufe0f  Cortex requires an LLM backend to work.');
    console.error('   Run "cortex setup" to configure your LLM provider.');
    console.error(`   Error: ${health.error}`);
    process.exit(1);
  }

  // CT-0032-01: Convert inputs to ContentBlock[]
  const contentBlocks: ContentBlock[] = inputs.map((text, idx) => ({
    path: `cli:reflect:input-${idx}`,
    content: text,
    kind: 'plain' as const,
    hint: 'plain' as const,
  }));

  // CT-0032-01: Run extraction pipeline
  const candidates = await runExtractionPipeline(contentBlocks, {
    llmBackend,
    embeddingBackend,
    config,
  });

  // CT-0032-01: Filter to supported kinds
  const SUPPORTED_KINDS = new Set<string>(['goal', 'constraint', 'preference']);
  const suggestions = candidates.filter(c => SUPPORTED_KINDS.has(c.kind));

  if (suggestions.length === 0) {
    console.log('No candidates found, exiting.');
    return;
  }

  console.log('');
  console.log('Detected the following candidates:');
  console.log('');
  suggestions.forEach((item, i) => {
    console.log(`${i + 1}. [${item.kind}] ${item.content}`);
  });
  console.log('');

  const confirmedIndices = acceptAll
    ? suggestions.map((_, i) => i)
    : await _promptFn(suggestions.length);

  if (confirmedIndices.length === 0) {
    console.log('No candidates selected, exiting.');
    return;
  }

  const selectedCandidates = confirmedIndices.map(i => suggestions[i]);

  const writeables: WriteableItem[] = selectedCandidates.map(c => ({
    target: targetFromCategory(c.kind as WriteCategory),
    label: c.content,
    description: description,
    source: 'cli:reflect',
  }));

  const result = writeItemsToUserModel(writeables, {
    embeddingBackend,
    threshold: config.embedding.similarityThreshold,
  });

  const writtenCount = result.writtenItems.length;
  const skippedCount = result.skippedItems.length;

  console.log(`\n\u2713 Wrote ${writtenCount} fact(s) to your user model`);

  if (writtenCount > 0) {
    const byKind: Record<string, number> = {};
    for (let i = 0; i < selectedCandidates.length; i++) {
      if (result.writtenItems.includes(writeables[i])) {
        const k = selectedCandidates[i].kind;
        byKind[k] = (byKind[k] ?? 0) + 1;
      }
    }
    const summary = Object.entries(byKind).map(([k, v]) => `${k}s: ${v}`).join(', ');
    if (summary) console.log(`  ( ${summary} )`);
  }

  if (skippedCount > 0) {
    console.log(`  (${skippedCount} skipped due to duplicates)`);
  }

  console.log(`\nYour user model is now ${writtenCount} facts richer.`);
  console.log('Run `cortex context` to view full user model.');
  console.log('Run `cortex inject --format text` to get context paste-ready for other AIs.');

  if (writtenCount > 0) {
    console.log(`\n\u2139\ufe0f  Run cortex inject --all-targets to sync to all agents`);
  }
}

// --- main ---

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;

  switch (cmd) {
    case 'save':
      cmdSave(rest.join(' '));
      break;
    case 'context':
      cmdContext(rest);
      break;
    case 'inject':
      await cmdInject(rest);
      break;
    case 'observe':
      cmdObserve(rest);
      break;
    case 'import':
      await cmdImport(rest);
      break;
    case 'suggest':
      await cmdSuggest(rest);
      break;
    case 'reflect':
      await cmdReflect(rest);
      break;
    case 'sync':
      await cmdSync(rest);
      break;
    case 'setup':
      await cmdSetup({
        reset: rest.includes('--reset'),
        check: rest.includes('--check'),
      });
      break;
    case 'delete':
      await cmdDelete(rest);
      break;
    case 'edit':
      await cmdEdit(rest);
      break;
    case undefined:
    case '-h':
    case '--help':
      usage();
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      usage();
      process.exit(1);
  }
}

// Only start main() when run directly as entry; skip when imported as module
// to avoid CLI logic being triggered accidentally during test loading.
if (process.argv[1] != null &&
    path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((err: unknown) => {
    if (err instanceof Error) {
      console.error(`Error: ${err.message}`);
    } else {
      console.error('Error: unknown exception', err);
    }
    process.exit(1);
  });
}
