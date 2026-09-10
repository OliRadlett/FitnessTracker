import { describe, it, expect } from 'vitest';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

// Guards the fat-line primitive API both 3D viewers depend on (replay path +
// trail, route drape): a three bump that moves/renames these addons must
// fail loudly here instead of blanking production canvases.
describe('Line2 fat-line primitives', () => {
  it('builds coloured geometry with a capped instance count', () => {
    const geo = new LineGeometry();
    geo.setPositions([0, 0, 0, 10, 0, 0, 10, 10, 0]);
    geo.setColors([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(geo.getAttribute('instanceStart')).toBeTruthy();
    expect(geo.getAttribute('instanceColorStart')).toBeTruthy();
    // Trail growth lever: draw only the first segment.
    geo.instanceCount = 1;
    expect(geo.instanceCount).toBe(1);
    const mat = new LineMaterial({ linewidth: 3, vertexColors: true });
    mat.resolution.set(600, 300);
    const line = new Line2(geo, mat);
    expect(line.geometry).toBe(geo);
    geo.dispose();
    mat.dispose();
  });
});
