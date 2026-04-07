import type { RobotData, RobotState, UrdfLink, UrdfVisual } from '@/types';

type RobotSnapshot = RobotData | RobotState;

function hideVisual(visual: UrdfVisual): UrdfVisual {
  return visual.visible === false ? visual : { ...visual, visible: false };
}

function hideVisualBodies(visualBodies: UrdfVisual[] | undefined): UrdfVisual[] | undefined {
  if (!visualBodies || visualBodies.length === 0) {
    return visualBodies;
  }

  let changed = false;
  const nextBodies = visualBodies.map((body) => {
    if (body.visible === false) {
      return body;
    }

    changed = true;
    return hideVisual(body);
  });

  return changed ? nextBodies : visualBodies;
}

function hideMjcfWorldLink(link: UrdfLink): UrdfLink {
  const nextVisual = hideVisual(link.visual);
  const nextCollision = hideVisual(link.collision);
  const nextVisualBodies = hideVisualBodies(link.visualBodies);
  const nextCollisionBodies = hideVisualBodies(link.collisionBodies);

  if (
    link.visible === false &&
    nextVisual === link.visual &&
    nextCollision === link.collision &&
    nextVisualBodies === link.visualBodies &&
    nextCollisionBodies === link.collisionBodies
  ) {
    return link;
  }

  return {
    ...link,
    visible: false,
    visual: nextVisual,
    collision: nextCollision,
    visualBodies: nextVisualBodies,
    collisionBodies: nextCollisionBodies,
  };
}

export function applyMjcfWorldVisibility<T extends RobotSnapshot>(
  robot: T,
  showMjcfWorldLink: boolean,
): T {
  if (showMjcfWorldLink || robot.inspectionContext?.sourceFormat !== 'mjcf') {
    return robot;
  }

  const worldLink = robot.links.world;
  if (!worldLink) {
    return robot;
  }

  const nextWorldLink = hideMjcfWorldLink(worldLink);
  if (nextWorldLink === worldLink) {
    return robot;
  }

  return {
    ...robot,
    links: {
      ...robot.links,
      world: nextWorldLink,
    },
  };
}
