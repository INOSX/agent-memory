/**
 * npm postinstall for @inosx/agent-memory consumers:
 * 1) Copy Cursor rules → .cursor/rules/
 * 2) Merge VS Code/Cursor tasks → .vscode/tasks.json (watch + process on folder open)
 * 3) Set task.allowAutomaticTasks in .vscode/settings.json when unset
 *
 * Skip rules: AGENT_MEMORY_SKIP_CURSOR_RULE=1
 * Skip VS Code merge: AGENT_MEMORY_SKIP_VSCODE_AUTOMATION=1
 * Skip entire script: CI=true, global npm install, or developing this repo (not under node_modules).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");
const verbose = process.env.AGENT_MEMORY_VERBOSE === "1";

const skipCursorRules = process.env.AGENT_MEMORY_SKIP_CURSOR_RULE === "1";
const skipVscodeAutomation = process.env.AGENT_MEMORY_SKIP_VSCODE_AUTOMATION === "1";
if (process.env.CI === "true") process.exit(0);
if (process.env.npm_config_global === "true") process.exit(0);

const rulesDir = path.join(pkgRoot, "cursor-rules");
if (!fs.existsSync(rulesDir)) process.exit(0);

const ruleFiles = fs.readdirSync(rulesDir).filter((f) => f.endsWith(".mdc"));
if (ruleFiles.length === 0) process.exit(0);

/** True when this copy lives under node_modules (installed as a dependency). */
const installedAsDependency = pkgRoot.split(path.sep).includes("node_modules");
try {
  const selfPkg = path.join(pkgRoot, "package.json");
  if (fs.existsSync(selfPkg)) {
    const j = JSON.parse(fs.readFileSync(selfPkg, "utf8"));
    if (j.name === "@inosx/agent-memory" && !installedAsDependency) {
      process.exit(0);
    }
  }
} catch {
  /* ignore */
}

const initCwd = process.env.INIT_CWD ? path.resolve(process.env.INIT_CWD) : null;
if (initCwd && path.resolve(pkgRoot) === initCwd) {
  process.exit(0);
}

function findConsumerRoot(startFromDir) {
  let d = path.resolve(startFromDir);
  for (;;) {
    const pkgPath = path.join(d, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const raw = fs.readFileSync(pkgPath, "utf8");
        const j = JSON.parse(raw);
        if (j.name && j.name !== "@inosx/agent-memory") return d;
      } catch {
        /* ignore */
      }
    }
    const parent = path.dirname(d);
    if (parent === d) return null;
    d = parent;
  }
}

function isConsumerPackageRoot(dir) {
  const p = path.join(dir, "package.json");
  if (!fs.existsSync(p)) return false;
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return j.name && j.name !== "@inosx/agent-memory";
  } catch {
    return false;
  }
}

let targetRoot = null;
if (initCwd && isConsumerPackageRoot(initCwd)) targetRoot = initCwd;
if (!targetRoot) targetRoot = findConsumerRoot(path.dirname(pkgRoot));
if (!targetRoot) process.exit(0);

const destDir = path.join(targetRoot, ".cursor", "rules");

if (!skipCursorRules) {
  try {
    fs.mkdirSync(destDir, { recursive: true });

    let copied = 0;
    for (const file of ruleFiles) {
      const src = path.join(rulesDir, file);
      const dest = path.join(destDir, file);
      fs.copyFileSync(src, dest);
      copied++;
      if (verbose) console.log(`[@inosx/agent-memory] Cursor rule installed: ${dest}`);
    }

    if (verbose) console.log(`[@inosx/agent-memory] ${copied} cursor rule(s) synced.`);
  } catch (e) {
    if (verbose) {
      console.warn("[@inosx/agent-memory] postinstall cursor rules:", e);
    }
  }
}

/** Merge VS Code / Cursor tasks so memory services start on folder open. */
function installVscodeAutomation(projectRoot) {
  const vscodeDir = path.join(projectRoot, ".vscode");
  fs.mkdirSync(vscodeDir, { recursive: true });

  const watchTask = {
    label: "agent-memory: watch transcripts",
    type: "shell",
    command: "npx agent-memory watch --wait-for-transcripts",
    options: { cwd: "${workspaceFolder}" },
    runOptions: {
      runOn: "folderOpen",
      instanceLimit: 1,
    },
    presentation: {
      reveal: "silent",
      panel: "dedicated",
      showReuseMessage: false,
    },
  };

  const processTask = {
    label: "agent-memory: process transcript backlog",
    type: "shell",
    command: "npx agent-memory process",
    options: { cwd: "${workspaceFolder}" },
    runOptions: {
      runOn: "folderOpen",
      instanceLimit: 1,
    },
    presentation: {
      reveal: "silent",
      panel: "shared",
      showReuseMessage: false,
    },
  };

  const tasksPath = path.join(vscodeDir, "tasks.json");
  let tasksData = { version: "2.0.0", tasks: [] };
  if (fs.existsSync(tasksPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(tasksPath, "utf8"));
      if (parsed && typeof parsed === "object") {
        tasksData = { ...parsed };
        if (!Array.isArray(tasksData.tasks)) tasksData.tasks = [];
        if (!tasksData.version) tasksData.version = "2.0.0";
      }
    } catch {
      /* keep default */
    }
  }

  const labels = new Set(tasksData.tasks.map((t) => t && t.label).filter(Boolean));
  let added = 0;
  if (!labels.has(watchTask.label)) {
    tasksData.tasks.push(watchTask);
    labels.add(watchTask.label);
    added++;
  }
  if (!labels.has(processTask.label)) {
    tasksData.tasks.push(processTask);
    added++;
  }
  if (added > 0) {
    fs.writeFileSync(tasksPath, `${JSON.stringify(tasksData, null, 2)}\n`, "utf8");
    if (verbose) {
      console.log(`[@inosx/agent-memory] VS Code/Cursor tasks installed (${added} task(s)): ${tasksPath}`);
    }
  }

  const settingsPath = path.join(vscodeDir, "settings.json");
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      if (!settings || typeof settings !== "object" || Array.isArray(settings)) settings = {};
    } catch {
      settings = {};
    }
  }
  if (settings["task.allowAutomaticTasks"] === undefined) {
    settings["task.allowAutomaticTasks"] = "on";
    fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    if (verbose) {
      console.log(`[@inosx/agent-memory] Enabled task.allowAutomaticTasks in ${settingsPath}`);
    }
  }
}

if (!skipVscodeAutomation) {
  try {
    installVscodeAutomation(targetRoot);
  } catch (e) {
    if (verbose) {
      console.warn("[@inosx/agent-memory] postinstall VS Code automation:", e);
    }
  }
}
