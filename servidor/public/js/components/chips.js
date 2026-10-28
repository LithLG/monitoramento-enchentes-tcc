import { html } from '../dom.js';
import { ZONE_LABEL } from './zoneScene.js';

export const zoneChip = (zone) => (zone ? html`<span class="zone-chip ${zone}">${ZONE_LABEL[zone]}</span>` : '');
