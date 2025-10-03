import { spawn } from 'node:child_process';
import open from 'open';

const dashboardReadyPattern = /Dashboard available at (http:\/\/[^\s]+)/i;
const fallbackDashboardUrl = process.env.DASHBOARD_URL ?? `http://localhost:${process.env.DASHBOARD_PORT ?? 3000}`;
let browserOpened = false;
let detectionBuffer = '';

const services = spawn('node', ['src/index.js'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  env: process.env,
  shell: false
});

const forwardOutput = (chunk, writer, trackDashboard) => {
  writer.write(chunk);
  if (!browserOpened) {
    const text = chunk.toString();
    if (trackDashboard) {
      detectionBuffer = `${detectionBuffer}${text}`.slice(-200);
    }

    if (detectionBuffer.includes('Dashboard available at') || text.includes('Dashboard available at')) {
      const match = (trackDashboard ? detectionBuffer : text).match(dashboardReadyPattern);
      const dashboardUrl = match?.[1] ?? fallbackDashboardUrl;
      open(dashboardUrl)
        .then(() => {
          browserOpened = true;
        })
        .catch((error) => {
          browserOpened = true;
          console.error('Unable to open the dashboard automatically:', error.message);
        });
    }
  }
};

services.stdout.on('data', (chunk) => forwardOutput(chunk, process.stdout, true));
services.stderr.on('data', (chunk) => forwardOutput(chunk, process.stderr, false));

services.on('exit', (code, signal) => {
  if (signal) {
    process.exit(0);
    return;
  }

  process.exit(code ?? 0);
});

const forwardSignal = (signal) => {
  if (!services.killed) {
    services.kill(signal);
  }
};

process.on('SIGINT', () => forwardSignal('SIGINT'));
process.on('SIGTERM', () => forwardSignal('SIGTERM'));
