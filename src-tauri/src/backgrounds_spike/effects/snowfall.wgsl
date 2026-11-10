// Snowfall: falling flakes with wind. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res) * (0.9 + P.u_scale * 0.7);

  let density = P.u_extra[0].x;
  let wind = P.u_extra[0].y;
  let size = P.u_extra[0].z;
  let blur = P.u_extra[0].w;

  let t = P.u_time * 0.35 * P.u_speed;
  var col = P.u_color_b.rgb * 0.03;

  for (var layer = 0; layer < 3; layer = layer + 1) {
    let fl = f32(layer);
    let cells = 9.0 + density * 22.0 + fl * 5.0;
    var q = p * cells;
    q.x = q.x + wind * t * (1.2 + fl * 0.4) + sin(t * 0.7 + q.y * 0.6) * 0.35;
    q.y = q.y + t * (1.4 + fl * 0.8);

    let cell = floor(q);
    let local = fract(q) - vec2<f32>(0.5);
    let h = hash21(cell + vec2<f32>(fl * 13.7, P.u_seed * 0.009));
    if (h > 0.28) {
      let offset = (vec2<f32>(hash11(h * 4.3), hash11(h * 8.1)) - vec2<f32>(0.5)) * 0.7;
      let d = length(local - offset);
      let r = (0.02 + size * 0.09) * (0.6 + h * 0.7);
      let flake = 1.0 - smoothstep(r * (1.0 - blur * 0.6), r, d);
      col = col + palette(fract(0.55 + h * 0.1)) * flake * (0.55 / (1.0 + fl * 0.7)) * (0.5 + P.u_intensity);
    }
  }

  return vec4<f32>(col, 1.0);
}
