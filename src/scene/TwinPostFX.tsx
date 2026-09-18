import { EffectComposer, Bloom, SMAA, Vignette, BrightnessContrast } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import { useAscStore } from "../state/ascStore";

/**
 * Subtle twin post stack — readable ops look, not neon.
 * Slightly stronger vignette on the hero establishing shot.
 */
export function TwinPostFX() {
  const isHero = useAscStore((s) => s.mode === "hero");

  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <SMAA />
      <Bloom
        intensity={isHero ? 0.28 : 0.22}
        luminanceThreshold={0.72}
        luminanceSmoothing={0.35}
        mipmapBlur
      />
      <BrightnessContrast brightness={0.02} contrast={0.06} />
      <Vignette
        offset={isHero ? 0.28 : 0.38}
        darkness={isHero ? 0.72 : 0.55}
        blendFunction={BlendFunction.NORMAL}
      />
    </EffectComposer>
  );
}
