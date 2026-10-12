import type { LayerSpecification, SourceSpecification, StyleSpecification } from 'maplibre-gl';

/**
 * Vue mixte : par-dessus la photographie aérienne, on reprend d'un style vectoriel OpenStreetMap uniquement ce qui
 * s'écrit (noms de rues, de lieux, numéros) et les contours de bâtiments. Les pictogrammes sont retirés (pas de
 * dépendance à une planche d'icônes) et le texte est recoloré pour rester lisible sur une photo (blanc, halo sombre).
 * Fonction pure : testée sans réseau.
 */
export interface HybridOverlay {
  sources: Record<string, SourceSpecification>;
  layers: LayerSpecification[];
}

export function hybridOverlay(vector: StyleSpecification): HybridOverlay {
  const sources: Record<string, SourceSpecification> = {};
  const layers: LayerSpecification[] = [];
  const usedSources = new Set<string>();
  for (const l of vector.layers) {
    if (l.type === 'symbol' && 'source' in l && l.layout && 'text-field' in l.layout) {
      const layout = { ...(l.layout as Record<string, unknown>) };
      for (const k of Object.keys(layout)) if (k.startsWith('icon-')) delete layout[k];
      const paint: Record<string, unknown> = { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.88)', 'text-halo-width': 1.7, 'text-halo-blur': 0.4 };
      layers.push({ ...l, id: `hyb-${l.id}`, layout, paint } as LayerSpecification);
      usedSources.add(l.source as string);
    } else if ('source-layer' in l && l['source-layer'] === 'building' && (l.type === 'fill' || l.type === 'fill-extrusion')) {
      layers.push({
        id: `hyb-${l.id}-outline`,
        type: 'line',
        source: l.source as string,
        'source-layer': 'building',
        minzoom: 15,
        paint: { 'line-color': 'rgba(255,255,255,0.75)', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.4, 19, 1.4] },
      } as LayerSpecification);
      usedSources.add(l.source as string);
    }
  }
  for (const s of usedSources) if (vector.sources[s]) sources[`hyb-${s}`] = vector.sources[s] as SourceSpecification;
  // les couches référencent les sources renommées
  for (const l of layers) if ('source' in l && typeof l.source === 'string') (l as { source: string }).source = `hyb-${l.source}`;
  return { sources, layers };
}
