import { EffectComposer, Bloom, Vignette, SMAA } from '@react-three/postprocessing'

// Tasteful bloom: only bright emissive things (windows, edges, status glow) bleed.
// In day the sky is bright, so the threshold goes up and the glow down to stop the sky haloing.
export default function Effects({ night = false }) {
  return (
    <EffectComposer multisampling={0}>
      <Bloom
        mipmapBlur
        intensity={night ? 0.85 : 0.3}
        luminanceThreshold={night ? 0.45 : 1}
        luminanceSmoothing={0.25}
      />
      <Vignette offset={0.25} darkness={0.65} />
      <SMAA />
    </EffectComposer>
  )
}
