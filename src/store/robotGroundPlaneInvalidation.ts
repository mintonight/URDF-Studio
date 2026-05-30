import { useRobotStore } from './robotStore';

export type GroundPlaneInvalidationListener = () => void;
export type GroundPlaneInvalidationSubscription = (
  listener: GroundPlaneInvalidationListener,
) => () => void;

export const subscribeRobotGroundPlaneInvalidation: GroundPlaneInvalidationSubscription = (
  listener,
) =>
  useRobotStore.subscribe((state, previousState) => {
    if (state.joints !== previousState.joints || state.links !== previousState.links) {
      listener();
    }
  });
