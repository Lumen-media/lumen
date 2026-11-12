// Rain: angled streaks. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res) * (0.9 + P.u_scale * 0.7);

  let density = P.u_extra[0].x;
  let angle = P.u_extra[0].y * 0.0174533;
  let length_scale = P.u_extra[0].z;
  let splash = P.u_extra[0].w;

  let t = P.u_time * 1.5 * P.u_speed;
  let dir = vec2<f32>(sin(angle), cos(angle));
  let perp = vec2<f32>(dir.y, -dir.x);

  var q = vec2<f32>(dot(p, perp) * (40.0 + density * 70.0), dot(p, dir) * 3.0 + t);
  var col = P.u_color_a.rgb * 0.02;

  for (var layer = 0; layer < 3; layer = layer + 1) {
    let fl = f32(layer);
    var r = q + vec2<f32>(fl * 31.7, fl * 7.3);
    r.y = r.y * (0.7 + fl * 0.5);
    let cell = floor(r);
    let local = fract(r);
    let h = hash21(cell + vec2<f32>(fl * 3.1, P.u_seed * 0.011));
    if (h > 0.35) {
      let x = local.x - 0.5 - (hash11(h * 4.7) - 0.5) * 0.4;
      let streak_len = 0.15 + length_scale * 0.6;
      let y = local.y;
      let streak = (1.0 - smoothstep(0.0, 0.06, abs(x))) * smoothstep(0.0, 0.1, y) * (1.0 - smoothstep(streak_len * 0.6, streak_len, y));
      col = col + palette(fract(0.55 + h * 0.1)) * streak * (0.45 / (1.0 + fl * 0.8)) * (0.4 + P.u_intensity);
      if (splash > 0.0) {
        let head = length(vec2<f32>(x, y - streak_len)) * (1.0 / 0.08);
        let ring = smoothstep(0.9, 1.0, head) * exp(-y * 6.0);
        col = col + P.u_color_b.rgb * ring * splash * 0.35;
      }
    }
  }

  return vec4<f32>(col, 1.0);
}
