#!/usr/bin/env node
// Architecture redline gate (zero-dependency). Enforces the documented dependency
// direction app -> features -> store -> shared -> core -> types and detects import
// cycles, by classifying each import specifier by layer. Reuses the @/* -> src/*
// alias from tsconfig.base.json. Product code only (test/spec/generated excluded).
//
// Run:  node scripts/tools/dependency_boundaries.mjs            (report)
//       node scripts/tools/dependency_boundaries.mjs --check    (exit 1 on any violation)
//       node scripts/tools/dependency_boundaries.mjs --json
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = 'src';
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const IGNORED_DIRS = new Set(['node_modules', 'runtime']); // urdf-viewer/runtime is vendored

// Documented existing exceptions (docs/architecture.md §3-4) — allowed, not violations.
// editor -> urdf-viewer is the documented facade relationship and is handled in
// checkBoundary; lib/RobotCanvas wrapping the viewer is the package's whole purpose.
const ALLOWLIST = [
  { importer: 'src/shared/hooks/useTheme.ts', target: 'store' },
  { importer: 'src/shared/components/Panel/JointControlItem.tsx', target: 'store' },
  { importer: 'src/features/ai-assistant/utils/pdfExport.ts', target: 'feature:file-io' },
  { importer: 'src/lib/components/RobotCanvas.tsx', target: 'feature:urdf-viewer' },
];

const BASELINE_PATH = 'scripts/tools/dependency_boundaries_baseline.json';

const options = parseArgs(process.argv.slice(2));
const knownCycles = await readKnownCycles();
const files = await collectSourceFiles(SRC);
const fileSet = new Set(files);

const boundaryViolations = [];
const graph = new Map(); // importerRel -> Set<targetRel>

for (const relPath of files) {
  const text = await readFile(path.join(ROOT, relPath), 'utf8');
  const importerLayer = classifyLayer(relPath);
  const edges = new Set();

  for (const spec of extractImportSpecifiers(text)) {
    const resolvedRel = resolveInternal(relPath, spec);
    const targetLayer = resolvedRel ? classifyLayer(resolvedRel) : classifyExternal(spec);
    if (!targetLayer) {
      continue;
    }
    const violation = checkBoundary(relPath, importerLayer, targetLayer, spec);
    if (violation) {
      boundaryViolations.push(violation);
    }
    if (resolvedRel && resolvedRel !== relPath) {
      edges.add(resolvedRel);
    }
  }
  graph.set(relPath, edges);
}

const allCycles = findCycles(graph).map((cycle) => ({ cycle, signature: cycleSignature(cycle) }));
const newCycles = allCycles.filter((entry) => !knownCycles.has(entry.signature));
const knownCycleCount = allCycles.length - newCycles.length;
const report = {
  boundaryViolations,
  newCycles: newCycles.map((entry) => entry.cycle),
  knownCycleCount,
  scannedFiles: files.length,
};

if (options.json) {
  console.log(JSON.stringify({ ...report, allCycleSignatures: allCycles.map((entry) => entry.signature) }, null, 2));
} else {
  printReport(report);
}

if (options.check && (boundaryViolations.length > 0 || newCycles.length > 0)) {
  process.exitCode = 1;
}

// ---------------------------------------------------------------- helpers

function parseArgs(args) {
  const parsed = { check: false, json: false };
  for (const arg of args) {
    if (arg === '--check') {
      parsed.check = true;
    } else if (arg === '--json') {
      parsed.json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

async function readKnownCycles() {
  try {
    const raw = await readFile(path.join(ROOT, BASELINE_PATH), 'utf8');
    const parsed = JSON.parse(raw);
    return new Set(parsed.knownCycles || []);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return new Set();
    }
    throw error;
  }
}

function cycleSignature(cycle) {
  return [...new Set(cycle)].sort().join('|');
}

async function collectSourceFiles(dir) {
  const out = [];
  await walk(dir, out);
  return out.sort();
}

async function walk(relDir, out) {
  const entries = await readdir(path.join(ROOT, relDir), { withFileTypes: true });
  for (const entry of entries) {
    const relPath = toPosix(path.join(relDir, entry.name));
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await walk(relPath, out);
      }
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(relPath))) {
      continue;
    }
    if (/\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(relPath)) {
      continue; // tests legitimately reach across layers
    }
    if (/\.generated\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(relPath)) {
      continue;
    }
    out.push(relPath);
  }
}

function extractImportSpecifiers(text) {
  const specs = [];
  // import ... from 'x'  |  export ... from 'x'
  for (const match of text.matchAll(/\b(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g)) {
    specs.push(match[1]);
  }
  // bare side-effect import 'x'
  for (const match of text.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) {
    specs.push(match[1]);
  }
  // dynamic import('x')
  for (const match of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    specs.push(match[1]);
  }
  return specs;
}

function resolveInternal(importerRel, spec) {
  let baseNoExt;
  if (spec.startsWith('@/')) {
    baseNoExt = toPosix(path.join(SRC, spec.slice(2)));
  } else if (spec.startsWith('.')) {
    baseNoExt = toPosix(path.join(path.dirname(importerRel), spec));
  } else {
    return null; // external package
  }
  if (!baseNoExt.startsWith(`${SRC}/`) && baseNoExt !== SRC) {
    return null;
  }
  const candidates = [
    baseNoExt,
    `${baseNoExt}.ts`,
    `${baseNoExt}.tsx`,
    `${baseNoExt}.js`,
    `${baseNoExt}.jsx`,
    `${baseNoExt}.mjs`,
    `${baseNoExt}/index.ts`,
    `${baseNoExt}/index.tsx`,
    `${baseNoExt}/index.js`,
  ];
  for (const candidate of candidates) {
    if (fileSet.has(candidate)) {
      return candidate;
    }
  }
  return null; // resolves to .css/.json/.worker asset or a test file we skipped
}

function classifyLayer(relPath) {
  if (!relPath.startsWith(`${SRC}/`)) {
    return null;
  }
  const rest = relPath.slice(SRC.length + 1);
  if (rest.startsWith('app/')) return 'app';
  if (rest.startsWith('store/')) return 'store';
  if (rest.startsWith('shared/')) return 'shared';
  if (rest.startsWith('core/')) return 'core';
  if (rest.startsWith('types/')) return 'types';
  if (rest.startsWith('lib/')) return 'lib';
  if (rest.startsWith('features/')) {
    const name = rest.split('/')[1];
    return `feature:${name}`;
  }
  return 'app'; // src/main.tsx and other top-level entry files behave as app shell
}

function classifyExternal(spec) {
  if (/^react(-dom)?($|\/)/.test(spec) || spec.startsWith('@react-three/')) {
    return 'react-ui';
  }
  return 'external';
}

function checkBoundary(importerRel, importerLayer, targetLayer, spec) {
  if (!importerLayer || targetLayer === 'external' || targetLayer === 'types') {
    return null;
  }
  if (isAllowlisted(importerRel, targetLayer)) {
    return null;
  }

  const importerFeature = importerLayer.startsWith('feature:') ? importerLayer.slice(8) : null;
  const targetFeature = targetLayer.startsWith('feature:') ? targetLayer.slice(8) : null;
  let reason = null;

  if (importerLayer === 'core') {
    if (targetLayer === 'react-ui') {
      reason = 'core must stay pure: no React / @react-three';
    } else if (['app', 'store', 'shared', 'lib'].includes(targetLayer) || targetFeature) {
      reason = `core must not import ${targetLayer} (core sits below shared/store/features)`;
    }
  } else if (importerFeature) {
    if (targetLayer === 'app') {
      reason = 'feature must not import app (app orchestrates features, not the reverse)';
    } else if (
      targetFeature &&
      targetFeature !== importerFeature &&
      targetFeature !== 'editor' &&
      !(importerFeature === 'editor' && targetFeature === 'urdf-viewer')
    ) {
      reason = `cross-feature import: features talk via store, not feature:${targetFeature}`;
    }
  } else if (importerLayer === 'shared') {
    if (targetLayer === 'app' || targetLayer === 'store' || targetFeature) {
      reason = `shared must not import ${targetLayer}`;
    }
  } else if (importerLayer === 'store') {
    if (targetLayer === 'app' || targetFeature) {
      reason = `store must not import ${targetLayer}`;
    }
  } else if (importerLayer === 'lib') {
    if (targetLayer === 'app' || targetLayer === 'store' || targetFeature) {
      reason = `lib must not import ${targetLayer}`;
    }
  }

  if (!reason) {
    return null;
  }
  return { importer: importerRel, importerLayer, target: spec, targetLayer, reason };
}

function isAllowlisted(importerRel, targetLayer) {
  return ALLOWLIST.some((entry) => importerRel === entry.importer && targetLayer === entry.target);
}

function findCycles(adjacency) {
  const state = new Map(); // 0=unvisited,1=on-stack,2=done
  const stack = [];
  const found = [];
  const seenSignatures = new Set();

  const dfs = (node) => {
    state.set(node, 1);
    stack.push(node);
    for (const next of adjacency.get(node) || []) {
      if (!adjacency.has(next)) {
        continue;
      }
      const status = state.get(next) || 0;
      if (status === 0) {
        dfs(next);
      } else if (status === 1) {
        const idx = stack.indexOf(next);
        if (idx !== -1) {
          const cycle = stack.slice(idx).concat(next);
          const signature = [...cycle].sort().join('|');
          if (!seenSignatures.has(signature)) {
            seenSignatures.add(signature);
            found.push(cycle);
          }
        }
      }
    }
    stack.pop();
    state.set(node, 2);
  };

  for (const node of adjacency.keys()) {
    if ((state.get(node) || 0) === 0) {
      dfs(node);
    }
  }
  return found;
}

function printReport(report) {
  console.log('Dependency boundaries');
  console.log(`Scanned files: ${report.scannedFiles}`);
  console.log('');

  console.log(`[${report.boundaryViolations.length === 0 ? 'OK' : 'FAIL'}] layer boundaries: ${report.boundaryViolations.length} violation(s)`);
  for (const v of report.boundaryViolations.slice(0, 30)) {
    console.log(`  ${v.importer} -> ${v.target}`);
    console.log(`    ${v.reason}`);
  }

  console.log(`[${report.newCycles.length === 0 ? 'OK' : 'FAIL'}] import cycles: ${report.newCycles.length} new, ${report.knownCycleCount} grandfathered`);
  for (const cycle of report.newCycles.slice(0, 15)) {
    console.log(`  ${cycle.join(' -> ')}`);
  }

  if (report.boundaryViolations.length > 0 || report.newCycles.length > 0) {
    console.log('');
    console.log('Architecture redline broken. See docs/architecture.md §1-3.');
  }
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}
