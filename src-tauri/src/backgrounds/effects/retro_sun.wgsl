// Retro sun: synthwave sun with stripes and horizon. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res);

  let sun_size = P.u_extra[0].x;
  let stripe_count = P.u_extra[0].y;
  let horizon = P.u_extra[0].z;
  let scroll = P.u_extra[0].w;

  let t = P.u_time * 0.5 * P.u_speed;
  let sun_y = -0.15 + (horizon - 0.5) * 0.4;
  let sun_r = 0.18 + sun_size * 0.28;

  var col = mix(P.u_color_b.rgb * 0.06, P.u_color_a.rgb * 0.02, p.y * 0.5 + 0.5);

  // Sky glow behind the sun.
  let flare = exp(-length(p - vec2<f32>(0.0, sun_y)) * 3.0);
  col = col + palette(fract(0.08 + sun_size * 0.1)) * flare * 0.25 * (0.5 + P.u_intensity);

  // Sun disc with horizontal stripes cut from the lower half.
  let d = length(p - vec2<f32>(0.0, sun_y));
  let disc = 1.0 - smoothstep(sun_r - 0.01, sun_r + 0.01, d);
  let stripe_phase = fract((p.y - sun_y) / max(sun_r * 2.0, 0.001) * stripe_count * 0.5 + t * scroll);
  let cut = smoothstep(0.0, 0.25, stripe_phase) * 0.6 + 0.4;
  let gradient = clamp(0.5 + (p.y - sun_y) / max(sun_r, 0.001), 0.0, 1.0);
  let sun_col = mix(palette(0.05), palette(0.55), gradient);
  col = mix(col, sun_col, disc * mix(1.0, cut, step(0.0, 1.0 - sun_size * 0.4)));

  // Perspective grid floor.
  let floor_mask = smoothstep(0.0, 0.01, sun_y - p.y);
  if (floor_mask > 0.0) {
    let depth = 1.0 / max(abs(p.y - sun_y) * 3.0 + 0.05, 0.001);
    let gx = abs(fract(p.x * (6.0 + scroll * 12.0) * depth * 0.15 + t * scroll) - 0.5) * 2.0;
    let gz = abs(fract(depth * 0.9 + t * scroll * 0.8) - 0.5) * 2.0;
    let lines = smoothstep(0.9, 1.0, max(1.0 - gx, 1.0 - gz));
    col = col + palette(fract(0.6)) * lines * floor_mask * 0.55 * (0.4 + P.u_intensity);
  }

  col = col + palette(fract(0.75)) * smoothstep(0.005, 0.0, abs(p.y - sun_y)) * 0.35;
  return vec4<f32>(col, 1.0);
}
