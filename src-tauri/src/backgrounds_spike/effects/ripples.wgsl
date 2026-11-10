// Ripples: concentric waves from a center. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res) * (0.9 + P.u_scale * 0.8);

  let center_x = P.u_extra[0].x;
  let center_y = P.u_extra[0].y;
  let frequency = P.u_extra[0].z;
  let decay = P.u_extra[0].w;

  let t = P.u_time * 0.6 * P.u_speed;
  let center = (vec2<f32>(center_x, center_y) - vec2<f32>(0.5)) * vec2<f32>(1.6, 1.0);
  let d = length(p - center);

  let wave = sin(d * frequency - t * 3.0);
  let falloff = exp(-d * mix(0.35, 3.2, decay));
  let ring = smoothstep(0.1, 1.0, wave) * falloff;

  var col = mix(P.u_color_a.rgb * 0.06, P.u_color_b.rgb * 0.55, ring);
  col = col + palette(fract(0.6 + d * 0.15)) * ring * (0.35 + P.u_intensity);
  col = col + vec3<f32>(0.02, 0.03, 0.05) * falloff;
  return vec4<f32>(col, 1.0);
}
