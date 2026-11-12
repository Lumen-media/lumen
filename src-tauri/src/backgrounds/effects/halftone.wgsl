// Halftone: dot grid with size modulation. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res) * (0.9 + P.u_scale * 0.7);

  let dot_size = P.u_extra[0].x;
  let angle = P.u_extra[0].y * 0.0174533;
  let contrast = P.u_extra[0].z;
  let animate = P.u_extra[0].w;

  let t = P.u_time * 0.4 * P.u_speed;
  let c = cos(angle);
  let s = sin(angle);
  let q = vec2<f32>(p.x * c - p.y * s, p.x * s + p.y * c);

  let grid_size = 16.0 + P.u_scale * 10.0;
  let g = q * grid_size;
  let cell = floor(g);
  let local = fract(g) - vec2<f32>(0.5);

  let n = value_noise(q * 2.0 + vec2<f32>(t * 0.6, -t * 0.4) * animate) * 0.6
    + value_noise(q * 5.0 + vec2<f32>(t * 0.3, 0.0)) * 0.4;

  let radius = (0.1 + (0.5 + dot_size * 0.9) * n) * (0.55 + contrast * 0.7);
  let d = length(local);
  let dot = 1.0 - smoothstep(radius - 0.06, radius, d);

  let tint = palette(fract(0.5 + n * 0.4));
  var col = mix(P.u_color_a.rgb * 0.06, tint * 0.7, dot);
  col = col + palette(fract(0.3 + n * 0.2)) * dot * (0.3 + P.u_intensity * 0.6);
  return vec4<f32>(col, 1.0);
}
