# CodeTogether

CodeTogether is a VS Code extension that helps developers understand
AI-generated code through comprehension questions and targeted feedback.

This project is a course research prototype and is currently in early development.

## Planned Features

- Review staged Git changes.
- Ask developers to explain important changes in their own words.
- Identify possible misunderstandings using an LLM.
- Provide targeted explanations and follow-up questions.
- Compare assessments using Git diffs alone versus additional repository context.

## Current Status

The starter extension is set up. The comprehension review and tutoring
features have not been implemented yet.

## Development Setup

### Requirements

- Visual Studio Code
- Node.js LTS and npm
- Git

### Run Locally

1. Clone this repository.
2. Open the folder containing `package.json` in VS Code.
3. Install dependencies:

   npm install

4. Press F5 to launch the Extension Development Host.
5. In the new window, open the Command Palette and run `Hello World`.

## Project Structure

- `src/extension.ts`: Extension entry point and command registration.
- `package.json`: Extension metadata, commands, and dependencies.
- `.vscode/`: Build and debugging configuration.
