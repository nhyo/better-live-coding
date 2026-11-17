import * as vscode from 'vscode';
import { Controller } from './controller';
import { PreviewViewProvider } from './previewView';

export function activate(context: vscode.ExtensionContext): { controller: Controller } {
  const preview = new PreviewViewProvider();
  const controller = new Controller(context, preview);
  context.subscriptions.push(controller, vscode.window.registerWebviewViewProvider(PreviewViewProvider.viewId, preview));

  const commands: Record<string, () => Promise<unknown>> = {
    'betterLiveCoding.initialize': () => controller.initialize(),
    'betterLiveCoding.start': () => controller.start(),
    'betterLiveCoding.nextStep': () => controller.nextStep(),
    'betterLiveCoding.pauseResume': () => controller.pauseResume(),
    'betterLiveCoding.skip': () => controller.skip(),
    'betterLiveCoding.restartStep': () => controller.restartStep(),
    'betterLiveCoding.restartAll': () => controller.restartAll(),
    'betterLiveCoding.restoreCheckpoint': () => controller.restoreCheckpoint(),
    'betterLiveCoding.validate': () => controller.validate(),
    'betterLiveCoding.previewSteps': () => controller.previewSteps(),
    'betterLiveCoding.generateCheckpoints': () => controller.generateCheckpoints(),
    'betterLiveCoding.generateCandidates': () => controller.generateCandidates(),
    'betterLiveCoding.exit': () => controller.exit()
  };
  for (const [name, handler] of Object.entries(commands)) {
    context.subscriptions.push(
      vscode.commands.registerCommand(name, async () => {
        try {
          await handler();
        } catch (error) {
          vscode.window.showErrorMessage(`Better Live Coding: ${(error as Error).message}`);
        }
      })
    );
  }
  return { controller };
}

export function deactivate(): void {
  // Nothing to clean up: context keys reset with the window and no background work survives.
}
