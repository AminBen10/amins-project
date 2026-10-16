import { headSDF, polygonize } from './headSdf.js';

self.onmessage = (event) => {
  const mesh = polygonize(headSDF, undefined, event.data.step);
  self.postMessage(mesh, [mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer]);
};
