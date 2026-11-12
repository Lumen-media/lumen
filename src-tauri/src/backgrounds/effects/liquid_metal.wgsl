// Liquid metal: chrome-like flowing surface. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let uv = frag.xy / res;
  let p = aspect_correct(uv) * (0.9 + P.u_scale * 0.7);

  let turbulence = P.u_extra[0].x;
  let contrast = P.u_extra[0].y;
  let sheen = P.u_extra[0].z;
  let angle = P.u_extra[0].w * 0.0174533;

  let t = P.u_time * 0.2 * P.u_speed;
  var q = p;
  var n = 0.0;
  var amp = 0.5;
  for (var i = 0; i < 4; i = i + 1) {
    let fi = f32(i);
    n = n + value_noise(q * (1.4 + fi * 1.1) + vec2<f32>(t * (0.5 + fi * 0.2), -t * 0.3)) * amp;
    q = q + (vec2<f32>(n, 1.0 - n) - vec2<f32>(0.5)) * (turbulence * 0.25);
    amp = amp * 0.6;
  }

  let slope = value_noise(q * 2.0 + vec2<f32>(t * 0.1, 0.0)) - value_noise(q * 2.0 - vec2<f32>(0.0, t * 0.1));
  let dir = vec2<f32>(cos(angle), sin(angle));
  let band = dot(q, dir) * 2.0 + slope * 3.0;

  var metal = 0.5 + 0.5 * sin(band * 4.0 + n * 2.0);
  metal = pow(metal, mix(2.5, 0.6, contrast));
  metal = metal + pow(metal, 8.0) * sheen;

  var col = mix(P.u_color_a.rgb * 0.2, P.u_color_b.rgb, metal);
  col = col + vec3<f32>(1.0) * pow(metal, 16.0) * 0.35;
  col = col * (0.55 + P.u_intensity * 0.75);
  return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.4)), 1.0);
}
