/** The orchard calendar summary the card panels read (#562). */

import type { AudienceChoice } from './calendar';

export interface OrchardSummary {
  cropId: string;
  cropPluginId: string;
  cropName: string;
  status: 'calendar' | 'out-of-date' | 'none' | 'none-wanted';
  audience: AudienceChoice;
  calendar: { pluginId: string; edition: string; publicationId: string; title: string } | null;
  stage: { id: string; name: string } | null;
  mark: { stageId: string; markedAt: number; markedByName: string } | null;
  href: string;
}
