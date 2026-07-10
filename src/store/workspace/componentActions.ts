import type { AssemblyComponent } from '@/types';
import {
  buildDefaultAssemblyComponentPlacementTransform,
  normalizeComponentRobot,
} from '@/core/robot';

import {
  appendPendingAutoGroundComponentId,
  createUniqueComponentIdentity,
  removeComponentOrCreateDefault,
  removeInvalidBridges,
  removePendingAutoGroundComponentIds,
} from './helpers';
import type { WorkspaceRuntime } from './runtime';
import type {
  WorkspaceActions,
  WorkspaceStoreGet,
  WorkspaceStoreSet,
} from './types';

type ComponentActions = Pick<
  WorkspaceActions,
  | 'appendComponent'
  | 'insertComponent'
  | 'removeComponent'
  | 'renameComponent'
  | 'updateComponentSourceFile'
  | 'updateComponentTransform'
  | 'setComponentVisibility'
  | 'replaceComponentRobot'
  | 'replaceComponentRobotAtRevision'
>;

export function createComponentActions(
  set: WorkspaceStoreSet,
  get: WorkspaceStoreGet,
  runtime: WorkspaceRuntime,
): ComponentActions {
  return {
    appendComponent: (seed, options) => {
      if (!runtime.isOperationAllowed(options)) {
        throw new Error('Workspace is busy with an exclusive transaction.');
      }
      const workspace = get().workspace;
      const robot = normalizeComponentRobot(seed.robot);
      const identity = createUniqueComponentIdentity(
        workspace,
        seed.id,
        seed.name ?? robot.name,
      );
      const component: AssemblyComponent = {
        id: identity.id,
        name: identity.name,
        sourceFile: seed.sourceFile === undefined ? null : seed.sourceFile,
        robot,
        ...(seed.renderableBounds
          ? { renderableBounds: structuredClone(seed.renderableBounds) }
          : {}),
        transform: seed.transform
          ? structuredClone(seed.transform)
          : buildDefaultAssemblyComponentPlacementTransform({
              robot,
              renderableBounds: seed.renderableBounds ?? null,
              existingComponents: Object.values(workspace.components),
            }),
        visible: seed.visible === undefined ? true : seed.visible,
      };

      const inserted = runtime.applyMutation(
        'Append component',
        (draft) => {
          draft.components[component.id] = structuredClone(component);
        },
        options,
      );
      if (!inserted) {
        throw new Error(`Component "${component.id}" was not appended.`);
      }
      if (seed.queueAutoGround !== false) {
        set((state) => {
          appendPendingAutoGroundComponentId(
            state.pendingAutoGroundComponentIds,
            component.id,
          );
        });
      }
      return component;
    },

    insertComponent: (component, options) => {
      if (get().workspace.components[component.id]) {
        throw new Error(`Component "${component.id}" already exists.`);
      }
      const normalizedComponent = {
        ...structuredClone(component),
        robot: normalizeComponentRobot(component.robot),
      };
      const inserted = runtime.applyMutation(
        'Insert component',
        (draft) => {
          draft.components[component.id] = normalizedComponent;
        },
        options,
      );
      if (inserted && options?.queueAutoGround !== false) {
        set((state) => {
          appendPendingAutoGroundComponentId(
            state.pendingAutoGroundComponentIds,
            component.id,
          );
        });
      }
      return inserted;
    },

    removeComponent: (componentId, options) =>
      runtime.applyMutation(
        'Remove component',
        (draft) => removeComponentOrCreateDefault(draft, componentId),
        options,
      ),

    renameComponent: (componentId, name, options) =>
      runtime.applyMutation(
        'Rename component',
        (draft) => {
          const component = draft.components[componentId];
          if (component) {
            component.name = name;
          }
        },
        options,
      ),

    updateComponentSourceFile: (componentId, sourceFile, options) =>
      runtime.applyMutation(
        'Update component source',
        (draft) => {
          const component = draft.components[componentId];
          if (component) {
            component.sourceFile = sourceFile;
          }
        },
        options,
      ),

    updateComponentTransform: (componentId, transform, options) => {
      const changed = runtime.applyMutation(
        'Transform component',
        (draft) => {
          const component = draft.components[componentId];
          if (component) {
            component.transform = structuredClone(transform);
          }
        },
        options,
      );
      if (changed) {
        set((state) => {
          removePendingAutoGroundComponentIds(state.pendingAutoGroundComponentIds, [
            componentId,
          ]);
        });
      }
      return changed;
    },

    setComponentVisibility: (componentId, visible, options) =>
      runtime.applyMutation(
        'Set component visibility',
        (draft) => {
          const component = draft.components[componentId];
          if (component) {
            component.visible = visible;
          }
        },
        options,
      ),

    replaceComponentRobot: (componentId, robot, options) =>
      runtime.applyMutation(
        'Replace component robot',
        (draft) => {
          const component = draft.components[componentId];
          if (!component) {
            return;
          }
          component.robot = normalizeComponentRobot(robot);
          delete component.renderableBounds;
          removeInvalidBridges(draft);
        },
        options,
      ),

    replaceComponentRobotAtRevision: (componentId, expectedRevision, robot, options) => {
      if (get().revision !== expectedRevision || !get().workspace.components[componentId]) {
        return false;
      }
      return runtime.applyMutation(
        'Apply component source',
        (draft) => {
          const component = draft.components[componentId];
          if (!component) return;
          component.robot = normalizeComponentRobot(robot);
          delete component.renderableBounds;
          removeInvalidBridges(draft);
        },
        options,
      );
    },
  };
}
