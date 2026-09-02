// Some restricted build environments do not expose libuv RSS information.
// Keep Next.js' optional memory telemetry from aborting an otherwise valid build.
try {
  process.memoryUsage();
} catch {
  const fallback = () => ({
    rss: 0,
    heapTotal: 0,
    heapUsed: 0,
    external: 0,
    arrayBuffers: 0,
  });
  fallback.rss = () => 0;
  process.memoryUsage = fallback;
}
