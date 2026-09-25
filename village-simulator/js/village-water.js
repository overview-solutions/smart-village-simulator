import * as THREE from 'three';
import { HOUSES, CLUSTERS } from './village-worldline-layout.js';

/** Hypothetical infrastructure diagram; river is invented, not basemap hydrography. */
export function buildVillageWater(scene, labelSprite) {
  const edge = Math.max(...HOUSES.map(h=>h.x), 55) + 7;
  const north = Math.min(...HOUSES.map(h=>h.z), -24) - 8;
  const south = Math.max(...HOUSES.map(h=>h.z), 68) + 8;
  const group = new THREE.Group();
  group.name = "village-water";
  const water = 0x389dbb, sewer = 0xa48466, reuse = 0x6ca76e;
  function box(x,y,z,w,h,d,color) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), new THREE.MeshLambertMaterial({color}));
    m.position.set(x,y,z); group.add(m); return m;
  }
  function label(text,x,z) {
    const s=labelSprite(text,'#a8dce7',360);s.scale.set(5,.8,1);s.position.set(x,2,z);group.add(s);
  }
  function pipe(points,color,r=.055) {
    const curve = new THREE.CatmullRomCurve3(points.map(([x,z])=>new THREE.Vector3(x,.19,z)),false,'centripetal');
    const m=new THREE.Mesh(new THREE.TubeGeometry(curve,48,r,6,false),new THREE.MeshBasicMaterial({color}));group.add(m);
  }
  function tank(x,z,r=.55,h=.6,color=water) {
    const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,20),new THREE.MeshLambertMaterial({color}));
    m.position.set(x,h/2+.06,z);group.add(m);
  }
  // Ribbon rather than a raised tube: flat water with banks at the settlement edge.
  const curve=new THREE.CatmullRomCurve3(Array.from({length:9},(_,i)=>new THREE.Vector3(edge+Math.sin(i*.9)*2,.045,north+(south-north)*i/8)));
  function ribbon(width,color,y) {
    const vertices=[];
    for(let i=0;i<100;i++) {
      const a=curve.getPoint(i/100),b=curve.getPoint((i+1)/100);
      vertices.push(a.x-width,y,a.z,a.x+width,y,a.z,b.x-width,y,b.z,b.x-width,y,b.z,a.x+width,y,a.z,b.x+width,y,b.z);
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide})));
  }
  ribbon(1.8,0x779278,.04);ribbon(1.2,water,.05);
  label('Schematic river · flow south ↓',edge,north+6);
  const intake=[edge,north+10], treatment=[edge-5,north+10], storage=[edge-9,north+14], waste=[edge-7,south-4];
  box(...[intake[0],.35,intake[1],.8,.7,.65,0x597f88]);
  tank(treatment[0],treatment[1]);tank(treatment[0]-1.4,treatment[1]);
  box(treatment[0],.5,treatment[1]+1.5,1.3,1,1,0xc4d7d7);
  box(storage[0],.7,storage[1],.45,1.4,.45,0x71858a);
  const tower=new THREE.Mesh(new THREE.CylinderGeometry(.6,.6,.7,16),new THREE.MeshLambertMaterial({color:0xb1dce5}));tower.position.set(storage[0],1.7,storage[1]);group.add(tower);
  pipe([intake,treatment,storage],water);
  label('Intake → treatment',treatment[0],treatment[1]-2);
  label('Clean-water storage',storage[0]-1,storage[1]+2);
  for(const c of CLUSTERS) {
    pipe([storage,[storage[0]-3,c.z],[c.x,c.z]],water);
    box(c.x,.35,c.z,.18,.7,.18,water);
    pipe([[c.x,c.z+1],[edge-11,c.z+2],waste],sewer,.04);
  }
  tank(waste[0],waste[1],.7,.35,sewer);tank(waste[0]+1.8,waste[1],.7,.35,0x829a87);
  box(waste[0],.08,waste[1]+2.5,3,.12,1.5,reuse);
  pipe([waste,[waste[0],waste[1]+2.5],[waste[0]-5,waste[1]+2.5]],reuse);
  label('Wastewater → wetland → reuse',waste[0]-1,waste[1]+4);
  return group;
}
