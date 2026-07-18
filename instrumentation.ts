export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { runWorkerLoop } = await import("@/worker");
  await import("@/worker/jobs");

  void runWorkerLoop();
}
