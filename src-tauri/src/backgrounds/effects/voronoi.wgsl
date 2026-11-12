// Voronoi: animated cells with glowing edges. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res) * (0.9 + P.u_scale * 0.7);

  let cells = P.u_extra[0].x;
  let edge_glow = P.u_extra[0].y;
  let warp = P.u_extra[0].z;
  let shade = P.u_extra[0].w;

  let t = P.u_time * 0.2 * P.u_speed;
  let q = p * cells + vec2<f32>(value_noise(p * 2.0 + vec2<f32>(t, 0.0)), value_noise(p * 2.0 + vec2<f32>(0.0, t))) * warp;

  let cell = floor(q);
  let local = fract(q);

  var d1 = 8.0;
  var d2 = 8.0;
  var cell_id = 0.0;

  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let neighbor = vec2<f32>(f32(x), f32(y));
      let h = hash21(cell + neighbor + vec2<f32>(P.u_seed * 0.011, P.u_seed * 0.007));
      let jitter = vec2<f32>(hash11(h * 5.3), hash11(h * 9.1)) * 0.8 + 0.1;
      let point = neighbor + jitter + vec2<f32>(sin(t + h * 6.0), cos(t + h * 4.0)) * 0.08;
      let d = length(local - point);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        cell_id = h;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }

  let edge = 1.0 - smoothstep(0.0, 0.02 + edge_glow * 0.12, d2 - d1);
  var col = mix(P.u_color_a.rgb * 0.15, P.u_color_b.rgb * 0.5, cell_id * shade);
  col = col + palette(fract(0.55 + cell_id * 0.2)) * (0.35 + P.u_intensity * 0.6) * (1.0 - smoothstep(0.0, 0.5, d1));
  col = col + palette(fract(0.7 + cell_id * 0.1)) * edge * edge_glow * 1.4;
  return vec4<f32>(col, 1.0);
}
