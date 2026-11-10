// Flow field: streaks following a noise field. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res) * (1.0 + P.u_scale * 0.9);

  let density = P.u_extra[0].x;
  let line_width = P.u_extra[0].y;
  let turbulence = P.u_extra[0].z;
  let glow = P.u_extra[0].w;

  let t = P.u_time * 0.25 * P.u_speed;
  var q = p;
  var acc = 0.0;
  var shade = 0.0;

  for (var i = 0; i < 6; i = i + 1) {
    let fi = f32(i);
    let n = value_noise(q * (1.5 + fi * 0.7) + vec2<f32>(t * 0.4, -t * 0.3));
    let angle = (n - 0.5) * 6.28318 * turbulence;
    let dir = vec2<f32>(cos(angle), sin(angle));
    q = q + dir * (0.18 / (1.0 + fi * 0.4));
    let line = abs(sin(q.x * (14.0 + density * 60.0) + q.y * (10.0 + density * 40.0) + t * 2.0));
    acc = acc + (1.0 - smoothstep(0.0, 0.12 + line_width * 0.5, line)) * (0.6 / (1.0 + fi * 0.5));
    shade = shade + n * (0.4 / (1.0 + fi * 0.5));
  }

  let streak = clamp(acc, 0.0, 1.0);
  var col = P.u_color_a.rgb * 0.05 + palette(fract(0.45 + shade * 0.4)) * streak * glow * 0.9;
  col = col + palette(fract(0.55 + shade * 0.3)) * streak * (0.35 + P.u_intensity * 0.8);
  return vec4<f32>(col, 1.0);
}
