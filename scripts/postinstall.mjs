/**
 * npm postinstall for @inosx/agent-memory consumers:
 * 1) Copy Cursor rules → .cursor/rules/
 * 2) Merge VS Code/Cursor tasks → .vscode/tasks.json (watch on folder open; removes legacy process-on-open task)
 * 3) Set task.allowAutomaticTasks in .vscode/settings.json when unset
 * 4) Seed .memory/_project.md from package.json + filesystem signals (non-destructive: only when absent)
 *
 * Skip rules: AGENT_MEMORY_SKIP_CURSOR_RULE=1
 * Skip VS Code merge: AGENT_MEMORY_SKIP_VSCODE_AUTOMATION=1
 * Skip project seed: AGENT_MEMORY_SKIP_PROJECT_SEED=1
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
const skipProjectSeed = process.env.AGENT_MEMORY_SKIP_PROJECT_SEED === "1";
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

  // Use node + path under node_modules (not npx): parallel folder-open tasks race on the same npx cache → EEXIST symlink errors.
  const watchTask = {
    label: "agent-memory: watch transcripts",
    type: "shell",
    command: "node node_modules/@inosx/agent-memory/dist/cli.js watch --wait-for-transcripts",
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

  function upsertTask(task) {
    const i = tasksData.tasks.findIndex((t) => t && t.label === task.label);
    if (i >= 0) {
      const before = JSON.stringify(tasksData.tasks[i]);
      tasksData.tasks[i] = task;
      return before !== JSON.stringify(task);
    }
    tasksData.tasks.push(task);
    return true;
  }

  const legacyProcessLabel = "agent-memory: process transcript backlog";
  const beforeFilterLen = tasksData.tasks.length;
  tasksData.tasks = tasksData.tasks.filter((t) => t && t.label !== legacyProcessLabel);
  const removedLegacy = tasksData.tasks.length !== beforeFilterLen;

  const changed = removedLegacy || upsertTask(watchTask);
  if (changed) {
    fs.writeFileSync(tasksPath, `${JSON.stringify(tasksData, null, 2)}\n`, "utf8");
    if (verbose) {
      console.log(`[@inosx/agent-memory] VS Code/Cursor tasks updated: ${tasksPath}`);
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

/**
 * Seed `.memory/_project.md` from package.json + filesystem signals if absent.
 * Non-destructive: skips entirely when the file already exists.
 */
function seedProjectFile(projectRoot) {
  const memoryDir = path.join(projectRoot, ".memory");
  const projectFile = path.join(memoryDir, "_project.md");

  if (fs.existsSync(projectFile)) return;

  const pkgPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(pkgPath)) return;

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch {
    return;
  }

  const name = pkg.name || path.basename(projectRoot);
  const description = pkg.description || "";

  // Detect language / framework signals
  const signals = [];
  const has = (f) => fs.existsSync(path.join(projectRoot, f));

  if (has("tsconfig.json") || has("tsconfig.base.json")) signals.push("TypeScript");
  else signals.push("JavaScript");

  if (has("pyproject.toml") || has("setup.py") || has("requirements.txt")) signals.push("Python");
  if (has("Cargo.toml")) signals.push("Rust");
  if (has("go.mod")) signals.push("Go");

  // Node runtime version
  const nodeVersion = pkg.engines?.node || "";
  if (nodeVersion) signals.push(`Node ${nodeVersion}`);

  // Key dependencies (top 8 from deps + devDeps, skip types/trivial)
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const skipPrefixes = ["@types/", "typescript", "prettier", "eslint"];
  const keyDeps = Object.keys(allDeps || {})
    .filter((d) => !skipPrefixes.some((p) => d.startsWith(p)))
    .slice(0, 8);

  // Test framework detection
  const testFrameworks = [];
  if (allDeps.vitest) testFrameworks.push("vitest");
  else if (allDeps.jest) testFrameworks.push("jest");
  else if (allDeps.mocha) testFrameworks.push("mocha");
  if (has(".github/workflows")) testFrameworks.push("GitHub Actions");

  // Build the seed content
  const lines = [`# ${name}`];
  if (description) lines.push("", description);

  lines.push("", "## Stack");
  if (signals.length) lines.push(`- **Runtime/Language:** ${signals.join(", ")}`);
  if (keyDeps.length) lines.push(`- **Key dependencies:** ${keyDeps.join(", ")}`);
  if (testFrameworks.length) lines.push(`- **Testing:** ${testFrameworks.join(", ")}`);

  lines.push(
    "",
    "## Conventions",
    "<!-- TODO: Add coding conventions, file structure patterns, naming rules -->",
    "",
    "## Goals",
    "<!-- TODO: Add current project goals and priorities -->",
    "",
  );

  fs.mkdirSync(memoryDir, { recursive: true });
  fs.writeFileSync(projectFile, lines.join("\n"), "utf8");

  if (verbose) {
    console.log(`[@inosx/agent-memory] Seeded _project.md at ${projectFile}`);
  }
}

if (!skipProjectSeed) {
  try {
    seedProjectFile(targetRoot);
  } catch (e) {
    if (verbose) {
      console.warn("[@inosx/agent-memory] postinstall project seed:", e);
    }
  }
}
