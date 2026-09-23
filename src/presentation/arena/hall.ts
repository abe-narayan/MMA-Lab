/**
 * Sports hall for the grappling mat and the judo tatami: raised mat block with
 * the competition area exactly at the sim's edge (|x|, |z| = halfWidthM), a
 * safety border, maple hall floor, pale walls with fictional banners, a
 * ceiling of bright LED panels, bleachers on the two long sides, and a
 * scorer's table with a scoreboard. Bright, even and a little cool — the
 * opposite of the broadcast arena.
 */
import * as THREE from 'three/webgpu';
import { vec3, float, positionWorld, fract, step, mx_noise_float, mix, abs, smoothstep } from 'three/tsl';
import type { Arena } from '../../sim';
import { MergeBuilder, srgb } from './merge';
import { polygonFloor } from './octagon';
import { bannerTexture, FICTIONAL_SPONSORS, ledBoardTexture } from './textures';
import { addPerson } from './dressing';
import { glowMaterial, ledMaterial, propMaterial } from './materials';
import { wallInradius } from './geometry';
import { mulberry32 } from './rng';

export interface Hall {
  group: THREE.Group;
  ceilingY: number;
  bleacherZ: number;
  triangles: number;
  drawCalls: number;
}

const MAT_T = 0.05;

export function buildHall(arena: Arena, matMaterial: THREE.Material, L: number, seed: number): Hall {
  const group = new THREE.Group();
  group.name = 'arena.hall';
  const h = wallInradius(arena);
  const e = h + 3.0; // safety border
  const W = 17; // hall half-width (x)
  const D = 16; // hall half-depth (z)
  const ceilingY = 9.5;
  let tris = 0;
  let draws = 0;

  // Mat block: top at y = 0 (the fighting surface), sides down to the hall floor.
  const top = new THREE.Mesh(polygonFloor([[-e, e], [e, e], [e, -e], [-e, -e]], 0, L), matMaterial);
  top.receiveShadow = true;
  top.name = 'arena.mat';
  group.add(top);
  tris += 4; draws++;

  const lit = new MergeBuilder();
  const side = new THREE.BoxGeometry(2 * e, MAT_T, 2 * e);
  lit.add(side, { y: -MAT_T / 2 - 0.001 }, srgb(arena.surface === 'tatami' ? '#2c5aa0' : '#d1c33d'));

  // Hall floor: maple boards with court lines (procedural).
  const floorG = new THREE.PlaneGeometry(2 * W, 2 * D);
  floorG.rotateX(-Math.PI / 2);
  floorG.translate(0, -MAT_T, 0);
  const floorM = new THREE.MeshStandardNodeMaterial();
  const P = positionWorld;
  const board = fract(P.x.mul(1 / 0.14));
  const plank = mx_noise_float(vec3(P.x.mul(7).floor(), 0, P.z.mul(0.4))).mul(0.12);
  const grain = mx_noise_float(vec3(P.x.mul(30), 0, P.z.mul(1.5))).mul(0.05);
  const wood = vec3(0.55, 0.36, 0.2).mul(float(0.85).add(plank).add(grain)).mul(mix(float(0.9), float(1), step(0.04, board)));
  const line = step(abs(abs(P.z).sub(D - 2.2)), 0.03).add(step(abs(abs(P.x).sub(W - 2.5)), 0.03));
  floorM.colorNode = mix(wood, vec3(0.8, 0.8, 0.82), line.clamp(0, 1));
  floorM.roughnessNode = float(0.32).add(grain.mul(2));
  const floorMesh = new THREE.Mesh(floorG, floorM);
  floorMesh.receiveShadow = true;
  group.add(floorMesh);
  tris += 2; draws++;

  // Walls: pale painted block with a darker dado.
  const walls = new THREE.BoxGeometry(2 * W, ceilingY + MAT_T, 2 * D);
  walls.translate(0, ceilingY / 2 - MAT_T, 0);
  const wallM = new THREE.MeshStandardNodeMaterial({ side: THREE.BackSide });
  const dado = smoothstep(1.35, 1.4, P.y);
  wallM.colorNode = mix(vec3(0.07, 0.09, 0.14), vec3(0.3, 0.31, 0.33), dado);
  wallM.roughnessNode = float(0.85);
  group.add(new THREE.Mesh(walls, wallM));
  tris += 12; draws++;

  // Ceiling panels (emissive) in a grid, with dark trusses between.
  const panels = new MergeBuilder();
  for (let x = -W + 2; x <= W - 2; x += 4) {
    for (let z = -D + 1.5; z <= D - 1.5; z += 3) {
      const p = new THREE.PlaneGeometry(1.2, 0.6);
      p.rotateX(Math.PI / 2);
      panels.add(p, { x, y: ceilingY - 0.3, z }, [1, 1, 1]);
    }
  }
  const panelMesh = new THREE.Mesh(panels.build(), glowMaterial('#f4f6ff', 9));
  group.add(panelMesh);
  tris += panels.triangles; draws++;
  for (let x = -W + 2; x <= W - 2; x += 4) {
    lit.add(new THREE.BoxGeometry(0.25, 0.45, 2 * D), { x, y: ceilingY - 0.05 }, srgb('#3a3c40'));
  }

  // Scorer's table on the +x side with officials, and a scoreboard on the wall.
  const tx = e + 1.6;
  lit.add(new THREE.BoxGeometry(0.8, 0.75, 3.2), { x: tx, y: 0.375 - MAT_T }, srgb('#1a2438'));
  const rnd = mulberry32(seed);
  for (const z of [-1, 0, 1]) {
    addPerson(lit, tx + 0.7, -MAT_T, z, -Math.PI / 2, 'seated', srgb(rnd() < 0.5 ? '#1c2230' : '#e8e8ea'), srgb(['#e0ac85', '#a86b45', '#f1c7a5'][Math.floor(rnd() * 3)]!));
  }
  // Coaches' chairs on the -x side, corner judges on two diagonal corners.
  const chair = (x: number, z: number, ry: number) => {
    lit.add(new THREE.BoxGeometry(0.44, 0.05, 0.42), { x, y: 0.45 - MAT_T, z, ry }, srgb('#1a1a1e'));
    lit.add(new THREE.BoxGeometry(0.44, 0.45, 0.04), { x: x - Math.sin(ry) * 0.2, y: 0.7 - MAT_T, z: z - Math.cos(ry) * 0.2, ry }, srgb('#1a1a1e'));
    for (const [lx, lz] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]] as [number, number][]) {
      lit.add(new THREE.BoxGeometry(0.03, 0.45, 0.03), { x: x + lx * Math.cos(ry) + lz * Math.sin(ry), y: 0.225 - MAT_T, z: z - lx * Math.sin(ry) + lz * Math.cos(ry) }, srgb('#2a2a2e'));
    }
  };
  for (const z of [-1.6, 1.6]) {
    chair(-e - 1.2, z, Math.PI / 2);
    addPerson(lit, -e - 1.2, -MAT_T, z, Math.PI / 2, 'seated', srgb(z < 0 ? '#8e1c22' : '#1d56b0'), srgb('#c68a62'));
  }
  for (const [x, z] of [[e - 0.5, e - 0.5], [-(e - 0.5), -(e - 0.5)]] as [number, number][]) {
    const ry = Math.atan2(-x, -z);
    chair(x, z, ry);
    addPerson(lit, x, -MAT_T, z, ry, 'seated', srgb('#15171c'), srgb('#e0ac85'));
  }
  // LED advertising boards around the safety area (as at judo and grappling events).
  const ledTex = ledBoardTexture(`hall:${seed}`, '#c0161d');
  const ledMat = ledMaterial(ledTex, 0.8);
  const boards = new MergeBuilder();
  const bE = e + 1.9;
  const boardH = 0.8;
  const sides: [number, number, number, number][] = [[0, bE, 2 * bE - 3, 0], [0, -bE, 2 * bE - 3, Math.PI], [bE, 0, 2 * bE - 3, Math.PI / 2]];
  for (const [x, z, len, ry] of sides) {
    const g = new THREE.PlaneGeometry(len, boardH);
    const uvA = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uvA.count; i++) uvA.setX(i, uvA.getX(i) * (len / 8));
    boards.add(g, { x, y: boardH / 2 - MAT_T + 0.05, z, ry: ry + Math.PI }, [1, 1, 1]);
    // Back of the board.
    lit.add(new THREE.BoxGeometry(len, boardH + 0.06, 0.12), { x: x + Math.sin(ry) * 0.07, y: boardH / 2 - MAT_T + 0.05, z: z + Math.cos(ry) * 0.07, ry }, srgb('#0c0c0e'));
  }
  const boardMesh = new THREE.Mesh(boards.build(), ledMat);
  group.add(boardMesh);
  tris += boards.triangles; draws++;
  const litMesh = new THREE.Mesh(lit.build(), propMaterial(0.6));
  litMesh.receiveShadow = true;
  litMesh.castShadow = true;
  group.add(litMesh);
  tris += lit.triangles; draws++;

  // Scoreboard: glowing panel on the +x wall.
  const sb = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 2.2), glowMaterial('#0a1a3a', 1));
  sb.position.set(W - 0.05, 4.5, 0);
  sb.rotation.y = -Math.PI / 2;
  group.add(sb);
  const sbL = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.2), glowMaterial('#c0161d', 2));
  sbL.position.set(W - 0.07, 4.4, 1.1);
  sbL.rotation.y = -Math.PI / 2;
  const sbR = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.2), glowMaterial('#1d56b0', 2));
  sbR.position.set(W - 0.07, 4.4, -1.1);
  sbR.rotation.y = -Math.PI / 2;
  group.add(sbL, sbR);
  tris += 6; draws += 3;

  // Banners on the -x wall and the ends.
  const banners: [string, number, number, number][] = [
    ['BOUT LAB OPEN', -W + 0.06, 6.2, 0],
    [FICTIONAL_SPONSORS[5], -W + 0.06, 6.2, 8],
    [FICTIONAL_SPONSORS[0], -W + 0.06, 6.2, -8],
  ];
  for (const [text, x, y, z] of banners) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshStandardNodeMaterial({ map: bannerTexture(text, '#14213a', '#e8e8ec'), roughness: 0.8 }));
    b.position.set(x, y, z);
    b.rotation.y = Math.PI / 2;
    group.add(b);
    tris += 2; draws++;
  }
  return { group, ceilingY, bleacherZ: e + 2.6, triangles: tris, drawCalls: draws };
}
