import { useMemo } from "react";
import { ContactShadows, Environment, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { HDRI_NIGHT } from "./assets";

const CITY_URL = "/models/citygen/city_generator_v24.glb";

useGLTF.preload(CITY_URL, true);

/**
 * The City Generator 2.4 — exported district for City Lab (Draco GLB).
 */
export function CityGenCity() {
  const { scene } = useGLTF(CITY_URL, true);

  const rooted = useMemo(() => {
    const root = scene.clone(true);
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material)
        ? mesh.material
        : mesh.material
          ? [mesh.material]
          : [];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        if (std.isMeshStandardMaterial) {
          std.envMapIntensity = 0.55;
          std.needsUpdate = true;
        }
      }
    });
    return root;
  }, [scene]);

  return (
    <group>
      <color attach="background" args={["#0c121a"]} />
      <fog attach="fog" args={["#0c121a", 28, 85]} />
      <hemisphereLight args={["#c4d0de", "#1a1c18", 0.4]} />
      <directionalLight
        castShadow
        position={[22, 36, 12]}
        intensity={1.25}
        color="#ffc9a0"
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={90}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
      />
      <directionalLight position={[-14, 8, -12]} intensity={0.3} color="#6eb0c0" />
      <Environment files={HDRI_NIGHT} background={false} />
      <primitive object={rooted} />
      <ContactShadows
        position={[0, 0.02, 0]}
        opacity={0.4}
        scale={70}
        blur={2.4}
        far={28}
      />
    </group>
  );
}

export function CityScene() {
  return <CityGenCity />;
}
