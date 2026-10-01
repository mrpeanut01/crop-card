/**
 * C-35 §3 budget: projecting a large farm (the guard projects twice per
 * write). 500 animals, 200 blocks, five years of records.
 */

import { describe, expect, it } from 'vitest';
import { projectHolds } from './holdLedger';
import { NOW, bigFarm, bigFarmContext } from './__reference__/bigFarm';

describe('hold ledger performance (C-35 §3)', () => {
  it('projects a 500-animal, 200-block, five-year farm within budget', () => {
    const facts = bigFarm();
    const ctx = bigFarmContext();
    projectHolds(facts, NOW, ctx);
    // CPU time of this thread, not wall time: the budget is the work one
    // projection costs, and wall time also counts every other test file
    // the suite runs on the same cores at once. Process CPU would add the
    // GC and compiler threads, so wall time is the fallback.
    const threadCpu = (process as { threadCpuUsage?: () => { user: number; system: number } })
      .threadCpuUsage;
    const cpuMs = threadCpu
      ? () => {
          const u = threadCpu.call(process);
          return (u.user + u.system) / 1000;
        }
      : () => performance.now();
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = cpuMs();
      projectHolds(facts, NOW, ctx);
      runs.push(cpuMs() - start);
    }
    runs.sort((a, b) => a - b);
    const median = runs[2];
    process.stderr.write(
      `[perf] hold ledger projection median ${median.toFixed(1)} ms${threadCpu ? ' CPU' : ''} runs ${runs.map((r) => r.toFixed(1)).join(',')}\n`
    );
    // The C-35 target (ruling G1-01): 25 ms of thread CPU, or 50 ms of
    // wall time where thread CPU cannot be read.
    expect(median).toBeLessThan(threadCpu ? 25 : 50);
  }, 60_000);
});
