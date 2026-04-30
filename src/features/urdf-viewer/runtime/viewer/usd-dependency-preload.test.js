import test from "node:test";
import assert from "node:assert/strict";

import {
    getUsdConfigurationMirrorPaths,
    getUsdConfigurationMirrorPlan,
    getUsdDependencyExtension,
    getUsdDependencySuffixesForStage,
    inferDependencyStemForUsdPath,
} from "./usd-dependency-preload.js";

test("getUsdDependencyExtension preserves ascii USD layers", () => {
    assert.equal(
        getUsdDependencyExtension("/unitree_model/go2_description/urdf/go2_description.usda"),
        ".usda",
    );
    assert.equal(
        getUsdDependencyExtension("/unitree_model/Go2/usd/go2.usd"),
        ".usd",
    );
});

test("inferDependencyStemForUsdPath trims configuration suffixes for Isaac sidecars", () => {
    assert.equal(
        inferDependencyStemForUsdPath(
            "/unitree_model/go2_description/urdf/configuration/go2_description_physics.usda",
            "go2_description_physics.usda",
        ),
        "go2_description",
    );
});

test("inferDependencyStemForUsdPath applies Unitree root filename aliases", () => {
    assert.equal(
        inferDependencyStemForUsdPath("/unitree_model/Go2/usd/go2.usd", "go2.usd"),
        "go2_description",
    );
    assert.equal(
        inferDependencyStemForUsdPath("/unitree_model/B2W/usd/b2w.usd", "b2w.usd"),
        "b2w_description",
    );
});

test("getUsdConfigurationMirrorPlan still seeds shared configuration aliases when only local files are preloaded", () => {
    const paths = getUsdConfigurationMirrorPaths(
        "/unitree_model/go2_description/urdf/go2_description.usda",
        "go2_description_physics.usda",
    );
    assert.deepEqual(paths, {
        localConfigurationPath: "/unitree_model/go2_description/urdf/configuration/go2_description_physics.usda",
        sharedConfigurationPath: "/configuration/go2_description_physics.usda",
    });

    const plan = getUsdConfigurationMirrorPlan(
        "/unitree_model/go2_description/urdf/go2_description.usda",
        "go2_description_physics.usda",
        {
            hasLocalVirtualFile: true,
            hasSharedVirtualFile: false,
        },
    );

    assert.equal(plan.shouldWriteLocalAlias, false);
    assert.equal(plan.shouldWriteSharedAlias, true);
});

test("getUsdConfigurationMirrorPlan backfills local aliases from shared placeholders", () => {
    const plan = getUsdConfigurationMirrorPlan(
        "/unitree_model/go2_description/urdf/go2_description.usda",
        "go2_description_sensor.usda",
        {
            hasLocalVirtualFile: false,
            hasSharedVirtualFile: true,
        },
    );

    assert.equal(plan.shouldWriteLocalAlias, true);
    assert.equal(plan.shouldWriteSharedAlias, false);
});

test("getUsdDependencySuffixesForStage includes robot sidecars for description roots while preserving USDA extension decisions elsewhere", () => {
    assert.deepEqual(
        getUsdDependencySuffixesForStage(
            "/unitree_model/go2_description/urdf/go2_description.usda",
            "go2_description",
            { includeSensorDependency: false },
        ),
        ["base", "physics", "robot"],
    );
    assert.deepEqual(
        getUsdDependencySuffixesForStage(
            "/unitree_model/go2_description/urdf/go2_description.usda",
            "go2_description",
            { includeSensorDependency: true },
        ),
        ["base", "physics", "robot", "sensor"],
    );
});
