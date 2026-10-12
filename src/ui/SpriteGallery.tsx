import { useEffect, useRef, useState } from 'preact/hooks';
import { drawGallery } from '../render/sprites/gallery';
import { defaultManifest, ManifestIndex } from '../render/sprites/manifest';
import { ProceduralSpriteProvider } from '../render/sprites/procedural';
import type { LodTier } from '../render/sprites/types';

/** Planche de contrôle des sprites provisoires (`?gallery`) : outil de recette et de remplacement graphique. */
export function SpriteGallery() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ppm, setPpm] = useState(24);
  const [tier, setTier] = useState<LodTier>(3);
  const [night, setNight] = useState(false);
  const [count, setCount] = useState(0);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.min(1100, window.innerWidth - 24);
    const h = 3200;
    cv.width = w * dpr;
    cv.height = h * dpr;
    cv.style.width = `${w}px`;
    cv.style.height = `${h}px`;
    const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const index = new ManifestIndex(defaultManifest());
    const provider = new ProceduralSpriteProvider(index);
    provider.setDevicePixelRatio(dpr);
    setCount(drawGallery(ctx, w, h, index, provider, { ppm, tier, dpr, background: night ? '#0b1328' : '#d9dee5' }));
  }, [ppm, tier, night]);
  return (
    <main style={{ padding: '12px', font: '14px system-ui, sans-serif', color: '#e2e8f0', background: '#0f172a', minHeight: '100vh' }} data-testid="sprite-gallery">
      <h1 style={{ fontSize: '18px' }}>Planche des sprites provisoires</h1>
      <p>
        <label>
          Échelle (px/m) {ppm}{' '}
          <input type="range" min="4" max="64" value={ppm} onInput={(e) => setPpm(Number((e.target as HTMLInputElement).value))} />
        </label>{' '}
        <label>
          Palier{' '}
          <select data-testid="gallery-tier" value={tier} onChange={(e) => setTier(Number((e.target as HTMLSelectElement).value) as LodTier)}>
            <option value="2">T2 silhouette simple</option>
            <option value="3">T3 détaillé</option>
          </select>
        </label>{' '}
        <label>
          <input type="checkbox" checked={night} onChange={(e) => setNight((e.target as HTMLInputElement).checked)} /> fond nuit
        </label>{' '}
        <span data-testid="gallery-count">{count} sprites dessinés</span>
      </p>
      <canvas ref={ref} data-testid="gallery-canvas" />
    </main>
  );
}
