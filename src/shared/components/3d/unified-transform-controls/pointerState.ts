export const clearControlPointerState = (controls: any) => {
  if (!controls) return;

  if (!controls.dragging && controls.axis !== null) {
    controls.axis = null;
  }

  if (
    controls.userData &&
    Object.prototype.hasOwnProperty.call(controls.userData, 'urdfLastVisibleAxisHit')
  ) {
    delete controls.userData.urdfLastVisibleAxisHit;
  }
};
