function defaultNow() {
    return ((typeof performance !== "undefined" && typeof performance.now === "function")
        ? performance.now()
        : Date.now());
}
export function getTextureLoadProgress(renderInterface) {
    const snapshot = renderInterface?.registry?.getTextureLoadSnapshot?.();
    if (!snapshot || typeof snapshot !== "object") {
        return null;
    }
    const started = Number.isFinite(snapshot.started) ? Math.max(0, Math.floor(snapshot.started)) : 0;
    const completed = Number.isFinite(snapshot.completed) ? Math.max(0, Math.floor(snapshot.completed)) : 0;
    const failed = Number.isFinite(snapshot.failed) ? Math.max(0, Math.floor(snapshot.failed)) : 0;
    const localPending = Number.isFinite(snapshot.pending) ? Math.max(0, Math.floor(snapshot.pending)) : 0;
    const managerPending = Number.isFinite(snapshot?.manager?.pending)
        ? Math.max(0, Math.floor(snapshot.manager.pending))
        : 0;
    const pending = Math.max(localPending, managerPending);
    const settled = Math.max(0, completed + failed);
    const total = Math.max(started, settled + pending);
    if (total <= 0 && pending <= 0 && settled <= 0) {
        return null;
    }
    return {
        started,
        completed,
        failed,
        pending,
        settled: Math.min(settled, Math.max(total, settled)),
        total: Math.max(total, settled),
    };
}
export async function waitForTextureLoadReady({ getTextureProgress, isLoadStillActive, emitProgress, setMessage, setProgress, yieldForNextCheck, now = defaultNow, timeoutMs = 8000, quietPollsRequired = 2, }) {
    const startedAtMs = now();
    let quietPolls = 0;
    let lastProgress = null;
    for (;;) {
        if (typeof isLoadStillActive === "function" && !isLoadStillActive()) {
            return {
                status: "aborted",
                progress: lastProgress,
            };
        }
        const textureProgress = typeof getTextureProgress === "function"
            ? getTextureProgress()
            : null;
        lastProgress = textureProgress;
        if (!textureProgress) {
            quietPolls += 1;
            if (quietPolls >= quietPollsRequired) {
                return {
                    status: "settled",
                    progress: null,
                };
            }
            await yieldForNextCheck?.(0);
            continue;
        }
        const completedCount = Math.min(textureProgress.total, textureProgress.settled);
        const progressRatio = textureProgress.total > 0
            ? completedCount / textureProgress.total
            : 1;
        emitProgress?.({
            phase: "finalizing-scene",
            progressMode: "count",
            loadedCount: completedCount,
            totalCount: textureProgress.total,
        });
        setMessage?.(`Loading scene textures... ${completedCount}/${textureProgress.total}`);
        setProgress?.(96 + (progressRatio * 3));
        if (textureProgress.pending <= 0) {
            quietPolls += 1;
            if (quietPolls >= quietPollsRequired) {
                return {
                    status: "settled",
                    progress: textureProgress,
                };
            }
        }
        else {
            quietPolls = 0;
        }
        const elapsedMs = now() - startedAtMs;
        if (timeoutMs > 0 && elapsedMs >= timeoutMs) {
            return {
                status: "timeout",
                progress: textureProgress,
            };
        }
        await yieldForNextCheck?.(textureProgress.pending > 0 ? 48 : 0);
    }
}
