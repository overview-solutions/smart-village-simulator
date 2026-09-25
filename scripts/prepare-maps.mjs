import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
const result = spawnSync(process.execPath, ['../../CIR/yang/locus/scripts/prepare-map-pack.mjs', '--out=village-simulator/public/maps/demo', '--lon=11.53412', '--lat=4.79209'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
for (const name of ['demo', 'demo-bright', 'demo-positron', 'demo-dark']) {
  const path = `village-simulator/public/maps/${name}/style.json`;
  const text = await readFile(path, 'utf8');
  await writeFile(path, text.replaceAll(`/maps/${name}/`, './'));
}
