/**
 * Phoenix AutoLOD: non-destructive preflight and quality gate.
 * Geometry is NOT modified here. The caller must retain the original and
 * publish an optimized candidate only after all checks pass.
 */
export const AUTOLOD_MIN = 12000;
export const AUTOLOD_MAX = 50000;

function positions(g) {
  const p = g?.getAttribute?.('position');
  if (!p || p.itemSize < 3) throw new Error('Меш не содержит корректных позиций');
  return p;
}
function triCount(g) {
  const p = positions(g), idx = g.getIndex?.();
  const n = idx ? idx.count : p.count;
  if (n % 3 !== 0) throw new Error('Некорректный список треугольников');
  return n / 3;
}
function bounds(g) {
  const p = positions(g);
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.count; i++) {
    const xyz = [p.getX(i), p.getY(i), p.getZ(i)];
    for (let a = 0; a < 3; a++) {
      if (!Number.isFinite(xyz[a])) throw new Error('В геометрии обнаружены NaN/Infinity');
      min[a] = Math.min(min[a], xyz[a]); max[a] = Math.max(max[a], xyz[a]);
    }
  }
  if (!p.count) throw new Error('Пустой меш');
  return {min, max, size: max.map((v, i) => v - min[i])};
}
function indexOf(g, i) {
  const idx = g.getIndex?.();
  return idx ? idx.getX(i) : i;
}
function degenerates(g) {
  const p = positions(g), n = triCount(g), b = bounds(g);
  const span = Math.max(...b.size, 1e-12), eps2 = (span * span) ** 2 * 1e-20;
  let bad = 0;
  for (let t = 0; t < n; t++) {
    const ids = [0,1,2].map(i => indexOf(g, t * 3 + i));
    if (ids.some(i => !Number.isInteger(i) || i < 0 || i >= p.count)) throw new Error('Индекс треугольника вне диапазона');
    if (new Set(ids).size < 3) { bad++; continue; }
    const a = ids.map(i => [p.getX(i),p.getY(i),p.getZ(i)]);
    const u = a[1].map((v,i) => v - a[0][i]), v = a[2].map((w,i) => w - a[0][i]);
    const cross = [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    if (cross.reduce((s,x) => s+x*x,0) <= eps2) bad++;
  }
  return bad;
}
export function validateAutoLODTarget(target) {
  if (!Number.isInteger(target) || target < AUTOLOD_MIN || target > AUTOLOD_MAX)
    throw new RangeError('Цель AutoLOD: от 12 000 до 50 000 треугольников');
  return target;
}
export function inspectGeometry(g) {
  const vertices = positions(g).count;
  return {vertices, triangles: triCount(g), bounds: bounds(g), degenerateTriangles: degenerates(g)};
}
/**
 * Conservative acceptance gate. No claim of visual equivalence: screenshots,
 * UV seams, skeleton weights and multi-mesh aggregate still require tests.
 */
export function inspectAutoLODCandidate(original, candidate, {target=25000, dimensionTolerance=0.015}={}) {
  validateAutoLODTarget(target);
  if (!Number.isFinite(dimensionTolerance) || dimensionTolerance < 0 || dimensionTolerance > 0.2)
    throw new RangeError('Некорректный допуск размера');
  const before = inspectGeometry(original), after = inspectGeometry(candidate);
  const reasons = [];
  if (after.triangles > target) reasons.push('Превышено целевое число треугольников');
  if (after.triangles >= before.triangles) reasons.push('Число треугольников не уменьшилось');
  if (after.degenerateTriangles > before.degenerateTriangles) reasons.push('Появились вырожденные треугольники');
  for (let a=0;a<3;a++) {
    const ref = Math.max(before.bounds.size[a], 1e-9);
    if (Math.abs(after.bounds.size[a]-before.bounds.size[a]) / ref > dimensionTolerance)
      reasons.push('Изменился размер по оси '+ 'XYZ'[a]);
    const centerA = (before.bounds.min[a]+before.bounds.max[a])/2;
    const centerB = (after.bounds.min[a]+after.bounds.max[a])/2;
    if (Math.abs(centerA-centerB)/ref > dimensionTolerance)
      reasons.push('Сместился центр по оси '+ 'XYZ'[a]);
  }
  return {accepted:reasons.length===0, reasons, before, after, target};
}
