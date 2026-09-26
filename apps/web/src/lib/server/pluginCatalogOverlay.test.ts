import { describe, expect, it } from 'vitest';
import type { PluginVersionRow } from '$lib/db/pluginVersions';
import { runtimeCatalogOverlay } from './pluginCatalogOverlay';

function row(p: Partial<PluginVersionRow> & { pluginId: string }): PluginVersionRow {
  return {
    id: p.pluginId,
    version: '1.0.0',
    kind: 'crop',
    hash: 'h',
    payloadJson: JSON.stringify({ pluginId: p.pluginId, version: p.version ?? '1.0.0' }),
    createdAt: 0,
    ...p
  };
}

const disk = new Map([
  ['corn', '1.0.0'],
  ['wheat', '1.2.0'],
  ['bean', '1.0.0']
]);

describe('runtimeCatalogOverlay', () => {
  it('ignores rows that only mirror the image', () => {
    expect(
      runtimeCatalogOverlay(
        [
          row({ pluginId: 'corn', version: '1.0.3', changeReason: 'initial-import' }),
          row({
            pluginId: 'wheat',
            version: '1.9.0',
            changeReason: 'rescan: payload changed on disk'
          })
        ],
        disk
      )
    ).toEqual({ hidden: [], payloads: [] });
  });

  it('replays an upload or rollback that is ahead of the image', () => {
    const out = runtimeCatalogOverlay(
      [
        row({ pluginId: 'corn', version: '1.0.1' }),
        row({ pluginId: 'wheat', version: '1.3.0', changeReason: 'rollback to 1.1.0' }),
        row({ pluginId: 'squash-new', version: '1.0.0', changeReason: 'upload' })
      ],
      disk
    );
    expect(out.hidden).toEqual([]);
    expect(out.payloads.map((p) => (p as { pluginId: string }).pluginId)).toEqual([
      'corn',
      'wheat',
      'squash-new'
    ]);
  });

  it('lets a newer image win over an older upload', () => {
    expect(
      runtimeCatalogOverlay(
        [row({ pluginId: 'wheat', version: '1.1.5', changeReason: 'upload' })],
        disk
      ).payloads
    ).toEqual([]);
    expect(
      runtimeCatalogOverlay(
        [row({ pluginId: 'wheat', version: '1.2.0', changeReason: 'upload' })],
        disk
      ).payloads
    ).toEqual([]);
  });

  it('keeps retired and uninstalled plugins hidden after a restart', () => {
    const out = runtimeCatalogOverlay(
      [
        row({ pluginId: 'bean', retiredAt: 5, changeReason: 'initial-import' }),
        row({ pluginId: 'corn', retiredAt: 5, payloadJson: '', changeReason: 'uninstall' })
      ],
      disk
    );
    expect(out.hidden).toEqual(['bean', 'corn']);
    expect(out.payloads).toEqual([]);
  });

  it('skips superseded rows and unparseable payloads', () => {
    expect(
      runtimeCatalogOverlay(
        [
          row({ pluginId: 'corn', version: '2.0.0', supersededAt: 9, changeReason: 'upload' }),
          row({ pluginId: 'bean', version: '2.0.0', payloadJson: '{nope', changeReason: 'upload' })
        ],
        disk
      )
    ).toEqual({ hidden: [], payloads: [] });
  });
});
