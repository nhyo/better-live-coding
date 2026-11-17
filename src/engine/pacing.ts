/**
 * Deterministic Human Mode rhythm. Delays vary per character but depend only on
 * the presentation seed, step, operation and character, so every rehearsal of
 * the same configuration has exactly the same timing.
 */

import { Operation, Step, operationText } from '../config/types';
import { deterministicRange } from '../utilities/text';

export type ResolvedPace = 'fast' | 'slow';

export interface PacingSettings {
  humanMode: boolean;
  fixedTypingDelayMs: number;
  fastTypingDelayMinMs: number;
  fastTypingDelayMaxMs: number;
  slowTypingDelayMinMs: number;
  slowTypingDelayMaxMs: number;
  punctuationPauseMs: number;
  linePauseMs: number;
  blankLinePauseMs: number;
  blockEndPauseMs: number;
  fileSwitchPauseMs: number;
  thinkingPauseMs: number;
  suggestionVisibleMs: number;
  editorEffects: boolean;
}

export const DEFAULT_PACING: PacingSettings = {
  humanMode: true,
  fixedTypingDelayMs: 28,
  fastTypingDelayMinMs: 12,
  fastTypingDelayMaxMs: 25,
  slowTypingDelayMinMs: 35,
  slowTypingDelayMaxMs: 60,
  punctuationPauseMs: 90,
  linePauseMs: 180,
  blankLinePauseMs: 550,
  blockEndPauseMs: 400,
  fileSwitchPauseMs: 700,
  thinkingPauseMs: 500,
  suggestionVisibleMs: 420,
  editorEffects: true
};

/** Bounds used to clamp user-provided settings. */
export const PACING_BOUNDS: Record<keyof Omit<PacingSettings, 'humanMode' | 'editorEffects'>, [number, number]> = {
  fixedTypingDelayMs: [0, 200],
  fastTypingDelayMinMs: [0, 200],
  fastTypingDelayMaxMs: [0, 250],
  slowTypingDelayMinMs: [0, 300],
  slowTypingDelayMaxMs: [0, 400],
  punctuationPauseMs: [0, 1000],
  linePauseMs: [0, 2000],
  blankLinePauseMs: [0, 3000],
  blockEndPauseMs: [0, 3000],
  fileSwitchPauseMs: [0, 3000],
  thinkingPauseMs: [0, 3000],
  suggestionVisibleMs: [0, 3000]
};

export function resolvePacing(partial: Partial<PacingSettings>): PacingSettings {
  const result: PacingSettings = { ...DEFAULT_PACING };
  for (const [key, [low, high]] of Object.entries(PACING_BOUNDS) as [keyof typeof PACING_BOUNDS, [number, number]][]) {
    const value = Number(partial[key]);
    if (partial[key] !== undefined && Number.isFinite(value)) result[key] = Math.max(low, Math.min(high, value));
  }
  if (typeof partial.humanMode === 'boolean') result.humanMode = partial.humanMode;
  if (typeof partial.editorEffects === 'boolean') result.editorEffects = partial.editorEffects;
  return result;
}

const IMPORT_PATTERN = /^\s*(import\b|export\s+\{[^}]*\}\s+from\b|export\s+\*\s+from\b|(const|let|var)\s+[\w{}\s,]+=\s*require\s*\(|from\s+\S+\s+import\b|using\s+[\w.]+;|#include\b)/m;
const ENDPOINT_PATTERN =
  /(export\s+(const|async\s+function|function)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b|\b(app|router|server|api)\.(get|post|put|patch|delete|route)\s*\(|@(Get|Post|Put|Patch|Delete)Mapping\b|@app\.(get|post|put|patch|delete|route)\b)/;
const FUNCTION_PATTERN =
  /(\bfunction\b\s*\*?\s*[\w$]*\s*\(|=>\s*\{|^\s*(async\s+)?(?!if\b|for\b|while\b|switch\b|catch\b)[\w$]+\s*\([^)]*\)\s*(:\s*[^{]+)?\{|^\s*(async\s+)?def\s+\w+\s*\(|^\s*(public|private|protected|static|\s)+[\w<>[\]]+\s+\w+\s*\([^)]*\)\s*\{)/m;

/** Explains why a pace was chosen; exported for tests and the preview panel. */
export function classifyText(text: string): { pace: ResolvedPace; reason: 'import' | 'endpoint' | 'function' | 'markup-state-style' } {
  if (ENDPOINT_PATTERN.test(text)) return { pace: 'slow', reason: 'endpoint' };
  if (IMPORT_PATTERN.test(text)) return { pace: 'slow', reason: 'import' };
  if (FUNCTION_PATTERN.test(text)) return { pace: 'slow', reason: 'function' };
  return { pace: 'fast', reason: 'markup-state-style' };
}

export function resolvePace(operation: Operation, step?: Step): ResolvedPace {
  const explicit = operation.pace && operation.pace !== 'auto' ? operation.pace : step?.pace && step.pace !== 'auto' ? step.pace : undefined;
  if (explicit) return explicit;
  return classifyText(operationText(operation)).pace;
}

export interface CharacterContext {
  seed: string;
  stepId: string;
  operationIndex: number;
  index: number;
  character: string;
  previous?: string;
  next?: string;
  pace: ResolvedPace;
}

const PUNCTUATION = /[.,;:)}\]>]/;

export function characterDelay(settings: PacingSettings, context: CharacterContext): number {
  if (!settings.humanMode) return settings.fixedTypingDelayMs;
  const slow = context.pace === 'slow';
  const minimum = slow ? settings.slowTypingDelayMinMs : settings.fastTypingDelayMinMs;
  const maximum = slow ? settings.slowTypingDelayMaxMs : settings.fastTypingDelayMaxMs;
  let delay = deterministicRange(
    `${context.seed}|${context.stepId}|${context.operationIndex}|${context.index}|${context.character}`,
    minimum,
    maximum
  );
  const scale = slow ? 1 : 0.3;
  if (context.character === '\n') {
    const blank = context.previous === '\n' || context.previous === undefined;
    delay += Math.round((blank ? settings.blankLinePauseMs : settings.linePauseMs) * scale);
    if (/[}\]]/.test(context.previous ?? '') && context.next !== undefined) {
      delay += Math.round(settings.blockEndPauseMs * scale * 0.5);
    }
  } else if (PUNCTUATION.test(context.character)) {
    delay += Math.round(settings.punctuationPauseMs * (slow ? 1 : 0.25));
  }
  return delay;
}

export function thinkingPause(settings: PacingSettings, pace: ResolvedPace): number {
  if (!settings.humanMode) return Math.min(150, settings.thinkingPauseMs);
  return pace === 'slow' ? settings.thinkingPauseMs : Math.round(settings.thinkingPauseMs * 0.4);
}

export function fileSwitchPause(settings: PacingSettings): number {
  return settings.humanMode ? settings.fileSwitchPauseMs : Math.min(150, settings.fileSwitchPauseMs);
}

export function operationEndPause(settings: PacingSettings, pace: ResolvedPace): number {
  if (!settings.humanMode) return 120;
  return pace === 'slow' ? settings.blockEndPauseMs : Math.round(settings.blockEndPauseMs * 0.4);
}

/** Total deterministic typing time for a text (used by previews, replays and tests). */
export function estimateTypingMs(settings: PacingSettings, text: string, base: Omit<CharacterContext, 'index' | 'character' | 'previous' | 'next'>): number {
  const characters = [...text];
  let total = 0;
  characters.forEach((character, index) => {
    total += characterDelay(settings, { ...base, index, character, previous: characters[index - 1], next: characters[index + 1] });
  });
  return total;
}
