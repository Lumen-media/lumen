// Holographic: iridescent sheen bands. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res) * (0.9 + P.u_scale * 0.6);

  let bands = P.u_extra[0].x;
  let angle = P.u_extra[0].y * 0.0174533;
  let saturation = P.u_extra[0].z;
  let shine = P.u_extra[0].w;

  let t = P.u_time * 0.25 * P.u_speed;
  let dir = vec2<f32>(cos(angle), sin(angle));
  let axis = dot(p, dir) * (2.0 + bands * 0.7) + t;

  let n = value_noise(p * 3.0 + vec2<f32>(t * 0.2, -t * 0.15));
  let sheen = 0.5 + 0.5 * sin(axis * 6.28318 * 0.5 + n * 2.0);

  var col = palette(fract(0.15 + sheen * 0.75 + n * 0.1));
  let luma = dot(col, vec3<f32>(0.299, 0.587, 0.114));
  col = mix(vec3<f32>(luma), col, 0.4 + saturation * 1.0);
  col = col * (0.25 + sheen * 0.45 + shine * 0.7);
  col = col + vec3<f32>(1.0) * pow(sheen, 12.0) * shine * 0.5;
  col = col * (0.6 + P.u_intensity * 0.7);
  return vec4<f32>(col, 1.0);
}
