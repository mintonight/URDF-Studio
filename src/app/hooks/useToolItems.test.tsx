import test from 'node:test';
import assert from 'node:assert/strict';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { translations } from '@/shared/i18n';
import { isIkDragToolEnabled } from '@/shared/utils/ikDragFeatureGate';
import { useToolItems } from './useToolItems.tsx';

function renderHook(overrides?: { openIkTool?: () => void }) {
  let hookValue: ReturnType<typeof useToolItems> | null = null;

  function Probe() {
    hookValue = useToolItems({
      t: translations.en,
      openAIInspection: () => {},
      openAIConversation: () => {},
      openIkTool: overrides?.openIkTool ?? (() => {}),
      openCollisionOptimizer: () => {},
    });
    return null;
  }

  renderToStaticMarkup(<Probe />);
  assert.ok(hookValue, 'hook should render');
  return hookValue;
}

test('useToolItems hides the unfinished IK drag tool entry', () => {
  let openedIkTool = false;
  const { items, openTool } = renderHook({
    openIkTool: () => {
      openedIkTool = true;
    },
  });

  assert.equal(isIkDragToolEnabled(), false);
  assert.equal(
    items.some((item) => item.key === 'ik-tool'),
    false,
  );

  openTool('ik-tool');
  assert.equal(openedIkTool, false);
});
