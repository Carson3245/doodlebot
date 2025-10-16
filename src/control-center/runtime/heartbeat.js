let lastHeartbeat = 0;

export function refreshHeartbeat() {
  lastHeartbeat = Date.now();
}

export function getHeartbeatStatus() {
  if (!lastHeartbeat) {
    return { status: 'Offline', lastHeartbeat: null, ageSeconds: null };
  }
  const ageMs = Date.now() - lastHeartbeat;
  return {
    status: ageMs < 90_000 ? 'Online' : 'Offline',
    lastHeartbeat: new Date(lastHeartbeat).toISOString(),
    ageSeconds: Math.round(ageMs / 1000)
  };
}
