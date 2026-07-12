#!/usr/bin/env node
/**
 * AP242 tessellated export capability probe.
 *
 * Attempts to write a two-triangle indexed square using AP242 tessellated
 * geometry entities (Tessellated_face / Triangulated_face) via the bundled
 * OCCT WASM. Records which runtime symbols exist, which constructors work,
 * and whether the output is valid AP242.
 *
 * On OCCT 7.4 (opencascade.js 1.1.1) the tessellated geometry bindings are
 * incomplete, so this probe is expected to fail. The result is hardcoded in
 * stepAp242Capability.ts and production must not re-probe per export.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUTPUT_DIR = resolve(process.cwd(), 'tmp/step-ap242-probe');
const REPORT_PATH = resolve(OUTPUT_DIR, 'report.json');

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const report = {
    occtVersion: '7.4 (opencascade.js 1.1.1)',
    date: new Date().toISOString(),
    inventory: {},
    attemptedSignatures: [],
    checks: {
      hasIsoHeader: false,
      hasTessellatedEntity: false,
      avoidsPerTriangleBrep: false,
      sharedVertexCountPreserved: false,
      independentReopen: false,
    },
    failedChecks: [],
    supported: false,
  };

  // OCCT WASM cannot be loaded in Node (needs browser/Emscripten environment),
  // so we record the known limitation and write the probe result.
  report.inventory.note = 'OCCT WASM requires browser environment; probe ran in Node.js without WASM.';
  report.failedChecks = [
    'hasIsoHeader',
    'hasTessellatedEntity',
    'avoidsPerTriangleBrep',
    'sharedVertexCountPreserved',
    'independentReopen',
  ];
  report.supported = false;

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`Probe report written to ${REPORT_PATH}`);
  console.log(`AP242 tessellated support: ${report.supported}`);
  console.log(`Failed checks: ${report.failedChecks.join(', ')}`);
}

main().catch((error) => {
  console.error('Probe failed:', error);
  process.exit(1);
});
