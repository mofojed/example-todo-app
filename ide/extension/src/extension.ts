import * as vscode from "vscode";
import { Bundler } from "./bundler";
import { ChangesController } from "./changes";
import { SCHEME, WorkspaceFileSystem } from "./fileSystem";
import { OverlayStore } from "./overlayStore";
import { PreviewController } from "./preview";
import { registerSearchProviders } from "./search";

/** The file opened the first time the workspace is loaded. */
const INITIAL_FILE = "src/index.tsx";
const INITIALIZED_KEY = "todoIde.initialized";
const REBUILD_DELAY_MS = 100;

export function activate(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.find((f) => f.uri.scheme === SCHEME);
  const root = folder?.uri ?? vscode.Uri.from({ scheme: SCHEME, authority: "exercise", path: "/example-todo-app" });
  const asset = (path: string) => vscode.Uri.joinPath(context.extensionUri, path).toString(true);

  const fs = new WorkspaceFileSystem(root, new OverlayStore(), asset("workspace.json"));
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(SCHEME, fs, { isCaseSensitive: true }),
    ...registerSearchProviders(fs, SCHEME),
  );

  context.subscriptions.push(new ChangesController(fs));

  const bundler = new Bundler(fs, asset("dist/esbuild.wasm"));
  const preview = new PreviewController(fs, bundler);
  context.subscriptions.push(preview, { dispose: () => void bundler.dispose() });

  // Rebuild whenever a file is saved, created, renamed or deleted
  let timer: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    fs.onDidChangeFile(() => {
      clearTimeout(timer);
      timer = setTimeout(() => preview.isOpen && void preview.rebuild(), REBUILD_DELAY_MS);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("todoIde.showPreview", () => preview.show()),
    vscode.commands.registerCommand("todoIde.reloadPreview", () =>
      preview.isOpen ? preview.rebuild() : preview.show(),
    ),
    vscode.commands.registerCommand("todoIde.showConsole", () => preview.showConsole()),
    vscode.commands.registerCommand("todoIde.hideConsole", () =>
      vscode.commands.executeCommand("workbench.action.closePanel"),
    ),
    vscode.commands.registerCommand("todoIde.resetExercise", async () => {
      const choice = await vscode.window.showWarningMessage(
        "Reset the exercise?",
        { modal: true, detail: "All changes to the code will be discarded. This cannot be undone." },
        "Reset",
      );
      if (choice !== "Reset") return;
      // Revert unsaved editors so VS Code doesn't restore them after reloading
      for (const document of vscode.workspace.textDocuments.filter((d) => d.isDirty)) {
        await vscode.window.showTextDocument(document);
        await vscode.commands.executeCommand("workbench.action.files.revert");
      }
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.reset();
      await context.workspaceState.update(INITIALIZED_KEY, undefined);
      await vscode.commands.executeCommand("workbench.action.reloadWindow");
    }),
  );

  void (async () => {
    try {
      await fs.ready;
    } catch (e) {
      void vscode.window.showErrorMessage(`Failed to load the exercise: ${e instanceof Error ? e.message : e}`);
      return;
    }
    if (!context.workspaceState.get(INITIALIZED_KEY)) {
      await context.workspaceState.update(INITIALIZED_KEY, true);
      await vscode.window.showTextDocument(fs.toUri(INITIAL_FILE), {
        viewColumn: vscode.ViewColumn.One,
        preview: false,
      });
    }
    await preview.show();
  })();
}

export function deactivate(): void {}
