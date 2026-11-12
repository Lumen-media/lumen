// Starfield: hashed star cells with depth and twinkle. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res);

  let density = P.u_extra[0].x;
  let twinkle = P.u_extra[0].y;
  let warp = P.u_extra[0].z;
  let depth = P.u_extra[0].w;

  let grid = p * (8.0 + density * 26.0) * (0.7 + depth * 0.6);
  let cell = floor(grid);
  let local = fract(grid) - vec2<f32>(0.5);
  let h = hash21(cell + vec2<f32>(P.u_seed * 0.013, P.u_seed * 0.007));
  let offset = vec2<f32>(hash11(h * 3.1), hash11(h * 7.7)) - vec2<f32>(0.5);
  let dist = length(local - offset * (0.6 + warp * 0.4));
  let size = (0.02 + h * 0.05) * (0.5 + depth);
  let star = 1.0 - smoothstep(0.0, size, dist);
  let tw = 0.55 + 0.45 * sin(P.u_time * (0.6 + twinkle * 3.0) * P.u_speed + h * 6.28318);

  var col = P.u_color_a.rgb * 0.035;
  col = col + palette(fract(h + warp * 0.2)) * star * tw * (0.6 + P.u_intensity);
  return vec4<f32>(col, 1.0);
}
