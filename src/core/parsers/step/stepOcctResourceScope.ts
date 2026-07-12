/**
 * OCCT resource scope — deterministic cleanup of Emscripten wrappers.
 *
 * Tracks all OCCT objects created during a build phase and releases them
 * in reverse order (LIFO) via delete(). Ensures no wrapper leaks even
 * when exceptions occur.
 */

export interface DeletableOcct {
  delete?: () => void;
}

export class StepOcctResourceScope {
  private resources: DeletableOcct[] = [];

  /** Register an OCCT wrapper for deterministic cleanup. Returns it unchanged. */
  own<T extends DeletableOcct>(value: T): T {
    this.resources.push(value);
    return value;
  }

  /** Remove a wrapper from tracking (e.g., when ownership transfers to a compound). */
  release(value: DeletableOcct): void {
    const index = this.resources.lastIndexOf(value);
    if (index >= 0) this.resources.splice(index, 1);
  }

  /** Delete all tracked wrappers in reverse creation order. Idempotent. */
  dispose(): void {
    for (let i = this.resources.length - 1; i >= 0; i--) {
      this.resources[i].delete?.();
    }
    this.resources = [];
  }
}
