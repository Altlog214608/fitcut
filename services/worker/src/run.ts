/** ffmpeg·ffprobe 실행 (I/O). 시간 제한을 넘기면 멈추고, 오류 출력의 끝부분만 남긴다. */
import { spawn } from 'node:child_process';

export type RunResult = { stdout: string; ms: number };

export function run(bin: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-4000)));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, ms: Date.now() - started });
      else
        reject(
          new Error(`${bin} ${signal ? `killed (${signal})` : `exit ${code}`}: ${stderr.trim()}`),
        );
    });
  });
}
