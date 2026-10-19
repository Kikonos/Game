// Temporary screen body used by the skeleton until a builder replaces it.

import { Construction } from 'lucide-react';
import { Empty } from '../components/ui';

export function Placeholder({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>{title}</h1>
          <div className="subtitle">{desc}</div>
        </div>
      </div>
      <Empty icon={<Construction />} title="Coming in v0.5">
        This screen is being built.
      </Empty>
    </div>
  );
}
