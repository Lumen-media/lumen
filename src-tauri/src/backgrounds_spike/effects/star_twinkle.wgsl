// Star twinkle: sparse stars gently pulsing. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res) * (0.9 + P.u_scale * 0.7);

  let density = P.u_extra[0].x;
  let size_variance = P.u_extra[0].y;
  let twinkle_speed = P.u_extra[0].z;

  let grid = p * (10.0 + density * 30.0);
  let cell = floor(grid);
  let local = fract(grid) - vec2<f32>(0.5);
  let h = hash21(cell + vec2<f32>(P.u_seed * 0.011, P.u_seed * 0.017));

  var col = P.u_color_a.rgb * 0.02;
  if (h > 0.55) {
    let offset = (vec2<f32>(hash11(h * 5.1), hash11(h * 9.7)) - vec2<f32>(0.5)) * 0.6;
    let d = length(local - offset);
    let size = 0.015 + h * (0.02 + size_variance * 0.05);
    let core = 1.0 - smoothstep(0.0, size, d);
    let glow = exp(-(d * d) / (size * size * 8.0)) * 0.35;
    let pulse = 0.35 + 0.65 * (0.5 + 0.5 * sin(P.u_time * twinkle_speed * 2.2 * P.u_speed + h * 12.0));
    col = col + palette(fract(0.55 + h * 0.3)) * (core + glow) * pulse * (0.7 + P.u_intensity);
  }

  return vec4<f32>(col, 1.0);
}
