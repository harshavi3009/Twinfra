import { EffectComposer, Bloom, Vignette, SMAA } from '@react-three/postprocessing'

// Tasteful bloom: only bright emissive things (windows, edges, status glow) bleed.
export default function Effects() {
  return (
    <EffectComposer multisampling={0}>
      <Bloom mipmapBlur intensity={0.85} luminanceThreshold={0.45} luminanceSmoothing={0.25} />
      <Vignette offset={0.25} darkness={0.65} />
      <SMAA />
    </EffectComposer>
  )
}
