/**
 * Files written by "Better Live Coding: Initialize Presentation".
 * The starter presentation is runnable in any workspace: it creates its own
 * starter file, so it never touches existing code until the user edits it.
 */

export const STARTER_PRESENTATION = {
  $schema: './presentation.schema.json',
  version: 1,
  title: 'My Live Coding Demo',
  description: 'Starter presentation. Replace the chapters with your own semantic steps.',
  workspace: {
    workingDirectory: '.',
    newFileEol: 'lf'
  },
  humanMode: {
    enabled: true,
    seed: 'my-demo'
  },
  chapters: [
    {
      id: 'greeting',
      title: 'Build a greeting module',
      objective: 'Show the basic Better Live Coding workflow',
      steps: [
        {
          id: 'create-module',
          title: 'Create the module with its state',
          objective: 'Start a new file with the data the feature needs',
          operations: [
            {
              type: 'createFile',
              file: 'live-coding-starter/greeting.ts',
              text: ["const names: string[] = ['Ada', 'Grace'];", "let greetingCount = 0;", '']
            }
          ]
        },
        {
          id: 'greet-function',
          title: 'Implement greet()',
          objective: 'Write one complete function',
          thinking: 'Implement greet()',
          operations: [
            {
              type: 'insertAfter',
              file: 'live-coding-starter/greeting.ts',
              anchor: { text: 'let greetingCount = 0;\n' },
              pace: 'slow',
              text: [
                '',
                'export function greet(name: string): string {',
                '  greetingCount += 1;',
                '  return `Hello, ${name.trim()}! (#${greetingCount})`;',
                '}',
                ''
              ]
            }
          ]
        },
        {
          id: 'use-function',
          title: 'Use greet() for every name',
          objective: 'Call the function from the module',
          operations: [
            {
              type: 'insertAfter',
              file: 'live-coding-starter/greeting.ts',
              anchor: { regex: '^\\}\\n', flags: 'm' },
              text: ['', 'names.forEach((name) => console.log(greet(name)));', '']
            }
          ]
        }
      ]
    }
  ]
} as const;

export const CONFIG_README = `# .better-live-coding

This folder configures **Better Live Coding** for this workspace.

| Path | Purpose |
| --- | --- |
| \`presentation.json\` | Chapters, semantic steps and edit operations. Validated by \`presentation.schema.json\`. |
| \`presentation.schema.json\` | JSON Schema; gives completion, hover docs and type checks in VS Code. |
| \`checkpoints/initial.json\` | Starting content of every declared file (written by *Generate Checkpoints*). |
| \`checkpoints/manifest.json\` | SHA-256 hashes of every step checkpoint, used to recognise the current state. |

Next steps:

1. Set \`workspace.workingDirectory\` to the folder you present from (for example \`my-app\`).
2. Replace the starter chapter with your own steps. Every \`file\` is relative to the working directory.
3. Put the files into their starting state and run **Better Live Coding: Generate Checkpoints**
   (or set \`workspace.initialDirectory\` to a pristine copy).
4. Run **Better Live Coding: Validate Presentation**, then **Start Presentation Mode** and press Enter.

Better Live Coding never reads or writes \`.env*\` files, credentials, \`node_modules\` or files that the
presentation does not declare.
`;
