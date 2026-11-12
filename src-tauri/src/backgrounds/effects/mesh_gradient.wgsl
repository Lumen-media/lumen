// Mesh gradient: soft color blobs drifting and blending. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res) * (1.1 + P.u_scale * 0.7);

  let points = i32(P.u_extra[0].x);
  let warp = P.u_extra[0].y;
  let blur = P.u_extra[0].z;
  let saturation = P.u_extra[0].w;

  let t = P.u_time * 0.1 * P.u_speed;
  var col = P.u_color_a.rgb * 0.04;
  var wsum = 0.6;

  for (var i = 0; i < 8; i = i + 1) {
    if (i >= points) {
      break;
    }
    let fi = f32(i) + 1.0;
    let ang = fi * 2.399 + P.u_seed * 0.011;
    let center = vec2<f32>(
      sin(t * (0.5 + fi * 0.08) + ang) * (0.5 + fi * 0.06),
      cos(t * (0.42 + fi * 0.06) + ang * 1.7) * 0.5,
    ) + (vec2<f32>(hash11(fi * 7.3), hash11(fi * 3.1)) - vec2<f32>(0.5)) * warp;
    let d = length(p - center);
    let radius = 0.55 + blur * 0.75;
    let w = exp(-(d * d) / (radius * radius));
    col = col + palette(fract(0.12 + fi * 0.17)) * w;
    wsum = wsum + w;
  }

  col = col / wsum;
  let luma = dot(col, vec3<f32>(0.299, 0.587, 0.114));
  col = mix(vec3<f32>(luma), col, 0.45 + saturation * 1.0);
  col = col * (0.55 + P.u_intensity * 0.8);
  return vec4<f32>(max(col, vec3<f32>(0.0)), 1.0);
}
