// Fireflies: wandering glowing points. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res) * (0.9 + P.u_scale * 0.7);

  let density = P.u_extra[0].x;
  let wander = P.u_extra[0].y;
  let glow = P.u_extra[0].z;
  let blink = P.u_extra[0].w;

  let t = P.u_time * 0.3 * P.u_speed;
  let grid = p * (5.0 + density * 9.0);
  let cell = floor(grid);
  let local = fract(grid) - vec2<f32>(0.5);

  var col = P.u_color_a.rgb * 0.015;

  for (var dy = -1; dy <= 1; dy = dy + 1) {
    for (var dx = -1; dx <= 1; dx = dx + 1) {
      let c = cell + vec2<f32>(f32(dx), f32(dy));
      let h = hash21(c + vec2<f32>(P.u_seed * 0.01, P.u_seed * 0.017));
      if (h > 0.45) {
        let phase = h * 6.28318;
        let off = vec2<f32>(
          sin(t * (0.6 + wander) + phase) * 0.45,
          cos(t * (0.5 + wander * 0.8) + phase * 1.3) * 0.45,
        );
        let d = length(local - vec2<f32>(f32(dx), f32(dy)) - off);
        let pulse = mix(1.0, 0.5 + 0.5 * sin(t * 2.4 + phase * 3.0), blink);
        let core = 1.0 - smoothstep(0.0, 0.05, d);
        let halo = exp(-(d * d) / 0.03) * glow;
        col = col + palette(fract(0.3 + h * 0.12)) * (core + halo * 0.8) * pulse * (0.7 + P.u_intensity);
      }
    }
  }

  return vec4<f32>(col, 1.0);
}
