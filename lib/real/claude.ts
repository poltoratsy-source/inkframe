// Asks Claude through the Claude Code CLI on this machine (`claude -p`), with whatever login and network settings
// Claude Code already has here; an own API key from the settings dialog (ANTHROPIC_API_KEY) is passed through.
// No tools, one turn, a hard timeout: if Claude can't be reached, the caller falls back to templates.
import { spawn } from 'node:child_process';

export interface AskOptions { timeoutMs?: number; model?: string; bin?: string }

export class ClaudeUnavailable extends Error {}

export function askClaude(prompt: string, o: AskOptions = {}): Promise<string> {
  const bin = o.bin ?? process.env.INKFRAME_CLAUDE_BIN ?? 'claude';
  const model = o.model ?? process.env.INKFRAME_CLAUDE_MODEL;
  const timeoutMs = o.timeoutMs ?? (Number(process.env.INKFRAME_CLAUDE_TIMEOUT) || 150) * 1000;
  const args = ['-p', '--output-format', 'json', '--max-turns', '1', '--tools', '', ...(model ? ['--model', model] : [])];
  return new Promise((resolve, reject) => {
    let out = '', err = '', done = false;
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], detached: true, env: process.env });
    const finish = (e?: Error, v?: string) => {
      if (done) return; done = true; clearTimeout(timer);
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already gone */ }
      if (e) reject(e); else resolve(v!);
    };
    const timer = setTimeout(() => finish(new ClaudeUnavailable(`Claude did not answer in ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => finish(new ClaudeUnavailable(`Claude Code CLI not found (${e.message})`)));
    child.on('close', code => {
      if (code !== 0 && !out) return finish(new ClaudeUnavailable(`claude exited ${code}: ${err.trim().slice(0, 200)}`));
      try {
        const j = JSON.parse(out);
        if (j.is_error || typeof j.result !== 'string') return finish(new ClaudeUnavailable(`Claude answered with an error: ${String(j.result ?? j.subtype).slice(0, 200)}`));
        finish(undefined, j.result);
      } catch { finish(new ClaudeUnavailable(`unexpected CLI output: ${out.slice(0, 200)}`)); }
    });
    child.stdin.end(prompt);
  });
}
