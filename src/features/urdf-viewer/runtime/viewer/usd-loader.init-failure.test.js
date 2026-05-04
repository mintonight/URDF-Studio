import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const loaderPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "./usd-loader.js",
);

test("usd-loader returns an explicit non-ready failure state when the root path is unavailable", async () => {
    const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, "window");
    const previousWindow = globalThis.window;
    const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

    try {
        globalThis.window = {
            usdRoot: {},
            USD: {},
        };
        Object.defineProperty(globalThis, "navigator", {
            configurable: true,
            value: {
                hardwareConcurrency: 4,
            },
        });

        const { loadUsdStage } = await import("./usd-loader.js");
        const progressMessages = [];
        const state = await loadUsdStage({
            USD: {},
            usdFsHelper: {
                hasVirtualFilePath: () => false,
            },
            messageLog: null,
            progressBar: null,
            progressLabel: null,
            showLoadUi: false,
            readStageMetadata: null,
            loadCollisionPrims: false,
            loadVisualPrims: true,
            loadPassLabel: "test",
            params: new URLSearchParams(),
            displayName: "missing-root.usda",
            pathToLoad: "/missing-root.usda",
            isLoadActive: () => true,
            onResolvedFilename: () => {},
            applyMeshFilters: () => {},
            rebuildLinkAxes: () => {},
            renderFrame: () => {},
            onProgress: (progress) => {
                progressMessages.push(progress);
            },
        });

        assert.equal(state.ready, false);
        assert.equal(state.drawFailed, true);
        assert.equal(state.drawFailureReason, "root-path-unavailable");
        assert.equal(state.normalizedPath, "/missing-root.usda");
        assert.equal(progressMessages.at(-1)?.phase, "checking-path");
    }
    finally {
        if (hadWindow) {
            globalThis.window = previousWindow;
        }
        else {
            delete globalThis.window;
        }
        if (previousNavigator) {
            Object.defineProperty(globalThis, "navigator", previousNavigator);
        }
        else {
            delete globalThis.navigator;
        }
    }
});

test("usd-loader keeps init-failure branches non-ready and captures explicit failure reason", async () => {
    const source = await readFile(loaderPath, "utf8");

    const initFailurePatterns = [
        /catch\s*\(\s*error\s*\)\s*\{[\s\S]*?Failed to create USD driver[\s\S]*?state\.ready\s*=\s*false;[\s\S]*?state\.drawFailed\s*=\s*true;[\s\S]*?state\.drawFailureReason\s*=\s*"driver-init-failed";/m,
        /if\s*\(\s*!driver\s*\)\s*\{[\s\S]*?Failed to initialize USD renderer for this file\.[\s\S]*?state\.ready\s*=\s*false;[\s\S]*?state\.drawFailed\s*=\s*true;[\s\S]*?state\.drawFailureReason\s*=\s*"driver-init-missing";/m,
    ];

    for (const pattern of initFailurePatterns) {
        assert.match(source, pattern);
    }
});

test("usd-loader blocks ready state when robot metadata warmup fails or resolves stale snapshots", async () => {
    const source = await readFile(loaderPath, "utf8");

    assert.match(
        source,
        /if \(stats\.stale === true \|\| stats\.errorFlags\.length > 0 \|\| !!stats\.truthLoadError\) \{\s*return false;\s*\}/m,
    );
    assert.match(
        source,
        /state\.drawFailureReason = "robot-metadata-failed";/m,
    );
    assert.doesNotMatch(
        source,
        /maybePromise\.catch\(\(\) => null\)/m,
    );
});

test("usd-loader logs runtime bridge warmup failures instead of silently discarding them", async () => {
    const source = await readFile(loaderPath, "utf8");

    assert.match(
        source,
        /console\.error\("\[usd-loader\] Failed to warm up runtime bridge during " \+ phaseLabel \+ "\.", error\);/m,
    );
    assert.match(
        source,
        /console\.error\(`\[usd-loader\] \$\{warmupPhaseLabel\} rejected for \$\{normalizedPath\}\.`, error\);/m,
    );
    assert.match(
        source,
        /console\.error\(`\[usd-loader\] Failed to start \$\{warmupPhaseLabel\} for \$\{normalizedPath\}\.`, caughtError\);/m,
    );
});

test("usd-loader does not swallow mesh hydration pass failures before reporting ready", async () => {
    const source = await readFile(loaderPath, "utf8");

    assert.match(source, /state\.drawFailureReason = reason;/m);
    assert.match(source, /markHydrationFailure\("proto-hydration-failed", error\)/m);
    assert.match(source, /markHydrationFailure\("resolved-prim-hydration-failed", error\)/m);
    assert.match(
        source,
        /const runProtoHydrationPass = \(\) => \{[\s\S]*?hydratePendingProtoMeshes[\s\S]*?catch \(error\) \{\s*return markHydrationFailure\("proto-hydration-failed", error\);/m,
    );
    assert.match(
        source,
        /const runResolvedPrimHydrationPass = \(options = \{\}\) => \{[\s\S]*?hydratePendingResolvedPrimMeshes[\s\S]*?catch \(error\) \{\s*return markHydrationFailure\("resolved-prim-hydration-failed", error\);/m,
    );
});

test("usd-loader blocks ready when final mesh hydration still has pending work", async () => {
    const source = await readFile(loaderPath, "utf8");

    assert.match(
        source,
        /const ensureNoPendingMeshHydrationBeforeReady = \(\) => \{[\s\S]*?mesh-hydration-pending-before-ready/m,
    );
    assert.match(
        source,
        /if \(!ensureNoPendingMeshHydrationBeforeReady\(\)\) \{\s*return state;\s*\}[\s\S]*state\.ready = true;/m,
    );
});
