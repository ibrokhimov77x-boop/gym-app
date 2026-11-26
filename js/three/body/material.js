// Body material: one physically based clay material for the whole skinned body. Muscles are regions of the same
// surface (vertex attribute `muscle`), coloured and lit per muscle id through uniform arrays, so 18 muscles cost one
// draw call and blend seamlessly into the skin.
//   tint  — base colour (clay when inactive, red/amber/heat colour when active)
//   glow  — emissive colour × intensity (pulses with the concentric phase)
//   rim   — Fresnel rim colour × strength (soft glow outline without post-processing)
//   act   — 0..1 "how active": shows muscle fibre striation and paler tendon ends on working muscles
//   pump  — 0..1 per muscle, the activation of the moment (figure.setActivation): the muscle swells by up to uSwell
//           along the normal where its BELLY lies (vertex attribute `belly`, step 04d: 0 at its outline and on tendons)
// Baked per-vertex shading (`shade` = ambient occlusion, curvature) darkens the grooves between muscles so the relief
// reads from every side, not only towards the key light.
// Skinning is dual-quaternion (uDQ: two vec4 per bone, filled by figure.js every frame): blending rotations instead of
// matrices keeps shoulders, elbows, hips and knees from collapsing in deep bends.
// The shadow pass uses createBodyDepthMaterial(): the SAME skinning chunks and the same uDQ uniform object, so the
// shadow caster deforms exactly like the lit surface (three's default depth material would skin linearly).
import * as THREE from 'three';
import { MUSCLE_IDS } from './rig.js';

export const N_MUSCLES = MUSCLE_IDS.length;
/** `tone` of cloth in the asset (tools/body/mh/garment.js SHORTS.tone): there the cloth has its full colour. */
export const CLOTH_TONE = 0.3;

// ── skinning chunks shared by the colour and the depth material ───────────────────────────────────────────────────
const SKIN_PARS = (bones) => `
        #ifdef USE_SKINNING
          uniform vec4 uDQ[${bones * 2}];
          vec3 dqRot(vec4 r, vec3 v) { return v + 2.0 * cross(r.xyz, cross(r.xyz, v) + r.w * v); }
        #endif`;
// replaces <skinbase_vertex>: blended dual quaternion (dqR, dqT), linear-blend matrix (lbsM), DQ amount (shade.z)
const SKIN_BASE = `
        #ifdef USE_SKINNING
          ivec4 si = ivec4(skinIndex + 0.5);
          vec4 r0 = uDQ[si.x * 2], d0 = uDQ[si.x * 2 + 1];
          vec4 r1 = uDQ[si.y * 2], d1 = uDQ[si.y * 2 + 1];
          vec4 r2 = uDQ[si.z * 2], d2 = uDQ[si.z * 2 + 1];
          vec4 r3 = uDQ[si.w * 2], d3 = uDQ[si.w * 2 + 1];
          float w1s = dot(r0, r1) < 0.0 ? -skinWeight.y : skinWeight.y;
          float w2s = dot(r0, r2) < 0.0 ? -skinWeight.z : skinWeight.z;
          float w3s = dot(r0, r3) < 0.0 ? -skinWeight.w : skinWeight.w;
          vec4 dqR = r0 * skinWeight.x + r1 * w1s + r2 * w2s + r3 * w3s;
          vec4 dqD = d0 * skinWeight.x + d1 * w1s + d2 * w2s + d3 * w3s;
          float dqL = 1.0 / max(length(dqR), 1e-6);
          dqR *= dqL; dqD *= dqL;
          vec3 dqT = 2.0 * (dqR.w * dqD.xyz - dqD.w * dqR.xyz + cross(dqR.xyz, dqD.xyz));
          // linear blend skinning (three.js bone texture) for the regions that should not use DQ arcs
          mat4 lbsM = skinWeight.x * getBoneMatrix(skinIndex.x) + skinWeight.y * getBoneMatrix(skinIndex.y)
                    + skinWeight.z * getBoneMatrix(skinIndex.z) + skinWeight.w * getBoneMatrix(skinIndex.w);
          lbsM = bindMatrixInverse * lbsM * bindMatrix;
          float dqAmt = shade.z;
        #endif`;
// replaces <skinning_vertex>
const SKIN_POSITION = `
        #ifdef USE_SKINNING
          transformed = mix((lbsM * vec4(transformed, 1.0)).xyz, dqRot(dqR, transformed) + dqT, dqAmt);
        #endif`;

export function createBodyMaterial({ clay = 0xc9c2b9, bones = 31 } = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    color: clay, roughness: 0.56, metalness: 0, clearcoat: 0.22, clearcoatRoughness: 0.5,
    sheen: 0.45, sheenRoughness: 0.55, sheenColor: new THREE.Color(0xfff4ea),
  });
  const mk = () => Array.from({ length: N_MUSCLES }, () => new THREE.Vector3());
  const U = {
    uTint: { value: mk() }, uGlow: { value: mk() }, uRimC: { value: mk() },
    uAct: { value: new Float32Array(N_MUSCLES) },
    // (step 04d) LIVING MUSCLES: a working muscle swells — the bind-pose surface moves out along its normal by
    // uSwell × belly × Σ (pump × muscle weight) before skinning. belly (asset attribute, tools/body/mh/relief.js) is a
    // dome: 0 at the muscle's outline and on its tendons, 1 in the middle of the belly, so nothing opens or steps at a
    // border; pump follows the glow's pulse (figure.js setActivation). Normals stay: at 2.5 mm the change is in the
    // silhouette and the reflections slide a little — subtle on purpose.
    uPump: { value: new Float32Array(N_MUSCLES) },
    uSwell: { value: 0.0025 },
    uClay: { value: new THREE.Color(clay) },
    uCavity: { value: 1.0 },
    // cavity factors: grooves darken indirect light by up to x, ridges lift it by up to y; z of the ambient occlusion
    // and w of the groove term also act on direct light. (0.55 / 0.1 / 0.45 / 0.7 until step 04b; with the darker
    // ambient of scene.js the grooves need less help, and a strong w drew collar bones and shoulder blades as dark
    // lines in close-ups — tmp/fig/mh02/shape/w/C_cav.png, C_cav2.png. The back, turned away from the key, lives on
    // the indirect light: there x = 0.6 smudged every small bump of the base mesh into a dark blotch; 0.45 keeps the
    // chest, abs and collar bones readable — tmp/fig/mh02/shape/r3/cmp_cavk.png, rows 0.6,…,0.5 / 0.45,…,0.4 / 0.35,….)
    uCavK: { value: new THREE.Vector4(0.45, 0.1, 0.5, 0.4) },
    // (step 04d) how much the emissive glow is darkened in grooves too (ao × groove): 0 = a flat red patch over the
    // muscle, 1 = the glow carries the relief as the lit clay does
    uGlowCav: { value: 0.6 },   // (0.6: tmp/fig/mh02/relief/ab11 rows 0 | 0.5 | 0.8 | 1 — the glow stays a glow)
    uFiber: { value: 1.0 },
    // `tone` (vertex attribute, 0 … 1) marks two kinds of surface that are drawn differently from the clay:
    //   cloth (tone ≤ 0.4; the shorts are CLOTH_TONE = 0.3, garment.js SHORTS.tone): clay × uToneColor — a darker,
    //            cooler grey of the same clay, matte (uToneMatte: how much of the clay's gloss, clearcoat and sheen,
    //            the cloth loses); the thin band of refined vertices at a hem, where tone climbs from 0 to 0.3,
    //            blends over. Chosen at phone size (tmp/fig/mh02/shape/r3/tone_ab.png, step 04b): the shorts read as a
    //            garment at a glance, the palette stays clay, and a highlighted muscle underneath still glows (the
    //            glow is emissive, the cloth only dims the tint).
    //   eyes  (tone ≥ 0.5): clay × mix(uIrisColor, uPupilColor, smoothstep(0.5, 1, tone)) — iris 0.5, its darker
    //            outer rim ≈ 0.62, pupil ≈ 0.95 (smooth.js sculptEyes); glossy (uEyeGloss), so the key light leaves a
    //            small catchlight — a sculpted, calm eye instead of a blank ball
    uToneColor: { value: new THREE.Color(0.55, 0.595, 0.67) },
    uToneMatte: { value: 0.75 },
    uIrisColor: { value: new THREE.Color(0.46, 0.39, 0.34) },
    uPupilColor: { value: new THREE.Color(0.07, 0.065, 0.06) },
    uEyeGloss: { value: 1.0 },
    uDQ: { value: new Float32Array(bones * 8) },
    uDbgBone: { value: -1 },
  };
  for (let i = 0; i < bones; i++) U.uDQ.value[i * 8 + 3] = 1; // identity rotations
  const clayC = new THREE.Color(clay);
  for (const v of U.uTint.value) v.set(clayC.r, clayC.g, clayC.b);
  m.userData.uniforms = U;

  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 muscle;
        attribute vec4 fiber;
        attribute vec3 shade;
        attribute float tone;
        attribute float belly;
        uniform float uPump[${N_MUSCLES}];
        uniform float uSwell;
        varying float vTone;
        uniform vec3 uTint[${N_MUSCLES}];
        uniform vec3 uGlow[${N_MUSCLES}];
        uniform vec3 uRimC[${N_MUSCLES}];
        uniform float uAct[${N_MUSCLES}];
        uniform vec3 uClay;
        uniform int uDbgBone;
        varying vec3 vTint;
        varying vec3 vGlow;
        varying vec3 vRim;
        varying float vAct;
        varying vec3 vBindPos;
        varying vec3 vFiberV;
        varying vec3 vFiberB;
        varying vec3 vBindN;
        varying float vTendon;
        varying vec2 vShade;${SKIN_PARS(bones)}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 tint = uClay * 1.0; vec3 glow = vec3(0.0); vec3 rim = vec3(0.0); float act = 0.0;
          float w0 = muscle.x >= 0.0 ? muscle.y : 0.0;
          float w1 = muscle.z >= 0.0 ? muscle.w : 0.0;
          // (step 05) the crotch of the shorts never lights up: on cloth below the hip line the muscle weights fade out
          // within 7 cm of the midline (adductors, the bottom of the glutes' cleft drew the eye to the groin)
          if (tone > 0.2 && tone < 0.45) {
            float crotch = (1.0 - smoothstep(0.025, 0.07, abs(position.x))) * (1.0 - smoothstep(0.88, 0.95, position.y));
            w0 *= 1.0 - crotch; w1 *= 1.0 - crotch;
          }
          float ws = w0 + w1;
          if (ws > 1.0) { w0 /= ws; w1 /= ws; ws = 1.0; }
          tint *= 1.0 - ws;
          float pump = 0.0;
          if (w0 > 0.0) { int i = int(muscle.x + 0.5); tint += uTint[i] * w0; glow += uGlow[i] * w0; rim += uRimC[i] * w0; act += uAct[i] * w0; pump += uPump[i] * w0; }
          if (w1 > 0.0) { int i = int(muscle.z + 0.5); tint += uTint[i] * w1; glow += uGlow[i] * w1; rim += uRimC[i] * w1; act += uAct[i] * w1; pump += uPump[i] * w1; }
          transformed += normal * (uSwell * belly * pump);   // living muscles (see uPump): bind pose, before skinning
          #ifdef USE_SKINNING
          if (uDbgBone >= 0) { // dev: skin weight of one bone as a red overlay
            float wd = 0.0; ivec4 sx = ivec4(skinIndex + 0.5);
            if (sx.x == uDbgBone) wd += skinWeight.x; if (sx.y == uDbgBone) wd += skinWeight.y;
            if (sx.z == uDbgBone) wd += skinWeight.z; if (sx.w == uDbgBone) wd += skinWeight.w;
            tint = mix(uClay, vec3(1.0, 0.1, 0.05), wd); glow = vec3(0.0); rim = vec3(0.0); act = 0.0;
          }
          #endif
          vTint = tint; vGlow = glow; vRim = rim; vAct = act;
          vBindPos = position; vBindN = normal; vFiberB = fiber.xyz; vTendon = fiber.w; vShade = shade.xy; vTone = tone;
        }`)
      .replace('#include <skinbase_vertex>', SKIN_BASE)
      .replace('#include <skinnormal_vertex>', `
        #ifdef USE_SKINNING
          objectNormal = normalize(mix((lbsM * vec4(objectNormal, 0.0)).xyz, dqRot(dqR, objectNormal), dqAmt));
          #ifdef USE_TANGENT
            objectTangent = dqRot(dqR, objectTangent);
          #endif
          vec3 fiberSk = dqRot(dqR, fiber.xyz);
        #else
          vec3 fiberSk = fiber.xyz;
        #endif`)
      .replace('#include <skinning_vertex>', SKIN_POSITION)
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
        vFiberV = normalize( normalMatrix * fiberSk + 1e-6 );`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uCavity;
        uniform vec4 uCavK;
        uniform float uGlowCav;
        uniform float uFiber;
        uniform vec3 uToneColor;
        uniform float uToneMatte;
        uniform vec3 uIrisColor;
        uniform vec3 uPupilColor;
        uniform float uEyeGloss;
        varying float vTone;
        varying vec3 vTint;
        varying vec3 vGlow;
        varying vec3 vRim;
        varying float vAct;
        varying vec3 vBindPos;
        varying vec3 vFiberV;
        varying vec3 vFiberB;
        varying vec3 vBindN;
        varying float vTendon;
        varying vec2 vShade;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = vTint;
        // working muscles: paler, smoother tendon ends
        float tendonK = clamp(vTendon, 0.0, 1.0) * clamp(vAct, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.86, 0.8), tendonK * 0.55);
        // cloth: the same surface drawn darker and cooler (a highlighted muscle keeps its colour under it);
        // eyes: iris → pupil (see uIrisColor above)
        float toneK = clamp(vTone, 0.0, 1.0);
        float eyeK = smoothstep(0.4, 0.5, toneK);
        vec3 clothMul = mix(vec3(1.0), uToneColor, clamp(toneK * ${(1 / CLOTH_TONE).toFixed(4)}, 0.0, 1.0));
        vec3 eyeMul = mix(uIrisColor, uPupilColor, smoothstep(0.5, 1.0, toneK));
        diffuseColor.rgb *= mix(clothMul, eyeMul, eyeK);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        // Muscle fibre striation on working muscles: stripes across a coordinate perpendicular to the fibres.
        if (vAct > 0.02 && uFiber > 0.0) {
          vec3 fb = normalize(vFiberB + 1e-6);
          vec3 tb = normalize(cross(normalize(vBindN + 1e-6), fb) + 1e-6);
          float u = dot(vBindPos, tb) * 300.0 + 1.1 * sin(dot(vBindPos, fb) * 55.0 + dot(vBindPos, tb) * 25.0);
          float fw = fwidth(u);
          float amp = clamp(1.0 - (fw - 0.12) * 3.0, 0.0, 1.0) * clamp(vAct, 0.0, 1.0) * (1.0 - tendonK) * 0.16 * uFiber;
          float s = cos(u * 6.2831);
          vec3 tv = normalize(cross(normal, normalize(vFiberV)));
          normal = normalize(normal + tv * s * amp);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float fres = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 2.2);
        totalEmissiveRadiance += vGlow * (1.0 - 0.6 * tendonK) + vRim * fres;`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        material.sheenColor *= mix(vec3(1.0), vTint / max(vec3(0.05), vec3(0.79, 0.76, 0.73)), 0.6);
        { // cloth is matte: it loses most of the clay's clearcoat and sheen (toneK 0.3 = cloth → full effect)
          float matte = uToneMatte * clamp(toneK * 3.4, 0.0, 1.0) * (1.0 - eyeK);
          material.sheenColor *= 1.0 - 0.6 * matte;
          material.roughness = mix(material.roughness, max(material.roughness, 0.82), matte);
          #ifdef USE_CLEARCOAT
            material.clearcoat *= 1.0 - matte;
            // eyes are glossy: a small catchlight of the key light
            float gloss = eyeK * uEyeGloss;
            material.clearcoat = mix(material.clearcoat, 1.0, gloss);
            material.clearcoatRoughness = mix(material.clearcoatRoughness, 0.12, gloss);
          #endif
        }`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        {
          float ao = mix(1.0, clamp(vShade.x, 0.0, 1.0), uCavity);
          float cav = clamp(vShade.y, -1.0, 1.0);
          float groove = mix(1.0, 1.0 + uCavK.x * min(cav, 0.0) + uCavK.y * max(cav, 0.0), uCavity);
          reflectedLight.indirectDiffuse *= ao * groove;
          reflectedLight.indirectSpecular *= ao;
          // (step 04d) the glow of a working muscle follows its relief: furrows between the bellies stay a little darker
          totalEmissiveRadiance *= mix(1.0, ao * groove, uGlowCav);
          reflectedLight.directDiffuse *= mix(1.0, ao, uCavK.z) * mix(1.0, groove, uCavK.w);
          #if defined( USE_CLEARCOAT )
            // the coat reflects the room only where the room can be seen; the eyes not at all: a glossy ball seen
            // head-on would mirror the room behind the camera as a dot in the middle of the pupil (a doll's stare) —
            // their catchlight comes from the key light alone, above and to the side of the pupil
            clearcoatSpecularIndirect *= ao * (1.0 - eyeK);
          #endif
        }`);
  };
  m.customProgramCacheKey = () => 'body-dq-v10-' + bones;
  // a body baked before the `tone` channel existed (dev A/B against an older bake) has no such attribute: tone = 0
  m.defaultAttributeValues = { tone: [0], belly: [0] };   // (belly: a bake before step 04d does not swell)
  return m;
}

/**
 * Depth material for the shadow pass (mesh.customDepthMaterial): three's MeshDepthMaterial with the body's skinning.
 * `uniforms` = bodyMaterial.userData.uniforms — the uDQ array is shared, figure.js fills it once per frame before
 * the shadow pass.
 */
export function createBodyDepthMaterial(uniforms, { bones = 31 } = {}) {
  const m = new THREE.MeshDepthMaterial();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uDQ = uniforms.uDQ;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 shade;${SKIN_PARS(bones)}`)
      .replace('#include <skinbase_vertex>', SKIN_BASE)
      .replace('#include <skinning_vertex>', SKIN_POSITION);
  };
  m.customProgramCacheKey = () => 'body-depth-dq-v1-' + bones;
  return m;
}
