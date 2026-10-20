// One livery on one type at the game's three art sizes: hero, card (300 px)
// and mini (90 px, detail 'simple' as on the Fleet list and the map panel).

import type { Livery } from '../../../engine/core/types';
import { AircraftArt } from '../aircraft/AircraftArt';

export type PreviewSize = 'hero' | 'card' | 'mini';

export function LiveryPreview({ livery, code, name, typeId, sizes = ['hero', 'card', 'mini'] }: {
  livery: Livery; code?: string; name?: string; typeId: string; sizes?: PreviewSize[];
}) {
  return (
    <div className="lv-preview">
      {sizes.map((s) => (
        <figure key={s} className={`lv-preview-${s}`} data-size={s}>
          <AircraftArt typeId={typeId} livery={livery} code={code} name={name} detail={s === 'mini' ? 'simple' : 'full'} height={s === 'hero' ? undefined : s === 'card' ? 104 : 34} />
          <figcaption>{s === 'hero' ? 'Full' : s === 'card' ? 'Card' : 'Mini'}</figcaption>
        </figure>
      ))}
    </div>
  );
}
