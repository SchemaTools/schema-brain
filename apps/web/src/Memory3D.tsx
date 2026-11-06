// «Объём 3D» экрана «Память»: облако записей в трёх главных осях смысла (three.js, встроен в сборку —
// работает без интернета). Тянуть мышью — вращение, колесо — ближе, щелчок по точке — запись справа.
// Грузится отдельным файлом, только когда открыт этот вид.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CORE_COLOR } from './graph-elements.ts';
import { type MemoryAnswer, type MemoryData, roleOf } from './memory-view.ts';

const SPREAD = 10;

export function Memory3D({ data, answer, onPick }: { data: MemoryData; answer: MemoryAnswer | null; onPick: (n: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setClearColor(0xfbfbfc);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    camera.position.set(0, 4, 24);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = !answer;
    controls.autoRotateSpeed = 0.6;
    controls.addEventListener('start', () => (controls.autoRotate = false));
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(10, 20, 15);
    scene.add(sun);

    // сетка-ориентир внизу облака
    const grid = new THREE.GridHelper(SPREAD * 2.2, 22, 0xd7dbde, 0xe6e9eb);
    grid.position.y = -SPREAD * 1.05;
    scene.add(grid);

    const geo = new THREE.SphereGeometry(1, 16, 12);
    const meshes: THREE.Mesh[] = [];
    const at = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x * SPREAD, p.y * SPREAD, p.z * SPREAD);
    const byNumber = new Map(data.nodes.map((n) => [n.number, n]));
    for (const n of data.nodes) {
      const role = roleOf(n.number, answer);
      const color = new THREE.Color(CORE_COLOR[n.core] ?? '#5f6469');
      const faded = answer !== null && role === 'rest';
      const mat = new THREE.MeshLambertMaterial({ color, transparent: faded, opacity: faded ? 0.18 : 1 });
      const mesh = new THREE.Mesh(geo, mat);
      const size = role === 'found' ? 0.42 : role === 'linked' ? 0.34 : 0.22;
      mesh.scale.setScalar(size);
      mesh.position.copy(at(n));
      mesh.userData.number = n.number;
      scene.add(mesh);
      meshes.push(mesh);
    }
    if (answer?.point) {
      const q = at(answer.point);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 16), new THREE.MeshLambertMaterial({ color: 0x1a1d21 }));
      ball.position.copy(q);
      scene.add(ball);
      // сфера вопроса — полупрозрачная оболочка вокруг точки вопроса
      const shell = new THREE.Mesh(
        new THREE.SphereGeometry(1, 32, 24),
        new THREE.MeshBasicMaterial({ color: 0x1b3fd1, transparent: true, opacity: 0.06, depthWrite: false }),
      );
      const far = Math.max(1, ...answer.found.map((n) => (byNumber.get(n) ? at(byNumber.get(n)!).distanceTo(q) : 0)));
      shell.scale.setScalar(far * 1.08);
      shell.position.copy(q);
      scene.add(shell);
      const rays = answer.found.flatMap((n) => {
        const t = byNumber.get(n);
        return t ? [q, at(t)] : [];
      });
      scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(rays), new THREE.LineBasicMaterial({ color: 0x1b3fd1 })));
      const roads = data.links
        .filter((l) => (answer.found.includes(l.from) || answer.found.includes(l.to)) && [...answer.found, ...answer.linked].includes(l.from) && [...answer.found, ...answer.linked].includes(l.to))
        .flatMap((l) => {
          const a = byNumber.get(l.from);
          const b = byNumber.get(l.to);
          return a && b ? [at(a), at(b)] : [];
        });
      if (roads.length) {
        const line = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(roads), new THREE.LineDashedMaterial({ color: 0x5f6469, dashSize: 0.4, gapSize: 0.25 }));
        line.computeLineDistances();
        scene.add(line);
      }
      controls.target.copy(q);
    }

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    // щелчок без перетаскивания — выбор точки
    const ray = new THREE.Raycaster();
    let down = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const rect = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
      const hit = ray.intersectObjects(meshes)[0];
      if (hit) pickRef.current(hit.object.userData.number as number);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    let frame = 0;
    const tick = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: THREE.Material) => m.dispose());
        }
      });
      el.removeChild(renderer.domElement);
    };
  }, [data, answer]);

  return <div ref={box} className="mview" aria-label="Облако записей в объёме" />;
}
